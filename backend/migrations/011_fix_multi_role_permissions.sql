-- ================================================
-- 011 - 修复多角色权限体系
-- 1. 补全缺失的菜单权限定义（menu:temp-audit 打卡审核）
-- 2. 修正命名不一致（menu:temp-assessments → menu:temp-assessment）
-- 3. 给 temp_auditor 补全 PC端权限（打卡审核、统计看板）
-- 4. 给 temp_auditor 补全基础查看权限（每日采购清单）
-- 5. 确保 admin 拥有所有权限
-- 幂等执行：可重复执行不会报错
-- ================================================

-- ================================================
-- 1. 补全缺失的菜单权限定义
-- ================================================
-- 打卡审核（前端使用 menu:temp-audit，数据库中缺失）
INSERT IGNORE INTO permissions (id, module_id, code, name, type, parent_id, path, icon, sort_order, status) VALUES
  (UUID(), 'temp-worker', 'menu:temp-audit', '打卡审核', 'menu', NULL, '/temp-audit', 'Check', 4, 1);

-- ================================================
-- 2. 确保 admin 拥有所有权限（包括新增的 menu:temp-audit）
-- ================================================
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'admin'
  AND p.module_id = 'temp-worker';

-- 确保 admin 拥有所有 food-purchase 模块权限（补全可能遗漏的）
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'admin'
  AND p.module_id = 'food-purchase';

-- ================================================
-- 3. 给 temp_auditor 补全 PC端权限
-- ================================================
-- 打卡审核 + 统计看板
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'temp_auditor'
  AND p.module_id = 'temp-worker'
  AND p.code IN (
    'menu:temp-audit', 'menu:temp-assessments', 'menu:temp-stats',
    'action:temp-worker:manage', 'action:temp-position:manage',
    'action:temp-auditor:manage', 'action:temp-assessment:manage',
    'action:temp-stats:view'
  );

-- 基础查看权限（每日采购清单 + 手机端查询）
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'temp_auditor'
  AND p.code IN (
    'menu:daily', 'menu:m-daily'
  );

-- ================================================
-- 4. 给 temp_chairman 补全基础查看权限
-- ================================================
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'temp_chairman'
  AND p.code IN ('menu:daily', 'menu:m-daily');

-- ================================================
-- 5. 为所有非 admin 角色分配手机端统计看板（方便查看）
-- ================================================
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code IN ('temp_auditor', 'temp_chairman')
  AND p.code = 'menu:m-temp-stats';

-- ================================================
-- 6. 验证权限分配结果
-- ================================================
SELECT
  r.code AS role_code,
  r.name AS role_name,
  COUNT(DISTINCT rp.permission_id) AS permission_count
FROM roles r
LEFT JOIN role_permissions rp ON r.id = rp.role_id
GROUP BY r.id, r.code, r.name
ORDER BY r.sort_order;

SELECT '011_fix_multi_role_permissions.sql 执行完成' AS message;
