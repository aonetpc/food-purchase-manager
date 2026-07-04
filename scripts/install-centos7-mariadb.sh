#!/bin/bash
# =====================================================
# CentOS 7 食材采购系统一键安装脚本
# MariaDB + Node.js + 后端服务 + Nginx
# =====================================================

set -e

APP_DIR="/opt/food-purchase"
DB_NAME="food_purchase"
DB_USER="food_purchase"

echo "=========================================="
echo "  食材采购管理系统 - CentOS 7 安装脚本"
echo "=========================================="
echo ""

# ====== 第一步：清理坏仓库 ======
echo "=== 第一步：清理 yum 坏仓库 ==="
find /etc/yum.repos.d -name "*pgdg*" -type f 2>/dev/null | while read f; do
    mv "$f" "${f}.bak"
    echo "  禁用: $f"
done
yum clean all 2>/dev/null || true
echo ""

# ====== 第二步：安装 MariaDB ======
echo "=== 第二步：安装 MariaDB ==="
yum install -y mariadb-server mariadb 2>&1 | tail -3

systemctl enable mariadb
systemctl start mariadb
sleep 2

echo "  设置 root 密码..."
DB_ROOT_PASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 16)
mysqladmin -u root password "$DB_ROOT_PASS" 2>/dev/null || true
echo ""

# ====== 第三步：创建数据库 ======
echo "=== 第三步：创建数据库和用户 ==="
DB_PASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 16)

mysql -u root -p"$DB_ROOT_PASS" <<EOF
CREATE DATABASE IF NOT EXISTS ${DB_NAME} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
FLUSH PRIVILEGES;
EOF

mysql -u root -p"$DB_ROOT_PASS" <<EOF
SELECT COUNT(*) INTO @cnt FROM mysql.user WHERE user = '${DB_USER}' AND host = 'localhost';
SET @sql = IF(@cnt = 0, CONCAT('CREATE USER ''${DB_USER}''@''localhost'' IDENTIFIED BY ''${DB_PASS}'''), 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
EOF

echo "  数据库: $DB_NAME"
echo "  用户: $DB_USER"
echo ""

# ====== 第四步：安装 Node.js ======
echo "=== 第四步：安装 Node.js ==="
if ! command -v node &> /dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_18.x | bash - 2>&1 | tail -3
    yum install -y nodejs 2>&1 | tail -3
fi
echo "  Node.js 版本: $(node -v)"
echo "  npm 版本: $(npm -v)"
echo ""

# ====== 第五步：部署后端 ======
echo "=== 第五步：部署后端服务 ==="
mkdir -p "$APP_DIR/backend"

cat > "$APP_DIR/backend/package.json" <<'EOF'
{
  "name": "food-purchase-backend",
  "version": "1.0.0",
  "main": "server.js",
  "dependencies": {
    "express": "^4.18.2",
    "mysql2": "^3.9.0",
    "cors": "^2.8.5",
    "uuid": "^9.0.0"
  }
}
EOF

cat > "$APP_DIR/backend/db.js" <<'EOF'
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'food_purchase',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'food_purchase',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
});

module.exports = pool;
EOF

mkdir -p "$APP_DIR/backend/routes"

