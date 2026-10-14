-- ================================================
-- 119 - 预订审批流程：并行审批模式开关
--
-- 变更：
--   wecom_config 新增 booking_flow_mode 字段
--     'serial'   = 串行（现行：提交 → 销售员确认 → 审核员审核）——默认值，兼容旧流程
--     'parallel' = 并行（提交后销售员与审核员同时收到待办，任一方驳回则全单退回重走）
--
-- 说明：
--   - 默认 'serial'，即开关默认关闭，行为与改动前完全一致，可随时回退
--   - 仅影响此后新建/提交的订单；处于旧状态(sales_confirming/reviewing)的在途订单仍走旧逻辑
--
-- 幂等：可重复执行不会报错
-- ================================================

SET @dbname = DATABASE();
SET @tablename = 'wecom_config';

SET @columnname = 'booking_flow_mode';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE `', @tablename, '` ADD COLUMN `', @columnname, '` VARCHAR(20) NOT NULL DEFAULT ''serial'' COMMENT "预订审批流程模式 serial=串行 parallel=并行"')
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
