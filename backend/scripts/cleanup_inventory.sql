-- ================================================
-- 方案 A：清空库存数据（保留物资档案）
-- 操作：
--   1. 将所有 inventory 表中的库存数量归零
--   2. 删除 stock_movements 中的出入库流水记录
-- 保留：物资档案、采购单、分类、仓库
-- 执行前请备份数据库！
-- ================================================

-- Step 0: 查看当前数据（执行前先确认）
SELECT '=== 库存表(inventory) 统计 ===' AS info;
SELECT COUNT(*) AS total_records FROM inventory;
SELECT SUM(quantity) AS total_quantity FROM inventory WHERE quantity > 0;

SELECT '=== 出入库流水表(stock_movements) 统计 ===' AS info;
SELECT COUNT(*) AS total_records FROM stock_movements;

-- Step 1: 将 inventory 表中所有库存数量归零
UPDATE inventory
SET quantity = 0,
    updated_at = NOW();

SELECT CONCAT('已更新 ', ROW_COUNT(), ' 条库存记录为 0') AS result;

-- Step 2: 删除所有出入库流水记录
DELETE FROM stock_movements;

SELECT CONCAT('已删除 ', ROW_COUNT(), ' 条出入库流水记录') AS result;

-- Step 3: 验证结果
SELECT '=== 清空后验证 ===' AS info;
SELECT COUNT(*) AS inventory_records, SUM(quantity) AS remaining_quantity FROM inventory;
SELECT COUNT(*) AS stock_movements_records FROM stock_movements;

SELECT '=== 物资档案保留（status=1 的物资）===' AS info;
SELECT id, name, category_id, unit, reference_price, status FROM warehouse_items WHERE status = 1 ORDER BY name;

SELECT '=== 清理完成 ===' AS info;
