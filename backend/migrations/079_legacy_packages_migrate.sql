-- ============================================================
-- 079: 旧套餐 & 套餐明细兼容迁移
--
-- 兼容策略（零破坏，历史订单不受影响）：
--   1. 现有 booking_packages 全部置 is_public=1（管理员公共套餐），
--      applicable_roles 全角色；owner_sales_id=NULL（管理员）
--   2. 现有 booking_package_items 全部 role='common'（三类人共享）
--      利用 078 已加列的 DEFAULT 'common'，但本迁移强制 UPDATE 确保
--   3. 为每个现有套餐生成 3 条 booking_package_role_plans 记录：
--        original_total = 该套餐 autoTotal(所有 common 项按 item_price * qty)
--        discount_price = 套餐 booking_packages.price（如果>0否则=original_total）
--        discount_rate  = 自动计算 discount_price/original_total * 100
-- ============================================================

-- Step 1: 套餐公共字段
UPDATE booking_packages
SET
  is_public = 1,
  applicable_roles = '["male","female_married","female_single"]',
  owner_sales_id = NULL
WHERE is_public = 0 AND owner_sales_id IS NULL;  -- 仅对尚未被Phase2设置的旧数据生效

-- Step 2: 套餐明细强制 role='common'（078 加了DEFAULT，旧数据默认值不会更新，必须UPDATE）
UPDATE booking_package_items SET role = 'common' WHERE role IS NULL OR role NOT IN ('common','male','female_married','female_single');

-- Step 3: 为每个套餐生成 3 条 role_plans（若不存在）
--  用临时表先算每个套餐的 auto_total
DROP TEMPORARY TABLE IF EXISTS _tmp_pkg_total;
CREATE TEMPORARY TABLE _tmp_pkg_total (
  package_id VARCHAR(36) PRIMARY KEY,
  original_total DECIMAL(10,2) NOT NULL DEFAULT 0,
  pkg_price DECIMAL(10,2) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO _tmp_pkg_total (package_id, original_total, pkg_price)
SELECT
  p.id AS package_id,
  COALESCE(SUM(COALESCE(pi.item_price, 0) * COALESCE(pi.quantity, 1)), 0) AS original_total,
  COALESCE(p.price, 0) AS pkg_price
FROM booking_packages p
LEFT JOIN booking_package_items pi ON pi.package_id = p.id
GROUP BY p.id, p.price;

-- 三条角色批量插入（幂等：UNIQUE(package_id,role) 已阻止重复，用 INSERT IGNORE）
INSERT IGNORE INTO booking_package_role_plans
  (id, package_id, role, original_total, discount_price, discount_rate)
SELECT
  UUID() AS id,
  t.package_id,
  'male' AS role,
  t.original_total,
  CASE WHEN t.pkg_price > 0 THEN t.pkg_price ELSE t.original_total END AS discount_price,
  CASE WHEN t.original_total > 0
       THEN ROUND(CASE WHEN t.pkg_price > 0 THEN t.pkg_price ELSE t.original_total END / t.original_total * 100, 2)
       ELSE 100 END AS discount_rate
FROM _tmp_pkg_total t;

INSERT IGNORE INTO booking_package_role_plans
  (id, package_id, role, original_total, discount_price, discount_rate)
SELECT
  UUID() AS id,
  t.package_id,
  'female_married' AS role,
  t.original_total,
  CASE WHEN t.pkg_price > 0 THEN t.pkg_price ELSE t.original_total END AS discount_price,
  CASE WHEN t.original_total > 0
       THEN ROUND(CASE WHEN t.pkg_price > 0 THEN t.pkg_price ELSE t.original_total END / t.original_total * 100, 2)
       ELSE 100 END AS discount_rate
FROM _tmp_pkg_total t;

INSERT IGNORE INTO booking_package_role_plans
  (id, package_id, role, original_total, discount_price, discount_rate)
SELECT
  UUID() AS id,
  t.package_id,
  'female_single' AS role,
  t.original_total,
  CASE WHEN t.pkg_price > 0 THEN t.pkg_price ELSE t.original_total END AS discount_price,
  CASE WHEN t.original_total > 0
       THEN ROUND(CASE WHEN t.pkg_price > 0 THEN t.pkg_price ELSE t.original_total END / t.original_total * 100, 2)
       ELSE 100 END AS discount_rate
FROM _tmp_pkg_total t;

DROP TEMPORARY TABLE IF EXISTS _tmp_pkg_total;
