-- ================================================
-- 061 - 仓库用户关联表 warehouse_users
--
-- 背景：
--   之前 warehouses 表只有 manager_userid（单个企微 userid 字符串），
--   导致一个仓库只能绑一个人管理，而且库存/出入库的权限判定完全没读这个字段，
--   使得"仓库管理员"角色下的用户看不到任何仓库。
--
-- 目标：
--   1. 建 warehouse_users 多对多关联表，支持一个仓库多个管理员/查看人
--   2. 把现有 warehouses.manager_userid 的值自动迁移过来
--   3. confirmer_userid 保持原样（用户说不需要多确认人）
-- ================================================

-- ================================================
-- 1. 建表
-- ================================================
CREATE TABLE IF NOT EXISTS warehouse_users (
  id VARCHAR(36) NOT NULL COMMENT '主键UUID',
  warehouse_id VARCHAR(36) NOT NULL COMMENT '仓库ID',
  user_id VARCHAR(36) NOT NULL COMMENT '用户ID（users表主键）',
  role VARCHAR(20) NOT NULL DEFAULT 'manager' COMMENT '仓库角色：manager=仓库管理员 / viewer=只读查看人',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_warehouse_user (warehouse_id, user_id, role),
  INDEX idx_user (user_id),
  INDEX idx_warehouse (warehouse_id)
) COMMENT='仓库-用户关联表（支持一个仓库多人管理/查看）';

-- ================================================
-- 2. 数据迁移：把现有 warehouses.manager_userid 同步到关联表
--    只迁移用户在 users 表中有匹配 wecom_userid 的记录
-- ================================================
INSERT IGNORE INTO warehouse_users (id, warehouse_id, user_id, role)
SELECT
  UUID()                                            AS id,
  w.id                                              AS warehouse_id,
  u.id                                              AS user_id,
  'manager'                                         AS role
FROM warehouses w
JOIN users u ON u.wecom_userid = w.manager_userid
WHERE w.manager_userid IS NOT NULL
  AND TRIM(w.manager_userid) != ''
  AND w.status = 1;

-- 3. （可选）如果 confirmer_userid 和 manager_userid 不是同一个人，
--    也把确认人作为 manager 一起迁移过来，避免盘点人看不到仓库
INSERT IGNORE INTO warehouse_users (id, warehouse_id, user_id, role)
SELECT
  UUID()                                            AS id,
  w.id                                              AS warehouse_id,
  u.id                                              AS user_id,
  'manager'                                         AS role
FROM warehouses w
JOIN users u ON u.wecom_userid = w.confirmer_userid
WHERE w.confirmer_userid IS NOT NULL
  AND TRIM(w.confirmer_userid) != ''
  AND w.status = 1
  AND NOT EXISTS (
    SELECT 1 FROM warehouse_users wu
    WHERE wu.warehouse_id = w.id
      AND wu.user_id = u.id
      AND wu.role = 'manager'
  );

-- ================================================
-- 4. 验证
-- ================================================
SELECT '迁移结果（每个仓库的用户数）:' AS info;
SELECT
  w.name                     AS warehouse_name,
  COUNT(wu.id)               AS bound_users,
  GROUP_CONCAT(
    CONCAT(u.name, '(', wu.role, ')')
    ORDER BY wu.role SEPARATOR '、'
  )                          AS users
FROM warehouses w
LEFT JOIN warehouse_users wu ON wu.warehouse_id = w.id
LEFT JOIN users u ON u.id = wu.user_id
WHERE w.status = 1
GROUP BY w.id
ORDER BY w.sort_order, w.name;

SELECT '061_warehouse_users.sql 执行完成' AS message;
