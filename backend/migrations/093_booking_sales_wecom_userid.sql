-- ================================================
-- 093 - 预订订单：存储销售员企微userid
--
-- 变更：
--   booking_orders 表新增 sales_wecom_userid 字段
--   创建/更新订单时，将销售员的 wecom_userid 存入订单
--   发通知时直接使用订单内已存的 wecom_userid，不再查 users 表
--
-- 幂等：可重复执行不会报错
-- ================================================

SET @dbname = DATABASE();
SET @tablename = 'booking_orders';

SET @columnname = 'sales_wecom_userid';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE `', @tablename, '` ADD COLUMN `', @columnname, '` VARCHAR(100) NULL COMMENT "销售员企微userid（下单时快照）"')
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
