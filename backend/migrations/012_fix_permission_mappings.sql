-- ================================================
-- 012 - 修复权限码与前端菜单不匹配问题
-- 
-- 问题：数据库中的权限码与前端菜单配置不一致，导致：
-- 1. 侧边栏菜单无法根据权限正确显示
-- 2. 角色权限配置页面显示的名称与实际菜单名称不一致
-- 
-- 修复内容：
-- 1. 新增缺失的菜单权限：menu:temp-audit, menu:roles, menu:wecom
-- 2. 修正权限码：menu:query -> menu:ingredients, menu:entry -> menu:purchase-entry, menu:ingredients -> menu:ingredient-manager
-- 3. 修正权限名称与前端菜单名称一致
-- 4. 确保admin拥有所有新增权限
-- ================================================

-- ================================================
-- 1. 新增缺失的菜单权限
-- ================================================
-- 打卡审核（前端使用 menu:temp-audit）
INSERT IGNORE INTO permissions (id, module_id, code, name, type, parent_id, path, icon, sort_order, status) VALUES
  (UUID(), 'temp-worker', 'menu:temp-audit', '打卡审核', 'menu', NULL, '/temp-audit', 'Check', 4, 1);

-- 角色管理（前端使用 menu:roles）
INSERT IGNORE INTO permissions (id, module_id, code, name, type, parent_id, path, icon, sort_order, status) VALUES
  (UUID(), 'food-purchase', 'menu:roles', '角色管理', 'menu', NULL, '/roles', 'Shield', 12, 1);

-- 企业微信管理（前端使用 menu:wecom）
INSERT IGNORE INTO permissions (id, module_id, code, name, type, parent_id, path, icon, sort_order, status) VALUES
  (UUID(), 'food-purchase', 'menu:wecom', '企业微信管理', 'menu', NULL, '/wecom', 'Smartphone', 13, 1);

-- ================================================
-- 2. 修正权限码以匹配前端菜单配置
-- ================================================
-- menu:query -> menu:ingredients（食材价格查询）
-- 前端使用 menu:ingredients，数据库是 menu:query
INSERT INTO permissions (id, module_id, code, name, type, parent_id, path, icon, sort_order, status)
SELECT UUID(), p.module_id, 'menu:ingredients', p.name, p.type, p.parent_id, '/ingredients', p.icon, p.sort_order, p.status
FROM permissions p
WHERE p.code = 'menu:query' AND NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'menu:ingredients');

-- menu:entry -> menu:purchase-entry（采购录入）
-- 前端使用 menu:purchase-entry，数据库是 menu:entry
INSERT INTO permissions (id, module_id, code, name, type, parent_id, path, icon, sort_order, status)
SELECT UUID(), p.module_id, 'menu:purchase-entry', p.name, p.type, p.parent_id, '/purchase-entry', p.icon, p.sort_order, p.status
FROM permissions p
WHERE p.code = 'menu:entry' AND NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'menu:purchase-entry');

-- menu:ingredients -> menu:ingredient-manager（食材管理）
-- 前端使用 menu:ingredient-manager，数据库是 menu:ingredients
INSERT INTO permissions (id, module_id, code, name, type, parent_id, path, icon, sort_order, status)
SELECT UUID(), p.module_id, 'menu:ingredient-manager', p.name, p.type, p.parent_id, '/ingredient-manager', p.icon, p.sort_order, p.status
FROM permissions p
WHERE p.code = 'menu:ingredients' AND NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'menu:ingredient-manager');

-- ================================================
-- 3. 修正权限名称与前端菜单名称一致
-- ================================================
-- 月度价格分析 -> 月度价格分析（已一致）
-- 年度平均价查询 -> 年度均价查询
UPDATE permissions SET name = '年度均价查询' WHERE code = 'menu:yearly' AND name = '年度平均价查询';

-- 食材价格查询（menu:query）保持不变
-- 采购录入保持不变
-- 报销管理保持不变
-- 用户管理保持不变
-- 分类管理保持不变
-- 食材管理保持不变
-- 部门管理保持不变

-- 外请人员保持不变
-- 岗位管理保持不变
-- 审核员管理保持不变
-- 考核管理 -> 月底考核（menu:temp-assessments）
UPDATE permissions SET name = '月底考核', path = '/temp-assessment' WHERE code = 'menu:temp-assessments' AND name = '考核管理';

-- 统计分析 -> 统计看板（menu:temp-stats）
UPDATE permissions SET name = '统计看板' WHERE code = 'menu:temp-stats' AND name = '统计分析';

-- ================================================
-- 4. 为所有角色同步新增的权限
-- ================================================
-- admin 角色：拥有所有权限（包括新增的）
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'admin';

-- viewer 角色：添加 menu:ingredients（食材价格查询）
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'viewer' AND p.code IN ('menu:ingredients');

-- finance 角色：添加 menu:ingredients（食材价格查询）
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'finance' AND p.code IN ('menu:ingredients');

-- boss 角色：添加 menu:ingredients（食材价格查询）
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'boss' AND p.code IN ('menu:ingredients');

-- temp_auditor 角色：添加 PC端打卡审核和统计看板
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'temp_auditor'
  AND p.code IN ('menu:temp-audit', 'menu:temp-stats', 'menu:temp-assessments');

-- ================================================
-- 5. 更新旧权限码的角色权限关联（确保兼容性）
-- ================================================
-- 将 menu:query 的权限关联复制到 menu:ingredients
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), rp.role_id, p_new.id
FROM role_permissions rp
JOIN permissions p_old ON rp.permission_id = p_old.id
JOIN permissions p_new ON p_new.code = 'menu:ingredients'
WHERE p_old.code = 'menu:query';

-- 将 menu:entry 的权限关联复制到 menu:purchase-entry
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), rp.role_id, p_new.id
FROM role_permissions rp
JOIN permissions p_old ON rp.permission_id = p_old.id
JOIN permissions p_new ON p_new.code = 'menu:purchase-entry'
WHERE p_old.code = 'menu:entry';

-- 将 menu:ingredients 的权限关联复制到 menu:ingredient-manager
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), rp.role_id, p_new.id
FROM role_permissions rp
JOIN permissions p_old ON rp.permission_id = p_old.id
JOIN permissions p_new ON p_new.code = 'menu:ingredient-manager'
WHERE p_old.code = 'menu:ingredients';

-- ================================================
-- 6. 验证
-- ================================================
SELECT '权限修复完成' AS message;
SELECT p.code, p.name, p.path FROM permissions p WHERE p.type = 'menu' ORDER BY p.code;
