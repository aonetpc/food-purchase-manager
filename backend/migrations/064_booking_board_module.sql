-- ================================================
-- 064 - 预订调度（Booking Board）模块
--
-- 包含：
--   1. 预订订单主表 booking_orders
--   2. 预订项目明细表 booking_items
--   3. 4 张业务常量表（体检套餐 / 房型 / 会议厅 / 康乐项目）
--   4. 模块 + 菜单权限 + 操作权限定义 + 角色分配
--
-- 幂等执行：可重复运行不会报错
-- 规范：
--   - 流程状态 VARCHAR(20) 不用 ENUM
--   - 所有外键对象冗余 *_name 字段避免 JOIN
--   - JSON 字段读出后端需 typeof==='string' 判断 parse
--   - snake_case，时间戳 ON UPDATE 约定
-- ================================================

-- ================================================
-- 1. 预订订单主表
-- ================================================
CREATE TABLE IF NOT EXISTS booking_orders (
  id VARCHAR(36) PRIMARY KEY,
  order_no VARCHAR(20) NOT NULL UNIQUE COMMENT '订单号 BB+YYMMDD+3位自增',
  customer_name VARCHAR(200) NOT NULL COMMENT '客户名称',
  contact_name VARCHAR(100) COMMENT '联系人',
  contact_phone VARCHAR(50) COMMENT '联系电话',
  sales_person VARCHAR(100) COMMENT '销售员姓名',
  payment_method VARCHAR(100) COMMENT '付款方式',
  remark TEXT COMMENT '备注',
  status VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT '状态 pending/reviewing/confirmed/rejected/completed',
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '订单总金额',
  booker_id VARCHAR(36) COMMENT '预订人 users.id',
  booker_name VARCHAR(50) COMMENT '预订人姓名（冗余）',
  rejected_by VARCHAR(36) COMMENT '驳回人 users.id',
  rejected_by_name VARCHAR(50) COMMENT '驳回人姓名（冗余）',
  rejection_reason TEXT COMMENT '驳回原因',
  confirmed_at DATETIME COMMENT '确认通过时间',
  completed_at DATETIME COMMENT '已完成时间',
  rejected_at DATETIME COMMENT '驳回时间',
  is_template TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否为模板 1=模板 0=普通订单',
  template_name VARCHAR(100) COMMENT '模板名称（is_template=1时有效）',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_order_no (order_no),
  INDEX idx_status (status),
  INDEX idx_sales (sales_person),
  INDEX idx_booker (booker_id),
  INDEX idx_created (created_at),
  INDEX idx_template (is_template)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='预订调度订单主表';

-- 确保 booking_orders 表有模板字段（幂等 ALTER）
SET @dbname = DATABASE();
SET @tablename = 'booking_orders';

SET @columnname = 'is_template';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''是否为模板'' AFTER rejected_at')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @columnname = 'template_name';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' VARCHAR(100) COMMENT ''模板名称'' AFTER is_template')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @indexname = 'idx_template';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE table_schema = @dbname AND table_name = @tablename AND index_name = @indexname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD INDEX ', @indexname, ' (is_template)')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- ================================================
-- 2. 预订订单项目明细表
-- ================================================
CREATE TABLE IF NOT EXISTS booking_items (
  id VARCHAR(36) PRIMARY KEY,
  order_id VARCHAR(36) NOT NULL COMMENT '订单ID booking_orders.id',
  item_type VARCHAR(20) NOT NULL COMMENT '业务类型 checkup/lodging/breakfast/lunch/dinner/meeting/wellness',
  date DATE NOT NULL COMMENT '主日期',
  start_time VARCHAR(10) COMMENT '开始时间 如 08:00',
  end_time VARCHAR(10) COMMENT '结束时间 如 17:00',
  pax INT NOT NULL DEFAULT 0 COMMENT '数量 人/间/桌/场',
  extra JSON COMMENT '业务专属配置 JSON（体检/住宿/餐食/会务/康乐各有不同结构）',
  amount DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '项目金额',
  sort_order INT NOT NULL DEFAULT 0 COMMENT '顺序',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_order (order_id),
  INDEX idx_biz_date (item_type, date),
  INDEX idx_order_sort (order_id, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='预订调度订单项目明细表';

-- ================================================
-- 3. 体检套餐表
-- ================================================
CREATE TABLE IF NOT EXISTS booking_packages (
  id VARCHAR(36) PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE COMMENT '套餐编码 A/B/C/D',
  name VARCHAR(100) NOT NULL COMMENT '套餐名称',
  price DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '套餐单价',
  status TINYINT NOT NULL DEFAULT 1 COMMENT '1=启用 0=禁用',
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_code (code),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='预订调度-体检套餐表';

-- 默认套餐
INSERT IGNORE INTO booking_packages (id, code, name, price, status, sort_order) VALUES
  (UUID(), 'A', '基础体检套餐', 588, 1, 1),
  (UUID(), 'B', '综合体检套餐', 1288, 1, 2),
  (UUID(), 'C', '深度体检套餐', 2888, 1, 3),
  (UUID(), 'D', 'VIP体检套餐',  5888, 1, 4);

-- ================================================
-- 4. 房型表
-- ================================================
CREATE TABLE IF NOT EXISTS booking_room_types (
  id VARCHAR(36) PRIMARY KEY,
  code VARCHAR(30) NOT NULL UNIQUE COMMENT '房型编码 standard/bigbed/suite/vipsuite',
  name VARCHAR(100) NOT NULL COMMENT '房型名称',
  price DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '每间每晚单价',
  status TINYINT NOT NULL DEFAULT 1 COMMENT '1=启用 0=禁用',
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_code (code),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='预订调度-房型表';

-- 默认房型
INSERT IGNORE INTO booking_room_types (id, code, name, price, status, sort_order) VALUES
  (UUID(), 'standard', '标准间',   480, 1, 1),
  (UUID(), 'bigbed',   '大床房',   520, 1, 2),
  (UUID(), 'suite',    '套房',     880, 1, 3),
  (UUID(), 'vipsuite', 'VIP套房',  1880, 1, 4);

-- ================================================
-- 5. 会议厅表
-- ================================================
CREATE TABLE IF NOT EXISTS booking_meeting_halls (
  id VARCHAR(36) PRIMARY KEY,
  code VARCHAR(30) NOT NULL UNIQUE COMMENT '会议厅编码 siji/shanshui/qingquan/wanghu',
  name VARCHAR(100) NOT NULL COMMENT '会议厅名称',
  capacity INT NOT NULL DEFAULT 0 COMMENT '容纳人数',
  half_price DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '半天价格',
  full_price DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '全天价格',
  status TINYINT NOT NULL DEFAULT 1 COMMENT '1=启用 0=禁用',
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_code (code),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='预订调度-会议厅表';

-- 默认会议厅
INSERT IGNORE INTO booking_meeting_halls (id, code, name, capacity, half_price, full_price, status, sort_order) VALUES
  (UUID(), 'siji',     '四季厅', 80,  2000, 3500, 1, 1),
  (UUID(), 'shanshui', '山水厅', 40,  1200, 2200, 1, 2),
  (UUID(), 'qingquan', '清泉厅', 20,  600,  1100, 1, 3),
  (UUID(), 'wanghu',   '望湖厅', 120, 3000, 5800, 1, 4);

-- ================================================
-- 6. 康乐项目表
-- ================================================
CREATE TABLE IF NOT EXISTS booking_wellness_types (
  id VARCHAR(36) PRIMARY KEY,
  code VARCHAR(30) NOT NULL UNIQUE COMMENT '项目编码 mahjong/fishing/ktv/swimming/gym/billiards/tabletennis',
  name VARCHAR(100) NOT NULL COMMENT '项目名称',
  min_hours INT NOT NULL DEFAULT 0 COMMENT '最低小时数（0=不限）',
  price DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '每小时价格（0=免费）',
  is_free TINYINT NOT NULL DEFAULT 0 COMMENT '1=免费 0=收费',
  status TINYINT NOT NULL DEFAULT 1 COMMENT '1=启用 0=禁用',
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_code (code),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='预订调度-康乐项目表';

-- 默认康乐项目
INSERT IGNORE INTO booking_wellness_types (id, code, name, min_hours, price, is_free, status, sort_order) VALUES
  (UUID(), 'mahjong',     '棋牌室',   4, 80,  0, 1, 1),
  (UUID(), 'fishing',     '钓鱼',     2, 60,  0, 1, 2),
  (UUID(), 'ktv',         'KTV',      2, 120, 0, 1, 3),
  (UUID(), 'swimming',    '游泳池',   0, 0,   1, 1, 4),
  (UUID(), 'gym',         '健身房',   0, 0,   1, 1, 5),
  (UUID(), 'billiards',   '台球室',   0, 0,   1, 1, 6),
  (UUID(), 'tabletennis', '乒乓房',   0, 0,   1, 1, 7);

-- ================================================
-- 7. 新增模块：预订调度
-- ================================================
INSERT IGNORE INTO modules (id, code, name, icon, description, sort_order, status) VALUES
  ('booking-board', 'booking-board', '预订调度', 'Calendar', '康养中心7天预订调度画板', 5, 1);

-- 如果模块已存在，补正字段
UPDATE modules SET
  code = 'booking-board',
  name = '预订调度',
  icon = 'Calendar',
  description = '康养中心7天预订调度画板',
  sort_order = 5,
  status = 1
WHERE id = 'booking-board';

-- ================================================
-- 8. 操作权限（6个）
-- ================================================
INSERT IGNORE INTO permissions (id, module_id, code, name, type, parent_id, sort_order, status) VALUES
  (UUID(), 'booking-board', 'action:booking:view',      '查看订单',     'button', NULL, 1, 1),
  (UUID(), 'booking-board', 'action:booking:create',    '创建/编辑订单', 'button', NULL, 2, 1),
  (UUID(), 'booking-board', 'action:booking:submit',    '提交审核',     'button', NULL, 3, 1),
  (UUID(), 'booking-board', 'action:booking:approve',   '审核通过/驳回', 'button', NULL, 4, 1),
  (UUID(), 'booking-board', 'action:booking:complete',  '标记完成',     'button', NULL, 5, 1),
  (UUID(), 'booking-board', 'action:booking:config',    '管理业务常量',  'button', NULL, 6, 1);

-- 如果 action:booking:* 已存在，补正 module_id（之前可能缺 module 被乱塞了）
UPDATE permissions
SET module_id = 'booking-board', type = 'button', status = 1
WHERE code IN (
  'action:booking:view','action:booking:create','action:booking:submit',
  'action:booking:approve','action:booking:complete','action:booking:config'
);

-- ================================================
-- 9. 菜单权限修正（063已建，这里补正 module_id 和 action 按钮级的角色分配）
-- ================================================
UPDATE permissions
SET module_id = 'booking-board', status = 1
WHERE code = 'menu:booking-board';

-- ================================================
-- 10. 角色权限分配
-- ================================================

-- 10.1 admin 角色：预订模块全部权限
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'admin' AND p.module_id = 'booking-board';

-- 10.2 boss 角色：菜单 + 查看
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'boss'
  AND p.code IN ('menu:booking-board','action:booking:view','action:booking:approve','action:booking:complete');

-- 10.3 finance 角色：菜单 + 查看
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'finance'
  AND p.code IN ('menu:booking-board','action:booking:view');

-- ================================================
-- 11. 验证
-- ================================================
SELECT '===== 064_booking_board_module.sql 执行完成 =====' AS info;
SELECT '订单表字段：' AS info;
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_orders'
ORDER BY ORDINAL_POSITION;
SELECT '项目表字段：' AS info;
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_items'
ORDER BY ORDINAL_POSITION;
SELECT '预订调度权限清单：' AS info;
SELECT p.code, p.name, p.type, p.module_id, r.code AS role_code
FROM permissions p
LEFT JOIN role_permissions rp ON rp.permission_id = p.id
LEFT JOIN roles r ON r.id = rp.role_id
WHERE p.module_id = 'booking-board'
ORDER BY p.code, r.code;
