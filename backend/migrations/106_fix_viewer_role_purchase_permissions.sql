-- ================================================
-- 106 - 撤销 viewer（查看员）角色的食材采购模块权限
--
-- 背景：
--   原始 004_init_module_permissions.sql 给 viewer 分配了采购模块的
--   menu:daily / menu:yearly / menu:query 等菜单权限。
--   之后 017_fix_viewer_permissions.sql 又增量补充了 menu:ingredients，
--   等于把 viewer 的采购权限进一步加固。
--
--   但业务上 viewer（查看员/普通员工）本应只有预订看板等业务模块权限，
--   不应接触食材采购（每日采购清单等）数据。
--
-- 本迁移：
--   1. DELETE viewer 在 food-purchase 模块下的所有 role_permissions 关联行
--      （幂等：重复执行不会报错）
--   2. 验证 viewer 剩余权限确认没有采购模块残留
--
-- 风险：低。仅删除 role_permissions 关联行，不改动 permissions 表数据。
-- 回滚：手动 INSERT 回 viewer 的采购权限即可。
-- ================================================

-- ================================================
-- 1. 撤销 viewer 的 food-purchase 模块权限
-- ================================================
DELETE rp FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE r.code = 'viewer'
  AND p.module_id = 'food-purchase';

-- ================================================
-- 2. 验证：viewer 当前拥有的菜单权限（不应再出现 food-purchase 模块）
-- ================================================
SELECT '===== viewer 角色权限（验证：应无 food-purchase 模块）=====' AS info;

SELECT
  r.name AS role_name,
  m.code AS module_code,
  p.code AS perm_code,
  p.name AS perm_name,
  p.path,
  p.type
FROM roles r
JOIN role_permissions rp ON rp.role_id = r.id
JOIN permissions p ON p.id = rp.permission_id
LEFT JOIN modules m ON m.id = p.module_id
WHERE r.code = 'viewer'
ORDER BY m.code, p.sort_order;

-- 确认删除行数（非 0 表示本次确实移除了采购权限）
SELECT ROW_COUNT() AS affected_rows;

SELECT '106_fix_viewer_role_purchase_permissions.sql 执行完成' AS message;
