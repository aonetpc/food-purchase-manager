-- ================================================
-- 019 - 彻底修复角色代码和权限配置
-- ================================================

-- 1. 更新用户表中的 role 字段，确保它存储的是角色代码
UPDATE users u
JOIN roles r ON u.role_id = r.id
SET u.role = r.code
WHERE u.role_id IS NOT NULL AND u.role != r.code;

-- 2. 删除所有非管理员角色的管理类菜单权限
DELETE FROM role_permissions
WHERE role_id IN (SELECT id FROM roles WHERE code IN ('viewer', 'temp_auditor', 'temp_chairman'))
  AND permission_id IN (SELECT id FROM permissions WHERE code IN (
    'menu:users', 'menu:roles', 'menu:categories', 'menu:ingredient-manager', 
    'menu:departments', 'menu:wecom', 'menu:purchase-entry', 'menu:reimbursement',
    'menu:temp-positions', 'menu:temp-workers'
  ));

-- 3. 确保管理员拥有所有菜单权限
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'admin'
  AND p.type = 'menu'
  AND p.status = 1
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp 
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- 4. 确保查看员只有查看类菜单权限
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('menu:daily', 'menu:monthly', 'menu:yearly', 'menu:ingredients')
WHERE r.code = 'viewer'
  AND p.type = 'menu'
  AND p.status = 1
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp 
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- 5. 确保外请审核员只有外请人员相关菜单权限
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('menu:temp-audit', 'menu:temp-assessment', 'menu:temp-stats', 'menu:daily')
WHERE r.code = 'temp_auditor'
  AND p.type = 'menu'
  AND p.status = 1
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp 
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- 6. 确保外请董事长只有查看类菜单权限
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('menu:temp-stats', 'menu:daily')
WHERE r.code = 'temp_chairman'
  AND p.type = 'menu'
  AND p.status = 1
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp 
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- 验证修复结果
SELECT '=== 用户表角色代码 ===' AS section;
SELECT id, username, name, role, role_id FROM users WHERE status = 1;

SELECT '=== 各角色菜单权限 ===' AS section;
SELECT r.code as role_code, r.name as role_name, p.code as perm_code, p.name as perm_name, p.path
FROM roles r
JOIN role_permissions rp ON r.id = rp.role_id
JOIN permissions p ON rp.permission_id = p.id
WHERE r.code IN ('admin', 'viewer', 'temp_auditor', 'temp_chairman')
  AND p.type = 'menu'
ORDER BY r.code, p.sort_order;

SELECT '019_fix_role_and_permissions.sql 执行完成' AS message;