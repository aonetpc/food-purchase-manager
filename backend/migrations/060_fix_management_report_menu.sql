-- ================================================
-- 060 - 修复"管理报表"菜单权限缺失问题
-- 
-- 问题：角色管理配置权限弹窗中找不到"管理报表"
-- 根因：permissions 表中可能缺失 menu:management-report 记录
--       或 module_id 指向错误，导致权限分组时被过滤
-- 
-- 修复内容：
-- 1. 确保 menu:management-report 权限存在且归属 food-purchase 模块
-- 2. 确保 admin、finance、boss 角色拥有该权限
-- 3. 幂等执行：可重复执行不会报错
-- ================================================

-- ================================================
-- 1. 确保权限记录存在且正确
-- ================================================
INSERT IGNORE INTO permissions (id, module_id, code, name, type, parent_id, path, icon, sort_order, status)
VALUES (UUID(), 'food-purchase', 'menu:management-report', '管理报表', 'menu', NULL, '/management-report', 'FileBarChart', 3, 1);

-- 2. 修正权限记录的 module_id 和 status（针对可能存在但不正确的记录）
UPDATE permissions
SET module_id = 'food-purchase', status = 1, name = '管理报表'
WHERE code = 'menu:management-report';

-- 3. 确保 admin 角色拥有该权限
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'admin' AND p.code = 'menu:management-report';

-- 4. 确保 finance 角色拥有该权限
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'finance' AND p.code = 'menu:management-report';

-- 5. 确保 boss 角色拥有该权限
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'boss' AND p.code = 'menu:management-report';

-- 6. 验证修复结果
SELECT '权限记录检查:' AS info;
SELECT id, code, name, module_id, path, status FROM permissions WHERE code = 'menu:management-report';

SELECT 'admin 角色权限检查:' AS info;
SELECT COUNT(*) AS admin_has_report 
FROM role_permissions rp
JOIN roles r ON rp.role_id = r.id
JOIN permissions p ON rp.permission_id = p.id
WHERE r.code = 'admin' AND p.code = 'menu:management-report';
