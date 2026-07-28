-- ================================================
-- 给 purchase_confirmations 表添加用户独立确认字段
-- 用于支持新流程：不同用户只确认自己负责部门的采购内容
-- ================================================

-- 给 purchase_confirmations 表添加 user_departments 字段（如果不存在）
-- JSON 格式：{ "wecom_userid": { "departments": ["部门1","部门2"], "response_code": "xxx" } }
SET @dbname = DATABASE();
SET @tablename = 'purchase_confirmations';
SET @columnname = 'user_departments';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname
    AND table_name = @tablename
    AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' JSON COMMENT ''用户负责的部门及response_code''')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 给 purchase_confirmations 表添加 user_confirmations 字段（如果不存在）
-- JSON 格式：{ "wecom_userid": { "confirmed": true, "confirmed_at": "2026-07-27 10:00:00", "confirmed_by": "张三", "departments": ["部门1"], "signature_data": "data:image/png;base64,xxx" } }
SET @columnname = 'user_confirmations';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname
    AND table_name = @tablename
    AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' JSON COMMENT ''用户确认记录''')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;
