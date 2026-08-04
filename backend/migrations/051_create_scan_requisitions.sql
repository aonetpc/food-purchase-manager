-- 051 - 扫码领料功能：领料单表 + 用户仓库绑定表

-- ================================================
-- 扫码领料单
-- ================================================
CREATE TABLE IF NOT EXISTS scan_requisitions (
  id VARCHAR(36) PRIMARY KEY,
  requisition_no VARCHAR(20) COMMENT '领料编号 RQ20260804-001',
  -- 领料人信息（复用 temp_worker_users 的 openid 身份）
  temp_user_id VARCHAR(36) NOT NULL COMMENT '关联 temp_worker_users.id',
  user_name VARCHAR(50) NOT NULL COMMENT '领料人姓名（冗余）',
  user_phone VARCHAR(20) COMMENT '领料人手机号（冗余）',
  -- 部门仓库
  warehouse_id VARCHAR(36) COMMENT '领料目标仓库ID',
  warehouse_name VARCHAR(50) COMMENT '仓库名称',
  -- 物资清单
  items JSON NOT NULL COMMENT '[{item_id, item_name, quantity, unit, unit_price}]',
  -- 状态：pending=待审核 approved=已通过 rejected=已驳回 auto=自动出库（已绑定仓库）
  status ENUM('pending','approved','rejected','auto') DEFAULT 'pending',
  -- 审核（仅首次需要）
  auditor_id VARCHAR(36) COMMENT '审核人 users.id',
  auditor_name VARCHAR(50) COMMENT '审核人姓名',
  approved_at DATETIME,
  reject_reason VARCHAR(200),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_status (status),
  INDEX idx_temp_user (temp_user_id),
  INDEX idx_warehouse (warehouse_id),
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='扫码领料单';

-- ================================================
-- 领料人-部门仓库绑定（审核通过后建立，后续免审核）
-- ================================================
CREATE TABLE IF NOT EXISTS scan_user_warehouses (
  id VARCHAR(36) PRIMARY KEY,
  temp_user_id VARCHAR(36) NOT NULL COMMENT '关联 temp_worker_users.id',
  warehouse_id VARCHAR(36) NOT NULL COMMENT '绑定的部门仓库ID',
  warehouse_name VARCHAR(50) COMMENT '仓库名称',
  assigned_by VARCHAR(36) COMMENT '审核人 users.id',
  assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_warehouse (temp_user_id, warehouse_id),
  INDEX idx_temp_user (temp_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='领料人-部门仓库绑定';
