-- ============================================================
-- 088: 房型计价模式 - 支持按间/按人两种计费方式
-- ============================================================

SET @dbname = DATABASE();
SET @tablename = 'booking_room_types';

-- 1. 新增 pricing_mode 字段（per_room=按间 per_person=按人）
SET @columnname = 'pricing_mode';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, " ENUM('per_room','per_person') NOT NULL DEFAULT 'per_room' COMMENT '计价方式 per_room按间/per_person按人' AFTER price")
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 2. 回填默认值（现有房型保持 per_room）
UPDATE booking_room_types SET pricing_mode = 'per_room' WHERE pricing_mode IS NULL OR pricing_mode = '';
