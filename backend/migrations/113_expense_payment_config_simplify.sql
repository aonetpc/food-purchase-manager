-- ================================================
-- 113 - 费用支付申请配置精简
--
-- 背景：
--   112 新增的 expense_payment_options / expense_payment_default 字段
--   在"费用支付监控（读取历史）"场景下无用——付款方式是审批单数据，
--   同步时从 apply_data.contents 解析，不需要在配置里预设选项。
--
-- 本迁移 DROP 这 2 个无用字段。expense_payment_applyer_userid 保留
-- （未来可能用于前端筛选默认值），暂不在前端配置卡片显示。
--
-- 幂等执行：使用 INFORMATION_SCHEMA 动态判断
-- ================================================

SET @dbname = DATABASE();
SET @tablename = 'wecom_config';

-- DROP expense_payment_options（如果存在）
SET @columnname = 'expense_payment_options';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  CONCAT('ALTER TABLE ', @tablename, ' DROP COLUMN ', @columnname),
  'SELECT 1'
));
PREPARE dropIfExists FROM @preparedStatement;
EXECUTE dropIfExists;
DEALLOCATE PREPARE dropIfExists;

-- DROP expense_payment_default（如果存在）
SET @columnname = 'expense_payment_default';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  CONCAT('ALTER TABLE ', @tablename, ' DROP COLUMN ', @columnname),
  'SELECT 1'
));
PREPARE dropIfExists FROM @preparedStatement;
EXECUTE dropIfExists;
DEALLOCATE PREPARE dropIfExists;

-- 验证
SELECT '===== 113_expense_payment_config_simplify.sql 执行完成 =====' AS info;
SELECT 'wecom_config 当前 expense 相关字段：' AS info;
SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_COMMENT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE table_schema = DATABASE() AND table_name = 'wecom_config'
  AND COLUMN_NAME LIKE 'expense_%';
