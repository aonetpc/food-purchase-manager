-- ================================================
-- 049 - 注册供应商对账中心菜单权限
-- 将 menu:supplier-reconciliation 权限注册到数据库
-- 并分配给 admin / finance / purchaser 角色
-- ================================================

-- 1. 插入权限定义到 food-purchase 模块
INSERT IGNORE INTO permissions (id, module_id, code, name, type, parent_id, path, icon, sort_order, status) VALUES
  (UUID(), 'food-purchase', 'menu:supplier-reconciliation', '供应商对账中心', 'menu', NULL, '/supplier-reconciliation', 'Scale', 7, 1);

-- 2. admin 角色：拥有所有菜单权限（幂等补充）
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'admin' AND p.code = 'menu:supplier-reconciliation'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- 3. finance（财务）角色：分配对账中心菜单
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'finance' AND p.code = 'menu:supplier-reconciliation'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- 4. purchaser（采购员）角色：分配对账中心菜单
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'purchaser' AND p.code = 'menu:supplier-reconciliation'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- 验证
SELECT r.code AS role_code, r.name AS role_name, p.code AS perm_code, p.name AS perm_name
FROM roles r
JOIN role_permissions rp ON r.id = rp.role_id
JOIN permissions p ON rp.permission_id = p.id
WHERE p.code = 'menu:supplier-reconciliation'
ORDER BY r.code;

SELECT '049_add_supplier_reconciliation_permission.sql 执行完成' AS message;
