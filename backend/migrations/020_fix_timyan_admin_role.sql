-- ================================================
-- 020 - 将 timyan 用户分配为管理员角色
-- ================================================

-- 1. 获取管理员角色ID和 timyan 用户ID
SET @admin_role_id = (SELECT id FROM roles WHERE code = 'admin');
SET @timyan_user_id = (SELECT id FROM users WHERE username = 'timyan');

-- 2. 如果 timyan 用户存在，更新其主角色为 admin
UPDATE users 
SET role_id = @admin_role_id, role = 'admin'
WHERE id = @timyan_user_id;

-- 3. 如果 timyan 在 user_roles 表中没有 admin 角色，添加它
INSERT INTO user_roles (user_id, role_id)
SELECT @timyan_user_id, @admin_role_id
WHERE NOT EXISTS (
  SELECT 1 FROM user_roles 
  WHERE user_id = @timyan_user_id AND role_id = @admin_role_id
);

-- 4. 验证结果
SELECT '=== timyan 用户角色 ===' AS section;
SELECT id, username, name, role, role_id FROM users WHERE username = 'timyan';

SELECT '=== timyan 用户多角色 ===' AS section;
SELECT u.username, r.code as role_code, r.name as role_name
FROM users u
JOIN user_roles ur ON u.id = ur.user_id
JOIN roles r ON ur.role_id = r.id
WHERE u.username = 'timyan';

SELECT '020_fix_timyan_admin_role.sql 执行完成' AS message;