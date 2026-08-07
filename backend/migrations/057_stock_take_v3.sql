-- ================================================
-- 057 - 月末月结盘点功能增强
-- 兼容 MySQL 5.7/8.0，幂等可重复执行
-- 注意：stock_movements ENUM 已在 deploy.yml 中处理，此脚本不重复
-- ================================================

-- ================================================
-- 1. warehouses 表增加 enable_stock_take 字段
-- ================================================
SET @tablename = 'warehouses';
SET @columnname = 'enable_stock_take';
SET @preparable = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname);
SET @sql = IF(@preparable = 0,
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' TINYINT(1) DEFAULT 1 COMMENT ''是否参与月末盘点：1=是 0=否'' AFTER status'),
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ================================================
-- 2. stock_takes 表增加增强字段
-- ================================================

-- 2.1 take_no
SET @tablename = 'stock_takes';
SET @columnname = 'take_no';
SET @preparable = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname);
SET @sql = IF(@preparable = 0,
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' VARCHAR(50) NULL COMMENT ''盘点单号'' AFTER id'),
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2.2 period_month
SET @columnname = 'period_month';
SET @preparable = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname);
SET @sql = IF(@preparable = 0,
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' VARCHAR(7) NULL COMMENT ''成本归属月份 YYYY-MM'' AFTER warehouse_name'),
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2.3 access_token
SET @columnname = 'access_token';
SET @preparable = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname);
SET @sql = IF(@preparable = 0,
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' VARCHAR(64) NULL COMMENT ''盘点H5页面一次性访问token'' AFTER period_month'),
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2.4 access_expired_at
SET @columnname = 'access_expired_at';
SET @preparable = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname);
SET @sql = IF(@preparable = 0,
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' DATETIME NULL COMMENT ''token过期时间'' AFTER access_token'),
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2.5 operator_id
SET @columnname = 'operator_id';
SET @preparable = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname);
SET @sql = IF(@preparable = 0,
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' VARCHAR(36) NULL COMMENT ''盘点执行人users.id'' AFTER remark'),
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2.6 operator_name
SET @columnname = 'operator_name';
SET @preparable = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname);
SET @sql = IF(@preparable = 0,
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' VARCHAR(50) NULL COMMENT ''盘点执行人姓名'' AFTER operator_id'),
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2.7 operator_wecom_userid
SET @columnname = 'operator_wecom_userid';
SET @preparable = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname);
SET @sql = IF(@preparable = 0,
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' VARCHAR(100) NULL COMMENT ''执行人企微userid'' AFTER operator_name'),
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2.8 review_sample
SET @columnname = 'review_sample';
SET @preparable = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname);
SET @sql = IF(@preparable = 0,
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' JSON NULL COMMENT ''财务复核抽样5个+核验结果'' AFTER review_result'),
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2.9 notification_sent_at
SET @columnname = 'notification_sent_at';
SET @preparable = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname);
SET @sql = IF(@preparable = 0,
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' DATETIME NULL COMMENT ''最近一次通知时间'' AFTER reviewed_at'),
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ================================================
-- 3. stock_takes 表添加唯一索引
-- ================================================

-- 3.1 uk_take_no
SET @indexname = 'uk_take_no';
SET @preparable = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tablename AND INDEX_NAME = @indexname);
SET @sql = IF(@preparable = 0,
  CONCAT('ALTER TABLE ', @tablename, ' ADD UNIQUE KEY ', @indexname, ' (take_no)'),
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3.2 uk_access_token
SET @indexname = 'uk_access_token';
SET @preparable = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tablename AND INDEX_NAME = @indexname);
SET @sql = IF(@preparable = 0,
  CONCAT('ALTER TABLE ', @tablename, ' ADD UNIQUE KEY ', @indexname, ' (access_token)'),
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ================================================
-- 4. stock_take_notifications 通知记录表
-- ================================================
CREATE TABLE IF NOT EXISTS stock_take_notifications (
  id VARCHAR(36) PRIMARY KEY,
  stock_take_id VARCHAR(36) NOT NULL COMMENT '盘点单ID',
  warehouse_id VARCHAR(36) NOT NULL,
  recipient_wecom_userid VARCHAR(100) NOT NULL COMMENT '收件人企微userid',
  recipient_name VARCHAR(50) COMMENT '收件人姓名',
  type VARCHAR(20) NOT NULL COMMENT '通知类型:init/remind/submitted/returned/completed',
  channel VARCHAR(20) DEFAULT 'wecom_card' COMMENT '发送渠道',
  send_status VARCHAR(20) DEFAULT 'pending' COMMENT 'pending/sent/failed',
  fail_reason VARCHAR(500),
  sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_stock_take (stock_take_id),
  INDEX idx_recipient (recipient_wecom_userid),
  INDEX idx_sent_at (sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='盘点通知记录表';

SELECT '057_stock_take_v3.sql 执行完成' AS message;
