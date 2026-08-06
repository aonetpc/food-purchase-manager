-- ================================================
-- 050 - 确保供应商对账中心菜单权限存在
-- 幂等执行：可重复执行不会报错
-- ================================================

-- 1. 确保权限定义存在
-- 使用变量获取或创建权限ID
SET @perm_id = (SELECT id FROM permissions WHERE code = 'menu:supplier-reconciliation' LIMIT 1);

-- 如果权限不存在，则插入
INSERT INTO permissions (id, module_id, code, name, type, parent_id, path, icon, sort_order, status)
SELECT UUID(), 'food-purchase', 'menu:supplier-reconciliation', '供应商对账中心', 'menu', NULL, '/supplier-reconciliation', 'Scale', 7, 1
WHERE @perm_id IS NULL;

-- 重新获取权限ID（用于后续分配角色）
SET @perm_id = (SELECT id FROM permissions WHERE code = 'menu:supplier-reconciliation' LIMIT 1);

-- 2. 确保 admin 角色拥有此权限
INSERT INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, @perm_id
FROM roles r
WHERE r.code = 'admin'
  AND @perm_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = @perm_id
  );

-- 3. 确保 finance（财务）角色拥有此权限
INSERT INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, @perm_id
FROM roles r
WHERE r.code = 'finance'
  AND @perm_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = @perm_id
  );

-- 4. 确保 purchaser（采购员）角色拥有此权限
INSERT INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, @perm_id
FROM roles r
WHERE r.code = 'purchaser'
  AND @perm_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = @perm_id
  );

-- 5. 验证结果
SELECT 
  @perm_id AS permission_id,
  p.code AS permission_code,
  p.name AS permission_name,
  p.path AS permission_path;

SELECT r.code AS role_code, r.name AS role_name, p.code AS perm_code, p.name AS perm_name
FROM roles r
JOIN role_permissions rp ON r.id = rp.role_id
JOIN permissions p ON rp.permission_id = p.id
WHERE p.code = 'menu:supplier-reconciliation'
ORDER BY r.code;

SELECT '050_fix_supplier_reconciliation.sql 执行完成' AS message;
