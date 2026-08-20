-- ================================================
-- 087: 修复 booking_package_items 唯一索引冲突
--
-- 问题：
--   旧索引 uk_package_item (package_id, item_id) 不允许同一项目在不同角色下重复
--   新索引 uk_pkg_role_item (package_id, role, item_id) 允许同一项目在不同角色下各一条
--   当公共项目被角色排除后，需要拆分为多个角色的项目记录，此时旧索引会冲突
--
-- 修复：
--   1. 删除旧的唯一索引 uk_package_item
--   2. 确保新的唯一索引 uk_pkg_role_item 存在
--
-- 幂等执行：可重复运行不会报错
-- ================================================

-- 1. 删除旧的唯一索引 uk_package_item（如果存在）
SET @drop_idx = (SELECT IF(COUNT(*)=0,
  'SELECT 1',
  'ALTER TABLE booking_package_items DROP INDEX uk_package_item'
)
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='booking_package_items' AND INDEX_NAME='uk_package_item';
PREPARE stmt FROM @drop_idx; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. 确保新的唯一索引 uk_pkg_role_item 存在（允许同项目在不同角色下各一条）
SET @add_idx = (SELECT IF(COUNT(*)=0,
  "ALTER TABLE booking_package_items ADD UNIQUE INDEX uk_pkg_role_item (package_id, role, item_id)",
  'SELECT 1')
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='booking_package_items' AND INDEX_NAME='uk_pkg_role_item';
PREPARE stmt FROM @add_idx; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. 验证索引状态
SELECT '===== 087_fix_booking_package_items_unique_index.sql 执行完成 =====' AS info;
SHOW INDEX FROM booking_package_items WHERE Non_unique = 0;
