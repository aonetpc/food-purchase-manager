-- =====================================================
-- 食材采购管理系统 - Supabase 数据库初始化脚本
-- 请在 Supabase SQL Editor 中执行此脚本
-- =====================================================

-- 1. 用户表
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  role VARCHAR(20) DEFAULT 'viewer' CHECK (role IN ('admin', 'viewer')),
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. 食材分类表
CREATE TABLE IF NOT EXISTS categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  icon VARCHAR(10) DEFAULT '🏷️',
  color VARCHAR(20) DEFAULT '#666666',
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. 食材表
CREATE TABLE IF NOT EXISTS ingredients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  base_unit VARCHAR(20) NOT NULL,
  base_price DECIMAL(10, 2) NOT NULL,
  image TEXT,
  units JSONB DEFAULT '[{"unit": "公斤", "factor": 1, "isCommon": true}]',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. 采购记录表
CREATE TABLE IF NOT EXISTS purchase_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL,
  ingredient_id UUID REFERENCES ingredients(id) ON DELETE CASCADE,
  ingredient_name VARCHAR(100) NOT NULL,
  category_id UUID,
  category_name VARCHAR(50),
  purchase_unit VARCHAR(20) NOT NULL,
  purchase_quantity DECIMAL(10, 2) NOT NULL,
  purchase_unit_price DECIMAL(10, 2) NOT NULL,
  base_unit VARCHAR(20),
  base_unit_price DECIMAL(10, 2),
  base_quantity DECIMAL(10, 2),
  amount DECIMAL(10, 2) NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 创建索引加速查询
CREATE INDEX IF NOT EXISTS idx_purchase_records_date ON purchase_records(date);
CREATE INDEX IF NOT EXISTS idx_ingredients_category ON ingredients(category_id);
CREATE INDEX IF NOT EXISTS idx_ingredients_name ON ingredients(name);

-- 启用 Row Level Security（安全控制）
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_records ENABLE ROW LEVEL SECURITY;

-- 设置公开访问策略（简化版，适合内部系统）
CREATE POLICY "Allow all operations on categories" ON categories FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on ingredients" ON ingredients FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on purchase_records" ON purchase_records FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow read on users" ON users FOR SELECT USING (true);
CREATE POLICY "Allow update on own user" ON users FOR UPDATE USING (true) WITH CHECK (true);

-- 插入默认管理员账号（密码: admin123）
-- 注意：生产环境应该使用加密密码，这里简化处理
INSERT INTO users (username, name, role, password_hash)
VALUES ('admin', '系统管理员', 'admin', 'admin123')
ON CONFLICT (username) DO NOTHING;

INSERT INTO users (username, name, role, password_hash)
VALUES ('viewer', '查看员', 'viewer', 'viewer123')
ON CONFLICT (username) DO NOTHING;

-- 插入默认分类数据
INSERT INTO categories (name, icon, color, sort_order) VALUES
('蔬菜', '🥬', '#22c55e', 1),
('肉类', '🥩', '#ef4444', 2),
('海鲜', '🦐', '#3b82f6', 3),
('水果', '🍎', '#f97316', 4),
('调味品', '🧂', '#a855f7', 5),
('粮油', '🌾', '#eab308', 6),
('豆制品', '🫘', '#14b8a6', 7),
('其他', '📦', '#6b7280', 8)
ON CONFLICT DO NOTHING;

-- =====================================================
-- 执行完成后，请前往 Settings → API 获取：
-- - Project URL
-- - anon public key
-- 并更新到前端的 .env 文件中
-- =====================================================