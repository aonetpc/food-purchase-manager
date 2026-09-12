-- ================================================
-- 112 - 费用支付监控：审批数据落库表 + wecom_config 扩展 + 新权限
--
-- 第二阶段 PR1：基础设施
--   1. wecom_config 新增 4 个字段（费用支付申请独立配置，不复用 approval_template_id）
--   2. 4 张表：主表 + 审批节点表 + 表单值表 + 财务支付表（规范化分表，非扁平）
--   3. 2 个新权限：menu:my-expense-summary + action:mark-expense-paid
--   4. admin 自动分配新权限（finance 由用户通过 RoleManager 自行勾选）
--
-- 幂等执行：可重复执行不会报错
-- ================================================

-- ================================================
-- 1. wecom_config 新增 4 字段（费用支付申请独立配置区域）
-- ================================================
-- expense_payment_template_id：费用支付申请审批模板ID
SET @dbname = DATABASE();
SET @tablename = 'wecom_config';
SET @columnname = 'expense_payment_template_id';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' VARCHAR(100) COMMENT ''费用支付申请审批模板ID''')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- expense_payment_applyer_userid：费用支付申请人UserID（兜底，未绑定企微时用）
SET @columnname = 'expense_payment_applyer_userid';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' VARCHAR(100) COMMENT ''费用支付申请人UserID（兜底）''')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- expense_payment_options：付款方式选项 JSON
SET @columnname = 'expense_payment_options';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' JSON COMMENT ''费用支付付款方式选项 [{label,value}]''')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- expense_payment_default：默认付款方式 value
SET @columnname = 'expense_payment_default';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' VARCHAR(50) COMMENT ''费用支付默认付款方式value''')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;


