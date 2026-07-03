#!/bin/bash
# =====================================================
# 腾讯云轻量服务器 PostgreSQL + PostgREST 安装脚本
# 适用于 CentOS / RHEL / Rocky Linux 系统
# 在服务器上执行：sudo bash setup-database-centos.sh
# =====================================================

set -e

echo "=== 安装 PostgreSQL 14 ==="
# 添加 PostgreSQL 官方 yum 仓库
sudo dnf install -y https://download.postgresql.org/pub/repos/yum/reporpms/EL-9-x86_64/pgdg-redhat-repo-latest.noarch.rpm 2>/dev/null || \
sudo yum install -y https://download.postgresql.org/pub/repos/yum/reporpms/EL-8-x86_64/pgdg-redhat-repo-latest.noarch.rpm 2>/dev/null || true

# 禁用内置 PostgreSQL 模块（CentOS 8+）
sudo dnf -qy module disable postgresql 2>/dev/null || true

# 安装 PostgreSQL 14
sudo dnf install -y postgresql14-server postgresql14-contrib 2>/dev/null || \
sudo yum install -y postgresql14-server postgresql14-contrib

# 初始化数据库
if [ ! -d "/var/lib/pgsql/14/data" ]; then
    sudo /usr/pgsql-14/bin/postgresql-14-setup initdb
fi

echo "=== 启动 PostgreSQL ==="
sudo systemctl enable postgresql-14
sudo systemctl start postgresql-14

# 设置环境变量
export PATH="/usr/pgsql-14/bin:$PATH"

# 等待 PostgreSQL 启动
sleep 2

echo "=== 创建数据库和用户 ==="
# 生成随机密码
DB_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)

sudo -u postgres psql <<EOF
-- 创建数据库
CREATE DATABASE food_purchase;

-- 创建匿名访问角色（模拟 anon key）
CREATE ROLE anon NOINHERIT NOLOGIN;

-- 创建认证角色
CREATE ROLE authenticator NOINHERIT NOLOGIN;

-- 创建用户角色
CREATE ROLE fpm_user NOINHERIT LOGIN PASSWORD '${DB_PASSWORD}';

-- 授权
GRANT ALL PRIVILEGES ON DATABASE food_purchase TO fpm_user;
GRANT anon TO authenticator;
GRANT fpm_user TO authenticator;

-- 切换到 food_purchase 数据库
\c food_purchase

-- 创建 schema
CREATE SCHEMA IF NOT EXISTS api;

-- 授权 schema
GRANT USAGE ON SCHEMA api TO anon;
GRANT USAGE ON SCHEMA api TO authenticator;
GRANT ALL ON SCHEMA api TO fpm_user;

-- 创建表
CREATE TABLE IF NOT EXISTS api.categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  icon VARCHAR(10) DEFAULT '🏷️',
  color VARCHAR(20) DEFAULT '#666666',
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api.ingredients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  category_id UUID REFERENCES api.categories(id) ON DELETE SET NULL,
  base_unit VARCHAR(20) NOT NULL,
  base_price DECIMAL(10, 2) NOT NULL,
  image TEXT,
  units JSONB DEFAULT '[{"unit": "公斤", "factor": 1, "isCommon": true}]',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api.purchase_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL,
  ingredient_id UUID REFERENCES api.ingredients(id) ON DELETE CASCADE,
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
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api.users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  role VARCHAR(20) DEFAULT 'viewer' CHECK (role IN ('admin', 'viewer')),
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_purchase_records_date ON api.purchase_records(date);
CREATE INDEX IF NOT EXISTS idx_ingredients_category ON api.ingredients(category_id);

-- 授权表
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA api TO anon;
GRANT ALL ON ALL TABLES IN SCHEMA api TO fpm_user;
GRANT ALL ON ALL SEQUENCES IN SCHEMA api TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA api TO fpm_user;

-- 插入默认数据
INSERT INTO api.categories (name, icon, color, sort_order) VALUES
('蔬菜', '🥬', '#22c55e', 1),
('肉类', '🥩', '#ef4444', 2),
('海鲜', '🦐', '#3b82f6', 3),
('水果', '🍎', '#f97316', 4),
('调味品', '🧂', '#a855f7', 5),
('粮油', '🌾', '#eab308', 6),
('豆制品', '🫘', '#14b8a6', 7),
('其他', '📦', '#6b7280', 8)
ON CONFLICT DO NOTHING;

INSERT INTO api.users (username, name, role, password_hash) VALUES
('admin', '系统管理员', 'admin', 'admin123'),
('viewer', '查看员', 'viewer', 'viewer123')
ON CONFLICT (username) DO NOTHING;
EOF

