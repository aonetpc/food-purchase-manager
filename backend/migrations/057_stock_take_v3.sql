-- ================================================
-- 057 - 月末月结盘点功能增强
-- 1. warehouses 增加「参与月末盘点」开关
-- 2. stock_takes 增强字段：单号、归属月份、访问token、执行人、抽样复核
-- 3. 盘点通知记录表
-- 幂等执行：可重复执行不会报错
-- ================================================

-- 1. 仓库表增加盘点开关
ALTER TABLE warehouses
  ADD COLUMN IF NOT EXISTS enable_stock_take TINYINT(1) DEFAULT 1
  COMMENT '是否参与月末盘点：1=是 0=否' AFTER status;

-- 2. 盘点单表增强字段
ALTER TABLE stock_takes
  ADD COLUMN IF NOT EXISTS take_no VARCHAR(50) NULL COMMENT '盘点单号 ST-YYYYMMDD-序号' AFTER id,
  ADD COLUMN IF NOT EXISTS period_month VARCHAR(7) NULL COMMENT '成本归属月份 YYYY-MM' AFTER warehouse_name,
  ADD COLUMN IF NOT EXISTS access_token VARCHAR(64) NULL COMMENT '盘点H5页面一次性访问token' AFTER period_month,
  ADD COLUMN IF NOT EXISTS access_expired_at DATETIME NULL COMMENT 'token过期时间' AFTER access_token,
  ADD COLUMN IF NOT EXISTS operator_id VARCHAR(36) NULL COMMENT '盘点执行人users.id' AFTER remark,
  ADD COLUMN IF NOT EXISTS operator_name VARCHAR(50) NULL COMMENT '盘点执行人姓名' AFTER operator_id,
  ADD COLUMN IF NOT EXISTS operator_wecom_userid VARCHAR(100) NULL COMMENT '执行人企微userid' AFTER operator_name,
  ADD COLUMN IF NOT EXISTS review_sample JSON NULL COMMENT '财务复核抽样5个+核验结果' AFTER review_result,
  ADD COLUMN IF NOT EXISTS notification_sent_at DATETIME NULL COMMENT '最近一次通知时间' AFTER reviewed_at;

-- 唯一索引（幂等：先检查再创建）
SET @has_take_no_idx = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE table_schema = DATABASE() AND table_name = 'stock_takes' AND index_name = 'uk_take_no');
SET @sql_take_no = IF(@has_take_no_idx = 0, 'ALTER TABLE stock_takes ADD UNIQUE KEY uk_take_no (take_no)', 'SELECT 1');
PREPARE stmt FROM @sql_take_no;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_token_idx = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE table_schema = DATABASE() AND table_name = 'stock_takes' AND index_name = 'uk_access_token');
SET @sql_token = IF(@has_token_idx = 0, 'ALTER TABLE stock_takes ADD UNIQUE KEY uk_access_token (access_token)', 'SELECT 1');
PREPARE stmt FROM @sql_token;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3. 盘点通知记录表
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
) ENGINE=InnoDB DEFAULT CHARSET=utf4mb4 COMMENT='盘点通知记录表';

-- 4. 验证
SELECT '057_stock_take_v3.sql 执行完成' AS message;
