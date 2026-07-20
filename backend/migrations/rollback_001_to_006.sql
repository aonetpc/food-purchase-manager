-- ================================================
-- 回滚脚本 - 回滚 001~006 全部迁移
-- ⚠️ 危险操作：执行前请确保已备份！
-- 建议优先使用备份恢复：mysql -u food_purchase -p food_purchase < backup_YYYYMMDD.sql
-- ================================================

-- ================================================
-- 1. 删除新增表（按依赖关系逆序）
-- ================================================
DROP TABLE IF EXISTS user_operation_logs;
DROP TABLE IF EXISTS wechat_config;
DROP TABLE IF EXISTS user_login_methods;
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS modules;
DROP TABLE IF EXISTS roles;
DROP TABLE IF EXISTS schema_migrations;

-- ================================================
-- 2. 删除 users 表新增字段
-- ================================================
-- 2.1 删除 role_id 字段
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role_id');

SET @sql = IF(@col_exists > 0,
  'ALTER TABLE users DROP COLUMN role_id',
  'SELECT ''role_id 字段不存在，跳过'' AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2.2 删除 status 字段
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'status');

SET @sql = IF(@col_exists > 0,
  'ALTER TABLE users DROP COLUMN status',
  'SELECT ''status 字段不存在，跳过'' AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2.3 删除 phone 字段
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'phone');

SET @sql = IF(@col_exists > 0,
  'ALTER TABLE users DROP COLUMN phone',
  'SELECT ''phone 字段不存在，跳过'' AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2.4 删除 department_id 字段
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'department_id');

SET @sql = IF(@col_exists > 0,
  'ALTER TABLE users DROP COLUMN department_id',
  'SELECT ''department_id 字段不存在，跳过'' AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2.5 删除 last_login_at 字段
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'last_login_at');

SET @sql = IF(@col_exists > 0,
  'ALTER TABLE users DROP COLUMN last_login_at',
  'SELECT ''last_login_at 字段不存在，跳过'' AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ================================================
-- 3. 验证回滚结果
-- ================================================
SELECT 
  TABLE_NAME 
FROM INFORMATION_SCHEMA.TABLES 
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY TABLE_NAME;

SELECT 
  COLUMN_NAME 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
ORDER BY ORDINAL_POSITION;

SELECT '回滚完成，users 表已恢复原结构' AS message;
SELECT '⚠️ 如数据异常，请使用备份恢复：mysql -u food_purchase -p food_purchase < backup_YYYYMMDD.sql' AS recovery_hint;
