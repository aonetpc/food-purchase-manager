-- ================================================
-- 企业微信测试消息表新增用户独立确认字段
-- 用于支持新流程：不同用户只确认自己负责部门的采购内容
-- ================================================

-- 给 wecom_test_messages 表添加 user_confirmations 字段（如果不存在）
-- JSON 格式：{ "wecom_userid": { "departments": ["部门1","部门2"], "confirmed": true, "confirmed_at": "2026-07-27 10:00:00", "signature_data": "data:image/png;base64,xxx" } }
SET @dbname = DATABASE();
SET @tablename = 'wecom_test_messages';
SET @columnname = 'user_confirmations';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname
    AND table_name = @tablename
    AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' JSON')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 给 wecom_test_messages 表添加 user_departments 字段（如果不存在）
-- JSON 格式：{ "wecom_userid": ["部门1","部门2"] }，记录每个用户负责哪些部门
SET @columnname = 'user_departments';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname
    AND table_name = @tablename
    AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' JSON')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;
