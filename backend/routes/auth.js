const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcrypt');
const { requireAuth, requireRole } = require('../middleware/rbac');
const { logOperation } = require('../middleware/logger');

async function getWecomConfig() {
  const [rows] = await pool.query('SELECT * FROM wecom_config WHERE id = 1');
  return rows.length > 0 ? rows[0] : null;
}

/**
 * 获取用户所有角色的合并权限（支持多角色）
 * 同时查 user_roles 多角色表 + users.role_id 单角色（兼容旧数据）
 */
async function getUserMergedPermissions(userId) {
  let roleRows = [];
  try {
    [roleRows] = await pool.query(`
      SELECT DISTINCT role_id FROM (
        SELECT role_id FROM user_roles WHERE user_id = ?
        UNION
        SELECT role_id FROM users WHERE id = ? AND role_id IS NOT NULL
      ) t
    `, [userId, userId]);
  } catch (e) {
    try {
      [roleRows] = await pool.query('SELECT role_id FROM users WHERE id = ? AND role_id IS NOT NULL', [userId]);
    } catch (e2) {
      return { modules: [], codes: [], menuPaths: [], roleIds: [] };
    }
  }

  if (roleRows.length === 0) {
    return { modules: [], codes: [], menuPaths: [], roleIds: [] };
  }

  const roleIds = roleRows.map(r => r.role_id);
  const placeholders = roleIds.map(() => '?').join(',');

  let permRows = [];
  let moduleInfoMap = {};
  try {
    [permRows] = await pool.query(`
      SELECT DISTINCT p.id, p.code, p.name, p.type, p.path, p.icon, p.module_id, m.code as module_code, m.name as module_name, m.icon as module_icon
      FROM role_permissions rp
      JOIN permissions p ON rp.permission_id = p.id
      JOIN modules m ON p.module_id = m.id
      WHERE rp.role_id IN (${placeholders}) AND p.status = 1 AND m.status = 1
      ORDER BY m.sort_order ASC, p.sort_order ASC
    `, roleIds);
    permRows.forEach(perm => {
      if (!moduleInfoMap[perm.module_code]) {
        moduleInfoMap[perm.module_code] = {
          code: perm.module_code,
          name: perm.module_name,
          icon: perm.module_icon,
        };
      }
    });
  } catch (e) {
    return { modules: [], codes: [], menuPaths: [], roleIds: [] };
  }

  const modules = {};
  const seenCodes = new Set();
  permRows.forEach(perm => {
    if (seenCodes.has(perm.code)) return;
    seenCodes.add(perm.code);
    if (!modules[perm.module_code]) {
      modules[perm.module_code] = {
        code: moduleInfoMap[perm.module_code]?.code || perm.module_code,
        name: moduleInfoMap[perm.module_code]?.name || perm.module_code,
        icon: moduleInfoMap[perm.module_code]?.icon || '',
        menus: [],
        actions: [],
      };
    }
    if (perm.type === 'menu') {
      modules[perm.module_code].menus.push({
        code: perm.code,
        name: perm.name,
        path: perm.path,
        icon: perm.icon,
      });
    } else {
      modules[perm.module_code].actions.push({
        code: perm.code,
        name: perm.name,
      });
    }
  });

  return {
    modules: Object.values(modules),
    codes: permRows.map(p => p.code).filter((v, i, a) => a.indexOf(v) === i),
    menuPaths: permRows.filter(p => p.type === 'menu' && p.path).map(p => p.path).filter((v, i, a) => a.indexOf(v) === i),
    roleIds,
  };
}

/**
 * 获取用户所有角色编码列表
 */
