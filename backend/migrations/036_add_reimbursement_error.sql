-- ================================================
-- 036 - 给 purchase_confirmations 表添加报销错误信息字段
-- 用于保存自动发起报销失败时的错误信息，便于排查
-- 幂等执行
-- ================================================

SET @dbname = DATABASE();
SET @tablename = 'purchase_confirmations';
SET @columnname = 'reimbursement_error';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname
    AND table_name = @tablename
    AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' TEXT COMMENT ''报销审批发起失败错误信息''')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SELECT '036_add_reimbursement_error.sql 执行完成' AS message;
