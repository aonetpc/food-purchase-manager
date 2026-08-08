-- ================================================
-- 009 - 完整修复菜单路径和权限问题
-- 使用已知的模块ID或自动查找
-- ================================================

-- ================================================
-- 1. 更新所有菜单路径
-- ================================================
UPDATE permissions SET path = '/ingredients', name = '食材价格查询' WHERE code = 'menu:query';
UPDATE permissions SET path = '/purchase-entry' WHERE code = 'menu:entry';
UPDATE permissions SET path = '/ingredient-manager', name = '食材管理' WHERE code = 'menu:ingredients';
UPDATE permissions SET path = '/users', name = '用户管理' WHERE code = 'menu:users';
UPDATE permissions SET path = '/categories', name = '分类管理' WHERE code = 'menu:categories';
UPDATE permissions SET path = '/departments', name = '部门管理' WHERE code = 'menu:departments';
UPDATE permissions SET path = '/reimbursement', name = '报销管理' WHERE code = 'menu:reimbursement';
UPDATE permissions SET path = '/daily', name = '每日采购清单' WHERE code = 'menu:daily';
UPDATE permissions SET path = '/monthly', name = '月度价格分析' WHERE code = 'menu:monthly';
UPDATE permissions SET path = '/yearly', name = '年度平均价查询' WHERE code = 'menu:yearly';

-- ================================================
-- 2. 隐藏供应商管理（前端暂无页面）
-- ================================================
UPDATE permissions SET status = 0 WHERE code = 'menu:suppliers';

-- ================================================
-- 3. 添加企业微信管理菜单（使用已有的模块ID）
-- ================================================
INSERT INTO permissions (id, module_id, code, name, type, parent_id, path, icon, sort_order, status)
SELECT UUID(), m.id, 'menu:wecom', '企业微信管理', 'menu', NULL, '/wecom', 'Settings', 12, 1
FROM modules m
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'menu:wecom')
LIMIT 1;

-- ================================================
-- 4. 添加用户管理权限（前端路由需要）
-- ================================================
INSERT INTO permissions (id, module_id, code, name, type, parent_id, sort_order, status)
SELECT UUID(), m.id, 'action:user:manage', '用户管理', 'button', NULL, 25, 1
FROM modules m
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'action:user:manage')
LIMIT 1;

-- ================================================
-- 5. 增量补充各角色的基础菜单权限（NOT EXISTS 保证不覆盖用户手动配置）
--    注意：绝不再 DELETE role_permissions，以免每次部署覆盖管理员在页面上的手动配置
-- ================================================

-- 5.1 admin：补充缺失的菜单权限（只增不改不删）
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

-- 5.2 finance：增量补充基础查看/导出权限（白名单里如果已配置则跳过）
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'menu:daily', 'menu:monthly', 'menu:yearly', 'menu:query',
  'menu:m-daily', 'menu:m-yearly', 'menu:m-query', 'menu:m-monthly',
  'action:entry:export', 'action:reimbursement:export'
)
WHERE r.code = 'finance'
  AND p.status = 1
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- 5.3 boss：增量补充基础查看/导出权限（白名单里如果已配置则跳过）
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'menu:daily', 'menu:monthly', 'menu:yearly', 'menu:query',
  'menu:m-daily', 'menu:m-yearly', 'menu:m-query', 'menu:m-monthly',
  'action:entry:export'
)
WHERE r.code = 'boss'
  AND p.status = 1
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- 5.4 viewer：增量补充基础查看权限（只增不改不删）
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'menu:daily', 'menu:yearly', 'menu:query',
  'menu:m-daily', 'menu:m-yearly', 'menu:m-query'
)
WHERE r.code = 'viewer'
  AND p.status = 1
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- ================================================
-- 9. 验证结果
-- ================================================
SELECT 
  p.code, 
  p.name, 
  p.path, 
  p.type,
  p.status
FROM permissions p
WHERE p.type = 'menu'
ORDER BY p.sort_order ASC;

SELECT 
  r.code AS role_code,
  COUNT(rp.permission_id) AS perm_count
FROM roles r
LEFT JOIN role_permissions rp ON r.id = rp.role_id
GROUP BY r.code;

SELECT '009_full_menu_fix.sql 执行完成' AS message;