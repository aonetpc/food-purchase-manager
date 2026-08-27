const mysql = require('mysql2/promise');

// 数据库凭证必须通过环境变量提供（生产环境由 backend/.env 注入，CI 由 ssh-action envs 注入）
// 不再保留硬编码 fallback，避免明文密码进入仓库
const dbPassword = process.env.DB_PASSWORD;
if (!dbPassword) {
  throw new Error(
    '[db] DB_PASSWORD 环境变量未设置。请在服务器创建 backend/.env 并配置数据库凭证，或通过 systemd EnvironmentFile 注入。'
  );
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'food_purchase',
  password: dbPassword,
  database: process.env.DB_NAME || 'food_purchase',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  dateStrings: true,
  timezone: '+08:00',
  decimalNumbers: true,
});

module.exports = pool;
