-- 053 - 新增管理报表菜单权限

INSERT IGNORE INTO permissions (id, module_id, code, name, type, parent_id, path, icon, sort_order, status)
VALUES (UUID(), 'food-purchase', 'menu:management-report', '管理报表', 'menu', NULL, '/management-report', 'FileBarChart', 3, 1);

-- 给 admin 角色分配
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'admin' AND p.code = 'menu:management-report';

-- 给 finance 角色分配
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'finance' AND p.code = 'menu:management-report';

-- 给 boss 角色分配（若存在）
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'boss' AND p.code = 'menu:management-report';
