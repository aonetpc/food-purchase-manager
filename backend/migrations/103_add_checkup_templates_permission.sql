-- ================================================
-- 103 - 新增体检配单（checkup-templates）菜单权限并分配给 sales/admin
--
-- 作用：
--   1. 向 permissions 表插入 menu:checkup-templates 菜单记录
--      （之前未注册，导致前端 authStore 做了"所有用户可见"的兜底）
--   2. 自动给 sales 和 admin 角色关联该菜单权限
--   3. 其他角色不自动分配，由管理员在权限配置页面手动开
--   4. 幂等执行，可重复运行
-- ================================================

-- ================================================
-- 1. 插入菜单权限（如不存在）
-- ================================================
INSERT IGNORE INTO permissions (id, module_id, code, name, type, parent_id, path, icon, sort_order, status)
SELECT UUID(),
       COALESCE(
         (SELECT p.module_id FROM (SELECT module_id FROM permissions WHERE code = 'menu:booking-board' LIMIT 1) p),
         'food-purchase'
       ) AS module_id,
       'menu:checkup-templates',
       '体检配单',
       'menu',
       NULL,
       '/checkup-templates',
       'Stethoscope',
       1,
       1;

-- 如果 menu:checkup-templates 已经存在但字段不对，补正
UPDATE permissions
SET module_id = COALESCE(
      (SELECT p.module_id FROM (SELECT module_id FROM permissions WHERE code = 'menu:booking-board' LIMIT 1) p),
      module_id
    ),
    name = '体检配单',
    path = '/checkup-templates',
    icon = 'Stethoscope',
    status = 1,
    type = 'menu'
WHERE code = 'menu:checkup-templates';

-- ================================================
-- 2. 角色关联：sales 和 admin 角色自动补 menu:checkup-templates
-- ================================================
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'menu:checkup-templates'
WHERE r.code IN ('sales', 'admin');

-- ================================================
-- 3. 验证
-- ================================================
SELECT '===== 体检配单菜单权限验证 =====' AS info;

SELECT 'menu:checkup-templates 权限记录:' AS info;
SELECT code, name, path, icon, status FROM permissions WHERE code = 'menu:checkup-templates';

SELECT '拥有体检配单菜单的角色:' AS info;
SELECT r.code AS role_code, r.name AS role_name
FROM roles r
JOIN role_permissions rp ON rp.role_id = r.id
JOIN permissions p ON p.id = rp.permission_id
WHERE p.code = 'menu:checkup-templates'
ORDER BY r.code;
