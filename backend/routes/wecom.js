const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const pool = require('../db');
const { generateConfirmationPDF: generatePDF } = require('../utils/pdf');

const PDF_DIR = '/opt/food-purchase/backend/uploads/pdfs';
if (!fs.existsSync(PDF_DIR)) {
  fs.mkdirSync(PDF_DIR, { recursive: true });
}

function findChineseFont() {
  const paths = [
    path.join(__dirname, '..', 'fonts', 'SourceHanSansSC-Regular.otf'),
    path.join(__dirname, '..', 'node_modules', '@fontpkg', 'source-han-sans-sc', 'SourceHanSansSC-Regular.otf'),
    '/usr/share/fonts/truetype/wqy/wqy-microhei.ttf',
    '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttf',
    '/usr/share/fonts/truetype/noto/NotoSansCJKsc-Regular.ttf'
  ];
  for (const p of paths) {
    if (fs.existsSync(p) && !p.endsWith('.ttc')) return p;
  }
  return null;
}

function findChineseBoldFont() {
  const paths = [
    path.join(__dirname, '..', 'fonts', 'SourceHanSansSC-Bold.otf'),
    path.join(__dirname, '..', 'node_modules', '@fontpkg', 'source-han-sans-sc', 'SourceHanSansSC-Bold.otf'),
    '/usr/share/fonts/truetype/wqy/wqy-microhei-bold.ttf',
    '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttf',
    '/usr/share/fonts/truetype/noto/NotoSansCJKsc-Bold.ttf'
  ];
  for (const p of paths) {
    if (fs.existsSync(p) && !p.endsWith('.ttc')) return p;
  }
  return null;
}

function toNum(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (typeof val === 'object' && val !== null) {
    val = val.String || val.string || JSON.stringify(val);
  }
  const n = parseFloat(String(val));
  return isNaN(n) ? 0 : n;
}

async function getWecomConfig() {
  const [rows] = await pool.query('SELECT * FROM wecom_config WHERE id = 1');
  return rows.length > 0 ? rows[0] : null;
}

// access_token 缓存（企微token有效期7200秒，缓存7000秒）
let _accessTokenCache = { token: '', expireTime: 0 };
const ACCESS_TOKEN_CACHE_TTL = 7000 * 1000; // 7000秒

async function getAccessToken(config) {
  const now = Date.now();
  if (_accessTokenCache.token && (now - _accessTokenCache.expireTime) < ACCESS_TOKEN_CACHE_TTL) {
    return _accessTokenCache.token;
  }
  const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${config.corp_id}&corpsecret=${config.app_secret}`);
  const data = await res.json();
  if (data.errcode !== 0) throw new Error(data.errmsg || '获取access_token失败');
  _accessTokenCache = { token: data.access_token, expireTime: now };
  return data.access_token;
}

// ================================================
// 获取企微用户真实姓名（优先从数据库缓存读取）
// ================================================
async function getWecomUserName(userid) {
  if (!userid) return userid;

  // 1. 查数据库缓存
  try {
    const [rows] = await pool.query('SELECT name FROM wecom_users WHERE userid = ?', [userid]);
    if (rows.length > 0 && rows[0].name) {
      console.log(`[getWecomUserName] 从缓存获取姓名：${userid} → ${rows[0].name}`);
      return rows[0].name;
    }
  } catch (e) {
    console.error(`[getWecomUserName] 查询缓存失败:`, e.message);
  }

  // 2. 调用企微 API 获取用户信息
  try {
    const config = await getWecomConfig();
    if (!config || !config.corp_id || !config.app_secret) {
      console.warn(`[getWecomUserName] 企微配置缺失，返回 userid: ${userid}`);
      return userid;
    }

    const token = await getAccessToken(config);
    const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/user/get?access_token=${token}&userid=${userid}`);
    const data = await res.json();

    if (data.errcode === 0 && data.name) {
      // 3. 存入数据库缓存
      try {
        await pool.query(
          `INSERT INTO wecom_users (userid, name, position, avatar, mobile, email, status)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE name = ?, position = ?, avatar = ?, mobile = ?, email = ?, status = ?, updated_at = CURRENT_TIMESTAMP`,
          [
            userid, data.name, data.position || null, data.avatar || null, data.mobile || null, data.email || null, data.status || 1,
            data.name, data.position || null, data.avatar || null, data.mobile || null, data.email || null, data.status || 1
          ]
        );
        console.log(`[getWecomUserName] API获取并缓存姓名：${userid} → ${data.name}`);
      } catch (insertErr) {
        console.error(`[getWecomUserName] 缓存用户信息失败:`, insertErr.message);
      }
      return data.name;
    } else {
      console.warn(`[getWecomUserName] API返回错误:`, data.errmsg || '未知错误');
    }
  } catch (apiErr) {
    console.error(`[getWecomUserName] 调用企微API失败:`, apiErr.message);
  }

  // 4. 失败时返回 userid 作为 fallback
  return userid;
}

async function sendWecomMessage(config, content, mentionedList = []) {
  const accessToken = await getAccessToken(config);
  const textBody = { content };
  if (mentionedList && mentionedList.length > 0) {
    textBody.mentioned_list = mentionedList;
  }
  const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/appchat/send?access_token=${accessToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chatid: config.chat_id,
      msgtype: 'text',
      text: textBody,
      safe: 0
    })
  });
  const data = await res.json();
  if (data.errcode !== 0) throw new Error(data.errmsg || '发送消息失败');
  return data.msgid || 'sent';
}

// 通过自建应用发送个人消息（文本）
async function sendTextToUser(config, userid, content) {
  const accessToken = await getAccessToken(config);
  const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${accessToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      touser: userid,
      msgtype: 'text',
      agentid: Number(config.agent_id),
      text: { content },
      safe: 0
    })
  });
  const data = await res.json();
  if (data.errcode !== 0) throw new Error(data.errmsg || '发送个人消息失败');
  return data.msgid || 'sent';
}

// 通过自建应用发送个人消息（Markdown）
async function sendMarkdownToUser(config, userid, content) {
  const accessToken = await getAccessToken(config);
  const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${accessToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      touser: userid,
      msgtype: 'markdown',
      agentid: Number(config.agent_id),
      markdown: { content },
      safe: 0
    })
  });
  const data = await res.json();
  if (data.errcode !== 0) throw new Error(data.errmsg || '发送个人Markdown消息失败');
  return data.msgid || 'sent';
}

// 通过自建应用发送个人消息（文本卡片，带跳转链接，类似交互消息）
async function sendTextCardToUser(config, userid, { title, description, url, btntxt }) {
  const accessToken = await getAccessToken(config);
  const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${accessToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      touser: userid,
      msgtype: 'textcard',
      agentid: Number(config.agent_id),
      textcard: {
        title: title || '消息通知',
        description: description || '',
        url: url || '',
        btntxt: btntxt || '点击查看'
      },
      safe: 0
    })
  });
  const data = await res.json();
  if (data.errcode !== 0) throw new Error(data.errmsg || '发送文本卡片消息失败');
  return data.msgid || 'sent';
}

