-- ================================================
-- 059 - 重命名"统计看板"为"外请人工看板"
-- 
-- 修改内容：
-- 1. PC端菜单权限名称：menu:temp-stats  统计看板 → 外请人工看板
-- 2. 手机端菜单权限名称：menu:m-temp-stats  手机-统计看板 → 手机-外请人工看板
-- 3. 角色描述中提及的"统计看板"同步更新
-- 
-- 幂等执行：可重复执行不会报错
-- ================================================

-- 1. 更新 PC 端菜单权限名称
UPDATE permissions
SET name = '外请人工看板'
WHERE code = 'menu:temp-stats' AND name = '统计看板';

-- 2. 更新手机端菜单权限名称
UPDATE permissions
SET name = '手机-外请人工看板'
WHERE code = 'menu:m-temp-stats' AND name = '手机-统计看板';

-- 3. 同步更新角色描述中的"统计看板"字样
UPDATE roles
SET description = '外请模块外请人工看板（只读）'
WHERE code = 'temp_chairman' AND description = '外请模块统计看板（只读）';
