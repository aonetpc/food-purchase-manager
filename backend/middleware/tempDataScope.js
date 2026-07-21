/**
 * 外请人员打卡模块 - 数据权限中间件
 *
 * 审核员只能看到/操作自己负责岗位的数据
 * 董事长可看全部数据（只读）
 * 管理员可看全部数据
 */

const pool = require('../db');

/**
 * 获取用户在临时工模块的角色列表
 */
async function getTempRoles(userId) {
  const [rows] = await pool.query(`
    SELECT r.code FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = ? AND r.code LIKE 'temp_%'
  `, [userId]);
  return rows.map(r => r.code);
}

/**
 * 构建数据范围查询条件
 * 返回 { sql: '...', params: [...] }
 */
async function buildTempDataScope(req) {
  const userId = req.user.id;

  // 获取用户的所有角色（包括 user_roles 表和 users.role 字段）
  const [userRoleRows] = await pool.query(`
    SELECT r.code FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = ?
  `, [userId]);

  const [legacyRoleRows] = await pool.query(`
    SELECT r.code FROM roles r WHERE r.code = ?
  `, [req.user.role]);

  const roleCodes = new Set([
    ...userRoleRows.map(r => r.code),
    ...legacyRoleRows.map(r => r.code),
  ]);

  // 管理员/董事长：全部数据
  if (roleCodes.has('admin') || roleCodes.has('temp_chairman') || roleCodes.has('boss')) {
    return { sql: '1=1', params: [] };
  }

  // 审核员：只看自己负责的岗位
  if (roleCodes.has('temp_auditor')) {
    return {
      sql: `position_id IN (SELECT position_id FROM position_auditors WHERE user_id = ?)`,
      params: [userId],
    };
  }

  // 默认：无数据
  return { sql: '1=0', params: [] };
}

/**
 * 审核员数据范围中间件
 * 将数据范围条件挂载到 req.dataScope
 */
async function attachDataScope(req, res, next) {
  try {
    req.dataScope = await buildTempDataScope(req);
    next();
  } catch (err) {
    console.error('attachDataScope error:', err);
    res.status(500).json({ error: '权限检查失败' });
  }
}

module.exports = {
  buildTempDataScope,
  attachDataScope,
  getTempRoles,
};
