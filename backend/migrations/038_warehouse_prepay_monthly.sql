-- ================================================
-- 038 - 仓库采购：预付款与月结支持
-- 为 warehouse_purchases 表新增采购类型、供应商、预付款等字段
-- 幂等执行：可重复执行不会报错
-- ================================================

-- 1. warehouse_purchases 表新增采购类型与结算字段
ALTER TABLE warehouse_purchases
  ADD COLUMN purchase_type ENUM('normal', 'prepay', 'monthly') DEFAULT 'normal' COMMENT '采购类型：normal=现购 prepay=预付款 monthly=月结',
  ADD COLUMN supplier_id VARCHAR(36) NULL COMMENT '供应商ID',
  ADD COLUMN supplier_name VARCHAR(100) NULL COMMENT '供应商名称（冗余）',
  ADD COLUMN prepay_amount DECIMAL(12,2) DEFAULT 0 COMMENT '预付款金额',
  ADD COLUMN prepay_sp_no VARCHAR(100) NULL COMMENT '预付款审批单号',
  ADD COLUMN prepay_status VARCHAR(20) DEFAULT 'pending' COMMENT '预付款审批状态：pending/approved/rejected/paid',
  ADD COLUMN prepay_voucher_no VARCHAR(100) NULL COMMENT '预付款付款凭证号',
  ADD COLUMN prepay_voucher_at DATETIME NULL COMMENT '预付款付款凭证时间',
  ADD COLUMN writeoff_status VARCHAR(20) DEFAULT 'pending' COMMENT '核销状态：pending/auto/manual/done',
  ADD COLUMN writeoff_amount DECIMAL(12,2) DEFAULT 0 COMMENT '已核销金额',
  ADD COLUMN monthly_statement_id VARCHAR(36) NULL COMMENT '关联月结账单ID',
  ADD INDEX idx_purchase_type (purchase_type),
  ADD INDEX idx_supplier (supplier_id),
  ADD INDEX idx_prepay_status (prepay_status),
  ADD INDEX idx_writeoff (writeoff_status),
  ADD INDEX idx_monthly_statement (monthly_statement_id);

-- 2. 供应商表新增 prepay_balance 字段（如果不存在）
ALTER TABLE suppliers
  ADD COLUMN prepay_balance DECIMAL(12,2) DEFAULT 0 COMMENT '预付款余额（多付抵扣款）';
