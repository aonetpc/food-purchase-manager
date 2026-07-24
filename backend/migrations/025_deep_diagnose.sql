-- ================================================
-- 025 - 深度诊断：检查admin和timyan用户数据
-- ================================================

-- 1. 查看所有用户的完整数据
SELECT '=== 所有用户完整数据 ===' AS section;
SELECT id, username, name, role, role_id, status FROM users ORDER BY username;

-- 2. 查看 user_roles 表中所有记录
SELECT '=== user_roles 表所有记录 ===' AS section;
SELECT ur.id, ur.user_id, u.username AS user_name, ur.role_id, r.code AS role_code, r.name AS role_name
FROM user_roles ur
JOIN users u ON ur.user_id = u.id
JOIN roles r ON ur.role_id = r.id
ORDER BY u.username, r.sort_order;

-- 3. 检查是否有重复的用户名或ID
SELECT '=== 重复用户名检查 ===' AS section;
SELECT username, COUNT(*) as cnt FROM users GROUP BY username HAVING COUNT(*) > 1;

SELECT '=== 重复ID检查 ===' AS section;
SELECT id, COUNT(*) as cnt FROM users GROUP BY id HAVING COUNT(*) > 1;

-- 4. 检查 admin 用户的权限
SELECT '=== admin 用户权限 ===' AS section;
SELECT p.code, p.name, p.type FROM users u
JOIN user_roles ur ON u.id = ur.user_id
JOIN role_permissions rp ON ur.role_id = rp.role_id
JOIN permissions p ON rp.permission_id = p.id
WHERE u.username = 'admin'
ORDER BY p.type, p.sort_order;

-- 5. 检查 timyan 用户的权限
SELECT '=== timyan 用户权限 ===' AS section;
SELECT p.code, p.name, p.type FROM users u
JOIN user_roles ur ON u.id = ur.user_id
JOIN role_permissions rp ON ur.role_id = rp.role_id
JOIN permissions p ON rp.permission_id = p.id
WHERE u.username = 'timyan'
ORDER BY p.type, p.sort_order;

-- 6. 检查管理员角色的权限
SELECT '=== admin 角色权限 ===' AS section;
SELECT p.code, p.name, p.type FROM roles r
JOIN role_permissions rp ON r.id = rp.role_id
JOIN permissions p ON rp.permission_id = p.id
WHERE r.code = 'admin'
ORDER BY p.type, p.sort_order;

SELECT '025_deep_diagnose.sql 执行完成' AS message;