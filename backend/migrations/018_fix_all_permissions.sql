-- ================================================
-- 018 - 增量补充所有角色权限（纯增量，绝不再 DELETE role_permissions）
--
-- 说明：原脚本会删除 viewer/temp_auditor/temp_chairman 的管理类菜单权限，
--       为避免每次部署覆盖管理员在后台手动配置的权限，现改为纯增量补充：
--       - 不删除任何 role_permissions 记录
--       - 只在权限缺失（NOT EXISTS）时插入
--       - 管理员若要移除某角色的某菜单，请在"角色管理"界面取消勾选
-- ================================================

-- 查看当前角色权限（只读诊断）
SELECT r.code, p.code as perm_code, p.name as perm_name, p.path
FROM roles r
JOIN role_permissions rp ON r.id = rp.role_id
JOIN permissions p ON rp.permission_id = p.id
WHERE r.code IN ('admin', 'viewer', 'temp_auditor', 'temp_chairman')
  AND p.type = 'menu'
ORDER BY r.code, p.sort_order;

-- 1. 确保 admin 拥有所有 status=1 的菜单权限（缺失才插入）
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

-- 2. 确保 viewer 拥有基础查看类菜单（缺失才插入）
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

-- 3. 确保 temp_auditor 拥有外请人员相关菜单（缺失才插入）
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

-- 4. 确保 temp_chairman 拥有外请看板/基础查看（缺失才插入）
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
SELECT r.code as role_code, r.name as role_name, p.code as perm_code, p.name as perm_name, p.path
FROM roles r
JOIN role_permissions rp ON r.id = rp.role_id
JOIN permissions p ON rp.permission_id = p.id
WHERE r.code IN ('admin', 'viewer', 'temp_auditor', 'temp_chairman')
  AND p.type = 'menu'
ORDER BY r.code, p.sort_order;

SELECT '018_fix_all_permissions.sql 执行完成（增量模式，不删除）' AS message;
