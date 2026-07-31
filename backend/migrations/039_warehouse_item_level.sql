-- ================================================
-- 039 - 仓库采购明细行级仓库 + 库存流水部门归集
-- 1. warehouse_purchase_items 新增 warehouse_id/warehouse_name（明细级仓库）
-- 2. warehouse_purchases.warehouse_id 改为可空（兼容旧数据，新单以明细行为准）
-- 3. stock_movements 新增 department_id/department_name（出库/盘点归集部门成本）
-- 兼容 MySQL 5.7/8.0（不使用 ADD COLUMN IF NOT EXISTS 语法）
-- ================================================

-- 1. 明细行加仓库字段（兼容 MySQL 5.7/8.0）
SET @dbname = DATABASE();

SET @tablename = 'warehouse_purchase_items';

SET @columnname = 'warehouse_id';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname
    AND table_name = @tablename
    AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' VARCHAR(36) NULL COMMENT "入库仓库ID（明细级）"')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @columnname = 'warehouse_name';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname
    AND table_name = @tablename
    AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' VARCHAR(100) NULL COMMENT "入库仓库名称"')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 为明细行仓库字段加索引
SET @indexname = 'idx_wpi_warehouse';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE table_schema = @dbname
    AND table_name = @tablename
    AND index_name = @indexname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD INDEX ', @indexname, ' (warehouse_id)')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 2. 采购单表头 warehouse_id 改为可空
SET @tablename = 'warehouse_purchases';

SET @columnname = 'warehouse_id';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname
    AND table_name = @tablename
    AND column_name = @columnname
    AND is_nullable = 'YES') > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' MODIFY COLUMN ', @columnname, ' VARCHAR(36) NULL COMMENT "已废弃，使用明细行的warehouse_id"')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @columnname = 'warehouse_name';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname
    AND table_name = @tablename
    AND column_name = @columnname
    AND is_nullable = 'YES') > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' MODIFY COLUMN ', @columnname, ' VARCHAR(100) NULL')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 3. 库存流水加部门归集字段
SET @tablename = 'stock_movements';

SET @columnname = 'department_id';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname
    AND table_name = @tablename
    AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' VARCHAR(36) NULL COMMENT "归集部门ID（出库/盘点必填）"')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @columnname = 'department_name';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname
    AND table_name = @tablename
    AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' VARCHAR(50) NULL COMMENT "归集部门名称"')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @indexname = 'idx_sm_department';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE table_schema = @dbname
    AND table_name = @tablename
    AND index_name = @indexname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD INDEX ', @indexname, ' (department_id)')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 4. 回填旧数据：将旧采购单表头仓库写入明细行
UPDATE warehouse_purchase_items wi
  INNER JOIN warehouse_purchases wp ON wi.purchase_id = wp.id
  SET wi.warehouse_id = wp.warehouse_id,
      wi.warehouse_name = wp.warehouse_name
  WHERE wi.warehouse_id IS NULL
    AND wp.warehouse_id IS NOT NULL;

SELECT '039_warehouse_item_level.sql 执行完成' AS message;
