-- ================================================
-- 007 - 修复菜单路径与前端路由不匹配的问题
-- ================================================

-- 1. 更新菜单路径
UPDATE permissions SET path = '/ingredients' WHERE code = 'menu:query';
UPDATE permissions SET path = '/purchase-entry' WHERE code = 'menu:entry';

-- 2. 更新食材管理的路径（前端实际是 /ingredient-manager）
UPDATE permissions SET path = '/ingredient-manager' WHERE code = 'menu:ingredients';

-- 3. 添加企业微信管理菜单
INSERT INTO permissions (id, module_id, code, name, type, parent_id, path, icon, sort_order, status)
SELECT UUID(), (SELECT id FROM modules WHERE code = 'food-purchase'), 'menu:wecom', '企业微信管理', 'menu', NULL, '/wecom', 'Settings', 12, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'menu:wecom');

-- 4. 更新供应商管理菜单路径（暂时改为采购录入，后续需要添加供应商管理页面）
-- 或者如果前端还没有供应商管理页面，可以先隐藏它
UPDATE permissions SET status = 0 WHERE code = 'menu:suppliers';

-- 5. 为管理员角色添加企微管理权限
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'admin' AND p.code = 'menu:wecom'
AND NOT EXISTS (
  SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
);

-- 验证
SELECT p.code, p.name, p.path, p.status
FROM permissions p
WHERE p.type = 'menu' AND p.status = 1
ORDER BY p.sort_order ASC;

SELECT '007_fix_menu_paths.sql 执行完成' AS message;