-- ================================================
-- 049 - 修复预付款相关缺失字段
-- 为 warehouse_purchases 表补齐 writeoff_amount、prepay_voucher_no、prepay_voucher_at
-- 幂等执行：可重复执行不会报错
-- ================================================

SET @dbname = DATABASE();
SET @tablename = 'warehouse_purchases';

-- writeoff_amount: 已核销金额
SET @columnname = 'writeoff_amount';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, " DECIMAL(12,2) DEFAULT 0 COMMENT '已核销金额'")
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- prepay_voucher_no: 预付款付款凭证号
SET @columnname = 'prepay_voucher_no';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, " VARCHAR(100) NULL COMMENT '预付款付款凭证号'")
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- prepay_voucher_at: 预付款付款凭证时间
SET @columnname = 'prepay_voucher_at';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, " DATETIME NULL COMMENT '预付款付款凭证时间'")
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SELECT '049_fix_missing_prepay_columns.sql 执行完成' AS message;
