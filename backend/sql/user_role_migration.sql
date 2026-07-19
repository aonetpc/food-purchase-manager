-- ================================================
-- 用户角色扩展 - 数据库迁移脚本
-- 执行前请备份数据库
-- ================================================

-- 1. 扩展 users 表 role 字段，新增 finance（财务）和 boss（董事长）角色
ALTER TABLE users
  MODIFY COLUMN role ENUM('admin','finance','boss','viewer') DEFAULT 'viewer';

-- 2. 新增 wecom_userid 字段，用于关联企业微信用户ID（免登使用）
ALTER TABLE users
  ADD COLUMN wecom_userid VARCHAR(100) DEFAULT NULL COMMENT '企业微信用户ID',
  ADD INDEX idx_wecom_userid (wecom_userid);

-- 说明：
-- admin:   系统管理员（全部权限）
-- finance: 财务人员（可查看月度分析）
-- boss:    董事长（可查看月度分析）
-- viewer:  普通员工（不可查看月度分析）
