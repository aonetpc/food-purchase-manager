-- ================================================
-- 062 - 合并权限菜单：/users + /roles → /permission（权限管理）
--
-- 背景：前端已把「用户管理」和「角色管理」合并为同一个菜单「权限管理」
--       通过 Tab 切换，但后端 RBAC 里还是两条独立菜单记录，
--       导致后端返回的菜单路径（/users、/roles）不在前端 Layout
--       的 menuGroups 分组中，被静默丢弃 → 左侧菜单不显示。
--
-- 修复内容：
--   1. 确保 permissions 表中存在 menu:permission（权限管理）菜单记录
--   2. 任何角色只要原来有 menu:users 或 menu:roles 任意一个，
--      就自动补一条 menu:permission 的关联（role_permissions）
--   3. 幂等执行：可重复执行不会报错
-- ================================================

-- ================================================
-- 1. 插入 menu:permission 菜单权限（如果不存在）
-- ================================================
INSERT IGNORE INTO permissions (id, module_id, code, name, type, parent_id, path, icon, sort_order, status)
SELECT UUID(), module_id, 'menu:permission', '权限管理', 'menu', NULL, '/permission', 'Shield', 1, 1
FROM permissions
WHERE code = 'menu:users'
LIMIT 1;

-- 如果上面因没有 menu:users 兜底失败，再按 food-purchase 模块直接插入（module_id 不存在会用 NULL）
INSERT IGNORE INTO permissions (id, module_id, code, name, type, parent_id, path, icon, sort_order, status)
VALUES (
  UUID(),
  COALESCE((SELECT module_id FROM permissions WHERE code = 'menu:users' LIMIT 1),
           (SELECT module_id FROM permissions WHERE code = 'menu:roles' LIMIT 1),
           'food-purchase'),
  'menu:permission',
  '权限管理',
  'menu',
  NULL,
  '/permission',
  'Shield',
  1,
  1
);

-- 校正 menu:permission 记录（针对可能存在但字段不对的情况）
UPDATE permissions
SET module_id = COALESCE((SELECT p.module_id FROM (SELECT module_id FROM permissions WHERE code = 'menu:users' LIMIT 1) p),
                         (SELECT p.module_id FROM (SELECT module_id FROM permissions WHERE code = 'menu:roles' LIMIT 1) p),
                         module_id),
    name = '权限管理',
    path = '/permission',
    icon = 'Shield',
    status = 1,
    type = 'menu'
WHERE code = 'menu:permission';

-- ================================================
-- 2. 把原有 menu:users / menu:roles 的角色关联迁移到 menu:permission
-- ================================================
-- 对每个角色，只要有 menu:users 或 menu:roles 任一权限，就补 menu:permission
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'menu:permission'
WHERE EXISTS (
  SELECT 1 FROM role_permissions rp1
  JOIN permissions p1 ON p1.id = rp1.permission_id
  WHERE rp1.role_id = r.id AND p1.code = 'menu:users'
) OR EXISTS (
  SELECT 1 FROM role_permissions rp2
  JOIN permissions p2 ON p2.id = rp2.permission_id
  WHERE rp2.role_id = r.id AND p2.code = 'menu:roles'
);

-- ================================================
-- 3. 同样处理：menu:categories（分类管理）已合并入「食材管理」菜单
--    确保只要有 menu:categories 的角色，也拥有 menu:ingredient-manager
--    （前端 Layout 分组不再包含 /categories，避免侧边栏菜单再次丢失）
-- ================================================
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'menu:ingredient-manager'
WHERE EXISTS (
  SELECT 1 FROM role_permissions rp
  JOIN permissions pc ON pc.id = rp.permission_id
  WHERE rp.role_id = r.id AND pc.code = 'menu:categories'
);

-- ================================================
-- 4. 验证结果
-- ================================================
SELECT '===== 合并权限菜单验证 =====' AS info;

SELECT 'menu:permission 权限记录:' AS info;
SELECT code, name, path, icon, status FROM permissions WHERE code = 'menu:permission';

SELECT '拥有权限管理菜单的角色:' AS info;
SELECT r.code AS role_code, r.name AS role_name
FROM roles r
JOIN role_permissions rp ON rp.role_id = r.id
JOIN permissions p ON p.id = rp.permission_id
WHERE p.code = 'menu:permission'
ORDER BY r.code;
