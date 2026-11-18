-- 123 - 仓库采购退货单增加退货日期
-- 数据零影响原则：
--   1. 只加字段，允许 NULL，不做任何 UPDATE 回填
--   2. 应用层在创建退货单时写入日期，未传时默认当天；历史记录保持 NULL 不受影响
-- 说明：为兼容 MySQL 5.7/8.0，不使用 DEFAULT (CURRENT_DATE) 表达式默认值

SET @dbname = DATABASE();
SET @tablename = 'warehouse_purchase_returns';

SET @columnname = 'return_date';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, " DATE NULL COMMENT '退货日期（应用层默认当天，不允许未来日期）'")
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;
