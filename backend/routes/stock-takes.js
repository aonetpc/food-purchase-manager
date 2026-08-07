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
 *
 *   H5端（独立token认证，P2实现）：
 *     GET    /stock-takes/h5/meta            H5页面初始化
 *     PUT    /stock-takes/h5/save            H5保存实盘
 *     POST   /stock-takes/h5/submit          H5提交复核
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

// ================================================
// PC端接口
// ================================================

/**
 * 进度看板：某月各需盘点仓库的状态
 * GET /stock-takes/progress/:month  (month格式: 2025-07)
 */
router.get('/progress/:month', requireAuth, async (req, res) => {
  try {
    const { month } = req.params; // YYYY-MM

    // 查所有需要盘点的仓库
    const [warehouses] = await pool.query(`
      SELECT w.id, w.name, w.type, w.manager_userid, w.confirmer_userid,
             d.name as department_name,
             w.department_id
      FROM warehouses w
      LEFT JOIN departments d ON w.department_id = d.id
      WHERE w.status = 1 AND w.enable_stock_take = 1
      ORDER BY w.sort_order ASC
    `);

    // 查该月各仓库的盘点单
    const [takes] = await pool.query(`
      SELECT id, warehouse_id, take_no, status, review_result,
             operator_name, reviewed_by_name, reviewed_at,
             created_at, period_month
      FROM stock_takes
      WHERE period_month = ?
      ORDER BY created_at DESC
    `, [month]);

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
 * GET /stock-takes?period_month=2025-07&warehouse_id=xxx
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const { period_month, warehouse_id, status } = req.query;
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
 * body: { warehouse_id, period_month, remark }
 */
router.post('/', requireAuth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { warehouse_id, period_month, remark } = req.body;
    if (!warehouse_id) return res.status(400).json({ error: '请选择仓库' });
    if (!period_month) return res.status(400).json({ error: '请选择归属月份' });

    // 检查仓库是否参与盘点
    const [wh] = await conn.query('SELECT * FROM warehouses WHERE id = ? AND status = 1', [warehouse_id]);
    if (wh.length === 0) return res.status(400).json({ error: '仓库不存在' });
    if (!wh[0].enable_stock_take) return res.status(400).json({ error: '该仓库未开启月末盘点' });

    // 检查该仓库该月是否已有未完成的盘点
    const [existing] = await conn.query(
      "SELECT id FROM stock_takes WHERE warehouse_id = ? AND period_month = ? AND status NOT IN ('completed', 'cancelled')",
      [warehouse_id, period_month]
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
                               access_token, access_expired_at, total_value, cost_summary,
                               created_by, created_by_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, 0, NULL, ?, ?, NOW(), NOW())
    `, [id, takeNo, warehouse_id, wh[0].name, period_month, remark || null,
        accessToken, expiredAt,
        req.user.id, req.user.name || req.user.username]);

    // 拉取该仓库库存>0的物资生成明细
    const [invItems] = await conn.query(`
      SELECT i.item_id, i.quantity, i.unit,
             wi.name, wi.spec, wi.reference_price,
             wc.name as category_name
      FROM inventory i
      JOIN warehouse_items wi ON i.item_id = wi.id
      LEFT JOIN warehouse_categories wc ON wi.category_id = wc.id
      WHERE i.warehouse_id = ? AND i.quantity > 0 AND wi.status = 1
      ORDER BY wc.name ASC, wi.name ASC
    `, [warehouse_id]);

    for (const item of invItems) {
      const itemId = uuidv4();
      const systemQty = Number(item.quantity);
      const unitPrice = Number(item.reference_price) || 0;
      const systemValue = systemQty * unitPrice;
      await conn.query(`
        INSERT INTO stock_take_items (id, stock_take_id, item_id, item_name, category_name, spec, unit,
                                      system_quantity, actual_quantity, difference, unit_price,
                                      system_value, actual_value, is_sampled, remark)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, 0, 0, NULL)
      `, [itemId, id, item.item_id, item.name, item.category_name || null,
          item.spec || null, item.unit, systemQty, unitPrice, systemValue]);
    }

    await conn.commit();

    // 返回详情
    const [takeRows] = await pool.query('SELECT * FROM stock_takes WHERE id = ?', [id]);
    const [items] = await pool.query('SELECT * FROM stock_take_items WHERE stock_take_id = ? ORDER BY category_name, item_name', [id]);

    res.json({
      ...takeRows[0],
      items,
      message: `盘点单已创建，共${invItems.length}项物资`,
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
 * 删除盘点单（仅draft/returned）
 * DELETE /stock-takes/:id
 */
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [takeRows] = await pool.query('SELECT * FROM stock_takes WHERE id = ?', [id]);
    if (takeRows.length === 0) return res.status(404).json({ error: '盘点单不存在' });
    if (!['draft', 'returned'].includes(takeRows[0].status)) {
      return res.status(400).json({ error: '仅草稿或退回状态可删除' });
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
 */
router.post('/:id/submit', requireAuth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;
    const [takeRows] = await conn.query('SELECT * FROM stock_takes WHERE id = ?', [id]);
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
    // 提交时清空review_sample（退回重提需重新随机）
    await conn.query(`
      UPDATE stock_takes SET status = 'submitted', review_sample = NULL,
             operator_id = ?, operator_name = ?, updated_at = NOW()
      WHERE id = ?
    `, [req.user.id, req.user.name || req.user.username, id]);

    await conn.commit();
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
 * body: { action: 'pass'|'return', samples: [{item_detail_id, verify_quantity}], return_reason }
 */
router.post('/:id/review', requireAuth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;
    const { action, samples, return_reason } = req.body;

    if (!await canReview(req.user)) {
      conn.release();
      return res.status(403).json({ error: '仅财务/管理员可复核' });
    }

    const [takeRows] = await conn.query('SELECT * FROM stock_takes WHERE id = ?', [id]);
    if (takeRows.length === 0) {
      conn.release();
      return res.status(404).json({ error: '盘点单不存在' });
    }
    const take = takeRows[0];
    if (take.status !== 'reviewing') {
      conn.release();
      return res.status(400).json({ error: `当前状态(${take.status})不可复核` });
    }

    // 退回
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
      return res.json({ success: true, message: '已退回，通知盘点人修改' });
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
                             cost_summary = ?, updated_at = NOW()
      WHERE id = ?
    `, [JSON.stringify(updatedSamples), req.user.id, req.user.name || req.user.username,
        JSON.stringify(costSummary), id]);

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

    // 构建H5链接
    const baseUrl = process.env.WECOM_APP_URL || process.env.FRONTEND_URL || '';
    const h5Url = `${baseUrl}/stock-take-operate?token=${newToken}`;

    const title = type === 'init' ? '月末盘点通知' : '盘点催办提醒';
    const cardContent = {
      card_type: 'button_interaction',
      main_title: { title: `${take.warehouse_name} - ${take.period_month}月末盘点`, desc: title },
      sub_title_text: `盘点单号：${take.take_no}\n请尽快完成盘点并提交复核`,
      emphasis_content: { title: take.period_month, desc: '归属月份' },
      button_list: [{
        text: '开始盘点',
        type: 1,
        url: h5Url,
      }],
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

module.exports = router;
