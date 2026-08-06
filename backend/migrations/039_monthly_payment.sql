-- 039_monthly_payment.sql
-- 月结采购付款相关字段（幂等执行，可重复执行）
-- 使用 INFORMATION_SCHEMA 动态判断列是否存在，避免重复添加

-- monthly_pending: 月结待付款标记
SET @tablename = 'warehouse_purchases';
SET @columnname = 'monthly_pending';
SET @preparable = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname);
SET @sql = IF(@preparable = 0,
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, " TINYINT(1) DEFAULT 0 COMMENT '月结待付款标记'"),
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- monthly_payment_sp_no: 月结付款审批单号
SET @columnname = 'monthly_payment_sp_no';
SET @preparable = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname);
SET @sql = IF(@preparable = 0,
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, " VARCHAR(100) NULL COMMENT '月结付款审批单号'"),
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- monthly_paid_at: 月结付款完成时间
SET @columnname = 'monthly_paid_at';
SET @preparable = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname);
SET @sql = IF(@preparable = 0,
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, " DATETIME NULL COMMENT '月结付款完成时间'"),
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
