-- ============================================================
-- 078: 销售体检套餐模板 — 表结构扩展
--
-- 1. booking_packages：
--      新增 owner_sales_id / is_public / cover_sales_ids /
--           base_template_id / applicable_roles / share_token / share_expire_at
-- 2. booking_package_items：新增 role 字段（common/male/female_married/female_single）
-- 3. 新建 booking_package_role_plans 表：每套餐3角色独立原价/折扣价/折扣率
-- ============================================================

-- ---------- booking_packages 扩展字段 ----------
SET @c = (SELECT IF(COUNT(*)=0,
  "ALTER TABLE booking_packages ADD COLUMN owner_sales_id VARCHAR(36) NULL COMMENT '套餐归属销售员ID，公共套餐为NULL'",
  'SELECT 1')
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='booking_packages' AND COLUMN_NAME='owner_sales_id');
PREPARE stmt FROM @c; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c = (SELECT IF(COUNT(*)=0,
  "ALTER TABLE booking_packages ADD COLUMN is_public TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否为管理员公共模板（所有销售可克隆）'",
  'SELECT 1')
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='booking_packages' AND COLUMN_NAME='is_public');
PREPARE stmt FROM @c; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c = (SELECT IF(COUNT(*)=0,
  "ALTER TABLE booking_packages ADD COLUMN cover_sales_ids JSON NULL COMMENT '管理员分配给指定销售可见的sales id列表（JSON数组）'",
  'SELECT 1')
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='booking_packages' AND COLUMN_NAME='cover_sales_ids');
PREPARE stmt FROM @c; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c = (SELECT IF(COUNT(*)=0,
  "ALTER TABLE booking_packages ADD COLUMN base_template_id VARCHAR(36) NULL COMMENT '基于哪个公共套餐克隆而来'",
  'SELECT 1')
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='booking_packages' AND COLUMN_NAME='base_template_id');
PREPARE stmt FROM @c; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c = (SELECT IF(COUNT(*)=0,
  "ALTER TABLE booking_packages ADD COLUMN applicable_roles JSON NULL COMMENT '适用角色 JSON 数组'",
  'SELECT 1')
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='booking_packages' AND COLUMN_NAME='applicable_roles');
PREPARE stmt FROM @c; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- MySQL 5.7 不允许 JSON 列有 DEFAULT，改为添加后 UPDATE 设置默认值
UPDATE booking_packages SET applicable_roles = JSON_ARRAY('male','female_married','female_single') WHERE applicable_roles IS NULL;

SET @c = (SELECT IF(COUNT(*)=0,
  "ALTER TABLE booking_packages ADD COLUMN share_token VARCHAR(64) NULL COMMENT '分享链接token（H5无登录访问）'",
  'SELECT 1')
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='booking_packages' AND COLUMN_NAME='share_token');
PREPARE stmt FROM @c; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c = (SELECT IF(COUNT(*)=0,
  "ALTER TABLE booking_packages ADD COLUMN share_expire_at DATETIME NULL COMMENT '分享链接过期时间'",
  'SELECT 1')
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='booking_packages' AND COLUMN_NAME='share_expire_at');
PREPARE stmt FROM @c; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 索引：owner_sales_id 供按销售过滤；share_token 供H5免登录查询
SET @idx = (SELECT IF(COUNT(*)=0,
  "ALTER TABLE booking_packages ADD INDEX idx_pkg_owner (owner_sales_id)",
  'SELECT 1')
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='booking_packages' AND INDEX_NAME='idx_pkg_owner');
PREPARE stmt FROM @idx; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx = (SELECT IF(COUNT(*)=0,
  "ALTER TABLE booking_packages ADD UNIQUE INDEX idx_pkg_share_token (share_token)",
  'SELECT 1')
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='booking_packages' AND INDEX_NAME='idx_pkg_share_token');
PREPARE stmt FROM @idx; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------- booking_package_items 扩展 role 字段 ----------
SET @c = (SELECT IF(COUNT(*)=0,
  "ALTER TABLE booking_package_items ADD COLUMN role ENUM('common','male','female_married','female_single') NOT NULL DEFAULT 'common' COMMENT 'common=三类共享；其余仅对应角色有'",
  'SELECT 1')
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='booking_package_items' AND COLUMN_NAME='role');
PREPARE stmt FROM @c; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 去重索引：package_id + role + item_id（允许同项目common+某角色各一条，比如公共的基础项外加某角色加项）
SET @idx = (SELECT IF(COUNT(*)=0,
  "ALTER TABLE booking_package_items ADD UNIQUE INDEX uk_pkg_role_item (package_id, role, item_id)",
  'SELECT 1')
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='booking_package_items' AND INDEX_NAME='uk_pkg_role_item');
PREPARE stmt FROM @idx; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------- 新建 booking_package_role_plans 表 ----------
CREATE TABLE IF NOT EXISTS booking_package_role_plans (
  id               VARCHAR(36) PRIMARY KEY COMMENT 'UUID',
  package_id       VARCHAR(36) NOT NULL COMMENT '关联套餐ID',
  role             ENUM('male','female_married','female_single') NOT NULL COMMENT '角色',
  original_total   DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '原价（自动累加入选项目default_price）',
  discount_price   DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '折扣价（销售手填）',
  discount_rate    DECIMAL(5,2)  NOT NULL DEFAULT 100 COMMENT '折扣率%，自动=discount_price/original_total*100',
  remark           VARCHAR(200) NULL COMMENT '该角色方案备注',
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_package_role (package_id, role),
  INDEX idx_package (package_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='体检套餐-角色-方案价格（三类角色各一条）';
