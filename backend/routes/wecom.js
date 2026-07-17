const express = require('express');
const router = express.Router();
const crypto = require('crypto');
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

async function sendViaWebhook(webhookUrl, content) {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msgtype: 'text',
      text: { content }
    })
  });
  const data = await res.json();
  if (data.errcode !== 0) throw new Error(data.errmsg || 'Webhook发送失败');
  return 'sent';
}

async function sendMarkdownViaWebhook(webhookUrl, content) {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msgtype: 'markdown',
      markdown: { content }
    })
  });
  const data = await res.json();
  if (data.errcode !== 0) throw new Error(data.errmsg || 'Webhook发送失败');
  return 'sent';
}

async function createGroupChat(config, name, members) {
  const accessToken = await getAccessToken(config);
  const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/appchat/create?access_token=${accessToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: name || '食材采购群',
      owner: members[0] || '',
      userlist: members || [],
      chat_id: ''
    })
  });
  const data = await res.json();
  if (data.errcode !== 0) throw new Error(data.errmsg || '创建群聊失败');
  return data.chat_id;
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

async function uploadMedia(config, filePath, fileName) {
  const accessToken = await getAccessToken(config);
  const fs = require('fs');
  const path = require('path');
  const fileBuffer = fs.readFileSync(filePath);
  const ext = path.extname(fileName).toLowerCase();
  const mimeType = ext === '.pdf' ? 'application/pdf' : 'application/octet-stream';
  
  const boundary = '----WeComBoundary' + Date.now();
  const crlf = '\r\n';
  
  const prefix = Buffer.from([
    `--${boundary}`,
    `Content-Disposition: form-data; name="media"; filename="${fileName}"`,
    `Content-Type: ${mimeType}`,
    '',
    ''
  ].join(crlf));
  
  const suffix = Buffer.from(crlf + `--${boundary}--` + crlf);
  
  const body = Buffer.concat([prefix, fileBuffer, suffix]);
  
  const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/media/upload?access_token=${accessToken}&type=file`, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body.length
    },
    body: body
  });
  const data = await res.json();
  console.log('上传文件响应:', JSON.stringify(data));
  if (data.errcode !== 0) throw new Error(data.errmsg || '上传文件失败');
  return data.media_id;
}

function sha1(str) {
  return crypto.createHash('sha1').update(str).digest('hex');
}

function verifySignature(token, timestamp, nonce, msgEncrypt, msgSignature) {
  const arr = [token, timestamp, nonce, msgEncrypt].sort();
  const str = arr.join('');
  const signature = sha1(str);
  return signature === msgSignature;
}

function decryptMsg(encodingAESKey, msgEncrypt, corpid) {
  const aesKey = Buffer.from(encodingAESKey + '=', 'base64');
  const iv = aesKey.slice(0, 16);
  const encrypted = Buffer.from(msgEncrypt, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, iv);
  decipher.setAutoPadding(false);
  let decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

  // 去掉PKCS7填充
  const pad = decrypted[decrypted.length - 1];
  decrypted = decrypted.slice(0, decrypted.length - pad);

  // 16字节随机串 + 4字节消息长度 + 消息内容 + corpid
  const msgLen = decrypted.readUInt32BE(16);
  const msgContent = decrypted.slice(20, 20 + msgLen).toString('utf8');
  const fromCorpid = decrypted.slice(20 + msgLen).toString('utf8');

  if (fromCorpid !== corpid) {
    throw new Error('corpid不匹配');
  }

  return msgContent;
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
      corp_id, app_secret, agent_id, chat_id, webhook_url,
      approval_template_id, applicant_userid,
      payment_options, default_payment_key,
      payee_name, bank_name, bank_account,
      payment_reason_template, approval_field_mapping,
      callback_token, callback_aes_key, app_domain
    } = req.body;

    // 确保配置行存在
    await pool.query('INSERT IGNORE INTO wecom_config (id) VALUES (1)');

    const fields = [];
    const values = [];

    if (corp_id !== undefined) { fields.push('corp_id = ?'); values.push(corp_id || null); }
    if (app_secret !== undefined && app_secret !== '****') { fields.push('app_secret = ?'); values.push(app_secret || null); }
    if (agent_id !== undefined) { fields.push('agent_id = ?'); values.push(agent_id || null); }
    if (chat_id !== undefined) { fields.push('chat_id = ?'); values.push(chat_id || null); }
    if (webhook_url !== undefined) { fields.push('webhook_url = ?'); values.push(webhook_url || null); }
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
    if (app_domain !== undefined) { fields.push('app_domain = ?'); values.push(app_domain || null); }

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
    if (!config) {
      return res.status(400).json({ error: '请先完成企业微信应用配置' });
    }
    
    // 优先使用 Webhook
    if (config.webhook_url) {
      await sendMarkdownViaWebhook(config.webhook_url, 
        '**【测试消息】**\n\n企业微信配置成功！此消息来自食材采购管理系统。\n\n> 发送时间：' + new Date().toLocaleString('zh-CN')
      );
      return res.json({ success: true, message: '测试消息已通过Webhook发送，请检查企业微信群' });
    }
    
    // 回退到 API 方式
    if (!config.corp_id || !config.app_secret || !config.chat_id) {
      return res.status(400).json({ error: '请先配置Webhook URL或完成企业微信应用配置和群聊配置' });
    }
    await sendWecomMessage(config, '【测试消息】企业微信配置成功！此消息来自食材采购管理系统。');
    res.json({ success: true, message: '测试消息已发送' });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
});

// 创建群聊
router.post('/create-group', async (req, res) => {
  try {
    const { name, members } = req.body;
    const config = await getWecomConfig();
    if (!config || !config.corp_id || !config.app_secret) {
      return res.status(400).json({ error: '请先完成企业微信应用配置' });
    }
    if (!members || members.length === 0) {
      return res.status(400).json({ error: '请至少指定一个群成员' });
    }
    const chatId = await createGroupChat(config, name, members);
    
    await pool.query('UPDATE wecom_config SET chat_id = ? WHERE id = 1', [chatId]);
    
    res.json({ success: true, chat_id: chatId, message: '群聊创建成功' });
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

// 获取最近的回调日志（方便找群ID）
router.get('/callback-logs', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM wecom_callback_logs ORDER BY id DESC LIMIT 20'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 企微回调处理 - URL验证
router.get('/callback', async (req, res) => {
  try {
    const { msg_signature, timestamp, nonce, echostr } = req.query;
    const config = await getWecomConfig();

    if (!config || !config.callback_token || !config.callback_aes_key) {
      return res.status(400).send('回调未配置');
    }

    const isValid = verifySignature(config.callback_token, timestamp, nonce, echostr, msg_signature);
    if (!isValid) {
      return res.status(403).send('签名验证失败');
    }

    const decrypted = decryptMsg(config.callback_aes_key, echostr, config.corp_id);
    res.send(decrypted);
  } catch (err) {
    console.error('回调验证失败:', err);
    res.status(500).send('验证失败');
  }
});

// 企微回调处理 - 接收消息
router.post('/callback', async (req, res) => {
  try {
    const { msg_signature, timestamp, nonce } = req.query;
    const config = await getWecomConfig();

    if (!config || !config.callback_token || !config.callback_aes_key) {
      return res.send('success');
    }

    const { Encrypt } = req.body;
    const isValid = verifySignature(config.callback_token, timestamp, nonce, Encrypt, msg_signature);
    if (!isValid) {
      return res.status(403).send('签名验证失败');
    }

    const xmlContent = decryptMsg(config.callback_aes_key, Encrypt, config.corp_id);
    console.log('收到企微回调:', xmlContent.substring(0, 500));

    // 解析XML
    const fromUserMatch = xmlContent.match(/<FromUserName><!\[CDATA\[(.+?)\]\]><\/FromUserName>/);
    const toUserMatch = xmlContent.match(/<ToUserName><!\[CDATA\[(.+?)\]\]><\/ToUserName>/);
    const msgTypeMatch = xmlContent.match(/<MsgType><!\[CDATA\[(.+?)\]\]><\/MsgType>/);
    const chatIdMatch = xmlContent.match(/<ChatId><!\[CDATA\[(.+?)\]\]><\/ChatId>/);
    const eventMatch = xmlContent.match(/<Event><!\[CDATA\[(.+?)\]\]><\/Event>/);
    const spNoMatch = xmlContent.match(/<SpNo><!\[CDATA\[(.+?)\]\]><\/SpNo>/);
    const spStatusMatch = xmlContent.match(/<SpStatus>(\d+)<\/SpStatus>/);

    const fromUser = fromUserMatch ? fromUserMatch[1] : '';
    const toUser = toUserMatch ? toUserMatch[1] : '';
    const msgType = msgTypeMatch ? msgTypeMatch[1] : '';
    const chatId = chatIdMatch ? chatIdMatch[1] : '';
    const event = eventMatch ? eventMatch[1] : '';
    const spNo = spNoMatch ? spNoMatch[1] : '';
    const spStatus = spStatusMatch ? parseInt(spStatusMatch[1]) : null;

    // 审批状态变更事件
    if (msgType === 'event' && event === 'open_approval_change' && spNo) {
      try {
        const [rows] = await pool.query(
          'SELECT id FROM purchase_confirmations WHERE reimbursement_sp_no = ?',
          [spNo]
        );
        if (rows.length > 0) {
          let reimburseStatus = 'processing';
          let status = 'reimbursing';
          if (spStatus === 2) {
            reimburseStatus = 'approved';
            status = 'reimbursed';
          } else if (spStatus === 3) {
            reimburseStatus = 'rejected';
          }
          await pool.query(
            'UPDATE purchase_confirmations SET reimbursement_status = ?, status = ? WHERE reimbursement_sp_no = ?',
            [reimburseStatus, status, spNo]
          );
        }
      } catch (dbErr) {
        console.error('更新审批状态失败:', dbErr);
      }
    }

    // 群聊消息 - 记录到数据库方便查看群ID
    if (chatId) {
      try {
        await pool.query(
          'INSERT INTO wecom_callback_logs (chat_id, from_user, msg_type, event, content) VALUES (?, ?, ?, ?, ?)',
          [chatId, fromUser, msgType, event, xmlContent.substring(0, 1000)]
        );
      } catch (dbErr) {
        // 忽略日志保存失败
      }
    }

    res.send('success');
  } catch (err) {
    console.error('回调处理失败:', err);
    res.send('success');
  }
});

module.exports = router;
module.exports.getWecomConfig = getWecomConfig;
module.exports.sendWecomMessage = sendWecomMessage;
module.exports.sendMarkdownViaWebhook = sendMarkdownViaWebhook;
module.exports.sendViaWebhook = sendViaWebhook;
module.exports.getApprovalTemplateDetail = getApprovalTemplateDetail;
module.exports.submitApproval = submitApproval;
module.exports.getApprovalDetail = getApprovalDetail;
module.exports.uploadMedia = uploadMedia;
