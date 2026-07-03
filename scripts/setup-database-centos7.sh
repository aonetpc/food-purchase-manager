#!/bin/bash
# =====================================================
# CentOS 7 安装 PostgreSQL 14 + PostgREST 脚本
# 使用 CentOS SCL 仓库安装，更稳定
# 执行：sudo bash setup-database-centos7.sh
# =====================================================

set -e

echo "=== 安装依赖 ==="
yum install -y epel-release
yum install -y centos-release-scl-rh
yum install -y rh-postgresql14-postgresql rh-postgresql14-postgresql-contrib rh-postgresql14-postgresql-server
yum install -y openssl nginx wget tar xz

# 创建符号链接，方便使用
if [ ! -e /usr/pgsql-14 ]; then
    ln -s /opt/rh/rh-postgresql14/root/usr/lib64/pgsql /usr/pgsql-14 2>/dev/null || true
fi

export PATH="/opt/rh/rh-postgresql14/root/usr/bin:/opt/rh/rh-postgresql14/root/usr/libexec:$PATH"

echo "=== 初始化数据库 ==="
if [ ! -d "/var/opt/rh/rh-postgresql14/lib/pgsql/data" ]; then
    scl enable rh-postgresql14 -- /opt/rh/rh-postgresql14/root/usr/libexec/initdb /var/opt/rh/rh-postgresql14/lib/pgsql/data
fi

# 设置权限
chown -R postgres:postgres /var/opt/rh/rh-postgresql14/lib/pgsql/data

echo "=== 启动 PostgreSQL ==="
systemctl enable rh-postgresql14-postgresql
systemctl start rh-postgresql14-postgresql

sleep 2

echo "=== 创建数据库和用户 ==="
DB_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)

scl enable rh-postgresql14 -- psql -U postgres <<EOF
CREATE DATABASE food_purchase;

CREATE ROLE anon NOINHERIT NOLOGIN;
CREATE ROLE authenticator NOINHERIT NOLOGIN;
CREATE ROLE fpm_user NOINHERIT LOGIN PASSWORD '${DB_PASSWORD}';

GRANT ALL PRIVILEGES ON DATABASE food_purchase TO fpm_user;
GRANT anon TO authenticator;
GRANT fpm_user TO authenticator;

\c food_purchase

CREATE SCHEMA IF NOT EXISTS api;

GRANT USAGE ON SCHEMA api TO anon;
GRANT USAGE ON SCHEMA api TO authenticator;
GRANT ALL ON SCHEMA api TO fpm_user;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS api.categories (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  icon VARCHAR(10) DEFAULT '🏷️',
  color VARCHAR(20) DEFAULT '#666666',
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api.ingredients (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
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
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
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
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  role VARCHAR(20) DEFAULT 'viewer' CHECK (role IN ('admin', 'viewer')),
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchase_records_date ON api.purchase_records(date);
CREATE INDEX IF NOT EXISTS idx_ingredients_category ON api.ingredients(category_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA api TO anon;
GRANT ALL ON ALL TABLES IN SCHEMA api TO fpm_user;
GRANT ALL ON ALL SEQUENCES IN SCHEMA api TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA api TO fpm_user;

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
PG_HBA="/var/opt/rh/rh-postgresql14/lib/pgsql/data/pg_hba.conf"
if [ -f "$PG_HBA" ]; then
    sed -i 's/^local   all             all                                     peer/local   all             all                                     md5/' "$PG_HBA"
    sed -i 's/^host    all             all             127.0.0.1\/32            ident/host    all             all             127.0.0.1\/32            md5/' "$PG_HBA"
    sed -i 's/^host    all             all             ::1\/128                 ident/host    all             all             ::1\/128                 md5/' "$PG_HBA"
fi

PG_CONF="/var/opt/rh/rh-postgresql14/lib/pgsql/data/postgresql.conf"
if [ -f "$PG_CONF" ]; then
    sed -i "s/#listen_addresses = 'localhost'/listen_addresses = 'localhost'/" "$PG_CONF"
fi

systemctl restart rh-postgresql14-postgresql
sleep 2

echo "=== 安装 PostgREST ==="
cd /tmp
wget -q https://github.com/PostgREST/postgrest/releases/download/v12.0.0/postgrest-v12.0.0-linux-static-x64.tar.xz
tar -xf postgrest-v12.0.0-linux-static-x64.tar.xz
mv postgrest /usr/local/bin/
rm -f postgrest-v12.0.0-linux-static-x64.tar.xz

echo "=== 生成 JWT Secret ==="
JWT_SECRET=$(openssl rand -base64 32)

ANON_TOKEN=$(echo -n '{"role":"anon"}' | openssl base64 -e | tr -d '\n' | tr '+/' '-_')
ANON_SIGNATURE=$(echo -n "${ANON_TOKEN}" | openssl dgst -sha256 -hmac "${JWT_SECRET}" -binary | openssl base64 -e | tr -d '\n' | tr '+/' '-_')
ANON_KEY="${ANON_TOKEN}.${ANON_SIGNATURE}"

echo "=== 创建 PostgREST 配置 ==="
mkdir -p /etc/postgrest

cat > /etc/postgrest/config <<EOF
db-uri = "postgres://authenticator:${DB_PASSWORD}@localhost:5432/food_purchase"
db-schema = "api"
db-anon-role = "anon"
server-port = 3000
server-host = "127.0.0.1"
jwt-secret = "${JWT_SECRET}"
EOF

echo "=== 创建 PostgREST 服务 ==="
cat > /etc/systemd/system/postgrest.service <<EOF
[Unit]
Description=PostgREST API Server
After=rh-postgresql14-postgresql.service

[Service]
ExecStart=/usr/local/bin/postgrest /etc/postgrest/config
Restart=always
User=postgres
Group=postgres

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl start postgrest
systemctl enable postgrest

echo "=== 配置 Nginx 反向代理 ==="
cat > /etc/nginx/conf.d/api.conf <<'EOF'
server {
    listen 80;
    server_name 124.220.25.15;

    location /rest/v1/ {
        proxy_pass http://127.0.0.1:3000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Authorization $http_authorization;
    }

    location / {
        root /var/www/food-purchase;
        try_files $uri $uri/ /index.html;
    }
}
EOF

systemctl restart nginx

cat > /root/food-purchase-db-info.txt <<EOF
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
EOF

echo ""
echo "============================================================"
echo "  安装完成！"
echo "============================================================"
echo ""
echo "配置信息已保存到: /root/food-purchase-db-info.txt"
echo ""
echo "请执行：cat /root/food-purchase-db-info.txt"
echo ""
echo "服务状态："
echo "  systemctl status rh-postgresql14-postgresql"
echo "  systemctl status postgrest"
echo ""