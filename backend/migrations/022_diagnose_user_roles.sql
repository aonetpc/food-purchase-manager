-- ================================================
-- 022 - 修复用户角色数据：确保timyan有正确的角色
-- ================================================

-- 1. 查看 timyan 当前的角色数据
SELECT '=== timyan 当前角色数据 ===' AS section;
SELECT id, username, name, role, role_id FROM users WHERE username = 'timyan';

SELECT '=== timyan 在 user_roles 表中的角色 ===' AS section;
SELECT ur.id, ur.user_id, ur.role_id, r.code, r.name 
FROM user_roles ur
JOIN roles r ON ur.role_id = r.id
WHERE ur.user_id = (SELECT id FROM users WHERE username = 'timyan');

-- 2. 检查所有角色定义
SELECT '=== 所有角色定义 ===' AS section;
SELECT id, code, name FROM roles ORDER BY sort_order;

-- 3. 检查 users 表的 role 字段长度
SELECT '=== users 表结构 ===' AS section;
SELECT column_name, data_type, character_maximum_length 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE table_name = 'users' AND column_name IN ('role', 'role_id');

SELECT '022_diagnose_user_roles.sql 执行完成' AS message;