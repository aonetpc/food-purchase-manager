-- ================================================
-- 092 - 预订审批流程：两级审批 + 企微通知配置
--
-- 变更：
--   1. booking_orders 表新增 sales_confirmed_at / sales_confirmed_by 字段
--   2. wecom_config 表新增预订群 Webhook + 通知开关字段
--   3. booking_config 表新增固定审核人字段（或复用 wecom_config）
--
-- 幂等：可重复执行不会报错
-- ================================================

-- ================================================
-- 1. booking_orders 新增销售员确认相关字段
-- ================================================
SET @dbname = DATABASE();
SET @tablename = 'booking_orders';

-- sales_confirmed_at：销售员确认时间
SET @columnname = 'sales_confirmed_at';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE `', @tablename, '` ADD COLUMN `', @columnname, '` DATETIME NULL COMMENT "销售员确认时间"')
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- sales_confirmed_by：销售员确认人ID
SET @columnname = 'sales_confirmed_by';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE `', @tablename, '` ADD COLUMN `', @columnname, '` VARCHAR(36) NULL COMMENT "销售员确认人ID"')
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- sales_confirmed_by_name：销售员确认人姓名
SET @columnname = 'sales_confirmed_by_name';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE `', @tablename, '` ADD COLUMN `', @columnname, '` VARCHAR(100) NULL COMMENT "销售员确认人姓名"')
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ================================================
-- 2. wecom_config 新增预订审批通知配置字段
-- ================================================
SET @tablename = 'wecom_config';

-- booking_webhook_url：预订群机器人 Webhook URL
SET @columnname = 'booking_webhook_url';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE `', @tablename, '` ADD COLUMN `', @columnname, '` VARCHAR(500) NULL COMMENT "预订群机器人Webhook URL"')
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- booking_notify_submit：提交时通知预订群
SET @columnname = 'booking_notify_submit';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE `', @tablename, '` ADD COLUMN `', @columnname, '` TINYINT(1) NOT NULL DEFAULT 1 COMMENT "提交时通知预订群"')
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- booking_notify_sales：提交时通知销售员
SET @columnname = 'booking_notify_sales';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE `', @tablename, '` ADD COLUMN `', @columnname, '` TINYINT(1) NOT NULL DEFAULT 1 COMMENT "提交时通知销售员"')
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- booking_notify_approve：审核通过时通知预订群
SET @columnname = 'booking_notify_approve';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE `', @tablename, '` ADD COLUMN `', @columnname, '` TINYINT(1) NOT NULL DEFAULT 1 COMMENT "审核通过时通知预订群"')
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- booking_notify_reject：驳回时通知销售员
SET @columnname = 'booking_notify_reject';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE `', @tablename, '` ADD COLUMN `', @columnname, '` TINYINT(1) NOT NULL DEFAULT 1 COMMENT "驳回时通知销售员"')
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- booking_approver_userid：固定审核员企微userid
SET @columnname = 'booking_approver_userid';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE `', @tablename, '` ADD COLUMN `', @columnname, '` VARCHAR(100) NULL COMMENT "固定审核员企微userid"')
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- booking_approver_name：固定审核员姓名
SET @columnname = 'booking_approver_name';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE `', @tablename, '` ADD COLUMN `', @columnname, '` VARCHAR(100) NULL COMMENT "固定审核员姓名"')
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
