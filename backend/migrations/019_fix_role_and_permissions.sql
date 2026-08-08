-- ================================================
-- 019 - 角色代码修正 + 角色权限增量补充（纯增量，绝不再 DELETE role_permissions）
--
-- 说明：原脚本会 DELETE viewer/temp_auditor/temp_chairman 的管理类菜单权限，
--       为避免每次部署覆盖管理员在后台手动配置的权限，现改为：
--         - 保留对 users 表 role/role_id 字段的一致性修正（安全 UPDATE）
--         - 移除所有 DELETE role_permissions
--         - 所有权限分配都走 NOT EXISTS 增量 INSERT
-- ================================================

-- 1. 同步 users 表的 role 字段（存储角色代码，保持和 roles 表一致）
UPDATE users u
JOIN roles r ON u.role_id = r.id
SET u.role = r.code
WHERE u.role_id IS NOT NULL AND u.role != r.code;

-- ================================================
-- 原 019 第2步：删除管理类菜单权限的 DELETE 操作已移除
--   原因：每次部署都会删掉管理员在后台手动勾选的权限
--   替代：管理员若要撤销某角色的某菜单，直接在"角色管理"界面取消勾选即可
-- ================================================

-- 3. admin：确保拥有所有 status=1 的菜单权限（只补缺失）
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

-- 4. viewer：增量补充基础查看类菜单权限
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

-- 5. temp_auditor：增量补充外请人员相关菜单权限
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('menu:temp-audit', 'menu:temp-assessments', 'menu:temp-stats', 'menu:daily')
WHERE r.code = 'temp_auditor'
  AND p.type = 'menu'
  AND p.status = 1
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- 6. temp_chairman：增量补充外请看板/基础查看权限
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

SELECT '019_fix_role_and_permissions.sql 执行完成（增量模式，不删除）' AS message;
