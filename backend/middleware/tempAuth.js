/**
 * 外请人员打卡模块 - 认证中间件
 *
 * 两种认证方式：
 * 1. 微信端（外请人员）：temp_token = temp_worker_users.id
 * 2. 企微端（审核员/董事长）：复用现有 requireAuth（系统 users.id）
 *
 * 使用方式：
 *   router.post('/checkins', requireTempAuth, handler)         // 微信端打卡
 *   router.get('/audits/pending', requireAuth, handler)         // 企微端审核
 */

const pool = require('../db');

/**
 * 外请人员登录态校验
 * token 格式："temp_<uuid>"，从 temp_worker_users 表查
 */
async function requireTempAuth(req, res, next) {
  const token = req.headers['authorization'];
  if (!token) {
    return res.status(401).json({ error: '未登录，请先登录' });
  }

  const tempUserId = token.replace('Bearer ', '').replace('temp_', '');

  try {
    const [rows] = await pool.query(
      'SELECT id, name, phone, openid, avatar_url, status FROM temp_worker_users WHERE id = ?',
      [tempUserId]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: '用户不存在' });
    }

    const tempUser = rows[0];

    if (tempUser.status !== 1) {
      return res.status(403).json({ error: '账号已被禁用' });
    }

    // 更新最后登录时间
    pool.query('UPDATE temp_worker_users SET last_login_at = ? WHERE id = ?', [new Date(), tempUserId]);

    req.tempUser = tempUser;
    next();
  } catch (err) {
    console.error('tempAuth middleware error:', err);
    return res.status(500).json({ error: '认证失败' });
  }
}

/**
 * 获取外请人员的已分配岗位
 */
async function getTempUserPositions(tempUserId) {
  const [rows] = await pool.query(`
    SELECT p.id, p.name, p.type, p.pay_type, p.rate, p.department_id, d.name as department_name,
           up.is_primary
    FROM user_positions up
    JOIN positions p ON up.position_id = p.id
    JOIN departments d ON p.department_id = d.id
    WHERE up.user_source = 'temp' AND up.user_id = ? AND p.status = 1
    ORDER BY up.is_primary DESC, p.sort_order ASC
  `, [tempUserId]);
  return rows;
}

/**
 * 获取外请人员的临时岗位（所有人可见，新用户可直接使用）
 * 返回固定的临时岗位记录
 */
async function getTempPositions() {
  const [rows] = await pool.query(`
    SELECT p.id, p.name, p.type, p.pay_type, p.rate, p.department_id, d.name as department_name
    FROM positions p
    JOIN departments d ON p.department_id = d.id
    WHERE p.status = 1 AND p.name = '临时岗位'
  `);

  if (rows.length > 0) {
    return rows;
  }

  // 数据库没有临时岗位记录时，兜底返回内存中的虚拟岗位
  const [deptRows] = await pool.query(
    `SELECT id, name FROM departments ORDER BY id LIMIT 1`
  );
  const fallbackDept = deptRows.length > 0 ? deptRows[0] : { id: '', name: '默认部门' };

  return [{
    id: 'temp-position-default',
    name: '临时岗位',
    type: 'external',
    pay_type: 'per_time',
    rate: 0,
    department_id: fallbackDept.id,
    department_name: fallbackDept.name,
  }];
}

module.exports = {
  requireTempAuth,
  getTempUserPositions,
  getTempPositions,
};
