-- ================================================
-- 063 - 新增预订调度（booking-board）菜单权限
--
-- 作用：
--   1. 向 permissions 表插入 menu:booking-board 菜单记录（预订调度 /booking-board）
--   2. 为现有有管理能力的角色自动关联：
--      - 任一拥有 menu:permission / menu:departments / menu:wecom 的角色
--   3. 幂等执行，可重复运行
-- ================================================

-- ================================================
-- 1. 插入菜单权限（如不存在）
-- ================================================
INSERT IGNORE INTO permissions (id, module_id, code, name, type, parent_id, path, icon, sort_order, status)
SELECT UUID(),
       COALESCE(
         (SELECT p.module_id FROM (SELECT module_id FROM permissions WHERE code = 'menu:permission' LIMIT 1) p),
         (SELECT p.module_id FROM (SELECT module_id FROM permissions WHERE code = 'menu:departments' LIMIT 1) p),
         (SELECT p.module_id FROM (SELECT module_id FROM permissions WHERE code = 'menu:wecom' LIMIT 1) p),
         'food-purchase'
       ) AS module_id,
       'menu:booking-board',
       '预订调度',
       'menu',
       NULL,
       '/booking-board',
       'Calendar',
       1,
       1;

-- 如果 menu:booking-board 已经存在但字段不对，补正
UPDATE permissions
SET module_id = COALESCE(
      (SELECT p.module_id FROM (SELECT module_id FROM permissions WHERE code = 'menu:permission' LIMIT 1) p),
      (SELECT p.module_id FROM (SELECT module_id FROM permissions WHERE code = 'menu:departments' LIMIT 1) p),
      (SELECT p.module_id FROM (SELECT module_id FROM permissions WHERE code = 'menu:wecom' LIMIT 1) p),
      module_id
    ),
    name = '预订调度',
    path = '/booking-board',
    icon = 'Calendar',
    status = 1,
    type = 'menu'
WHERE code = 'menu:booking-board';

-- ================================================
-- 2. 角色关联：给管理类角色自动补 menu:booking-board
-- ================================================
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'menu:booking-board'
WHERE EXISTS (
  -- 该角色原本就有任一管理类菜单权限，则视为管理用户，自动开通预订调度
  SELECT 1
  FROM role_permissions rp
  JOIN permissions pm ON pm.id = rp.permission_id
  WHERE rp.role_id = r.id
    AND pm.code IN ('menu:permission', 'menu:departments', 'menu:wecom', 'menu:ingredient-manager')
);

-- ================================================
-- 3. 验证
-- ================================================
SELECT '===== 预订调度菜单权限验证 =====' AS info;

SELECT 'menu:booking-board 权限记录:' AS info;
SELECT code, name, path, icon, status FROM permissions WHERE code = 'menu:booking-board';

SELECT '拥有预订调度菜单的角色:' AS info;
SELECT r.code AS role_code, r.name AS role_name
FROM roles r
JOIN role_permissions rp ON rp.role_id = r.id
JOIN permissions p ON p.id = rp.permission_id
WHERE p.code = 'menu:booking-board'
ORDER BY r.code;
