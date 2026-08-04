-- ================================================
-- 050 - 合并物资品名与规格 + 清理重复项
-- 业务决策：不需要按品名归组统计，合并后简化匹配逻辑，为未来单位换算铺路
-- 幂等执行：可重复执行不会报错
-- 注意：不加数据库级 UNIQUE 约束（软删除记录会导致冲突），改由应用层查重保证
-- ================================================

-- 1. 合并历史数据：name = name + ' ' + spec
--    幂等判断：只在 spec 非空 且 name 不以 spec 结尾时合并（避免重复执行重复拼接）
UPDATE warehouse_items
SET name = CONCAT(name, ' ', spec)
WHERE spec IS NOT NULL
  AND spec != ''
  AND name NOT LIKE CONCAT('%', spec)
  AND status = 1;

-- 2. 清空 spec 字段（保留字段避免旧代码报错，但数据置空）
UPDATE warehouse_items
SET spec = ''
WHERE spec IS NOT NULL AND spec != '';

-- 3. 合并同名重复物资：保留 created_at 最早的一条，其余软删除（status=0）
--    为安全起见，仅停用重复项，不迁移库存/流水数据（管理员可后续手动合并）
UPDATE warehouse_items wi
JOIN (
  SELECT name, MIN(created_at) AS min_created
  FROM warehouse_items
  WHERE status = 1
  GROUP BY name
  HAVING COUNT(*) > 1
) dup ON wi.name = dup.name AND wi.created_at > dup.min_created
SET wi.status = 0;

SELECT CONCAT('050_merge_item_name_spec.sql 执行完成，剩余启用物资：', COUNT(*), ' 条') AS message
FROM warehouse_items WHERE status = 1;
