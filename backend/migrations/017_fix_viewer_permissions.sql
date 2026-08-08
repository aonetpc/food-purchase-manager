-- ================================================
-- 017 - 查看员角色权限：增量补充基础查看菜单
-- 原脚本删除了 viewer 的食材管理菜单权限（DELETE），
-- 为避免每次部署覆盖管理员的手动配置，现改为：
--   不删除任何权限；只在缺失时补充 viewer 的基础查看权限。
-- 管理员若需手动从 viewer 移除某菜单，可在后台角色管理中直接取消勾选。
-- ================================================

-- 增量补充 viewer 基础查看权限（仅当权限缺失时插入）
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

-- 验证结果
SELECT
  r.code AS role_code,
  r.name AS role_name,
  p.code AS perm_code,
  p.name AS perm_name,
  p.path
FROM roles r
JOIN role_permissions rp ON r.id = rp.role_id
JOIN permissions p ON rp.permission_id = p.id
WHERE r.code = 'viewer'
  AND p.type = 'menu'
ORDER BY p.sort_order;

SELECT '017_fix_viewer_permissions.sql 执行完成（增量模式）' AS message;
