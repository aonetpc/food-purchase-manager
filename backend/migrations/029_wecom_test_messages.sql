-- ================================================
-- 企业微信测试消息表（独立于生产数据，用于开发测试）
-- 用于测试消息发送、确认/驳回交互等功能
-- ================================================

CREATE TABLE IF NOT EXISTS wecom_test_messages (
  id VARCHAR(36) PRIMARY KEY,
  test_date DATE NOT NULL COMMENT '模拟的采购日期',
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  departments JSON COMMENT '涉及部门列表',
  purchase_items JSON COMMENT '采购明细',
  message_content TEXT COMMENT '发送的消息内容',
  status VARCHAR(20) DEFAULT 'pending' COMMENT 'pending/confirmed/rejected',
  confirmed_by VARCHAR(100) COMMENT '确认人',
  confirmed_at DATETIME COMMENT '确认时间',
  rejected_by VARCHAR(100) COMMENT '驳回人',
  rejected_at DATETIME COMMENT '驳回时间',
  reject_reason TEXT COMMENT '驳回原因',
  wecom_sent TINYINT DEFAULT 0 COMMENT '是否已发送到企微',
  sent_at DATETIME COMMENT '发送时间',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_test_date (test_date),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
