-- ================================================
-- 021 - 修复 timyan 用户权限：移除管理员权限
-- ================================================

-- 1. 获取相关ID
SET @timyan_user_id = (SELECT id FROM users WHERE username = 'timyan');
SET @admin_role_id = (SELECT id FROM roles WHERE code = 'admin');
SET @viewer_role_id = (SELECT id FROM roles WHERE code = 'viewer');
SET @temp_auditor_role_id = (SELECT id FROM roles WHERE code = 'temp_auditor');

-- 2. 确保 timyan 的主角色是 temp_auditor（外请审核员）
UPDATE users 
SET role_id = @temp_auditor_role_id, role = 'temp_auditor'
WHERE id = @timyan_user_id;

-- 3. 删除 timyan 的 admin 角色（如果存在）
DELETE FROM user_roles 
WHERE user_id = @timyan_user_id AND role_id = @admin_role_id;

-- 4. 确保 timyan 有 temp_auditor 和 viewer 角色（幂等，不删除已分配的其他角色）
INSERT IGNORE INTO user_roles (id, user_id, role_id) VALUES (UUID(), @timyan_user_id, @temp_auditor_role_id);
INSERT IGNORE INTO user_roles (id, user_id, role_id) VALUES (UUID(), @timyan_user_id, @viewer_role_id);

-- 5. 确保角色权限配置正确
-- 先删除 timyan 的角色可能拥有的错误权限
-- 实际上不需要，因为权限是通过角色关联的

-- 6. 验证结果
SELECT '=== timyan 用户角色修复后 ===' AS section;
SELECT id, username, name, role, role_id FROM users WHERE username = 'timyan';

SELECT '=== timyan 用户多角色 ===' AS section;
SELECT u.username, r.code, r.name FROM users u
JOIN user_roles ur ON u.id = ur.user_id
JOIN roles r ON ur.role_id = r.id
WHERE u.username = 'timyan';

SELECT '=== timyan 用户权限 ===' AS section;
SELECT p.code, p.name, p.type FROM users u
JOIN user_roles ur ON u.id = ur.user_id
JOIN role_permissions rp ON ur.role_id = rp.role_id
JOIN permissions p ON rp.permission_id = p.id
WHERE u.username = 'timyan'
ORDER BY p.type, p.sort_order;

SELECT '021_fix_timyan_permissions.sql 执行完成' AS message;