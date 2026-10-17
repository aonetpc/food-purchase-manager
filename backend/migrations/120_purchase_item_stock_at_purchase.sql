-- ================================================
-- 120 - 仓库采购明细：采购人申报的当前库存
--
-- 变更：
--   warehouse_purchase_items 新增 stock_at_purchase 字段
--     DECIMAL(12,3) NULL = 采购人下单时申报的当前库存（单位即该行申请单位）
--
-- 背景：
--   此前「当前库存」由系统按 warehouse_id + item_id 实时比对 inventory 派生，
--   存在两个硬伤：① 盘点每月底才校准，月中系统库存与真实库存有差异；
--   ② 未建档物资（item_id 为空）无法比对，显示「-」。
--   因此改为采购人手工填报（批量粘贴最后一列或明细行直接输入），随单存档，
--   供审批人直观判断；系统比对值不再作为数据源。
--
-- 说明：
--   - NULL = 未填报，老订单全部为 NULL，PDF/详情显示「-」，向后兼容
--   - 非必填，不做任何回填
--
-- 幂等：可重复执行不会报错
-- ================================================

SET @dbname = DATABASE();
SET @tablename = 'warehouse_purchase_items';

SET @columnname = 'stock_at_purchase';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE `', @tablename, '` ADD COLUMN `', @columnname, '` DECIMAL(12,3) NULL COMMENT "采购人申报的当前库存（单位即申请单位），NULL=未填报"')
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
