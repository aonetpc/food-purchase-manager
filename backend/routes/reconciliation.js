// ================================================
// 供应商对账中心路由
// 1. 月结账单：生成（按供应商+月份汇总月结采购单）、对账、审批、付款
// 2. 预付核销：查询差异采购单、手动核销尾款报销
// ================================================
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const pool = require('../db');
const { requireAuth } = require('../middleware/rbac');
const {
  getWecomConfig,
  submitApproval,
  getApprovalDetail,
  uploadMedia,
} = require('./wecom');

// ================================================
// 工具函数
// ================================================
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

function parseJson(v) {
  if (!v) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch (e) { return null; }
}

// ================================================
// 月结账单 CRUD
// ================================================

// 查询月结账单列表（支持按供应商/月份/状态过滤）
router.get('/', requireAuth, async (req, res) => {
  try {
    const { supplier_id, statement_month, status, purchase_type = 'monthly' } = req.query;
    const conditions = [];
    const params = [];
    conditions.push('purchase_type = ?');
    params.push(purchase_type);
    if (supplier_id) { conditions.push('supplier_id = ?'); params.push(supplier_id); }
    if (statement_month) { conditions.push('statement_month = ?'); params.push(statement_month); }
    if (status) { conditions.push('status = ?'); params.push(status); }

    const sql = `SELECT * FROM monthly_statements${conditions.length ? ' WHERE ' + conditions.join(' AND ') : ''} ORDER BY created_at DESC`;
    const [rows] = await pool.query(sql, params);

    res.json(rows.map(r => ({
      ...r,
      total_amount: toNum(r.total_amount),
      confirmed_amount: toNum(r.confirmed_amount),
      difference_amount: toNum(r.difference_amount),
      purchase_ids: parseJson(r.purchase_ids),
    })));
  } catch (err) {
    console.error('[monthly statements list]', err);
    res.status(500).json({ error: err.message });
  }
});

// 查询单个月结账单详情（含关联采购单）
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT * FROM monthly_statements WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ error: '月结账单不存在' });
    const stmt = rows[0];
    stmt.total_amount = toNum(stmt.total_amount);
    stmt.confirmed_amount = toNum(stmt.confirmed_amount);
    stmt.difference_amount = toNum(stmt.difference_amount);
    stmt.purchase_ids = parseJson(stmt.purchase_ids) || [];

    // 查询关联采购单
    let purchases = [];
    if (stmt.purchase_ids && stmt.purchase_ids.length > 0) {
      const q = `SELECT * FROM warehouse_purchases WHERE id IN (${stmt.purchase_ids.map(() => '?').join(',')})`;
      const [pRows] = await pool.query(q, stmt.purchase_ids);
      purchases = pRows.map(p => ({
        ...p,
        total_amount: toNum(p.total_amount),
        prepay_amount: toNum(p.prepay_amount),
      }));
    }

    res.json({ ...stmt, purchases });
  } catch (err) {
    console.error('[monthly statement detail]', err);
    res.status(500).json({ error: err.message });
  }
});

