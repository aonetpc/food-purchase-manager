const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../db');

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
  try {
    const { purchase_date, total_amount, departments, purchase_items } = req.body;

    const id = uuidv4();
    const [configRows] = await pool.query('SELECT * FROM wecom_config WHERE id = 1');

    let wecomMsgId = null;

    if (configRows.length > 0 && configRows[0].corp_id && configRows[0].app_secret && configRows[0].chat_id) {
      const config = configRows[0];

      // 构建消息内容
      const deptNames = departments.map(d => d.name).join('、');
      let content = `📋 采购确认通知\n\n📅 日期：${purchase_date}\n🏢 涉及部门：${deptNames}\n💰 总金额：¥${total_amount.toFixed(2)}\n`;

      // 按部门分组显示明细
      const groupedItems = {};
      for (const item of purchase_items) {
        const deptName = item.department_name || '未分类';
        if (!groupedItems[deptName]) groupedItems[deptName] = [];
        groupedItems[deptName].push(item);
      }

      for (const [deptName, items] of Object.entries(groupedItems)) {
        content += `\n【${deptName}】\n`;
        let subtotal = 0;
        for (const item of items) {
          content += `  ${item.ingredient_name}  ${item.purchase_unit_price.toFixed(2)}/${item.purchase_unit} ×${item.purchase_quantity}${item.purchase_unit} = ¥${item.amount.toFixed(2)}\n`;
          subtotal += item.amount;
        }
        content += `  小计：¥${subtotal.toFixed(2)}\n`;
      }

      // 构建确认链接
      const baseUrl = req.headers.origin || req.protocol + '://' + req.get('host');
      const confirmUrl = `${baseUrl}/confirm/${id}`;
      content += `\n请各部门点击确认采购入库\n🔗 ${confirmUrl}`;

      // 获取 access_token
      const tokenRes = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${config.corp_id}&corpsecret=${config.app_secret}`);
      const tokenData = await tokenRes.json();

      if (tokenData.errcode === 0) {
        // 发送消息到内部群
        const msgRes = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/appchat/send?access_token=${tokenData.access_token}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chatid: config.chat_id,
            msgtype: 'text',
            text: { content },
            safe: 0
          })
        });
        const msgData = await msgRes.json();
        if (msgData.errcode === 0) {
          wecomMsgId = msgData.msgid || 'sent';
        }
      }
    }

    // 保存确认单
    await pool.query(
      `INSERT INTO purchase_confirmations (id, purchase_date, total_amount, departments, purchase_items, status, wecom_msg_id)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      [id, purchase_date, total_amount, JSON.stringify(departments), JSON.stringify(purchase_items), wecomMsgId]
    );

    const [rows] = await pool.query('SELECT * FROM purchase_confirmations WHERE id = ?', [id]);
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

// 部门确认
router.post('/:id/confirm', async (req, res) => {
  try {
    const { id } = req.params;
    const { department_id, confirmed_by } = req.body;

    const [rows] = await pool.query('SELECT * FROM purchase_confirmations WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '确认单不存在' });
    }

    const row = rows[0];
    const departments = typeof row.departments === 'string' ? JSON.parse(row.departments) : row.departments;

    // 更新对应部门的确认状态
    const dept = departments.find(d => d.id === department_id);
    if (!dept) {
      return res.status(400).json({ error: '部门不存在于本确认单' });
    }

    dept.confirmed = true;
    dept.confirmed_by = confirmed_by;
    dept.confirmed_at = new Date().toISOString().replace('T', ' ').substring(0, 19);

    // 检查是否所有部门都已确认
    const allConfirmed = departments.every(d => d.confirmed);

    let newStatus = allConfirmed ? 'confirmed' : 'pending';
    let reimbursementResult = null;

    // 如果全部确认，自动发起报销
    if (allConfirmed) {
      const [configRows] = await pool.query('SELECT * FROM wecom_config WHERE id = 1');
      if (configRows.length > 0 && configRows[0].corp_id && configRows[0].app_secret && configRows[0].approval_template_id) {
        const config = configRows[0];

        // 获取 access_token
        const tokenRes = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${config.corp_id}&corpsecret=${config.app_secret}`);
        const tokenData = await tokenRes.json();

        if (tokenData.errcode === 0) {
          // 构建审批表单数据
          const purchaseItems = typeof row.purchase_items === 'string' ? JSON.parse(row.purchase_items) : row.purchase_items;
          const deptNames = departments.map(d => d.name).join('、');
          const reasonTemplate = config.payment_reason_template || '{date}食材采购费用';
          const reason = reasonTemplate.replace('{date}', row.purchase_date);

          // 构建审批内容
          const applyData = {
            creator_userid: config.applicant_userid,
            template_id: config.approval_template_id,
            use_template_approver: 0,
            apply_data: {
              contents: []
            },
            summary_list: []
          };

          // 这里需要根据实际模板字段配置来填充
          // 由于模板字段ID需要从API获取，这里先用通用方式
          res.json({
            success: true,
            all_confirmed: true,
            reimbursement_initiated: false,
            message: '全部部门已确认，报销功能待配置模板字段后自动发起',
            departments
          });

          await pool.query(
            'UPDATE purchase_confirmations SET departments = ?, status = ? WHERE id = ?',
            [JSON.stringify(departments), 'confirmed', id]
          );
          return;
        }
      }
    }

    await pool.query(
      'UPDATE purchase_confirmations SET departments = ?, status = ? WHERE id = ?',
      [JSON.stringify(departments), newStatus, id]
    );

    res.json({
      success: true,
      all_confirmed: allConfirmed,
      reimbursement_initiated: false,
      departments
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
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

module.exports = router;
