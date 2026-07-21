-- ================================================
-- 010 - 回滚脚本（回滚外请人员打卡管理模块）
-- 警告：会删除该模块新增的所有表和字段！
-- 建议先备份数据库再执行。
-- ================================================

-- 1. 删除外键约束（checkin_records）
ALTER TABLE checkin_records DROP FOREIGN KEY IF EXISTS fk_cr_position;
ALTER TABLE checkin_records DROP FOREIGN KEY IF EXISTS fk_cr_dept;

-- 2. 删除新表
DROP TABLE IF EXISTS checkin_records;
DROP TABLE IF EXISTS user_positions;
DROP TABLE IF EXISTS position_auditors;
DROP TABLE IF EXISTS positions;
DROP TABLE IF EXISTS temp_worker_users;
DROP TABLE IF EXISTS user_roles;

-- 3. 删除角色（仅删除角色定义）
DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE code IN ('temp_auditor', 'temp_chairman'));
DELETE FROM roles WHERE code IN ('temp_auditor', 'temp_chairman');

-- 4. 删除模块及权限
DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE module_id = 'temp-worker');
DELETE FROM permissions WHERE module_id = 'temp-worker';
DELETE FROM modules WHERE code = 'temp_worker';

-- 5. 还原部门表字段
ALTER TABLE departments DROP COLUMN IF EXISTS parent_id;
ALTER TABLE departments DROP COLUMN IF EXISTS level;
ALTER TABLE departments DROP COLUMN IF EXISTS full_path;

SELECT '010 回滚完成' AS message;
