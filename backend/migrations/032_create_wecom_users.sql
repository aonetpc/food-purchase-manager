-- ================================================
-- 创建 wecom_users 表（企微用户缓存表）
-- 用于缓存 userid 与真实姓名的对应关系，减少 API 调用
-- ================================================

CREATE TABLE IF NOT EXISTS wecom_users (
  userid VARCHAR(100) PRIMARY KEY COMMENT '企微用户ID',
  name VARCHAR(100) NOT NULL COMMENT '真实姓名',
  position VARCHAR(100) COMMENT '职位',
  department_ids JSON COMMENT '部门ID列表',
  avatar VARCHAR(500) COMMENT '头像URL',
  mobile VARCHAR(20) COMMENT '手机号',
  email VARCHAR(100) COMMENT '邮箱',
  status TINYINT DEFAULT 1 COMMENT '状态：1=激活,0=禁用',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='企微用户缓存表';