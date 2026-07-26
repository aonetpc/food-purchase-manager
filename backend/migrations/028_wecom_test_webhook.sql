-- ================================================
-- 添加企业微信测试群机器人 Webhook URL 字段
-- 用于隔离生产群和测试群，便于开发新功能不影响现有流程
-- ================================================

-- 给 wecom_config 表添加 test_webhook_url 字段（如果不存在）
SET @dbname = DATABASE();
SET @tablename = 'wecom_config';
SET @columnname = 'test_webhook_url';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname
    AND table_name = @tablename
    AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' VARCHAR(500)')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;
