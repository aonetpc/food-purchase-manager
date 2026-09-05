-- ================================================
-- 107 - 体检配单/体检中心菜单权限注册 + 预订调度脏数据清理
--
-- 问题背景：
--   1. menu:checkup-center（体检中心）从未在 permissions 表注册，前端 authStore 做了兜底注入
--   2. menu:checkup-templates（体检配单）的 module_id 在 103 迁移里用 COALESCE 兜底，
--      若 063/064 迁移未跑则可能归到 'food-purchase' 模块，导致权限配置弹窗里找不到
--   3. permissions 表唯一约束是 (module_id, code) 联合唯一，code 本身不唯一，
--      导致 name='预订调度' 但 code<>'menu:booking-board' 的脏数据残留
--
-- 修复内容：
--   1. 新增 menu:checkup-center 权限，module_id='booking-board'
--   2. 修正 menu:checkup-templates 的 module_id='booking-board'
--   3. 删除"预订调度"脏数据（name='预订调度' AND code<>'menu:booking-board'）
--   4. 确保 menu:booking-board 的 module_id='booking-board'（064 迁移补正，这里再保险）
--   5. 角色分配双保险：
--      5a. admin/booker 角色直接分配 menu:checkup-center
--      5b. 凡拥有 menu:permission（权限管理）的角色，自动补齐 3 个体检相关菜单
--          （保底兜所有历史数据问题，确保管理员一定能看到这 3 个菜单）
--
-- 幂等执行，可重复运行
-- ================================================

-- ================================================
-- 1. 新增 menu:checkup-center（体检中心）权限
-- ================================================
INSERT IGNORE INTO permissions (id, module_id, code, name, type, parent_id, path, icon, sort_order, status)
SELECT UUID(), 'booking-board', 'menu:checkup-center', '体检中心', 'menu', NULL, '/checkup-center', 'ClipboardList', 2, 1;

-- 已存在则补正
UPDATE permissions
SET module_id = 'booking-board',
    name = '体检中心',
    path = '/checkup-center',
    icon = 'ClipboardList',
    status = 1,
    type = 'menu'
WHERE code = 'menu:checkup-center';

-- ================================================
-- 2. 修正 menu:checkup-templates 的 module_id='booking-board'
--    （103 迁移用 COALESCE 兜底可能归到 food-purchase，这里强制修正）
-- ================================================
UPDATE permissions
SET module_id = 'booking-board', status = 1
WHERE code = 'menu:checkup-templates';

-- ================================================
-- 3. 删除"预订调度"脏数据
--    （name='预订调度' 但 code<>'menu:booking-board' 的残留记录，
--     唯一约束是 (module_id, code)，code 本身不唯一，所以可能存在多条同名）
-- ================================================
DELETE FROM permissions
WHERE name = '预订调度' AND code <> 'menu:booking-board';

-- ================================================
-- 4. 确保 menu:booking-board 的 module_id='booking-board'
--    （064 迁移已修正，这里再保险一次）
-- ================================================
UPDATE permissions
SET module_id = 'booking-board', status = 1
WHERE code = 'menu:booking-board';

-- ================================================
-- 5. 角色分配（双保险）
-- ================================================

-- 5a. admin/booker 角色直接分配 menu:checkup-center
--     - admin：完整可写
--     - booker：可见菜单（页面内只读模式，保持 authStore 兜底的原始行为）
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'menu:checkup-center'
WHERE r.code IN ('admin', 'booker');

-- 5b. 保底：凡拥有 menu:permission（权限管理菜单）的角色，自动补齐 3 个体检相关菜单
--     （防止 admin 角色因历史数据问题没分配到，确保管理员一定能看到这 3 个菜单）
--     注意：只对拥有 menu:permission 的角色触发，不会误伤 sales/booker 等非管理角色
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id
FROM roles r
JOIN role_permissions rp ON rp.role_id = r.id
JOIN permissions pm ON pm.id = rp.permission_id AND pm.code = 'menu:permission'
JOIN permissions p ON p.code IN ('menu:booking-board', 'menu:checkup-templates', 'menu:checkup-center');

-- ================================================
-- 6. 验证
-- ================================================
SELECT '===== 107 体检菜单权限验证 =====' AS info;

SELECT 'booking-board 模块下所有菜单权限:' AS info;
SELECT p.code, p.name, p.path, p.icon, p.status
FROM permissions p
WHERE p.module_id = 'booking-board' AND p.type = 'menu'
ORDER BY p.sort_order;

SELECT '预订调度同名记录（应只剩 1 条 menu:booking-board）:' AS info;
SELECT id, code, name, module_id FROM permissions WHERE name = '预订调度';

SELECT '各角色拥有体检相关菜单情况:' AS info;
SELECT r.code AS role_code, r.name AS role_name, p.code AS perm_code, p.name AS perm_name
FROM roles r
JOIN role_permissions rp ON rp.role_id = r.id
JOIN permissions p ON p.id = rp.permission_id
WHERE p.code IN ('menu:booking-board', 'menu:checkup-templates', 'menu:checkup-center')
ORDER BY r.code, p.code;
