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
-- 兼容性：MySQL 8.0+ 支持 IF NOT EXISTS 语法（服务器版本 8.0.46 已确认）
-- 幂等性：IF NOT EXISTS 让迁移可重复执行不报错
-- ================================================

-- 1. 主表加 amount 派生列（如果不存在）
ALTER TABLE wecom_expense_approvals
  ADD COLUMN IF NOT EXISTS amount DECIMAL(12,2) DEFAULT 0
  COMMENT '支付金额（从表单解析的派生字段，原始数据仍在 forms 表）';

-- 2. nodes 表唯一键修复：(sp_no, node_index) → (sp_no, node_index, approver_userid)
--    先删除旧唯一键（如果存在）
ALTER TABLE wecom_expense_approval_nodes
  DROP INDEX IF EXISTS uk_sp_no_node;

--    加新唯一键（如果不存在）
ALTER TABLE wecom_expense_approval_nodes
  ADD UNIQUE KEY IF NOT EXISTS uk_sp_no_node_approver
  (sp_no, node_index, approver_userid);


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
