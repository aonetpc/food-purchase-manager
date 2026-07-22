-- ================================================
-- 010 - 创建外请人员打卡管理模块
-- 包含：部门升级、外请用户、岗位、审核员、打卡记录、角色扩展
-- 幂等执行：可重复执行不会报错
-- ================================================

-- ================================================
-- 1. 升级部门表：支持二级部门（树形结构）
-- ================================================
-- 注意：MySQL 5.7 及以下版本不支持 ADD COLUMN IF NOT EXISTS，需用存储过程实现幂等
DROP PROCEDURE IF EXISTS p_upgrade_departments;
DELIMITER $$
CREATE PROCEDURE p_upgrade_departments()
BEGIN
  -- 检查并添加 parent_id
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'departments' AND COLUMN_NAME = 'parent_id') THEN
    ALTER TABLE departments ADD COLUMN parent_id VARCHAR(36) NULL COMMENT '父部门ID，NULL=顶级';
  END IF;
  -- 检查并添加 level
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'departments' AND COLUMN_NAME = 'level') THEN
    ALTER TABLE departments ADD COLUMN level TINYINT DEFAULT 1 COMMENT '层级：1=顶级 2=二级';
  END IF;
  -- 检查并添加 full_path
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'departments' AND COLUMN_NAME = 'full_path') THEN
    ALTER TABLE departments ADD COLUMN full_path VARCHAR(200) COMMENT '层级路径，如"房务/小卖部"';
  END IF;
  -- 检查并添加索引
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'departments' AND INDEX_NAME = 'idx_parent') THEN
    CREATE INDEX idx_parent ON departments(parent_id);
  END IF;
END$$
DELIMITER ;
CALL p_upgrade_departments();
DROP PROCEDURE IF EXISTS p_upgrade_departments;

-- 初始化层级：现有部门全部视为顶级
UPDATE departments SET level = 1 WHERE level IS NULL;

-- 设置二级部门归属（小卖部、礼品 → 房务；员工餐、早餐 → 厨房）
UPDATE departments d1
SET d1.parent_id = (
  SELECT d2.id FROM (
    SELECT id FROM departments WHERE name = '房务'
  ) d2
), d1.level = 2
WHERE d1.name IN ('小卖部', '礼品');

UPDATE departments d1
SET d1.parent_id = (
  SELECT d2.id FROM (
    SELECT id FROM departments WHERE name = '厨房'
  ) d2
), d1.level = 2
WHERE d1.name IN ('员工餐', '早餐');

-- 更新 full_path
UPDATE departments SET full_path = name WHERE parent_id IS NULL;
UPDATE departments d1
LEFT JOIN departments d2 ON d2.id = d1.parent_id
SET d1.full_path = CONCAT(d2.name, '/', d1.name)
WHERE d1.parent_id IS NOT NULL;

