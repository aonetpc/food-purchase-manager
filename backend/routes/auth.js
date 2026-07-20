const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcrypt');

// 获取企业微信配置
async function getWecomConfig() {
  const [rows] = await pool.query('SELECT * FROM wecom_config WHERE id = 1');
  return rows.length > 0 ? rows[0] : null;
}

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const [rows] = await pool.query(
      'SELECT id, username, name, role, role_id, status, password_hash, wecom_userid, phone, department_id FROM users WHERE username = ?',
      [username]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    const user = rows[0];

    if (user.status !== 1) {
      return res.status(403).json({ error: '用户已被禁用' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    pool.query('UPDATE users SET last_login_at = ? WHERE id = ?', [new Date(), user.id]);

    const [permRows] = await pool.query(`
      SELECT p.id, p.code, p.name, p.type, p.path, p.icon, p.module_id, m.code as module_code
      FROM role_permissions rp
      JOIN permissions p ON rp.permission_id = p.id
      JOIN modules m ON p.module_id = m.id
      WHERE rp.role_id = ? AND p.status = 1 AND m.status = 1
      ORDER BY m.sort_order ASC, p.sort_order ASC
    `, [user.role_id]);

    const modules = {};
    permRows.forEach(perm => {
      if (!modules[perm.module_code]) {
        modules[perm.module_code] = { menus: [], actions: [] };
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

    res.json({
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      role_id: user.role_id,
      wecom_userid: user.wecom_userid,
      phone: user.phone,
      department_id: user.department_id,
      status: user.status,
      token: user.id,
      permissions: {
        modules: Object.values(modules),
        codes: permRows.map(p => p.code),
        menuPaths: permRows.filter(p => p.type === 'menu' && p.path).map(p => p.path),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/users', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, username, name, role, role_id, status, phone, department_id, wecom_userid, created_at, last_login_at FROM users ORDER BY created_at ASC'
    );
    res.json(rows);
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

    // 4. 获取用户权限
    const [permRows] = await pool.query(`
      SELECT p.id, p.code, p.name, p.type, p.path, p.icon, p.module_id, m.code as module_code
      FROM role_permissions rp
      JOIN permissions p ON rp.permission_id = p.id
      JOIN modules m ON p.module_id = m.id
      WHERE rp.role_id = ? AND p.status = 1 AND m.status = 1
      ORDER BY m.sort_order ASC, p.sort_order ASC
    `, [user.role_id]);

    const modules = {};
    permRows.forEach(perm => {
      if (!modules[perm.module_code]) {
        modules[perm.module_code] = { menus: [], actions: [] };
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

    res.json({
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      role_id: user.role_id,
      wecom_userid: user.wecom_userid,
      phone: user.phone,
      department_id: user.department_id,
      status: user.status,
      token: user.id,
      permissions: {
        modules: Object.values(modules),
        codes: permRows.map(p => p.code),
        menuPaths: permRows.filter(p => p.type === 'menu' && p.path).map(p => p.path),
      },
    });
  } catch (err) {
    console.error('wecom-login error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 绑定企微账号（使用查询应用的 Secret）
router.post('/bind-wecom', async (req, res) => {
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

    res.json({ success: true, wecomUserId: targetWecomUserId });
  } catch (err) {
    console.error('bind-wecom error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 解绑企微账号
router.post('/unbind-wecom', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: '缺少用户ID参数' });
    }

    await pool.query('DELETE FROM user_login_methods WHERE user_id = ? AND type = ?', [userId, 'wecom']);
    await pool.query('UPDATE users SET wecom_userid = NULL WHERE id = ?', [userId]);

    res.json({ success: true });
  } catch (err) {
    console.error('unbind-wecom error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 更新用户角色（仅管理员）
router.put('/users/:id/role', async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    const validRoles = ['admin', 'finance', 'boss', 'viewer'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: '无效的角色' });
    }

    await pool.query('UPDATE users SET role = ? WHERE id = ?', [role, id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;