// 生成月结账单（按指定月份、指定或不指定供应商）
router.post('/generate', requireAuth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { statement_month, supplier_id } = req.body;
    if (!statement_month || !/^\d{4}-\d{2}$/.test(statement_month)) {
      return res.status(400).json({ error: '月份格式错误，应为 YYYY-MM' });
    }

    // 查询范围内已确认且未关联网结账单的月结采购单（跨月按入库日期 = confirmed_at）
    let sql = `
      SELECT id, supplier_id, supplier_name, total_amount, confirmed_at
      FROM warehouse_purchases
      WHERE purchase_type = 'monthly'
        AND status = 'confirmed'
        AND monthly_statement_id IS NULL
        AND DATE_FORMAT(confirmed_at, '%Y-%m') = ?
    `;
    const params = [statement_month];
    if (supplier_id) { sql += ' AND supplier_id = ?'; params.push(supplier_id); }

    const [rows] = await conn.query(sql, params);
    if (rows.length === 0) {
      await conn.rollback();
      return res.status(400).json({ error: '该月份没有需要入账的月结采购单' });
    }

    // 按供应商分组
    const supplierGroup = {};
    for (const row of rows) {
      const sid = row.supplier_id;
      if (!sid) continue;
      if (!supplierGroup[sid]) {
        supplierGroup[sid] = { supplier_name: row.supplier_name || '未命名', items: [], total: 0 };
      }
      supplierGroup[sid].items.push(row);
      supplierGroup[sid].total += toNum(row.total_amount);
    }

    if (Object.keys(supplierGroup).length === 0) {
      await conn.rollback();
      return res.status(400).json({ error: '采购单缺少供应商信息，无法生成月结账单' });
    }

    const result = [];
    for (const [sid, group] of Object.entries(supplierGroup)) {
      const stmtId = uuidv4();
      const purchaseIds = group.items.map(i => i.id);
      await conn.query(
        `INSERT INTO monthly_statements (id, supplier_id, supplier_name, statement_month, total_amount, confirmed_amount, difference_amount, status, purchase_ids, purchase_type)
         VALUES (?, ?, ?, ?, ?, ?, 0, 'pending', ?, 'monthly')`,
        [stmtId, sid, group.supplier_name, statement_month, group.total, group.total, JSON.stringify(purchaseIds)]
      );
      // 关联网采购单
      await conn.query(
        `UPDATE warehouse_purchases SET monthly_statement_id = ? WHERE id IN (${purchaseIds.map(() => '?').join(',')})`,
        [stmtId, ...purchaseIds]
      );
      result.push({ id: stmtId, supplier_id: sid, supplier_name: group.supplier_name, count: purchaseIds.length, total: group.total });
    }

    await conn.commit();
    res.json({ success: true, statements: result });
  } catch (err) {
    try { await conn.rollback(); } catch (e) {}
    console.error('[generate monthly statements]', err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// 对账（财务输入供应商对账单金额 + 差异原因）
router.post('/:id/reconcile', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { confirmed_amount, difference_reason } = req.body;
    if (confirmed_amount == null) return res.status(400).json({ error: '请输入对账单金额' });
    const [rows] = await pool.query('SELECT * FROM monthly_statements WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ error: '月结账单不存在' });
    const stmt = rows[0];
    const ca = toNum(confirmed_amount);
    const diff = ca - toNum(stmt.total_amount);

    await pool.query(
      'UPDATE monthly_statements SET confirmed_amount = ?, difference_amount = ?, difference_reason = ?, status = ? WHERE id = ?',
      [ca, diff, difference_reason || null, 'confirmed', id]
    );
    res.json({ success: true, difference_amount: diff });
  } catch (err) {
    console.error('[reconcile monthly statement]', err);
    res.status(500).json({ error: err.message });
  }
});

// 发起月结付款审批
router.post('/:id/submit-payment', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT * FROM monthly_statements WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ error: '月结账单不存在' });
    const stmt = rows[0];
    if (stmt.payment_sp_no) return res.status(400).json({ error: '该月结账单已发起过付款审批' });
    if (stmt.status !== 'confirmed') return res.status(400).json({ error: '请先完成对账' });

    const config = await getWecomConfig();
    // 月结付款审批复用普通报销审批模板（或配置独立模板）
    if (!config || !config.corp_id || !config.app_secret || !config.approval_template_id || !config.applicant_userid) {
      return res.status(400).json({ error: '请先在企微管理页完成审批配置（模板ID和申请人）' });
    }

    let fieldMapping = {};
    if (config.approval_field_mapping) {
      if (typeof config.approval_field_mapping === 'string') {
        try { fieldMapping = JSON.parse(config.approval_field_mapping); } catch (e) { fieldMapping = {}; }
      } else if (typeof config.approval_field_mapping === 'object') {
        fieldMapping = config.approval_field_mapping;
      }
    }

    // 获取控件类型
    const tokenRes = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${config.corp_id}&corpsecret=${config.app_secret}`);
    const tokenData = await tokenRes.json();
    let controlTypeMap = {};
    if (tokenData.access_token) {
      const tplRes = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/oa/gettemplatedetail?access_token=${tokenData.access_token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_id: config.approval_template_id }),
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

    function getControlType(key, fallback) {
      const mappedId = fieldMapping[key];
      return mappedId ? (controlTypeMap[mappedId] || fallback) : fallback;
    }

    const amount = toNum(stmt.confirmed_amount) || toNum(stmt.total_amount);
    const reason = `${stmt.statement_month}月${stmt.supplier_name || '供应商'}月结采购款`;

    const contents = [];
    if (fieldMapping.date) {
      const [y, m] = stmt.statement_month.split('-');
      const d = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
      d.setHours(0, 0, 0, 0);
      contents.push({ control: getControlType('date', 'Date'), id: fieldMapping.date, value: { date: { type: 'day', s_timestamp: String(Math.floor(d.getTime() / 1000)) } } });
    }
    if (fieldMapping.amount) {
      contents.push({ control: getControlType('amount', 'Money'), id: fieldMapping.amount, value: { new_money: amount.toFixed(2) } });
    }
    if (fieldMapping.reason) {
      contents.push({ control: getControlType('reason', 'Text'), id: fieldMapping.reason, value: { text: reason } });
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
        if (typeof config.payment_options === 'string') { try { paymentOptions = JSON.parse(config.payment_options); } catch (e) {} }
        else if (typeof config.payment_options === 'object') { paymentOptions = config.payment_options; }
      }
      paymentLabel = String(paymentOptions[config.default_payment_key] || '转账');
      contents.push({ control: getControlType('payment_method', 'Selector'), id: fieldMapping.payment_method, value: { selector: { type: 'single', options: [{ key: paymentLabel, value: [{ text: paymentLabel, lang: 'zh_CN' }] }] } } });
    }
    // 汇总采购清单作为明细
    if (fieldMapping.details) {
      const purchaseIds = parseJson(stmt.purchase_ids) || [];
      const [pRows] = purchaseIds.length
        ? await pool.query(`SELECT id, purchase_no, total_amount FROM warehouse_purchases WHERE id IN (${purchaseIds.map(() => '?').join(',')})`, purchaseIds)
        : [[]];
      let detailText = `月结供应商：${stmt.supplier_name || '-'}\n账单月份：${stmt.statement_month}\n采购单数：${pRows.length}张\n合计金额：¥${amount.toFixed(2)}\n\n`;
      for (const p of pRows) {
        detailText += `${p.purchase_no || p.id.substring(0, 8)}  ¥${toNum(p.total_amount).toFixed(2)}\n`;
      }
      contents.push({ control: getControlType('details', 'Textarea'), id: fieldMapping.details, value: { text: detailText } });
    }

    const applyData = {
      creator_userid: String(config.applicant_userid),
      template_id: String(config.approval_template_id),
      use_template_approver: 1,
      apply_data: { contents },
      summary_list: [
        { summary_info: [{ text: `付款事由：${reason}`, lang: 'zh_CN' }] },
        { summary_info: [{ text: `付款金额：¥${amount.toFixed(2)}`, lang: 'zh_CN' }] },
        { summary_info: [{ text: `付款方式：${paymentLabel || '转账'}`, lang: 'zh_CN' }] },
      ],
    };

    const spNo = await submitApproval(config, applyData);
    await pool.query('UPDATE monthly_statements SET payment_sp_no = ?, status = ? WHERE id = ?', [spNo, 'approved', id]);

    res.json({ success: true, sp_no: spNo });
  } catch (err) {
    console.error('[submit payment monthly statement]', err);
    res.status(500).json({ error: err.message });
  }
});

// 刷新月结付款审批状态
router.post('/:id/refresh-payment', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT * FROM monthly_statements WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ error: '月结账单不存在' });
    const stmt = rows[0];
    if (!stmt.payment_sp_no) return res.status(400).json({ error: '未发起付款审批' });

    const config = await getWecomConfig();
    if (!config) return res.status(400).json({ error: '企微配置缺失' });
    const detail = await getApprovalDetail(config, stmt.payment_sp_no);
    const spStatus = detail.info?.sp_status;
    let newStatus = stmt.status;
    if (spStatus === 2) {
      newStatus = 'paid';
      // 付款通过，批量更新关联采购单状态为已完成
      const ids = parseJson(stmt.purchase_ids) || [];
      if (ids.length > 0) {
        const q = `UPDATE warehouse_purchases SET status = 'confirmed', reimbursement_status = 'approved' WHERE id IN (${ids.map(() => '?').join(',')})`;
        await pool.query(q, ids);
      }
    } else if (spStatus === 3) {
      newStatus = 'confirmed'; // 驳回回到已对账，可修改后重新发起
    }
    await pool.query('UPDATE monthly_statements SET status = ? WHERE id = ?', [newStatus, id]);
    res.json({ success: true, status: newStatus, sp_status: spStatus });
  } catch (err) {
    console.error('[refresh payment status]', err);
    res.status(500).json({ error: err.message });
  }
});

// 删除月结账单（仅pending状态，解除关联采购单）
router.delete('/:id', requireAuth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { id } = req.params;
    const [rows] = await conn.query('SELECT * FROM monthly_statements WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ error: '月结账单不存在' });
    const stmt = rows[0];
    if (stmt.status !== 'pending') return res.status(400).json({ error: '仅待对账状态可删除' });

    const ids = parseJson(stmt.purchase_ids) || [];
    if (ids.length > 0) {
      const q = `UPDATE warehouse_purchases SET monthly_statement_id = NULL WHERE id IN (${ids.map(() => '?').join(',')})`;
      await conn.query(q, ids);
    }
    await conn.query('DELETE FROM monthly_statements WHERE id = ?', [id]);
    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    try { await conn.rollback(); } catch (e) {}
    console.error('[delete monthly statement]', err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ================================================
// 预付核销 Tab 接口
// ================================================

// 查询预付核销列表（预付款采购单，支持 confirmed/reimbursing 等状态）
router.get('/prepay-writeoff/list', requireAuth, async (req, res) => {
  try {
    const { status } = req.query;
    // 查询 confirmed 和 reimbursing 状态的预付款订单（含历史数据修复后的订单）
    let sql = `SELECT * FROM warehouse_purchases WHERE purchase_type = 'prepay' AND status IN ('confirmed', 'reimbursing', 'completed')`;
    const params = [];
    if (status === 'pending') { sql += ' AND (writeoff_status = ? OR writeoff_status IS NULL)'; params.push('manual'); }
    else if (status) { sql += ' AND writeoff_status = ?'; params.push(status); }
    sql += ' ORDER BY confirmed_at DESC';

    const [rows] = await pool.query(sql, params);
    res.json(rows.map(r => {
      const prepaid = toNum(r.prepay_amount);
      const actual = toNum(r.actual_amount) > 0 ? toNum(r.actual_amount) : toNum(r.total_amount);
      const diff = actual - prepaid;
      return {
        ...r,
        total_amount: actual, // 使用实际收货金额（优先 actual_amount，兜底 total_amount）
        prepay_amount: prepaid,
        difference_amount: diff,
        refund_or_tail: diff < 0 ? `多付：¥${Math.abs(diff).toFixed(2)}（已计入余额）` : diff > 0 ? `少付：¥${diff.toFixed(2)}（待尾款报销）` : '完全一致',
      };
    }));
  } catch (err) {
    console.error('[prepay writeoff list]', err);
    res.status(500).json({ error: err.message });
  }
});

// 手动发起尾款报销（预付少付时调用）
router.post('/prepay-writeoff/:id/submit-tail', requireAuth, async (req, res) => {
  try {
    // 直接跳转到仓库采购 resubmit 接口发起报销
    const { id } = req.params;
    res.redirect(307, `/api/warehouse-purchases/${id}/resubmit`);
  } catch (err) {
    console.error('[submit tail prepay]', err);
    res.status(500).json({ error: err.message });
  }
});

// 统计仪表盘（对账中心首页概览）
router.get('/stats/overview', requireAuth, async (req, res) => {
  try {
    const now = new Date();
    const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // 月结统计
    const [stmtRows] = await pool.query(
      `SELECT status, COUNT(*) cnt, IFNULL(SUM(total_amount),0) amt FROM monthly_statements WHERE purchase_type = 'monthly' GROUP BY status`
    );
    const statementStats = { pending: 0, confirmed: 0, approved: 0, paid: 0, total_amount: 0 };
    for (const r of stmtRows) {
      if (statementStats[r.status] != null) statementStats[r.status] = r.cnt;
      statementStats.total_amount += toNum(r.amt);
    }

    // 待月结采购单数量和金额
    const [pendMonth] = await pool.query(
      `SELECT COUNT(*) cnt, IFNULL(SUM(total_amount),0) amt FROM warehouse_purchases WHERE purchase_type='monthly' AND status='confirmed' AND monthly_statement_id IS NULL`
    );
    const pendingMonthly = { count: pendMonth[0].cnt, amount: toNum(pendMonth[0].amt) };

    // 待人工核销预付款采购单（含未核销 NULL 及少付待尾款 manual，支持 confirmed/reimbursing 状态）
    const [pendPrepay] = await pool.query(
      `SELECT COUNT(*) cnt, IFNULL(SUM(CASE WHEN actual_amount > 0 THEN actual_amount ELSE total_amount END),0) amt FROM warehouse_purchases WHERE purchase_type='prepay' AND status IN ('confirmed', 'reimbursing') AND (writeoff_status='manual' OR writeoff_status IS NULL)`
    );
    const pendingPrepayWriteoff = { count: pendPrepay[0].cnt, amount: toNum(pendPrepay[0].amt) };

    res.json({
      current_month: curMonth,
      statement_stats: statementStats,
      pending_monthly: pendingMonthly,
      pending_prepay_writeoff: pendingPrepayWriteoff,
    });
  } catch (err) {
    console.error('[overview stats]', err);
    res.status(500).json({ error: err.message });
  }
});

// ================================================
// 月结采购直接付款接口（不走月结账单流程，手动选择采购单批量付款）
// ================================================

// 获取有待月结采购单的供应商列表
router.get('/monthly/pending-suppliers', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT supplier_id, supplier_name,
             COUNT(*) as purchase_count,
             IFNULL(SUM(total_amount), 0) as total_amount
      FROM warehouse_purchases
      WHERE purchase_type = 'monthly'
        AND status = 'confirmed'
        AND monthly_pending = 1
        AND monthly_statement_id IS NULL
      GROUP BY supplier_id, supplier_name
      ORDER BY supplier_name
    `);
    res.json(rows.map(r => ({
      supplier_id: r.supplier_id,
      supplier_name: r.supplier_name || '未命名',
      purchase_count: r.purchase_count,
      total_amount: toNum(r.total_amount),
    })));
  } catch (err) {
    console.error('[pending suppliers]', err);
    res.status(500).json({ error: err.message });
  }
});