cat > "$APP_DIR/backend/routes/categories.js" <<'EOF'
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../db');

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM categories ORDER BY sort_order ASC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, icon = '🏷️', color = '#666666' } = req.body;
    const id = uuidv4();
    const [countResult] = await pool.query('SELECT COUNT(*) as cnt FROM categories');
    const sort_order = countResult[0].cnt + 1;
    await pool.query(
      'INSERT INTO categories (id, name, icon, color, sort_order) VALUES (?, ?, ?, ?, ?)',
      [id, name, icon, color, sort_order]
    );
    const [rows] = await pool.query('SELECT * FROM categories WHERE id = ?', [id]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, icon, color } = req.body;
    const fields = [];
    const values = [];
    if (name !== undefined) { fields.push('name = ?'); values.push(name); }
    if (icon !== undefined) { fields.push('icon = ?'); values.push(icon); }
    if (color !== undefined) { fields.push('color = ?'); values.push(color); }
    if (fields.length === 0) return res.status(400).json({ error: '没有更新字段' });
    values.push(id);
    await pool.query(`UPDATE categories SET ${fields.join(', ')} WHERE id = ?`, values);
    const [rows] = await pool.query('SELECT * FROM categories WHERE id = ?', [id]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM categories WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
EOF

cat > "$APP_DIR/backend/routes/ingredients.js" <<'EOF'
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../db');

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM ingredients ORDER BY name ASC');
    const result = rows.map(row => ({
      ...row,
      units: row.units ? JSON.parse(row.units) : null,
      base_price: parseFloat(row.base_price),
    }));
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, category_id, base_unit, base_price, image = '', units } = req.body;
    const id = uuidv4();
    const unitsJson = units ? JSON.stringify(units) : null;
    await pool.query(
      'INSERT INTO ingredients (id, name, category_id, base_unit, base_price, image, units) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, name, category_id, base_unit, base_price, image, unitsJson]
    );
    const [rows] = await pool.query('SELECT * FROM ingredients WHERE id = ?', [id]);
    res.json({
      ...rows[0],
      units: rows[0].units ? JSON.parse(rows[0].units) : null,
      base_price: parseFloat(rows[0].base_price),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category_id, base_unit, base_price, image, units } = req.body;
    const fields = [];
    const values = [];
    if (name !== undefined) { fields.push('name = ?'); values.push(name); }
    if (category_id !== undefined) { fields.push('category_id = ?'); values.push(category_id); }
    if (base_unit !== undefined) { fields.push('base_unit = ?'); values.push(base_unit); }
    if (base_price !== undefined) { fields.push('base_price = ?'); values.push(base_price); }
    if (image !== undefined) { fields.push('image = ?'); values.push(image); }
    if (units !== undefined) { fields.push('units = ?'); values.push(JSON.stringify(units)); }
    if (fields.length === 0) return res.status(400).json({ error: '没有更新字段' });
    values.push(id);
    await pool.query(`UPDATE ingredients SET ${fields.join(', ')} WHERE id = ?`, values);
    const [rows] = await pool.query('SELECT * FROM ingredients WHERE id = ?', [id]);
    res.json({
      ...rows[0],
      units: rows[0].units ? JSON.parse(rows[0].units) : null,
      base_price: parseFloat(rows[0].base_price),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM ingredients WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
EOF

cat > "$APP_DIR/backend/routes/purchase.js" <<'EOF'
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../db');

const dbToFrontend = (row) => ({
  id: row.id,
  date: row.date,
  ingredient_id: row.ingredient_id,
  ingredient_name: row.ingredient_name,
  category_id: row.category_id || '',
  category_name: row.category_name || '',
  purchase_unit: row.purchase_unit,
  purchase_quantity: parseFloat(row.purchase_quantity),
  purchase_unit_price: parseFloat(row.purchase_unit_price),
  base_unit: row.base_unit || '',
  base_unit_price: parseFloat(row.base_unit_price) || 0,
  base_quantity: parseFloat(row.base_quantity) || 0,
  amount: parseFloat(row.amount),
  created_at: row.created_at,
});

router.get('/', async (req, res) => {
  try {
    const { date, start_date, end_date } = req.query;
    let sql = 'SELECT * FROM purchase_records';
    const params = [];
    if (date) {
      sql += ' WHERE date = ?';
      params.push(date);
    } else if (start_date && end_date) {
      sql += ' WHERE date >= ? AND date <= ?';
      params.push(start_date, end_date);
    }
    sql += ' ORDER BY date ASC, created_at ASC';
    const [rows] = await pool.query(sql, params);
    res.json(rows.map(dbToFrontend));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const item = req.body;
    const id = uuidv4();
    await pool.query(
      `INSERT INTO purchase_records (id, date, ingredient_id, ingredient_name, category_id, category_name, purchase_unit, purchase_quantity, purchase_unit_price, base_unit, base_unit_price, base_quantity, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, item.date, item.ingredient_id, item.ingredient_name, item.category_id, item.category_name, item.purchase_unit, item.purchase_quantity, item.purchase_unit_price, item.base_unit, item.base_unit_price, item.base_quantity, item.amount]
    );
    const [rows] = await pool.query('SELECT * FROM purchase_records WHERE id = ?', [id]);
    res.json(dbToFrontend(rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const item = req.body;
    const fields = [];
    const values = [];
    const map = { date: 'date', ingredient_id: 'ingredient_id', ingredient_name: 'ingredient_name', category_id: 'category_id', category_name: 'category_name', purchase_unit: 'purchase_unit', purchase_quantity: 'purchase_quantity', purchase_unit_price: 'purchase_unit_price', base_unit: 'base_unit', base_unit_price: 'base_unit_price', base_quantity: 'base_quantity', amount: 'amount' };
    for (const [k, f] of Object.entries(map)) {
      if (item[k] !== undefined) { fields.push(`${f} = ?`); values.push(item[k]); }
    }
    if (fields.length === 0) return res.status(400).json({ error: '没有更新字段' });
    values.push(id);
    await pool.query(`UPDATE purchase_records SET ${fields.join(', ')} WHERE id = ?`, values);
    const [rows] = await pool.query('SELECT * FROM purchase_records WHERE id = ?', [id]);
    res.json(dbToFrontend(rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM purchase_records WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/batch-save', async (req, res) => {
  try {
    const { date, items } = req.body;
    await pool.query('DELETE FROM purchase_records WHERE date = ?', [date]);
    const saved = [];
    for (const item of items) {
      const id = item.id && item.id.length === 36 ? item.id : uuidv4();
      await pool.query(
        `INSERT INTO purchase_records (id, date, ingredient_id, ingredient_name, category_id, category_name, purchase_unit, purchase_quantity, purchase_unit_price, base_unit, base_unit_price, base_quantity, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, date, item.ingredient_id || item.ingredientId, item.ingredient_name || item.ingredientName, item.category_id || item.categoryId, item.category_name || item.categoryName, item.purchase_unit || item.purchaseUnit, item.purchase_quantity || item.purchaseQuantity, item.purchase_unit_price || item.purchaseUnitPrice, item.base_unit || item.baseUnit, item.base_unit_price || item.baseUnitPrice, item.base_quantity || item.baseQuantity, item.amount]
      );
      saved.push({ ...item, id, date });
    }
    res.json(saved);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/date/:date', async (req, res) => {
  try {
    const { date } = req.params;
    await pool.query('DELETE FROM purchase_records WHERE date = ?', [date]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
EOF

cat > "$APP_DIR/backend/routes/auth.js" <<'EOF'
const express = require('express');
const router = express.Router();
const pool = require('../db');

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const [rows] = await pool.query(
      'SELECT id, username, name, role FROM users WHERE username = ? AND password_hash = ?',
      [username, password]
    );
    if (rows.length === 0) return res.status(401).json({ error: '用户名或密码错误' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
EOF

cat > "$APP_DIR/backend/server.js" <<'EOF'
const express = require('express');
const cors = require('cors');
const path = require('path');

const categoriesRouter = require('./routes/categories');
const ingredientsRouter = require('./routes/ingredients');
const purchaseRouter = require('./routes/purchase');
const authRouter = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use('/api/categories', categoriesRouter);
app.use('/api/ingredients', ingredientsRouter);
app.use('/api/purchase', purchaseRouter);
app.use('/api/auth', authRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, '127.0.0.1', () => {
  console.log('Server running on http://127.0.0.1:' + PORT);
});
EOF

echo "  安装 npm 依赖..."
cd "$APP_DIR/backend"
npm install --production 2>&1 | tail -3
echo ""

# ====== 第六步：初始化数据库 ======
echo "=== 第六步：初始化数据库表 ==="
mysql -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" <<'EOF'
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
  created_by VARCHAR(36),
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

INSERT IGNORE INTO categories (id, name, icon, color, sort_order) VALUES
(UUID(), '蔬菜', '🥬', '#22c55e', 1),
(UUID(), '肉类', '🥩', '#ef4444', 2),
(UUID(), '海鲜', '🦐', '#3b82f6', 3),
(UUID(), '水果', '🍎', '#f97316', 4),
(UUID(), '调味品', '🧂', '#a855f7', 5),
(UUID(), '粮油', '🌾', '#eab308', 6),
(UUID(), '豆制品', '🫘', '#14b8a6', 7),
(UUID(), '其他', '📦', '#6b7280', 8);

INSERT IGNORE INTO users (id, username, name, role, password_hash) VALUES
(UUID(), 'admin', '系统管理员', 'admin', 'admin123'),
(UUID(), 'viewer', '查看员', 'viewer', 'viewer123');
EOF
echo "  数据库表初始化完成"
echo ""

# ====== 第七步：创建 systemd 服务 ======
echo "=== 第七步：创建后端服务 ==="
cat > /etc/systemd/system/food-purchase-backend.service <<EOF
[Unit]
Description=Food Purchase Backend
After=network.target mariadb.service

[Service]
Type=simple
WorkingDirectory=${APP_DIR}/backend
Environment=NODE_ENV=production
Environment=DB_HOST=localhost
Environment=DB_USER=${DB_USER}
Environment=DB_PASSWORD=${DB_PASS}
Environment=DB_NAME=${DB_NAME}
Environment=PORT=3001
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl restart food-purchase-backend
systemctl enable food-purchase-backend
sleep 2
echo ""

# ====== 第八步：配置 Nginx ======
echo "=== 第八步：配置 Nginx ==="
yum install -y nginx 2>&1 | tail -2

cat > /etc/nginx/conf.d/food-purchase.conf <<'EOF'
server {
    listen 80;
    server_name _;

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
EOF

# 禁用默认配置
if [ -f /etc/nginx/conf.d/default.conf ]; then
    mv /etc/nginx/conf.d/default.conf /etc/nginx/conf.d/default.conf.bak
fi

systemctl start nginx 2>/dev/null || systemctl restart nginx
systemctl enable nginx 2>/dev/null || true
echo ""

# ====== 第九步：保存配置信息 ======
echo "=== 安装完成 ==="

cat > /root/food-purchase-info.txt <<EOF
=====================================================
  食材采购管理系统 - 安装信息
=====================================================

数据库：
  类型: MariaDB
  地址: localhost:3306
  数据库: ${DB_NAME}
  用户: ${DB_USER}
  密码: ${DB_PASS}
  root 密码: ${DB_ROOT_PASS}

后端服务：
  地址: http://127.0.0.1:3001
  目录: ${APP_DIR}/backend
  服务名: food-purchase-backend

前端：
  部署目录: ${APP_DIR}/backend/dist
  访问地址: http://<服务器IP>

默认账号：
  管理员: admin / admin123
  查看员: viewer / viewer123

常用命令：
  systemctl status food-purchase-backend
  systemctl restart food-purchase-backend
  systemctl status mariadb
  systemctl status nginx
=====================================================
EOF

echo "配置信息已保存到: /root/food-purchase-info.txt"
echo ""
echo "查看配置: cat /root/food-purchase-info.txt"
echo ""
echo "测试 API: curl http://127.0.0.1:3001/api/health"
echo ""
