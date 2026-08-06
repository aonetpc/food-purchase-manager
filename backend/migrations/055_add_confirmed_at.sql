-- 055_add_confirmed_at.sql
-- 为 warehouse_purchases 表添加 confirmed_at 字段（确认完成时间）
-- 幂等执行，可重复执行

-- 添加 confirmed_at 字段
SET @tablename = 'warehouse_purchases';
SET @columnname = 'confirmed_at';
SET @preparable = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname);
SET @sql = IF(@preparable = 0,
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' DATETIME NULL COMMENT ''确认完成时间'' AFTER status'),
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 回填已确认记录的 confirmed_at（使用 updated_at 作为近似值）
UPDATE warehouse_purchases
SET confirmed_at = updated_at
WHERE status = 'confirmed' AND confirmed_at IS NULL;
