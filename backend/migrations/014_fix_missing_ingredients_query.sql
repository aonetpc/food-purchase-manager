-- ================================================
-- 014 - 修复食材价格查询权限丢失问题
-- 
-- 问题：013迁移脚本删除了 menu:ingredients，但这个权限是从 menu:query 复制来的（食材价格查询），
--       不是旧的食材管理权限。导致 viewer 等角色丢失了"食材价格查询"菜单。
-- 
-- 修复：
-- 1. 确保 menu:ingredients（食材价格查询）权限存在
-- 2. 修正 menu:ingredient-manager 的名称为"食材管理"
-- 3. 为所有角色分配正确的权限
-- ================================================

-- ================================================
-- 1. 确保 menu:ingredients（食材价格查询）权限存在
-- ================================================
INSERT IGNORE INTO permissions (id, module_id, code, name, type, parent_id, path, icon, sort_order, status) VALUES
  (UUID(), 'food-purchase', 'menu:ingredients', '食材价格查询', 'menu', NULL, '/ingredients', 'Search', 5, 1);

-- ================================================
-- 2. 修正 menu:ingredient-manager 的名称为"食材管理"
-- ================================================
UPDATE permissions SET name = '食材管理' WHERE code = 'menu:ingredient-manager' AND name != '食材管理';

-- ================================================
-- 3. 为各角色分配正确的权限
-- ================================================

-- viewer: 食材价格查询
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'viewer' AND p.code = 'menu:ingredients';

-- finance: 食材价格查询
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'finance' AND p.code = 'menu:ingredients';

-- boss: 食材价格查询
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'boss' AND p.code = 'menu:ingredients';

-- admin: 所有权限（确保包含新增的）
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'admin' AND p.status = 1;

-- ================================================
-- 4. 验证结果
-- ================================================
SELECT p.code, p.name, p.path 
FROM permissions p 
WHERE p.type = 'menu' AND p.code IN ('menu:ingredients', 'menu:ingredient-manager')
ORDER BY p.code;

SELECT '修复完成' AS message;
