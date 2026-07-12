-- ================================================
-- 企业微信集成 - 数据库迁移脚本
-- 执行前请备份数据库
-- ================================================

-- 1. 创建企业微信配置表
CREATE TABLE IF NOT EXISTS wecom_config (
  id INT PRIMARY KEY DEFAULT 1,
  corp_id VARCHAR(100),
  app_secret VARCHAR(200),
  agent_id VARCHAR(50),
  chat_id VARCHAR(100),
  approval_template_id VARCHAR(100),
  applicant_userid VARCHAR(100),
  payment_options JSON,
  default_payment_key VARCHAR(50),
  payee_name VARCHAR(100),
  bank_name VARCHAR(200),
  bank_account VARCHAR(100),
  payment_reason_template VARCHAR(200),
  approval_field_mapping JSON,
  callback_token VARCHAR(100),
  callback_aes_key VARCHAR(200),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. 创建采购确认单表
CREATE TABLE IF NOT EXISTS purchase_confirmations (
  id VARCHAR(36) PRIMARY KEY,
  purchase_date DATE NOT NULL,
  total_amount DECIMAL(12, 2) NOT NULL,
  departments JSON NOT NULL,
  purchase_items JSON NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  wecom_msg_id VARCHAR(100),
  reimbursement_sp_no VARCHAR(100),
  reimbursement_status VARCHAR(20) DEFAULT 'pending',
  rejection_reason TEXT,
  approval_detail JSON,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_purchase_date (purchase_date),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. 部门表增加确认人字段（如果不存在）
-- 注意：如果departments表不存在，请先执行主初始化脚本
-- ALTER TABLE departments ADD COLUMN IF NOT EXISTS confirm_by VARCHAR(100);
