-- ================================================
-- 008 - 修复用户管理权限缺失问题
-- 前端路由配置使用 action:user:manage，但数据库中缺少此权限
-- ================================================

-- 1. 添加用户管理权限
INSERT INTO permissions (id, module_id, code, name, type, parent_id, sort_order, status)
SELECT UUID(), (SELECT id FROM modules WHERE code = 'food-purchase'), 'action:user:manage', '用户管理', 'button', NULL, 25, 1
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'action:user:manage');

-- 2. 为管理员角色添加用户管理权限
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'admin' AND p.code = 'action:user:manage'
AND NOT EXISTS (
  SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
);

-- 3. 验证
SELECT p.code, p.name, p.type FROM permissions p WHERE p.code LIKE 'action:user:%';

SELECT '008_fix_user_manage_permission.sql 执行完成' AS message;