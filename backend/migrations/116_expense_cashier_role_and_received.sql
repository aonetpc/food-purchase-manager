-- 116: 新建出纳角色 + payments 表加"已收到"字段
-- 出纳角色不分配任何权限，由用户在 RoleManager 自行分配（功能验证）
-- received 字段用于我的报销页"已收到"对账

-- 1. 新建"出纳"角色（roles 表无 status 字段，用 is_system=0 表示非系统内置）
INSERT IGNORE INTO roles (id, code, name, description, sort_order, is_system)
VALUES (UUID(), 'cashier', '出纳', '可标记费用支付状态，其他财务人员只能查看', 15, 0);

-- 2. wecom_expense_payments 表加"已收到"字段
ALTER TABLE wecom_expense_payments
  ADD COLUMN received_status VARCHAR(20) DEFAULT 'unreceived' COMMENT 'unreceived未收到/received已收到',
  ADD COLUMN received_time DATETIME,
  ADD COLUMN received_by_userid VARCHAR(100),
  ADD COLUMN received_by_name VARCHAR(100);