async function getUserRoleCodes(userId) {
  try {
    const [rows] = await pool.query(`
      SELECT DISTINCT r.code
      FROM (
        SELECT role_id FROM user_roles WHERE user_id = ?
        UNION
        SELECT role_id FROM users WHERE id = ? AND role_id IS NOT NULL
      ) t
      JOIN roles r ON r.id = t.role_id
    `, [userId, userId]);
    return rows.map(r => r.code);
  } catch (e) {
    try {
      const [rows] = await pool.query(`
        SELECT r.code FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?
      `, [userId]);
      return rows.map(r => r.code);
    } catch (e2) {
      return [];
    }
  }
}

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const [rows] = await pool.query(
      'SELECT id, username, name, role, role_id, status, password_hash, wecom_userid, phone, department_id FROM users WHERE username = ?',
      [username]
    );

    if (rows.length === 0) {
      await logOperation(null, null, 'auth', 'login_failed', {
        username,
        reason: '用户不存在'
      }, req);
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    const user = rows[0];

    if (user.status !== 1) {
      await logOperation(null, user.id, 'auth', 'login_failed', {
        username,
        reason: '用户已被禁用'
      }, req);
      return res.status(403).json({ error: '用户已被禁用' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      await logOperation(null, user.id, 'auth', 'login_failed', {
        username,
        reason: '密码错误'
      }, req);
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    pool.query('UPDATE users SET last_login_at = ? WHERE id = ?', [new Date(), user.id]);
    await logOperation(user.id, user.id, 'auth', 'login', {
      username,
      login_type: 'password'
    }, req);

    const mergedPerms = await getUserMergedPermissions(user.id);
    const roleCodes = await getUserRoleCodes(user.id);

    res.json({
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      role_id: user.role_id,
      roles: roleCodes,
      wecom_userid: user.wecom_userid,
      phone: user.phone,
      department_id: user.department_id,
      status: user.status,
      token: user.id,
      permissions: {
        modules: mergedPerms.modules,
        codes: mergedPerms.codes,
        menuPaths: mergedPerms.menuPaths,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/users', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, username, name, role, role_id, status, phone, department_id, wecom_userid, created_at, last_login_at FROM users ORDER BY created_at ASC'
    );

    // 查每个用户的多角色
    const userIds = rows.map(r => r.id);
    let roleMap = {};
    if (userIds.length > 0) {
      const placeholders = userIds.map(() => '?').join(',');
      const [userRoleRows] = await pool.query(`
        SELECT ur.user_id, r.id AS role_id, r.code AS role_code, r.name AS role_name
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id IN (${placeholders})
      `, userIds);
      userRoleRows.forEach(ur => {
        if (!roleMap[ur.user_id]) roleMap[ur.user_id] = [];
        roleMap[ur.user_id].push({ id: ur.role_id, code: ur.role_code, name: ur.role_name });
      });
    }

    const result = rows.map(r => ({
      ...r,
      roles: roleMap[r.id] || (r.role_id ? [{ id: r.role_id, code: r.role, name: r.role }] : []),
    }));

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/change-password', async (req, res) => {
  try {
    const { userId, oldPassword, newPassword } = req.body;

    if (!userId || !oldPassword || !newPassword) {
      return res.status(400).json({ error: '缺少参数' });
    }

    const [rows] = await pool.query(
      'SELECT password_hash FROM users WHERE id = ?',
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const user = rows[0];
    const isOldPasswordValid = await bcrypt.compare(oldPassword, user.password_hash);

    if (!isOldPasswordValid) {
      return res.status(401).json({ error: '原密码错误' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await pool.query(
      'UPDATE users SET password_hash = ? WHERE id = ?',
      [hashedPassword, userId]
    );

    res.json({ success: true, message: '密码修改成功' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { userId, newPassword } = req.body;

    if (!userId || !newPassword) {
      return res.status(400).json({ error: '缺少参数' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const [result] = await pool.query(
      'UPDATE users SET password_hash = ? WHERE id = ?',
      [hashedPassword, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }

    res.json({ success: true, message: '密码重置成功' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ================================================
// 用户管理接口（管理员专用）
// ================================================

// 新增用户
router.post('/users', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { username, name, role, phone, department_id, password } = req.body;

    if (!username || !name || !role) {
      return res.status(400).json({ error: '用户名、姓名、角色为必填项' });
    }

    const validRoles = ['admin', 'finance', 'boss', 'viewer', 'temp_auditor', 'temp_chairman'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: '无效的角色' });
    }

    const [existRows] = await pool.query(
      'SELECT id FROM users WHERE username = ?',
      [username]
    );
    if (existRows.length > 0) {
      return res.status(400).json({ error: '用户名已存在' });
    }

    const [roleRows] = await pool.query(
      'SELECT id FROM roles WHERE code = ?',
      [role]
    );
    if (roleRows.length === 0) {
      return res.status(400).json({ error: '角色不存在' });
    }
    const roleId = roleRows[0].id;

    const hashedPassword = await bcrypt.hash(password || '123456', 10);
    const userId = Date.now().toString(36) + Math.random().toString(36).substr(2);

    await pool.query(
      'INSERT INTO users (id, username, name, role, role_id, phone, department_id, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [userId, username, name, role, roleId, phone, department_id, hashedPassword]
    );

    await pool.query(
      'INSERT INTO user_login_methods (id, user_id, type, identifier, config) VALUES (UUID(), ?, ?, ?, JSON_OBJECT("has_password", TRUE))',
      [userId, 'password', username]
    );

    await logOperation(req.user.id, userId, 'user', 'create', {
      username, name, role, phone, department_id
    }, req);

    res.json({ success: true, id: userId, message: '用户创建成功，初始密码为 123456' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 编辑用户信息
router.put('/users/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, role, phone, department_id } = req.body;

    const [userRows] = await pool.query('SELECT role, username, name AS original_name FROM users WHERE id = ?', [id]);
    if (userRows.length === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const validRoles = ['admin', 'finance', 'boss', 'viewer', 'temp_auditor', 'temp_chairman'];
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({ error: '无效的角色' });
    }

    let roleId = null;
    if (role) {
      const [roleRows] = await pool.query('SELECT id FROM roles WHERE code = ?', [role]);
      if (roleRows.length === 0) {
        return res.status(400).json({ error: '角色不存在' });
      }
      roleId = roleRows[0].id;
    }

    const fields = [];
    const values = [];
    const changes = {};

    if (name !== undefined && name !== userRows[0].original_name) {
      fields.push('name = ?');
      values.push(name);
      changes.name = { from: userRows[0].original_name, to: name };
    }
    if (role !== undefined && role !== userRows[0].role) {
      fields.push('role = ?');
      values.push(role);
      fields.push('role_id = ?');
      values.push(roleId);
      changes.role = { from: userRows[0].role, to: role };
    }
    if (phone !== undefined) {
      fields.push('phone = ?');
      values.push(phone);
      changes.phone = { to: phone };
    }
    if (department_id !== undefined) {
      fields.push('department_id = ?');
      values.push(department_id);
      changes.department_id = { to: department_id };
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: '没有可更新的字段' });
    }

    values.push(id);

    await pool.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = ?`,
      values
    );

    await logOperation(req.user.id, id, 'user', 'update', {
      username: userRows[0].username,
      changes
    }, req);

    res.json({ success: true, message: '用户信息更新成功' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 禁用/启用用户
router.put('/users/:id/status', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (status !== 0 && status !== 1) {
      return res.status(400).json({ error: '状态值只能是0或1' });
    }

    const [userRows] = await pool.query('SELECT username, name, status AS original_status FROM users WHERE id = ?', [id]);
    if (userRows.length === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const [result] = await pool.query(
      'UPDATE users SET status = ? WHERE id = ?',
      [status, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }

    await logOperation(req.user.id, id, 'user', status === 1 ? 'enable' : 'disable', {
      username: userRows[0].username,
      name: userRows[0].name,
      from_status: userRows[0].original_status,
      to_status: status
    }, req);

    res.json({ 
      success: true, 
      message: status === 1 ? '用户已启用' : '用户已禁用' 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 删除用户（软删除，设置status=0）
router.delete('/users/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    const [userRows] = await pool.query('SELECT username, name FROM users WHERE id = ?', [id]);
    if (userRows.length === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }

    await pool.query('UPDATE users SET status = 0 WHERE id = ?', [id]);
    await pool.query('DELETE FROM user_login_methods WHERE user_id = ?', [id]);

    await logOperation(req.user.id, id, 'user', 'delete', {
      username: userRows[0].username,
      name: userRows[0].name
    }, req);

    res.json({ success: true, message: '用户已禁用' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 获取单个用户详情
router.get('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.query(
      'SELECT id, username, name, role, role_id, status, phone, department_id, wecom_userid, created_at, last_login_at FROM users WHERE id = ?',
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ================================================
// 企业微信免登接口
// 前端在企微内打开H5页面时，通过 wx.agentConfig 或 jsapi 获取 code
// 然后调用此接口用 code 换取用户身份
// ================================================

// 用 code 换取企微用户 userid（使用查询应用的 Secret）
router.post('/wecom-login', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ error: '缺少 code 参数' });
    }

    const config = await getWecomConfig();
    const appSecret = config.query_app_secret || config.app_secret;
    if (!config || !config.corp_id || !appSecret) {
      return res.status(500).json({ error: '企业微信未配置' });
    }

    const tokenRes = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${config.corp_id}&corpsecret=${appSecret}`
    );
    const tokenData = await tokenRes.json();
    if (tokenData.errcode !== 0) {
      return res.status(500).json({ error: tokenData.errmsg || '获取access_token失败' });
    }
    const accessToken = tokenData.access_token;

    const userRes = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo?access_token=${accessToken}&code=${code}`
    );
    const userData = await userRes.json();

    if (userData.errcode !== 0) {
      return res.status(401).json({ error: userData.errmsg || 'code无效或已过期' });
    }

    const wecomUserId = userData.userid;
    if (!wecomUserId) {
      return res.status(401).json({ error: '未能获取用户身份，请确保在企业微信内打开' });
    }

    // 3. 根据企微 userid 查找本地用户（使用 user_login_methods 表）
    const [ulmRows] = await pool.query(
      'SELECT user_id FROM user_login_methods WHERE type = ? AND identifier = ?',
      ['wecom', wecomUserId]
    );

    if (ulmRows.length === 0) {
      return res.json({
        needBind: true,
        wecomUserId,
        message: '请使用账号密码登录一次以完成绑定',
      });
    }

    const userId = ulmRows[0].user_id;
    const [userRows] = await pool.query(
      'SELECT id, username, name, role, role_id, status, wecom_userid, phone, department_id FROM users WHERE id = ?',
      [userId]
    );

    if (userRows.length === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const user = userRows[0];

    if (user.status !== 1) {
      return res.status(403).json({ error: '用户已被禁用' });
    }

    pool.query('UPDATE users SET last_login_at = ? WHERE id = ?', [new Date(), user.id]);
    await logOperation(user.id, user.id, 'auth', 'login', {
      username: user.username,
      login_type: 'wecom',
      wecom_userid: wecomUserId
    }, req);

    // 4. 获取用户权限（多角色合并）
    const mergedPerms = await getUserMergedPermissions(user.id);
    const roleCodes = await getUserRoleCodes(user.id);

    res.json({
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      role_id: user.role_id,
      roles: roleCodes,
      wecom_userid: user.wecom_userid,
      phone: user.phone,
      department_id: user.department_id,
      status: user.status,
      token: user.id,
      permissions: {
        modules: mergedPerms.modules,
        codes: mergedPerms.codes,
        menuPaths: mergedPerms.menuPaths,
      },
    });
  } catch (err) {
    console.error('wecom-login error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 绑定企微账号（使用查询应用的 Secret）
router.post('/bind-wecom', requireAuth, async (req, res) => {
  try {
    const { userId, code, wecomUserId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: '缺少用户ID参数' });
    }

    let targetWecomUserId = wecomUserId;

    if (code && code !== 'manual') {
      const config = await getWecomConfig();
      const appSecret = config.query_app_secret || config.app_secret;
      if (!config || !config.corp_id || !appSecret) {
        return res.status(500).json({ error: '企业微信未配置' });
      }

      const tokenRes = await fetch(
        `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${config.corp_id}&corpsecret=${appSecret}`
      );
      const tokenData = await tokenRes.json();
      if (tokenData.errcode !== 0) {
        return res.status(500).json({ error: tokenData.errmsg || '获取access_token失败' });
      }

      const userRes = await fetch(
        `https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo?access_token=${tokenData.access_token}&code=${code}`
      );
      const userData = await userRes.json();
      if (userData.errcode !== 0 || !userData.userid) {
        return res.status(401).json({ error: userData.errmsg || 'code无效' });
      }

      targetWecomUserId = userData.userid;
    }

    if (!targetWecomUserId) {
      return res.status(400).json({ error: '缺少企微用户ID' });
    }

    // 删除该用户旧的企微绑定
    await pool.query('DELETE FROM user_login_methods WHERE user_id = ? AND type = ?', [userId, 'wecom']);
    
    // 删除该企微ID已有的绑定（一个企微只能绑定一个用户）
    await pool.query('DELETE FROM user_login_methods WHERE type = ? AND identifier = ?', ['wecom', targetWecomUserId]);

    // 插入新绑定
    await pool.query(
      'INSERT INTO user_login_methods (id, user_id, type, identifier, config) VALUES (UUID(), ?, ?, ?, JSON_OBJECT("source", "bind_api"))',
      [userId, 'wecom', targetWecomUserId]
    );

    // 同时更新 users 表（兼容旧代码）
    await pool.query('UPDATE users SET wecom_userid = ? WHERE id = ?', [targetWecomUserId, userId]);

    await logOperation(req.user.id, userId, 'user', 'bind_wecom', {
      wecom_userid: targetWecomUserId
    }, req);

    res.json({ success: true, wecomUserId: targetWecomUserId });
  } catch (err) {
    console.error('bind-wecom error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 解绑企微账号
router.post('/unbind-wecom', requireAuth, async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: '缺少用户ID参数' });
    }

    await pool.query('DELETE FROM user_login_methods WHERE user_id = ? AND type = ?', [userId, 'wecom']);
    await pool.query('UPDATE users SET wecom_userid = NULL WHERE id = ?', [userId]);

    await logOperation(req.user.id, userId, 'user', 'unbind_wecom', {}, req);

    res.json({ success: true });
  } catch (err) {
    console.error('unbind-wecom error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ================================================
// 企业微信OAuth授权（用于确认页面免登）
// 企微内打开确认链接时自动跳转授权，回调后自动登录/创建用户
// ================================================

// 1. 获取企微OAuth授权URL（直接重定向，不返回JSON）
router.get('/wecom-auth-url', async (req, res) => {
  try {
    const { redirect_uri } = req.query;
    const config = await getWecomConfig();
    const appSecret = config.query_app_secret || config.app_secret;
    
    if (!config || !config.corp_id || !appSecret) {
      return res.status(500).json({ error: '企业微信未配置' });
    }

    const agentId = config.query_app_agent_id || config.agent_id;
    if (!agentId) {
      return res.status(500).json({ error: '企业微信应用ID未配置' });
    }

    const encodedRedirect = encodeURIComponent(redirect_uri || `${req.protocol}://${req.get('host')}/confirm`);
    const authUrl = `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${config.corp_id}&redirect_uri=${encodedRedirect}&response_type=code&scope=snsapi_base&state=wecom_confirm#wechat_redirect`;
    
    // 直接重定向到企微授权页面
    res.redirect(authUrl);
  } catch (err) {
    console.error('wecom-auth-url error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. 企微OAuth回调：用code换取用户身份，自动创建/登录用户
router.post('/wecom-callback', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ error: '缺少 code 参数' });
    }

    const config = await getWecomConfig();
    const appSecret = config.query_app_secret || config.app_secret;
    if (!config || !config.corp_id || !appSecret) {
      return res.status(500).json({ error: '企业微信未配置' });
    }

    // 获取 access_token
    const tokenRes = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${config.corp_id}&corpsecret=${appSecret}`
    );
    const tokenData = await tokenRes.json();
    if (tokenData.errcode !== 0) {
      return res.status(500).json({ error: tokenData.errmsg || '获取access_token失败' });
    }
    const accessToken = tokenData.access_token;

    // 用 code 换取 userid
    const userRes = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo?access_token=${accessToken}&code=${code}`
    );
    const userData = await userRes.json();

    if (userData.errcode !== 0) {
      return res.status(401).json({ error: userData.errmsg || 'code无效或已过期' });
    }

    const wecomUserId = userData.userid;
    if (!wecomUserId) {
      return res.status(401).json({ error: '未能获取用户身份，请确保在企业微信内打开' });
    }

    // 获取用户详细信息（姓名、部门等）
    let wecomUserInfo = null;
    try {
      const infoRes = await fetch(
        `https://qyapi.weixin.qq.com/cgi-bin/user/get?access_token=${accessToken}&userid=${wecomUserId}`
      );
      const infoData = await infoRes.json();
      if (infoData.errcode === 0) {
        wecomUserInfo = infoData;
      }
    } catch (e) {
      console.log('获取企微用户详情失败:', e.message);
    }

    // 查找已绑定的用户
    let [ulmRows] = await pool.query(
      'SELECT user_id FROM user_login_methods WHERE type = ? AND identifier = ?',
      ['wecom', wecomUserId]
    );

    if (ulmRows.length === 0) {
      // 未绑定用户，返回提示（不自动创建）
      return res.json({
        needBind: true,
        wecomUserId,
        wecomName: wecomUserInfo?.name || wecomUserId,
        message: '您的企业微信账号未绑定系统用户，请联系管理员绑定',
      });
    }

    const userId = ulmRows[0].user_id;

    // 查询用户信息
    const [userRows] = await pool.query(
      'SELECT id, username, name, role, role_id, status, wecom_userid, phone, department_id FROM users WHERE id = ?',
      [userId]
    );

    if (userRows.length === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const user = userRows[0];
    if (user.status !== 1) {
      return res.status(403).json({ error: '用户已被禁用' });
    }

    pool.query('UPDATE users SET last_login_at = ? WHERE id = ?', [new Date(), user.id]);
    await logOperation(user.id, user.id, 'auth', 'login', {
      username: user.username,
      login_type: 'wecom_oauth',
      wecom_userid: wecomUserId,
      is_new_user: false
    }, req);

    // 获取用户权限（多角色合并）
    const mergedPerms = await getUserMergedPermissions(user.id);
    const roleCodes = await getUserRoleCodes(user.id);

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        role_id: user.role_id,
        roles: roleCodes,
        wecom_userid: user.wecom_userid,
        phone: user.phone,
        department_id: user.department_id,
        status: user.status,
        token: user.id,
        permissions: {
          modules: mergedPerms.modules,
          codes: mergedPerms.codes,
          menuPaths: mergedPerms.menuPaths,
        },
      },
      isNewUser: false,
    });
  } catch (err) {
    console.error('wecom-callback error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 更新用户角色（仅管理员）
router.put('/users/:id/role', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    const validRoles = ['admin', 'finance', 'boss', 'viewer', 'temp_auditor', 'temp_chairman'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: '无效的角色' });
    }

    const [userRows] = await pool.query('SELECT username, name, role AS original_role FROM users WHERE id = ?', [id]);
    if (userRows.length === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const [roleRows] = await pool.query('SELECT id FROM roles WHERE code = ?', [role]);
    if (roleRows.length === 0) {
      return res.status(400).json({ error: '角色不存在' });
    }
    const roleId = roleRows[0].id;

    await pool.query('UPDATE users SET role = ?, role_id = ? WHERE id = ?', [role, roleId, id]);

    await logOperation(req.user.id, id, 'user', 'update_role', {
      username: userRows[0].username,
      name: userRows[0].name,
      from_role: userRows[0].original_role,
      to_role: role
    }, req);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;