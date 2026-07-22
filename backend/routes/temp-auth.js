/**
 * 外请人员打卡模块 - 微信认证路由
 *
 * 接口列表：
 *   POST /api/temp/auth/wx-login          微信登录（code 换 openid，自动注册）
 *   POST /api/temp/auth/register          完善注册信息（姓名、手机号）
 *   GET  /api/temp/auth/me                获取当前用户信息
 *   GET  /api/temp/auth/positions         获取我可打卡的岗位
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../db');
const { requireTempAuth, getTempUserPositions, getTempPositions } = require('../middleware/tempAuth');

/**
 * 读取微信配置
 */
async function getWechatConfig() {
  const [rows] = await pool.query('SELECT * FROM wechat_config WHERE id = 1');
  return rows.length > 0 ? rows[0] : null;
}

// ================================================
// 微信登录（code 换 openid，自动注册）
// ================================================
router.post('/wx-login', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ error: '缺少 code 参数' });
    }

    const config = await getWechatConfig();
    if (!config || !config.app_id || !config.app_secret) {
      return res.status(500).json({ error: '微信登录未配置，请联系管理员' });
    }

    // 用 code 换取 openid
    const tokenRes = await fetch(
      `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${config.app_id}&secret=${config.app_secret}&code=${code}&grant_type=authorization_code`
    );
    const tokenData = await tokenRes.json();

    if (tokenData.errcode) {
      return res.status(401).json({ error: tokenData.errmsg || 'code无效或已过期' });
    }

    const openid = tokenData.openid;
    const unionid = tokenData.unionid || null;

    // 查找已注册用户
    const [existing] = await pool.query(
      'SELECT * FROM temp_worker_users WHERE openid = ?',
      [openid]
    );

    if (existing.length > 0) {
      // 已注册用户：直接登录
      const user = existing[0];

      if (user.status !== 1) {
        return res.status(403).json({ error: '账号已被禁用' });
      }

      pool.query('UPDATE temp_worker_users SET last_login_at = ? WHERE id = ?', [new Date(), user.id]);

      const isNewUser = !user.name;
      const redirectUrl = `${req.headers.origin}/temp/login#token=temp_${user.id}&is_new_user=${isNewUser}&user_id=${user.id}&user_name=${encodeURIComponent(user.name || '')}&user_phone=${encodeURIComponent(user.phone || '')}`;
      return res.redirect(redirectUrl);
    }

    // 新用户：自动创建（仅 openid，等前端补充姓名手机号）
    const userId = uuidv4();
    try {
      await pool.query(
      'INSERT INTO temp_worker_users (id, openid, unionid, status) VALUES (?, ?, ?, 1)',
      [userId, openid, unionid]
    );

    const redirectUrl = `${req.headers.origin}/temp/login#token=temp_${userId}&is_new_user=true&user_id=${userId}`;
    return res.redirect(redirectUrl);
    } catch (insertErr) {
      console.error('temp wx-login insert error:', insertErr);
      res.status(500).json({ error: insertErr.message });
    }
  } catch (err) {
    console.error('temp wx-login error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ================================================
// 完善注册信息（姓名、手机号）
// ================================================
router.post('/register', requireTempAuth, async (req, res) => {
  try {
    const { name, phone } = req.body;

    if (!name) {
      return res.status(400).json({ error: '姓名为必填项' });
    }

    await pool.query(
      'UPDATE temp_worker_users SET name = ?, phone = ? WHERE id = ?',
      [name, phone || null, req.tempUser.id]
    );

    res.json({
      success: true,
      user: {
        id: req.tempUser.id,
        name,
        phone: phone || null,
        avatar_url: req.tempUser.avatar_url,
      },
    });
  } catch (err) {
    console.error('temp register error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ================================================
// 获取当前用户信息
// ================================================
router.get('/me', requireTempAuth, async (req, res) => {
  try {
    const positions = await getTempUserPositions(req.tempUser.id);
    const tempPositions = await getTempPositions();

    res.json({
      user: {
        id: req.tempUser.id,
        name: req.tempUser.name,
        phone: req.tempUser.phone,
        avatar_url: req.tempUser.avatar_url,
      },
      my_positions: positions,
      temp_positions: tempPositions,
    });
  } catch (err) {
    console.error('temp me error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
