-- ================================================
-- 023 - 修复users表role字段长度和timyan角色数据
-- ================================================

-- 1. 修复users表role字段长度（至少需要30字符）
ALTER TABLE users MODIFY COLUMN role VARCHAR(50) DEFAULT NULL COMMENT '角色代码';

-- 2. 修复timyan的角色数据
SET @timyan_user_id = (SELECT id FROM users WHERE username = 'timyan');
SET @admin_role_id = (SELECT id FROM roles WHERE code = 'admin');
SET @viewer_role_id = (SELECT id FROM roles WHERE code = 'viewer');
SET @temp_auditor_role_id = (SELECT id FROM roles WHERE code = 'temp_auditor');

-- 确保 timyan 有 temp_auditor 和 viewer 角色（幂等，不删除已分配的其他角色）
INSERT IGNORE INTO user_roles (id, user_id, role_id) VALUES (UUID(), @timyan_user_id, @temp_auditor_role_id);
INSERT IGNORE INTO user_roles (id, user_id, role_id) VALUES (UUID(), @timyan_user_id, @viewer_role_id);

-- 更新主角色
UPDATE users 
SET role_id = @temp_auditor_role_id, role = 'temp_auditor'
WHERE id = @timyan_user_id;

-- 验证结果
SELECT '=== timyan 修复后角色 ===' AS section;
SELECT id, username, name, role, role_id FROM users WHERE username = 'timyan';

SELECT '=== timyan 在 user_roles 表中的角色 ===' AS section;
SELECT ur.id, ur.user_id, ur.role_id, r.code, r.name 
FROM user_roles ur
JOIN roles r ON ur.role_id = r.id
WHERE ur.user_id = @timyan_user_id;

SELECT '023_fix_users_role_field.sql 执行完成' AS message;