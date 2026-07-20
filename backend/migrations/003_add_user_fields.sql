-- ================================================
-- 003 - 用户表扩展字段
-- 新增 status / phone / department_id / last_login_at 字段
-- 幂等执行：可重复执行不会报错
-- ================================================

-- ================================================
-- 1. 新增 status 字段（用户状态：1启用 0禁用）
-- ================================================
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'status');

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE users ADD COLUMN status TINYINT DEFAULT 1 COMMENT ''状态：1启用 0禁用'' AFTER role_id',
  'SELECT ''status 字段已存在，跳过'' AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND INDEX_NAME = 'idx_status');

SET @sql = IF(@idx_exists = 0,
  'ALTER TABLE users ADD INDEX idx_status (status)',
  'SELECT ''idx_status 索引已存在，跳过'' AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ================================================
-- 2. 新增 phone 字段（手机号）
-- ================================================
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'phone');

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE users ADD COLUMN phone VARCHAR(20) DEFAULT NULL COMMENT ''手机号'' AFTER name',
  'SELECT ''phone 字段已存在，跳过'' AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ================================================
-- 3. 新增 department_id 字段（所属部门）
-- ================================================
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'department_id');

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE users ADD COLUMN department_id VARCHAR(36) DEFAULT NULL COMMENT ''所属部门ID'' AFTER phone',
  'SELECT ''department_id 字段已存在，跳过'' AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ================================================
-- 4. 新增 last_login_at 字段（最后登录时间）
-- ================================================
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'last_login_at');

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE users ADD COLUMN last_login_at DATETIME DEFAULT NULL COMMENT ''最后登录时间'' AFTER status',
  'SELECT ''last_login_at 字段已存在，跳过'' AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ================================================
-- 5. 给所有现有用户补全 status = 1（确保已迁移用户可用）
-- ================================================
UPDATE users SET status = 1 WHERE status IS NULL;

-- ================================================
-- 6. 验证字段
-- ================================================
SELECT 
  COLUMN_NAME, 
  DATA_TYPE, 
  COLUMN_COMMENT 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
ORDER BY ORDINAL_POSITION;

SELECT '003_add_user_fields.sql 执行完成' AS message;
