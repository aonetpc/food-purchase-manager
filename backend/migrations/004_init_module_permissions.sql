-- ================================================
-- 004 - 初始化模块和权限数据
-- 插入"食材采购管理"模块及其所有权限定义
-- 幂等执行：可重复执行不会报错
-- ================================================

-- ================================================
-- 1. 插入业务模块
-- ================================================
INSERT IGNORE INTO modules (id, code, name, icon, description, sort_order, status) VALUES
  ('food-purchase', 'food_purchase', '食材采购管理', 'ShoppingCart', '食材采购全流程管理', 1, 1);

-- ================================================
-- 2. 插入权限定义（菜单权限）
-- ================================================
INSERT IGNORE INTO permissions (id, module_id, code, name, type, parent_id, path, icon, sort_order, status) VALUES
  -- 一级菜单
  (UUID(), 'food-purchase', 'menu:daily',         '每日采购清单', 'menu', NULL, '/daily',         'ShoppingCart', 1, 1),
  (UUID(), 'food-purchase', 'menu:monthly',       '月度价格分析', 'menu', NULL, '/monthly',       'BarChart3',    2, 1),
  (UUID(), 'food-purchase', 'menu:yearly',        '年度平均价查询', 'menu', NULL, '/yearly',        'Calendar',     3, 1),
  (UUID(), 'food-purchase', 'menu:query',         '食材价格查询', 'menu', NULL, '/query',         'Search',       4, 1),
  (UUID(), 'food-purchase', 'menu:entry',         '采购录入',     'menu', NULL, '/entry',         'PlusCircle',   5, 1),
  (UUID(), 'food-purchase', 'menu:reimbursement', '报销管理',     'menu', NULL, '/reimbursement', 'Receipt',      6, 1),
  (UUID(), 'food-purchase', 'menu:users',         '用户管理',     'menu', NULL, '/users',         'Users',        7, 1),
  (UUID(), 'food-purchase', 'menu:categories',    '分类管理',     'menu', NULL, '/categories',    'Tag',          8, 1),
  (UUID(), 'food-purchase', 'menu:ingredients',   '食材管理',     'menu', NULL, '/ingredients',   'Package',      9, 1),
  (UUID(), 'food-purchase', 'menu:departments',   '部门管理',     'menu', NULL, '/departments',   'Building2',    10, 1),
  (UUID(), 'food-purchase', 'menu:suppliers',     '供应商管理',   'menu', NULL, '/suppliers',     'Truck',        11, 1),
  -- 手机端菜单
  (UUID(), 'food-purchase', 'menu:m-daily',       '手机-今日采购',   'menu', NULL, '/m/daily',    'Smartphone',   100, 1),
  (UUID(), 'food-purchase', 'menu:m-yearly',      '手机-年度均价',   'menu', NULL, '/m/yearly',   'Smartphone',   101, 1),
  (UUID(), 'food-purchase', 'menu:m-query',       '手机-食材查询',   'menu', NULL, '/m/query',    'Smartphone',   102, 1),
  (UUID(), 'food-purchase', 'menu:m-monthly',     '手机-月度分析',   'menu', NULL, '/m/monthly',  'Smartphone',   103, 1);

-- ================================================
-- 3. 插入操作权限（按钮/API级别）
-- ================================================
INSERT IGNORE INTO permissions (id, module_id, code, name, type, parent_id, sort_order, status) VALUES
  -- 采购录入相关
  (UUID(), 'food-purchase', 'action:entry:create',       '新增采购记录',   'button', NULL, 1, 1),
  (UUID(), 'food-purchase', 'action:entry:edit',         '编辑采购记录',   'button', NULL, 2, 1),
  (UUID(), 'food-purchase', 'action:entry:delete',       '删除采购记录',   'button', NULL, 3, 1),
  (UUID(), 'food-purchase', 'action:entry:import',       '导入采购记录',   'button', NULL, 4, 1),
  (UUID(), 'food-purchase', 'action:entry:export',       '导出采购记录',   'button', NULL, 5, 1),
  -- 报销管理相关
  (UUID(), 'food-purchase', 'action:reimbursement:manage', '管理报销单', 'button', NULL, 10, 1),
  (UUID(), 'food-purchase', 'action:reimbursement:export', '导出报销单', 'button', NULL, 11, 1),
  -- 用户管理相关
  (UUID(), 'food-purchase', 'action:user:create',        '新增用户',       'button', NULL, 20, 1),
  (UUID(), 'food-purchase', 'action:user:edit',          '编辑用户',       'button', NULL, 21, 1),
  (UUID(), 'file-purchase', 'action:user:delete',        '删除/禁用用户',  'button', NULL, 22, 1),
  (UUID(), 'food-purchase', 'action:user:reset-password','重置密码',       'button', NULL, 23, 1),
  (UUID(), 'food-purchase', 'action:user:manage-role',   '分配角色',       'button', NULL, 24, 1),
  -- 基础数据管理
  (UUID(), 'food-purchase', 'action:category:manage',    '管理分类',       'button', NULL, 30, 1),
  (UUID(), 'food-purchase', 'action:ingredient:manage',  '管理食材',       'button', NULL, 31, 1),
  (UUID(), 'food-purchase', 'action:department:manage',  '管理部门',       'button', NULL, 32, 1),
  (UUID(), 'food-purchase', 'action:supplier:manage',    '管理供应商',     'button', NULL, 33, 1);

-- 修正第195行 typo
UPDATE permissions SET module_id = 'food-purchase' WHERE id = 'file-purchase' AND code = 'action:user:delete';

-- ================================================
-- 4. 为角色分配权限
-- ================================================

-- 4.1 admin 角色：拥有所有权限
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT 
  UUID(), 
  r.id, 
  p.id 
FROM roles r 
CROSS JOIN permissions p
WHERE r.code = 'admin';

-- 4.2 finance 角色：查看类权限 + 月度分析
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'finance'
  AND p.code IN (
    'menu:daily', 'menu:monthly', 'menu:yearly', 'menu:query',
    'menu:m-daily', 'menu:m-yearly', 'menu:m-query', 'menu:m-monthly',
    'action:entry:export', 'action:reimbursement:export'
  );

-- 4.3 boss 角色：所有查看类权限 + 月度分析
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'boss'
  AND p.code IN (
    'menu:daily', 'menu:monthly', 'menu:yearly', 'menu:query',
    'menu:m-daily', 'menu:m-yearly', 'menu:m-query', 'menu:m-monthly',
    'action:entry:export'
  );

-- 4.4 viewer 角色：只查看类权限（无月度分析）
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'viewer'
  AND p.code IN (
    'menu:daily', 'menu:yearly', 'menu:query',
    'menu:m-daily', 'menu:m-yearly', 'menu:m-query'
  );

-- ================================================
-- 5. 验证权限分配结果
-- ================================================
SELECT 
  r.code AS role_code,
  r.name AS role_name,
  COUNT(rp.permission_id) AS permission_count
FROM roles r
LEFT JOIN role_permissions rp ON r.id = rp.role_id
GROUP BY r.id, r.code, r.name
ORDER BY r.sort_order;

SELECT '004_init_module_permissions.sql 执行完成' AS message;
