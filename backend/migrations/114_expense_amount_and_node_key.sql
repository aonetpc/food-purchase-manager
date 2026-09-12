-- ================================================
-- 114 - 费用支付监控：金额派生列 + 节点唯一键修复
--
-- 背景：
--   1. 列表查询用 control_type='Money' 过滤金额控件不可靠（模板可能不用 Money 控件），
--      导致金额全部为 0。解决方案：主表加 amount 派生列，同步时从表单解析写入。
--      这是计算列，原始表单数据仍在 wecom_expense_approval_forms 表，不算扁平化。
--   2. wecom_expense_approval_nodes 唯一键 (sp_no, node_index) 不支持会签/或签
--      多审批人场景，导致 Duplicate entry 错误。改为 (sp_no, node_index, approver_userid)。
--
-- 幂等执行：使用 INFORMATION_SCHEMA 动态判断
-- ================================================

SET @dbname = DATABASE();

-- 1. 主表加 amount 派生列（如果不存在）
SET @tablename = 'wecom_expense_approvals';
SET @columnname = 'amount';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' DECIMAL(12,2) DEFAULT 0 COMMENT ''支付金额（从表单解析的派生字段，原始数据仍在 forms 表）''')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 2. nodes 表唯一键修复：(sp_no, node_index) → (sp_no, node_index, approver_userid)
--    先删除旧唯一键（如果存在），再加新唯一键
SET @tablename = 'wecom_expense_approval_nodes';
SET @indexname = 'uk_sp_no_node';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE table_schema = @dbname AND table_name = @tablename AND index_name = @indexname) > 0,
  CONCAT('ALTER TABLE ', @tablename, ' DROP INDEX ', @indexname),
  'SELECT 1'
));
PREPARE dropIfExists FROM @preparedStatement;
EXECUTE dropIfExists;
DEALLOCATE PREPARE dropIfExists;

-- 加新唯一键（如果不存在）
SET @indexname = 'uk_sp_no_node_approver';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE table_schema = @dbname AND table_name = @tablename AND index_name = @indexname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD UNIQUE KEY ', @indexname, ' (sp_no, node_index, approver_userid)')
));
PREPARE addIfNotExists FROM @preparedStatement;
EXECUTE addIfNotExists;
DEALLOCATE PREPARE addIfNotExists;


-- 验证
SELECT '===== 114_expense_amount_and_node_key.sql 执行完成 =====' AS info;

SELECT '主表 amount 列：' AS info;
SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_DEFAULT, COLUMN_COMMENT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE table_schema = DATABASE() AND table_name = 'wecom_expense_approvals' AND COLUMN_NAME = 'amount';

SELECT 'nodes 表唯一键：' AS info;
SELECT INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX
FROM INFORMATION_SCHEMA.STATISTICS
WHERE table_schema = DATABASE() AND table_name = 'wecom_expense_approval_nodes'
  AND INDEX_NAME LIKE 'uk_%'
ORDER BY INDEX_NAME, SEQ_IN_INDEX;
