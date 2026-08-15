-- ============================================================
-- 073: 康乐项目扩展 - 套餐计费 + 入住/不住宿双档价
-- ============================================================

-- 1. 新增字段（幂等，已存在则跳过）
-- 计费模式：per_hour=按小时 / package=套餐一口价
SET @dbname = DATABASE();
SET @tablename = 'booking_wellness_types';

SET @columnname = 'pricing_mode';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, " ENUM('per_hour','package') NOT NULL DEFAULT 'per_hour' COMMENT '计费模式 per_hour按小时/package套餐一口价' AFTER name")
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @columnname = 'package_hours';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' INT NOT NULL DEFAULT 0 COMMENT "套餐时长（小时，package模式用）" AFTER min_hours')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @columnname = 'price_guest';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT "入住客人价" AFTER price')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @columnname = 'price_external';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT "不住宿客人价" AFTER price_guest')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @columnname = 'time_window';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' VARCHAR(20) NULL COMMENT "时段说明 如06:00-18:00（仅展示）" AFTER price_external')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 2. 回填默认数据：现有项目按入住/不住宿同价（沿用 price 字段），pricing_mode=per_hour
UPDATE booking_wellness_types SET pricing_mode = 'per_hour' WHERE pricing_mode IS NULL OR pricing_mode = '';
UPDATE booking_wellness_types SET price_guest = price WHERE price_guest = 0 AND price > 0;
UPDATE booking_wellness_types SET price_external = price WHERE price_external = 0 AND price > 0;

-- 3. 升级4个核心收费项目为套餐模式（按业务规则）
-- 棋牌：4小时套餐，入住200/不住宿250
UPDATE booking_wellness_types SET
  pricing_mode = 'package',
  package_hours = 4,
  price_guest = 200,
  price_external = 250
WHERE code = 'mahjong';

-- 钓鱼：套餐（时段06:00-18:00），入住200/不住宿250
UPDATE booking_wellness_types SET
  pricing_mode = 'package',
  package_hours = 12,
  price_guest = 200,
  price_external = 250,
  time_window = '06:00-18:00'
WHERE code = 'fishing';

-- KTV：原 ktv 升级为大包 688元/3小时
UPDATE booking_wellness_types SET
  pricing_mode = 'package',
  package_hours = 3,
  price_guest = 688,
  price_external = 688,
  name = 'KTV大包'
WHERE code = 'ktv';

-- 4. 新增 KTV小包（code=ktv_small），如不存在则插入
INSERT IGNORE INTO booking_wellness_types (id, code, name, min_hours, package_hours, price, price_guest, price_external, time_window, pricing_mode, is_free, status, sort_order)
SELECT UUID(), 'ktv_small', 'KTV小包', 0, 3, 488, 488, 488, NULL, 'package', 0, 1, 4
FROM dual
WHERE NOT EXISTS (SELECT 1 FROM booking_wellness_types WHERE code = 'ktv_small');

-- 5. 调整 KTV大包 排序
UPDATE booking_wellness_types SET sort_order = 3 WHERE code = 'ktv';