-- ================================================
-- 2. 创建外请人员用户表（独立于系统 users 表）
-- ================================================
CREATE TABLE IF NOT EXISTS temp_worker_users (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(50) NOT NULL COMMENT '姓名',
  phone VARCHAR(20) COMMENT '手机号',
  openid VARCHAR(50) UNIQUE COMMENT '微信openid',
  unionid VARCHAR(50) COMMENT '微信unionid',
  avatar_url VARCHAR(500) COMMENT '头像',
  status TINYINT DEFAULT 1 COMMENT '1=正常 0=禁用',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME,
  INDEX idx_phone (phone),
  INDEX idx_openid (openid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='外请人员用户表';

-- ================================================
-- 3. 创建岗位表（关联现有 departments）
-- ================================================
CREATE TABLE IF NOT EXISTS positions (
  id VARCHAR(36) PRIMARY KEY,
  department_id VARCHAR(36) NOT NULL COMMENT '所属部门',
  name VARCHAR(50) NOT NULL COMMENT '岗位名称，如导医、外请导医',
  type ENUM('internal','external') NOT NULL COMMENT '内部/外请，用于费用统计',
  pay_type ENUM('per_time','per_hour') NOT NULL COMMENT '按次/按小时',
  rate DECIMAL(10,2) NOT NULL COMMENT '单价',
  need_assessment TINYINT DEFAULT 0 COMMENT '是否需要月底考核：1=需要',
  sort_order INT DEFAULT 0,
  status TINYINT DEFAULT 1 COMMENT '1=启用 0=禁用',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_dept (department_id),
  INDEX idx_type (type),
  INDEX idx_status (status),
  CONSTRAINT fk_pos_dept FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='岗位表';

-- 初始化临时岗位（新用户默认可见，可直接打卡）
INSERT IGNORE INTO positions (id, department_id, name, type, pay_type, rate, need_assessment, sort_order, status)
SELECT
  'temp-position-default' AS id,
  (SELECT id FROM departments WHERE status = 1 LIMIT 1) AS department_id,
  '临时岗位' AS name,
  'external' AS type,
  'per_time' AS pay_type,
  0.00 AS rate,
  0 AS need_assessment,
  999 AS sort_order,
  1 AS status
FROM dual
WHERE NOT EXISTS (SELECT 1 FROM positions WHERE name = '临时岗位');

-- ================================================
-- 4. 创建岗位-审核员关联表（数据权限核心）
-- ================================================
CREATE TABLE IF NOT EXISTS position_auditors (
  id VARCHAR(36) PRIMARY KEY,
  position_id VARCHAR(36) NOT NULL COMMENT '岗位ID',
  user_id VARCHAR(36) NOT NULL COMMENT '系统 users.id（审核员）',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_pos_user (position_id, user_id),
  INDEX idx_position (position_id),
  INDEX idx_user (user_id),
  CONSTRAINT fk_pa_position FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE CASCADE,
  CONSTRAINT fk_pa_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='岗位审核员关联表';

-- ================================================
-- 5. 创建用户-岗位分配表（一人可多岗）
-- ================================================
CREATE TABLE IF NOT EXISTS user_positions (
  id VARCHAR(36) PRIMARY KEY,
  user_source ENUM('system','temp') NOT NULL COMMENT '用户来源：system=系统用户，temp=外请人员',
  user_id VARCHAR(36) NOT NULL COMMENT '对应表的主键ID',
  position_id VARCHAR(36) NOT NULL COMMENT '岗位ID',
  is_primary TINYINT DEFAULT 0 COMMENT '是否主岗：1=是',
  assigned_by VARCHAR(36) COMMENT '分配人ID（系统 users.id）',
  assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_pos (user_source, user_id, position_id),
  INDEX idx_user (user_source, user_id),
  INDEX idx_position (position_id),
  CONSTRAINT fk_up_position FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户岗位分配表';

-- ================================================
-- 6. 创建打卡记录表
-- ================================================
CREATE TABLE IF NOT EXISTS checkin_records (
  id VARCHAR(36) PRIMARY KEY,
  user_source ENUM('system','temp') NOT NULL COMMENT '用户来源',
  user_id VARCHAR(36) NOT NULL COMMENT '对应表主键ID',
  user_name VARCHAR(50) NOT NULL COMMENT '冗余：用户姓名',
  user_phone VARCHAR(20) COMMENT '冗余：手机号',

  position_id VARCHAR(36) NOT NULL COMMENT '岗位ID',
  position_name VARCHAR(50) NOT NULL COMMENT '冗余：岗位名称',
  position_type ENUM('internal','external') NOT NULL COMMENT '冗余：内部/外请',
  department_id VARCHAR(36) NOT NULL COMMENT '冗余：部门ID',
  department_name VARCHAR(50) NOT NULL COMMENT '冗余：部门名称',

  checkin_date DATE NOT NULL COMMENT '打卡日期',
  hours DECIMAL(4,1) COMMENT '工作小时数（按小时计费时）',
  amount DECIMAL(10,2) NOT NULL COMMENT '结算金额',

  -- 审核字段
  status ENUM('pending','approved','rejected') DEFAULT 'pending' COMMENT '审核状态',
  audit_by VARCHAR(36) COMMENT '审核人ID',
  audit_note VARCHAR(200) COMMENT '审核备注',
  audited_at DATETIME,

  -- 补录字段
  is_add_record TINYINT DEFAULT 0 COMMENT '是否补录：1=是',
  add_reason VARCHAR(200) COMMENT '补录原因',
  add_by VARCHAR(36) COMMENT '补录人ID',

  -- 考核字段
  assessment_status ENUM('pending','passed','discounted') DEFAULT 'pending' COMMENT '考核状态',
  assessment_discount DECIMAL(3,2) DEFAULT 1.00 COMMENT '考核折扣：1.0/0.8/0.7/0.5/0',
  assessed_by VARCHAR(36) COMMENT '考核人ID',
  assessed_at DATETIME,

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_user_date (user_source, user_id, checkin_date),
  INDEX idx_position_status (position_id, status),
  INDEX idx_dept_date (department_id, checkin_date),
  INDEX idx_status_date (status, checkin_date),
  CONSTRAINT fk_cr_position FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_cr_dept FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='打卡记录表';

-- ================================================
-- 7. 创建用户-角色多对多关联表（支持角色叠加）
-- ================================================
CREATE TABLE IF NOT EXISTS user_roles (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL COMMENT '系统 users.id',
  role_id VARCHAR(36) NOT NULL COMMENT '角色ID',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_role (user_id, role_id),
  INDEX idx_user (user_id),
  INDEX idx_role (role_id),
  CONSTRAINT fk_ur_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ur_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户角色关联表';

-- 迁移现有 users.role 单角色到 user_roles（幂等）
INSERT IGNORE INTO user_roles (id, user_id, role_id)
SELECT UUID(), u.id, r.id
FROM users u
JOIN roles r ON r.code = u.role
WHERE u.role IS NOT NULL AND u.role != '';

-- ================================================
-- 8. 扩展角色表：新增外请模块角色
-- ================================================
INSERT IGNORE INTO roles (id, code, name, description, is_system, sort_order) VALUES
  (UUID(), 'temp_auditor', '外请审核员', '审核外请人员打卡记录，可分配岗位、补录、考核', 1, 11),
  (UUID(), 'temp_chairman', '外请董事长', '外请模块统计看板（只读）', 1, 12);

-- ================================================
-- 9. 创建外请人员模块及权限定义
-- ================================================
-- 插入业务模块
INSERT IGNORE INTO modules (id, code, name, icon, description, sort_order, status) VALUES
  ('temp-worker', 'temp_worker', '外请人员管理', 'Users', '外请人员打卡、审核、考核、统计管理', 2, 1);

-- 菜单权限
INSERT IGNORE INTO permissions (id, module_id, code, name, type, parent_id, path, icon, sort_order, status) VALUES
  (UUID(), 'temp-worker', 'menu:temp-workers', '外请人员', 'menu', NULL, '/temp-workers', 'Users', 1, 1),
  (UUID(), 'temp-worker', 'menu:temp-positions', '岗位管理', 'menu', NULL, '/temp-positions', 'Briefcase', 2, 1),
  (UUID(), 'temp-worker', 'menu:temp-auditors', '审核员管理', 'menu', NULL, '/temp-auditors', 'UserCheck', 3, 1),
  (UUID(), 'temp-worker', 'menu:temp-assessments', '考核管理', 'menu', NULL, '/temp-assessments', 'Target', 4, 1),
  (UUID(), 'temp-worker', 'menu:temp-stats', '统计分析', 'menu', NULL, '/temp-stats', 'BarChart3', 5, 1);

-- 操作权限
INSERT IGNORE INTO permissions (id, module_id, code, name, type, parent_id, sort_order, status) VALUES
  (UUID(), 'temp-worker', 'action:temp-worker:manage', '管理外请人员', 'button', NULL, 1, 1),
  (UUID(), 'temp-worker', 'action:temp-position:manage', '管理岗位', 'button', NULL, 2, 1),
  (UUID(), 'temp-worker', 'action:temp-auditor:manage', '管理审核员', 'button', NULL, 3, 1),
  (UUID(), 'temp-worker', 'action:temp-assessment:manage', '管理考核', 'button', NULL, 4, 1),
  (UUID(), 'temp-worker', 'action:temp-stats:view', '查看统计', 'button', NULL, 5, 1);

-- 移动端菜单权限
INSERT IGNORE INTO permissions (id, module_id, code, name, type, parent_id, path, icon, sort_order, status) VALUES
  (UUID(), 'temp-worker', 'menu:m-temp-audit', '手机-打卡审核', 'menu', NULL, '/m/temp-audit', 'Smartphone', 200, 1),
  (UUID(), 'temp-worker', 'menu:m-temp-assessment', '手机-月底考核', 'menu', NULL, '/m/temp-assessment', 'Smartphone', 201, 1),
  (UUID(), 'temp-worker', 'menu:m-temp-stats', '手机-统计看板', 'menu', NULL, '/m/temp-stats', 'Smartphone', 202, 1);

-- 为 temp_chairman 分配只读统计权限（统计看板+月度分析）
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'temp_chairman'
  AND (
    (p.module_id = 'temp-worker' AND p.code IN ('menu:temp-stats', 'action:temp-stats:view'))
    OR p.code IN ('menu:m-temp-stats', 'menu:m-monthly', 'menu:monthly')
  );

-- 为 temp_auditor 分配移动端审核相关 API 权限（PC端不强制）
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'temp_auditor'
  AND p.module_id = 'temp-worker'
  AND p.code IN ('menu:temp-assessments');

-- 为 temp_auditor 分配移动端审核权限
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'temp_auditor'
  AND p.code IN ('menu:m-temp-audit', 'menu:m-temp-assessment', 'menu:m-temp-stats');

-- 为 admin 分配全部外请模块权限
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'admin'
  AND p.module_id = 'temp-worker';

-- 为 admin 分配全部移动端外请模块权限
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'admin'
  AND p.code IN ('menu:m-temp-audit', 'menu:m-temp-assessment', 'menu:m-temp-stats');

-- ================================================
-- 10. 验证
-- ================================================
SELECT
  TABLE_NAME,
  TABLE_COMMENT
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    'temp_worker_users', 'positions', 'position_auditors',
    'user_positions', 'checkin_records', 'user_roles'
  )
ORDER BY TABLE_NAME;

SELECT
  r.code AS role_code,
  r.name AS role_name,
  COUNT(DISTINCT ur.user_id) AS user_count
FROM roles r
LEFT JOIN user_roles ur ON r.id = ur.role_id
WHERE r.code IN ('admin', 'finance', 'boss', 'viewer', 'temp_auditor', 'temp_chairman')
GROUP BY r.id, r.code, r.name
ORDER BY r.sort_order;

SELECT '010_create_temp_worker_module.sql 执行完成' AS message;
