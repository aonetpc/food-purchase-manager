/**
 * 月末月结盘点模块
 *
 * 接口列表：
 *   PC端（管理员/财务，requireAuth 认证）：
 *     GET    /stock-takes                    列表（按归属月+仓库分组）
 *     GET    /stock-takes/:id                详情（含明细）
 *     POST   /stock-takes                    发起盘点（拉库存生成明细）
 *     PUT    /stock-takes/:id                保存实盘（批量更新明细）
 *     DELETE /stock-takes/:id                删除（仅draft/returned）
 *     POST   /stock-takes/:id/submit         提交复核
 *     GET    /stock-takes/:id/review-init    财务复核初始化（生成随机5个抽样）
 *     POST   /stock-takes/:id/review         财务提交复核（通过→完成事务 / 退回）
 *     POST   /stock-takes/:id/notify         发送盘点通知/催办
 *     GET    /stock-takes/progress/:month    进度看板（某月各仓库盘点状态）
 *     POST   /stock-takes/:id/refresh-token  重新生成访问链接
 *     GET    /stock-takes/:id/report-pdf     导出盘点报告PDF
 *     GET    /stock-takes/trends             盘点历史趋势
 *
 *   H5端（独立token认证，P2实现）：
 *     GET    /stock-takes/h5/meta            H5页面初始化
 *     PUT    /stock-takes/h5/save            H5保存实盘
 *     POST   /stock-takes/h5/submit          H5提交复核
 *     POST   /stock-takes/h5/review          H5财务复核接口（token鉴权）
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../db');
const { requireAuth } = require('../middleware/rbac');

// ================================================
// 工具函数
// ================================================

/** 判断用户是否为管理角色（admin/finance/boss） */
async function isManagerUser(userId) {
  try {
    const [rows] = await pool.query(`
      SELECT 1 FROM (
        SELECT role_id FROM user_roles WHERE user_id = ?
        UNION
        SELECT role_id FROM users WHERE id = ? AND role_id IS NOT NULL
      ) t
      JOIN roles r ON r.id = t.role_id
      WHERE r.code IN ('admin', 'finance', 'boss')
      LIMIT 1
    `, [userId, userId]);
    return rows.length > 0;
  } catch {
    return false;
  }
}

/** 判断用户是否可以操作某仓库的盘点 */
async function canOperateWarehouse(user, warehouseId) {
  // 管理角色可以操作所有仓库
  if (await isManagerUser(user.id)) return true;
  // 仓库管理员/确认人可以操作
  const [wh] = await pool.query(
    'SELECT manager_userid, confirmer_userid FROM warehouses WHERE id = ?',
    [warehouseId]
  );
  if (wh.length === 0) return false;
  const wecomUserid = user.wecom_userid;
  if (!wecomUserid) return false;
  return wh[0].manager_userid === wecomUserid || wh[0].confirmer_userid === wecomUserid;
}

/** 判断用户是否可以复核（仅finance/admin） */
async function canReview(user) {
  try {
    const [rows] = await pool.query(`
      SELECT 1 FROM (
        SELECT role_id FROM user_roles WHERE user_id = ?
        UNION
        SELECT role_id FROM users WHERE id = ? AND role_id IS NOT NULL
      ) t
      JOIN roles r ON r.id = t.role_id
      WHERE r.code IN ('admin', 'finance')
      LIMIT 1
    `, [user.id, user.id]);
    return rows.length > 0;
  } catch {
    return false;
  }
}

/** 生成盘点单号：ST-YYYYMMDD-序号 */
async function generateTakeNo(date) {
  const d = new Date(date);
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const prefix = `ST-${ymd}-`;
  // 查当天已有序号
  const [rows] = await pool.query(
    "SELECT take_no FROM stock_takes WHERE take_no LIKE ? ORDER BY take_no DESC LIMIT 1",
    [`${prefix}%`]
  );
  let seq = 1;
  if (rows.length > 0) {
    const lastSeq = parseInt(rows[0].take_no.slice(prefix.length), 10);
    if (!isNaN(lastSeq)) seq = lastSeq + 1;
  }
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

/** 从物资列表中随机抽取N个 */
function randomSample(arr, n) {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(n, arr.length));
}

/** 获取所有已绑定企微的财务/管理员用户 */
async function getFinanceUsers() {
  try {
    const [rows] = await pool.query(`
      SELECT u.id, u.name, u.wecom_userid
      FROM users u
      WHERE u.wecom_userid IS NOT NULL AND u.wecom_userid != '' AND EXISTS (
        SELECT 1 FROM (
          SELECT ur.role_id FROM user_roles ur WHERE ur.user_id = u.id
          UNION
          SELECT us.role_id FROM users us WHERE us.id = u.id AND us.role_id IS NOT NULL
        ) t JOIN roles r ON r.id = t.role_id
        WHERE r.code IN ('admin', 'finance')
      )
    `);
    return rows;
  } catch { return []; }
}

/** 签名同步到 user_signatures 表 */
async function syncUserSignature(userId, userSource, signatureData) {
  if (!userId || !signatureData) return;
  try {
    await pool.query(`
      INSERT INTO user_signatures (id, user_id, user_source, signature_data, updated_at)
      VALUES (?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE signature_data = VALUES(signature_data), updated_at = NOW()
    `, [uuidv4(), userId, userSource, signatureData]);
  } catch (e) { console.warn('[sync sig]', e.message); }
}

/** 发送通知并保存 response_code 的工具函数 */
async function sendStockTakeNotification(take, recipientWecomUserid, type, buttonText, h5UrlExtra) {
  const { getWecomConfig, sendTemplateCardToUser } = require('./wecom');
  const config = await getWecomConfig();
  if (!config) return { sent: false, reason: '企微未配置', response_code: null };
  const baseUrl = config.app_domain;
  let h5Url;
  if (h5UrlExtra?.role === 'reviewer') {
    h5Url = `${baseUrl}/stock-take-operate?r_token=${h5UrlExtra.token}`;
  } else {
    h5Url = `${baseUrl}/stock-take-operate?token=${h5UrlExtra?.token || take.access_token}`;
  }
  const taskId = `stocktake_${take.id}_${recipientWecomUserid}_${type}_${Date.now()}`;
  const takeTypeName = take.take_type === 'annual' ? '年度固定资产盘点' : '月末原材料盘点';
  const mainTitle = `${take.warehouse_name} - ${take.period_month}${takeTypeName}`;
  let cardDesc = '';
  if (type === 'init') cardDesc = '已创建盘点单，请尽快完成';
  else if (type === 'remind') cardDesc = '盘点催办提醒';
  else if (type === 'submitted') cardDesc = '盘点已提交，请及时复核';
  else if (type === 'returned') cardDesc = '盘点已退回，请修改后重新提交';
  else if (type === 'completed') cardDesc = '盘点已完成';
  let subText = `盘点单号：${take.take_no}\n`;
  if (type === 'init' || type === 'remind') subText += '请尽快完成盘点并提交复核';
  else if (type === 'submitted') subText += '请在手机上完成抽样核验与复核';
  else if (type === 'returned') subText += '请查看退回原因并修改';
  else if (type === 'completed') subText += '盈亏已自动调整库存';
  const cardContent = {
    card_type: 'button_interaction',
    source: { desc: '食材采购管理系统' },
    main_title: { title: mainTitle, desc: cardDesc },
    sub_title_text: subText,
    emphasis_content: { title: take.period_month, desc: '归属月份' },
    button_list: [{ text: buttonText, style: 1, type: 1, key: `go_stk_${taskId}`, url: h5Url }],
    task_id: taskId,
    card_action: { type: 1, url: h5Url },
  };
  let sent = false, reason = '', responseCode = null;
  try {
    const result = await sendTemplateCardToUser(config, recipientWecomUserid, cardContent);
    sent = true;
    responseCode = result?.response_code || null;
  } catch (e) { reason = e.message; }
  await pool.query(`
    INSERT INTO stock_take_notifications (id, stock_take_id, warehouse_id,
      recipient_wecom_userid, type, channel, send_status, fail_reason, response_code)
    VALUES (?, ?, ?, ?, ?, 'wecom_card', ?, ?, ?)
  `, [uuidv4(), take.id, take.warehouse_id, recipientWecomUserid, type,
      sent ? 'sent' : 'failed', reason || null, responseCode]);
  return { sent, reason, response_code: responseCode };
}

/** 尝试更新已发送卡片按钮状态 */
async function tryUpdateCardButton(stockTakeId, recipientWecomUserid, type, replaceText) {
  try {
    const [rows] = await pool.query(`
      SELECT response_code FROM stock_take_notifications
      WHERE stock_take_id = ? AND recipient_wecom_userid = ? AND type = ? AND response_code IS NOT NULL
      ORDER BY created_at DESC LIMIT 1
    `, [stockTakeId, recipientWecomUserid, type]);
    if (rows.length === 0) return;
    const rc = rows[0].response_code;
    const { getWecomConfig, updateTemplateCardButton } = require('./wecom');
    const config = await getWecomConfig();
    if (!config) return;
    await updateTemplateCardButton(config, recipientWecomUserid, rc, replaceText);
  } catch (e) { /* 超24小时更新失败，静默忽略 */ }
}

// ================================================
// PC端接口
// ================================================

/**
 * 进度看板：某月各需盘点仓库的状态
 * GET /stock-takes/progress/:month  (month格式: 2025-07 或 2025 年度4位)
 * query: take_type = 'monthly' (default) | 'annual'
 */
