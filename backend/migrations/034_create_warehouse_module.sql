-- ================================================
-- 034 - 仓库管理模块
-- 创建仓库体系、物资分类、采购流程、盘点等10张表
-- 新增 purchaser 角色 + 仓库模块权限 + 角色权限分配
-- 幂等执行：可重复执行不会报错
-- ================================================

-- ================================================
-- 1. 仓库物资三级分类表
-- ================================================
CREATE TABLE IF NOT EXISTS warehouse_categories (
  id VARCHAR(36) PRIMARY KEY,
  parent_id VARCHAR(36) DEFAULT NULL COMMENT '父分类ID，NULL=一级分类',
  level TINYINT NOT NULL DEFAULT 1 COMMENT '层级：1=一级 2=二级 3=三级',
  name VARCHAR(50) NOT NULL COMMENT '分类名称',
  code VARCHAR(50) COMMENT '分类编码',
  full_path VARCHAR(200) COMMENT '完整路径，如"清洁用品/日常清洁/洗洁精"',
  sort_order INT DEFAULT 0,
  status TINYINT DEFAULT 1 COMMENT '1=启用 0=禁用',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_parent (parent_id),
  INDEX idx_level (level),
  INDEX idx_sort (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='仓库物资三级分类表';

-- ================================================
-- 2. 仓库物资库表（SKU）
-- ================================================
CREATE TABLE IF NOT EXISTS warehouse_items (
  id VARCHAR(36) PRIMARY KEY,
  category_id VARCHAR(36) COMMENT '三级分类ID',
  name VARCHAR(100) NOT NULL COMMENT '物资名称',
  sku VARCHAR(50) COMMENT '物资编码',
  spec VARCHAR(100) COMMENT '规格',
  unit VARCHAR(20) NOT NULL DEFAULT '个' COMMENT '基本单位',
  reference_price DECIMAL(10,2) DEFAULT 0 COMMENT '参考单价',
  status TINYINT DEFAULT 1 COMMENT '1=启用 0=停用',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_category (category_id),
  INDEX idx_name (name),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='仓库物资库表';

-- ================================================
-- 3. 仓库表
-- ================================================
CREATE TABLE IF NOT EXISTS warehouses (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(100) NOT NULL COMMENT '仓库名称',
  code VARCHAR(50) COMMENT '仓库编码',
  type ENUM('main','dept','boss') NOT NULL DEFAULT 'dept' COMMENT '类型：main=总仓 dept=部门仓 boss=老板仓',
  department_id VARCHAR(36) COMMENT '绑定的部门ID（type=dept时必填）',
  manager_userid VARCHAR(100) COMMENT '仓库管理员企微userid',
  location VARCHAR(200) COMMENT '仓库位置',
  status TINYINT DEFAULT 1 COMMENT '1=启用 0=禁用',
  sort_order INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_type (type),
  INDEX idx_department (department_id),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='仓库表';

-- ================================================
-- 4. 库存表（实时库存）
-- ================================================
CREATE TABLE IF NOT EXISTS inventory (
  id VARCHAR(36) PRIMARY KEY,
  warehouse_id VARCHAR(36) NOT NULL COMMENT '仓库ID',
  item_id VARCHAR(36) NOT NULL COMMENT '物资ID',
  quantity DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '当前库存数量',
  unit VARCHAR(20) NOT NULL COMMENT '单位',
  min_stock DECIMAL(10,2) DEFAULT 0 COMMENT '最低库存预警线',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_warehouse_item (warehouse_id, item_id),
  INDEX idx_warehouse (warehouse_id),
  INDEX idx_item (item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='库存表';

-- ================================================
-- 5. 出入库流水记录表
-- ================================================
CREATE TABLE IF NOT EXISTS stock_movements (
  id VARCHAR(36) PRIMARY KEY,
  warehouse_id VARCHAR(36) NOT NULL COMMENT '仓库ID',
  item_id VARCHAR(36) NOT NULL COMMENT '物资ID',
  item_name VARCHAR(100) NOT NULL COMMENT '物资名称（冗余）',
  movement_type ENUM('inbound','outbound','adjust') NOT NULL COMMENT '类型：入库/出库/盘点调整',
  quantity DECIMAL(10,2) NOT NULL COMMENT '数量（正数=入库 负数=出库）',
  unit VARCHAR(20) NOT NULL COMMENT '单位',
  unit_price DECIMAL(10,2) COMMENT '单价',
  total_amount DECIMAL(10,2) COMMENT '金额',
  reason VARCHAR(200) COMMENT '操作原因',
  related_type VARCHAR(20) COMMENT '关联类型：purchase=采购入库 take=盘点调整 manual=手动操作',
  related_id VARCHAR(36) COMMENT '关联单据ID',
  operator_id VARCHAR(36) COMMENT '操作人users.id',
  operator_name VARCHAR(50) COMMENT '操作人姓名',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_warehouse (warehouse_id),
  INDEX idx_item (item_id),
  INDEX idx_type (movement_type),
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='出入库流水记录表';

-- ================================================
-- 6. 仓库采购单表
--    字段设计与 purchase_confirmations 对齐，
--    确认流程代码可无差别复用
-- ================================================
CREATE TABLE IF NOT EXISTS warehouse_purchases (
  id VARCHAR(36) PRIMARY KEY,
  purchase_no VARCHAR(50) COMMENT '采购单号',
  warehouse_id VARCHAR(36) NOT NULL COMMENT '入库目标仓库ID',
  warehouse_name VARCHAR(100) COMMENT '仓库名称（冗余）',
  status VARCHAR(30) DEFAULT 'draft' COMMENT '状态：draft/pending_approval/approved/rejected/received/confirming/confirmed/reimbursing/reimbursed/cancelled',
  total_amount DECIMAL(12,2) DEFAULT 0 COMMENT '申请总金额',
  actual_amount DECIMAL(12,2) DEFAULT 0 COMMENT '实际收货总金额',
  approval_sp_no VARCHAR(100) COMMENT '企微审批单号',
  approval_status VARCHAR(20) DEFAULT 'pending' COMMENT '审批状态：pending/approved/rejected',
  rejection_reason TEXT COMMENT '审批拒绝原因',
  pdf_url VARCHAR(500) COMMENT '确认单PDF路径',
  user_departments JSON COMMENT '确认人→部门映射，格式同 purchase_confirmations',
  user_confirmations JSON COMMENT '确认记录，格式同 purchase_confirmations',
  wecom_msg_id VARCHAR(100) COMMENT '企微群消息ID',
  reimbursement_sp_no VARCHAR(100) COMMENT '报销审批单号',
  reimbursement_status VARCHAR(20) DEFAULT 'pending' COMMENT '报销状态：pending/processing/approved/rejected',
  created_by VARCHAR(36) COMMENT '创建人users.id',
  created_by_name VARCHAR(50) COMMENT '创建人姓名',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_status (status),
  INDEX idx_warehouse (warehouse_id),
  INDEX idx_approval (approval_sp_no),
  INDEX idx_reimbursement (reimbursement_sp_no),
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='仓库采购单表';

-- ================================================
-- 7. 仓库采购单明细表
-- ================================================
CREATE TABLE IF NOT EXISTS warehouse_purchase_items (
  id VARCHAR(36) PRIMARY KEY,
  purchase_id VARCHAR(36) NOT NULL COMMENT '采购单ID',
  item_id VARCHAR(36) COMMENT '物资ID',
  item_name VARCHAR(100) NOT NULL COMMENT '物资名称',
  category_name VARCHAR(100) COMMENT '分类名称（含三级路径）',
  spec VARCHAR(100) COMMENT '规格',
  department_id VARCHAR(36) COMMENT '使用部门ID',
  department_name VARCHAR(50) COMMENT '使用部门名称',
  requested_quantity DECIMAL(10,2) NOT NULL COMMENT '申请数量',
  requested_unit VARCHAR(20) NOT NULL COMMENT '申请单位',
  requested_unit_price DECIMAL(10,2) NOT NULL COMMENT '申请单价',
  requested_amount DECIMAL(10,2) NOT NULL COMMENT '申请金额',
  reason VARCHAR(200) COMMENT '采购理由',
  received_quantity DECIMAL(10,2) COMMENT '实收数量',
  received_unit VARCHAR(20) COMMENT '实收单位',
  received_unit_price DECIMAL(10,2) COMMENT '实收单价',
  received_amount DECIMAL(10,2) COMMENT '实收金额',
  received_spec VARCHAR(100) COMMENT '实收规格（可能与申请不同）',
  sort_order INT DEFAULT 0,
  INDEX idx_purchase (purchase_id),
  INDEX idx_item (item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='仓库采购单明细表';

-- ================================================
-- 8. 盘点单表
-- ================================================
CREATE TABLE IF NOT EXISTS stock_takes (
  id VARCHAR(36) PRIMARY KEY,
  warehouse_id VARCHAR(36) NOT NULL COMMENT '盘点仓库ID',
  warehouse_name VARCHAR(100) COMMENT '仓库名称（冗余）',
  status VARCHAR(20) DEFAULT 'draft' COMMENT '状态：draft/submitted/reviewing/returned/completed',
  review_type VARCHAR(20) COMMENT '复核类型：auto=全一致自动通过 sampled=抽样复核',
  review_result VARCHAR(20) COMMENT '复核结果：match=一致 mismatch=有差异',
  reviewed_by VARCHAR(36) COMMENT '复核人users.id',
  reviewed_by_name VARCHAR(50) COMMENT '复核人姓名',
  reviewed_at DATETIME COMMENT '复核时间',
  total_value DECIMAL(12,2) DEFAULT 0 COMMENT '盘点库存总价值',
  cost_summary JSON COMMENT '按大类汇总成本，含分类明细和差异汇总',
  remark TEXT COMMENT '备注',
  created_by VARCHAR(36) COMMENT '创建人users.id',
  created_by_name VARCHAR(50) COMMENT '创建人姓名',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_warehouse (warehouse_id),
  INDEX idx_status (status),
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='盘点单表';

-- ================================================
-- 9. 盘点明细表
-- ================================================
CREATE TABLE IF NOT EXISTS stock_take_items (
  id VARCHAR(36) PRIMARY KEY,
  stock_take_id VARCHAR(36) NOT NULL COMMENT '盘点单ID',
  item_id VARCHAR(36) NOT NULL COMMENT '物资ID',
  item_name VARCHAR(100) NOT NULL COMMENT '物资名称',
  category_name VARCHAR(100) COMMENT '分类名称',
  spec VARCHAR(100) COMMENT '规格',
  unit VARCHAR(20) NOT NULL COMMENT '单位',
  system_quantity DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '系统库存数量',
  actual_quantity DECIMAL(10,2) COMMENT '实盘数量',
  difference DECIMAL(10,2) DEFAULT 0 COMMENT '差异（实盘-系统）',
  unit_price DECIMAL(10,2) DEFAULT 0 COMMENT '单价',
  system_value DECIMAL(10,2) DEFAULT 0 COMMENT '系统库存价值',
  actual_value DECIMAL(10,2) DEFAULT 0 COMMENT '实盘库存价值',
  is_sampled TINYINT DEFAULT 0 COMMENT '是否被抽中复核：1=是 0=否',
  remark VARCHAR(200) COMMENT '备注',
  INDEX idx_stock_take (stock_take_id),
  INDEX idx_item (item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='盘点明细表';

-- ================================================
-- 10. 新增角色：采购员
-- ================================================
INSERT IGNORE INTO roles (id, code, name, description, is_system, sort_order) VALUES
  (UUID(), 'purchaser', '采购员', '仓库采购：创建采购单、录入收货', 1, 5);

-- ================================================
-- 11. 新增模块：仓库管理
-- ================================================
INSERT IGNORE INTO modules (id, code, name, icon, description, sort_order, status) VALUES
  ('warehouse', 'warehouse', '仓库管理', 'Warehouse', '仓库库存与采购流程管理', 3, 1);

-- ================================================
-- 12. 新增权限定义 — 菜单权限（5个）
-- ================================================
INSERT IGNORE INTO permissions (id, module_id, code, name, type, parent_id, path, icon, sort_order, status) VALUES
  (UUID(), 'warehouse', 'menu:warehouse',          '仓库管理',     'menu', NULL, '/warehouse',          'Warehouse',      1, 1),
  (UUID(), 'warehouse', 'menu:warehouse-purchase',  '仓库采购',     'menu', NULL, '/warehouse-purchase',  'ShoppingCart',   2, 1),
  (UUID(), 'warehouse', 'menu:inventory',           '库存查询',     'menu', NULL, '/inventory',           'Boxes',          3, 1),
  (UUID(), 'warehouse', 'menu:stock-movement',      '出入库记录',   'menu', NULL, '/stock-movement',      'ArrowLeftRight', 4, 1),
  (UUID(), 'warehouse', 'menu:stock-take',          '盘点管理',     'menu', NULL, '/stock-take',          'ClipboardCheck', 5, 1);

-- ================================================
-- 13. 新增权限定义 — 操作权限（9个）
-- ================================================
INSERT IGNORE INTO permissions (id, module_id, code, name, type, parent_id, sort_order, status) VALUES
  (UUID(), 'warehouse', 'action:warehouse:manage',     '管理仓库/分类/物资', 'button', NULL, 1, 1),
  (UUID(), 'warehouse', 'action:warehouse:create',     '创建采购单',        'button', NULL, 2, 1),
  (UUID(), 'warehouse', 'action:warehouse:approve',    '审批采购单',        'button', NULL, 3, 1),
  (UUID(), 'warehouse', 'action:warehouse:receive',    '录入收货',          'button', NULL, 4, 1),
  (UUID(), 'warehouse', 'action:warehouse:view',       '查看采购',          'button', NULL, 5, 1),
  (UUID(), 'warehouse', 'action:warehouse:inbound',    '入库操作',          'button', NULL, 6, 1),
  (UUID(), 'warehouse', 'action:warehouse:outbound',   '出库操作',          'button', NULL, 7, 1),
  (UUID(), 'warehouse', 'action:warehouse:reimburse',  '发起报销',          'button', NULL, 8, 1),
  (UUID(), 'warehouse', 'action:inventory:review',     '盘点复核',          'button', NULL, 9, 1);

-- ================================================
-- 14. 角色权限分配
-- ================================================

-- 14.1 admin 角色：仓库模块全部权限
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'admin' AND p.module_id = 'warehouse';

-- 14.2 purchaser 角色：采购创建 + 收货 + 查看 + 仓库管理 + 库存查看
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'purchaser'
  AND p.code IN (
    'menu:warehouse', 'menu:warehouse-purchase', 'menu:inventory',
    'action:warehouse:create', 'action:warehouse:receive',
    'action:warehouse:view', 'action:warehouse:manage'
  );

-- 14.3 finance 角色：全部查看 + 盘点复核 + 出入库 + 报销发起
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'finance'
  AND p.code IN (
    'menu:warehouse', 'menu:warehouse-purchase', 'menu:inventory',
    'menu:stock-movement', 'menu:stock-take',
    'action:warehouse:view', 'action:inventory:review',
    'action:warehouse:reimburse',
    'action:warehouse:inbound', 'action:warehouse:outbound'
  );

-- 14.4 boss 角色：全部查看权限
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'boss'
  AND p.code IN (
    'menu:warehouse', 'menu:warehouse-purchase', 'menu:inventory',
    'menu:stock-movement', 'menu:stock-take',
    'action:warehouse:view'
  );

-- ================================================
-- 15. 验证
-- ================================================
SELECT '034_create_warehouse_module.sql 执行完成' AS message;
