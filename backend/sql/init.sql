-- ================================================
-- 食材采购管理系统 - 数据库初始化脚本
-- MySQL 8.0 / MariaDB 10.5+ 兼容
-- ================================================

CREATE TABLE IF NOT EXISTS categories (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  icon VARCHAR(10) DEFAULT '🏷️',
  color VARCHAR(20) DEFAULT '#666666',
  sort_order INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ingredients (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  category_id VARCHAR(36),
  base_unit VARCHAR(20) NOT NULL,
  base_price DECIMAL(10, 2) NOT NULL,
  image TEXT,
  units JSON,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_category (category_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS purchase_records (
  id VARCHAR(36) PRIMARY KEY,
  date DATE NOT NULL,
  ingredient_id VARCHAR(36),
  ingredient_name VARCHAR(100) NOT NULL,
  category_id VARCHAR(36),
  category_name VARCHAR(50),
  purchase_unit VARCHAR(20) NOT NULL,
  purchase_quantity DECIMAL(10, 2) NOT NULL,
  purchase_unit_price DECIMAL(10, 2) NOT NULL,
  base_unit VARCHAR(20),
  base_unit_price DECIMAL(10, 2),
  base_quantity DECIMAL(10, 2),
  amount DECIMAL(10, 2) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_date (date),
  INDEX idx_ingredient (ingredient_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(36) PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  role VARCHAR(20) DEFAULT 'viewer',
  password_hash VARCHAR(255) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 插入默认分类
INSERT IGNORE INTO categories (id, name, icon, color, sort_order) VALUES
(UUID(), '蔬菜', '🥬', '#22c55e', 1),
(UUID(), '肉类', '🥩', '#ef4444', 2),
(UUID(), '海鲜', '🦐', '#3b82f6', 3),
(UUID(), '水果', '🍎', '#f97316', 4),
(UUID(), '调味品', '🧂', '#a855f7', 5),
(UUID(), '粮油', '🌾', '#eab308', 6),
(UUID(), '豆制品', '🫘', '#14b8a6', 7),
(UUID(), '其他', '📦', '#6b7280', 8);

-- 插入默认用户
INSERT IGNORE INTO users (id, username, name, role, password_hash) VALUES
(UUID(), 'admin', '系统管理员', 'admin', 'admin123'),
(UUID(), 'viewer', '查看员', 'viewer', 'viewer123');
