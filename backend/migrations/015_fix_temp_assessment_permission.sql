-- ================================================
-- 015 - 修复月底考核权限码不匹配问题
-- 
-- 问题：数据库中的权限码是 menu:temp-assessments（复数），
--       但前端使用的是 menu:temp-assessment（单数），
--       导致权限验证失败，用户打开月底考核页面时被重定向到其他页面。
-- 
-- 修复：
-- 1. 将 menu:temp-assessments 重命名为 menu:temp-assessment（单数）
-- 2. 确保 temp_auditor 角色拥有 menu:temp-assessment 权限
-- 3. 确保 temp_auditor 角色拥有 menu:temp-audit 权限（PC端打卡审核）
-- ================================================

-- ================================================
-- 1. 将 menu:temp-assessments 重命名为 menu:temp-assessment
-- ================================================
UPDATE permissions SET code = 'menu:temp-assessment' WHERE code = 'menu:temp-assessments';

-- ================================================
-- 2. 确保 menu:temp-assessment（月底考核）权限存在且配置正确
-- ================================================
INSERT IGNORE INTO permissions (id, module_id, code, name, type, parent_id, path, icon, sort_order, status) VALUES
  (UUID(), 'temp-worker', 'menu:temp-assessment', '月底考核', 'menu', NULL, '/temp-assessment', 'Calendar', 4, 1);

-- ================================================
-- 3. 确保 menu:temp-audit（PC端打卡审核）权限存在
-- ================================================
INSERT IGNORE INTO permissions (id, module_id, code, name, type, parent_id, path, icon, sort_order, status) VALUES
  (UUID(), 'temp-worker', 'menu:temp-audit', '打卡审核', 'menu', NULL, '/temp-audit', 'Check', 5, 1);

-- ================================================
-- 4. 为 temp_auditor 角色分配正确的权限
-- ================================================
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'temp_auditor'
  AND p.code IN ('menu:temp-audit', 'menu:temp-assessment', 'menu:temp-stats');

-- ================================================
-- 5. 为 admin 角色确保拥有所有外请模块权限
-- ================================================
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'admin'
  AND p.module_id = 'temp-worker';

-- ================================================
-- 6. 验证结果
-- ================================================
SELECT p.code, p.name, p.path 
FROM permissions p 
WHERE p.type = 'menu' AND p.module_id = 'temp-worker'
ORDER BY p.sort_order;

SELECT r.code AS role_code, p.code AS permission_code, p.name AS permission_name
FROM roles r
JOIN role_permissions rp ON r.id = rp.role_id
JOIN permissions p ON rp.permission_id = p.id
WHERE r.code = 'temp_auditor' AND p.type = 'menu'
ORDER BY p.sort_order;

SELECT '015_fix_temp_assessment_permission.sql 执行完成' AS message;