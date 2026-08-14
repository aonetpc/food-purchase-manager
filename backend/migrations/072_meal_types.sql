-- 用餐标准配置表
CREATE TABLE IF NOT EXISTS booking_meal_types (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE COMMENT '编码',
  name VARCHAR(100) NOT NULL COMMENT '名称：工作餐/标准桌餐/豪华桌餐/自助餐',
  pricing_mode ENUM('per_table','per_person') NOT NULL DEFAULT 'per_table' COMMENT '计价模式：按桌/按人',
  unit_price DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '单价（元/桌 或 元/人）',
  default_time VARCHAR(5) NOT NULL DEFAULT '12:00' COMMENT '默认开餐时间',
  default_tables INT NOT NULL DEFAULT 1 COMMENT '默认桌数',
  default_per_table INT NOT NULL DEFAULT 10 COMMENT '默认每桌人数',
  default_pax INT NOT NULL DEFAULT 0 COMMENT '默认人数（按人计价时使用）',
  description TEXT COMMENT '描述/备注',
  sort_order INT NOT NULL DEFAULT 100,
  status TINYINT NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT '用餐标准配置';

-- 预置数据
INSERT INTO booking_meal_types (code, name, pricing_mode, unit_price, default_time, default_tables, default_per_table, default_pax, sort_order) VALUES
  ('work',     '工作餐',     'per_person', 30,   '12:00', 1, 10, 20,  1),
  ('standard', '标准桌餐',   'per_table',  500,  '12:00', 2, 10, 0,   2),
  ('premium',  '豪华桌餐',   'per_table',  1200, '12:00', 2, 10, 0,   3),
  ('buffet',   '自助餐',     'per_person', 128,  '12:00', 1, 10, 20,  4)
ON DUPLICATE KEY UPDATE name = VALUES(name);
