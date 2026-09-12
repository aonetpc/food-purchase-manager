-- ================================================
-- 111 - 财务管理模块 + 费用支付监控菜单
--
-- 阶段一：仅建模块 + 菜单权限 + 给 admin 角色分配
-- （finance 角色不自动分配，由用户通过 RoleManager 页面自行勾选验证增减）
--
-- 幂等执行：可重复执行不会报错
-- ================================================

-- ================================================
-- 1. 新增"财务管理"业务模块（左侧菜单分类）
-- ================================================
INSERT IGNORE INTO modules (id, code, name, icon, description, sort_order, status) VALUES
  ('finance', 'finance', '财务', 'Wallet', '费用支付、报销、对账等财务监控', 50, 1);

-- 如果模块已存在，补正字段（避免旧数据残留）
UPDATE modules SET
  code = 'finance',
  name = '财务',
  icon = 'Wallet',
  description = '费用支付、报销、对账等财务监控',
  sort_order = 50,
  status = 1
WHERE id = 'finance';

-- ================================================
-- 2. 新增"费用支付监控"菜单权限
-- ================================================
INSERT IGNORE INTO permissions (id, module_id, code, name, type, parent_id, path, icon, sort_order, status) VALUES
  (UUID(), 'finance', 'menu:expense-payment-monitor', '费用支付监控', 'menu', NULL, '/finance/expense-monitor', 'Eye', 1, 1);

-- 补正 module_id（防止旧数据被乱塞到别的 module 下）
UPDATE permissions
SET module_id = 'finance', type = 'menu', status = 1
WHERE code = 'menu:expense-payment-monitor';

-- ================================================
-- 3. 角色权限分配
--    只给 admin 角色分配，finance 角色不分配
--    （由用户通过 RoleManager 页面自行勾选/取消验证增减）
-- ================================================
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'admin'
  AND p.code = 'menu:expense-payment-monitor';

-- ================================================
-- 4. 验证
-- ================================================
SELECT '===== 111_finance_module.sql 执行完成 =====' AS info;
SELECT '财务管理模块：' AS info;
SELECT id, code, name, icon, description, sort_order, status
FROM modules
WHERE code = 'finance';

SELECT '费用支付监控菜单权限：' AS info;
SELECT p.id, p.code, p.name, p.type, p.path, p.icon, p.module_id, p.status
FROM permissions p
WHERE p.code = 'menu:expense-payment-monitor';

SELECT 'admin 角色是否已分配：' AS info;
SELECT r.code AS role_code, p.code AS permission_code
FROM role_permissions rp
JOIN roles r ON rp.role_id = r.id
JOIN permissions p ON rp.permission_id = p.id
WHERE p.code = 'menu:expense-payment-monitor';
