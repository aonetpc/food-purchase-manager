-- ============================================================
-- 081: 体检品牌配置 + 客户经理名片
--
-- 1. checkup_brand_config：KV 表，全局企业品牌信息（单条记录）
-- 2. checkup_sales_profiles：客户经理个人名片（user_id 一对一）
-- ============================================================

-- ---------- 1. checkup_brand_config ----------
CREATE TABLE IF NOT EXISTS checkup_brand_config (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  config_key VARCHAR(64) NOT NULL COMMENT '配置键: company_name/logo/slogan/address/phone/service_hours/qualification/wechat_qrcode/primary_color',
  config_value TEXT NULL COMMENT '配置值',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_brand_config_key (config_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='体检分享-企业品牌配置';

-- 初始化默认品牌配置
INSERT IGNORE INTO checkup_brand_config (config_key, config_value) VALUES
  ('company_name',    '上海画一健康管理有限公司'),
  ('company_logo',    NULL),
  ('company_slogan',  '专注高端体检 · 为您定制专属方案'),
  ('company_address', NULL),
  ('company_phone',   NULL),
  ('service_hours',   NULL),
  ('qualification',   NULL),
  ('wechat_qrcode',   NULL),
  ('primary_color',   '#0f5132');

-- ---------- 2. checkup_sales_profiles ----------
CREATE TABLE IF NOT EXISTS checkup_sales_profiles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL COMMENT '关联 users.id',
  avatar_url VARCHAR(512) NULL COMMENT '头像URL',
  title VARCHAR(64) NULL COMMENT '职位（占位：目前不显示）',
  wechat_qrcode VARCHAR(512) NULL COMMENT '个人微信二维码（占位：目前不显示）',
  bio VARCHAR(255) NULL COMMENT '个人简介（占位：目前不显示）',
  email VARCHAR(128) NULL COMMENT '邮箱（占位：目前不显示）',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_sales_profile_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='体检分享-客户经理名片';
