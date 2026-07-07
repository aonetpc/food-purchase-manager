const pool = require('../db');
const bcrypt = require('bcrypt');

const defaultPasswords = {
  admin: 'admin123',
  viewer: 'viewer123',
};

async function updatePasswords() {
  try {
    console.log('开始更新用户密码为BCrypt加密格式...');

    for (const [username, password] of Object.entries(defaultPasswords)) {
      const hashedPassword = await bcrypt.hash(password, 10);
      const [result] = await pool.query(
        'UPDATE users SET password_hash = ? WHERE username = ?',
        [hashedPassword, username]
      );
      console.log(`更新用户 ${username}: ${result.affectedRows} 行受影响`);
    }

    console.log('密码更新完成！');
    process.exit(0);
  } catch (err) {
    console.error('更新密码失败:', err);
    process.exit(1);
  }
}

updatePasswords();