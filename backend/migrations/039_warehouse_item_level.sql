-- ================================================
-- 039 - 仓库采购明细行级仓库 + 库存流水部门归集
-- 1. warehouse_purchase_items 新增 warehouse_id/warehouse_name（明细级仓库）
-- 2. warehouse_purchases.warehouse_id 改为可空（兼容旧数据，新单以明细行为准）
-- 3. stock_movements 新增 department_id/department_name（出库/盘点归集部门成本）
-- 幂等执行：可重复执行不会报错
-- ================================================

-- 1. 明细行加仓库字段
ALTER TABLE warehouse_purchase_items
  ADD COLUMN IF NOT EXISTS warehouse_id VARCHAR(36) NULL COMMENT '入库仓库ID（明细级）',
  ADD COLUMN IF NOT EXISTS warehouse_name VARCHAR(100) NULL COMMENT '入库仓库名称';

-- 为明细行仓库字段加索引
-- MySQL 不支持 IF NOT EXISTS 于 ADD INDEX，用存储过程兼容
DROP PROCEDURE IF EXISTS proc_add_idx_039;
DELIMITER $$
CREATE PROCEDURE proc_add_idx_039()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'warehouse_purchase_items'
      AND index_name = 'idx_wpi_warehouse'
  ) THEN
    ALTER TABLE warehouse_purchase_items ADD INDEX idx_wpi_warehouse (warehouse_id);
  END IF;
END$$
DELIMITER ;
CALL proc_add_idx_039();
DROP PROCEDURE IF EXISTS proc_add_idx_039;

-- 2. 采购单表头 warehouse_id 改为可空
ALTER TABLE warehouse_purchases
  MODIFY COLUMN warehouse_id VARCHAR(36) NULL COMMENT '已废弃，使用明细行的warehouse_id';

-- 3. 库存流水加部门归集字段
ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS department_id VARCHAR(36) NULL COMMENT '归集部门ID（出库/盘点必填）',
  ADD COLUMN IF NOT EXISTS department_name VARCHAR(50) NULL COMMENT '归集部门名称';

DROP PROCEDURE IF EXISTS proc_add_idx_039b;
DELIMITER $$
CREATE PROCEDURE proc_add_idx_039b()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'stock_movements'
      AND index_name = 'idx_sm_department'
  ) THEN
    ALTER TABLE stock_movements ADD INDEX idx_sm_department (department_id);
  END IF;
END$$
DELIMITER ;
CALL proc_add_idx_039b();
DROP PROCEDURE IF EXISTS proc_add_idx_039b;

-- 4. 回填旧数据：将旧采购单表头仓库写入明细行
UPDATE warehouse_purchase_items wi
  INNER JOIN warehouse_purchases wp ON wi.purchase_id = wp.id
  SET wi.warehouse_id = wp.warehouse_id,
      wi.warehouse_name = wp.warehouse_name
  WHERE wi.warehouse_id IS NULL
    AND wp.warehouse_id IS NOT NULL;

SELECT '039_warehouse_item_level.sql 执行完成' AS message;
