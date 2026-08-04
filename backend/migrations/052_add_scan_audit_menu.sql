-- 052 - 新增领料审核菜单权限

-- 新增菜单权限
INSERT IGNORE INTO permissions (id, module_id, code, name, type, parent_id, path, icon, sort_order, status)
VALUES (UUID(), 'warehouse', 'menu:scan-audit', '领料审核', 'menu', NULL, '/scan-audit', 'ScanLine', 6, 1);

-- 给 admin 角色分配
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'admin' AND p.code = 'menu:scan-audit';

-- 给 finance 角色分配
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'finance' AND p.code = 'menu:scan-audit';
