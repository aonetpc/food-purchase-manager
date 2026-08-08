-- ================================================
-- 016 - 增量补充角色权限配置（纯增量，绝不删除 role_permissions）
-- 说明：此迁移原本用于清理后重建，为避免每次部署覆盖管理员的手动配置，
--       现改为只在权限缺失时补充（NOT EXISTS），不删除、不修改已有配置。
-- ================================================

-- 1. 增量补充 viewer（普通员工）基础查看权限
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'menu:daily', 'menu:yearly', 'menu:ingredients',
  'menu:m-daily', 'menu:m-yearly', 'menu:m-query'
)
WHERE r.code = 'viewer'
  AND p.status = 1
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- 2. 增量补充 temp_auditor（外请审核员）权限
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  -- PC端菜单
  'menu:temp-audit', 'menu:temp-assessments', 'menu:temp-stats',
  -- 基础查看
  'menu:daily', 'menu:m-daily',
  -- 移动端
  'menu:m-temp-audit', 'menu:m-temp-assessment', 'menu:m-temp-stats',
  -- 操作权限
  'action:temp-worker:manage', 'action:temp-position:manage',
  'action:temp-auditor:manage', 'action:temp-assessment:manage',
  'action:temp-stats:view'
)
WHERE r.code = 'temp_auditor'
  AND p.status = 1
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- 3. 增量补充 temp_chairman（外请董事长）只读权限
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'menu:temp-stats', 'menu:daily', 'menu:m-daily', 'menu:m-temp-stats'
)
WHERE r.code = 'temp_chairman'
  AND p.status = 1
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- 4. 移除了原脚本对 finance/boss 删除食材管理菜单的 DELETE 操作
--    管理员若要手动移除某角色菜单，可在后台角色管理中取消勾选，
--    部署脚本不再强制干涉。

-- 5. 验证结果
SELECT
  r.code AS role_code,
  r.name AS role_name,
  p.code AS perm_code,
  p.name AS perm_name
FROM roles r
JOIN role_permissions rp ON r.id = rp.role_id
JOIN permissions p ON rp.permission_id = p.id
WHERE r.code IN ('viewer', 'temp_auditor', 'temp_chairman')
  AND p.type = 'menu'
ORDER BY r.code, p.sort_order;

SELECT '016_fix_role_permissions.sql 执行完成（增量模式）' AS message;
