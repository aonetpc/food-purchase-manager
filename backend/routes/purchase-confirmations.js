const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const pool = require('../db');
const { generateConfirmationPDF } = require('../utils/pdf');
const { getWecomConfig, sendWecomMessage, sendMarkdownViaWebhook, sendTextViaWebhook, submitApproval, getApprovalDetail, uploadMedia, sendTemplateCardToUser, updateTemplateCardButton, getWecomUserName } = require('./wecom');

// PDF存储目录
const PDF_DIR = '/opt/food-purchase/backend/uploads/pdfs';

// 确保PDF目录存在
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
    '/usr/share/fonts/truetype/wqy/wqy-microhei.ttf',
    '/usr/share/fonts/truetype/noto/NotoSansCJKsc-Bold.ttf'
  ];
  for (const p of paths) {
    if (fs.existsSync(p) && !p.endsWith('.ttc')) return p;
  }
  return null;
}

// 安全数值转换（兼容mysql2 decimal对象）
function toNum(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (typeof val === 'object') {
    const str = val.String || val.string || val.val || JSON.stringify(val);
    const n = parseFloat(String(str));
    return isNaN(n) ? 0 : n;
  }
  const n = parseFloat(String(val));
  return isNaN(n) ? 0 : n;
}

// 获取确认单列表
router.get('/', async (req, res) => {
  try {
    const { month, status } = req.query;
    let sql = 'SELECT * FROM purchase_confirmations';
    const params = [];
    const conditions = [];

    if (month) {
      conditions.push("DATE_FORMAT(purchase_date, '%Y-%m') = ?");
      params.push(month);
    }
    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY purchase_date DESC, created_at DESC';

    const [rows] = await pool.query(sql, params);
    res.json(rows.map(row => ({
      ...row,
      total_amount: toNum(row.total_amount),
      prepay_amount: toNum(row.prepay_amount),
      departments: typeof row.departments === 'string' ? JSON.parse(row.departments) : row.departments,
      purchase_items: typeof row.purchase_items === 'string' ? JSON.parse(row.purchase_items) : row.purchase_items,
      user_departments: typeof row.user_departments === 'string' ? JSON.parse(row.user_departments || '{}') : (row.user_departments || {}),
      user_confirmations: typeof row.user_confirmations === 'string' ? JSON.parse(row.user_confirmations || '{}') : (row.user_confirmations || {}),
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 获取单个确认单
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT * FROM purchase_confirmations WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '确认单不存在' });
    }
    const row = rows[0];
    res.json({
      ...row,
      total_amount: toNum(row.total_amount),
      prepay_amount: toNum(row.prepay_amount),
      departments: typeof row.departments === 'string' ? JSON.parse(row.departments) : row.departments,
      purchase_items: typeof row.purchase_items === 'string' ? JSON.parse(row.purchase_items) : row.purchase_items,
      user_departments: typeof row.user_departments === 'string' ? JSON.parse(row.user_departments) : row.user_departments,
      user_confirmations: typeof row.user_confirmations === 'string' ? JSON.parse(row.user_confirmations) : row.user_confirmations,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 创建确认单并发送到企微
router.post('/', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const { purchase_date, total_amount, departments, purchase_items, purchase_type = 'normal', supplier_id = null, supplier_name = null, prepay_amount = 0 } = req.body;

    const id = uuidv4();
    const config = await getWecomConfig();

    // 检查配置：Webhook URL 或 API 配置至少有一个
    const hasWebhook = config && config.webhook_url;
    const hasApiConfig = config && config.corp_id && config.app_secret && config.chat_id;
    if (!hasWebhook && !hasApiConfig) {
      return res.status(400).json({ error: '请先在企业微信管理页面完成群聊配置（Webhook URL 或应用配置）' });
    }

    // 预付款采购：如果供应商有预付余额，自动抵扣
    let finalPrepayAmount = toNum(prepay_amount);
    let prepayDeductFromBalance = 0;
    if (purchase_type === 'prepay' && supplier_id) {
      const [suppRows] = await connection.query('SELECT prepay_balance FROM suppliers WHERE id = ?', [supplier_id]);
      if (suppRows.length > 0 && toNum(suppRows[0].prepay_balance) > 0) {
        prepayDeductFromBalance = Math.min(toNum(suppRows[0].prepay_balance), finalPrepayAmount);
        finalPrepayAmount = finalPrepayAmount - prepayDeductFromBalance;
      }
    }

    const displayDate = purchase_date.substring(0, 10);

    // 构建确认链接（优先使用配置的域名，避免IP安全提示）
    const domain = config && config.app_domain ? config.app_domain : (req.headers.origin || req.protocol + '://' + req.get('host'));

    // 获取各部门确认人（用于群消息@和个人消息发送）
    const [deptRows] = await pool.query('SELECT id, name, confirmer_userid FROM departments');
    const deptConfirmerMap = {};
    for (const d of deptRows) {
      if (d.confirmer_userid) {
        deptConfirmerMap[d.id] = d.confirmer_userid;
        deptConfirmerMap[d.name] = d.confirmer_userid;
      }
    }

    // 构建 userDeptMap: 每个用户负责的部门和明细
    const userDeptMap = {};
    for (const item of purchase_items) {
      const deptId = item.department_id;
      const deptName = item.department_name;
      const confirmer = deptConfirmerMap[deptId] || deptConfirmerMap[deptName];
      if (confirmer) {
        if (!userDeptMap[confirmer]) userDeptMap[confirmer] = { items: [], depts: new Set() };
        userDeptMap[confirmer].items.push(item);
        userDeptMap[confirmer].depts.add(deptName);
      }
    }
    const mentionedUsers = Object.keys(userDeptMap);

    // 构建 Markdown 群消息内容
    const deptNames = departments.map(d => d.name).join('、');
    let mdContent = `**📋 食材采购确认通知**\n\n`;
    mdContent += `📅 **采购日期**：${displayDate}\n`;
    mdContent += `🏢 **涉及部门**：${deptNames}\n`;
    mdContent += `💰 **总金额**：¥${Number(total_amount).toFixed(2)}\n\n`;
    mdContent += `---\n\n`;

    const groupedItems = {};
    for (const item of purchase_items) {
      const deptName = item.department_name || '未分类';
      if (!groupedItems[deptName]) groupedItems[deptName] = [];
      groupedItems[deptName].push(item);
    }

    for (const [deptName, items] of Object.entries(groupedItems)) {
      mdContent += `**【${deptName}】**\n`;
      for (const item of items) {
        mdContent += `> ${item.ingredient_name}  ${Number(item.purchase_unit_price).toFixed(2)}/${item.purchase_unit} ×${item.purchase_quantity}${item.purchase_unit} = ¥${Number(item.amount).toFixed(2)}\n`;
      }
      const subtotal = items.reduce((s, i) => s + Number(i.amount), 0);
      mdContent += `> *小计：¥${subtotal.toFixed(2)}*\n\n`;
    }

    mdContent += `---\n\n`;

    // 获取确认人姓名用于显示
    let mentionText = '📢 请相关人员核对清单并确认入库：';
    for (const userid of mentionedUsers) {
      const name = await getWecomUserName(userid);
      mentionText += ` @${name}`;
    }
    mdContent += mentionText;

    // 保存确认单（先保存，发送失败可以删除，或者让用户重试）
    await connection.query(
      `INSERT INTO purchase_confirmations (id, purchase_date, total_amount, departments, purchase_items, status, purchase_type, supplier_id, supplier_name, prepay_amount)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
      [id, displayDate, total_amount, JSON.stringify(departments), JSON.stringify(purchase_items), purchase_type, supplier_id, supplier_name, finalPrepayAmount]
    );

    // 预付款余额抵扣：记录抵扣并更新供应商余额
    if (prepayDeductFromBalance > 0) {
      await connection.query(
        'UPDATE suppliers SET prepay_balance = prepay_balance - ? WHERE id = ?',
        [prepayDeductFromBalance, supplier_id]
      );
      await connection.query(
        `INSERT INTO prepay_records (id, supplier_id, purchase_id, amount, type, remark) VALUES (?, ?, ?, ?, 'deduct', '预付款采购自动抵扣余额')`,
        [uuidv4(), supplier_id, id, prepayDeductFromBalance]
      );
    }

    // 发送群消息（优先使用 Webhook）
    let wecomMsgId = null;
    try {
      if (hasWebhook) {
        await sendMarkdownViaWebhook(config.webhook_url, mdContent);
        wecomMsgId = 'webhook';
      } else {
        // 回退到 API 方式
        const plainContent = mdContent.replace(/\*\*/g, '').replace(/> /g, '');
        wecomMsgId = await sendWecomMessage(config, plainContent);
      }
    } catch (sendErr) {
      // 发送失败，回滚
      await connection.rollback();
      return res.status(400).json({ error: `企业微信消息发送失败：${sendErr.message}` });
    }

    // 发送个人消息到各部门确认人（只发送TA负责部门的内容）
    const sentToUsers = [];
    const failedUsers = [];
    const sentResponseCodes = [];
    if (config && config.corp_id && config.app_secret && config.agent_id) {
      for (const [userid, data] of Object.entries(userDeptMap)) {
        try {
          const userDeptNames = Array.from(data.depts).join('、');
          const userTotal = data.items.reduce((s, i) => s + Number(i.amount), 0);

          let subTitle = `采购日期：${displayDate}\n您负责的部门：${userDeptNames}`;

          const horizontalContentList = [];
          horizontalContentList.push({ keyname: '总金额', value: `¥${userTotal.toFixed(2)}` });
          horizontalContentList.push({ keyname: '部门数', value: `${data.depts.size}个` });
          horizontalContentList.push({ keyname: '食材项', value: `${data.items.length}项` });

          const userTaskId = `${id}_${userid}`;
          const userConfirmUrl = `${domain}/wecom-confirm?id=${id}&user=${userid}`;

          const sendResult = await sendTemplateCardToUser(config, userid, {
            card_type: 'button_interaction',
            source: {
              desc: '食材采购管理系统',
            },
            main_title: {
              title: '📋 食材采购确认通知',
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
                url: userConfirmUrl
              }
            ],
            task_id: userTaskId,
            card_action: {
              type: 1,
              url: userConfirmUrl
            },
          });

          sentResponseCodes.push({ userid, responseCode: sendResult.response_code });
          sentToUsers.push({ userid, departments: userDeptNames, total: userTotal });
        } catch (sendErr) {
          console.error(`发送个人模板卡片消息失败 ${userid}:`, sendErr.message);
          failedUsers.push({ userid, error: sendErr.message });
        }
      }
    }

    // 构造 user_departments 映射（包含 response_code 用于更新卡片）
    const userDepartmentsMap = {};
    for (const [userid, data] of Object.entries(userDeptMap)) {
      const sentItem = sentResponseCodes.find(s => s.userid === userid);
      userDepartmentsMap[userid] = {
        departments: Array.from(data.depts),
        response_code: sentItem ? sentItem.responseCode : null,
      };
    }

    // 更新消息ID和 user_departments
    await connection.query(
      'UPDATE purchase_confirmations SET wecom_msg_id = ?, user_departments = ? WHERE id = ?',
      [wecomMsgId, JSON.stringify(userDepartmentsMap), id]
    );

    await connection.commit();

    const [rows] = await pool.query('SELECT * FROM purchase_confirmations WHERE id = ?', [id]);
    const row = rows[0];
    res.json({
      ...row,
      departments: typeof row.departments === 'string' ? JSON.parse(row.departments) : row.departments,
      purchase_items: typeof row.purchase_items === 'string' ? JSON.parse(row.purchase_items) : row.purchase_items,
      user_departments: typeof row.user_departments === 'string' ? JSON.parse(row.user_departments) : row.user_departments,
      sent_to_users: sentToUsers,
      failed_users: failedUsers,
    });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// 用户确认（新流程）
router.post('/:id/confirm', async (req, res) => {
  try {
    const { id } = req.params;
    const { user, signature_data } = req.body;

    const [rows] = await pool.query('SELECT * FROM purchase_confirmations WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '确认单不存在' });
    }

    const row = rows[0];
    
    const userDepartments = typeof row.user_departments === 'string' ? JSON.parse(row.user_departments) : row.user_departments;
    if (!userDepartments || !userDepartments[user]) {
      return res.status(400).json({ error: '该用户没有需要确认的部门' });
    }

    const realName = await getWecomUserName(user);
    const userDeptNames = userDepartments[user].departments;

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const nowStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    let userConfirmations = typeof row.user_confirmations === 'string' ? JSON.parse(row.user_confirmations || '{}') : (row.user_confirmations || {});
    
    userConfirmations[user] = {
      confirmed: true,
      confirmed_at: nowStr,
      confirmed_by: realName,
      departments: userDeptNames,
      signature_data,
    };

    const allConfirmed = Object.keys(userDepartments).every(uid => userConfirmations[uid]?.confirmed);
    let newStatus = allConfirmed ? 'confirmed' : 'pending';
    let reimbursementInitiated = false;
    let reimbursementSpNo = null;
    let pdfUrl = row.pdf_url;

    await pool.query(
      'UPDATE purchase_confirmations SET user_confirmations = ?, status = ? WHERE id = ?',
      [JSON.stringify(userConfirmations), newStatus, id]
    );

    try {
      const config = await getWecomConfig();
      const responseCode = userDepartments[user].response_code;
      if (config && responseCode) {
        await updateTemplateCardButton(config, user, responseCode, `已确认 (${nowStr})`);
      }
    } catch (updateErr) {
      console.error('更新模板卡片按钮失败:', updateErr.message);
    }

    if (allConfirmed) {
      try {
        const pdfPath = await generateConfirmationPDF(id);
        pdfUrl = `/api/purchase-confirmations/${id}/pdf`;
      } catch (pdfErr) {
        console.error('PDF生成失败:', pdfErr);
      }

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
          let paymentLabel = '转账';
          if (fieldMapping.payment_method && config.default_payment_key) {
            let paymentOptions = {};
            if (config.payment_options) {
              if (typeof config.payment_options === 'string') {
                try { paymentOptions = JSON.parse(config.payment_options); } catch (e) { paymentOptions = {}; }
              } else if (typeof config.payment_options === 'object') {
                paymentOptions = config.payment_options;
              }
            }
            paymentLabel = String(paymentOptions[config.default_payment_key] || config.default_payment_key);
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

          reimbursementSpNo = await submitApproval(config, applyData);
          reimbursementInitiated = true;
          newStatus = 'reimbursing';
        } catch (approvalErr) {
          console.error('自动发起报销失败:', approvalErr);
        }
      }
    }

    const updateFields = ['user_confirmations = ?', 'status = ?'];
    const updateValues = [JSON.stringify(userConfirmations), newStatus];

    if (pdfUrl) {
      updateFields.push('pdf_url = ?');
      updateValues.push(pdfUrl);
    }

    if (reimbursementInitiated && reimbursementSpNo) {
      updateFields.push('reimbursement_status = ?');
      updateValues.push('pending');
      updateFields.push('reimbursement_sp_no = ?');
      updateValues.push(reimbursementSpNo);
    }

    updateValues.push(id);
    await pool.query(`UPDATE purchase_confirmations SET ${updateFields.join(', ')} WHERE id = ?`, updateValues);

    res.json({
      success: true,
      all_confirmed: allConfirmed,
      reimbursement_initiated: reimbursementInitiated,
      reimbursement_sp_no: reimbursementSpNo,
      user_confirmations: userConfirmations,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 主动刷新审批状态
router.post('/:id/refresh-status', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT * FROM purchase_confirmations WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '确认单不存在' });
    }
    const row = rows[0];

    if (!row.reimbursement_sp_no) {
      return res.status(400).json({ error: '该确认单尚未发起报销审批' });
    }

    const config = await getWecomConfig();
    if (!config || !config.corp_id || !config.app_secret) {
      return res.status(400).json({ error: '请先完成企业微信应用配置' });
    }

    let detail = null;
    let spStatus = null;
    let spRecord = [];
    try {
      detail = await getApprovalDetail(config, row.reimbursement_sp_no);
      const info = detail.info || {};
      spStatus = info.sp_status;
      spRecord = info.sp_record || [];
    } catch (detailErr) {
      console.error('查询审批详情失败:', detailErr);
      const errMsg = detailErr.message || '';
      if (errMsg.includes('no approval auth')) {
        return res.status(500).json({ error: '查询审批状态失败：企业微信应用未开启"审批"权限。请在企业微信管理后台 -> 应用管理 -> 自建应用 -> 权限管理中开启"审批"权限。' });
      }
      return res.status(500).json({ error: `查询审批状态失败：${detailErr.message}` });
    }

    let newReimburseStatus = row.reimbursement_status;
    let newStatus = row.status;

    if (spStatus === 2) {
      newReimburseStatus = 'approved';
      newStatus = 'reimbursed';
    } else if (spStatus === 1) {
      newReimburseStatus = 'processing';
    } else if (spStatus === 3) {
      newReimburseStatus = 'rejected';
    }

    let latestApprover = null;
    let latestApproveTime = null;
    if (spRecord.length > 0) {
      const lastRecord = spRecord[spRecord.length - 1];
      if (lastRecord.approver && lastRecord.approver.length > 0) {
        latestApprover = lastRecord.approver[0].name || lastRecord.approver[0].userid;
      }
      if (lastRecord.speech) {
        latestApproveTime = lastRecord.speech;
      }
    }

    await pool.query(
      'UPDATE purchase_confirmations SET reimbursement_status = ?, status = ?, approval_detail = ? WHERE id = ?',
      [newReimburseStatus, newStatus, JSON.stringify(detail), id]
    );

    const [updatedRows] = await pool.query('SELECT * FROM purchase_confirmations WHERE id = ?', [id]);
    const updated = updatedRows[0];

    res.json({
      ...updated,
      total_amount: toNum(updated.total_amount),
      departments: typeof updated.departments === 'string' ? JSON.parse(updated.departments) : updated.departments,
      purchase_items: typeof updated.purchase_items === 'string' ? JSON.parse(updated.purchase_items) : updated.purchase_items,
    });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
});

// 重新发起报销（实际调用企微审批API）
router.post('/:id/resubmit', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT * FROM purchase_confirmations WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '确认单不存在' });
    }
    const row = rows[0];

    const config = await getWecomConfig();
    if (!config || !config.corp_id || !config.app_secret || !config.approval_template_id || !config.applicant_userid) {
      return res.status(400).json({ error: '请先完成企业微信审批配置（审批模板ID和申请人用户ID）' });
    }

    const departments = typeof row.departments === 'string' ? JSON.parse(row.departments) : row.departments;
    const purchaseItems = typeof row.purchase_items === 'string' ? JSON.parse(row.purchase_items) : row.purchase_items;

    // 重新生成PDF（确保使用最新代码）
    try {
      await generateConfirmationPDF(id);
    } catch (pdfErr) {
      console.error('重新生成PDF失败:', pdfErr);
    }

    const totalAmount = toNum(row.total_amount);
    const reasonTemplate = config.payment_reason_template || '{date}食材采购费用';
    let displayDate = '';
    if (row.purchase_date instanceof Date) {
      const d = row.purchase_date;
      displayDate = `${(d.getMonth() + 1).toString().padStart(2, '0')}月${d.getDate().toString().padStart(2, '0')}日`;
    } else if (typeof row.purchase_date === 'string') {
      const parts = row.purchase_date.substring(0, 10).split('-');
      if (parts.length === 3) {
        displayDate = `${parts[1]}月${parts[2]}日`;
      } else {
        displayDate = row.purchase_date.substring(0, 10);
      }
    } else {
      const str = String(row.purchase_date).substring(0, 10);
      const parts = str.split('-');
      if (parts.length === 3) {
        displayDate = `${parts[1]}月${parts[2]}日`;
      } else {
        displayDate = str;
      }
    }
    const reason = reasonTemplate.replace('{date}', displayDate);

    let fieldMapping = {};
    if (config.approval_field_mapping) {
      if (typeof config.approval_field_mapping === 'string') {
        try {
          fieldMapping = JSON.parse(config.approval_field_mapping);
        } catch (e) {
          fieldMapping = {};
        }
      } else if (typeof config.approval_field_mapping === 'object') {
        fieldMapping = config.approval_field_mapping;
      }
    }

    const tokenRes = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${config.corp_id}&corpsecret=${config.app_secret}`);
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return res.status(400).json({ error: '获取企微Token失败: ' + tokenData.errmsg });
    }

    const tplRes = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/oa/gettemplatedetail?access_token=${tokenData.access_token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_id: config.approval_template_id })
    });
    const tplData = await tplRes.json();
    if (tplData.errcode !== 0) {
      return res.status(400).json({ error: '获取模板详情失败: ' + tplData.errmsg });
    }

    // 调试：打印模板控件列表
    if (tplData.template_content && tplData.template_content.controls) {
      const controlList = tplData.template_content.controls.map(ctrl => ({
        id: ctrl.property?.id,
        control: ctrl.property?.control,
        title: ctrl.property?.title?.[0]?.text || '',
        require: ctrl.property?.require
      }));
      console.log('模板控件列表:', JSON.stringify(controlList));
    }

    const requiredControls = [];
    if (tplData.template_content && tplData.template_content.controls) {
      for (const ctrl of tplData.template_content.controls) {
        if (ctrl.property && ctrl.property.require === 1) {
          const title = ctrl.property.title ? (ctrl.property.title[0] ? ctrl.property.title[0].text : '') : '';
          requiredControls.push({ id: ctrl.property.id, title });
        }
      }
    }

    const missingRequired = [];
    for (const req of requiredControls) {
      let found = false;
      for (const [key, mappedId] of Object.entries(fieldMapping)) {
        if (mappedId === req.id) {
          found = true;
          break;
        }
      }
      if (!found) {
        missingRequired.push(req);
      }
    }

    if (missingRequired.length > 0) {
      const missingNames = missingRequired.map(m => `${m.title || m.id}(${m.id})`).join('、');
      return res.status(400).json({ error: `审批模板存在必填字段未配置映射：${missingNames}，请在企业微信管理页面配置` });
    }

    // 构建控件ID到实际类型的映射
    const controlTypeMap = {};
    if (tplData.template_content && tplData.template_content.controls) {
      for (const ctrl of tplData.template_content.controls) {
        if (ctrl.property && ctrl.property.id && ctrl.property.control) {
          controlTypeMap[ctrl.property.id] = ctrl.property.control;
        }
      }
    }

    const contents = [];

    function getControlType(fieldKey, fallback) {
      const mappedId = fieldMapping[fieldKey];
      return mappedId ? (controlTypeMap[mappedId] || fallback) : fallback;
    }

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
      contents.push({ control: getControlType('amount', 'Money'), id: fieldMapping.amount, value: { new_money: totalAmount.toFixed(2) } });
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
    let paymentLabel = '转账';
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
        const dn = String(item.department_name || '未分类');
        if (!grouped[dn]) grouped[dn] = [];
        grouped[dn].push(item);
      }
      for (const [dn, items] of Object.entries(grouped)) {
        detailText += `【${dn}】\n`;
        for (const item of items) {
          const price = toNum(item.purchase_unit_price);
          const qty = toNum(item.purchase_quantity);
          const amt = toNum(item.amount);
          detailText += `${String(item.ingredient_name)} ${price}/${String(item.purchase_unit)} ×${qty} = ¥${amt.toFixed(2)}\n`;
        }
      }
      contents.push({ control: getControlType('details', 'Textarea'), id: fieldMapping.details, value: { text: detailText } });
    }

    // 上传PDF附件（自动查找File类型控件）
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
      creator_userid: String(config.applicant_userid),
      template_id: String(config.approval_template_id),
      use_template_approver: 1,
      apply_data: { contents },
      summary_list: [
        { summary_info: [{ text: `付款事由：${reason}`, lang: 'zh_CN' }] },
        { summary_info: [{ text: `付款金额：¥${totalAmount.toFixed(2)}`, lang: 'zh_CN' }] },
        { summary_info: [{ text: `付款方式：${paymentLabel || '转账'}`, lang: 'zh_CN' }] }
      ]
    };

    console.log('发起报销 applyData:', JSON.stringify(applyData));

    const spNo = await submitApproval(config, applyData);

    await pool.query(
      'UPDATE purchase_confirmations SET reimbursement_status = ?, reimbursement_sp_no = ?, status = ? WHERE id = ?',
      ['pending', spNo, 'reimbursing', id]
    );

    const [updatedRows] = await pool.query('SELECT * FROM purchase_confirmations WHERE id = ?', [id]);
    const updated = updatedRows[0];

    res.json({
      ...updated,
      total_amount: toNum(updated.total_amount),
      departments: typeof updated.departments === 'string' ? JSON.parse(updated.departments) : updated.departments,
      purchase_items: typeof updated.purchase_items === 'string' ? JSON.parse(updated.purchase_items) : updated.purchase_items,
    });
  } catch (err) {
    console.error('resubmit error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 手动生成PDF（可随时重新生成，自动补全缺失签名）
router.post('/:id/generate-pdf', async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.query('SELECT * FROM purchase_confirmations WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '确认单不存在' });
    }

    const row = rows[0];
    const departments = typeof row.departments === 'string' ? JSON.parse(row.departments) : row.departments;
    let signatures = typeof row.confirmed_signatures === 'string' ? JSON.parse(row.confirmed_signatures || '{}') : (row.confirmed_signatures || {});
    let userConfirmations = typeof row.user_confirmations === 'string' ? JSON.parse(row.user_confirmations || '{}') : (row.user_confirmations || {});
    let signaturesUpdated = false;

    // === 调试信息 ===
    console.log('\n=== PDF生成调试（新流程）===');
    console.log('确认单ID:', id);
    console.log('purchase_date:', row.purchase_date);
    console.log('部门数量:', departments ? departments.length : 0);
    console.log('user_confirmations keys:', Object.keys(userConfirmations));
    console.log('confirmed_signatures keys:', Object.keys(signatures));

    // 自动补全缺失签名：已确认但没有签名数据的部门，从user_signatures表查找
    // 新流程：优先从 user_confirmations 中读取用户
    for (const [userid, conf] of Object.entries(userConfirmations)) {
      if (conf && conf.confirmed && conf.confirmed_by) {
        if (!conf.signature_data) {
          // 通过确认人姓名查找签名（先查users表，再查temp_worker_users表）
          let sigRows = [];
          try {
            [sigRows] = await pool.query(
              `SELECT us.signature_data FROM user_signatures us
               JOIN users u ON us.user_id = u.id
               WHERE u.name = ? AND us.user_source = 'system'
               ORDER BY us.updated_at DESC LIMIT 1`,
              [conf.confirmed_by]
            );
            if (sigRows.length === 0) {
              [sigRows] = await pool.query(
                `SELECT us.signature_data FROM user_signatures us
                 JOIN temp_worker_users tw ON us.user_id = tw.id
                 WHERE tw.name = ? AND us.user_source = 'temp'
                 ORDER BY us.updated_at DESC LIMIT 1`,
                [conf.confirmed_by]
              );
            }
            // 也尝试从 wecom userid 查
            if (sigRows.length === 0) {
              [sigRows] = await pool.query(
                `SELECT signature_data FROM user_signatures
                 WHERE user_id = ? AND user_source = 'wecom'
                 ORDER BY updated_at DESC LIMIT 1`,
                [userid]
              );
            }
          } catch (e) {
            // 查找失败忽略
          }
          if (sigRows.length > 0 && sigRows[0].signature_data) {
            conf.signature_data = sigRows[0].signature_data;
            signaturesUpdated = true;
          }
        }
      }
    }

    // 兼容旧流程：从 departments 数组和 confirmed_signatures 中补全
    if (departments) {
      for (const dept of departments) {
        if (dept.confirmed && dept.confirmed_by) {
          const deptKey = String(dept.id);
          const existingSig = signatures[deptKey] || signatures[dept.id];
          if (!existingSig || !existingSig.data) {
            let sigRows = [];
            try {
              [sigRows] = await pool.query(
                `SELECT us.signature_data FROM user_signatures us
                 JOIN users u ON us.user_id = u.id
                 WHERE u.name = ? AND us.user_source = 'system'
                 ORDER BY us.updated_at DESC LIMIT 1`,
                [dept.confirmed_by]
              );
              if (sigRows.length === 0) {
                [sigRows] = await pool.query(
                  `SELECT us.signature_data FROM user_signatures us
                   JOIN temp_worker_users tw ON us.user_id = tw.id
                   WHERE tw.name = ? AND us.user_source = 'temp'
                   ORDER BY us.updated_at DESC LIMIT 1`,
                  [dept.confirmed_by]
                );
              }
            } catch (e) {
              // 忽略
            }
            if (sigRows.length > 0 && sigRows[0].signature_data) {
              signatures[deptKey] = {
                name: dept.confirmed_by,
                data: sigRows[0].signature_data,
                timestamp: dept.confirmed_at
              };
              signaturesUpdated = true;
            }
          }
        }
      }
    }

    // 如果补全了签名/数据，先更新数据库
    if (signaturesUpdated) {
      await pool.query(
        'UPDATE purchase_confirmations SET user_confirmations = ?, confirmed_signatures = ? WHERE id = ?',
        [JSON.stringify(userConfirmations), JSON.stringify(signatures), id]
      );
    }

    const pdfPath = await generateConfirmationPDF(id);
    const pdfUrl = `/api/purchase-confirmations/${id}/pdf`;

    await pool.query('UPDATE purchase_confirmations SET pdf_url = ? WHERE id = ?', [pdfUrl, id]);

    res.json({ success: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('PDF生成失败:', err);
    res.status(500).json({ error: err.message || 'PDF生成失败' });
  }
});

// 清除确认状态（重新签字）
router.post('/:id/reset-confirmations', async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.query('SELECT * FROM purchase_confirmations WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '确认单不存在' });
    }

    const row = rows[0];
    const departments = typeof row.departments === 'string' ? JSON.parse(row.departments) : row.departments;

    departments.forEach(d => {
      d.confirmed = false;
      d.confirmed_by = null;
      d.confirmed_at = null;
    });

    await pool.query(
      'UPDATE purchase_confirmations SET departments = ?, confirmed_signatures = ?, status = ? WHERE id = ?',
      [JSON.stringify(departments), JSON.stringify({}), 'pending', id]
    );

    res.json({ success: true, message: '已清除所有部门确认状态，可重新确认' });
  } catch (err) {
    console.error('重置确认失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 下载PDF
router.get('/:id/pdf', async (req, res) => {
  try {
    const { id } = req.params;
    const pdfPath = path.join(PDF_DIR, `${id}.pdf`);

    if (!fs.existsSync(pdfPath)) {
      // 如果PDF不存在，尝试生成
      await generateConfirmationPDF(id);
    }

    res.download(pdfPath, `采购确认单_${id}.pdf`);
  } catch (err) {
    console.error(err);
    res.status(404).json({ error: 'PDF文件不存在' });
  }
});

// 删除确认单
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.query('SELECT id FROM purchase_confirmations WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '确认单不存在' });
    }

    await pool.query('DELETE FROM purchase_confirmations WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ================================================
// 预付款采购流程接口
// ================================================

// 发起预付款审批
router.post('/:id/submit-prepay', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT * FROM purchase_confirmations WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '确认单不存在' });
    }
    const row = rows[0];

    if (row.purchase_type !== 'prepay') {
      return res.status(400).json({ error: '该确认单不是预付款类型' });
    }
    if (row.prepay_status === 'approved') {
      return res.status(400).json({ error: '预付款已审批通过' });
    }
    if (row.prepay_sp_no) {
      return res.status(400).json({ error: '预付款审批已发起，请勿重复提交' });
    }

    const config = await getWecomConfig();
    if (!config || !config.corp_id || !config.app_secret || !config.prepay_approval_template_id || !config.applicant_userid) {
      return res.status(400).json({ error: '请先在企业微信管理页面完成预付款审批配置（模板ID和申请人用户ID）' });
    }

    // 解析字段映射
    let fieldMapping = {};
    const rawMapping = config.prepay_field_mapping;
    if (rawMapping) {
      if (typeof rawMapping === 'string') {
        try { fieldMapping = JSON.parse(rawMapping); } catch (e) { fieldMapping = {}; }
      } else if (typeof rawMapping === 'object') {
        fieldMapping = rawMapping;
      }
    }

    // 获取模板控件类型
    const tokenRes = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${config.corp_id}&corpsecret=${config.app_secret}`);
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return res.status(400).json({ error: '获取企微Token失败: ' + tokenData.errmsg });
    }
    const tplRes = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/oa/gettemplatedetail?access_token=${tokenData.access_token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_id: config.prepay_approval_template_id })
    });
    const tplData = await tplRes.json();
    if (tplData.errcode !== 0) {
      return res.status(400).json({ error: '获取预付款审批模板详情失败: ' + tplData.errmsg });
    }

    const controlTypeMap = {};
    if (tplData.template_content && tplData.template_content.controls) {
      for (const ctrl of tplData.template_content.controls) {
        if (ctrl.property && ctrl.property.id && ctrl.property.control) {
          controlTypeMap[ctrl.property.id] = ctrl.property.control;
        }
      }
    }

    const prepayAmount = toNum(row.prepay_amount);
    const supplierName = row.supplier_name || '未指定供应商';
    const displayDate = row.purchase_date instanceof Date
      ? `${(row.purchase_date.getMonth() + 1).toString().padStart(2, '0')}月${row.purchase_date.getDate().toString().padStart(2, '0')}日`
      : String(row.purchase_date).substring(0, 10);

    function getControlType(fieldKey, fallback) {
      const mappedId = fieldMapping[fieldKey];
      return mappedId ? (controlTypeMap[mappedId] || fallback) : fallback;
    }

    const contents = [];

    // 供应商名称
    if (fieldMapping.supplier_name) {
      contents.push({ control: getControlType('supplier_name', 'Text'), id: fieldMapping.supplier_name, value: { text: supplierName } });
    }
    // 预付金额
    if (fieldMapping.amount) {
      contents.push({ control: getControlType('amount', 'Money'), id: fieldMapping.amount, value: { new_money: prepayAmount.toFixed(2) } });
    }
    // 采购日期
    if (fieldMapping.date) {
      let d;
      if (row.purchase_date instanceof Date) {
        d = row.purchase_date;
      } else {
        const parts = String(row.purchase_date).substring(0, 10).split('-');
        d = parts.length === 3 ? new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])) : new Date(row.purchase_date);
      }
      d.setHours(0, 0, 0, 0);
      contents.push({ control: getControlType('date', 'Date'), id: fieldMapping.date, value: { date: { type: 'day', s_timestamp: String(Math.floor(d.getTime() / 1000)) } } });
    }
    // 事由
    if (fieldMapping.reason) {
      contents.push({ control: getControlType('reason', 'Text'), id: fieldMapping.reason, value: { text: `${displayDate}预付采购款` } });
    }
    // 收款方信息（复用报销配置）
    if (fieldMapping.payee_name && config.payee_name) {
      contents.push({ control: getControlType('payee_name', 'Text'), id: fieldMapping.payee_name, value: { text: String(config.payee_name) } });
    }
    if (fieldMapping.bank_name && config.bank_name) {
      contents.push({ control: getControlType('bank_name', 'Text'), id: fieldMapping.bank_name, value: { text: String(config.bank_name) } });
    }
    if (fieldMapping.bank_account && config.bank_account) {
      contents.push({ control: getControlType('bank_account', 'Text'), id: fieldMapping.bank_account, value: { text: String(config.bank_account) } });
    }

    const applyData = {
      creator_userid: String(config.applicant_userid),
      template_id: String(config.prepay_approval_template_id),
      use_template_approver: 1,
      apply_data: { contents },
      summary_list: [
        { summary_info: [{ text: `供应商：${supplierName}`, lang: 'zh_CN' }] },
        { summary_info: [{ text: `预付金额：¥${prepayAmount.toFixed(2)}`, lang: 'zh_CN' }] },
        { summary_info: [{ text: `采购日期：${displayDate}`, lang: 'zh_CN' }] }
      ]
    };

    console.log('[预付款审批] applyData:', JSON.stringify(applyData));

    const spNo = await submitApproval(config, applyData);

    await pool.query(
      'UPDATE purchase_confirmations SET prepay_sp_no = ?, prepay_status = ? WHERE id = ?',
      [spNo, 'pending', id]
    );

    res.json({ success: true, sp_no: spNo });
  } catch (err) {
    console.error('submit-prepay error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 回填预付款付款凭证
router.post('/:id/prepay-voucher', async (req, res) => {
  try {
    const { id } = req.params;
    const { payment_voucher_no, payment_voucher_at } = req.body;

    const [rows] = await pool.query('SELECT * FROM purchase_confirmations WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '确认单不存在' });
    }
    const row = rows[0];
    if (row.purchase_type !== 'prepay') {
      return res.status(400).json({ error: '该确认单不是预付款类型' });
    }
    if (row.prepay_status !== 'approved') {
      return res.status(400).json({ error: '预付款审批尚未通过' });
    }

    await pool.query(
      'UPDATE purchase_confirmations SET payment_voucher_no = ?, payment_voucher_at = ?, prepay_status = ? WHERE id = ?',
      [payment_voucher_no || null, payment_voucher_at || null, 'prepaid', id]
    );

    // 记录预付款流水
    if (row.supplier_id) {
      await pool.query(
        `INSERT INTO prepay_records (id, supplier_id, purchase_id, amount, type, voucher_no, remark) VALUES (?, ?, ?, ?, 'prepay', ?, '预付款付款凭证回填')`,
        [uuidv4(), row.supplier_id, id, toNum(row.prepay_amount), payment_voucher_no || null]
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error('prepay-voucher error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 预付核销（收货确认后自动调用，也可手动触发）
router.post('/:id/writeoff-prepay', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT * FROM purchase_confirmations WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '确认单不存在' });
    }
    const row = rows[0];
    if (row.purchase_type !== 'prepay') {
      return res.status(400).json({ error: '该确认单不是预付款类型' });
    }
    if (row.writeoff_status === 'done') {
      return res.status(400).json({ error: '已核销完成' });
    }

    const prepayAmount = toNum(row.prepay_amount);
    const actualAmount = toNum(row.total_amount);
    const difference = actualAmount - prepayAmount;

    if (Math.abs(difference) < 0.01) {
      // 金额一致，自动核销
      await pool.query('UPDATE purchase_confirmations SET writeoff_status = ? WHERE id = ?', ['auto', id]);
      res.json({ success: true, writeoff_status: 'auto', message: '预付金额与实际金额一致，自动核销完成' });
    } else if (difference < 0) {
      // 实际 < 预付（多付），记入供应商预付余额
      const refundAmount = Math.abs(difference);
      if (row.supplier_id) {
        await pool.query('UPDATE suppliers SET prepay_balance = prepay_balance + ? WHERE id = ?', [refundAmount, row.supplier_id]);
        await pool.query(
          `INSERT INTO prepay_records (id, supplier_id, purchase_id, amount, type, remark) VALUES (?, ?, ?, ?, 'refund', '预付款多付，记入供应商余额')`,
          [uuidv4(), row.supplier_id, id, refundAmount]
        );
      }
      await pool.query('UPDATE purchase_confirmations SET writeoff_status = ? WHERE id = ?', ['manual', id]);
      res.json({ success: true, writeoff_status: 'manual', message: `实际金额比预付少¥${refundAmount.toFixed(2)}，已记入供应商预付余额` });
    } else {
      // 实际 > 预付（少付），需要生成尾款报销
      await pool.query('UPDATE purchase_confirmations SET writeoff_status = ? WHERE id = ?', ['manual', id]);
      res.json({ success: true, writeoff_status: 'manual', message: `实际金额比预付多¥${difference.toFixed(2)}，需发起尾款报销` });
    }
  } catch (err) {
    console.error('writeoff-prepay error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 刷新预付款审批状态
router.post('/:id/refresh-prepay', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT * FROM purchase_confirmations WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '确认单不存在' });
    }
    const row = rows[0];
    if (!row.prepay_sp_no) {
      return res.status(400).json({ error: '该确认单未发起预付款审批' });
    }

    const config = await getWecomConfig();
    if (!config || !config.corp_id || !config.app_secret) {
      return res.status(400).json({ error: '请先完成企业微信应用配置' });
    }

    let detail;
    try {
      detail = await getApprovalDetail(config, row.prepay_sp_no);
    } catch (detailErr) {
      return res.status(500).json({ error: `查询预付款审批状态失败：${detailErr.message}` });
    }

    const spStatus = detail.info?.sp_status;
    let newPrepayStatus = row.prepay_status;

    if (spStatus === 2) {
      newPrepayStatus = 'approved';
    } else if (spStatus === 3) {
      // 驳回 → 作废
      newPrepayStatus = 'rejected';
      await pool.query('UPDATE purchase_confirmations SET status = ? WHERE id = ? AND status = ?', ['cancelled', id, 'pending']);
    }

    await pool.query('UPDATE purchase_confirmations SET prepay_status = ? WHERE id = ?', [newPrepayStatus, id]);

    res.json({ success: true, prepay_status: newPrepayStatus, sp_status: spStatus });
  } catch (err) {
    console.error('refresh-prepay error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 更新供应商（支持新字段）
router.put('/suppliers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, contact, phone, address, settlement_method = 'normal', prepay_ratio = 0, monthly_statement_day = 1 } = req.body;

    if (!name) {
      return res.status(400).json({ error: '供应商名称不能为空' });
    }

    const [existing] = await pool.query('SELECT id FROM suppliers WHERE name = ? AND id != ?', [name, id]);
    if (existing.length > 0) {
      return res.status(400).json({ error: '该供应商名称已存在' });
    }

    await pool.query(
      'UPDATE suppliers SET name = ?, contact = ?, phone = ?, address = ?, settlement_method = ?, prepay_ratio = ?, monthly_statement_day = ? WHERE id = ?',
      [name, contact || null, phone || null, address || null, settlement_method, prepay_ratio, monthly_statement_day, id]
    );

    const [rows] = await pool.query('SELECT * FROM suppliers WHERE id = ?', [id]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
