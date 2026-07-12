const express = require('express');
const router = express.Router();
const pool = require('../db');

async function getWecomConfig() {
  const [rows] = await pool.query('SELECT * FROM wecom_config WHERE id = 1');
  return rows.length > 0 ? rows[0] : null;
}

async function getAccessToken(config) {
  const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${config.corp_id}&corpsecret=${config.app_secret}`);
  const data = await res.json();
  if (data.errcode !== 0) throw new Error(data.errmsg || '获取access_token失败');
  return data.access_token;
}

async function sendWecomMessage(config, content) {
  const accessToken = await getAccessToken(config);
  const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/appchat/send?access_token=${accessToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chatid: config.chat_id,
      msgtype: 'text',
      text: { content },
      safe: 0
    })
  });
  const data = await res.json();
  if (data.errcode !== 0) throw new Error(data.errmsg || '发送消息失败');
  return data.msgid || 'sent';
}

async function getApprovalTemplateDetail(config, templateId) {
  const accessToken = await getAccessToken(config);
  const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/oa/gettemplatedetail?access_token=${accessToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ template_id: templateId })
  });
  const data = await res.json();
  if (data.errcode !== 0) throw new Error(data.errmsg || '获取模板详情失败');
  return data;
}

async function submitApproval(config, applyData) {
  const accessToken = await getAccessToken(config);
  const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/oa/applyevent?access_token=${accessToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(applyData)
  });
  const data = await res.json();
  if (data.errcode !== 0) throw new Error(data.errmsg || '提交审批失败');
  return data.sp_no;
}

async function getApprovalDetail(config, spNo) {
  const accessToken = await getAccessToken(config);
  const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/oa/getapprovaldetail?access_token=${accessToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sp_no: spNo })
  });
  const data = await res.json();
  if (data.errcode !== 0) throw new Error(data.errmsg || '查询审批详情失败');
  return data;
}

// 获取配置
router.get('/config', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM wecom_config WHERE id = 1');
    if (rows.length === 0) {
      // 自动创建空配置行
      await pool.query('INSERT INTO wecom_config (id) VALUES (1)');
      return res.json({});
    }
    const config = rows[0];
    // 不直接返回敏感字段，返回脱敏版本
    res.json({
      ...config,
      app_secret: config.app_secret ? '****' : '',
      bank_account: config.bank_account ? '****' : '',
      callback_aes_key: config.callback_aes_key ? '****' : '',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 获取敏感字段（需要明确请求）
router.get('/config/secret/:field', async (req, res) => {
  try {
    const { field } = req.params;
    const allowedFields = ['app_secret', 'bank_account', 'callback_aes_key'];
    if (!allowedFields.includes(field)) {
      return res.status(400).json({ error: '不允许的字段' });
    }
    const [rows] = await pool.query(`SELECT ${field} as value FROM wecom_config WHERE id = 1`);
    if (rows.length === 0 || !rows[0].value) {
      return res.json({ value: '' });
    }
    res.json({ value: rows[0].value });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 保存配置
router.put('/config', async (req, res) => {
  try {
    const {
      corp_id, app_secret, agent_id, chat_id,
      approval_template_id, applicant_userid,
      payment_options, default_payment_key,
      payee_name, bank_name, bank_account,
      payment_reason_template, approval_field_mapping,
      callback_token, callback_aes_key
    } = req.body;

    // 确保配置行存在
    await pool.query('INSERT IGNORE INTO wecom_config (id) VALUES (1)');

    const fields = [];
    const values = [];

    if (corp_id !== undefined) { fields.push('corp_id = ?'); values.push(corp_id || null); }
    if (app_secret !== undefined && app_secret !== '****') { fields.push('app_secret = ?'); values.push(app_secret || null); }
    if (agent_id !== undefined) { fields.push('agent_id = ?'); values.push(agent_id || null); }
    if (chat_id !== undefined) { fields.push('chat_id = ?'); values.push(chat_id || null); }
    if (approval_template_id !== undefined) { fields.push('approval_template_id = ?'); values.push(approval_template_id || null); }
    if (applicant_userid !== undefined) { fields.push('applicant_userid = ?'); values.push(applicant_userid || null); }
    if (payment_options !== undefined) { fields.push('payment_options = ?'); values.push(JSON.stringify(payment_options)); }
    if (default_payment_key !== undefined) { fields.push('default_payment_key = ?'); values.push(default_payment_key || null); }
    if (payee_name !== undefined) { fields.push('payee_name = ?'); values.push(payee_name || null); }
    if (bank_name !== undefined) { fields.push('bank_name = ?'); values.push(bank_name || null); }
    if (bank_account !== undefined && bank_account !== '****') { fields.push('bank_account = ?'); values.push(bank_account || null); }
    if (payment_reason_template !== undefined) { fields.push('payment_reason_template = ?'); values.push(payment_reason_template || null); }
    if (approval_field_mapping !== undefined) { fields.push('approval_field_mapping = ?'); values.push(JSON.stringify(approval_field_mapping)); }
    if (callback_token !== undefined) { fields.push('callback_token = ?'); values.push(callback_token || null); }
    if (callback_aes_key !== undefined && callback_aes_key !== '****') { fields.push('callback_aes_key = ?'); values.push(callback_aes_key || null); }

    if (fields.length > 0) {
      values.push(1);
      await pool.query(`UPDATE wecom_config SET ${fields.join(', ')} WHERE id = ?`, values);
    }

    const [rows] = await pool.query('SELECT * FROM wecom_config WHERE id = 1');
    const config = rows[0];
    res.json({
      ...config,
      app_secret: config.app_secret ? '****' : '',
      bank_account: config.bank_account ? '****' : '',
      callback_aes_key: config.callback_aes_key ? '****' : '',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 测试发送消息到群
router.post('/test-message', async (req, res) => {
  try {
    const config = await getWecomConfig();
    if (!config || !config.corp_id || !config.app_secret || !config.chat_id) {
      return res.status(400).json({ error: '请先完成企业微信应用配置和群聊配置' });
    }
    await sendWecomMessage(config, '【测试消息】企业微信配置成功！此消息来自食材采购管理系统。');
    res.json({ success: true, message: '测试消息已发送' });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
});

// 拉取审批模板详情
router.get('/approval-template/:templateId', async (req, res) => {
  try {
    const { templateId } = req.params;
    const config = await getWecomConfig();
    if (!config || !config.corp_id || !config.app_secret) {
      return res.status(400).json({ error: '请先完成企业微信应用配置' });
    }
    const tplData = await getApprovalTemplateDetail(config, templateId);
    res.json(tplData);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
});

// 查询审批单详情（主动查询）
router.get('/approval/:spNo', async (req, res) => {
  try {
    const { spNo } = req.params;
    const config = await getWecomConfig();
    if (!config || !config.corp_id || !config.app_secret) {
      return res.status(400).json({ error: '请先完成企业微信应用配置' });
    }
    const detail = await getApprovalDetail(config, spNo);
    res.json(detail);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
});

// 企微回调处理
router.get('/callback', (req, res) => {
  // 企微验证URL有效性
  const { msg_signature, timestamp, nonce, echostr } = req.query;
  // TODO: 验证签名
  res.send(echostr);
});

router.post('/callback', (req, res) => {
  // 处理企微回调事件（审批状态变更等）
  res.send('success');
});

module.exports = router;
module.exports.getWecomConfig = getWecomConfig;
module.exports.sendWecomMessage = sendWecomMessage;
module.exports.getApprovalTemplateDetail = getApprovalTemplateDetail;
module.exports.submitApproval = submitApproval;
module.exports.getApprovalDetail = getApprovalDetail;