echo "=== 配置 PostgreSQL 访问 ==="
# 修改 pg_hba.conf
PG_HBA="/var/lib/pgsql/14/data/pg_hba.conf"
if [ -f "$PG_HBA" ]; then
    # 允许本地 md5 认证
    sudo sed -i 's/^local   all             all                                     peer/local   all             all                                     md5/' "$PG_HBA"
    sudo sed -i 's/^host    all             all             127.0.0.1\/32            ident/host    all             all             127.0.0.1\/32            md5/' "$PG_HBA"
    sudo sed -i 's/^host    all             all             ::1\/128                 ident/host    all             all             ::1\/128                 md5/' "$PG_HBA"
fi

# 修改 postgresql.conf
PG_CONF="/var/lib/pgsql/14/data/postgresql.conf"
if [ -f "$PG_CONF" ]; then
    sudo sed -i "s/#listen_addresses = 'localhost'/listen_addresses = 'localhost'/" "$PG_CONF"
fi

sudo systemctl restart postgresql-14
sleep 2

echo "=== 安装 PostgREST ==="
# 下载 PostgREST
cd /tmp
wget -q https://github.com/PostgREST/postgrest/releases/download/v12.0.0/postgrest-v12.0.0-linux-static-x64.tar.xz
tar -xf postgrest-v12.0.0-linux-static-x64.tar.xz
sudo mv postgrest /usr/local/bin/
rm -f postgrest-v12.0.0-linux-static-x64.tar.xz

echo "=== 生成 JWT Secret ==="
# 生成 256-bit secret for HS256
JWT_SECRET=$(openssl rand -base64 32)

# 生成 anon JWT token
ANON_TOKEN=$(echo -n '{"role":"anon"}' | openssl base64 -e | tr -d '\n' | tr '+/' '-_')
ANON_SIGNATURE=$(echo -n "${ANON_TOKEN}" | openssl dgst -sha256 -hmac "${JWT_SECRET}" -binary | openssl base64 -e | tr -d '\n' | tr '+/' '-_')
ANON_KEY="${ANON_TOKEN}.${ANON_SIGNATURE}"

echo "=== 创建 PostgREST 配置 ==="
sudo mkdir -p /etc/postgrest
sudo bash -c "cat > /etc/postgrest/config <<EOF
db-uri = \"postgres://authenticator:${DB_PASSWORD}@localhost:5432/food_purchase\"
db-schema = \"api\"
db-anon-role = \"anon\"
server-port = 3000
server-host = \"127.0.0.1\"
jwt-secret = \"${JWT_SECRET}\"
EOF"

echo "=== 创建 PostgREST 服务 ==="
sudo bash -c "cat > /etc/systemd/system/postgrest.service <<EOF
[Unit]
Description=PostgREST API Server
After=postgresql-14.service

[Service]
ExecStart=/usr/local/bin/postgrest /etc/postgrest/config
Restart=always
User=postgres
Group=postgres

[Install]
WantedBy=multi-user.target
EOF"

sudo systemctl daemon-reload
sudo systemctl start postgrest
sudo systemctl enable postgrest

echo "=== 配置 Nginx 反向代理 ==="
sudo bash -c "cat > /etc/nginx/conf.d/api.conf <<'EOF'
server {
    listen 80;
    server_name 124.220.25.15;

    # PostgREST API (Supabase SDK 会自动拼接 /rest/v1/)
    location /rest/v1/ {
        proxy_pass http://127.0.0.1:3000/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header Authorization \$http_authorization;
    }

    # 前端静态文件
    location / {
        root /var/www/food-purchase;
        try_files \$uri \$uri/ /index.html;
    }
}
EOF"

sudo systemctl restart nginx

# 保存配置信息
sudo bash -c "cat > /root/food-purchase-db-info.txt <<EOF
=====================================================
  食材采购管理系统 - 数据库配置信息
=====================================================

数据库连接信息：
  地址: localhost:5432
  数据库: food_purchase
  用户: fpm_user
  密码: ${DB_PASSWORD}

PostgREST API：
  地址: http://124.220.25.15/rest/v1/
  JWT Secret: ${JWT_SECRET}

前端配置（更新 .env 文件）：
  VITE_SUPABASE_URL=http://124.220.25.15/rest
  VITE_SUPABASE_ANON_KEY=${ANON_KEY}

=====================================================
  请妥善保管此文件！
=====================================================
EOF"

echo ""
echo "============================================================"
echo "  安装完成！"
echo "============================================================"
echo ""
echo "配置信息已保存到: /root/food-purchase-db-info.txt"
echo ""
echo "请执行以下命令查看配置："
echo "  cat /root/food-purchase-db-info.txt"
echo ""
echo "注意："
echo "  1. PostgreSQL 服务: systemctl status postgresql-14"
echo "  2. PostgREST 服务: systemctl status postgrest"
echo "  3. 默认端口: PostgreSQL 5432, PostgREST 3000"
echo ""