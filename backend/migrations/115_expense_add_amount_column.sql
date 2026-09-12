-- ================================================
-- 115 - 费用支付监控：补加 amount 列 + nodes 唯一键修复
--
-- 背景：
--   迁移 114 用了 PREPARE/EXECUTE 语法，被 migrate.js 按分号分割成碎片执行，
--   碎片语句报错被幂等错误忽略逻辑跳过，114 被标记为"已执行"但 amount 列从没添加。
--   fix/149 把 114 改为 IF NOT EXISTS 语法，但 schema_migrations 已记录 114，
--   migrate.js 直接跳过，所以 fix/149 部署后 amount 列仍不存在。
--
-- 解决方案：
--   新建迁移 115（新编号，schema_migrations 没记录过，会自动执行）
--   用简单 ALTER TABLE，不用 IF NOT EXISTS（靠 migrate.js 的幂等错误忽略处理）
--
-- migrate.js 的幂等错误忽略机制（expense-approvals.js 已验证）：
--   errno 1060 ER_DUP_FIELD_DATA  → 字段已存在，跳过
--   errno 1061 ER_DUP_KEYNAME     → 索引已存在，跳过
--   errno 1091 ER_CANT_DROP_FIELD_OR_KEY → 字段/索引不存在，跳过
-- ================================================

-- 1. 主表加 amount 派生列
ALTER TABLE wecom_expense_approvals
  ADD COLUMN amount DECIMAL(12,2) DEFAULT 0
  COMMENT '支付金额（从表单解析的派生字段，原始数据仍在 forms 表）';

-- 2. nodes 表唯一键修复：(sp_no, node_index) → (sp_no, node_index, approver_userid)
ALTER TABLE wecom_expense_approval_nodes
  DROP INDEX uk_sp_no_node;

ALTER TABLE wecom_expense_approval_nodes
  ADD UNIQUE KEY uk_sp_no_node_approver (sp_no, node_index, approver_userid);


-- 验证
SELECT '===== 115_expense_add_amount_column.sql 执行完成 =====' AS info;

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
