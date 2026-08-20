-- ================================================
-- 087: 修复 booking_package_items 唯一索引冲突
--
-- 问题：
--   旧索引 uk_package_item (package_id, item_id) 不允许同一项目在不同角色下重复
--   新索引 uk_pkg_role_item (package_id, role, item_id) 允许同一项目在不同角色下各一条
--
-- 修复：删除旧的唯一索引
-- 说明：如果索引不存在，会报错但不影响后续步骤（--force 模式）
-- ================================================

-- 1. 先尝试直接删除旧索引（如果存在）
ALTER TABLE booking_package_items DROP INDEX uk_package_item;

-- 2. 确保新索引 uk_pkg_role_item 存在
-- 如果已存在则会报错，使用 IGNORE 忽略
ALTER TABLE booking_package_items ADD UNIQUE INDEX uk_pkg_role_item (package_id, role, item_id);
