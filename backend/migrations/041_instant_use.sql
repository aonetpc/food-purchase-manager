-- ================================================
-- 041 - 即采即用物资支持
-- 1. warehouse_items 新增 instant_use 字段（物资库级别标记）
-- 2. warehouse_purchase_items 新增 instant_use_override 字段（采购明细行级别覆盖）
-- 兼容 MySQL 5.7/8.0
-- ================================================

SET @dbname = DATABASE();

-- 1. warehouse_items 表新增 instant_use 字段
SET @tablename = 'warehouse_items';
SET @columnname = 'instant_use';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname
    AND table_name = @tablename
    AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' TINYINT(1) DEFAULT 0 COMMENT "1=即采即用（入库后自动出库归零） 0=正常"')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 2. warehouse_purchase_items 表新增 instant_use_override 字段
SET @tablename = 'warehouse_purchase_items';
SET @columnname = 'instant_use_override';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname
    AND table_name = @tablename
    AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' TINYINT(1) DEFAULT NULL COMMENT "NULL=继承物资库设置 1=即采即用覆盖 0=正常覆盖"')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SELECT '041_instant_use.sql 执行完成' AS message;
