-- ============================================================
-- 070_fix_legacy_lodging_type.sql — 修复历史订单中的旧房型编码
--
-- 068 已删除了 standard/bigbed/suite/vipsuite 四条旧房型记录，
-- 但历史订单的 booking_items.extra.lodgingType 中仍可能存储着旧编码。
-- 此迁移将旧编码映射为最接近的新 RM 编码。
--
-- 映射关系：
--   standard → RM001 （【稻香楼】标准大床房）
--   bigbed   → RM003 （【稻香楼】稻香山林大床房）
--   suite    → RM012 （竹風别墅大床房）
--   vipsuite → RM016 （湖畔别墅）
-- ============================================================

-- standard → RM001
UPDATE booking_items
SET extra = JSON_SET(extra, '$.lodgingType', 'RM001')
WHERE JSON_UNQUOTE(JSON_EXTRACT(extra, '$.lodgingType')) = 'standard';

-- bigbed → RM003
UPDATE booking_items
SET extra = JSON_SET(extra, '$.lodgingType', 'RM003')
WHERE JSON_UNQUOTE(JSON_EXTRACT(extra, '$.lodgingType')) = 'bigbed';

-- suite → RM012
UPDATE booking_items
SET extra = JSON_SET(extra, '$.lodgingType', 'RM012')
WHERE JSON_UNQUOTE(JSON_EXTRACT(extra, '$.lodgingType')) = 'suite';

-- vipsuite → RM016
UPDATE booking_items
SET extra = JSON_SET(extra, '$.lodgingType', 'RM016')
WHERE JSON_UNQUOTE(JSON_EXTRACT(extra, '$.lodgingType')) = 'vipsuite';

-- 验证：确认不再有旧编码
SELECT '===== 070 修复后检查 =====' AS info;
SELECT id, order_id, JSON_UNQUOTE(JSON_EXTRACT(extra, '$.lodgingType')) AS lodging_type
FROM booking_items
WHERE item_type = 'lodging'
  AND JSON_UNQUOTE(JSON_EXTRACT(extra, '$.lodgingType')) IN ('standard', 'bigbed', 'suite', 'vipsuite');
