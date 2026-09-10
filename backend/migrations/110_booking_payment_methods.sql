-- feat/141: 预订付款方式配置表
-- 把前端硬编码的 5 个付款方式选项改为业务配置可维护
-- 结构与 booking_room_types / booking_meal_types 等保持一致（id/code/name/status/sort_order）

CREATE TABLE IF NOT EXISTS booking_payment_methods (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE COMMENT '编码如 PM001',
  name VARCHAR(100) NOT NULL COMMENT '显示名称如 销售担保挂账',
  status TINYINT NOT NULL DEFAULT 1 COMMENT '1启用 0禁用',
  sort_order INT NOT NULL DEFAULT 100,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='预订付款方式配置';

-- 种子数据：把现有 5 个硬编码选项迁入，保证历史订单 payment_method 中文字符串值不变
INSERT INTO booking_payment_methods (code, name, sort_order) VALUES
  ('PM001', '销售担保挂账', 1),
  ('PM002', '客户现付', 2),
  ('PM003', '公司结算', 3),
  ('PM004', '预付定金', 4),
  ('PM005', '其他', 5);
