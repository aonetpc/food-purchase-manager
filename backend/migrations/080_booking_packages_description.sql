-- ================================================
-- 080: 补 booking_packages.description 列（Phase 2 遗漏，幂等）
-- ================================================
SET @c = (SELECT IF(COUNT(*)=0,
  "ALTER TABLE booking_packages ADD COLUMN description TEXT NULL COMMENT '套餐说明/备注'",
  'SELECT 1')
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='booking_packages' AND COLUMN_NAME='description');
PREPARE stmt FROM @c; EXECUTE stmt; DEALLOCATE PREPARE stmt;