-- ================================================
-- 2. 费用支付审批主表：审批单基本信息 + 状态 + 同步管理
-- ================================================
CREATE TABLE IF NOT EXISTS wecom_expense_approvals (
  sp_no VARCHAR(50) PRIMARY KEY COMMENT '企微审批单号',
  template_id VARCHAR(100) COMMENT '审批模板ID',
  sp_name VARCHAR(100) COMMENT '审批申请名称',
  apply_time DATETIME COMMENT '申请提交时间',
  applyer_userid VARCHAR(100) COMMENT '申请人企微userid',
  applyer_name VARCHAR(100) COMMENT '申请人姓名（JOIN wecom_users 冗余）',
  sp_status TINYINT COMMENT '单据状态：1审批中/2已通过/3已驳回/4已撤销/6通过后撤销/7已删除/10已支付',
  sp_status_name VARCHAR(20) COMMENT '状态中文名（冗余便于查询）',
  raw_detail JSON COMMENT 'getapprovaldetail 完整返回（兜底，前端需要时再解析）',
  last_synced_at DATETIME COMMENT '最后一次刷新状态时间',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_apply_time (apply_time),
  INDEX idx_sp_status (sp_status),
  INDEX idx_applyer (applyer_userid),
  INDEX idx_template (template_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='费用支付审批主表';


-- ================================================
-- 3. 审批节点表（1:N）：记录每个审批节点的状态，is_current=1 标记当前待审节点
-- ================================================
CREATE TABLE IF NOT EXISTS wecom_expense_approval_nodes (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  sp_no VARCHAR(50) NOT NULL COMMENT '企微审批单号',
  node_index INT NOT NULL COMMENT '节点顺序（0开始）',
  node_type TINYINT COMMENT '1审批人/2抄送人/3办理人（来自process_list）',
  node_name VARCHAR(100) COMMENT '节点名称（如 部门经理审批）',
  approve_type TINYINT COMMENT '1或签/2会签/3依次审批',
  sp_status TINYINT COMMENT '1审批中/2已同意/3已驳回/4已转审/11已退回',
  approver_userid VARCHAR(100) COMMENT '审批人企微userid',
  approver_name VARCHAR(100) COMMENT '审批人姓名（JOIN wecom_users 冗余）',
  speech TEXT COMMENT '审批意见',
  approve_time DATETIME COMMENT '审批时间',
  is_current TINYINT DEFAULT 0 COMMENT '是否当前待审节点（1是/0否）★ 用于快速查询',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_sp_no_node (sp_no, node_index),
  INDEX idx_sp_no (sp_no),
  INDEX idx_is_current (is_current),
  FOREIGN KEY (sp_no) REFERENCES wecom_expense_approvals(sp_no) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='费用支付审批节点表';


-- ================================================
-- 4. 审批表单值表（1:N）：按控件类型存值，灵活适配不同模板
-- ================================================
CREATE TABLE IF NOT EXISTS wecom_expense_approval_forms (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  sp_no VARCHAR(50) NOT NULL COMMENT '企微审批单号',
  control_id VARCHAR(100) COMMENT '控件ID（如Money_xxx）',
  control_type VARCHAR(50) COMMENT '控件类型（Money/Text/Selector/BankAccount等）',
  control_title VARCHAR(100) COMMENT '控件名称（如 金额/付款事由/付款方式/收款账户）',
  control_value JSON COMMENT '控件值（Money存new_money，Selector存value，Text存text）',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_sp_no_control (sp_no, control_id),
  INDEX idx_sp_no (sp_no),
  INDEX idx_control_title (control_title),
  FOREIGN KEY (sp_no) REFERENCES wecom_expense_approvals(sp_no) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='费用支付审批表单值表';


-- ================================================
-- 5. 财务支付管理表（1:1）：独立的支付状态跟踪，与审批状态解耦
--    财务标记支付不影响审批同步
-- ================================================
CREATE TABLE IF NOT EXISTS wecom_expense_payments (
  sp_no VARCHAR(50) PRIMARY KEY COMMENT '企微审批单号',
  payment_status VARCHAR(20) DEFAULT 'unpaid' COMMENT 'unpaid未支付/paid已支付',
  paid_time DATETIME COMMENT '支付时间',
  paid_by_userid VARCHAR(100) COMMENT '操作人userid',
  paid_by_name VARCHAR(100) COMMENT '操作人姓名（冗余）',
  payment_remark VARCHAR(200) COMMENT '支付备注',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_payment_status (payment_status),
  FOREIGN KEY (sp_no) REFERENCES wecom_expense_approvals(sp_no) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='财务支付状态表';


-- ================================================
-- 6. 新增 2 个权限：我的报销 + 标记支付状态
-- ================================================
-- 权限1：我的报销（普通用户查自己的，不能标记支付）
INSERT IGNORE INTO permissions (id, module_id, code, name, type, parent_id, path, icon, sort_order, status) VALUES
  (UUID(), 'finance', 'menu:my-expense-summary', '我的报销', 'menu', NULL, '/finance/my-expense', 'Eye', 2, 1);

-- 补正 module_id（防止旧数据）
UPDATE permissions
SET module_id = 'finance', type = 'menu', status = 1
WHERE code = 'menu:my-expense-summary';

-- 权限2：标记支付状态（仅 finance/admin）
-- 注意：permissions.type 是 ENUM('menu','button','api')，不支持 'action'，用 'button' 代替
INSERT IGNORE INTO permissions (id, module_id, code, name, type, parent_id, path, icon, sort_order, status) VALUES
  (UUID(), 'finance', 'action:mark-expense-paid', '标记支付状态', 'button', NULL, NULL, 'Check', 3, 1);

-- 补正
UPDATE permissions
SET module_id = 'finance', type = 'button', status = 1
WHERE code = 'action:mark-expense-paid';


-- ================================================
-- 7. 给 admin 自动分配 2 个新权限
--    （finance 角色不分配，由用户通过 RoleManager 自行勾选验证增减）
-- ================================================
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'admin'
  AND p.code IN ('menu:my-expense-summary', 'action:mark-expense-paid');


-- ================================================
-- 8. 验证
-- ================================================
SELECT '===== 112_wecom_expense_approvals.sql 执行完成 =====' AS info;

SELECT 'wecom_config 新增字段：' AS info;
SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_COMMENT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE table_schema = DATABASE() AND table_name = 'wecom_config'
  AND COLUMN_NAME IN ('expense_payment_template_id', 'expense_payment_applyer_userid', 'expense_payment_options', 'expense_payment_default');

SELECT '4 张表：' AS info;
SELECT TABLE_NAME, TABLE_COMMENT
FROM INFORMATION_SCHEMA.TABLES
WHERE table_schema = DATABASE()
  AND TABLE_NAME IN ('wecom_expense_approvals', 'wecom_expense_approval_nodes', 'wecom_expense_approval_forms', 'wecom_expense_payments');

SELECT '2 个新权限：' AS info;
SELECT id, code, name, type, path, module_id, status
FROM permissions
WHERE code IN ('menu:my-expense-summary', 'action:mark-expense-paid');

SELECT 'admin 角色新权限分配：' AS info;
SELECT r.code AS role_code, p.code AS permission_code
FROM role_permissions rp
JOIN roles r ON rp.role_id = r.id
JOIN permissions p ON rp.permission_id = p.id
WHERE p.code IN ('menu:my-expense-summary', 'action:mark-expense-paid');
