-- ================================================
-- 013 - 清理重复权限，删除旧权限码保留新权限码
-- 
-- 问题：012迁移创建了新权限码映射，但旧权限码未删除，导致重复菜单
-- 
-- 旧权限码 → 新权限码（保留）：
-- menu:query     → menu:ingredients（食材价格查询）
-- menu:entry     → menu:purchase-entry（采购录入）
-- menu:ingredients → menu:ingredient-manager（食材管理）
-- 
-- 步骤：
-- 1. 将旧权限码的角色关联迁移到新权限码
-- 2. 删除旧权限码记录
-- ================================================

-- ================================================
-- 1. 获取新旧权限ID映射
-- ================================================
-- 创建临时表存储映射关系
CREATE TEMPORARY TABLE IF NOT EXISTS perm_mapping (
  old_code VARCHAR(100),
  new_code VARCHAR(100),
  old_id VARCHAR(36),
  new_id VARCHAR(36)
);

-- 填充映射关系
INSERT INTO perm_mapping (old_code, new_code, old_id, new_id)
SELECT 
  'menu:query' AS old_code, 'menu:ingredients' AS new_code,
  p_old.id AS old_id, p_new.id AS new_id
FROM permissions p_old
JOIN permissions p_new ON p_new.code = 'menu:ingredients'
WHERE p_old.code = 'menu:query';

INSERT INTO perm_mapping (old_code, new_code, old_id, new_id)
SELECT 
  'menu:entry' AS old_code, 'menu:purchase-entry' AS new_code,
  p_old.id AS old_id, p_new.id AS new_id
FROM permissions p_old
JOIN permissions p_new ON p_new.code = 'menu:purchase-entry'
WHERE p_old.code = 'menu:entry';

INSERT INTO perm_mapping (old_code, new_code, old_id, new_id)
SELECT 
  'menu:ingredients' AS old_code, 'menu:ingredient-manager' AS new_code,
  p_old.id AS old_id, p_new.id AS new_id
FROM permissions p_old
JOIN permissions p_new ON p_new.code = 'menu:ingredient-manager'
WHERE p_old.code = 'menu:ingredients';

-- ================================================
-- 2. 将旧权限的角色关联迁移到新权限（幂等）
-- ================================================
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), rp.role_id, pm.new_id
FROM role_permissions rp
JOIN perm_mapping pm ON rp.permission_id = pm.old_id;

-- ================================================
-- 3. 删除旧权限的角色关联
-- ================================================
DELETE rp FROM role_permissions rp
JOIN perm_mapping pm ON rp.permission_id = pm.old_id;

-- ================================================
-- 4. 删除旧权限记录
-- ================================================
DELETE FROM permissions WHERE code IN ('menu:query', 'menu:entry', 'menu:ingredients');

-- ================================================
-- 5. 验证结果
-- ================================================
SELECT p.code, p.name, p.path 
FROM permissions p 
WHERE p.type = 'menu' AND p.path IN ('/ingredients', '/purchase-entry', '/ingredient-manager')
ORDER BY p.code;

SELECT '重复权限清理完成' AS message;
