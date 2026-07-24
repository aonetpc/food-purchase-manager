-- ================================================
-- 024 - 检查并修复 admin 用户角色
-- ================================================

-- 1. 查看 admin 用户当前数据
SELECT '=== admin 用户当前数据 ===' AS section;
SELECT id, username, name, role, role_id FROM users WHERE username = 'admin';

-- 2. 查看 admin 在 user_roles 表中的角色
SELECT '=== admin 在 user_roles 表中的角色 ===' AS section;
SELECT ur.id, ur.user_id, ur.role_id, r.code, r.name 
FROM user_roles ur
JOIN roles r ON ur.role_id = r.id
WHERE ur.user_id = (SELECT id FROM users WHERE username = 'admin');

-- 3. 查看 admin 角色定义
SELECT '=== admin 角色定义 ===' AS section;
SELECT id, code, name FROM roles WHERE code = 'admin';

-- 4. 修复 admin 用户角色（确保他有管理员角色）
SET @admin_user_id = (SELECT id FROM users WHERE username = 'admin');
SET @admin_role_id = (SELECT id FROM roles WHERE code = 'admin');

-- 更新主角色
UPDATE users 
SET role_id = @admin_role_id, role = 'admin'
WHERE id = @admin_user_id;

-- 确保 user_roles 表中有 admin 角色
INSERT INTO user_roles (id, user_id, role_id)
SELECT UUID(), @admin_user_id, @admin_role_id
WHERE NOT EXISTS (
  SELECT 1 FROM user_roles 
  WHERE user_id = @admin_user_id AND role_id = @admin_role_id
);

-- 5. 验证修复结果
SELECT '=== admin 修复后 ===' AS section;
SELECT id, username, name, role, role_id FROM users WHERE username = 'admin';

SELECT '=== admin 在 user_roles 表中 ===' AS section;
SELECT ur.id, ur.user_id, ur.role_id, r.code, r.name 
FROM user_roles ur
JOIN roles r ON ur.role_id = r.id
WHERE ur.user_id = @admin_user_id;

SELECT '024_fix_admin_role.sql 执行完成' AS message;