#!/bin/bash
# =====================================================
# CentOS 7 安装 PostgreSQL 14 + PostgREST
# 使用官方二进制包（不需要 yum 仓库）
# =====================================================

set -e

PG_VERSION="14.13"
PG_DIR="/usr/local/pgsql-${PG_VERSION}"
PG_DATA="/var/lib/pgsql/data"

echo "=== 第一步：禁用所有 pgdg 仓库 ==="
find /etc/yum.repos.d -name "*pgdg*" -type f 2>/dev/null | while read f; do
    echo "  禁用: $f"
    mv "$f" "${f}.bak"
done
rm -rf /var/cache/yum/*
yum clean all 2>/dev/null || true

echo "=== 第二步：安装必要依赖（用系统基础源） ==="
yum install -y wget tar xz openssl nginx readline zlib 2>&1 | tail -3

echo "=== 第三步：下载 PostgreSQL 二进制包 ==="
cd /tmp

if [ ! -d "$PG_DIR" ]; then
    echo "  下载 PostgreSQL ${PG_VERSION} ..."
    wget -q --tries=3 --timeout=60 \
        "https://get.enterprisedb.com/postgresql/postgresql-${PG_VERSION}-1-linux-x64-binaries.tar.gz" \
        -O postgresql.tar.gz
    
    echo "  解压中..."
    tar -xzf postgresql.tar.gz
    
    # 移动到 /usr/local
    mv pgsql "$PG_DIR"
    
    # 创建软链接
    ln -sf "$PG_DIR" /usr/local/pgsql
    
    rm -f postgresql.tar.gz
fi

export PATH="/usr/local/pgsql/bin:$PATH"

echo "=== 第四步：创建 postgres 用户 ==="
id postgres >/dev/null 2>&1 || useradd -r -m -s /bin/bash postgres

echo "=== 第五步：初始化数据库 ==="
mkdir -p "$PG_DATA"
chown -R postgres:postgres "$PG_DATA"
chmod 700 "$PG_DATA"

if [ ! -d "${PG_DATA}/base" ]; then
    echo "  初始化数据库..."
    su - postgres -c "/usr/local/pgsql/bin/initdb -D ${PG_DATA}"
fi

echo "=== 第六步：配置并启动 PostgreSQL ==="
# 配置 pg_hba.conf
PG_HBA="${PG_DATA}/pg_hba.conf"
if [ -f "$PG_HBA" ]; then
    sed -i 's/^local   all             all                                     peer/local   all             all                                     trust/' "$PG_HBA"
    sed -i 's/^host    all             all             127.0.0.1\/32            scram-sha-256/host    all             all             127.0.0.1\/32            md5/' "$PG_HBA"
    sed -i 's/^host    all             all             127.0.0.1\/32            ident/host    all             all             127.0.0.1\/32            md5/' "$PG_HBA"
fi

# 创建 systemd 服务
cat > /etc/systemd/system/postgresql.service <<EOF
[Unit]
Description=PostgreSQL 14 database server
After=network.target

[Service]
Type=forking
User=postgres
Group=postgres
ExecStart=/usr/local/pgsql/bin/pg_ctl -D ${PG_DATA} -l /var/lib/pgsql/logfile start
ExecStop=/usr/local/pgsql/bin/pg_ctl -D ${PG_DATA} stop
ExecReload=/usr/local/pgsql/bin/pg_ctl -D ${PG_DATA} reload
Restart=always

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl restart postgresql
systemctl enable postgresql 2>&1 || true
sleep 3

echo "=== 第七步：创建数据库和表 ==="
DB_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)

su - postgres -c "/usr/local/pgsql/bin/psql -c \"CREATE DATABASE food_purchase;\"" 2>&1 || true
su - postgres -c "/usr/local/pgsql/bin/psql -c \"CREATE ROLE anon NOINHERIT NOLOGIN;\"" 2>&1 || true
su - postgres -c "/usr/local/pgsql/bin/psql -c \"CREATE ROLE authenticator NOINHERIT LOGIN PASSWORD '${DB_PASSWORD}';\"" 2>&1 || true
su - postgres -c "/usr/local/pgsql/bin/psql -c \"GRANT anon TO authenticator;\"" 2>&1 || true

su - postgres -c "/usr/local/pgsql/bin/psql -d food_purchase" <<'EOF'
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE SCHEMA IF NOT EXISTS api;
GRANT USAGE ON SCHEMA api TO anon;

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
GRANT ALL ON ALL SEQUENCES IN SCHEMA api TO anon;

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

echo "=== 第八步：安装 PostgREST ==="
if [ ! -f /usr/local/bin/postgrest ]; then
    cd /tmp
    echo "  下载 PostgREST ..."
    wget -q --tries=3 --timeout=60 \
        https://github.com/PostgREST/postgrest/releases/download/v12.0.0/postgrest-v12.0.0-linux-static-x64.tar.xz \
        -O postgrest.tar.xz
    tar -xf postgrest.tar.xz
    mv postgrest /usr/local/bin/
    rm -f postgrest.tar.xz
fi

echo "=== 第九步：生成 JWT 配置 ==="
JWT_SECRET=$(openssl rand -base64 32)

HEADER=$(echo -n '{"alg":"HS256","typ":"JWT"}' | openssl base64 -e | tr -d '\n' | tr '+/' '-_' | tr -d '=')
PAYLOAD=$(echo -n '{"role":"anon"}' | openssl base64 -e | tr -d '\n' | tr '+/' '-_' | tr -d '=')
SIGNATURE=$(echo -n "${HEADER}.${PAYLOAD}" | openssl dgst -sha256 -hmac "${JWT_SECRET}" -binary | openssl base64 -e | tr -d '\n' | tr '+/' '-_' | tr -d '=')
ANON_KEY="${HEADER}.${PAYLOAD}.${SIGNATURE}"

mkdir -p /etc/postgrest
cat > /etc/postgrest/config <<EOF
db-uri = "postgres://authenticator:${DB_PASSWORD}@localhost:5432/food_purchase"
db-schema = "api"
db-anon-role = "anon"
server-port = 3000
server-host = "127.0.0.1"
jwt-secret = "${JWT_SECRET}"
EOF

echo "=== 第十步：启动 PostgREST ==="
cat > /etc/systemd/system/postgrest.service <<'EOF'
[Unit]
Description=PostgREST API Server
After=postgresql.service

[Service]
ExecStart=/usr/local/bin/postgrest /etc/postgrest/config
Restart=always
User=postgres
Group=postgres
Environment=PATH=/usr/local/pgsql/bin:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl restart postgrest
systemctl enable postgrest 2>&1 || true
sleep 2

echo "=== 第十一步：配置 Nginx ==="
if [ ! -f /etc/nginx/conf.d/food-purchase-api.conf ]; then
    cat > /etc/nginx/conf.d/food-purchase-api.conf <<'NGINX'
location /rest/v1/ {
    proxy_pass http://127.0.0.1:3000/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header Authorization $http_authorization;
}
NGINX
fi
systemctl restart nginx 2>&1 || true

echo "=== 保存配置信息 ==="
cat > /root/food-purchase-db-info.txt <<EOF
=====================================================
  食材采购管理系统 - 数据库配置信息
=====================================================

数据库：
  地址: localhost:5432
  数据库: food_purchase
  authenticator 密码: ${DB_PASSWORD}

API:
  地址: http://127.0.0.1:3000/
  JWT Secret: ${JWT_SECRET}

前端 .env 配置：
  VITE_SUPABASE_URL=http://你的服务器IP/rest
  VITE_SUPABASE_ANON_KEY=${ANON_KEY}

服务管理：
  systemctl status postgresql
  systemctl status postgrest
=====================================================
EOF

echo ""
echo "============================================================"
echo "  ✅ 安装完成！"
echo "============================================================"
echo ""
echo "配置信息：cat /root/food-purchase-db-info.txt"
echo ""
echo "测试 API：curl http://127.0.0.1:3000/categories"
echo ""