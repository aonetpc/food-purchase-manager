-- 创建微信公众号配置表
CREATE TABLE IF NOT EXISTS wechat_config (
  id INT PRIMARY KEY DEFAULT 1,
  app_id VARCHAR(100) COMMENT '微信公众号AppID',
  app_secret VARCHAR(100) COMMENT '微信公众号AppSecret',
  status TINYINT DEFAULT 1 COMMENT '1=启用 0=禁用',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='微信公众号配置表';

-- 插入默认配置行
INSERT IGNORE INTO wechat_config (id) VALUES (1);

SELECT 'wechat_config 表创建完成' as message;
