const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../db');
const { getWecomConfig, sendWecomMessage, sendMarkdownViaWebhook, submitApproval, getApprovalDetail } = require('./wecom');

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

    if (allConfirmed) {
      const config = await getWecomConfig();
      if (config && config.corp_id && config.app_secret && config.approval_template_id && config.applicant_userid) {
        try {
          const purchaseItems = typeof row.purchase_items === 'string' ? JSON.parse(row.purchase_items) : row.purchase_items;
          const reasonTemplate = config.payment_reason_template || '{date}食材采购费用';
          const reason = reasonTemplate.replace('{date}', row.purchase_date);

          const fieldMapping = config.approval_field_mapping ? JSON.parse(config.approval_field_mapping) : {};

          const contents = [];
          if (fieldMapping.date) {
            contents.push({ control: 'Date', id: fieldMapping.date, value: row.purchase_date });
          }
          if (fieldMapping.amount) {
            contents.push({ control: 'Money', id: fieldMapping.amount, value: row.total_amount });
          }
          if (fieldMapping.reason) {
            contents.push({ control: 'Text', id: fieldMapping.reason, value: reason });
          }
          if (fieldMapping.department) {
            const deptNames = departments.map(d => d.name).join('、');
            contents.push({ control: 'Text', id: fieldMapping.department, value: deptNames });
          }
          if (fieldMapping.payee_name && config.payee_name) {
            contents.push({ control: 'Text', id: fieldMapping.payee_name, value: config.payee_name });
          }
          if (fieldMapping.bank_name && config.bank_name) {
            contents.push({ control: 'Text', id: fieldMapping.bank_name, value: config.bank_name });
          }
          if (fieldMapping.bank_account && config.bank_account) {
            contents.push({ control: 'Text', id: fieldMapping.bank_account, value: config.bank_account });
          }
          if (fieldMapping.payment_method && config.default_payment_key) {
            const paymentOptions = config.payment_options ? JSON.parse(config.payment_options) : {};
            const paymentLabel = paymentOptions[config.default_payment_key] || config.default_payment_key;
            contents.push({ control: 'Select', id: fieldMapping.payment_method, value: [paymentLabel] });
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
                detailText += `${item.ingredient_name} ${item.purchase_unit_price}/${item.purchase_unit} ×${item.purchase_quantity} = ¥${Number(item.amount).toFixed(2)}\n`;
              }
            }
            contents.push({ control: 'Textarea', id: fieldMapping.details, value: detailText });
          }

          const summary_list = [
            { text: reason, lang: 'zh_CN' },
            { text: `金额：¥${Number(row.total_amount).toFixed(2)}`, lang: 'zh_CN' }
          ];

          const applyData = {
            creator_userid: config.applicant_userid,
            template_id: config.approval_template_id,
            use_template_approver: 1,
            apply_data: { contents },
            summary_list
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

    const detail = await getApprovalDetail(config, row.reimbursement_sp_no);
    const info = detail.info || {};
    const spStatus = info.sp_status;
    const spRecord = info.sp_record || [];

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
      departments: typeof updated.departments === 'string' ? JSON.parse(updated.departments) : updated.departments,
      purchase_items: typeof updated.purchase_items === 'string' ? JSON.parse(updated.purchase_items) : updated.purchase_items,
    });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
});

// 重新发起报销
router.post('/:id/resubmit', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT * FROM purchase_confirmations WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '确认单不存在' });
    }
    const row = rows[0];

    // 更新报销状态为pending
    await pool.query(
      'UPDATE purchase_confirmations SET reimbursement_status = ? WHERE id = ?',
      ['pending', id]
    );

    // TODO: 实际调用企微审批API重新发起
    res.json({ success: true, message: '已重新发起报销' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
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