router.get('/progress/:month', requireAuth, async (req, res) => {
  try {
    const { month } = req.params; // YYYY-MM 或 YYYY（年度）
    const take_type = req.query.take_type || 'monthly';
    const isYear = /^\d{4}$/.test(month); // 4位纯数字=年度

    // 查所有需要盘点的仓库
    // 参与月末盘点开关（enable_stock_take）只控制月末原材料盘点，不影响年度固定资产盘点
    const [warehouses] = await pool.query(`
      SELECT w.id, w.name, w.type, w.manager_userid, w.confirmer_userid,
             d.name as department_name,
             w.department_id
      FROM warehouses w
      LEFT JOIN departments d ON w.department_id = d.id
      WHERE w.status = 1
        AND (? = 'monthly' AND w.enable_stock_take = 1
             OR ? = 'annual')
      ORDER BY w.sort_order ASC
    `, [take_type, take_type]);

    // 查该月/年各仓库的盘点单
    let takes;
    if (isYear) {
      // 年度筛选：LIKE 'YYYY%'
      [takes] = await pool.query(`
        SELECT id, warehouse_id, take_no, status, review_result, take_type,
               operator_name, reviewed_by_name, reviewed_at,
               created_at, period_month
        FROM stock_takes st
        WHERE st.period_month LIKE ? AND st.take_type = ?
        ORDER BY created_at DESC
      `, [`${month}%`, take_type]);
    } else {
      [takes] = await pool.query(`
        SELECT id, warehouse_id, take_no, status, review_result, take_type,
               operator_name, reviewed_by_name, reviewed_at,
               created_at, period_month
        FROM stock_takes st
        WHERE st.period_month = ? AND st.take_type = ?
        ORDER BY created_at DESC
      `, [month, take_type]);
    }

    // 组装结果
    const result = warehouses.map(wh => {
      const takesForWh = takes.filter(t => t.warehouse_id === wh.id);
      const latestTake = takesForWh[0] || null;
      let status = 'pending'; // pending=未盘点
      if (latestTake) {
        status = latestTake.status; // draft/submitted/reviewing/returned/completed
      }
      return {
        warehouse_id: wh.id,
        warehouse_name: wh.name,
        warehouse_type: wh.type,
        department_name: wh.department_name,
        manager_userid: wh.manager_userid,
        confirmer_userid: wh.confirmer_userid,
        stock_take_id: latestTake?.id || null,
        take_no: latestTake?.take_no || null,
        take_type: take_type,
        status,
        operator_name: latestTake?.operator_name || null,
        reviewed_at: latestTake?.reviewed_at || null,
        take_count: takesForWh.length,
      };
    });

    res.json(result);
  } catch (err) {
    console.error('[stock-takes progress]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 盘点单列表（按归属月+仓库分组）
 * GET /stock-takes?period_month=2025-07&warehouse_id=xxx&take_type=monthly
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const { period_month, warehouse_id, status, take_type } = req.query;
    let sql = `
      SELECT st.*,
             w.name as warehouse_name,
             w.department_id,
             d.name as department_name
      FROM stock_takes st
      JOIN warehouses w ON st.warehouse_id = w.id
      LEFT JOIN departments d ON w.department_id = d.id
      WHERE 1=1
    `;
    const params = [];
    if (period_month) { sql += ' AND st.period_month = ?'; params.push(period_month); }
    if (warehouse_id) { sql += ' AND st.warehouse_id = ?'; params.push(warehouse_id); }
    if (status) { sql += ' AND st.status = ?'; params.push(status); }
    if (take_type) { sql += ' AND st.take_type = ?'; params.push(take_type); }
    sql += ' ORDER BY st.period_month DESC, st.created_at DESC';

    const [rows] = await pool.query(sql, params);

    // 为每个盘点单附加明细统计
    const result = [];
    for (const r of rows) {
      const [stats] = await pool.query(`
        SELECT
          COUNT(*) as item_count,
          SUM(CASE WHEN actual_quantity IS NOT NULL THEN 1 ELSE 0 END) as filled_count,
          SUM(CASE WHEN difference != 0 THEN 1 ELSE 0 END) as diff_count,
          IFNULL(SUM(system_value), 0) as total_system_value,
          IFNULL(SUM(actual_value), 0) as total_actual_value,
          IFNULL(SUM(actual_value - system_value), 0) as total_diff_value
        FROM stock_take_items
        WHERE stock_take_id = ?
      `, [r.id]);

      result.push({
        ...r,
        item_count: stats[0].item_count,
        filled_count: stats[0].filled_count,
        diff_count: stats[0].diff_count,
        total_system_value: Number(stats[0].total_system_value),
        total_actual_value: Number(stats[0].total_actual_value),
        total_diff_value: Number(stats[0].total_diff_value),
      });
    }

    res.json(result);
  } catch (err) {
    console.error('[stock-takes list]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 盘点单详情（含明细）
 * GET /stock-takes/:id
 */
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const [takeRows] = await pool.query(`
      SELECT st.*, w.name as warehouse_name, w.department_id, d.name as department_name
      FROM stock_takes st
      JOIN warehouses w ON st.warehouse_id = w.id
      LEFT JOIN departments d ON w.department_id = d.id
      WHERE st.id = ?
    `, [id]);

    if (takeRows.length === 0) {
      return res.status(404).json({ error: '盘点单不存在' });
    }

    const take = takeRows[0];

    const [items] = await pool.query(`
      SELECT sti.*, wc.name as category_name
      FROM stock_take_items sti
      LEFT JOIN warehouse_items wi ON sti.item_id = wi.id
      LEFT JOIN warehouse_categories wc ON wi.category_id = wc.id
      WHERE sti.stock_take_id = ?
      ORDER BY wc.name ASC, sti.item_name ASC
    `, [id]);

    // 解析 review_sample
    let reviewSample = null;
    if (take.review_sample) {
      try {
        reviewSample = typeof take.review_sample === 'string'
          ? JSON.parse(take.review_sample)
          : take.review_sample;
      } catch { reviewSample = null; }
    }

    res.json({
      ...take,
      items,
      review_sample: reviewSample,
    });
  } catch (err) {
    console.error('[stock-takes detail]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 发起盘点
 * POST /stock-takes
 * body: { warehouse_id, period_month, remark, take_type }
 */
router.post('/', requireAuth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { warehouse_id, period_month, remark, take_type = 'monthly' } = req.body;
    if (!warehouse_id) return res.status(400).json({ error: '请选择仓库' });
    if (!period_month) return res.status(400).json({ error: '请选择归属月份' });

    // 检查仓库是否参与盘点（参与月末盘点开关 only 控制月末原材料盘点）
    const [wh] = await conn.query('SELECT * FROM warehouses WHERE id = ? AND status = 1', [warehouse_id]);
    if (wh.length === 0) return res.status(400).json({ error: '仓库不存在' });
    if (take_type === 'monthly' && !wh[0].enable_stock_take) {
      return res.status(400).json({ error: '该仓库未开启月末盘点' });
    }

    // 检查该仓库该月是否已有未完成的盘点
    const [existing] = await conn.query(
      "SELECT id FROM stock_takes WHERE warehouse_id = ? AND period_month = ? AND take_type = ? AND status NOT IN ('completed', 'cancelled')",
      [warehouse_id, period_month, take_type]
    );
    if (existing.length > 0) {
      return res.status(400).json({ error: '该仓库当月已有未完成的盘点单', stock_take_id: existing[0].id });
    }

    await conn.beginTransaction();

    const id = uuidv4();
    const takeNo = await generateTakeNo(new Date());
    const accessToken = uuidv4();
    const expiredAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7天过期

    await conn.query(`
      INSERT INTO stock_takes (id, take_no, warehouse_id, warehouse_name, period_month, status, remark,
                               take_type, access_token, access_expired_at, total_value, cost_summary,
                               created_by, created_by_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, 0, NULL, ?, ?, NOW(), NOW())
    `, [id, takeNo, warehouse_id, wh[0].name, period_month, remark || null,
        take_type, accessToken, expiredAt,
        req.user.id, req.user.name || req.user.username]);

    // 拉取该仓库库存>0且非即买即用的物资生成明细（按 take_type 过滤分类）
    const [invItems] = await conn.query(`
      SELECT i.item_id, i.quantity, i.unit,
             wi.name, wi.spec, wi.reference_price,
             wc.name as category_name,
             wc_l1.name as category_l1_name
      FROM inventory i
      JOIN warehouse_items wi ON i.item_id = wi.id
      LEFT JOIN warehouse_categories wc ON wi.category_id = wc.id
      LEFT JOIN warehouse_categories wc_l1 ON
        CASE WHEN wc.parent_id IS NOT NULL THEN wc.parent_id ELSE wc.id END = wc_l1.id
      WHERE i.warehouse_id = ? AND i.quantity > 0 AND wi.status = 1
        AND (wi.instant_use = 0 OR wi.instant_use IS NULL)
        AND (? = 'annual' AND wc_l1.name = '固定资产'
             OR ? = 'monthly' AND (wc_l1.name = '原材料' OR wc_l1.name IS NULL OR wc_l1.name != '固定资产'))
      ORDER BY wc.name ASC, wi.name ASC
    `, [warehouse_id, take_type, take_type]);

    for (const item of invItems) {
      const itemId = uuidv4();
      const systemQty = Number(item.quantity);
      const unitPrice = Number(item.reference_price) || 0;
      const systemValue = systemQty * unitPrice;
      await conn.query(`
        INSERT INTO stock_take_items (id, stock_take_id, item_id, item_name, category_name, category_l1_name, spec, unit,
                                      system_quantity, actual_quantity, difference, unit_price,
                                      system_value, actual_value, is_sampled, remark)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, 0, 0, NULL)
      `, [itemId, id, item.item_id, item.name, item.category_name || null, item.category_l1_name || null,
          item.spec || null, item.unit, systemQty, unitPrice, systemValue]);
    }

    await conn.commit();

    // 自动发送企微通知给仓库管理员/确认人（使用 sendStockTakeNotification）
    const recipientId = wh[0].manager_userid || wh[0].confirmer_userid;
    let notifyResult = { sent: false, recipient: recipientId, reason: '' };
    if (recipientId) {
      // 先构造一个 take 对象用于通知
      const takeForNotify = {
        id,
        take_no: takeNo,
        warehouse_id,
        warehouse_name: wh[0].name,
        period_month,
        take_type,
        access_token: accessToken,
      };
      const result = await sendStockTakeNotification(takeForNotify, recipientId, 'init', '开始盘点', { token: accessToken });
      notifyResult = { sent: result.sent, recipient: recipientId, reason: result.reason || '' };
      if (result.sent) {
        await pool.query('UPDATE stock_takes SET notification_sent_at = NOW() WHERE id = ?', [id]);
      }
    } else {
      notifyResult.reason = '仓库未设置管理员/确认人';
    }

    // 返回详情
    const [takeRows] = await pool.query('SELECT * FROM stock_takes WHERE id = ?', [id]);
    const [items] = await pool.query('SELECT * FROM stock_take_items WHERE stock_take_id = ? ORDER BY category_name, item_name', [id]);

    res.json({
      ...takeRows[0],
      items,
      message: `盘点单已创建，共${invItems.length}项物资`,
      notification: notifyResult,
    });
  } catch (err) {
    await conn.rollback();
    console.error('[stock-takes create]', err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

/**
 * 保存实盘（批量更新明细）
 * PUT /stock-takes/:id
 * body: { items: [{ id, actual_quantity, remark }] }
 */
router.put('/:id', requireAuth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;
    const { items } = req.body;

    const [takeRows] = await conn.query('SELECT * FROM stock_takes WHERE id = ?', [id]);
    if (takeRows.length === 0) {
      conn.release();
      return res.status(404).json({ error: '盘点单不存在' });
    }
    const take = takeRows[0];
    if (!['draft', 'returned'].includes(take.status)) {
      conn.release();
      return res.status(400).json({ error: `当前状态(${take.status})不可编辑` });
    }

    // 权限检查
    if (!await canOperateWarehouse(req.user, take.warehouse_id)) {
      conn.release();
      return res.status(403).json({ error: '无权操作此仓库的盘点' });
    }

    await conn.beginTransaction();

    if (Array.isArray(items)) {
      for (const it of items) {
        const actualQty = it.actual_quantity !== null && it.actual_quantity !== undefined && it.actual_quantity !== ''
          ? Number(it.actual_quantity) : null;
        const diff = actualQty !== null ? actualQty - Number(it.system_quantity) : 0;
        const actualValue = actualQty !== null ? actualQty * Number(it.unit_price) : 0;
        await conn.query(`
          UPDATE stock_take_items
          SET actual_quantity = ?, difference = ?, actual_value = ?, remark = ?
          WHERE id = ? AND stock_take_id = ?
        `, [actualQty, diff, actualValue, it.remark || null, it.id, id]);
      }
    }

    // 更新盘点单总价值
    const [stats] = await conn.query(`
      SELECT IFNULL(SUM(actual_value), 0) as total_actual,
             IFNULL(SUM(system_value), 0) as total_system
      FROM stock_take_items WHERE stock_take_id = ?
    `, [id]);
    await conn.query('UPDATE stock_takes SET total_value = ?, updated_at = NOW() WHERE id = ?',
      [Number(stats[0].total_actual), id]);

    await conn.commit();
    res.json({ success: true, message: '保存成功' });
  } catch (err) {
    await conn.rollback();
    console.error('[stock-takes update]', err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

/**
 * 删除盘点单（仅草稿状态）
 * DELETE /stock-takes/:id
 */
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [takeRows] = await pool.query('SELECT * FROM stock_takes WHERE id = ?', [id]);
    if (takeRows.length === 0) return res.status(404).json({ error: '盘点单不存在' });
    if (takeRows[0].status !== 'draft') {
      return res.status(400).json({ error: '仅草稿状态可删除，已提交的需走退回流程' });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('DELETE FROM stock_take_items WHERE stock_take_id = ?', [id]);
      await conn.query('DELETE FROM stock_takes WHERE id = ?', [id]);
      await conn.commit();
      res.json({ success: true });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('[stock-takes delete]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 提交复核
 * POST /stock-takes/:id/submit
 * body: { signature_data? }
 */
router.post('/:id/submit', requireAuth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;
    const { signature_data } = req.body;
    const [takeRows] = await conn.query(`
      SELECT st.*, w.name as warehouse_name, w.manager_userid, w.confirmer_userid
      FROM stock_takes st
      JOIN warehouses w ON st.warehouse_id = w.id
      WHERE st.id = ?
    `, [id]);
    if (takeRows.length === 0) {
      conn.release();
      return res.status(404).json({ error: '盘点单不存在' });
    }
    const take = takeRows[0];
    if (!['draft', 'returned'].includes(take.status)) {
      conn.release();
      return res.status(400).json({ error: `当前状态(${take.status})不可提交` });
    }

    // 权限检查
    if (!await canOperateWarehouse(req.user, take.warehouse_id)) {
      conn.release();
      return res.status(403).json({ error: '无权操作此仓库的盘点' });
    }

    // 校验所有actual_quantity不为NULL
    const [unfilled] = await conn.query(
      'SELECT COUNT(*) as cnt FROM stock_take_items WHERE stock_take_id = ? AND actual_quantity IS NULL',
      [id]
    );
    if (unfilled[0].cnt > 0) {
      conn.release();
      return res.status(400).json({ error: `还有${unfilled[0].cnt}项物资未录入实盘数量` });
    }

    await conn.beginTransaction();
    // 提交时清空review_sample（退回重提需重新随机），写入 operator_signature
    await conn.query(`
      UPDATE stock_takes SET status = 'submitted', review_sample = NULL,
             operator_id = ?, operator_name = ?, operator_signature = ?, updated_at = NOW()
      WHERE id = ?
    `, [req.user.id, req.user.name || req.user.username, signature_data || null, id]);

    await conn.commit();

    // 提交后：同步签名、获取财务用户、生成reviewer_token、发通知、更新按钮状态
    try {
      // 同步签名
      if (signature_data) {
        await syncUserSignature(req.user.id, 'system', signature_data);
      }

      // 获取财务用户列表，为每个财务生成独立的 reviewer_token
      const financeUsers = await getFinanceUsers();
      for (const finUser of financeUsers) {
        const reviewerToken = uuidv4();
        const reviewerExpiredAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await pool.query(`
          UPDATE stock_takes SET reviewer_token = ?, reviewer_token_expired_at = ? WHERE id = ?
        `, [reviewerToken, reviewerExpiredAt, id]);

        // 发送通知给财务
        await sendStockTakeNotification(take, finUser.wecom_userid, 'submitted', '去复核', {
          role: 'reviewer',
          token: reviewerToken,
        });
      }

      // 把盘点人的 init/remind 卡片按钮变灰
      const operatorWecomUserid = take.manager_userid || take.confirmer_userid;
      if (operatorWecomUserid) {
        await tryUpdateCardButton(id, operatorWecomUserid, 'init', '已提交复核');
        await tryUpdateCardButton(id, operatorWecomUserid, 'remind', '已提交复核');
      }
    } catch (notifyErr) {
      console.warn('[stock-takes submit post-process]', notifyErr.message);
    }

    res.json({ success: true, message: '已提交，等待财务复核' });
  } catch (err) {
    await conn.rollback();
    console.error('[stock-takes submit]', err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

/**
 * 财务复核初始化：生成/取出随机5个抽样
 * GET /stock-takes/:id/review-init
 */
router.get('/:id/review-init', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!await canReview(req.user)) {
      return res.status(403).json({ error: '仅财务/管理员可复核' });
    }

    const [takeRows] = await pool.query('SELECT * FROM stock_takes WHERE id = ?', [id]);
    if (takeRows.length === 0) return res.status(404).json({ error: '盘点单不存在' });
    const take = takeRows[0];

    if (!['submitted', 'reviewing'].includes(take.status)) {
      return res.status(400).json({ error: `当前状态(${take.status})不可复核` });
    }

    // 如果已有review_sample，直接返回
    let reviewSample = null;
    if (take.review_sample) {
      try {
        reviewSample = typeof take.review_sample === 'string'
          ? JSON.parse(take.review_sample) : take.review_sample;
      } catch { reviewSample = null; }
    }

    if (reviewSample && Array.isArray(reviewSample) && reviewSample.length > 0) {
      // 补全物资名称等信息（防止物资改名）
      const samplesWithInfo = [];
      for (const s of reviewSample) {
        const [itemRows] = await pool.query(`
          SELECT sti.item_name, sti.spec, sti.unit, sti.actual_quantity, sti.system_quantity
          FROM stock_take_items sti WHERE sti.id = ?
        `, [s.item_detail_id]);
        samplesWithInfo.push({
          ...s,
          item_name: itemRows[0]?.item_name || s.item_name,
          spec: itemRows[0]?.spec || '',
          unit: itemRows[0]?.unit || '',
          actual_quantity: itemRows[0]?.actual_quantity,
        });
      }
      // 标记为reviewing状态
      await pool.query("UPDATE stock_takes SET status = 'reviewing', updated_at = NOW() WHERE id = ?", [id]);
      return res.json({ samples: samplesWithInfo, status: 'reviewing' });
    }

    // 生成新的随机抽样
    const [items] = await pool.query(`
      SELECT id, item_id, item_name, spec, unit, system_quantity, actual_quantity, difference
      FROM stock_take_items
      WHERE stock_take_id = ?
    `, [id]);

    if (items.length === 0) return res.status(400).json({ error: '盘点明细为空' });

    // 策略：有差异的优先，不够5个从无差异中随机补齐
    const diffItems = items.filter(i => Number(i.difference) !== 0);
    const sameItems = items.filter(i => Number(i.difference) === 0);
    let selected = [];
    if (diffItems.length >= 5) {
      selected = randomSample(diffItems, 5);
    } else {
      selected = [...diffItems];
      const need = 5 - selected.length;
      if (need > 0 && sameItems.length > 0) {
        selected = [...selected, ...randomSample(sameItems, need)];
      }
    }

    // 组装抽样数据（不返回system_quantity给前端，防先入为主）
    const samples = selected.map(s => ({
      item_detail_id: s.id,
      item_id: s.item_id,
      item_name: s.item_name,
      spec: s.spec,
      unit: s.unit,
      actual_quantity: s.actual_quantity, // 盘点人填的
      verify_quantity: null, // 财务待填
      matched: null,
    }));

    // 存入数据库
    await pool.query(`
      UPDATE stock_takes SET status = 'reviewing', review_sample = ?, updated_at = NOW() WHERE id = ?
    `, [JSON.stringify(samples), id]);

    res.json({ samples, status: 'reviewing' });
  } catch (err) {
    console.error('[stock-takes review-init]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 财务提交复核结果
 * POST /stock-takes/:id/review
 * body: { action: 'pass'|'return', samples: [{item_detail_id, verify_quantity}], return_reason, signature_data? }
 */
router.post('/:id/review', requireAuth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;
    const { action, samples, return_reason, signature_data } = req.body;

    if (!await canReview(req.user)) {
      conn.release();
      return res.status(403).json({ error: '仅财务/管理员可复核' });
    }

    const [takeRows] = await conn.query(`
      SELECT st.*, w.name as warehouse_name, w.manager_userid, w.confirmer_userid
      FROM stock_takes st
      JOIN warehouses w ON st.warehouse_id = w.id
      WHERE st.id = ?
    `, [id]);
    if (takeRows.length === 0) {
      conn.release();
      return res.status(404).json({ error: '盘点单不存在' });
    }
    const take = takeRows[0];
    if (take.status !== 'reviewing') {
      conn.release();
      return res.status(400).json({ error: `当前状态(${take.status})不可复核` });
    }

    // 退回（不签名）
    if (action === 'return') {
      await conn.beginTransaction();
      await conn.query(`
        UPDATE stock_takes SET status = 'returned', review_result = 'mismatch',
                               remark = CONCAT(IFNULL(remark, ''), '\n[退回原因]', ?),
                               reviewed_by = ?, reviewed_by_name = ?, reviewed_at = NOW(),
                               review_sample = NULL, updated_at = NOW()
        WHERE id = ?
      `, [return_reason || '未填写', req.user.id, req.user.name || req.user.username, id]);
      await conn.commit();

      // 退回后：通知仓库管理员、变灰财务的 submitted 卡片
      try {
        const operatorWecomUserid = take.manager_userid || take.confirmer_userid;
        if (operatorWecomUserid) {
          await sendStockTakeNotification(take, operatorWecomUserid, 'returned', '重新盘点');
        }
        // 财务自身的 submitted 卡片变灰
        if (req.user.wecom_userid) {
          await tryUpdateCardButton(id, req.user.wecom_userid, 'submitted', '已退回');
        }
      } catch (notifyErr) {
        console.warn('[stock-takes review return post-process]', notifyErr.message);
      }

      return res.json({ success: true, message: '已退回，通知盘点人修改' });
    }

    // 通过：signature_data 可选（PC端）
    // 通过：校验抽样结果
    if (!Array.isArray(samples)) {
      conn.release();
      return res.status(400).json({ error: '缺少抽样核验数据' });
    }

    // 对比每个抽样的 verify_quantity vs actual_quantity（精确一致）
    let allMatched = true;
    const updatedSamples = [];
    for (const s of samples) {
      const [itemRows] = await conn.query(
        'SELECT actual_quantity FROM stock_take_items WHERE id = ? AND stock_take_id = ?',
        [s.item_detail_id, id]
      );
      if (itemRows.length === 0) continue;
      const actualQty = Number(itemRows[0].actual_quantity);
      const verifyQty = s.verify_quantity !== null && s.verify_quantity !== ''
        ? Number(s.verify_quantity) : null;
      const matched = verifyQty !== null && verifyQty === actualQty;
      if (!matched) allMatched = false;
      updatedSamples.push({
        ...s,
        matched,
      });
    }

    if (!allMatched) {
      // 有不一致：更新review_sample但不过，返回需要重新盘点
      await conn.beginTransaction();
      await conn.query(`
        UPDATE stock_takes SET review_sample = ?, review_result = 'mismatch', updated_at = NOW()
        WHERE id = ?
      `, [JSON.stringify(updatedSamples), id]);
      await conn.commit();
      return res.json({
        success: false,
        message: '抽样核验有不一致项，需退回重新盘点',
        samples: updatedSamples,
        need_return: true,
      });
    }

    // 全部一致 → 完成盘点（事务：写adjust流水 + 更新库存 + cost_summary）
    await conn.beginTransaction();

    // 1. 更新盘点单状态
    // 生成 cost_summary（按分类汇总盈亏）
    const [diffItems] = await conn.query(`
      SELECT sti.category_name, sti.item_name, sti.difference, sti.unit_price,
             sti.system_value, sti.actual_value
      FROM stock_take_items sti
      WHERE sti.stock_take_id = ? AND sti.difference != 0
      ORDER BY sti.category_name
    `, [id]);

    const costSummary = {};
    for (const item of diffItems) {
      const cat = item.category_name || '未分类';
      if (!costSummary[cat]) {
        costSummary[cat] = { items: [], total_diff: 0 };
      }
      costSummary[cat].items.push({
        item_name: item.item_name,
        difference: Number(item.difference),
        diff_value: Number(item.actual_value) - Number(item.system_value),
      });
      costSummary[cat].total_diff += Number(item.actual_value) - Number(item.system_value);
    }

    await conn.query(`
      UPDATE stock_takes SET status = 'completed', review_result = 'match',
                             review_sample = ?,
                             reviewed_by = ?, reviewed_by_name = ?, reviewed_at = NOW(),
                             reviewer_signature = ?,
                             cost_summary = ?, updated_at = NOW()
      WHERE id = ?
    `, [JSON.stringify(updatedSamples), req.user.id, req.user.name || req.user.username,
        signature_data || null, JSON.stringify(costSummary), id]);

    // 2. 写入盘点调整流水 + 更新库存
    const [allDiffItems] = await conn.query(`
      SELECT sti.*, w.department_id, d.name as department_name
      FROM stock_take_items sti
      JOIN stock_takes st ON sti.stock_take_id = st.id
      JOIN warehouses w ON st.warehouse_id = w.id
      LEFT JOIN departments d ON w.department_id = d.id
      WHERE sti.stock_take_id = ? AND sti.difference != 0
    `, [id]);

    for (const item of allDiffItems) {
      const diff = Number(item.difference);
      const movementId = uuidv4();
      const totalAmount = diff * Number(item.unit_price);
      const reason = diff > 0 ? `盘点盘盈(${take.take_no})` : `盘点盘亏(${take.take_no})`;

      // 写流水
      await conn.query(`
        INSERT INTO stock_movements (id, warehouse_id, item_id, item_name, movement_type,
          quantity, unit, unit_price, total_amount, reason, related_type, related_id,
          operator_id, operator_name, department_id, department_name)
        VALUES (?, ?, ?, ?, 'adjust', ?, ?, ?, ?, ?, 'take', ?, ?, ?, ?, ?)
      `, [movementId, take.warehouse_id, item.item_id, item.item_name,
          diff, item.unit, item.unit_price, totalAmount, reason,
          take.id, req.user.id, req.user.name || req.user.username,
          item.department_id || null, item.department_name || null]);

      // 更新库存
      await conn.query(`
        UPDATE inventory SET quantity = quantity + ?, updated_at = NOW()
        WHERE warehouse_id = ? AND item_id = ?
      `, [diff, take.warehouse_id, item.item_id]);
    }

    await conn.commit();

    // 通过后：同步签名、通知管理员和财务、变灰 submitted 卡片
    try {
      // 同步签名
      if (signature_data) {
        await syncUserSignature(req.user.id, 'system', signature_data);
      }

      const operatorWecomUserid = take.manager_userid || take.confirmer_userid;
      // 通知仓库管理员
      if (operatorWecomUserid) {
        await sendStockTakeNotification(take, operatorWecomUserid, 'completed', '查看结果');
      }
      // 通知所有财务
      const financeUsers = await getFinanceUsers();
      for (const finUser of financeUsers) {
        await sendStockTakeNotification(take, finUser.wecom_userid, 'completed', '查看盘点结果');
        // 变灰 submitted 卡片
        await tryUpdateCardButton(id, finUser.wecom_userid, 'submitted', '✅ 已完成');
      }
    } catch (notifyErr) {
      console.warn('[stock-takes review pass post-process]', notifyErr.message);
    }

    res.json({
      success: true,
      message: `盘点已完成，共调整${allDiffItems.length}项物资库存`,
      diff_count: allDiffItems.length,
    });
  } catch (err) {
    await conn.rollback();
    console.error('[stock-takes review]', err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

/**
 * 发送盘点通知/催办
 * POST /stock-takes/:id/notify
 * body: { type: 'init'|'remind' }
 */
router.post('/:id/notify', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { type = 'remind' } = req.body;

    if (!await canReview(req.user)) {
      return res.status(403).json({ error: '仅财务/管理员可发送通知' });
    }

    const [takeRows] = await pool.query(`
      SELECT st.*, w.manager_userid, w.confirmer_userid, w.name as warehouse_name
      FROM stock_takes st
      JOIN warehouses w ON st.warehouse_id = w.id
      WHERE st.id = ?
    `, [id]);

    if (takeRows.length === 0) return res.status(404).json({ error: '盘点单不存在' });
    const take = takeRows[0];

    const recipientId = take.manager_userid || take.confirmer_userid;
    if (!recipientId) {
      return res.status(400).json({ error: '该仓库未设置管理员/确认人，无法发送通知' });
    }

    // 获取企微配置
    const { getWecomConfig, sendTemplateCardToUser } = require('./wecom');
    const config = await getWecomConfig();
    if (!config) {
      return res.status(500).json({ error: '企微配置未初始化' });
    }

    // 生成新的访问token（催办时刷新token）
    const newToken = uuidv4();
    const expiredAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await pool.query(`
      UPDATE stock_takes SET access_token = ?, access_expired_at = ?, notification_sent_at = NOW()
      WHERE id = ?
    `, [newToken, expiredAt, id]);

    // 构建H5链接（与采购确认链接同逻辑：优先用企微配置的app_domain）
    const baseUrl = config.app_domain || req.headers.origin || (req.protocol + '://' + req.get('host'));
    const h5Url = `${baseUrl}/stock-take-operate?token=${newToken}`;

    const title = type === 'init' ? '月末盘点通知' : '盘点催办提醒';
    const notifyTaskId = `stocktake_${id}_${recipientId}_${type}_${Date.now()}`;
    const cardContent = {
      card_type: 'button_interaction',
      source: { desc: '食材采购管理系统' },
      main_title: { title: `${take.warehouse_name} - ${take.period_month}月末盘点`, desc: title },
      sub_title_text: `盘点单号：${take.take_no}\n请尽快完成盘点并提交复核`,
      emphasis_content: { title: take.period_month, desc: '归属月份' },
      button_list: [{
        text: '开始盘点',
        style: 1,
        type: 1,
        key: `go_stocktake_${notifyTaskId}`,
        url: h5Url,
      }],
      task_id: notifyTaskId,
      card_action: { type: 1, url: h5Url },
    };

    let sendStatus = 'sent';
    let failReason = null;
    try {
      await sendTemplateCardToUser(config, recipientId, cardContent);
    } catch (e) {
      sendStatus = 'failed';
      failReason = e.message;
    }

    // 记录通知
    await pool.query(`
      INSERT INTO stock_take_notifications (id, stock_take_id, warehouse_id,
        recipient_wecom_userid, type, channel, send_status, fail_reason)
      VALUES (?, ?, ?, ?, ?, 'wecom_card', ?, ?)
    `, [uuidv4(), id, take.warehouse_id, recipientId, type, sendStatus, failReason]);

    if (sendStatus === 'failed') {
      return res.status(500).json({ error: `通知发送失败: ${failReason}` });
    }

    res.json({ success: true, message: '通知已发送' });
  } catch (err) {
    console.error('[stock-takes notify]', err);
    res.status(500).json({ error: err.message });
  }
});

// ================================================
// H5端接口（独立token认证，免登录）
// 仓库管理员通过企微卡片链接打开盘点页面
// ================================================

/** 盘点token认证中间件（支持 operator 的 access_token 和 reviewer 的 reviewer_token） */
async function requireStockTakeToken(req, res, next) {
  try {
    const token = req.query.token || req.query.r_token || req.headers['x-stock-take-token'] || '';
    if (!token) {
      return res.status(401).json({ error: '缺少访问token' });
    }

    const [rows] = await pool.query(`
      SELECT st.*, w.name as warehouse_name, w.manager_userid, w.confirmer_userid
      FROM stock_takes st
      JOIN warehouses w ON st.warehouse_id = w.id
      WHERE st.access_token = ? OR st.reviewer_token = ?
    `, [token, token]);

    if (rows.length === 0) {
      return res.status(401).json({ error: 'token无效或盘点单不存在' });
    }

    const take = rows[0];
    let role = 'operator';
    let expiredAtField = 'access_expired_at';
    if (take.reviewer_token === token) {
      role = 'reviewer';
      expiredAtField = 'reviewer_token_expired_at';
    }

    // 检查token是否过期
    if (take[expiredAtField] && new Date(take[expiredAtField]) < new Date()) {
      if (role === 'reviewer') {
        return res.status(401).json({ error: '复核访问链接已过期，请联系管理员重新发起复核' });
      } else {
        return res.status(401).json({ error: '访问链接已过期，请联系管理员重新发送通知' });
      }
    }

    req.stockTake = take;
    req.stockTakeToken = token;
    req.stockTakeRole = role;
    next();
  } catch (err) {
    console.error('[stock-take token auth]', err);
    res.status(500).json({ error: '认证失败' });
  }
}

/**
 * H5页面初始化：获取盘点单信息+明细
 * GET /stock-takes/h5/meta?token=xxx (operator) 或 ?r_token=xxx (reviewer)
 */
router.get('/h5/meta', requireStockTakeToken, async (req, res) => {
  try {
    const take = req.stockTake;
    const role = req.stockTakeRole;

    const [items] = await pool.query(`
      SELECT sti.*, wc.name as category_name
      FROM stock_take_items sti
      LEFT JOIN warehouse_items wi ON sti.item_id = wi.id
      LEFT JOIN warehouse_categories wc ON wi.category_id = wc.id
      WHERE sti.stock_take_id = ?
      ORDER BY wc.name ASC, sti.item_name ASC
    `, [take.id]);

    // 统计信息
    const filledCount = items.filter(i => i.actual_quantity !== null).length;
    const diffCount = items.filter(i => i.difference !== 0).length;

    // 解析 review_sample
    let reviewSample = null;
    if (take.review_sample) {
      try {
        reviewSample = typeof take.review_sample === 'string'
          ? JSON.parse(take.review_sample)
          : take.review_sample;
      } catch { reviewSample = null; }
    }

    // 如果是 reviewer 角色，状态是 submitted/reviewing，需要生成或补充抽样
    if (role === 'reviewer' && ['submitted', 'reviewing'].includes(take.status)) {
      if (!reviewSample || !Array.isArray(reviewSample) || reviewSample.length === 0) {
        // 生成新的随机抽样（与 review-init 逻辑一致）
        const [takeItems] = await pool.query(`
          SELECT id, item_id, item_name, spec, unit, system_quantity, actual_quantity, difference
          FROM stock_take_items
          WHERE stock_take_id = ?
        `, [take.id]);

        if (takeItems.length > 0) {
          const diffItems = takeItems.filter(i => Number(i.difference) !== 0);
          const sameItems = takeItems.filter(i => Number(i.difference) === 0);
          let selected = [];
          if (diffItems.length >= 5) {
            selected = randomSample(diffItems, 5);
          } else {
            selected = [...diffItems];
            const need = 5 - selected.length;
            if (need > 0 && sameItems.length > 0) {
              selected = [...selected, ...randomSample(sameItems, need)];
            }
          }

          reviewSample = selected.map(s => ({
            item_detail_id: s.id,
            item_id: s.item_id,
            item_name: s.item_name,
            spec: s.spec,
            unit: s.unit,
            actual_quantity: s.actual_quantity,
            verify_quantity: null,
            matched: null,
          }));

          // 存 review_sample 并标记为 reviewing（防并发：先查再更新）
          await pool.query(`
            UPDATE stock_takes SET status = 'reviewing', review_sample = ?, updated_at = NOW()
            WHERE id = ? AND (review_sample IS NULL OR review_sample = '')
          `, [JSON.stringify(reviewSample), take.id]);

          // 重新取出最新状态
          const [recheck] = await pool.query('SELECT review_sample, status FROM stock_takes WHERE id = ?', [take.id]);
          if (recheck[0].review_sample) {
            try {
              reviewSample = typeof recheck[0].review_sample === 'string'
                ? JSON.parse(recheck[0].review_sample) : recheck[0].review_sample;
            } catch {}
          }
        }
      }

      // 补全物资信息并返回
      if (Array.isArray(reviewSample) && reviewSample.length > 0) {
        const samplesWithInfo = [];
        for (const s of reviewSample) {
          const [itemRows] = await pool.query(`
            SELECT sti.item_name, sti.spec, sti.unit, sti.actual_quantity, sti.system_quantity
            FROM stock_take_items sti WHERE sti.id = ?
          `, [s.item_detail_id]);
          samplesWithInfo.push({
            ...s,
            item_name: itemRows[0]?.item_name || s.item_name,
            spec: itemRows[0]?.spec || '',
            unit: itemRows[0]?.unit || '',
            actual_quantity: itemRows[0]?.actual_quantity,
          });
        }
        reviewSample = samplesWithInfo;
      }
    }

    res.json({
      id: take.id,
      take_no: take.take_no,
      warehouse_id: take.warehouse_id,
      warehouse_name: take.warehouse_name,
      period_month: take.period_month,
      take_type: take.take_type,
      role: role,
      status: take.status,
      remark: take.remark,
      operator_signature: take.operator_signature,
      reviewer_signature: take.reviewer_signature,
      manager_userid: take.manager_userid,
      confirmer_userid: take.confirmer_userid,
      items,
      review_sample: reviewSample,
      stats: {
        total: items.length,
        filled: filledCount,
        diff: diffCount,
      },
    });
  } catch (err) {
    console.error('[stock-takes h5 meta]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * H5保存实盘（批量更新）
 * PUT /stock-takes/h5/save?token=xxx
 * body: { items: [{ id, actual_quantity, remark }] }
 */
router.put('/h5/save', requireStockTakeToken, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const take = req.stockTake;
    const { items } = req.body;

    if (!['draft', 'returned'].includes(take.status)) {
      conn.release();
      return res.status(400).json({ error: `当前状态(${take.status})不可编辑` });
    }

    await conn.beginTransaction();

    if (Array.isArray(items)) {
      for (const it of items) {
        const actualQty = it.actual_quantity !== null && it.actual_quantity !== undefined && it.actual_quantity !== ''
          ? Number(it.actual_quantity) : null;
        const diff = actualQty !== null ? actualQty - Number(it.system_quantity) : 0;
        const actualValue = actualQty !== null ? actualQty * Number(it.unit_price) : 0;
        await conn.query(`
          UPDATE stock_take_items
          SET actual_quantity = ?, difference = ?, actual_value = ?, remark = ?
          WHERE id = ? AND stock_take_id = ?
        `, [actualQty, diff, actualValue, it.remark || null, it.id, take.id]);
      }
    }

    // 更新盘点单总价值和执行人信息
    const [stats] = await conn.query(`
      SELECT IFNULL(SUM(actual_value), 0) as total_actual
      FROM stock_take_items WHERE stock_take_id = ?
    `, [take.id]);

    await conn.query(`
      UPDATE stock_takes SET total_value = ?, updated_at = NOW()
      WHERE id = ?
    `, [Number(stats[0].total_actual), take.id]);

    // token 自动续期
    await conn.query(`
      UPDATE stock_takes SET access_expired_at = DATE_ADD(NOW(), INTERVAL 7 DAY) WHERE id = ?
    `, [take.id]);

    await conn.commit();
    res.json({ success: true, message: '保存成功' });
  } catch (err) {
    await conn.rollback();
    console.error('[stock-takes h5 save]', err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

/**
 * H5提交复核
 * POST /stock-takes/h5/submit?token=xxx
 * body: { signature_data } (H5必填)
 */
router.post('/h5/submit', requireStockTakeToken, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const take = req.stockTake;
    const { signature_data } = req.body;

    if (!['draft', 'returned'].includes(take.status)) {
      conn.release();
      return res.status(400).json({ error: `当前状态(${take.status})不可提交` });
    }

    // H5端 signature_data 必填
    if (!signature_data) {
      conn.release();
      return res.status(400).json({ error: '请先签字后提交' });
    }

    // 校验所有actual_quantity不为NULL
    const [unfilled] = await conn.query(
      'SELECT COUNT(*) as cnt FROM stock_take_items WHERE stock_take_id = ? AND actual_quantity IS NULL',
      [take.id]
    );
    if (unfilled[0].cnt > 0) {
      conn.release();
      return res.status(400).json({ error: `还有${unfilled[0].cnt}项物资未录入实盘数量` });
    }

    await conn.beginTransaction();

    // 记录执行人信息（从仓库管理员信息取），写入 operator_signature
    const operatorName = take.warehouse_name ? `${take.warehouse_name}管理员` : '仓库管理员';
    const operatorWecomUserid = take.manager_userid || take.confirmer_userid;
    await conn.query(`
      UPDATE stock_takes SET status = 'submitted', review_sample = NULL,
             operator_wecom_userid = ?, operator_name = ?, operator_signature = ?, updated_at = NOW()
      WHERE id = ?
    `, [operatorWecomUserid, operatorName, signature_data, take.id]);

    await conn.commit();

    // 提交后：同步签名、获取财务用户、生成reviewer_token、发通知、更新按钮状态
    try {
      // 同步签名（H5端用 manager_userid，user_source='wecom'）
      if (signature_data && operatorWecomUserid) {
        // 先根据 wecom_userid 找 user_id
        const [userRows] = await pool.query(
          'SELECT id FROM users WHERE wecom_userid = ? LIMIT 1',
          [operatorWecomUserid]
        );
        if (userRows.length > 0) {
          await syncUserSignature(userRows[0].id, 'wecom', signature_data);
        }
      }

      // 获取财务用户列表，为每个财务生成独立的 reviewer_token
      const financeUsers = await getFinanceUsers();
      for (const finUser of financeUsers) {
        const reviewerToken = uuidv4();
        const reviewerExpiredAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await pool.query(`
          UPDATE stock_takes SET reviewer_token = ?, reviewer_token_expired_at = ? WHERE id = ?
        `, [reviewerToken, reviewerExpiredAt, take.id]);

        // 发送通知给财务
        await sendStockTakeNotification(take, finUser.wecom_userid, 'submitted', '去复核', {
          role: 'reviewer',
          token: reviewerToken,
        });
      }

      // 把盘点人的 init/remind 卡片按钮变灰
      if (operatorWecomUserid) {
        await tryUpdateCardButton(take.id, operatorWecomUserid, 'init', '已提交复核');
        await tryUpdateCardButton(take.id, operatorWecomUserid, 'remind', '已提交复核');
      }
    } catch (notifyErr) {
      console.warn('[stock-takes h5 submit post-process]', notifyErr.message);
    }

    res.json({ success: true, message: '已提交，等待财务复核' });
  } catch (err) {
    await conn.rollback();
    console.error('[stock-takes h5 submit]', err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

/**
 * H5财务复核
 * POST /stock-takes/h5/review?r_token=xxx
 * body: { action: 'pass'|'return', samples: [...], return_reason, signature_data }
 */
router.post('/h5/review', requireStockTakeToken, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const take = req.stockTake;
    const role = req.stockTakeRole;
    const { action, samples, return_reason, signature_data } = req.body;

    // 只有 reviewer 角色才能复核
    if (role !== 'reviewer') {
      conn.release();
      return res.status(403).json({ error: '仅财务复核人可执行此操作' });
    }

    if (take.status !== 'reviewing') {
      conn.release();
      return res.status(400).json({ error: `当前状态(${take.status})不可复核` });
    }

    // 退回（不签名）
    if (action === 'return') {
      await conn.beginTransaction();
      await conn.query(`
        UPDATE stock_takes SET status = 'returned', review_result = 'mismatch',
                               remark = CONCAT(IFNULL(remark, ''), '\n[退回原因]', ?),
                               reviewed_by = NULL, reviewed_by_name = ?, reviewed_at = NOW(),
                               review_sample = NULL, updated_at = NOW()
        WHERE id = ?
      `, [return_reason || '未填写', 'H5财务复核', take.id]);
      await conn.commit();

      // 退回后：通知仓库管理员、变灰财务的 submitted 卡片
      try {
        const operatorWecomUserid = take.manager_userid || take.confirmer_userid;
        if (operatorWecomUserid) {
          await sendStockTakeNotification(take, operatorWecomUserid, 'returned', '重新盘点');
        }
      } catch (notifyErr) {
        console.warn('[stock-takes h5 review return post-process]', notifyErr.message);
      }

      return res.json({ success: true, message: '已退回，通知盘点人修改' });
    }

    // 通过：H5 端 signature_data 必填
    if (!signature_data) {
      conn.release();
      return res.status(400).json({ error: '请先签字后通过' });
    }

    // 通过：校验抽样结果
    if (!Array.isArray(samples)) {
      conn.release();
      return res.status(400).json({ error: '缺少抽样核验数据' });
    }

    // 对比每个抽样的 verify_quantity vs actual_quantity（精确一致）
    let allMatched = true;
    const updatedSamples = [];
    for (const s of samples) {
      const [itemRows] = await conn.query(
        'SELECT actual_quantity FROM stock_take_items WHERE id = ? AND stock_take_id = ?',
        [s.item_detail_id, take.id]
      );
      if (itemRows.length === 0) continue;
      const actualQty = Number(itemRows[0].actual_quantity);
      const verifyQty = s.verify_quantity !== null && s.verify_quantity !== ''
        ? Number(s.verify_quantity) : null;
      const matched = verifyQty !== null && verifyQty === actualQty;
      if (!matched) allMatched = false;
      updatedSamples.push({
        ...s,
        matched,
      });
    }

    if (!allMatched) {
      // 有不一致：更新review_sample但不过，返回需要重新盘点
      await conn.beginTransaction();
      await conn.query(`
        UPDATE stock_takes SET review_sample = ?, review_result = 'mismatch', updated_at = NOW()
        WHERE id = ?
      `, [JSON.stringify(updatedSamples), take.id]);
      await conn.commit();
      return res.json({
        success: false,
        message: '抽样核验有不一致项，需退回重新盘点',
        samples: updatedSamples,
        need_return: true,
      });
    }

    // 全部一致 → 完成盘点（事务：写adjust流水 + 更新库存 + cost_summary）
    await conn.beginTransaction();

    // 1. 更新盘点单状态
    const [diffItems] = await conn.query(`
      SELECT sti.category_name, sti.item_name, sti.difference, sti.unit_price,
             sti.system_value, sti.actual_value
      FROM stock_take_items sti
      WHERE sti.stock_take_id = ? AND sti.difference != 0
      ORDER BY sti.category_name
    `, [take.id]);

    const costSummary = {};
    for (const item of diffItems) {
      const cat = item.category_name || '未分类';
      if (!costSummary[cat]) {
        costSummary[cat] = { items: [], total_diff: 0 };
      }
      costSummary[cat].items.push({
        item_name: item.item_name,
        difference: Number(item.difference),
        diff_value: Number(item.actual_value) - Number(item.system_value),
      });
      costSummary[cat].total_diff += Number(item.actual_value) - Number(item.system_value);
    }

    await conn.query(`
      UPDATE stock_takes SET status = 'completed', review_result = 'match',
                             review_sample = ?,
                             reviewed_by = NULL, reviewed_by_name = ?, reviewed_at = NOW(),
                             reviewer_signature = ?,
                             cost_summary = ?, updated_at = NOW()
      WHERE id = ?
    `, [JSON.stringify(updatedSamples), 'H5财务复核', signature_data,
        JSON.stringify(costSummary), take.id]);

    // 2. 写入盘点调整流水 + 更新库存
    const [allDiffItems] = await conn.query(`
      SELECT sti.*, w.department_id, d.name as department_name
      FROM stock_take_items sti
      JOIN stock_takes st ON sti.stock_take_id = st.id
      JOIN warehouses w ON st.warehouse_id = w.id
      LEFT JOIN departments d ON w.department_id = d.id
      WHERE sti.stock_take_id = ? AND sti.difference != 0
    `, [take.id]);

    for (const item of allDiffItems) {
      const diff = Number(item.difference);
      const movementId = uuidv4();
      const totalAmount = diff * Number(item.unit_price);
      const reason = diff > 0 ? `盘点盘盈(${take.take_no})` : `盘点盘亏(${take.take_no})`;

      await conn.query(`
        INSERT INTO stock_movements (id, warehouse_id, item_id, item_name, movement_type,
          quantity, unit, unit_price, total_amount, reason, related_type, related_id,
          operator_id, operator_name, department_id, department_name)
        VALUES (?, ?, ?, ?, 'adjust', ?, ?, ?, ?, ?, 'take', ?, ?, ?, ?, ?)
      `, [movementId, take.warehouse_id, item.item_id, item.item_name,
          diff, item.unit, item.unit_price, totalAmount, reason,
          take.id, null, 'H5财务复核',
          item.department_id || null, item.department_name || null]);

      await conn.query(`
        UPDATE inventory SET quantity = quantity + ?, updated_at = NOW()
        WHERE warehouse_id = ? AND item_id = ?
      `, [diff, take.warehouse_id, item.item_id]);
    }

    await conn.commit();

    // 通过后：同步签名、通知管理员和财务、变灰 submitted 卡片
    try {
      // 同步签名（根据 reviewer 的企微 userid 找用户）
      if (signature_data && req.user?.wecom_userid) {
        const [userRows] = await pool.query(
          'SELECT id FROM users WHERE wecom_userid = ? LIMIT 1',
          [req.user.wecom_userid]
        );
        if (userRows.length > 0) {
          await syncUserSignature(userRows[0].id, 'wecom', signature_data);
        }
      }

      const operatorWecomUserid = take.manager_userid || take.confirmer_userid;
      // 通知仓库管理员
      if (operatorWecomUserid) {
        await sendStockTakeNotification(take, operatorWecomUserid, 'completed', '查看结果');
      }
      // 通知所有财务
      const financeUsers = await getFinanceUsers();
      for (const finUser of financeUsers) {
        await sendStockTakeNotification(take, finUser.wecom_userid, 'completed', '查看盘点结果');
        await tryUpdateCardButton(take.id, finUser.wecom_userid, 'submitted', '✅ 已完成');
      }
    } catch (notifyErr) {
      console.warn('[stock-takes h5 review pass post-process]', notifyErr.message);
    }

    res.json({
      success: true,
      message: `盘点已完成，共调整${allDiffItems.length}项物资库存`,
      diff_count: allDiffItems.length,
    });
  } catch (err) {
    await conn.rollback();
    console.error('[stock-takes h5 review]', err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

/**
 * 重新生成访问链接
 * POST /stock-takes/:id/refresh-token
 */
router.post('/:id/refresh-token', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!await canReview(req.user)) {
      return res.status(403).json({ error: '仅财务/管理员可重新生成链接' });
    }

    const [takeRows] = await pool.query(`
      SELECT st.*, w.name as warehouse_name
      FROM stock_takes st
      JOIN warehouses w ON st.warehouse_id = w.id
      WHERE st.id = ?
    `, [id]);
    if (takeRows.length === 0) return res.status(404).json({ error: '盘点单不存在' });
    const take = takeRows[0];

    const newOperatorToken = uuidv4();
    let newReviewerToken = take.reviewer_token || uuidv4();
    if (!newReviewerToken) newReviewerToken = uuidv4();
    const expiredAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await pool.query(`
      UPDATE stock_takes SET access_token = ?, access_expired_at = ?,
                             reviewer_token = ?, reviewer_token_expired_at = ?,
                             updated_at = NOW()
      WHERE id = ?
    `, [newOperatorToken, expiredAt, newReviewerToken, expiredAt, id]);

    // 获取 app_domain
    const { getWecomConfig } = require('./wecom');
    const config = await getWecomConfig();
    const baseUrl = config?.app_domain || (req.protocol + '://' + req.get('host'));

    const operatorUrl = `${baseUrl}/stock-take-operate?token=${newOperatorToken}`;
    const reviewerUrl = `${baseUrl}/stock-take-operate?r_token=${newReviewerToken}`;

    res.json({
      operator_token: newOperatorToken,
      reviewer_token: newReviewerToken,
      operator_url: operatorUrl,
      reviewer_url: reviewerUrl,
    });
  } catch (err) {
    console.error('[stock-takes refresh-token]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 导出盘点报告PDF
 * GET /stock-takes/:id/report-pdf
 */
router.get('/:id/report-pdf', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const [takeRows] = await pool.query(`
      SELECT st.*, w.name as warehouse_name, w.manager_userid
      FROM stock_takes st
      JOIN warehouses w ON st.warehouse_id = w.id
      WHERE st.id = ?
    `, [id]);
    if (takeRows.length === 0) return res.status(404).json({ error: '盘点单不存在' });
    const take = takeRows[0];

    const [items] = await pool.query(`
      SELECT * FROM stock_take_items WHERE stock_take_id = ? ORDER BY category_name, item_name
    `, [id]);

    // 解析 review_sample
    let reviewSample = null;
    if (take.review_sample) {
      try {
        reviewSample = typeof take.review_sample === 'string'
          ? JSON.parse(take.review_sample) : take.review_sample;
      } catch { reviewSample = null; }
    }

    // 解析 cost_summary
    let costSummary = null;
    if (take.cost_summary) {
      try {
        costSummary = typeof take.cost_summary === 'string'
          ? JSON.parse(take.cost_summary) : take.cost_summary;
      } catch { costSummary = null; }
    }

    const path = require('path');
    const fs = require('fs');
    const PDFDocument = require('pdfkit');
    const { findChineseFont, findChineseBoldFont, toNum, PDF_DIR, ensureUploadDir } = require('../utils/pdf');
    ensureUploadDir();

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const pdfPath = path.join(PDF_DIR, `stock_take_${id}.pdf`);
    const writeStream = fs.createWriteStream(pdfPath);
    doc.pipe(writeStream);

    const chineseFont = findChineseFont();
    const chineseBoldFont = findChineseBoldFont();
    const hasChineseFont = !!chineseFont;
    if (hasChineseFont) {
      doc.registerFont('Chinese-Regular', chineseFont);
      doc.registerFont('Chinese-Bold', chineseBoldFont || chineseFont);
    }

    const reportTitle = take.take_type === 'annual' ? '年度固定资产盘点报告' : '月末盘点报告';
    doc.fontSize(18).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold').text(reportTitle, { align: 'center' });
    doc.moveDown(0.8);

    doc.fontSize(10).font(hasChineseFont ? 'Chinese-Regular' : 'Helvetica');
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const tableX = doc.page.margins.left;
    const tableWidth = pageWidth;

    let reviewedAtStr = '';
    if (take.reviewed_at instanceof Date) {
      const d = take.reviewed_at;
      reviewedAtStr = `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}`;
    } else if (typeof take.reviewed_at === 'string') {
      reviewedAtStr = take.reviewed_at.substring(0, 10);
    }

    const statusLabel = {
      draft: '草稿', submitted: '已提交', reviewing: '复核中',
      returned: '已退回', completed: '已完成', cancelled: '已取消'
    }[take.status] || take.status;

    doc.text(`仓库：${take.warehouse_name}    月份：${take.period_month}    盘点单号：${take.take_no}`);
    doc.moveDown(0.2);
    doc.text(`状态：${statusLabel}    盘点人：${take.operator_name || '-'}    复核人：${take.reviewed_by_name || '-'}`);
    doc.moveDown(0.2);
    doc.text(`日期：${reviewedAtStr || (new Date()).toLocaleDateString('zh-CN')}`);
    doc.moveDown(0.5);

    // 盈亏汇总
    if (costSummary && Object.keys(costSummary).length > 0) {
      doc.fontSize(12).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold').text('一、盈亏汇总（按分类）', { underline: true });
      doc.moveDown(0.3);
      let currentY = doc.y;
      const sumHeaders = ['分类', '盈亏项数', '盈亏金额'];
      const sumColWidths = [tableWidth * 0.45, tableWidth * 0.25, tableWidth * 0.30];
      const fixedRowHeight = 12;
      doc.fontSize(8).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold');
      let x = tableX;
      for (let i = 0; i < sumHeaders.length; i++) {
        doc.text(sumHeaders[i], x + 3, currentY + 2, { width: sumColWidths[i] - 6 });
        x += sumColWidths[i];
      }
      currentY += fixedRowHeight;
      doc.moveTo(tableX, currentY).lineTo(tableX + tableWidth, currentY).stroke();

      doc.font(hasChineseFont ? 'Chinese-Regular' : 'Helvetica');
      let grandTotal = 0;
      for (const [cat, data] of Object.entries(costSummary)) {
        x = tableX;
        const totalDiff = toNum(data.total_diff);
        grandTotal += totalDiff;
        const cells = [cat, String(data.items.length), `¥${totalDiff.toFixed(2)}`];
        for (let i = 0; i < cells.length; i++) {
          const align = i === 0 ? 'left' : (i === cells.length - 1 ? 'right' : 'center');
          doc.text(cells[i], x + 3, currentY + 2, { width: sumColWidths[i] - 6, align });
          x += sumColWidths[i];
        }
        currentY += fixedRowHeight;
      }
      // 合计行
      doc.font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold');
      x = tableX;
      const totalCells = ['合计', String(Object.values(costSummary).reduce((s, d) => s + d.items.length, 0)), `¥${grandTotal.toFixed(2)}`];
      for (let i = 0; i < totalCells.length; i++) {
        const align = i === 0 ? 'left' : (i === totalCells.length - 1 ? 'right' : 'center');
        doc.text(totalCells[i], x + 3, currentY + 2, { width: sumColWidths[i] - 6, align });
        x += sumColWidths[i];
      }
      doc.y = currentY + fixedRowHeight + 10;
    }

    // 盘点明细表
    doc.fontSize(12).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold').text('二、盘点明细表', { underline: true });
    doc.moveDown(0.3);
    let currentY = doc.y;
    const itemHeaders = ['分类', '物资名', '规格', '单位', '系统数', '实盘数', '差异', '单价', '系统额', '实盘额', '差异额'];
    const itemColWidths = [tableWidth * 0.12, tableWidth * 0.20, tableWidth * 0.09, tableWidth * 0.06,
      tableWidth * 0.07, tableWidth * 0.07, tableWidth * 0.06, tableWidth * 0.08, tableWidth * 0.08, tableWidth * 0.08, tableWidth * 0.09];
    const itemRowHeight = 11;

    function checkPageBreak(y, extra = 0) {
      const pb = doc.page.height - doc.page.margins.bottom;
      if (y + extra > pb) {
        doc.addPage();
        return doc.page.margins.top;
      }
      return y;
    }

    currentY = checkPageBreak(currentY, 30);
    doc.fontSize(6.5).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold');
    let x = tableX;
    for (let i = 0; i < itemHeaders.length; i++) {
      doc.text(itemHeaders[i], x + 2, currentY + 2, { width: itemColWidths[i] - 4, align: 'center' });
      x += itemColWidths[i];
    }
    currentY += itemRowHeight;
    doc.moveTo(tableX, currentY).lineTo(tableX + tableWidth, currentY).stroke();

    doc.font(hasChineseFont ? 'Chinese-Regular' : 'Helvetica').fontSize(6.5);
    let totalSysVal = 0, totalActVal = 0, totalDiffVal = 0;
    for (const it of items) {
      currentY = checkPageBreak(currentY, itemRowHeight);
      const sysQty = toNum(it.system_quantity);
      const actQty = toNum(it.actual_quantity);
      const diffQty = toNum(it.difference);
      const unitPrice = toNum(it.unit_price);
      const sysVal = toNum(it.system_value);
      const actVal = toNum(it.actual_value);
      const diffVal = actVal - sysVal;
      totalSysVal += sysVal;
      totalActVal += actVal;
      totalDiffVal += diffVal;
      const cells = [
        it.category_name || '-', it.item_name, it.spec || '-', it.unit || '-',
        sysQty, (it.actual_quantity === null || it.actual_quantity === undefined) ? '-' : actQty,
        (it.actual_quantity === null || it.actual_quantity === undefined) ? '-' : diffQty,
        unitPrice.toFixed(2), sysVal.toFixed(2),
        (it.actual_quantity === null || it.actual_quantity === undefined) ? '-' : actVal.toFixed(2),
        (it.actual_quantity === null || it.actual_quantity === undefined) ? '-' : diffVal.toFixed(2),
      ];
      x = tableX;
      for (let i = 0; i < cells.length; i++) {
        const align = (i >= 4) ? 'right' : 'left';
        doc.text(String(cells[i]), x + 1, currentY + 1, { width: itemColWidths[i] - 2, align });
        x += itemColWidths[i];
      }
      currentY += itemRowHeight;
    }
    // 合计行
    currentY = checkPageBreak(currentY, itemRowHeight * 2);
    doc.moveTo(tableX, currentY).lineTo(tableX + tableWidth, currentY).stroke();
    currentY += 2;
    doc.font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold');
    x = tableX;
    const tcells = ['合计', '', '', '', '', '', '', '', totalSysVal.toFixed(2), totalActVal.toFixed(2), totalDiffVal.toFixed(2)];
    for (let i = 0; i < tcells.length; i++) {
      const align = (i >= 4) ? 'right' : 'left';
      doc.text(String(tcells[i]), x + 1, currentY + 1, { width: itemColWidths[i] - 2, align });
      x += itemColWidths[i];
    }
    doc.y = currentY + itemRowHeight + 10;

    // 抽样核验记录
    if (reviewSample && Array.isArray(reviewSample) && reviewSample.length > 0) {
      doc.fontSize(12).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold').text('三、抽样核验记录', { underline: true });
      doc.moveDown(0.3);
      currentY = doc.y;
      const sHeaders = ['物资名', '规格', '单位', '实盘数', '核验数', '是否一致'];
      const sColWidths = [tableWidth * 0.32, tableWidth * 0.18, tableWidth * 0.10,
        tableWidth * 0.12, tableWidth * 0.12, tableWidth * 0.16];
      const sRowHeight = 12;
      currentY = checkPageBreak(currentY, 30);
      doc.fontSize(8).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold');
      x = tableX;
      for (let i = 0; i < sHeaders.length; i++) {
        doc.text(sHeaders[i], x + 3, currentY + 2, { width: sColWidths[i] - 6, align: 'center' });
        x += sColWidths[i];
      }
      currentY += sRowHeight;
      doc.moveTo(tableX, currentY).lineTo(tableX + tableWidth, currentY).stroke();
      doc.font(hasChineseFont ? 'Chinese-Regular' : 'Helvetica');
      for (const s of reviewSample) {
        currentY = checkPageBreak(currentY, sRowHeight);
        const matched = s.matched === null || s.matched === undefined ? '-' : (s.matched ? '是' : '否');
        const scells = [s.item_name, s.spec || '-', s.unit || '-',
          s.actual_quantity ?? '-', s.verify_quantity ?? '-', matched];
        x = tableX;
        for (let i = 0; i < scells.length; i++) {
          const align = (i >= 3) ? 'center' : 'left';
          doc.text(String(scells[i]), x + 3, currentY + 2, { width: sColWidths[i] - 6, align });
          x += sColWidths[i];
        }
        currentY += sRowHeight;
      }
      doc.y = currentY + 15;
    }

    // 签字栏
    doc.moveDown(1);
    doc.fontSize(12).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold').text('四、双方签字', { underline: true });
    doc.moveDown(0.5);
    currentY = doc.y;
    const sigHeight = 55;
    const halfW = (tableWidth - 20) / 2;

    // 盘点人签字
    doc.save();
    doc.rect(tableX, currentY, halfW, sigHeight).stroke('#cccccc');
    doc.restore();
    doc.fontSize(9).font(hasChineseFont ? 'Chinese-Regular' : 'Helvetica');
    if (take.operator_signature) {
      try {
        const base64Data = String(take.operator_signature).replace(/^data:image\/\w+;base64,/, '');
        const buf = Buffer.from(base64Data, 'base64');
        doc.image(buf, tableX + 4, currentY + 18, { width: halfW - 8, height: sigHeight - 22, fit: [halfW - 8, sigHeight - 22] });
      } catch {}
      doc.text('盘点人：' + (take.operator_name || ''), tableX + 4, currentY + 2, { width: halfW - 8 });
    } else {
      doc.text('盘点人：' + (take.operator_name || ''), tableX + 4, currentY + 2, { width: halfW - 8 });
      doc.moveTo(tableX + 4, currentY + sigHeight - 14).lineTo(tableX + halfW - 4, currentY + sigHeight - 14).stroke();
      doc.text('签字：_______________', tableX + 4, currentY + sigHeight - 28, { width: halfW - 8 });
    }

    // 财务复核签字
    const rx = tableX + halfW + 20;
    doc.save();
    doc.rect(rx, currentY, halfW, sigHeight).stroke('#cccccc');
    doc.restore();
    if (take.reviewer_signature) {
      try {
        const base64Data = String(take.reviewer_signature).replace(/^data:image\/\w+;base64,/, '');
        const buf = Buffer.from(base64Data, 'base64');
        doc.image(buf, rx + 4, currentY + 18, { width: halfW - 8, height: sigHeight - 22, fit: [halfW - 8, sigHeight - 22] });
      } catch {}
      doc.text('财务复核：' + (take.reviewed_by_name || ''), rx + 4, currentY + 2, { width: halfW - 8 });
    } else {
      doc.text('财务复核：' + (take.reviewed_by_name || ''), rx + 4, currentY + 2, { width: halfW - 8 });
      doc.moveTo(rx + 4, currentY + sigHeight - 14).lineTo(rx + halfW - 4, currentY + sigHeight - 14).stroke();
      doc.text('签字：_______________', rx + 4, currentY + sigHeight - 28, { width: halfW - 8 });
    }

    doc.y = currentY + sigHeight + 15;
    doc.fontSize(7).font(hasChineseFont ? 'Chinese-Regular' : 'Helvetica').text(`生成时间：${new Date().toLocaleString('zh-CN')}`, { align: 'right' });

    doc.end();

    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    res.download(pdfPath, `${reportTitle}_${take.take_no}.pdf`, (err) => {
      if (err) console.error('[pdf download]', err);
    });
  } catch (err) {
    console.error('[stock-takes report-pdf]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 盘点历史趋势
 * GET /stock-takes/trends?warehouse_id=xxx&periods=6&take_type=monthly
 */
router.get('/trends', requireAuth, async (req, res) => {
  try {
    const { warehouse_id, periods = 6, take_type } = req.query;
    const limit = Math.min(Math.max(parseInt(periods, 10) || 6, 1), 36);
    const toNum = (v) => Number(v) || 0;

    const [rows] = await pool.query(`
      SELECT * FROM (
        SELECT st.period_month,
               IFNULL(SUM(sti.actual_value - sti.system_value), 0) as total_diff_value,
               COUNT(DISTINCT st.id) as take_count,
               GROUP_CONCAT(DISTINCT w.name) as warehouse_names
        FROM stock_takes st
        JOIN stock_take_items sti ON st.id = sti.stock_take_id
        JOIN warehouses w ON st.warehouse_id = w.id
        WHERE st.status = 'completed'
          AND (? IS NULL OR st.warehouse_id = ?)
          AND st.take_type = IFNULL(?, 'monthly')
        GROUP BY st.period_month
        ORDER BY st.period_month DESC
        LIMIT ?
      ) t ORDER BY t.period_month ASC
    `, [warehouse_id || null, warehouse_id || null, take_type || null, limit]);

    const result = rows.map(r => ({
      period_month: r.period_month,
      warehouse_name: r.warehouse_names || '-',
      total_diff_value: toNum(r.total_diff_value),
      take_count: r.take_count,
    }));

    res.json(result);
  } catch (err) {
    console.error('[stock-takes trends]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
