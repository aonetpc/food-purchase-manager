-- ================================================
-- 058 - 盘点 P3 功能：签名、H5复核、分类盘点、卡片更新
-- 兼容 MySQL 5.7/8.0，幂等可重复执行
-- ================================================

-- ================================================
-- 1. stock_takes 表新增字段
-- ================================================
SET @tablename = 'stock_takes';

-- 1.1 take_type 盘点类型
SET @columnname = 'take_type';
SET @preparable = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname);
SET @sql = IF(@preparable = 0,
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' VARCHAR(20) DEFAULT ''monthly'' COMMENT ''盘点类型: monthly=月盘点(原材料) annual=年盘点(固定资产)'' AFTER period_month'),
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 1.2 operator_signature 盘点人签名
SET @columnname = 'operator_signature';
SET @preparable = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname);
SET @sql = IF(@preparable = 0,
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' TEXT NULL COMMENT ''盘点人签名(base64 PNG)'''),
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 1.3 reviewer_signature 财务签名
SET @columnname = 'reviewer_signature';
SET @preparable = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname);
SET @sql = IF(@preparable = 0,
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' TEXT NULL COMMENT ''财务复核签名(base64 PNG)'''),
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 1.4 reviewer_token 财务复核H5 token
SET @columnname = 'reviewer_token';
SET @preparable = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname);
SET @sql = IF(@preparable = 0,
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' VARCHAR(64) NULL COMMENT ''财务复核H5访问token'''),
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 1.5 reviewer_token_expired_at 财务token过期时间
SET @columnname = 'reviewer_token_expired_at';
SET @preparable = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname);
SET @sql = IF(@preparable = 0,
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' DATETIME NULL COMMENT ''财务复核token过期时间'''),
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ================================================
-- 2. stock_take_items 表新增字段
-- ================================================
SET @tablename = 'stock_take_items';

-- 2.1 category_l1_name 一级分类名
SET @columnname = 'category_l1_name';
SET @preparable = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname);
SET @sql = IF(@preparable = 0,
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' VARCHAR(50) NULL COMMENT ''一级分类名，用于原材料/固定资产区分'''),
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ================================================
-- 3. stock_take_notifications 表新增 response_code 字段
-- ================================================
SET @tablename = 'stock_take_notifications';

-- 3.1 response_code
SET @columnname = 'response_code';
SET @preparable = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname);
SET @sql = IF(@preparable = 0,
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' VARCHAR(100) NULL COMMENT ''企微卡片response_code，用于后续更新卡片按钮状态'''),
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
