-- ================================================
-- 006 - 创建用户操作日志表
-- 用于审计用户管理、权限变更等敏感操作
-- 幂等执行：可重复执行不会报错
-- ================================================

-- ================================================
-- 1. 创建操作日志表
-- ================================================
CREATE TABLE IF NOT EXISTS user_operation_logs (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL COMMENT '操作人ID',
  target_user_id VARCHAR(36) COMMENT '目标用户ID（操作对象）',
  module VARCHAR(50) NOT NULL COMMENT '模块（如 user/role/permission）',
  action VARCHAR(50) NOT NULL COMMENT '操作类型（如 create/update/delete/login）',
  details JSON COMMENT '操作详情',
  ip_address VARCHAR(50) COMMENT 'IP地址',
  user_agent VARCHAR(500) COMMENT 'User-Agent',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user (user_id),
  INDEX idx_target_user (target_user_id),
  INDEX idx_module (module),
  INDEX idx_action (action),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户操作日志表';

-- ================================================
-- 2. 创建微信配置表（为未来微信登录预留）
-- ================================================
CREATE TABLE IF NOT EXISTS wechat_config (
  id INT PRIMARY KEY DEFAULT 1,
  app_id VARCHAR(100) COMMENT '微信公众号/开放平台AppID',
  app_secret VARCHAR(200) COMMENT 'AppSecret',
  status TINYINT DEFAULT 0 COMMENT '状态：1启用 0禁用',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_wechat_config_id CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='微信登录配置表';

-- 插入默认空配置
INSERT IGNORE INTO wechat_config (id, app_id, app_secret, status) VALUES
  (1, NULL, NULL, 0);

-- ================================================
-- 3. 验证
-- ================================================
SELECT 
  TABLE_NAME, 
  TABLE_COMMENT 
FROM INFORMATION_SCHEMA.TABLES 
WHERE TABLE_SCHEMA = DATABASE() 
  AND TABLE_NAME IN ('user_operation_logs', 'wechat_config')
ORDER BY TABLE_NAME;

SELECT '006_create_operation_logs.sql 执行完成' AS message;
