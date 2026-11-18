-- 122 - 仓库采购退货单 + 净额字段
-- 数据零影响原则：
--   1. 只建表 / 加字段，默认值保证历史单据净额与现状完全一致（returned_amount / returned_quantity 默认 0）
--   2. 不做任何 UPDATE 回填
--   3. stock_movements.movement_type 枚举值只追加在末尾，不调整既有顺序

-- ================================================
-- 1. 退货单主表
-- ================================================
CREATE TABLE IF NOT EXISTS warehouse_purchase_returns (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  return_no VARCHAR(50) NOT NULL COMMENT '退货单号',
  purchase_id VARCHAR(36) NOT NULL COMMENT '仓库采购单ID',
  purchase_no VARCHAR(50) COMMENT '仓库采购单号（冗余）',
  warehouse_id VARCHAR(36) COMMENT '仓库ID',
  warehouse_name VARCHAR(100) COMMENT '仓库名称（冗余）',
  status VARCHAR(20) NOT NULL DEFAULT 'draft' COMMENT 'draft草稿/submitted已提交/confirmed已确认/completed已完成/voided已作废',
  total_quantity DECIMAL(12,3) NOT NULL DEFAULT 0 COMMENT '退货总数量',
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '退货总金额',
  net_amount DECIMAL(12,2) DEFAULT NULL COMMENT '退货后采购单净额（确认时写入）',
  payment_state VARCHAR(20) NOT NULL DEFAULT 'unknown' COMMENT 'paid已付款/unpaid未付款/unknown未知（只读，系统派生）',
  settlement_ref VARCHAR(100) DEFAULT NULL COMMENT '退款/抵扣凭证号',
  remark VARCHAR(500) DEFAULT NULL COMMENT '备注',
  created_by VARCHAR(36) DEFAULT NULL,
  created_by_name VARCHAR(100) DEFAULT NULL,
  confirmed_by VARCHAR(36) DEFAULT NULL,
  confirmed_by_name VARCHAR(100) DEFAULT NULL,
  confirmed_at DATETIME DEFAULT NULL,
  completed_by VARCHAR(36) DEFAULT NULL,
  completed_by_name VARCHAR(100) DEFAULT NULL,
  completed_at DATETIME DEFAULT NULL,
  voided_by VARCHAR(36) DEFAULT NULL,
  voided_by_name VARCHAR(100) DEFAULT NULL,
  voided_at DATETIME DEFAULT NULL,
  void_reason VARCHAR(500) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_wpr_return_no (return_no),
  INDEX idx_wpr_purchase (purchase_id),
  INDEX idx_wpr_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='仓库采购退货单';

-- ================================================
-- 2. 退货单明细
-- ================================================
CREATE TABLE IF NOT EXISTS warehouse_purchase_return_items (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  return_id VARCHAR(36) NOT NULL COMMENT '退货单ID',
  purchase_item_id VARCHAR(36) NOT NULL COMMENT '原采购明细ID',
  item_id VARCHAR(36) COMMENT '物资ID',
  item_name VARCHAR(100) COMMENT '物资名称（快照）',
  spec VARCHAR(100) COMMENT '规格（快照）',
  unit VARCHAR(20) COMMENT '单位（快照）',
  warehouse_id VARCHAR(36) COMMENT '仓库ID',
  department_id VARCHAR(36) COMMENT '部门ID',
  department_name VARCHAR(50) COMMENT '部门名称',
  quantity DECIMAL(12,3) NOT NULL COMMENT '本次退货数量',
  unit_price DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '单价（原明细实收单价）',
  amount DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '退货金额（按实收金额比例拆分）',
  is_instant TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否即采即用（确认时快照）',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_wpri_return (return_id),
  INDEX idx_wpri_purchase_item (purchase_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='仓库采购退货单明细';

-- ================================================
-- 3. 主表新增累计退货金额 + 历史报销单号
-- ================================================
SET @dbname = DATABASE();
SET @tablename = 'warehouse_purchases';

SET @columnname = 'returned_amount';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, " DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '累计已退金额'")
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @columnname = 'reimbursement_sp_no_history';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, " TEXT COMMENT '历史报销审批单号（JSON数组，重新发起时保留原单号）'")
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- ================================================
-- 4. 采购明细新增累计已退数量
-- ================================================
SET @tablename = 'warehouse_purchase_items';

SET @columnname = 'returned_quantity';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, " DECIMAL(12,3) NOT NULL DEFAULT 0 COMMENT '累计已退数量'")
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- ================================================
-- 5. 库存流水类型追加 return（只追加在末尾，保持既有顺序）
-- ================================================
ALTER TABLE stock_movements
  MODIFY COLUMN movement_type ENUM('inbound','outbound','adjust','expense','return') NOT NULL COMMENT '类型：入库/出库/盘点调整/即买即用消耗/采购退货';
