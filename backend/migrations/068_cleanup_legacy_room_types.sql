-- ============================================================
-- 068_cleanup_legacy_room_types.sql  —  删除 4 条旧房型
-- ============================================================

DELETE FROM booking_room_types
WHERE code IN ('standard', 'bigbed', 'suite', 'vipsuite');