// 通过自建应用发送个人消息（模板卡片 - 按钮交互型，可直接在企业微信内点按钮确认/驳回）
// button_interaction 类型支持 button_list（按钮列表）或 button_selection（下拉选择器）
async function sendTemplateCardToUser(config, userid, { card_type, main_title, source,
  sub_title_text, emphasis_content, horizontal_content_list, button_list, button_selection, task_id, card_action, action_menu }) {
  const accessToken = await getAccessToken(config);
  const card = {
    card_type: card_type || 'button_interaction',
    main_title: main_title || { title: '', desc: '' },
  };
  if (source) card.source = source;
  if (sub_title_text) card.sub_title_text = sub_title_text;
  if (emphasis_content) card.emphasis_content = emphasis_content;
  if (horizontal_content_list && horizontal_content_list.length > 0) card.horizontal_content_list = horizontal_content_list;
  if (button_list && button_list.length > 0) card.button_list = button_list;
  if (button_selection) card.button_selection = button_selection;
  if (task_id) card.task_id = task_id;
  if (card_action) card.card_action = card_action;
  if (action_menu) card.action_menu = action_menu;

  const body = {
    touser: userid,
    msgtype: 'template_card',
    agentid: Number(config.agent_id),
    template_card: card,
    safe: 0,
  };

  console.log(`[模板卡片] 发送给 ${userid}，卡片类型: ${card.card_type}，body:`, JSON.stringify(body).substring(0, 500));

  const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${accessToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  console.log(`[模板卡片] API返回:`, JSON.stringify(data));

  if (data.errcode !== 0) {
    const errMsg = `errcode=${data.errcode}, errmsg=${data.errmsg || ''}${data.invaliduser ? ', invaliduser=' + data.invaliduser : ''}`;
    throw new Error(errMsg);
  }
  return data;
}

// 更新模板卡片按钮文案（按钮变灰不可点击）
async function updateTemplateCardButton(config, userid, responseCode, replaceName) {
  const accessToken = await getAccessToken(config);
  const body = {
    userids: [userid],
    agentid: Number(config.agent_id),
    response_code: responseCode,
    button: {
      replace_name: replaceName
    }
  };

  console.log(`[更新按钮文案] userid=${userid}, replaceName=${replaceName}`);

  const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/message/update_template_card?access_token=${accessToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  console.log(`[更新按钮文案] API返回:`, JSON.stringify(data));

  if (data.errcode !== 0) {
    throw new Error(`errcode=${data.errcode}, errmsg=${data.errmsg || ''}`);
  }
  return data;
}

// 更新模板卡片消息（用户点击按钮后更新卡片状态）
// 入参 identifier: response_code（从发送时返回的或回调中拿到的）
async function updateTemplateCard(config, userid, cardType, identifier, { main_title, sub_title_text,
  horizontal_content_list, button_list, button_selection, replace_original, use_response_code }) {
  const accessToken = await getAccessToken(config);
  const card = {
    card_type: cardType || 'text_notice',
  };
  if (main_title) card.main_title = main_title;
  if (sub_title_text) card.sub_title_text = sub_title_text;
  if (horizontal_content_list && horizontal_content_list.length > 0) card.horizontal_content_list = horizontal_content_list;
  if (button_list && button_list.length > 0) card.button_list = button_list;
  if (button_selection) card.button_selection = button_selection;

  const body = {
    userids: [userid],
    agentid: Number(config.agent_id),
    template_card: card,
  };

  // 默认使用 response_code（text_notice 类型必须用 response_code）
  if (use_response_code === false) {
    body.task_id = identifier;
    console.log(`[更新模板卡片] task_id=${identifier}, userid=${userid}`);
  } else {
    body.response_code = identifier;
    console.log(`[更新模板卡片] response_code=${identifier}, userid=${userid}`);
  }

  const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/message/update_template_card?access_token=${accessToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  console.log(`[更新模板卡片] API返回:`, JSON.stringify(data));

  if (data.errcode !== 0) {
    const errMsg = `errcode=${data.errcode}, errmsg=${data.errmsg || ''}`;
    throw new Error(errMsg);
  }
  return data;
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

async function sendMarkdownViaWebhook(webhookUrl, content, mentionedList = []) {
  const body = {
    msgtype: 'markdown',
    markdown: { content }
  };
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (data.errcode !== 0) throw new Error(data.errmsg || 'Webhook发送失败');
  return 'sent';
}

// 发送文本消息到群（支持真正的@提醒）
async function sendTextViaWebhook(webhookUrl, content, mentionedList = []) {
  const body = {
    msgtype: 'text',
    text: { content }
  };
  if (mentionedList && mentionedList.length > 0) {
    body.text.mentioned_list = mentionedList;
  }
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
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

async function submitApproval(config, applyData, templateIdOverride) {
  const accessToken = await getAccessToken(config);
  const url = `https://qyapi.weixin.qq.com/cgi-bin/oa/applyevent?access_token=${accessToken}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(applyData)
  });
  const data = await res.json();
  if (data.errcode !== 0) {
    // 打印完整错误详情便于排查
    const errDetail = data.errmsg_detail || '';
    console.error(`[企微审批提交失败] errcode=${data.errcode}, errmsg=${data.errmsg}, detail=${errDetail}`);
    console.error(`[企微审批提交失败] apply_data.contents:`, JSON.stringify(applyData.apply_data?.contents || []));
    const msg = errDetail ? `${data.errmsg} (${errDetail})` : data.errmsg;
    throw new Error(msg || '提交审批失败');
  }
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
      await pool.query('INSERT INTO wecom_config (id) VALUES (1)');
      return res.json({});
    }
    const config = rows[0];

    const [wxRows] = await pool.query('SELECT app_id, app_secret, status FROM wechat_config WHERE id = 1');
    const wxConfig = wxRows.length > 0 ? wxRows[0] : {};

    res.json({
      ...config,
      app_secret: config.app_secret ? '****' : '',
      query_app_secret: config.query_app_secret ? '****' : '',
      bank_account: config.bank_account ? '****' : '',
      callback_aes_key: config.callback_aes_key ? '****' : '',
      wx_app_id: wxConfig.app_id || '',
      wx_app_secret: wxConfig.app_secret ? '****' : '',
      wx_status: wxConfig.status,
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
    const allowedFields = ['app_secret', 'query_app_secret', 'bank_account', 'callback_aes_key', 'wx_app_secret'];

    if (!allowedFields.includes(field)) {
      return res.status(400).json({ error: '不允许的字段' });
    }

    if (field === 'wx_app_secret') {
      const [rows] = await pool.query(`SELECT app_secret as value FROM wechat_config WHERE id = 1`);
      if (rows.length === 0 || !rows[0].value) {
        return res.json({ value: '' });
      }
      return res.json({ value: rows[0].value });
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
      corp_id, app_secret, agent_id, chat_id, webhook_url, test_webhook_url,
      approval_template_id, applicant_userid,
      payment_options, default_payment_key,
      payee_name, bank_name, bank_account,
      payment_reason_template, approval_field_mapping,
      callback_token, callback_aes_key, app_domain,
      query_agent_id, query_app_secret,
      wx_app_id, wx_app_secret,
      warehouse_approval_template_id, warehouse_field_mapping, warehouse_dept_options,
      booking_webhook_url, booking_notify_submit, booking_notify_sales,
      booking_notify_approve, booking_notify_reject,
      booking_approver_userid, booking_approver_name
    } = req.body;

    await pool.query('INSERT IGNORE INTO wecom_config (id) VALUES (1)');

    const fields = [];
    const values = [];

    if (corp_id !== undefined) { fields.push('corp_id = ?'); values.push(corp_id || null); }
    if (app_secret !== undefined && app_secret !== '****') { fields.push('app_secret = ?'); values.push(app_secret || null); }
    if (agent_id !== undefined) { fields.push('agent_id = ?'); values.push(agent_id || null); }
    if (chat_id !== undefined) { fields.push('chat_id = ?'); values.push(chat_id || null); }
    if (webhook_url !== undefined) { fields.push('webhook_url = ?'); values.push(webhook_url || null); }
    if (test_webhook_url !== undefined) { fields.push('test_webhook_url = ?'); values.push(test_webhook_url || null); }
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
    if (query_agent_id !== undefined) { fields.push('query_agent_id = ?'); values.push(query_agent_id || null); }
    if (query_app_secret !== undefined && query_app_secret !== '****') { fields.push('query_app_secret = ?'); values.push(query_app_secret || null); }
    if (warehouse_approval_template_id !== undefined) { fields.push('warehouse_approval_template_id = ?'); values.push(warehouse_approval_template_id || null); }
    if (warehouse_field_mapping !== undefined) { fields.push('warehouse_field_mapping = ?'); values.push(warehouse_field_mapping ? JSON.stringify(warehouse_field_mapping) : null); }
    if (warehouse_dept_options !== undefined) { fields.push('warehouse_dept_options = ?'); values.push(warehouse_dept_options ? JSON.stringify(warehouse_dept_options) : null); }
    if (booking_webhook_url !== undefined) { fields.push('booking_webhook_url = ?'); values.push(booking_webhook_url || null); }
    if (booking_notify_submit !== undefined) { fields.push('booking_notify_submit = ?'); values.push(Number(booking_notify_submit) || 0); }
    if (booking_notify_sales !== undefined) { fields.push('booking_notify_sales = ?'); values.push(Number(booking_notify_sales) || 0); }
    if (booking_notify_approve !== undefined) { fields.push('booking_notify_approve = ?'); values.push(Number(booking_notify_approve) || 0); }
    if (booking_notify_reject !== undefined) { fields.push('booking_notify_reject = ?'); values.push(Number(booking_notify_reject) || 0); }
    if (booking_approver_userid !== undefined) { fields.push('booking_approver_userid = ?'); values.push(booking_approver_userid || null); }
    if (booking_approver_name !== undefined) { fields.push('booking_approver_name = ?'); values.push(booking_approver_name || null); }

    if (fields.length > 0) {
      values.push(1);
      await pool.query(`UPDATE wecom_config SET ${fields.join(', ')} WHERE id = ?`, values);
    }

    await pool.query('INSERT IGNORE INTO wechat_config (id) VALUES (1)');
    const wxFields = [];
    const wxValues = [];
    if (wx_app_id !== undefined) { wxFields.push('app_id = ?'); wxValues.push(wx_app_id || null); }
    if (wx_app_secret !== undefined && wx_app_secret !== '****') { wxFields.push('app_secret = ?'); wxValues.push(wx_app_secret || null); }
    if (wxFields.length > 0) {
      wxValues.push(1);
      await pool.query(`UPDATE wechat_config SET ${wxFields.join(', ')} WHERE id = ?`, wxValues);
    }

    const [rows] = await pool.query('SELECT * FROM wecom_config WHERE id = 1');
    const [wxRows] = await pool.query('SELECT app_id, app_secret, status FROM wechat_config WHERE id = 1');
    const config = rows[0];
    const wxConfig = wxRows.length > 0 ? wxRows[0] : {};
    res.json({
      ...config,
      app_secret: config.app_secret ? '****' : '',
      query_app_secret: config.query_app_secret ? '****' : '',
      bank_account: config.bank_account ? '****' : '',
      callback_aes_key: config.callback_aes_key ? '****' : '',
      wx_app_id: wxConfig.app_id || '',
      wx_app_secret: wxConfig.app_secret ? '****' : '',
      wx_status: wxConfig.status,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ================================================
// 预订通知调试接口（发送模板卡片到指定用户）
// ================================================
router.post('/test-booking-card', async (req, res) => {
  try {
    const config = await getWecomConfig();
    if (!config) return res.status(400).json({ error: 'wecom_config 未配置' });
    if (!config.corp_id || !config.app_secret || !config.agent_id) {
      return res.status(400).json({ error: `企微配置不完整: corp_id=${!!config.corp_id}, app_secret=${!!config.app_secret}, agent_id=${config.agent_id}` });
    }

    const { userid, content } = req.body || {};
    if (!userid) return res.status(400).json({ error: '请提供 userid' });

    console.log(`[test-booking-card] 开始: userid=${userid}, agent_id=${config.agent_id}, corp_id=${config.corp_id}`);

    // 验证用户是否存在于企微
    try {
      const token = await getAccessToken(config);
      const userRes = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/user/get?access_token=${token}&userid=${userid}`);
      const userData = await userRes.json();
      console.log(`[test-booking-card] 企微用户查询:`, JSON.stringify(userData));
      if (userData.errcode !== 0) {
        return res.status(400).json({ error: `企微用户不存在或不可见: ${userData.errmsg}` });
      }
    } catch (e) {
      console.warn(`[test-booking-card] 企微用户验证失败:`, e.message);
    }

    // 发送模板卡片
    const cardContent = content || {
      card_type: 'button_interaction',
      source: { desc: '预订管理系统' },
      main_title: { title: '📋 预订系统测试通知', desc: '这是一条测试消息' },
      sub_title_text: '如果您收到此消息，说明企微应用配置正确',
      horizontal_content_list: [
        { keyname: '测试项', value: '模板卡片' },
        { keyname: '时间', value: new Date().toLocaleString('zh-CN') },
      ],
      button_list: [{
        text: '预订系统',
        style: 1,
        type: 1,
        key: 'go_booking_test',
        url: (process.env.FRONTEND_URL || '') + '/booking-board',
      }],
      task_id: 'booking_test_card',
      card_action: { type: 1, url: (process.env.FRONTEND_URL || '') + '/booking-board' },
    };

    console.log(`[test-booking-card] 发送模板卡片:`, JSON.stringify(cardContent).substring(0, 500));
    const result = await sendTemplateCardToUser(config, userid, cardContent);
    console.log(`[test-booking-card] 发送结果:`, JSON.stringify(result));

    res.json({
      success: true,
      message: `模板卡片已发送到 ${userid}`,
      result,
      config: {
        corp_id: config.corp_id,
        agent_id: config.agent_id,
        app_secret: config.app_secret ? '已配置' : '未配置',
      },
    });
  } catch (err) {
    console.error(`[test-booking-card] 错误:`, err);
    res.status(500).json({ error: err.message, stack: err.stack?.substring(0, 300) });
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

// 发送消息到测试群（使用 test_webhook_url，与生产 webhook_url 完全隔离）
router.post('/test-group-send', async (req, res) => {
  try {
    const config = await getWecomConfig();
    const testWebhookUrl = config && config.test_webhook_url;
    if (!testWebhookUrl) {
      return res.status(400).json({ error: '请先保存测试群机器人 Webhook URL' });
    }

    // 支持自定义内容，未提供则发送默认测试消息
    let content = req.body && req.body.content;
    if (!content || !String(content).trim()) {
      content = '**【测试群消息】**\n\n这是一条来自食材采购管理系统的测试消息，发送到测试群。\n\n> 发送时间：' + new Date().toLocaleString('zh-CN');
    }

    // 支持指定消息类型：text 或 markdown（默认 markdown）
    const msgType = (req.body && req.body.msg_type) === 'text' ? 'text' : 'markdown';
    if (msgType === 'text') {
      await sendViaWebhook(testWebhookUrl, String(content).replace(/\*\*/g, '').replace(/^> /gm, ''));
    } else {
      await sendMarkdownViaWebhook(testWebhookUrl, String(content));
    }

    res.json({ success: true, message: '消息已发送到测试群，请检查企业微信测试群' });
  } catch (err) {
    console.error('发送测试群消息失败:', err);
    res.status(400).json({ error: err.message });
  }
});

// ================================================
// 测试消息相关接口（完全独立，不影响生产数据）
// ================================================

// 获取测试消息列表
router.get('/test-messages', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM wecom_test_messages ORDER BY created_at DESC LIMIT 20'
    );
    const result = rows.map(row => ({
      ...row,
      total_amount: parseFloat(row.total_amount || 0),
      departments: typeof row.departments === 'string' ? JSON.parse(row.departments || '[]') : row.departments || [],
      purchase_items: typeof row.purchase_items === 'string' ? JSON.parse(row.purchase_items || '[]') : row.purchase_items || [],
      user_confirmations: typeof row.user_confirmations === 'string' ? JSON.parse(row.user_confirmations || '{}') : row.user_confirmations || {},
      user_departments: typeof row.user_departments === 'string' ? JSON.parse(row.user_departments || '{}') : row.user_departments || {},
    }));
    res.json(result);
  } catch (err) {
    console.error('获取测试消息列表失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 获取单条测试消息详情
router.get('/test-messages/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT * FROM wecom_test_messages WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '测试消息不存在' });
    }
    const row = rows[0];
    res.json({
      ...row,
      total_amount: parseFloat(row.total_amount || 0),
      departments: typeof row.departments === 'string' ? JSON.parse(row.departments || '[]') : row.departments || [],
      purchase_items: typeof row.purchase_items === 'string' ? JSON.parse(row.purchase_items || '[]') : row.purchase_items || [],
      user_confirmations: typeof row.user_confirmations === 'string' ? JSON.parse(row.user_confirmations || '{}') : row.user_confirmations || {},
      user_departments: typeof row.user_departments === 'string' ? JSON.parse(row.user_departments || '{}') : row.user_departments || {},
    });
  } catch (err) {
    console.error('获取测试消息详情失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 根据指定日期的采购记录生成测试确认单并发送到测试群
router.post('/test-send-confirmation', async (req, res) => {
  try {
    const { test_date } = req.body;
    const config = await getWecomConfig();
    const testWebhookUrl = config && config.test_webhook_url;
    if (!testWebhookUrl) {
      return res.status(400).json({ error: '请先保存测试群机器人 Webhook URL' });
    }
    if (!test_date) {
      return res.status(400).json({ error: '请指定测试日期' });
    }

    // 读取指定日期的采购数据
    const [records] = await pool.query(
      'SELECT * FROM purchase_records WHERE date = ? ORDER BY department_name, ingredient_name',
      [test_date]
    );
    if (records.length === 0) {
      return res.status(400).json({ error: `日期 ${test_date} 没有采购数据` });
    }

    // 提取部门和明细
    const deptMap = {};
    const items = [];
    let totalAmount = 0;
    for (const r of records) {
      const deptName = r.department_name || '未分类';
      if (!deptMap[deptName]) {
        deptMap[deptName] = { id: r.department_id || deptName, name: deptName, confirmed: false };
      }
      const amount = parseFloat(r.amount || 0);
      totalAmount += amount;
      items.push({
        ingredient_id: r.ingredient_id,
        ingredient_name: r.ingredient_name,
        department_id: r.department_id,
        department_name: deptName,
        purchase_unit: r.purchase_unit,
        purchase_quantity: parseFloat(r.purchase_quantity),
        purchase_unit_price: parseFloat(r.purchase_unit_price),
        amount: amount,
      });
    }
    const departments = Object.values(deptMap);

    const id = uuidv4();
    const domain = (config && config.app_domain) ? config.app_domain : '';
    const confirmUrl = domain ? `${domain}/wecom-test-confirm/${id}` : `/wecom-test-confirm/${id}`;
    const rejectUrl = domain ? `${domain}/wecom-test-reject/${id}` : `/wecom-test-reject/${id}`;

    // 获取各部门确认人（用于群消息@）
    const [deptRows] = await pool.query('SELECT id, name, confirmer_userid FROM departments');
    const deptConfirmerMap = {};
    for (const d of deptRows) {
      if (d.confirmer_userid) {
        deptConfirmerMap[d.id] = d.confirmer_userid;
        deptConfirmerMap[d.name] = d.confirmer_userid;
      }
    }

    // 仅收集本次采购涉及部门的确认人
    const confirmerSet = new Set();
    for (const item of items) {
      const confirmer = deptConfirmerMap[item.department_id] || deptConfirmerMap[item.department_name];
      if (confirmer) confirmerSet.add(confirmer);
    }
    const mentionedUsers = Array.from(confirmerSet);

    // 构建 Markdown 消息
    const deptNames = departments.map(d => d.name).join('、');
    let mdContent = `**🧪【测试】食材采购确认通知**\n\n`;
    mdContent += `📅 **采购日期**：${test_date}\n`;
    mdContent += `🏢 **涉及部门**：${deptNames}\n`;
    mdContent += `💰 **总金额**：¥${totalAmount.toFixed(2)}\n\n`;

    if (mentionedUsers.length > 0) {
      mdContent += `📢 **请以下人员尽快审批**：`;
      for (const userid of mentionedUsers) {
        mdContent += ` @${userid}`;
      }
      mdContent += `\n\n`;
    }

    mdContent += `---\n\n`;

    const groupedItems = {};
    for (const item of items) {
      const dn = item.department_name || '未分类';
      if (!groupedItems[dn]) groupedItems[dn] = [];
      groupedItems[dn].push(item);
    }
    for (const [deptName, deptItems] of Object.entries(groupedItems)) {
      mdContent += `**【${deptName}】**\n`;
      const confirmer = deptConfirmerMap[deptName] || deptConfirmerMap[deptItems[0]?.department_id] || '';
      if (confirmer) mdContent += `> 确认人：${confirmer}\n`;
      for (const item of deptItems) {
        mdContent += `> ${item.ingredient_name}  ${item.purchase_unit_price.toFixed(2)}/${item.purchase_unit} ×${item.purchase_quantity}${item.purchase_unit} = ¥${item.amount.toFixed(2)}\n`;
      }
      const subtotal = deptItems.reduce((s, i) => s + i.amount, 0);
      mdContent += `> *小计：¥${subtotal.toFixed(2)}*\n\n`;
    }

    mdContent += `---\n\n`;
    mdContent += `💡 **温馨提示**：相关部门确认人请前往OA应用进行确认或驳回操作。`;

    // 发送到测试群（先发markdown消息，再发text消息实现真正的@提醒）- 暂时注释，避免测试时群消息过多
    // await sendMarkdownViaWebhook(testWebhookUrl, mdContent);

    // 发送@提醒（使用text类型才能实现真正的红色提醒）- 暂时注释
    // if (mentionedUsers.length > 0) {
    //   const atContent = `📢 请以下人员尽快审批：${mentionedUsers.map(uid => `<@${uid}>`).join(' ')}`;
    //   await sendTextViaWebhook(testWebhookUrl, atContent, mentionedUsers);
    // }

    // 发送个人消息到各部门确认人（只发送TA负责部门的内容）
    const sentToUsers = [];
    const failedUsers = [];
    const sentResponseCodes = []; // 保存每个用户发送后的 response_code
    // userDeptMap: 每个用户负责的部门和明细
    const userDeptMap = {};
    if (config && config.corp_id && config.app_secret && config.agent_id) {
      for (const item of items) {
        const deptId = item.department_id;
        const deptName = item.department_name;
        const confirmer = deptConfirmerMap[deptId] || deptConfirmerMap[deptName];
        if (confirmer) {
          if (!userDeptMap[confirmer]) userDeptMap[confirmer] = { items: [], depts: new Set() };
          userDeptMap[confirmer].items.push(item);
          userDeptMap[confirmer].depts.add(deptName);
        }
      }

      for (const [userid, data] of Object.entries(userDeptMap)) {
        try {
          const userDeptNames = Array.from(data.depts).join('、');
          const userTotal = data.items.reduce((s, i) => s + i.amount, 0);

          const userGrouped = {};
          for (const item of data.items) {
            const dn = item.department_name || '未分类';
            if (!userGrouped[dn]) userGrouped[dn] = [];
            userGrouped[dn].push(item);
          }

          let subTitle = `采购日期：${test_date}\n您负责的部门：${userDeptNames}`;

          const horizontalContentList = [];
          horizontalContentList.push({ keyname: '总金额', value: `¥${userTotal.toFixed(2)}` });
          horizontalContentList.push({ keyname: '部门数', value: `${data.depts.size}个` });
          horizontalContentList.push({ keyname: '食材项', value: `${data.items.length}项` });

          const userTaskId = `${id}_${userid}`;

          const sendResult = await sendTemplateCardToUser(config, userid, {
            card_type: 'button_interaction',
            source: {
              desc: '食材采购管理系统',
            },
            main_title: {
              title: '🧪 食材采购确认通知',
              desc: '请认真确认您负责部门的采购内容',
            },
            sub_title_text: subTitle,
            horizontal_content_list: horizontalContentList,
            button_list: [
              { 
                text: '去确认', 
                style: 1, 
                type: 1,
                key: `go_confirm_${userTaskId}`,
                url: `https://food.hywellness.com/wecom-confirm?id=${id}&user=${userid}`
              }
            ],
            task_id: userTaskId,
            card_action: {
              type: 1,
              url: `https://food.hywellness.com/wecom-confirm?id=${id}&user=${userid}`
            },
          });

          // 保存 response_code（用于后续更新卡片）
          sentResponseCodes.push({ userid, responseCode: sendResult.response_code });

          sentToUsers.push({ userid, departments: userDeptNames, total: userTotal });
        } catch (sendErr) {
          console.error(`发送个人模板卡片消息失败 ${userid}:`, sendErr.message);
          failedUsers.push({ userid, error: sendErr.message });
        }
      }
    }

    // 构造 user_departments 映射（用于后续确认页面判断该用户负责哪些部门，包含 response_code 用于更新卡片）
    const userDepartmentsMap = {};
    for (const [userid, data] of Object.entries(userDeptMap)) {
      const sentItem = sentResponseCodes.find(s => s.userid === userid);
      userDepartmentsMap[userid] = {
        departments: Array.from(data.depts),
        response_code: sentItem ? sentItem.responseCode : null,
      };
    }

    // 保存到测试表（同时保存 user_departments，便于确认页面根据 user 参数过滤）
    await pool.query(
      `INSERT INTO wecom_test_messages
       (id, test_date, total_amount, departments, purchase_items, message_content, status, wecom_sent, sent_at, user_departments)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', 1, NOW(), ?)`,
      [id, test_date, totalAmount, JSON.stringify(departments), JSON.stringify(items), mdContent, JSON.stringify(userDepartmentsMap)]
    );

    const msgParts = ['测试确认通知已发送到测试群'];
    if (sentToUsers.length > 0) {
      msgParts.push(`同时发送个人消息给 ${sentToUsers.length} 位确认人`);
    }
    if (failedUsers.length > 0) {
      msgParts.push(`${failedUsers.length} 位发送失败`);
    }

    res.json({
      success: true,
      message: msgParts.join('；'),
      id,
      test_date,
      total_amount: totalAmount,
      departments_count: departments.length,
      items_count: items.length,
      sent_to_users: sentToUsers,
      failed_users: failedUsers,
    });
  } catch (err) {
    console.error('发送测试确认通知失败:', err);
    res.status(400).json({ error: err.message });
  }
});

// 测试消息确认（公共接口，无需登录，模拟用户从企微点击确认）
router.post('/test-messages/:id/confirm', async (req, res) => {
  try {
    const { id } = req.params;
    const { confirmed_by } = req.body || {};
    const [rows] = await pool.query('SELECT * FROM wecom_test_messages WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '测试消息不存在' });
    }
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    await pool.query(
      'UPDATE wecom_test_messages SET status = ?, confirmed_by = ?, confirmed_at = ? WHERE id = ?',
      ['confirmed', confirmed_by || '测试用户', now, id]
    );
    res.json({ success: true, message: '已确认', status: 'confirmed', confirmed_at: now });
  } catch (err) {
    console.error('确认测试消息失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 测试消息驳回（公共接口，无需登录）
router.post('/test-messages/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const { rejected_by, reject_reason } = req.body || {};
    const [rows] = await pool.query('SELECT * FROM wecom_test_messages WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '测试消息不存在' });
    }
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    await pool.query(
      'UPDATE wecom_test_messages SET status = ?, rejected_by = ?, rejected_at = ?, reject_reason = ? WHERE id = ?',
      ['rejected', rejected_by || '测试用户', now, reject_reason || '', id]
    );
    res.json({ success: true, message: '已驳回', status: 'rejected', rejected_at: now });
  } catch (err) {
    console.error('驳回测试消息失败:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/test-messages/:id/generate-pdf', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`[PDF生成] 开始生成测试消息PDF，id=${id}`);

    const [rows] = await pool.query('SELECT * FROM wecom_test_messages WHERE id = ?', [id]);
    if (rows.length === 0) {
      console.error(`[PDF生成] 测试消息不存在，id=${id}`);
      return res.status(404).json({ error: '测试消息不存在' });
    }

    const row = rows[0];
    const departments = typeof row.departments === 'string' ? JSON.parse(row.departments) : row.departments;
    const purchaseItems = typeof row.purchase_items === 'string' ? JSON.parse(row.purchase_items) : row.purchase_items;
    const userConfirmations = typeof row.user_confirmations === 'string' ? JSON.parse(row.user_confirmations || '{}') : (row.user_confirmations || {});

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const pdfPath = path.join(PDF_DIR, `wecom_test_${id}.pdf`);
    const writeStream = fs.createWriteStream(pdfPath);
    doc.pipe(writeStream);

    const chineseFont = findChineseFont();
    const chineseBoldFont = findChineseBoldFont();
    const hasChineseFont = !!chineseFont;
    if (hasChineseFont) {
      doc.registerFont('Chinese-Regular', chineseFont);
      doc.registerFont('Chinese-Bold', chineseBoldFont || chineseFont);
    }

    doc.fontSize(18).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold').text('食材采购确认单', { align: 'center' });
    doc.moveDown(0.5);

    doc.fontSize(10).font(hasChineseFont ? 'Chinese-Regular' : 'Helvetica');
    let purchaseDateStr = '';
    if (row.test_date instanceof Date) {
      const d = row.test_date;
      purchaseDateStr = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
    } else if (typeof row.test_date === 'string') {
      purchaseDateStr = row.test_date.substring(0, 10);
    }
    const statusLabel = row.status === 'confirmed' ? '已确认' : row.status === 'completed' ? '已完成' : row.status;
    doc.text(`采购日期：${purchaseDateStr}    总金额：¥${toNum(row.total_amount).toFixed(2)}    状态：${statusLabel}`);
    doc.moveDown(0.5);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const tableX = doc.page.margins.left;
    const tableWidth = pageWidth;

    const groupedItems = {};
    for (const item of purchaseItems) {
      const deptName = item.department_name || '未分类';
      if (!groupedItems[deptName]) groupedItems[deptName] = [];
      groupedItems[deptName].push(item);
    }

    const headers = ['食材名称', '单价/单位', '数量', '单位', '金额'];
    const colWidths = [tableWidth * 0.32, tableWidth * 0.20, tableWidth * 0.12, tableWidth * 0.10, tableWidth * 0.26];
    const fixedRowHeight = 11;
    const signatureHeight = 28;

    function checkPageBreak(y, extraHeight = 0) {
      const pageBottom = doc.page.height - doc.page.margins.bottom;
      if (y + extraHeight > pageBottom) {
        doc.addPage();
        return doc.page.margins.top;
      }
      return y;
    }

    function drawTableRow(y, cells, isHeader = false) {
      const font = isHeader ? 'Chinese-Bold' : 'Chinese-Regular';
      const helveticaFont = isHeader ? 'Helvetica-Bold' : 'Helvetica';
      doc.font(hasChineseFont ? font : helveticaFont).fontSize(isHeader ? 7.5 : 7);
      const lineHeight = doc.currentLineHeight();
      let x = tableX;
      for (let i = 0; i < cells.length; i++) {
        const text = String(cells[i]);
        const align = i === 0 ? 'left' : (i === cells.length - 1 ? 'right' : 'center');
        const textY = y + (fixedRowHeight - lineHeight) / 2;
        doc.text(text, x + 2, textY, { width: colWidths[i] - 4, align });
        x += colWidths[i];
      }
      return fixedRowHeight;
    }

    function drawDepartmentSignature(y, deptName) {
      const sigTop = y;
      const sigWidth = tableWidth;

      doc.fontSize(7).font(hasChineseFont ? 'Chinese-Regular' : 'Helvetica');
      const deptConf = Object.entries(userConfirmations).find(([, conf]) =>
        conf && conf.confirmed && conf.departments && Array.isArray(conf.departments) && conf.departments.includes(deptName)
      );
      if (deptConf) {
        const infoText = `确认人：${deptConf[1].confirmed_by || '-'}    确认时间：${deptConf[1].confirmed_at || '-'}`;
        doc.text(infoText, tableX + 2, sigTop + 2, { width: sigWidth - 4, align: 'left' });

        if (deptConf[1].signature_data) {
          try {
            const base64Data = deptConf[1].signature_data.replace(/^data:image\/\w+;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');
            doc.image(buffer, tableX + 2, sigTop + 12, { width: sigWidth - 4, height: signatureHeight - 14, fit: [sigWidth - 4, signatureHeight - 14] });
          } catch (e) {
            console.error(`[PDF生成] 签名图片处理失败，dept=${deptName}:`, e.message);
          }
        }
      } else {
        doc.text('状态：待确认', tableX + 2, sigTop + 8);
      }

      return signatureHeight;
    }

    let currentY = doc.y;

    doc.fontSize(12).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold').text('采购明细', { underline: true });
    doc.moveDown(0.3);
    currentY = doc.y;

    currentY += drawTableRow(currentY, headers, true);
    doc.moveTo(tableX, currentY - 1).lineTo(tableX + tableWidth, currentY - 1).stroke();

    doc.font(hasChineseFont ? 'Chinese-Regular' : 'Helvetica');
    let grandTotal = 0;

    for (const [deptName, items] of Object.entries(groupedItems)) {
      const deptNeededHeight = fixedRowHeight + items.length * fixedRowHeight + 14 + signatureHeight + 15;
      currentY = checkPageBreak(currentY, deptNeededHeight);

      doc.fontSize(7.5).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold').text(`【${deptName}】`, tableX, currentY + 1);
      currentY += fixedRowHeight;

      doc.font(hasChineseFont ? 'Chinese-Regular' : 'Helvetica').fontSize(7);
      let subtotal = 0;
      for (const item of items) {
        const cells = [
          item.ingredient_name,
          `${toNum(item.purchase_unit_price).toFixed(2)}/${item.purchase_unit}`,
          String(item.purchase_quantity),
          item.purchase_unit,
          `¥${toNum(item.amount).toFixed(2)}`
        ];
        currentY += drawTableRow(currentY, cells);
        subtotal += toNum(item.amount);
      }
      grandTotal += subtotal;

      doc.fontSize(7.5).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold').text(`小计：¥${subtotal.toFixed(2)}`, tableX, currentY, { width: tableWidth, align: 'right' });
      currentY += 10;

      doc.moveTo(tableX, currentY).lineTo(tableX + tableWidth, currentY).stroke();

      currentY += drawDepartmentSignature(currentY, deptName);
      currentY += 15;
    }

    if (Object.keys(groupedItems).length === 0) {
      doc.fontSize(10).text('暂无采购明细', { align: 'center' });
    }

    doc.moveDown(0.5);
    doc.fontSize(11).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold').text(`合计金额：¥${grandTotal.toFixed(2)}`, { align: 'right' });

    doc.end();

    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    const pdfUrl = `/api/wecom/test-messages/${id}/pdf`;
    await pool.query('UPDATE wecom_test_messages SET pdf_url = ? WHERE id = ?', [pdfUrl, id]);

    console.log(`[PDF生成] 测试消息PDF生成成功，id=${id}`);
    res.json({ success: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('测试消息PDF生成失败:', err);
    res.status(500).json({ error: err.message || 'PDF生成失败' });
  }
});

router.get('/test-messages/:id/pdf', async (req, res) => {
  try {
    const { id } = req.params;
    const pdfPath = path.join(PDF_DIR, `wecom_test_${id}.pdf`);

    if (!fs.existsSync(pdfPath)) {
      return res.status(404).json({ error: 'PDF文件不存在' });
    }

    res.download(pdfPath, `采购确认单_${id}.pdf`);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '下载失败' });
  }
});

// ================================================
// 新流程：模板卡片「去确认」按钮跳转的确认页面接口
// 不同用户只看到/确认自己负责的部门，避免越权确认
// ================================================

// 工具：解析测试消息中的 JSON 字段
function parseJsonField(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (e) { return null; }
}

// 工具：格式化本地时间（避免 UTC 偏差）
function formatLocalNow() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

// GET /wecom/confirm-page?id=xxx&user=userid
// 返回该用户负责部门的数据（仅包含自己负责的明细），以及该用户当前的确认状态
// 支持测试消息表和正式确认单表
router.get('/confirm-page', async (req, res) => {
  try {
    const { id, user } = req.query;
    if (!id || !user) {
      return res.status(400).json({ error: '缺少参数 id 或 user' });
    }

    let row = null;
    let tableName = 'purchase_confirmations';

    // 生产环境优先查询 purchase_confirmations 表
    const [confRows] = await pool.query('SELECT * FROM purchase_confirmations WHERE id = ?', [id]);
    if (confRows.length > 0) {
      row = confRows[0];
      tableName = 'purchase_confirmations';
    } else {
      const [testRows] = await pool.query('SELECT * FROM wecom_test_messages WHERE id = ?', [id]);
      if (testRows.length > 0) {
        row = testRows[0];
        tableName = 'wecom_test_messages';
      }
    }

    if (!row) {
      return res.status(404).json({ error: '确认单不存在或已失效' });
    }

    const allItems = parseJsonField(row.purchase_items) || [];
    const userDepartments = parseJsonField(row.user_departments) || {};
    const userConfirmations = parseJsonField(row.user_confirmations) || {};

    const userDeptData = userDepartments[user];
    const myDeptNames = (userDeptData && Array.isArray(userDeptData.departments)) 
      ? userDeptData.departments 
      : (Array.isArray(userDeptData) ? userDeptData : []);
    const responseCode = (userDeptData && userDeptData.response_code) || null;
    if (myDeptNames.length === 0) {
      return res.status(403).json({ error: '您不是本确认单的指定确认人' });
    }

    const myItems = allItems.filter(item => myDeptNames.includes(item.department_name));
    const myConfirmation = userConfirmations[user] || null;
    const userName = await getWecomUserName(user);

    const allConfirmations = await Promise.all(
      Object.entries(userConfirmations).map(async ([userid, info]) => ({
        userid,
        name: await getWecomUserName(userid),
        confirmed: !!(info && info.confirmed),
        confirmed_at: info && info.confirmed_at,
      }))
    );

    const myTotal = myItems.reduce((s, i) => s + parseFloat(i.amount || 0), 0);

    res.json({
      id: row.id,
      test_date: row.test_date,
      purchase_date: row.purchase_date,
      user,
      user_name: userName,
      my_departments: myDeptNames,
      my_items: myItems,
      my_total: myTotal,
      my_confirmation: myConfirmation,
      all_confirmations: allConfirmations,
      total_users: Object.keys(userDepartments).length,
      confirmed_users: allConfirmations.filter(c => c.confirmed).length,
      created_at: row.created_at,
    });
  } catch (err) {
    console.error('获取确认页面数据失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /wecom/confirm-submit
// body: { id, user, signature_data, name }
// 提交后：更新 user_confirmations + 同时更新卡片按钮文案
// 支持测试消息表和正式确认单表
router.post('/confirm-submit', async (req, res) => {
  try {
    const { id, user, signature_data, name } = req.body || {};
    if (!id || !user) {
      return res.status(400).json({ error: '缺少参数 id 或 user' });
    }
    if (!signature_data) {
      return res.status(400).json({ error: '请先手写签名后再确认' });
    }

    let row = null;
    let tableName = 'purchase_confirmations';

    // 生产环境优先查询 purchase_confirmations 表
    const [confRows] = await pool.query('SELECT * FROM purchase_confirmations WHERE id = ?', [id]);
    if (confRows.length > 0) {
      row = confRows[0];
      tableName = 'purchase_confirmations';
    } else {
      const [testRows] = await pool.query('SELECT * FROM wecom_test_messages WHERE id = ?', [id]);
      if (testRows.length > 0) {
        row = testRows[0];
        tableName = 'wecom_test_messages';
      }
    }

    if (!row) {
      return res.status(404).json({ error: '确认单不存在或已失效' });
    }

    const userDepartments = parseJsonField(row.user_departments) || {};
    const userConfirmations = parseJsonField(row.user_confirmations) || {};
    const allItems = parseJsonField(row.purchase_items) || [];

    const userDeptData = userDepartments[user];
    const myDeptNames = (userDeptData && Array.isArray(userDeptData.departments)) 
      ? userDeptData.departments 
      : (Array.isArray(userDeptData) ? userDeptData : []);
    const responseCode = (userDeptData && userDeptData.response_code) || null;
    
    const myItems = allItems.filter(item => myDeptNames.includes(item.department_name));
    const myTotal = myItems.reduce((s, i) => s + parseFloat(i.amount || 0), 0);
    if (myDeptNames.length === 0) {
      return res.status(403).json({ error: '您不是本确认单的指定确认人' });
    }

    if (userConfirmations[user] && userConfirmations[user].confirmed) {
      return res.status(400).json({ error: '您已确认过，无需重复确认' });
    }

    const realName = await getWecomUserName(user);
    console.log(`[确认提交] 用户姓名：${user} → ${realName}`);

    const now = formatLocalNow();
    userConfirmations[user] = {
      confirmed: true,
      confirmed_at: now,
      confirmed_by: realName,
      departments: myDeptNames,
      signature_data,
    };

    await pool.query(
      `UPDATE ${tableName} SET user_confirmations = ? WHERE id = ?`,
      [JSON.stringify(userConfirmations), id]
    );

    try {
      const [sigRows] = await pool.query(
        'SELECT id FROM user_signatures WHERE user_id = ? AND user_source = ?',
        [user, 'wecom']
      );
      if (sigRows.length > 0) {
        await pool.query(
          'UPDATE user_signatures SET signature_data = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND user_source = ?',
          [signature_data, user, 'wecom']
        );
      } else {
        await pool.query(
          'INSERT INTO user_signatures (id, user_id, user_source, signature_data) VALUES (?, ?, ?, ?)',
          [uuidv4(), user, 'wecom', signature_data]
        );
      }
    } catch (sigErr) {
      console.error('保存用户签名失败（不影响主流程）:', sigErr.message);
    }

    let cardUpdated = false;
    let cardError = '';
    try {
      const config = await getWecomConfig();
      if (config && config.corp_id && config.app_secret && config.agent_id) {
        if (!responseCode) {
          cardError = '该用户没有 response_code（卡片可能已更新或发送时未返回），跳过更新';
          console.warn(`[确认提交] ${cardError}，user=${user}`);
        } else {
          try {
            await updateTemplateCardButton(config, user, responseCode, `已确认 (${now})`);
            cardUpdated = true;
            console.log(`[确认提交] 按钮更新为不可点击成功，user=${user}`);
          } catch (updateErr) {
            console.error('更新模板卡片失败:', updateErr.message);
            cardError = updateErr.message;
          }
        }
      }
    } catch (cfgErr) {
      console.error('读取企微配置失败:', cfgErr.message);
      cardError = cfgErr.message;
    }

    const totalUsers = Object.keys(userDepartments).length;
    const confirmedUsers = Object.values(userConfirmations).filter(c => c && c.confirmed).length;
    const allConfirmed = confirmedUsers === totalUsers;
    console.log(`[确认提交] 确认进度统计，id=${id}, totalUsers=${totalUsers}, confirmedUsers=${confirmedUsers}, allConfirmed=${allConfirmed}`);

    let generatedPdfUrl = null;
    let pdfError = null;

    if (allConfirmed) {
      await pool.query(
        `UPDATE ${tableName} SET status = 'confirmed', confirmed_by = ?, confirmed_at = ? WHERE id = ?`,
        [realName, now, id]
      );
      console.log(`[确认提交] 全部确认，已将 ${tableName} 状态更新为 confirmed，id=${id}`);

      if (tableName === 'purchase_confirmations') {
        try {
          console.log(`[确认提交] 开始自动生成PDF，id=${id}`);
          const pdfPath = await generatePDF(id);
          generatedPdfUrl = `/api/purchase-confirmations/${id}/pdf`;
          await pool.query('UPDATE purchase_confirmations SET pdf_url = ? WHERE id = ?', [generatedPdfUrl, id]);
          console.log(`[确认提交] PDF自动生成成功，id=${id}, path=${pdfPath}, url=${generatedPdfUrl}`);
        } catch (pdfErr) {
          pdfError = pdfErr && pdfErr.message ? pdfErr.message : String(pdfErr);
          console.error(`[确认提交] PDF自动生成失败，id=${id}:`, pdfError);
        }

        // 根据采购类型决定后续流程
        const purchaseType = row.purchase_type || 'normal';
        console.log(`[确认提交] 采购类型=${purchaseType}，id=${id}`);

        if (purchaseType === 'prepay') {
          // 预付款采购：收货确认后自动核销
          try {
            const prepayAmount = toNum(row.prepay_amount);
            const actualAmount = toNum(row.total_amount);
            const difference = actualAmount - prepayAmount;

            if (Math.abs(difference) < 0.01) {
              await pool.query('UPDATE purchase_confirmations SET writeoff_status = ? WHERE id = ?', ['auto', id]);
              console.log(`[确认提交] 预付核销：金额一致，自动核销完成，id=${id}`);
            } else if (difference < 0) {
              // 多付，记入供应商预付余额
              const refundAmount = Math.abs(difference);
              if (row.supplier_id) {
                await pool.query('UPDATE suppliers SET prepay_balance = prepay_balance + ? WHERE id = ?', [refundAmount, row.supplier_id]);
                await pool.query(
                  `INSERT INTO prepay_records (id, supplier_id, purchase_id, amount, type, remark) VALUES (?, ?, ?, ?, 'refund', '预付款多付，记入供应商余额')`,
                  [uuidv4(), row.supplier_id, id, refundAmount]
                );
              }
              await pool.query('UPDATE purchase_confirmations SET writeoff_status = ? WHERE id = ?', ['manual', id]);
              console.log(`[确认提交] 预付核销：多付¥${refundAmount.toFixed(2)}，已记入供应商余额，id=${id}`);
            } else {
              // 少付，需发起尾款报销
              await pool.query('UPDATE purchase_confirmations SET writeoff_status = ? WHERE id = ?', ['manual', id]);
              console.log(`[确认提交] 预付核销：少付¥${difference.toFixed(2)}，需发起尾款报销，id=${id}`);
            }
          } catch (writeoffErr) {
            console.error(`[确认提交] 预付核销失败，id=${id}:`, writeoffErr.message);
          }
        } else if (purchaseType === 'monthly') {
          // 月结采购：确认后不发起报销，标记为已入账月结
          console.log(`[确认提交] 月结采购，不发起报销，标记为已入账，id=${id}`);
        } else {
          // 现购：原有流程，自动发起报销
        const config = await getWecomConfig();
        if (config && config.corp_id && config.app_secret && config.approval_template_id && config.applicant_userid) {
          try {
            const purchaseItems = typeof row.purchase_items === 'string' ? JSON.parse(row.purchase_items) : row.purchase_items;
            const reasonTemplate = config.payment_reason_template || '{date}食材采购费用';
            let displayDate = '';
            if (row.purchase_date instanceof Date) {
              const d = row.purchase_date;
              displayDate = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
            } else if (typeof row.purchase_date === 'string') {
              displayDate = row.purchase_date.substring(0, 10);
            } else {
              displayDate = String(row.purchase_date).substring(0, 10);
            }
            const reason = reasonTemplate.replace('{date}', displayDate);

            let fieldMapping = {};
            if (config.approval_field_mapping) {
              if (typeof config.approval_field_mapping === 'string') {
                try { fieldMapping = JSON.parse(config.approval_field_mapping); } catch (e) { fieldMapping = {}; }
              } else if (typeof config.approval_field_mapping === 'object') {
                fieldMapping = config.approval_field_mapping;
              }
            }

            const tokenRes = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${config.corp_id}&corpsecret=${config.app_secret}`);
            const tokenData = await tokenRes.json();
            let controlTypeMap = {};
            if (tokenData.access_token) {
              const tplRes = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/oa/gettemplatedetail?access_token=${tokenData.access_token}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ template_id: config.approval_template_id })
              });
              const tplData = await tplRes.json();
              if (tplData.errcode === 0 && tplData.template_content && tplData.template_content.controls) {
                for (const ctrl of tplData.template_content.controls) {
                  if (ctrl.property && ctrl.property.id && ctrl.property.control) {
                    controlTypeMap[ctrl.property.id] = ctrl.property.control;
                  }
                }
              }
            }

            function getControlType(fieldKey, fallback) {
              const mappedId = fieldMapping[fieldKey];
              return mappedId ? (controlTypeMap[mappedId] || fallback) : fallback;
            }

            const departments = typeof row.departments === 'string' ? JSON.parse(row.departments) : row.departments;
            const contents = [];
            let paymentLabel = '转账';
            if (fieldMapping.date) {
              let purchaseDate;
              if (row.purchase_date instanceof Date) {
                purchaseDate = row.purchase_date;
              } else if (typeof row.purchase_date === 'string') {
                const parts = row.purchase_date.substring(0, 10).split('-');
                purchaseDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
              } else {
                purchaseDate = new Date(row.purchase_date);
              }
              purchaseDate.setHours(0, 0, 0, 0);
              const sTimestamp = Math.floor(purchaseDate.getTime() / 1000);
              contents.push({ control: getControlType('date', 'Date'), id: fieldMapping.date, value: { date: { type: 'day', s_timestamp: String(sTimestamp) } } });
            }
            if (fieldMapping.amount) {
              const amountVal = toNum(row.total_amount);
              contents.push({ control: getControlType('amount', 'Money'), id: fieldMapping.amount, value: { new_money: amountVal.toFixed(2) } });
            }
            if (fieldMapping.reason) {
              contents.push({ control: getControlType('reason', 'Text'), id: fieldMapping.reason, value: { text: String(reason) } });
            }
            if (fieldMapping.department) {
              const deptNames = departments.map(d => String(d.name)).join('、');
              contents.push({ control: getControlType('department', 'Text'), id: fieldMapping.department, value: { text: deptNames } });
            }
            if (fieldMapping.payee_name && config.payee_name) {
              contents.push({ control: getControlType('payee_name', 'Text'), id: fieldMapping.payee_name, value: { text: String(config.payee_name) } });
            }
            if (fieldMapping.bank_name && config.bank_name) {
              contents.push({ control: getControlType('bank_name', 'Text'), id: fieldMapping.bank_name, value: { text: String(config.bank_name) } });
            }
            if (fieldMapping.bank_account && config.bank_account) {
              contents.push({ control: getControlType('bank_account', 'Text'), id: fieldMapping.bank_account, value: { text: String(config.bank_account) } });
            }
            if (fieldMapping.payment_method && config.default_payment_key) {
              let paymentOptions = {};
              if (config.payment_options) {
                if (typeof config.payment_options === 'string') {
                  try { paymentOptions = JSON.parse(config.payment_options); } catch (e) { paymentOptions = {}; }
                } else if (typeof config.payment_options === 'object') {
                  paymentOptions = config.payment_options;
                }
              }
              paymentLabel = String(paymentOptions[config.default_payment_key] || '转账');
              contents.push({ control: getControlType('payment_method', 'Selector'), id: fieldMapping.payment_method, value: { selector: { type: 'single', options: [{ key: String(config.default_payment_key), value: [{ text: paymentLabel, lang: 'zh_CN' }] }] } } });
            }
            if (fieldMapping.details) {
              let detailText = '';
              const grouped = {};
              for (const item of purchaseItems) {
                const dn = item.department_name || '未分类';
                if (!grouped[dn]) grouped[dn] = [];
                grouped[dn].push(item);
              }
              for (const [dn, items] of Object.entries(grouped)) {
                detailText += `【${dn}】\n`;
                for (const item of items) {
                  const price = toNum(item.purchase_unit_price);
                  const qty = toNum(item.purchase_quantity);
                  const amt = toNum(item.amount);
                  detailText += `${item.ingredient_name} ${price}/${item.purchase_unit} ×${qty} = ¥${amt.toFixed(2)}\n`;
                }
              }
              contents.push({ control: getControlType('details', 'Textarea'), id: fieldMapping.details, value: { text: detailText } });
            }

            try {
              const pdfPath = path.join(PDF_DIR, `${id}.pdf`);
              const fileControlId = fieldMapping.attachment || Object.entries(controlTypeMap).find(([cid, ctype]) => ctype === 'File')?.[0];
              if (fileControlId && fs.existsSync(pdfPath)) {
                const mediaId = await uploadMedia(config, pdfPath, `采购确认单_${id}.pdf`);
                contents.push({
                  control: controlTypeMap[fileControlId] || 'File',
                  id: fileControlId,
                  value: {
                    files: [{
                      file_id: mediaId,
                      filename: `采购确认单_${id}.pdf`
                    }]
                  }
                });
              }
            } catch (uploadErr) {
              console.error('上传PDF附件失败:', uploadErr);
            }

            const applyData = {
              creator_userid: config.applicant_userid,
              template_id: config.approval_template_id,
              use_template_approver: 1,
              apply_data: { contents },
              summary_list: [
                { summary_info: [{ text: `付款事由：${reason}`, lang: 'zh_CN' }] },
                { summary_info: [{ text: `付款金额：¥${Number(row.total_amount).toFixed(2)}`, lang: 'zh_CN' }] },
                { summary_info: [{ text: `付款方式：${paymentLabel || '转账'}`, lang: 'zh_CN' }] }
              ]
            };

            console.log(`[确认提交] 开始发起报销审批，id=${id}`);
            const spNo = await submitApproval(config, applyData);
            await pool.query(
              'UPDATE purchase_confirmations SET reimbursement_status = ?, reimbursement_sp_no = ?, status = ?, reimbursement_error = NULL WHERE id = ?',
              ['pending', spNo, 'reimbursing', id]
            );
            console.log(`[确认提交] 报销审批已发起，sp_no=${spNo}`);
          } catch (approvalErr) {
            const errMsg = approvalErr && approvalErr.message ? approvalErr.message : String(approvalErr);
            console.error('[确认提交] 自动发起报销失败:', errMsg);
            try {
              await pool.query(
                'UPDATE purchase_confirmations SET reimbursement_status = ?, status = ?, reimbursement_error = ? WHERE id = ?',
                ['pending', 'confirmed', errMsg, id]
              );
            } catch (saveErr) {
              console.error('[确认提交] 保存报销错误信息失败:', saveErr.message);
            }
          }
        }
        } // end else (现购)
      } else {
        try {
          console.log(`[确认提交] 所有用户已确认，开始自动生成PDF，id=${id}`);
          
          const pdfPath = path.join(PDF_DIR, `wecom_test_${id}.pdf`);
          const purchaseItems = typeof row.purchase_items === 'string' ? JSON.parse(row.purchase_items) : row.purchase_items;
          const departments = typeof row.departments === 'string' ? JSON.parse(row.departments) : row.departments;
          
          const doc = new PDFDocument({ size: 'A4', margin: 40 });
          const writeStream = fs.createWriteStream(pdfPath);
          doc.pipe(writeStream);

          const chineseFont = findChineseFont();
          const chineseBoldFont = findChineseBoldFont();
          const hasChineseFont = !!chineseFont;
          if (hasChineseFont) {
            doc.registerFont('Chinese-Regular', chineseFont);
            doc.registerFont('Chinese-Bold', chineseBoldFont || chineseFont);
          }

          doc.fontSize(18).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold').text('食材采购确认单', { align: 'center' });
          doc.moveDown(0.5);

          doc.fontSize(10).font(hasChineseFont ? 'Chinese-Regular' : 'Helvetica');
          let purchaseDateStr = '';
          if (row.test_date instanceof Date) {
            const d = row.test_date;
            purchaseDateStr = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
          } else if (typeof row.test_date === 'string') {
            purchaseDateStr = row.test_date.substring(0, 10);
          }
          const statusLabel = '已确认';
          doc.text(`采购日期：${purchaseDateStr}    总金额：¥${toNum(row.total_amount).toFixed(2)}    状态：${statusLabel}`);
          doc.moveDown(0.5);

          const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
          const tableX = doc.page.margins.left;
          const tableWidth = pageWidth;

          const groupedItems = {};
          for (const item of purchaseItems) {
            const deptName = item.department_name || '未分类';
            if (!groupedItems[deptName]) groupedItems[deptName] = [];
            groupedItems[deptName].push(item);
          }

          const headers = ['食材名称', '单价/单位', '数量', '单位', '金额'];
          const colWidths = [tableWidth * 0.32, tableWidth * 0.20, tableWidth * 0.12, tableWidth * 0.10, tableWidth * 0.26];
          const fixedRowHeight = 11;
          const signatureHeight = 28;

          function checkPageBreak(y, extraHeight = 0) {
            const pageBottom = doc.page.height - doc.page.margins.bottom;
            if (y + extraHeight > pageBottom) {
              doc.addPage();
              return doc.page.margins.top;
            }
            return y;
          }

          function drawTableRow(y, cells, isHeader = false) {
            const font = isHeader ? 'Chinese-Bold' : 'Chinese-Regular';
            const helveticaFont = isHeader ? 'Helvetica-Bold' : 'Helvetica';
            doc.font(hasChineseFont ? font : helveticaFont).fontSize(isHeader ? 7.5 : 7);
            const lineHeight = doc.currentLineHeight();
            let x = tableX;
            for (let i = 0; i < cells.length; i++) {
              const text = String(cells[i]);
              const align = i === 0 ? 'left' : (i === cells.length - 1 ? 'right' : 'center');
              const textY = y + (fixedRowHeight - lineHeight) / 2;
              doc.text(text, x + 2, textY, { width: colWidths[i] - 4, align });
              x += colWidths[i];
            }
            return fixedRowHeight;
          }

          function drawDepartmentSignature(y, deptName) {
            const sigTop = y;
            const sigWidth = tableWidth;

            doc.fontSize(7).font(hasChineseFont ? 'Chinese-Regular' : 'Helvetica');
            const deptConf = Object.entries(userConfirmations).find(([, conf]) =>
              conf && conf.confirmed && conf.departments && Array.isArray(conf.departments) && conf.departments.includes(deptName)
            );
            if (deptConf) {
              const infoText = `确认人：${deptConf[1].confirmed_by || '-'}    确认时间：${deptConf[1].confirmed_at || '-'}`;
              doc.text(infoText, tableX + 2, sigTop + 2, { width: sigWidth - 4, align: 'left' });

              if (deptConf[1].signature_data) {
                try {
                  const base64Data = deptConf[1].signature_data.replace(/^data:image\/\w+;base64,/, '');
                  const buffer = Buffer.from(base64Data, 'base64');
                  doc.image(buffer, tableX + 2, sigTop + 12, { width: sigWidth - 4, height: signatureHeight - 14, fit: [sigWidth - 4, signatureHeight - 14] });
                } catch (e) {
                  console.error(`[PDF生成] 签名图片处理失败，dept=${deptName}:`, e.message);
                }
              }
            } else {
              doc.text('状态：待确认', tableX + 2, sigTop + 8);
            }

            return signatureHeight;
          }

          let currentY = doc.y;

          doc.fontSize(12).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold').text('采购明细', { underline: true });
          doc.moveDown(0.3);
          currentY = doc.y;

          currentY += drawTableRow(currentY, headers, true);
          doc.moveTo(tableX, currentY - 1).lineTo(tableX + tableWidth, currentY - 1).stroke();

          doc.font(hasChineseFont ? 'Chinese-Regular' : 'Helvetica');
          let grandTotal = 0;

          for (const [deptName, items] of Object.entries(groupedItems)) {
            const deptNeededHeight = fixedRowHeight + items.length * fixedRowHeight + 14 + signatureHeight + 15;
            currentY = checkPageBreak(currentY, deptNeededHeight);

            doc.fontSize(7.5).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold').text(`【${deptName}】`, tableX, currentY + 1);
            currentY += fixedRowHeight;

            doc.font(hasChineseFont ? 'Chinese-Regular' : 'Helvetica').fontSize(7);
            let subtotal = 0;
            for (const item of items) {
              const cells = [
                item.ingredient_name,
                `${toNum(item.purchase_unit_price).toFixed(2)}/${item.purchase_unit}`,
                String(item.purchase_quantity),
                item.purchase_unit,
                `¥${toNum(item.amount).toFixed(2)}`
              ];
              currentY += drawTableRow(currentY, cells);
              subtotal += toNum(item.amount);
            }
            grandTotal += subtotal;

            doc.fontSize(7.5).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold').text(`小计：¥${subtotal.toFixed(2)}`, tableX, currentY, { width: tableWidth, align: 'right' });
            currentY += 10;

            doc.moveTo(tableX, currentY).lineTo(tableX + tableWidth, currentY).stroke();

            currentY += drawDepartmentSignature(currentY, deptName);
            currentY += 15;
          }

          if (Object.keys(groupedItems).length === 0) {
            doc.fontSize(10).text('暂无采购明细', { align: 'center' });
          }

          doc.moveDown(0.5);
          doc.fontSize(11).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold').text(`合计金额：¥${grandTotal.toFixed(2)}`, { align: 'right' });

          doc.end();

          await new Promise((resolve, reject) => {
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
          });

          generatedPdfUrl = `/api/wecom/test-messages/${id}/pdf`;
          await pool.query('UPDATE wecom_test_messages SET pdf_url = ? WHERE id = ?', [generatedPdfUrl, id]);
          console.log(`[确认提交] PDF自动生成成功，id=${id}, url=${generatedPdfUrl}`);
        } catch (pdfErr) {
          pdfError = pdfErr && pdfErr.message ? pdfErr.message : String(pdfErr);
          console.error(`[确认提交] PDF自动生成失败，id=${id}:`, pdfError);
        }
      }
    }

    res.json({
      success: true,
      message: '确认成功',
      confirmed_at: now,
      confirmed_departments: myDeptNames,
      progress: {
        confirmed_users: confirmedUsers,
        total_users: totalUsers,
        all_confirmed: allConfirmed,
      },
      card_updated: cardUpdated,
      card_error: cardError,
      pdf_url: generatedPdfUrl,
      pdf_error: pdfError,
    });
  } catch (err) {
    console.error('提交确认失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 测试：通过自建应用发送个人消息（支持 text/markdown/textcard 三种类型）
router.post('/test-send-to-user', async (req, res) => {
  try {
    const { userid, msg_type, content, title, description, url, btntxt } = req.body;
    const config = await getWecomConfig();

    if (!config || !config.corp_id || !config.app_secret || !config.agent_id) {
      return res.status(400).json({ error: '请先在企业微信管理页面完成应用配置（CorpID + Secret + AgentID）' });
    }
    if (!userid) {
      return res.status(400).json({ error: '请填写接收人企业微信 UserID' });
    }
    if (!msg_type || !['text', 'markdown', 'textcard'].includes(msg_type)) {
      return res.status(400).json({ error: '消息类型必须是 text、markdown 或 textcard' });
    }

    let msgid;
    if (msg_type === 'text') {
      msgid = await sendTextToUser(config, userid, content || '【测试消息】来自食材采购管理系统的个人消息');
    } else if (msg_type === 'markdown') {
      msgid = await sendMarkdownToUser(config, userid, content || '**【测试消息】**\n\n这是一条来自食材采购管理系统的Markdown个人消息。');
    } else {
      msgid = await sendTextCardToUser(config, userid, {
        title: title || '测试通知',
        description: description || '这是一条文本卡片测试消息',
        url: url || '',
        btntxt: btntxt || '点击查看'
      });
    }

    res.json({ success: true, message: '个人消息已发送，请在企业微信中查看', msgid });
  } catch (err) {
    console.error('发送个人测试消息失败:', err);
    res.status(400).json({ error: err.message });
  }
});

// 测试：通过自建应用发送采购确认通知到个人（只发送该人所属部门的内容）
router.post('/test-send-confirmation-to-user', async (req, res) => {
  try {
    const { test_date, userid, department_name } = req.body;
    const config = await getWecomConfig();

    if (!config || !config.corp_id || !config.app_secret || !config.agent_id) {
      return res.status(400).json({ error: '请先完成企业微信应用配置' });
    }
    if (!userid) {
      return res.status(400).json({ error: '请填写接收人 UserID' });
    }
    if (!test_date) {
      return res.status(400).json({ error: '请指定测试日期' });
    }

    // 读取采购数据
    const [records] = await pool.query(
      'SELECT * FROM purchase_records WHERE date = ? ORDER BY department_name, ingredient_name',
      [test_date]
    );
    if (records.length === 0) {
      return res.status(400).json({ error: `日期 ${test_date} 没有采购数据` });
    }

    // 如果指定了部门，只保留该部门的明细
    let filtered = records;
    if (department_name) {
      filtered = records.filter(r => r.department_name === department_name);
      if (filtered.length === 0) {
        return res.status(400).json({ error: `部门「${department_name}」在该日期没有采购数据` });
      }
    }

    const deptMap = {};
    const items = [];
    let totalAmount = 0;
    for (const r of filtered) {
      const dn = r.department_name || '未分类';
      if (!deptMap[dn]) deptMap[dn] = { id: r.department_id || dn, name: dn };
      const amount = parseFloat(r.amount || 0);
      totalAmount += amount;
      items.push({
        ingredient_name: r.ingredient_name,
        department_name: dn,
        purchase_unit: r.purchase_unit,
        purchase_quantity: parseFloat(r.purchase_quantity),
        purchase_unit_price: parseFloat(r.purchase_unit_price),
        amount,
      });
    }

    const id = uuidv4();
    const domain = config.app_domain ? config.app_domain : '';
    const confirmUrl = domain ? `${domain}/wecom-test-confirm/${id}` : `/wecom-test-confirm/${id}`;
    const rejectUrl = domain ? `${domain}/wecom-test-reject/${id}` : `/wecom-test-reject/${id}`;

    // 构建 Markdown 消息（仅包含该用户相关部门的内容）
    const deptNames = Object.keys(deptMap).join('、');
    let mdContent = `**🧪【测试】食材采购确认通知**\n\n`;
    mdContent += `📅 **采购日期**：${test_date}\n`;
    mdContent += `🏢 **涉及部门**：${deptNames}\n`;
    mdContent += `💰 **总金额**：¥${totalAmount.toFixed(2)}\n\n`;
    mdContent += `---\n\n`;

    const grouped = {};
    for (const item of items) {
      if (!grouped[item.department_name]) grouped[item.department_name] = [];
      grouped[item.department_name].push(item);
    }
    for (const [deptName, deptItems] of Object.entries(grouped)) {
      mdContent += `**【${deptName}】**\n`;
      for (const item of deptItems) {
        mdContent += `> ${item.ingredient_name}  ${item.purchase_unit_price.toFixed(2)}/${item.purchase_unit} ×${item.purchase_quantity}${item.purchase_unit} = ¥${item.amount.toFixed(2)}\n`;
      }
      const subtotal = deptItems.reduce((s, i) => s + i.amount, 0);
      mdContent += `> *小计：¥${subtotal.toFixed(2)}*\n\n`;
    }

    mdContent += `---\n\n`;
    mdContent += `✅ **[点击确认](${confirmUrl})**　　❌ **[点击驳回](${rejectUrl})**\n`;
    mdContent += `> 此为测试消息，请确认或驳回。`;

    // 发送到个人
    const msgid = await sendMarkdownToUser(config, userid, mdContent);

    // 保存到测试表
    const departments = Object.values(deptMap).map(d => ({ ...d, confirmed: false }));
    await pool.query(
      `INSERT INTO wecom_test_messages 
       (id, test_date, total_amount, departments, purchase_items, message_content, status, wecom_sent, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', 1, NOW())`,
      [id, test_date, totalAmount, JSON.stringify(departments), JSON.stringify(items), mdContent]
    );

    res.json({
      success: true,
      message: `已发送到 ${userid}，请在企业微信中查看`,
      id,
      msgid,
      test_date,
      total_amount: totalAmount,
      departments_count: departments.length,
      items_count: items.length,
    });
  } catch (err) {
    console.error('发送个人确认通知失败:', err);
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

// 测试模板卡片回调（手动触发，方便调试）
router.post('/test-callback', async (req, res) => {
  try {
    const { msg_id, action, userid } = req.body;
    if (!msg_id || !action || !userid) {
      return res.status(400).json({ error: '缺少参数：msg_id, action, userid' });
    }

    const [rows] = await pool.query('SELECT * FROM wecom_test_messages WHERE id = ?', [msg_id]);
    if (rows.length === 0) {
      return res.status(400).json({ error: '消息不存在' });
    }

    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const msg = rows[0];
    const totalAmount = parseFloat(msg.total_amount || 0);
    const deptCount = msg.departments ? JSON.parse(msg.departments).length : 0;
    const itemCount = msg.purchase_items ? JSON.parse(msg.purchase_items).length : 0;

    if (action === 'confirm') {
      await pool.query(
        'UPDATE wecom_test_messages SET status = ?, confirmed_by = ?, confirmed_at = ? WHERE id = ?',
        ['confirmed', userid, now, msg_id]
      );
    } else if (action === 'reject') {
      await pool.query(
        'UPDATE wecom_test_messages SET status = ?, rejected_by = ?, rejected_at = ? WHERE id = ?',
        ['rejected', userid, now, msg_id]
      );
    } else {
      return res.status(400).json({ error: 'action 必须是 confirm 或 reject' });
    }

    res.json({ success: true, message: `${action === 'confirm' ? '已确认' : '已驳回'}，状态已更新` });
  } catch (err) {
    console.error('测试回调失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 处理JSON格式的模板卡片回调（智能机器人）
async function handleJsonCallback(body, res) {
  try {
    console.log('[企微回调-JSON] 收到事件:', JSON.stringify(body, null, 2));
    
    const { event, from, msgid, response_url } = body;
    const eventType = event?.eventtype;
    
    if (eventType === 'template_card_event') {
      const tcEvent = event?.template_card_event || {};
      const cardType = tcEvent.card_type;
      const eventKey = tcEvent.event_key;
      const taskId = tcEvent.task_id;
      const responseCode = tcEvent.response_code;
      const fromUser = from?.userid;
      
      console.log(`[企微回调-JSON] 模板卡片事件: cardType=${cardType}, eventKey=${eventKey}, taskId=${taskId}, responseCode=${responseCode}, fromUser=${fromUser}`);
      
      // button_list 模式：event_key=button_key
      const targetId = eventKey;
      
      // 匹配 confirm_UUID_userid 或 reject_UUID_userid
      const match = targetId.match(/^(confirm|reject)_([a-f0-9-]{36})_/i);
      console.log(`[企微回调-JSON] match结果:`, match);
      
      const action = match ? match[1].toLowerCase() : '';
      const msgId = match ? match[2] : '';

      if (msgId && (action === 'confirm' || action === 'reject')) {
        const [rows] = await pool.query('SELECT * FROM wecom_test_messages WHERE id = ?', [msgId]);
        console.log(`[企微回调-JSON] 查询结果:`, rows.length);
        
        if (rows.length > 0) {
          const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
          const config = await getWecomConfig();
          const msg = rows[0];
          const totalAmount = parseFloat(msg.total_amount || 0);
          const deptCount = msg.departments ? JSON.parse(msg.departments).length : 0;
          const itemCount = msg.purchase_items ? JSON.parse(msg.purchase_items).length : 0;

          if (action === 'confirm') {
            await pool.query(
              'UPDATE wecom_test_messages SET status = ?, confirmed_by = ?, confirmed_at = ? WHERE id = ?',
              ['confirmed', fromUser, now, msgId]
            );
            try {
              await updateTemplateCard(config, fromUser, 'text_notice', responseCode, {
                main_title: {
                  title: '✅ 已确认',
                  desc: `确认人：${fromUser}　时间：${now}`,
                },
                horizontal_content_list: [
                  { keyname: '总金额', value: `¥${totalAmount.toFixed(2)}` },
                  { keyname: '部门数', value: `${deptCount}个` },
                  { keyname: '食材项', value: `${itemCount}项` },
                ],
              });
              console.log(`[企微回调-JSON] 确认卡片更新成功`);
            } catch (updErr) {
              console.error('更新确认卡片失败:', updErr.message);
            }
          } else {
            await pool.query(
              'UPDATE wecom_test_messages SET status = ?, rejected_by = ?, rejected_at = ? WHERE id = ?',
              ['rejected', fromUser, now, msgId]
            );
            try {
              await updateTemplateCard(config, fromUser, 'text_notice', responseCode, {
                main_title: {
                  title: '❌ 已驳回',
                  desc: `驳回人：${fromUser}　时间：${now}`,
                },
                horizontal_content_list: [
                  { keyname: '总金额', value: `¥${totalAmount.toFixed(2)}` },
                  { keyname: '部门数', value: `${deptCount}个` },
                  { keyname: '食材项', value: `${itemCount}项` },
                ],
              });
              console.log(`[企微回调-JSON] 驳回卡片更新成功`);
            } catch (updErr) {
              console.error('更新驳回卡片失败:', updErr.message);
            }
          }
        }
      }
    }
    
    return res.send('success');
  } catch (err) {
    console.error('[企微回调-JSON] 处理失败:', err);
    return res.send('success');
  }
}

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

    console.log('[企微回调] 收到POST请求:', { msg_signature, timestamp, nonce, body: req.body, rawBody: req.rawBody ? req.rawBody.toString().substring(0, 500) : null, contentType: req.headers['content-type'] });

    if (!config || !config.callback_token || !config.callback_aes_key) {
      console.log('[企微回调] 回调未配置');
      return res.send('success');
    }

    // 获取原始body内容
    const rawBodyStr = req.rawBody ? req.rawBody.toString() : '';
    console.log('[企微回调] 原始body:', rawBodyStr.substring(0, 500));

    // 检查是否是JSON格式回调
    let jsonBody = null;
    try {
      jsonBody = JSON.parse(rawBodyStr);
      console.log('[企微回调] 解析为JSON:', jsonBody);
    } catch (e) {
      console.log('[企微回调] 不是JSON格式');
    }

    if (jsonBody && !jsonBody.Encrypt && !jsonBody.encrypt) {
      console.log('[企微回调] 收到JSON格式回调');
      return handleJsonCallback(jsonBody, res);
    }

    // 检查是否是加密XML格式（从JSON或XML中提取Encrypt）
    let encrypt = null;
    if (jsonBody && jsonBody.Encrypt) {
      encrypt = jsonBody.Encrypt;
    } else if (jsonBody && jsonBody.encrypt) {
      encrypt = jsonBody.encrypt;
    } else if (rawBodyStr.includes('<Encrypt>')) {
      // 从XML字符串中提取Encrypt字段
      const encryptMatch = rawBodyStr.match(/<Encrypt><!\[CDATA\[(.+?)\]\]><\/Encrypt>/);
      if (encryptMatch) {
        encrypt = encryptMatch[1];
      }
    }

    console.log('[企微回调] Encrypt字段存在:', !!encrypt);
    
    if (!encrypt) {
      console.log('[企微回调] 无Encrypt字段，直接返回success');
      return res.send('success');
    }
    
    const isValid = verifySignature(config.callback_token, timestamp, nonce, encrypt, msg_signature);
    if (!isValid) {
      console.log('[企微回调] 签名验证失败');
      return res.status(403).send('签名验证失败');
    }

    const xmlContent = decryptMsg(config.callback_aes_key, encrypt, config.corp_id);
    console.log('[企微回调] 原始XML:', xmlContent);

    // 解析XML
    const fromUserMatch = xmlContent.match(/<FromUserName><!\[CDATA\[(.+?)\]\]><\/FromUserName>/);
    const toUserMatch = xmlContent.match(/<ToUserName><!\[CDATA\[(.+?)\]\]><\/ToUserName>/);
    const msgTypeMatch = xmlContent.match(/<MsgType><!\[CDATA\[(.+?)\]\]><\/MsgType>/);
    const chatIdMatch = xmlContent.match(/<ChatId><!\[CDATA\[(.+?)\]\]><\/ChatId>/);
    const eventMatch = xmlContent.match(/<Event><!\[CDATA\[(.+?)\]\]><\/Event>/);
    const spNoMatch = xmlContent.match(/<SpNo><!\[CDATA\[(.+?)\]\]><\/SpNo>/);
    const spStatusMatch = xmlContent.match(/<SpStatus>(\d+)<\/SpStatus>/);
    const eventKeyMatch = xmlContent.match(/<EventKey><!\[CDATA\[(.+?)\]\]><\/EventKey>/);
    const taskIdMatch = xmlContent.match(/<TaskId><!\[CDATA\[(.+?)\]\]><\/TaskId>/);
    const selectedIdMatch = xmlContent.match(/<SelectedId><!\[CDATA\[(.+?)\]\]><\/SelectedId>/);
    const responseCodeMatch = xmlContent.match(/<ResponseCode><!\[CDATA\[(.+?)\]\]><\/ResponseCode>/);

    const fromUser = fromUserMatch ? fromUserMatch[1] : '';
    const toUser = toUserMatch ? toUserMatch[1] : '';
    const msgType = msgTypeMatch ? msgTypeMatch[1] : '';
    const chatId = chatIdMatch ? chatIdMatch[1] : '';
    const event = eventMatch ? eventMatch[1] : '';
    const spNo = spNoMatch ? spNoMatch[1] : '';
    const spStatus = spStatusMatch ? parseInt(spStatusMatch[1]) : null;
    const eventKey = eventKeyMatch ? eventKeyMatch[1] : '';
    const taskId = taskIdMatch ? taskIdMatch[1] : '';
    const selectedId = selectedIdMatch ? selectedIdMatch[1] : '';
    const responseCode = responseCodeMatch ? responseCodeMatch[1] : '';

    console.log('[企微回调] 解析结果:', { msgType, event, fromUser, eventKey, taskId, selectedId, responseCode });

    // 审批状态变更事件
    if (msgType === 'event' && event === 'open_approval_change' && spNo) {
      try {
        // 先查食材采购确认单
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
        } else {
          // 再查仓库采购单（包括采购审批和报销审批）
          const [whRows] = await pool.query(
            'SELECT id, approval_sp_no, reimbursement_sp_no FROM warehouse_purchases WHERE approval_sp_no = ? OR reimbursement_sp_no = ?',
            [spNo, spNo]
          );
          if (whRows.length > 0) {
            const wh = whRows[0];
            if (wh.approval_sp_no === spNo) {
              // 采购审批状态变更
              let approvalStatus = 'pending';
              let newStatus = 'pending_approval';
              if (spStatus === 2) {
                approvalStatus = 'approved';
                newStatus = 'approved';
              } else if (spStatus === 3) {
                approvalStatus = 'rejected';
                newStatus = 'rejected';
              }
              await pool.query(
                'UPDATE warehouse_purchases SET approval_status = ?, status = ? WHERE id = ?',
                [approvalStatus, newStatus, wh.id]
              );
            }
            if (wh.reimbursement_sp_no === spNo) {
              // 报销审批状态变更
              let reimburseStatus = 'processing';
              let newStatus = 'reimbursing';
              if (spStatus === 2) {
                reimburseStatus = 'approved';
                newStatus = 'reimbursed';
              } else if (spStatus === 3) {
                reimburseStatus = 'rejected';
              }
              await pool.query(
                'UPDATE warehouse_purchases SET reimbursement_status = ?, status = ? WHERE id = ?',
                [reimburseStatus, newStatus, wh.id]
              );
            }
          }
        }
      } catch (dbErr) {
        console.error('更新审批状态失败:', dbErr);
      }
    }

    // 模板卡片按钮点击事件（测试消息的确认/驳回）
    if (msgType === 'event' && event === 'template_card_event') {
      try {
        console.log(`[模板卡片回调] fromUser=${fromUser}, eventKey=${eventKey}, selectedId=${selectedId}, taskId=${taskId}, responseCode=${responseCode}`);
        // button_list 模式：EventKey=button_key，格式为 confirm_${id}_${userid} 或 reject_${id}_${userid}
        // button_selection 模式：SelectedId=option_id，格式为 confirm_${id}_${userid} 或 reject_${id}_${userid}
        const targetId = eventKey || selectedId;
        
        console.log(`[模板卡片回调] targetId=${targetId}`);
        
        // 匹配 confirm_UUID_userid 或 reject_UUID_userid（id是UUID格式）
        const goMatch = targetId.match(/^go_confirm_([a-f0-9-]{36})_/i);
        const match = targetId.match(/^(confirm|reject)_([a-f0-9-]{36})_/i);
        console.log(`[模板卡片回调] match结果:`, match, 'goMatch:', goMatch);
        
        // "去确认"按钮：由于按钮已配置url，点击会直接跳转，不需要修改按钮文案
        
        const action = match ? match[1].toLowerCase() : '';
        const msgId = match ? match[2] : '';

        if (msgId && (action === 'confirm' || action === 'reject')) {
          console.log(`[模板卡片回调] 开始查询数据库: id=${msgId}`);
          const [rows] = await pool.query('SELECT * FROM wecom_test_messages WHERE id = ?', [msgId]);
          console.log(`[模板卡片回调] 查询结果:`, rows.length);
          if (rows.length > 0) {
            const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
            console.log(`[模板卡片回调] 准备更新数据库: action=${action}, msgId=${msgId}, fromUser=${fromUser}`);
            const config = await getWecomConfig();
            console.log(`[模板卡片回调] getWecomConfig结果:`, config ? '成功' : '失败');
            const msg = rows[0];
            console.log(`[模板卡片回调] msg对象存在:`, !!msg, typeof msg, Object.keys(msg || {}));
            console.log(`[模板卡片回调] total_amount:`, msg && msg.total_amount);
            
            // 先执行数据库UPDATE，不依赖其他字段
            if (action === 'confirm') {
              console.log(`[模板卡片回调] 执行确认UPDATE`);
              const [updateResult] = await pool.query(
                'UPDATE wecom_test_messages SET status = ?, confirmed_by = ?, confirmed_at = ? WHERE id = ?',
                ['confirmed', fromUser, now, msgId]
              );
              console.log(`[模板卡片回调] 确认UPDATE结果:`, updateResult);
            } else {
              console.log(`[模板卡片回调] 执行驳回UPDATE`);
              const [updateResult] = await pool.query(
                'UPDATE wecom_test_messages SET status = ?, rejected_by = ?, rejected_at = ? WHERE id = ?',
                ['rejected', fromUser, now, msgId]
              );
              console.log(`[模板卡片回调] 驳回UPDATE结果:`, updateResult);
            }
            
            // 然后再处理卡片更新（放在try-catch里）
            try {
              const totalAmount = parseFloat(msg.total_amount || 0);
              let deptCount = 0;
              let itemCount = 0;

              // 检查departments字段类型并处理
              if (Array.isArray(msg.departments)) {
                deptCount = msg.departments.length;
              } else if (typeof msg.departments === 'string' && msg.departments) {
                try {
                  deptCount = JSON.parse(msg.departments).length;
                } catch (e) {
                  console.error(`[模板卡片回调] 解析departments失败:`, e.message);
                }
              }

              // 检查purchase_items字段类型并处理
              if (Array.isArray(msg.purchase_items)) {
                itemCount = msg.purchase_items.length;
              } else if (typeof msg.purchase_items === 'string' && msg.purchase_items) {
                try {
                  itemCount = JSON.parse(msg.purchase_items).length;
                } catch (e) {
                  console.error(`[模板卡片回调] 解析purchase_items失败:`, e.message);
                }
              }

              console.log(`[模板卡片回调] 准备更新卡片: deptCount=${deptCount}, itemCount=${itemCount}`);

              // 优先使用简单的按钮文案更新方式（按钮变灰不可点击）
              if (action === 'confirm') {
                try {
                  await updateTemplateCardButton(config, fromUser, responseCode, `✅ 已确认 by ${fromUser}`);
                  console.log(`[模板卡片回调] 确认按钮更新成功`);
                } catch (updErr) {
                  console.error('更新确认按钮失败:', updErr.message);
                  // 失败后尝试替换整张卡片
                  try {
                    await updateTemplateCard(config, fromUser, 'text_notice', responseCode, {
                      main_title: {
                        title: '✅ 已确认',
                        desc: `确认人：${fromUser}　时间：${now}`,
                      },
                      horizontal_content_list: [
                        { keyname: '总金额', value: `¥${totalAmount.toFixed(2)}` },
                        { keyname: '部门数', value: `${deptCount}个` },
                        { keyname: '食材项', value: `${itemCount}项` },
                      ],
                    });
                    console.log(`[模板卡片回调] 确认卡片更新成功`);
                  } catch (updErr2) {
                    console.error('更新确认卡片也失败:', updErr2.message);
                  }
                }
              } else {
                try {
                  await updateTemplateCardButton(config, fromUser, responseCode, `❌ 已驳回 by ${fromUser}`);
                  console.log(`[模板卡片回调] 驳回按钮更新成功`);
                } catch (updErr) {
                  console.error('更新驳回按钮失败:', updErr.message);
                  // 失败后尝试替换整张卡片
                  try {
                    await updateTemplateCard(config, fromUser, 'text_notice', responseCode, {
                      main_title: {
                        title: '❌ 已驳回',
                        desc: `驳回人：${fromUser}　时间：${now}`,
                      },
                      horizontal_content_list: [
                        { keyname: '总金额', value: `¥${totalAmount.toFixed(2)}` },
                        { keyname: '部门数', value: `${deptCount}个` },
                        { keyname: '食材项', value: `${itemCount}项` },
                      ],
                    });
                    console.log(`[模板卡片回调] 驳回卡片更新成功`);
                  } catch (updErr2) {
                    console.error('更新驳回卡片也失败:', updErr2.message);
                  }
                }
              }
            } catch (tcErr) {
              console.error(`[模板卡片回调] 更新卡片失败:`, tcErr.message);
            }
          } else {
            console.log(`[模板卡片回调] 未找到记录: id=${msgId}`);
          }
        } else {
          console.log(`[模板卡片回调] 参数不匹配: msgId=${msgId}, action=${action}`);
        }
      } catch (tcErr) {
        console.error('处理模板卡片事件失败:', tcErr);
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

// ================================================
// 预订审批流程专用通知函数
// ================================================

/**
 * 构建订单业务摘要文本
 */
function buildBizSummary(items) {
  if (!items || !items.length) return '无业务项目';
  const bizMap = {
    checkup: '体检', lodging: '住宿', breakfast: '早餐',
    lunch: '午餐', dinner: '晚餐', meeting: '会务',
    wellness: '康乐', carpickup: '用车',
  };
  const bizSet = new Set();
  for (const it of items) {
    const label = bizMap[it.item_type] || it.item_type;
    bizSet.add(label);
  }
  return Array.from(bizSet).join('、');
}

/**
 * 发送预订审批通知（统一入口）
 * @param {string} type - 通知类型：submit/salesConfirm/approve/reject
 * @param {object} order - 订单完整数据（含 items）
 * @param {object} extra - 附加数据（如 rejectionReason）
 */
async function sendBookingNotification(type, order, extra = {}) {
  const config = await getWecomConfig();
  if (!config) {
    console.warn('[sendBookingNotification] wecom_config 未配置，跳过通知');
    return;
  }

  const orderNo = order.order_no || order.id;
  const customerName = order.customer_name || '未知客户';
  const bizSummary = buildBizSummary(order.items);
  const salesPerson = order.sales_person || '';
  const remark = order.remark || '';
  const remarkLine = remark ? `> 备注：${remark}\n` : '';
  const frontEndBase = process.env.FRONTEND_URL || process.env.PUBLIC_URL || '';

  // 查找销售员企微userid（内部函数，各 case 复用）
  const findSalesUserid = async () => {
    if (!order.sales_person_id) return null;
    try {
      const [userRows] = await pool.query('SELECT wecom_userid FROM users WHERE id = ? LIMIT 1', [order.sales_person_id]);
      if (userRows.length > 0 && userRows[0].wecom_userid) return userRows[0].wecom_userid;
    } catch (e) {
      console.warn('[sendBookingNotification] 查询销售员企微ID失败:', e.message);
    }
    return null;
  };

  // 通知失败不抛错，只记录日志
  const safeSend = async (fn, label) => {
    try {
      const result = await fn();
      console.log(`[sendBookingNotification] ${label} 成功:`, result?.msgid || result?.response_code || 'ok');
      return result;
    } catch (err) {
      console.error(`[sendBookingNotification] ${label} 失败:`, err.message);
      return null;
    }
  };

  // 构建模板卡片（button_interaction 类型，复用现有 H5 确认页）
  const buildTemplateCard = (mainTitle, subTitleText, contentRows, buttonText, cardUrl, taskId) => {
    const horizontalContentList = contentRows.map(({ keyname, value }) => ({ keyname, value }));
    return {
      card_type: 'button_interaction',
      source: { desc: '预订管理系统' },
      main_title: { title: mainTitle, desc: customerName },
      sub_title_text: subTitleText,
      horizontal_content_list: horizontalContentList,
      button_list: [{
        text: buttonText,
        style: 1,
        type: 1,
        key: `go_booking_${taskId || orderNo}`,
        url: cardUrl,
      }],
      task_id: `booking_${taskId || orderNo}`,
      card_action: { type: 1, url: cardUrl },
    };
  };

  console.log(`[sendBookingNotification] 开始发送: type=${type}, orderNo=${orderNo}, customer=${customerName}`);

  switch (type) {
    case 'submit': {
      // ① 预订群通知
      if (config.booking_webhook_url && config.booking_notify_submit !== 0) {
        const md = `📋 **已有新订单**\n` +
          `> 订单号：${orderNo}\n` +
          `> 客户：${customerName}\n` +
          remarkLine +
          `> 涉及业务：${bizSummary}\n` +
          `> 销售员：${salesPerson || '未指定'}\n` +
          `> 状态：待销售员确认`;
        await safeSend(() => sendMarkdownViaWebhook(config.booking_webhook_url, md), '预订群通知');
      }
      // ② 销售员模板卡片通知
      if (config.booking_notify_sales !== 0) {
        const salesUserid = await findSalesUserid();
        if (salesUserid) {
          console.log(`[sendBookingNotification] 销售员企微userid=${salesUserid}, agent_id=${config.agent_id}`);
          const cardUrl = frontEndBase ? `${frontEndBase}/booking-board` : '';
          const card = buildTemplateCard(
            '📋 订单待确认',
            `订单号：${orderNo}\n请尽快确认订单信息`,
            [
              { keyname: '客户', value: customerName },
              { keyname: '业务', value: bizSummary },
              { keyname: '销售员', value: salesPerson || '未指定' },
              ...(remark ? [{ keyname: '备注', value: remark }] : []),
            ],
            '去确认',
            cardUrl,
            orderNo
          );
          await safeSend(
            () => sendTemplateCardToUser(config, salesUserid, card),
            '销售员模板卡片'
          );
        } else {
          console.warn('[sendBookingNotification] 销售员企微userid为空，跳过应用通知。请检查 users 表 wecom_userid 字段');
        }
      }
      break;
    }

    case 'salesConfirm': {
      // ① 审核员模板卡片通知
      const approverUserid = config.booking_approver_userid;
      if (approverUserid) {
        console.log(`[sendBookingNotification] 审核员企微userid=${approverUserid}, agent_id=${config.agent_id}`);
        const cardUrl = frontEndBase ? `${frontEndBase}/booking-board` : '';
        const card = buildTemplateCard(
          '📋 订单待审核',
          `订单号：${orderNo}\n销售员已确认，请审核`,
          [
            { keyname: '客户', value: customerName },
            { keyname: '业务', value: bizSummary },
            { keyname: '销售员', value: salesPerson || '未指定' },
            ...(remark ? [{ keyname: '备注', value: remark }] : []),
          ],
          '去审核',
          cardUrl,
          orderNo
        );
        await safeSend(
          () => sendTemplateCardToUser(config, approverUserid, card),
          '审核员模板卡片'
        );
      } else {
        console.warn('[sendBookingNotification] 固定审核员企微userid未配置，跳过审核员通知');
      }
      // ② 预订群通知
      if (config.booking_webhook_url && config.booking_notify_submit !== 0) {
        const md = `✅ **销售员已确认**\n` +
          `> 订单号：${orderNo}\n` +
          `> 客户：${customerName}\n` +
          remarkLine +
          `> 涉及业务：${bizSummary}\n` +
          `> 销售员：${salesPerson || '未指定'}\n` +
          `> 状态：待审核员审核`;
        await safeSend(() => sendMarkdownViaWebhook(config.booking_webhook_url, md), '预订群通知');
      }
      break;
    }

    case 'approve': {
      // ① 预订群通知
      if (config.booking_webhook_url && config.booking_notify_approve !== 0) {
        const md = `✅ **订单已确认**\n` +
          `> 订单号：${orderNo}\n` +
          `> 客户：${customerName}\n` +
          remarkLine +
          `> 涉及业务：${bizSummary}\n` +
          `> 状态：已确认（已锁定，不可修改）`;
        await safeSend(() => sendMarkdownViaWebhook(config.booking_webhook_url, md), '预订群通知');
      }
      // ② 销售员模板卡片通知
      const salesUserid = await findSalesUserid();
      if (salesUserid) {
        const cardUrl = frontEndBase ? `${frontEndBase}/booking-board` : '';
        const card = buildTemplateCard(
          '✅ 订单已确认',
          `订单号：${orderNo}\n审核已通过`,
          [
            { keyname: '客户', value: customerName },
            { keyname: '业务', value: bizSummary },
            ...(remark ? [{ keyname: '备注', value: remark }] : []),
          ],
          '查看订单',
          cardUrl,
          orderNo
        );
        await safeSend(
          () => sendTemplateCardToUser(config, salesUserid, card),
          '销售员确认通知'
        );
      }
      break;
    }

    case 'reject': {
      // 通知销售员驳回
      if (config.booking_notify_reject !== 0) {
        const salesUserid = await findSalesUserid();
        if (salesUserid) {
          const reason = extra.rejectionReason || '未填写原因';
          const cardUrl = frontEndBase ? `${frontEndBase}/booking-board` : '';
          const card = buildTemplateCard(
            '❌ 订单被驳回',
            `订单号：${orderNo}\n请修改后重新提交`,
            [
              { keyname: '客户', value: customerName },
              { keyname: '业务', value: bizSummary },
              { keyname: '驳回原因', value: reason },
            ],
            '查看详情',
            cardUrl,
            orderNo
          );
          await safeSend(
            () => sendTemplateCardToUser(config, salesUserid, card),
            '销售员驳回通知'
          );
        } else {
          console.warn('[sendBookingNotification] 销售员企微userid为空，跳过驳回通知');
        }
      }
      break;
    }

    default:
      console.warn(`[sendBookingNotification] 未知通知类型: ${type}`);
  }
  console.log(`[sendBookingNotification] 发送完成: type=${type}, orderNo=${orderNo}`);
}

module.exports = router;
module.exports.getWecomConfig = getWecomConfig;
module.exports.getAccessToken = getAccessToken;
module.exports.sendWecomMessage = sendWecomMessage;
module.exports.sendMarkdownViaWebhook = sendMarkdownViaWebhook;
module.exports.sendViaWebhook = sendViaWebhook;
module.exports.getApprovalTemplateDetail = getApprovalTemplateDetail;
module.exports.submitApproval = submitApproval;
module.exports.getApprovalDetail = getApprovalDetail;
module.exports.uploadMedia = uploadMedia;
module.exports.getWecomUserName = getWecomUserName;
module.exports.sendTemplateCardToUser = sendTemplateCardToUser;
module.exports.updateTemplateCardButton = updateTemplateCardButton;
module.exports.sendTextViaWebhook = sendTextViaWebhook;
module.exports.sendTextToUser = sendTextToUser;
module.exports.sendMarkdownToUser = sendMarkdownToUser;
module.exports.sendBookingNotification = sendBookingNotification;
