-- ================================================
-- 005 - 创建登录方式关联表 + 迁移现有企微绑定
-- 将 users.wecom_userid 迁移到 user_login_methods 表
-- 幂等执行：可重复执行不会报错
-- ================================================

-- ================================================
-- 1. 创建登录方式关联表
-- ================================================
CREATE TABLE IF NOT EXISTS user_login_methods (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL COMMENT '用户ID',
  type ENUM('password', 'wecom', 'wechat') NOT NULL COMMENT '登录方式',
  identifier VARCHAR(100) NOT NULL COMMENT '标识值（wecom_userid/openid/username）',
  config JSON COMMENT '额外配置（如企微corpid等）',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_type_id (type, identifier),
  INDEX idx_user (user_id),
  INDEX idx_type (type),
  INDEX idx_identifier (identifier),
  CONSTRAINT fk_ulm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户登录方式关联表';

-- ================================================
-- 2. 迁移现有密码登录方式
-- ================================================
INSERT IGNORE INTO user_login_methods (id, user_id, type, identifier, config)
SELECT 
  UUID(), 
  id, 
  'password', 
  username,
  JSON_OBJECT('has_password', TRUE)
FROM users
WHERE username IS NOT NULL AND username != '';

-- ================================================
-- 3. 迁移现有企微绑定（wecom_userid 不为空的用户）
-- ================================================
INSERT IGNORE INTO user_login_methods (id, user_id, type, identifier, config)
SELECT 
  UUID(), 
  id, 
  'wecom', 
  wecom_userid,
  JSON_OBJECT('source', 'migrated_from_users_table')
FROM users
WHERE wecom_userid IS NOT NULL AND wecom_userid != '';

-- ================================================
-- 4. 验证迁移结果
-- ================================================
SELECT 
  type AS login_method,
  COUNT(*) AS count
FROM user_login_methods
GROUP BY type
ORDER BY type;

SELECT 
  u.username, 
  u.name, 
  u.role,
  ulm.type AS login_type,
  CASE WHEN ulm.type = 'wecom' THEN ulm.identifier ELSE '-' END AS wecom_bound
FROM users u
LEFT JOIN user_login_methods ulm ON u.id = ulm.user_id AND ulm.type = 'wecom'
ORDER BY u.username;

SELECT '005_create_login_methods.sql 执行完成' AS message;
