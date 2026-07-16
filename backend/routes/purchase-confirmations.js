const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const pool = require('../db');
const { getWecomConfig, sendWecomMessage, sendMarkdownViaWebhook, submitApproval, getApprovalDetail, uploadMedia } = require('./wecom');

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
      departments: typeof row.departments === 'string' ? JSON.parse(row.departments) : row.departments,
      purchase_items: typeof row.purchase_items === 'string' ? JSON.parse(row.purchase_items) : row.purchase_items,
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
      departments: typeof row.departments === 'string' ? JSON.parse(row.departments) : row.departments,
      purchase_items: typeof row.purchase_items === 'string' ? JSON.parse(row.purchase_items) : row.purchase_items,
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
    const { purchase_date, total_amount, departments, purchase_items } = req.body;

    const id = uuidv4();
    const config = await getWecomConfig();

    // 检查配置：Webhook URL 或 API 配置至少有一个
    const hasWebhook = config && config.webhook_url;
    const hasApiConfig = config && config.corp_id && config.app_secret && config.chat_id;
    if (!hasWebhook && !hasApiConfig) {
      return res.status(400).json({ error: '请先在企业微信管理页面完成群聊配置（Webhook URL 或应用配置）' });
    }

    const displayDate = purchase_date.substring(0, 10);

    // 构建确认链接
    const baseUrl = req.headers.origin || req.protocol + '://' + req.get('host');
    const confirmUrl = `${baseUrl}/confirm/${id}`;

    // 构建 Markdown 消息内容
    const deptNames = departments.map(d => d.name).join('、');
    let mdContent = `**📋 食材采购确认通知**\n\n`;
    mdContent += `📅 **采购日期**：${displayDate}\n`;
    mdContent += `🏢 **涉及部门**：${deptNames}\n`;
    mdContent += `💰 **总金额**：¥${Number(total_amount).toFixed(2)}\n\n`;
    mdContent += `---\n\n`;

    // 按部门分组显示明细
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
    mdContent += `👉 **[点击此处进入确认页面](${confirmUrl})**\n`;
    mdContent += `> 各部门负责人请进入确认页面，核对清单并手写签名确认。`;

    // 保存确认单（先保存，发送失败可以删除，或者让用户重试）
    await connection.query(
      `INSERT INTO purchase_confirmations (id, purchase_date, total_amount, departments, purchase_items, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [id, displayDate, total_amount, JSON.stringify(departments), JSON.stringify(purchase_items)]
    );

    // 发送企微消息（优先使用 Webhook）
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

    // 更新消息ID
    await connection.query(
      'UPDATE purchase_confirmations SET wecom_msg_id = ? WHERE id = ?',
      [wecomMsgId, id]
    );

    await connection.commit();

    const [rows] = await pool.query('SELECT * FROM purchase_confirmations WHERE id = ?', [id]);
    const row = rows[0];
    res.json({
      ...row,
      departments: typeof row.departments === 'string' ? JSON.parse(row.departments) : row.departments,
      purchase_items: typeof row.purchase_items === 'string' ? JSON.parse(row.purchase_items) : row.purchase_items,
    });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// 部门确认
router.post('/:id/confirm', async (req, res) => {
  try {
    const { id } = req.params;
    const { department_id, confirmed_by, signature_data } = req.body;

    const [rows] = await pool.query('SELECT * FROM purchase_confirmations WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '确认单不存在' });
    }

    const row = rows[0];
    const departments = typeof row.departments === 'string' ? JSON.parse(row.departments) : row.departments;

    const dept = departments.find(d => d.id === department_id);
    if (!dept) {
      return res.status(400).json({ error: '部门不存在于本确认单' });
    }

    dept.confirmed = true;
    dept.confirmed_by = confirmed_by;
    dept.confirmed_at = new Date().toISOString().replace('T', ' ').substring(0, 19);

    // 保存签名数据
    let signatures = typeof row.confirmed_signatures === 'string' ? JSON.parse(row.confirmed_signatures || '{}') : (row.confirmed_signatures || {});
    if (signature_data) {
      signatures[department_id] = {
        name: confirmed_by,
        data: signature_data,
        timestamp: dept.confirmed_at
      };
    }

    const allConfirmed = departments.every(d => d.confirmed);
    let newStatus = allConfirmed ? 'confirmed' : 'pending';
    let reimbursementInitiated = false;
    let reimbursementSpNo = null;
    let pdfUrl = row.pdf_url;

    if (allConfirmed) {
      // 自动生成PDF
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
            displayDate = row.purchase_date.toISOString().substring(0, 10);
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

          // 获取模板详情以确定控件实际类型
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

          const contents = [];
          if (fieldMapping.date) {
            const purchaseDate = new Date(row.purchase_date);
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
            const paymentLabel = String(paymentOptions[config.default_payment_key] || config.default_payment_key);
            contents.push({ control: getControlType('payment_method', 'Selector'), id: fieldMapping.payment_method, value: { selector: { type: 'single', options: [{ key: String(config.default_payment_key), value: [{ text: paymentLabel, lang: 'zh_CN' }] }] } } });
          } else {
            paymentLabel = '转账';
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
            creator_userid: config.applicant_userid,
            template_id: config.approval_template_id,
            use_template_approver: 1,
            apply_data: { contents },
            summary_list: [
              { text: `付款事由：${reason}`, lang: 'zh_CN' },
              { text: `付款金额：¥${Number(row.total_amount).toFixed(2)}`, lang: 'zh_CN' },
              { text: `付款方式：${paymentLabel || '转账'}`, lang: 'zh_CN' }
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

    const updateFields = ['departments = ?', 'status = ?', 'confirmed_signatures = ?'];
    const updateValues = [JSON.stringify(departments), newStatus, JSON.stringify(signatures)];

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
      departments
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
      return res.status(400).json({ error: `查询审批状态失败：${detailErr.message}。请在企业微信管理后台为应用开启"审批"权限。` });
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
      displayDate = row.purchase_date.toISOString().substring(0, 10);
    } else if (typeof row.purchase_date === 'string') {
      displayDate = row.purchase_date.substring(0, 10);
    } else {
      displayDate = String(row.purchase_date).substring(0, 10);
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
      const purchaseDate = new Date(row.purchase_date);
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
      paymentLabel = String(paymentOptions[config.default_payment_key] || config.default_payment_key);
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
        { text: `付款事由：${reason}`, lang: 'zh_CN' },
        { text: `付款金额：¥${totalAmount.toFixed(2)}`, lang: 'zh_CN' },
        { text: `付款方式：${paymentLabel || '转账'}`, lang: 'zh_CN' }
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

// 生成PDF确认单
async function generateConfirmationPDF(confirmationId) {
  const [rows] = await pool.query('SELECT * FROM purchase_confirmations WHERE id = ?', [confirmationId]);
  if (rows.length === 0) throw new Error('确认单不存在');

  const row = rows[0];
  const departments = typeof row.departments === 'string' ? JSON.parse(row.departments) : row.departments;
  const purchaseItems = typeof row.purchase_items === 'string' ? JSON.parse(row.purchase_items) : row.purchase_items;
  const signatures = typeof row.confirmed_signatures === 'string' ? JSON.parse(row.confirmed_signatures || '{}') : (row.confirmed_signatures || {});

  // 创建PDF
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const pdfPath = path.join(PDF_DIR, `${confirmationId}.pdf`);
  const writeStream = fs.createWriteStream(pdfPath);
  doc.pipe(writeStream);

  // 注册中文字体
  const chineseFont = findChineseFont();
  const chineseBoldFont = findChineseBoldFont();
  const hasChineseFont = !!chineseFont;
  if (hasChineseFont) {
    doc.registerFont('Chinese-Regular', chineseFont);
    doc.registerFont('Chinese-Bold', chineseBoldFont || chineseFont);
  }

  // 标题
  doc.fontSize(22).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold').text('食材采购确认单', { align: 'center' });
  doc.moveDown();

  // 基本信息
  doc.fontSize(12).font(hasChineseFont ? 'Chinese-Regular' : 'Helvetica');
  // 兼容不同格式的日期
  let purchaseDateStr = '';
  if (row.purchase_date instanceof Date) {
    purchaseDateStr = row.purchase_date.toISOString().substring(0, 10);
  } else if (typeof row.purchase_date === 'string') {
    purchaseDateStr = row.purchase_date.substring(0, 10);
  } else {
    purchaseDateStr = String(row.purchase_date).substring(0, 10);
  }
  doc.text(`采购日期：${purchaseDateStr}`);
  doc.text(`总金额：¥${toNum(row.total_amount).toFixed(2)}`);
  doc.text(`状态：${row.status === 'confirmed' ? '已确认' : row.status === 'completed' ? '已完成' : row.status}`);
  doc.moveDown();

  // 采购明细表格
  doc.fontSize(14).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold').text('采购明细', { underline: true });
  doc.moveDown(0.5);

  const groupedItems = {};
  for (const item of purchaseItems) {
    const deptName = item.department_name || '未分类';
    if (!groupedItems[deptName]) groupedItems[deptName] = [];
    groupedItems[deptName].push(item);
  }

  const tableTop = doc.y;
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colWidths = [pageWidth * 0.28, pageWidth * 0.22, pageWidth * 0.12, pageWidth * 0.12, pageWidth * 0.26];
  const headers = ['食材名称', '单价/单位', '数量', '单位', '金额'];
  const rowHeight = 20;

  function drawTableRow(y, cells, isHeader = false) {
    const font = isHeader ? 'Chinese-Bold' : 'Chinese-Regular';
    const helveticaFont = isHeader ? 'Helvetica-Bold' : 'Helvetica';
    doc.font(hasChineseFont ? font : helveticaFont).fontSize(isHeader ? 10 : 9);
    let x = doc.page.margins.left;
    let maxLines = 1;
    const cellTexts = [];
    for (let i = 0; i < cells.length; i++) {
      const text = String(cells[i]);
      const textOpts = { width: colWidths[i] - 6, align: i === 0 ? 'left' : (i === cells.length - 1 ? 'right' : 'center') };
      const lines = doc.heightOfString(text, textOpts);
      const lineCount = Math.ceil(lines / doc.currentLineHeight());
      if (lineCount > maxLines) maxLines = lineCount;
      cellTexts.push({ text, opts: textOpts });
    }
    const actualRowHeight = Math.max(rowHeight, maxLines * doc.currentLineHeight() + 6);
    for (let i = 0; i < cells.length; i++) {
      const align = cellTexts[i].opts.align;
      let textY = y + 3;
      if (align === 'right') {
        doc.text(cellTexts[i].text, x + 3, textY, { width: colWidths[i] - 6, align: 'right' });
      } else if (align === 'center') {
        doc.text(cellTexts[i].text, x + 3, textY, { width: colWidths[i] - 6, align: 'center' });
      } else {
        doc.text(cellTexts[i].text, x + 3, textY, { width: colWidths[i] - 6, align: 'left' });
      }
      x += colWidths[i];
    }
    return actualRowHeight;
  }

  let currentY = tableTop;
  currentY += drawTableRow(currentY, headers, true);
  doc.moveTo(doc.page.margins.left, currentY - 2).lineTo(doc.page.width - doc.page.margins.right, currentY - 2).stroke();

  doc.font(hasChineseFont ? 'Chinese-Regular' : 'Helvetica');
  let grandTotal = 0;
  for (const [deptName, items] of Object.entries(groupedItems)) {
    doc.fontSize(10).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold').text(`【${deptName}】`, doc.page.margins.left, currentY + 2);
    currentY = doc.y + 4;
    doc.font(hasChineseFont ? 'Chinese-Regular' : 'Helvetica');

    let subtotal = 0;
    for (const item of items) {
      const pageBottom = doc.page.height - doc.page.margins.bottom;
      if (currentY + rowHeight > pageBottom) {
        doc.addPage();
        currentY = doc.page.margins.top;
        currentY += drawTableRow(currentY, headers, true);
        doc.moveTo(doc.page.margins.left, currentY - 2).lineTo(doc.page.width - doc.page.margins.right, currentY - 2).stroke();
      }
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
    doc.fontSize(10).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold').text(`小计：¥${subtotal.toFixed(2)}`, doc.page.margins.left, currentY, { width: pageWidth, align: 'right' });
    currentY = doc.y + 6;
    grandTotal += subtotal;
  }
  doc.moveTo(doc.page.margins.left, currentY).lineTo(doc.page.width - doc.page.margins.right, currentY).stroke();
  doc.fontSize(12).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold').text(`总计：¥${grandTotal.toFixed(2)}`, doc.page.margins.left, currentY + 6, { width: pageWidth, align: 'right' });
  doc.y = doc.y + 20;
  doc.x = doc.page.margins.left;

  // 部门确认签名区域
  doc.fontSize(14).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold').text('部门确认签名', { underline: true });
  doc.moveDown(0.5);

  for (const dept of departments) {
    doc.fontSize(11).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold').text(`${dept.name}：`);

    if (dept.confirmed) {
      doc.font(hasChineseFont ? 'Chinese-Regular' : 'Helvetica').text(`已确认 - ${dept.confirmed_by} (${dept.confirmed_at || ''})`);

      // 如果有签名图片，添加到PDF
      const sigData = signatures[dept.id];
      if (sigData && sigData.data) {
        try {
          const base64Data = sigData.data.replace(/^data:image\/\w+;base64,/, '');
          const buffer = Buffer.from(base64Data, 'base64');
          const imgX = doc.x;
          const imgY = doc.y;
          doc.image(buffer, imgX, imgY, { width: 100, height: 40 });
          doc.moveDown(2);
        } catch (e) {
          doc.moveDown();
        }
      } else {
        doc.moveDown();
      }
    } else {
      doc.font(hasChineseFont ? 'Chinese-Regular' : 'Helvetica').text('待确认');
    }
  }

  // 生成时间
  doc.moveDown(2);
  doc.fontSize(10).font(hasChineseFont ? 'Chinese-Regular' : 'Helvetica').text(`生成时间：${new Date().toLocaleString('zh-CN')}`, { align: 'right' });

  doc.end();

  return new Promise((resolve, reject) => {
    writeStream.on('finish', () => resolve(pdfPath));
    writeStream.on('error', reject);
  });
}

// 手动生成PDF
router.post('/:id/generate-pdf', async (req, res) => {
  try {
    const { id } = req.params;

    // 先检查所有部门是否已确认
    const [rows] = await pool.query('SELECT * FROM purchase_confirmations WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '确认单不存在' });
    }
    const row = rows[0];
    const departments = typeof row.departments === 'string' ? JSON.parse(row.departments) : row.departments;
    const allConfirmed = departments.every(d => d.confirmed);
    if (!allConfirmed) {
      return res.status(400).json({ error: '请等待所有部门确认完成后再生成PDF' });
    }

    const pdfPath = await generateConfirmationPDF(id);
    const pdfUrl = `/api/purchase-confirmations/${id}/pdf`;

    // 更新数据库
    await pool.query('UPDATE purchase_confirmations SET pdf_url = ? WHERE id = ?', [pdfUrl, id]);

    res.json({ success: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('PDF生成失败:', err);
    res.status(500).json({ error: err.message || 'PDF生成失败' });
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

module.exports = router;