// 获取某供应商下所有待月结采购单
router.get('/monthly/supplier/:id/pending', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(`
      SELECT id, purchase_no, purchase_date, supplier_name, total_amount,
             actual_amount, confirmed_at, approval_sp_no, pdf_url
      FROM warehouse_purchases
      WHERE supplier_id = ?
        AND purchase_type = 'monthly'
        AND status = 'confirmed'
        AND monthly_pending = 1
        AND monthly_statement_id IS NULL
      ORDER BY confirmed_at DESC
    `, [id]);
    res.json(rows.map(r => ({
      ...r,
      total_amount: toNum(r.total_amount),
      actual_amount: toNum(r.actual_amount),
    })));
  } catch (err) {
    console.error('[supplier pending purchases]', err);
    res.status(500).json({ error: err.message });
  }
});

// 批量发起月结付款审批
router.post('/monthly/payment/submit', requireAuth, async (req, res) => {
  try {
    const { purchase_ids, attachments: rawAttachments = [], reason: customReason, remark: customRemark } = req.body;
    if (!Array.isArray(purchase_ids) || purchase_ids.length === 0) {
      return res.status(400).json({ error: '请至少选择一张采购单' });
    }

    // 查询选中的采购单
    const placeholders = purchase_ids.map(() => '?').join(',');
    const [purchases] = await pool.query(
      `SELECT id, purchase_no, supplier_id, supplier_name, total_amount, actual_amount, approval_sp_no, confirmed_at
       FROM warehouse_purchases
       WHERE id IN (${placeholders})
         AND purchase_type = 'monthly'
         AND status = 'confirmed'
         AND monthly_pending = 1`,
      purchase_ids
    );

    if (purchases.length === 0) {
      return res.status(400).json({ error: '选中的采购单不可付款（可能已被处理）' });
    }

    // 校验同一供应商
    const supplierIds = [...new Set(purchases.map(p => p.supplier_id))];
    if (supplierIds.length > 1) {
      return res.status(400).json({ error: '只能选择同一供应商的采购单进行付款' });
    }

    const supplierName = purchases[0].supplier_name || '供应商';
    const totalAmount = purchases.reduce((sum, p) => sum + toNum(p.total_amount), 0);
    const purchaseNos = purchases.map(p => p.purchase_no || p.id.substring(0, 8));

    // 付款事由和备注
    const reason = customReason || `月结采购付款-${supplierName}（${purchases.length}张，合计¥${totalAmount.toFixed(2)}）`;
    const remark = customRemark || `供应商：${supplierName}\n采购单号：${purchaseNos.join('、')}\n本月结账共${purchases.length}张，合计¥${totalAmount.toFixed(2)}`;

    // 获取企微配置
    const config = await getWecomConfig();
    if (!config || !config.corp_id || !config.app_secret || !config.approval_template_id || !config.applicant_userid) {
      return res.status(400).json({ error: '请先在企微管理页完成审批配置（模板ID和申请人）' });
    }

    // 解析字段映射
    let fieldMapping = {};
    if (config.approval_field_mapping) {
      fieldMapping = typeof config.approval_field_mapping === 'string'
        ? (JSON.parse(config.approval_field_mapping) || {})
        : config.approval_field_mapping;
    }

    // 获取模板控件类型
    const tokenRes = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${config.corp_id}&corpsecret=${config.app_secret}`);
    const tokenData = await tokenRes.json();
    let controlTypeMap = {};
    if (tokenData.access_token) {
      const tplRes = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/oa/gettemplatedetail?access_token=${tokenData.access_token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_id: config.approval_template_id }),
      });
      const tplData = await tplRes.json();
      if (tplData.errcode === 0 && tplData.template_content?.controls) {
        for (const ctrl of tplData.template_content.controls) {
          if (ctrl.property?.id && ctrl.property?.control) {
            controlTypeMap[ctrl.property.id] = ctrl.property.control;
          }
        }
      }
    }

    function getControlType(key, fallback) {
      const mappedId = fieldMapping[key];
      return mappedId ? (controlTypeMap[mappedId] || fallback) : fallback;
    }

    // 处理附件上传
    const uploadedAttachments = [];
    if (Array.isArray(rawAttachments) && rawAttachments.length > 0) {
      const attachDir = path.join(__dirname, '..', 'uploads', 'monthly_payment_attachments');
      if (!fs.existsSync(attachDir)) fs.mkdirSync(attachDir, { recursive: true });
      for (let i = 0; i < rawAttachments.length; i++) {
        const att = rawAttachments[i];
        if (!att.filename || !att.base64) continue;
        try {
          const fileBuffer = Buffer.from(att.base64, 'base64');
          const safeFilename = String(att.filename).replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]/g, '_');
          const savePath = path.join(attachDir, `${Date.now()}_${i}_${safeFilename}`);
          fs.writeFileSync(savePath, fileBuffer);
          const mediaId = await uploadMedia(config, savePath, safeFilename);
          uploadedAttachments.push({ filename: safeFilename, mediaId });
        } catch (attErr) {
          console.error('[月结付款] 附件上传失败:', att.filename, attErr.message);
        }
      }
    }

    // 构建审批数据
    const contents = [];
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const todayTimestamp = Math.floor(new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() / 1000);

    if (fieldMapping.date) {
      contents.push({ control: getControlType('date', 'Date'), id: fieldMapping.date, value: { date: { type: 'day', s_timestamp: String(todayTimestamp) } } });
    }
    if (fieldMapping.amount) {
      contents.push({ control: getControlType('amount', 'Money'), id: fieldMapping.amount, value: { new_money: totalAmount.toFixed(2) } });
    }
    if (fieldMapping.reason) {
      contents.push({ control: getControlType('reason', 'Text'), id: fieldMapping.reason, value: { text: reason } });
    }
    // 收款人 = 供应商名称
    if (fieldMapping.payee_name) {
      contents.push({ control: getControlType('payee_name', 'Text'), id: fieldMapping.payee_name, value: { text: supplierName } });
    }
    if (fieldMapping.bank_name && config.bank_name) {
      contents.push({ control: getControlType('bank_name', 'Text'), id: fieldMapping.bank_name, value: { text: String(config.bank_name) } });
    }
    if (fieldMapping.bank_account && config.bank_account) {
      contents.push({ control: getControlType('bank_account', 'Text'), id: fieldMapping.bank_account, value: { text: String(config.bank_account) } });
    }
    // 付款方式
    let paymentLabel = '转账';
    if (fieldMapping.payment_method && config.default_payment_key) {
      let paymentOptions = {};
      if (config.payment_options) {
        paymentOptions = typeof config.payment_options === 'string'
          ? (JSON.parse(config.payment_options) || {})
          : config.payment_options;
      }
      paymentLabel = String(paymentOptions[config.default_payment_key] || '转账');
      contents.push({
        control: getControlType('payment_method', 'Selector'),
        id: fieldMapping.payment_method,
        value: { selector: { type: 'single', options: [{ key: paymentLabel, value: [{ text: paymentLabel, lang: 'zh_CN' }] }] } },
      });
    }
    // 明细
    if (fieldMapping.details) {
      let detailText = `月结供应商：${supplierName}\n采购单数：${purchases.length}张\n合计金额：¥${totalAmount.toFixed(2)}\n\n`;
      for (const p of purchases) {
        detailText += `${p.purchase_no || p.id.substring(0, 8)}  ¥${toNum(p.total_amount).toFixed(2)}\n`;
      }
      contents.push({ control: getControlType('details', 'Textarea'), id: fieldMapping.details, value: { text: detailText } });
    }
    // 备注说明
    if (fieldMapping.remark) {
      contents.push({ control: getControlType('remark', 'Text'), id: fieldMapping.remark, value: { text: remark } });
    } else {
      // 自动发现备注控件
      const remarkEntry = Object.entries(controlTypeMap).find(([, ctype]) => ctype === 'Text' || ctype === 'Textarea');
      if (remarkEntry) {
        contents.push({ control: remarkEntry[1], id: remarkEntry[0], value: { text: remark } });
      }
    }
    // 附件
    if (fieldMapping.attachment && uploadedAttachments.length > 0) {
      contents.push({
        control: getControlType('attachment', 'File'),
        id: fieldMapping.attachment,
        value: { files: uploadedAttachments.map(a => ({ file_id: a.mediaId })) },
      });
    }

    // 关联审批单（多个采购审批单号）
    const spNos = purchases.map(p => p.approval_sp_no).filter(Boolean);
    if (spNos.length > 0) {
      let relatedControlId = fieldMapping.related_approval || null;
      if (!relatedControlId) {
        const relatedEntry = Object.entries(controlTypeMap).find(([, ctype]) => ctype === 'RelatedApproval');
        if (relatedEntry) relatedControlId = relatedEntry[0];
      }
      if (relatedControlId) {
        const relatedItems = [];
        for (const spNo of spNos) {
          try {
            const detail = await getApprovalDetail(config, String(spNo));
            relatedItems.push({
              sp_no: String(detail?.sp_no || spNo),
              sp_name: detail?.sp_name || '仓库采购申请',
              template_id: detail?.template_id || '',
            });
          } catch {
            relatedItems.push({ sp_no: String(spNo), sp_name: '仓库采购申请', template_id: '' });
          }
        }
        contents.push({
          control: 'RelatedApproval',
          id: relatedControlId,
          value: { related_approval: relatedItems },
        });
      }
    }

    const applyData = {
      creator_userid: String(config.applicant_userid),
      template_id: String(config.approval_template_id),
      use_template_approver: 1,
      apply_data: { contents },
      summary_list: [
        { summary_info: [{ text: `付款事由：${reason}`, lang: 'zh_CN' }] },
        { summary_info: [{ text: `付款金额：¥${totalAmount.toFixed(2)}`, lang: 'zh_CN' }] },
        { summary_info: [{ text: `收款人：${supplierName}`, lang: 'zh_CN' }] },
      ],
    };

    const spNo = await submitApproval(config, applyData);

    // 更新所有选中采购单状态
    await pool.query(
      `UPDATE warehouse_purchases SET monthly_pending = 0, monthly_payment_sp_no = ? WHERE id IN (${placeholders})`,
      [spNo, ...purchase_ids]
    );

    res.json({ success: true, sp_no: spNo, total_amount: totalAmount, purchase_count: purchases.length });
  } catch (err) {
    console.error('[monthly payment submit]', err);
    res.status(500).json({ error: err.message });
  }
});

// 刷新月结付款审批状态
router.post('/monthly/payment/refresh', requireAuth, async (req, res) => {
  try {
    const { sp_no } = req.body;
    if (!sp_no) return res.status(400).json({ error: '缺少审批单号 sp_no' });

    const config = await getWecomConfig();
    if (!config) return res.status(400).json({ error: '企微配置缺失' });

    const detail = await getApprovalDetail(config, sp_no);
    const spStatus = detail.info?.sp_status;

    if (spStatus === 2) {
      // 付款通过
      await pool.query(
        'UPDATE warehouse_purchases SET monthly_paid_at = NOW() WHERE monthly_payment_sp_no = ?',
        [sp_no]
      );
    }

    res.json({ success: true, sp_status: spStatus });
  } catch (err) {
    console.error('[monthly payment refresh]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
