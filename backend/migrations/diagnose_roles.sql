-- ================================================
-- 诊断脚本：查看所有用户的角色配置
-- ================================================

-- 1. 查看所有角色定义
SELECT '=== 所有角色定义 ===' AS section;
SELECT id, code, name, description, is_system, sort_order FROM roles ORDER BY sort_order;

-- 2. 查看所有用户及其主角色
SELECT '=== 所有用户及其主角色 ===' AS section;
SELECT 
  u.id, 
  u.username, 
  u.name, 
  u.role, 
  u.role_id,
  r.code AS role_code_from_id,
  r.name AS role_name_from_id,
  u.status
FROM users u
LEFT JOIN roles r ON u.role_id = r.id
ORDER BY u.id;

-- 3. 查看用户多角色分配（user_roles 表）
SELECT '=== 用户多角色分配 ===' AS section;
SELECT 
  u.username, 
  u.name AS user_name,
  r.code AS role_code, 
  r.name AS role_name
FROM users u
JOIN user_roles ur ON u.id = ur.user_id
JOIN roles r ON ur.role_id = r.id
ORDER BY u.username, r.sort_order;

-- 4. 查看各角色的权限码
SELECT '=== 各角色的权限码 ===' AS section;
SELECT 
  r.code AS role_code, 
  r.name AS role_name,
  GROUP_CONCAT(p.code ORDER BY p.code) AS permission_codes
FROM roles r
LEFT JOIN role_permissions rp ON r.id = rp.role_id
LEFT JOIN permissions p ON rp.permission_id = p.id
GROUP BY r.id, r.code, r.name
ORDER BY r.sort_order;

-- 5. 特别检查管理员角色是否拥有管理权限
SELECT '=== 管理员角色权限详情 ===' AS section;
SELECT p.code, p.name, p.type, p.path 
FROM roles r
JOIN role_permissions rp ON r.id = rp.role_id
JOIN permissions p ON rp.permission_id = p.id
WHERE r.code = 'admin'
ORDER BY p.type, p.sort_order;

-- 6. 检查 timyan 用户的完整权限
SELECT '=== timyan 用户权限 ===' AS section;
SELECT p.code, p.name, p.type, p.path 
FROM users u
JOIN user_roles ur ON u.id = ur.user_id
JOIN role_permissions rp ON ur.role_id = rp.role_id
JOIN permissions p ON rp.permission_id = p.id
WHERE u.username = 'timyan'
ORDER BY p.type, p.sort_order;

SELECT '诊断完成' AS message;