-- ================================================
-- 002 - 迁移现有用户角色到 RBAC 体系
-- 将 users.role 字段值映射到 roles 表
-- 幂等执行：可重复执行不会报错
-- ================================================

-- ================================================
-- 1. 插入系统内置角色（如不存在则插入）
-- ================================================
INSERT IGNORE INTO roles (id, code, name, description, is_system, sort_order) VALUES
  (UUID(), 'admin',   '管理员',   '系统管理员，拥有所有权限',     1, 1),
  (UUID(), 'finance', '财务',     '财务人员，可查看月度分析报表', 1, 2),
  (UUID(), 'boss',    '董事长',   '高层管理人员，可查看全部报表', 1, 3),
  (UUID(), 'viewer',  '普通员工', '普通查看权限',                 1, 4);

-- ================================================
-- 2. 为 users 表新增 role_id 字段（关联到 roles 表）
--    注意：保留原 role 字段，新旧字段共存过渡
-- ================================================
-- 检查 role_id 字段是否存在，不存在则添加
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role_id');

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE users ADD COLUMN role_id VARCHAR(36) DEFAULT NULL COMMENT ''角色ID（关联roles表）'' AFTER role',
  'SELECT ''role_id 字段已存在，跳过'' AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 添加索引
SET @idx_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND INDEX_NAME = 'idx_role_id');

SET @sql = IF(@idx_exists = 0,
  'ALTER TABLE users ADD INDEX idx_role_id (role_id)',
  'SELECT ''idx_role_id 索引已存在，跳过'' AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ================================================
-- 3. 根据原 role 字段值，更新 role_id 关联
-- ================================================
UPDATE users u
JOIN roles r ON r.code = u.role
SET u.role_id = r.id
WHERE u.role_id IS NULL;

-- ================================================
-- 4. 验证迁移结果
-- ================================================
SELECT 
  '角色迁移完成，当前用户角色分布：' AS message,
  u.role AS old_role,
  r.code AS new_role_code,
  r.name AS new_role_name,
  COUNT(*) AS user_count
FROM users u
LEFT JOIN roles r ON u.role_id = r.id
GROUP BY u.role, r.code, r.name
ORDER BY u.role;

SELECT '002_migrate_user_roles.sql 执行完成' AS message;
