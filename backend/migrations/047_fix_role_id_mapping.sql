-- ================================================
-- 047 - 修复 users.role_id 与 roles 表的关联
-- 确保所有用户的 role_id 正确指向 roles 表的 id
-- ================================================

-- 1. 修复 users.role_id：对于有 role 但 role_id 不匹配的用户，用 role 编码查找正确的 role_id
UPDATE users u
JOIN roles r ON u.role = r.code
SET u.role_id = r.id
WHERE u.role IS NOT NULL
  AND (u.role_id IS NULL OR u.role_id NOT IN (SELECT id FROM roles WHERE code = u.role));

-- 2. 同步 user_roles 表：为没有 user_roles 记录但有 role_id 的用户补充记录
INSERT IGNORE INTO user_roles (id, user_id, role_id)
SELECT UUID(), u.id, u.role_id
FROM users u
WHERE u.role_id IS NOT NULL
  AND u.role_id != ''
  AND NOT EXISTS (
    SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_id = u.role_id
  );

-- 3. 验证结果
SELECT '047_fix_role_id_mapping.sql 执行完成' AS message;
