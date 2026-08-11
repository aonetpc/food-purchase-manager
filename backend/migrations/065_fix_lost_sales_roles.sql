-- ================================================
-- 065 - 修复被迁移021/023错误清除的sales角色数据
--
-- 原因：迁移021和023之前使用 DELETE + INSERT 方式修复timyan角色，
--       每次部署都会删除timyan通过UI分配的sales角色。
--       现已改为 INSERT IGNORE（幂等），此迁移用于恢复已丢失的数据。
--
-- 幂等执行：可重复运行不会报错
-- ================================================

-- 1. 恢复 users.role='sales' 但 user_roles 中缺失记录的用户
INSERT IGNORE INTO user_roles (id, user_id, role_id)
SELECT UUID(), u.id, r.id
FROM users u
JOIN roles r ON r.code = 'sales'
WHERE u.role = 'sales'
  AND u.status = 1
  AND NOT EXISTS (
    SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_id = r.id
  );

-- 2. 恢复 users.role_id 指向 sales 角色但 user_roles 中缺失记录的用户
INSERT IGNORE INTO user_roles (id, user_id, role_id)
SELECT UUID(), u.id, u.role_id
FROM users u
JOIN roles r ON r.id = u.role_id AND r.code = 'sales'
WHERE u.role_id IS NOT NULL
  AND u.status = 1
  AND NOT EXISTS (
    SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_id = u.role_id
  );

-- 3. 验证：查看当前所有 sales 角色用户
SELECT '===== 065: sales 角色用户验证 =====' AS info;
SELECT u.id, u.username, u.name, u.role, u.status,
       r.code AS role_code, r.name AS role_name
FROM users u
JOIN user_roles ur ON ur.user_id = u.id
JOIN roles r ON r.id = ur.role_id
WHERE r.code = 'sales'
ORDER BY u.name ASC;

SELECT '065_fix_lost_sales_roles.sql 执行完成' AS message;
