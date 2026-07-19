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
      'SELECT id, username, name, role, password_hash, wecom_userid FROM users WHERE username = ?',
      [username]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    const user = rows[0];
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    res.json({
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      wecom_userid: user.wecom_userid,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/users', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, username, name, role, wecom_userid, created_at FROM users ORDER BY created_at ASC'
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
    // 查询应用优先使用 query_app_secret，没有则回退到 app_secret
    const appSecret = config.query_app_secret || config.app_secret;
    if (!config || !config.corp_id || !appSecret) {
      return res.status(500).json({ error: '企业微信未配置' });
    }

    // 1. 获取 access_token（使用查询应用的Secret）
    const tokenRes = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${config.corp_id}&corpsecret=${appSecret}`
    );
    const tokenData = await tokenRes.json();
    if (tokenData.errcode !== 0) {
      return res.status(500).json({ error: tokenData.errmsg || '获取access_token失败' });
    }
    const accessToken = tokenData.access_token;

    // 2. 用 code 获取 userid
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

    // 3. 根据企微 userid 查找本地用户
    const [rows] = await pool.query(
      'SELECT id, username, name, role, wecom_userid FROM users WHERE wecom_userid = ?',
      [wecomUserId]
    );

    if (rows.length === 0) {
      return res.json({
        needBind: true,
        wecomUserId,
        message: '请使用账号密码登录一次以完成绑定',
      });
    }

    const user = rows[0];
    res.json({
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      wecomUserId: user.wecom_userid,
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

    await pool.query(
      'UPDATE users SET wecom_userid = ? WHERE id = ?',
      [targetWecomUserId, userId]
    );

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

    await pool.query(
      'UPDATE users SET wecom_userid = NULL WHERE id = ?',
      [userId]
    );

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