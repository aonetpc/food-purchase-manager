const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../db');
const { requireAuth, requireBookingWrite } = require('../middleware/rbac');
const { logOperation } = require('../middleware/logger');

// ------------------------------------------------------------
// 工具：JSON 字段兼容（mysql2 有些版本 JSON 返回 string）
// ------------------------------------------------------------
function parseMaybeJson(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch (_) { return null; }
  }
  return value;
}

// 把行中所有 JSON 字段 parse 掉（仅 items 表的 extra）
function normalizeItem(row) {
  return {
    ...row,
    extra: parseMaybeJson(row.extra),
  };
}

// 把前端传入的 extra 对象 stringify 成可写 SQL 的字符串
function stringifyExtra(extra) {
  if (extra == null) return null;
  return typeof extra === 'string' ? extra : JSON.stringify(extra);
}

// ------------------------------------------------------------
// 工具：日期范围（YYYY-MM-DD，按周起 +7 天）
// ------------------------------------------------------------
function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// ------------------------------------------------------------
// 工具：早餐派生（从同订单的体检 + 住宿日期推算）
// 返回 BookingItem shape 的数组（仅客户端/详情渲染用，不入库）
// ------------------------------------------------------------
function deriveBreakfastItems(items) {
  const checkups = items.filter(i => i.item_type === 'checkup');
  const lodgings = items.filter(i => i.item_type === 'lodging');
  const result = [];

  // 体检当天 => 早餐
  checkups.forEach(c => {
    result.push({
      id: 'bf-c-' + c.id,
      item_type: 'breakfast',
      date: c.date,
      start_time: '07:00',
      pax: c.pax,
      extra: {
        session: '自助',
        menu: '常规',
        packageCode: c.extra?.packageCode || null,
      },
      amount: 0,
      derived: true,
      derived_from: { type: 'checkup', id: c.id, customerDate: `${c.date} 体检 ${c.pax}人` },
    });
  });

  // 住宿入住日 → 第二天早餐，住几晚就派几天（入+次日~出+1日？按入住当晚住宿，次天早晨算）
  // 文档：早餐=住宿入住当晚 + 住宿退房日的次天早晨？按照前端 utils 实现：
  // 每个住宿项 item.extra.checkin/checkout 都会生成 [checkin, checkout) 每个日期的早餐
  lodgings.forEach(l => {
    const extra = l.extra || {};
    const rooms = extra.rooms || [];
    rooms.forEach(r => {
      const { checkin, checkout } = r || {};
      if (!checkin || !checkout) return;
      let cursor = checkin;
      let nights = 0;
      const maxNights = 30;
      while (cursor && cursor < checkout && nights < maxNights) {
        // 住宿当天入住，第二天早餐
        const nextDay = addDays(cursor, 1);
        const roomPax = (r.adultCount || 0) + (r.childCount || 0);
        if (roomPax > 0) {
          result.push({
            id: 'bf-l-' + l.id + '-' + cursor,
            item_type: 'breakfast',
            date: nextDay,
            start_time: '07:00',
            pax: roomPax,
            extra: {
              session: '自助',
              menu: '常规',
              roomTypeCode: r.roomTypeCode,
              roomIndex: r.index,
            },
            amount: 0,
            derived: true,
            derived_from: {
              type: 'lodging',
              id: l.id,
              customerDate: `${cursor} 入住 ${r.roomTypeName || r.roomTypeCode} ${roomPax}人`,
            },
          });
        }
        cursor = addDays(cursor, 1);
        nights++;
      }
    });
  });

  return result;
}

// ------------------------------------------------------------
// 订单号生成：BB + YYMMDD + 3位自增序号
// ------------------------------------------------------------
async function genOrderNo(today) {
  const y = today.getFullYear().toString().slice(2);
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  const prefix = `BB${y}${m}${d}`;
  const [rows] = await pool.query(
    `SELECT order_no FROM booking_orders WHERE order_no LIKE ? ORDER BY order_no DESC LIMIT 30`,
    [`${prefix}%`]
  );
  let next = 1;
  if (rows && rows.length) {
    rows.forEach(r => {
      const suf = parseInt((r.order_no || '').slice(prefix.length), 10) || 0;
      if (suf >= next) next = suf + 1;
    });
  }
  return `${prefix}${String(next).padStart(3, '0')}`;
}

// ------------------------------------------------------------
// 计算订单总金额（纯 items 累加，不包含 breakfast）
// ------------------------------------------------------------
function computeTotalAmount(items) {
  return (items || []).reduce((sum, it) => sum + (Number(it.amount) || 0), 0);
}

// ------------------------------------------------------------
// 读取订单（含 items，附带早餐派生数组）
// ------------------------------------------------------------
async function readOrderFull(orderId) {
  const [orderRows] = await pool.query('SELECT * FROM booking_orders WHERE id = ? LIMIT 1', [orderId]);
  if (!orderRows || orderRows.length === 0) return null;
  const order = orderRows[0];
  const [itemRows] = await pool.query('SELECT * FROM booking_items WHERE order_id = ? ORDER BY sort_order ASC, id ASC', [orderId]);
  const items = itemRows.map(normalizeItem);
  return {
    ...order,
    items,
    derivedBreakfasts: deriveBreakfastItems(items),
  };
}

// ============================================================
// 工具：写入 items 批量
// ============================================================
async function insertItems(conn, orderId, items) {
  if (!items || !items.length) return;
  const values = items.map((it, idx) => {
    return [
      uuidv4(),
      orderId,
      it.item_type,
      it.date,
      it.start_time || null,
      it.end_time || null,
      Number(it.pax) || 0,
      stringifyExtra(it.extra),
      Number(it.amount) || 0,
      idx + 1,
    ];
  });
  await conn.query(`
    INSERT INTO booking_items
      (id, order_id, item_type, date, start_time, end_time, pax, extra, amount, sort_order)
    VALUES ${values.map(() => '(?,?,?,?,?,?,?,?,?,?)').join(',')}
  `, values.flat());
}

const EDITABLE_STATUS = ['pending', 'reviewing', 'confirmed'];

// ============================================================
// GET /api/booking/config  业务常量（套餐/房型/会议厅/康乐）
// （固定路由，放最前）
// ============================================================
router.get('/config', requireAuth, async (_req, res) => {
  try {
    const [packages] = await pool.query('SELECT * FROM booking_packages WHERE status = 1 ORDER BY sort_order ASC, id ASC');
    const [roomTypes] = await pool.query('SELECT * FROM booking_room_types WHERE status = 1 ORDER BY sort_order ASC, id ASC');
    const [meetingHalls] = await pool.query('SELECT * FROM booking_meeting_halls WHERE status = 1 ORDER BY sort_order ASC, id ASC');
    const [wellnessTypes] = await pool.query('SELECT * FROM booking_wellness_types WHERE status = 1 ORDER BY sort_order ASC, id ASC');

    // 销售员列表：所有拥有 sales 角色的启用用户（用于销售员人员选择面板）
    let salesUsers = [];
    try {
      [salesUsers] = await pool.query(`
        SELECT DISTINCT u.id, u.name, u.username
        FROM users u
        INNER JOIN (
          SELECT user_id FROM user_roles ur
          JOIN roles r ON r.id = ur.role_id AND r.code = 'sales'
          UNION
          SELECT u2.id FROM users u2
          JOIN roles r2 ON r2.id = u2.role_id AND r2.code = 'sales'
        ) t ON t.user_id = u.id
        WHERE u.status = 1
        ORDER BY u.name ASC
      `);
    } catch (e) {
      // user_roles 表可能不存在，降级到 users.role_id
      try {
        [salesUsers] = await pool.query(`
          SELECT u.id, u.name, u.username
          FROM users u
          JOIN roles r ON r.id = u.role_id AND r.code = 'sales'
          WHERE u.status = 1
          ORDER BY u.name ASC
        `);
      } catch (e2) {
        salesUsers = [];
      }
    }

    res.json({
      ok: true,
      data: { packages, roomTypes, meetingHalls, wellnessTypes, salesUsers },
    });
  } catch (e) {
    console.error('[booking config] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// GET /api/booking/orders
// 按周查询订单列表（画板用）
// 参数：weekStart=YYYY-MM-DD（默认本周一）
//       status=xxx（可选，多值逗号分隔）
//       bizType=xxx（可选，多值逗号分隔）
//       salesPerson=xxx（可选）
//       customerName=xxx（可选，模糊）
// ============================================================
router.get('/orders', requireAuth, async (req, res) => {
  try {
    let { weekStart, weekEnd, status, bizType, salesPerson, customerName } = req.query;

    if (!weekStart) {
      const today = new Date();
      const dow = (today.getDay() + 6) % 7;
      weekStart = addDays(today.toISOString().slice(0, 10), -dow);
    }
    if (!weekEnd) weekEnd = addDays(weekStart, 6);

    const wheres = [];
    const params = [];

    // 日期覆盖：订单里任一 item 日期在范围内，或 没有 items 的 pending 草稿（待完善），或 不是模板的订单
    wheres.push(`(
      o.is_template = 0
      AND (
        o.id IN (SELECT DISTINCT order_id FROM booking_items WHERE date BETWEEN ? AND ?)
        OR (o.status = 'pending' AND o.id NOT IN (SELECT DISTINCT order_id FROM booking_items))
      )
    )`);
    params.push(weekStart, weekEnd);

    if (status) {
      const list = String(status).split(',').map(s => s.trim()).filter(Boolean);
      if (list.length) {
        wheres.push(`o.status IN (${list.map(() => '?').join(',')})`);
        params.push(...list);
      }
    }
    if (bizType) {
      const list = String(bizType).split(',').map(s => s.trim()).filter(Boolean);
      if (list.length) {
        wheres.push(`o.id IN (SELECT DISTINCT order_id FROM booking_items WHERE item_type IN (${list.map(() => '?').join(',')}))`);
        params.push(...list);
      }
    }
    if (salesPerson) {
      wheres.push('o.sales_person = ?');
      params.push(salesPerson);
    }
    if (customerName) {
      wheres.push('o.customer_name LIKE ?');
      params.push(`%${customerName}%`);
    }

    const whereSql = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';

    const [rows] = await pool.query(`
      SELECT o.* FROM booking_orders o
      ${whereSql}
      ORDER BY o.created_at DESC
      LIMIT 500
    `, params);

    if (!rows || rows.length === 0) {
      return res.json({
        ok: true,
        data: [],
        filters: { weekStart, weekEnd },
      });
    }

    const orderIds = rows.map(r => r.id);
    const [itemRows] = await pool.query(`
      SELECT * FROM booking_items WHERE order_id IN (${orderIds.map(() => '?').join(',')})
      ORDER BY sort_order ASC, id ASC
    `, orderIds);

    const itemsByOrder = {};
    itemRows.forEach(r => {
      if (!itemsByOrder[r.order_id]) itemsByOrder[r.order_id] = [];
      itemsByOrder[r.order_id].push(normalizeItem(r));
    });

    const orders = rows.map(o => {
      const items = itemsByOrder[o.id] || [];
      return {
        ...o,
        items,
        derivedBreakfasts: deriveBreakfastItems(items),
      };
    });

    res.json({
      ok: true,
      data: orders,
      filters: { weekStart, weekEnd },
    });
  } catch (e) {
    console.error('[booking GET /orders] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// POST /api/booking/orders  新建
// ============================================================
router.post('/orders', requireAuth, requireBookingWrite, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const user = req.user || {};
    const orderNo = await genOrderNo(new Date());

    // 过滤掉 breakfast 类型，不持久化
    const items = (req.body.items || []).filter(it => it.item_type !== 'breakfast');
    const totalAmount = computeTotalAmount(items);

    const orderId = uuidv4();
    await conn.query(`
      INSERT INTO booking_orders
        (id, order_no, customer_name, contact_name, contact_phone,
         sales_person, sales_person_id, payment_method, remark, status, total_amount,
         booker_id, booker_name)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, [
      orderId, orderNo,
      req.body.customerName || null,
      req.body.contactName || null,
      req.body.contactPhone || null,
      req.body.salesPerson || null,
      req.body.salesPersonId || null,
      req.body.paymentMethod || null,
      req.body.remark || null,
      'pending',
      totalAmount,
      user.id || null,
      user.name || user.realName || user.displayName || null,
    ]);

    await insertItems(conn, orderId, items);
    await conn.commit();
    logOperation(req, '预订订单', '创建', `订单号=${orderNo}`, orderId);

    const order = await readOrderFull(orderId);
    res.json({ ok: true, data: order });
  } catch (e) {
    await conn.rollback();
    console.error('[booking POST order] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    conn.release();
  }
});

// ============================================================
// 以下是 /orders/:id/* 子路径（更长的固定前缀），必须放在 /orders/:id 之前
// ============================================================

// POST /api/booking/orders/:id/duplicate  复制为新单
router.post('/orders/:id/duplicate', requireAuth, requireBookingWrite, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const user = req.user || {};

    const orderId = req.params.id;
    const [rows] = await conn.query('SELECT * FROM booking_orders WHERE id = ? LIMIT 1', [orderId]);
    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ ok: false, error: '原订单不存在' });
    }
    const src = rows[0];
    const [srcItems] = await conn.query(
      'SELECT * FROM booking_items WHERE order_id = ? ORDER BY sort_order ASC',
      [orderId]
    );

    // 复制规则：清空 rejected_* / confirmed_* / completed_* / rejected_at 等，状态回到 pending
    // 订单号重新生成
    const orderNo = await genOrderNo(new Date());
    const newOrderId = uuidv4();
    await conn.query(`
      INSERT INTO booking_orders
        (id, order_no, customer_name, contact_name, contact_phone,
         sales_person, payment_method, remark, status, total_amount,
         booker_id, booker_name)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `, [
      newOrderId, orderNo,
      src.customer_name, src.contact_name, src.contact_phone,
      src.sales_person, src.payment_method,
      req.body.clearRemark ? '' : (src.remark || ''),
      'pending',
      src.total_amount,
      user.id || src.booker_id,
      user.name || user.realName || user.displayName || src.booker_name,
    ]);

    // 复制 items：如果前端传了 item_date_shift_days，则每个 item.date 做偏移
    const shiftDays = Number(req.body.itemDateShiftDays) || 0;
    const clonedItems = srcItems.map(normalizeItem).map(it => ({
      ...it,
      date: shiftDays ? addDays(it.date, shiftDays) : it.date,
      // 住宿项的 rooms 的 checkin/checkout 也一起偏移
      extra: (it.item_type === 'lodging' && shiftDays)
        ? {
            ...it.extra,
            rooms: (it.extra?.rooms || []).map(r => ({
              ...r,
              checkin: r.checkin ? addDays(r.checkin, shiftDays) : null,
              checkout: r.checkout ? addDays(r.checkout, shiftDays) : null,
            })),
          }
        : it.extra,
    }));
    await insertItems(conn, newOrderId, clonedItems);

    await conn.commit();
    logOperation(req, '预订订单', '复制为新单', `原订单号=${src.order_no}，新订单号=${orderNo}`, newOrderId);

    const order = await readOrderFull(newOrderId);
    res.json({ ok: true, data: order });
  } catch (e) {
    await conn.rollback();
    console.error('[booking duplicate] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    conn.release();
  }
});

// POST /api/booking/orders/:id/submit   提交审核：pending → reviewing
router.post('/orders/:id/submit', requireAuth, requireBookingWrite, async (req, res) => {
  try {
    const orderId = req.params.id;
    const [rows] = await pool.query('SELECT * FROM booking_orders WHERE id = ? LIMIT 1', [orderId]);
    if (!rows.length) return res.status(404).json({ ok: false, error: '订单不存在' });
    const o = rows[0];
    if (o.status !== 'pending') return res.status(400).json({ ok: false, error: `状态 ${o.status} 不能提交` });

    await pool.query("UPDATE booking_orders SET status = 'reviewing' WHERE id = ?", [orderId]);
    logOperation(req, '预订订单', '提交审核', `订单号=${o.order_no}`, orderId);

    const order = await readOrderFull(orderId);
    res.json({ ok: true, data: order });
  } catch (e) {
    console.error('[booking submit] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/booking/orders/:id/approve  审核通过 reviewing → confirmed
router.post('/orders/:id/approve', requireAuth, requireBookingWrite, async (req, res) => {
  try {
    const user = req.user || {};
    const orderId = req.params.id;
    const [rows] = await pool.query('SELECT * FROM booking_orders WHERE id = ? LIMIT 1', [orderId]);
    if (!rows.length) return res.status(404).json({ ok: false, error: '订单不存在' });
    const o = rows[0];
    if (o.status !== 'reviewing') return res.status(400).json({ ok: false, error: `状态 ${o.status} 不能审核` });

    await pool.query(`
      UPDATE booking_orders SET
        status = 'confirmed', confirmed_at = NOW()
      WHERE id = ?
    `, [orderId]);
    logOperation(req, '预订订单', '审核通过', `订单号=${o.order_no} 审核人=${user.name || user.id}`, orderId);

    const order = await readOrderFull(orderId);
    res.json({ ok: true, data: order });
  } catch (e) {
    console.error('[booking approve] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/booking/orders/:id/reject   驳回
//   pending   → rejected（销售员自己驳回）
//   reviewing → rejected（总经理驳回）
router.post('/orders/:id/reject', requireAuth, requireBookingWrite, async (req, res) => {
  try {
    const user = req.user || {};
    const orderId = req.params.id;
    const [rows] = await pool.query('SELECT * FROM booking_orders WHERE id = ? LIMIT 1', [orderId]);
    if (!rows.length) return res.status(404).json({ ok: false, error: '订单不存在' });
    const o = rows[0];
    if (!['pending', 'reviewing'].includes(o.status)) {
      return res.status(400).json({ ok: false, error: `状态 ${o.status} 不能驳回` });
    }
    const rejectionReason = (req.body && req.body.rejectionReason) || '未填驳回原因';

    await pool.query(`
      UPDATE booking_orders SET
        status = 'rejected',
        rejected_by = ?, rejected_by_name = ?, rejection_reason = ?, rejected_at = NOW()
      WHERE id = ?
    `, [
      user.id || null,
      user.name || user.realName || user.displayName || null,
      rejectionReason,
      orderId,
    ]);
    logOperation(req, '预订订单', '驳回', `订单号=${o.order_no} 原因=${rejectionReason}`, orderId);

    const order = await readOrderFull(orderId);
    res.json({ ok: true, data: order });
  } catch (e) {
    console.error('[booking reject] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/booking/orders/:id/complete  标记完成 confirmed → completed
router.post('/orders/:id/complete', requireAuth, requireBookingWrite, async (req, res) => {
  try {
    const orderId = req.params.id;
    const [rows] = await pool.query('SELECT * FROM booking_orders WHERE id = ? LIMIT 1', [orderId]);
    if (!rows.length) return res.status(404).json({ ok: false, error: '订单不存在' });
    const o = rows[0];
    if (o.status !== 'confirmed') return res.status(400).json({ ok: false, error: `状态 ${o.status} 不能标记完成` });

    await pool.query("UPDATE booking_orders SET status = 'completed', completed_at = NOW() WHERE id = ?", [orderId]);
    logOperation(req, '预订订单', '标记完成', `订单号=${o.order_no}`, orderId);

    const order = await readOrderFull(orderId);
    res.json({ ok: true, data: order });
  } catch (e) {
    console.error('[booking complete] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// 以下是通配动态段 /:id 路由（放最后）
// ============================================================

// GET /api/booking/orders/:id
router.get('/orders/:id', requireAuth, async (req, res) => {
  try {
    const order = await readOrderFull(req.params.id);
    if (!order) return res.status(404).json({ ok: false, error: '订单不存在' });
    res.json({ ok: true, data: order });
  } catch (e) {
    console.error('[booking GET order] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// PUT /api/booking/orders/:id   编辑
// 允许状态：pending / reviewing / confirmed
router.put('/orders/:id', requireAuth, requireBookingWrite, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const orderId = req.params.id;
    const [rows] = await conn.query('SELECT * FROM booking_orders WHERE id = ? LIMIT 1 FOR UPDATE', [orderId]);
    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ ok: false, error: '订单不存在' });
    }
    const cur = rows[0];
    if (!EDITABLE_STATUS.includes(cur.status)) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: `当前状态 ${cur.status} 不允许编辑` });
    }

    const items = (req.body.items || []).filter(it => it.item_type !== 'breakfast');
    const totalAmount = computeTotalAmount(items);

    await conn.query(`
      UPDATE booking_orders SET
        customer_name = ?, contact_name = ?, contact_phone = ?,
        sales_person = ?, sales_person_id = ?, payment_method = ?, remark = ?, total_amount = ?
      WHERE id = ?
    `, [
      req.body.customerName || cur.customer_name,
      req.body.contactName || cur.contact_name,
      req.body.contactPhone || cur.contact_phone,
      req.body.salesPerson || cur.sales_person,
      req.body.salesPersonId || cur.sales_person_id,
      req.body.paymentMethod || cur.payment_method,
      req.body.remark ?? cur.remark,
      totalAmount,
      orderId,
    ]);

    // 先删旧 items，再插入新的（简单可靠）
    await conn.query('DELETE FROM booking_items WHERE order_id = ?', [orderId]);
    await insertItems(conn, orderId, items);

    await conn.commit();
    logOperation(req, '预订订单', '编辑', `订单号=${cur.order_no}`, orderId);

    const order = await readOrderFull(orderId);
    res.json({ ok: true, data: order });
  } catch (e) {
    await conn.rollback();
    console.error('[booking PUT order] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    conn.release();
  }
});

// ============================================================
// POST /api/booking/orders/:id/set-template
// 设为模板（传 template_name）
// ============================================================
router.post('/orders/:id/set-template', requireAuth, requireBookingWrite, async (req, res) => {
  try {
    const { templateName } = req.body;
    if (!templateName) return res.status(400).json({ ok: false, error: '模板名称必填' });
    const [existing] = await pool.query('SELECT id FROM booking_orders WHERE id=? AND is_template=0 LIMIT 1', [req.params.id]);
    if (!existing || !existing.length) return res.status(404).json({ ok: false, error: '订单不存在' });
    await pool.query('UPDATE booking_orders SET is_template=1, template_name=? WHERE id=?', [templateName, req.params.id]);
    logOperation(req, '预订订单', '设为模板', `模板名=${templateName}`, req.params.id);
    res.json({ ok: true });
  } catch (e) {
    console.error('[booking set-template] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// POST /api/booking/orders/:id/unset-template
// 取消模板
// ============================================================
router.post('/orders/:id/unset-template', requireAuth, requireBookingWrite, async (req, res) => {
  try {
    const [existing] = await pool.query('SELECT id FROM booking_orders WHERE id=? AND is_template=1 LIMIT 1', [req.params.id]);
    if (!existing || !existing.length) return res.status(404).json({ ok: false, error: '模板不存在' });
    await pool.query('UPDATE booking_orders SET is_template=0, template_name=NULL WHERE id=?', [req.params.id]);
    logOperation(req, '预订订单', '取消模板', '', req.params.id);
    res.json({ ok: true });
  } catch (e) {
    console.error('[booking unset-template] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// GET /api/booking/templates
// 模板列表（精简信息+items）
// ============================================================
router.get('/templates', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT id, order_no, customer_name, template_name, total_amount, remark
      FROM booking_orders
      WHERE is_template = 1
      ORDER BY updated_at DESC
      LIMIT 100
    `);
    if (!rows || rows.length === 0) return res.json({ ok: true, data: [] });
    const ids = rows.map(r => r.id);
    const [itemRows] = await pool.query(
      `SELECT * FROM booking_items WHERE order_id IN (${ids.map(() => '?').join(',')}) ORDER BY sort_order ASC, id ASC`,
      ids
    );
    const itemsMap = {};
    itemRows.forEach(r => {
      if (!itemsMap[r.order_id]) itemsMap[r.order_id] = [];
      itemsMap[r.order_id].push(normalizeItem(r));
    });
    const data = rows.map(r => ({
      id: r.id,
      orderNo: r.order_no,
      customerName: r.customer_name,
      templateName: r.template_name,
      totalAmount: Number(r.total_amount) || 0,
      remark: r.remark,
      items: itemsMap[r.id] || [],
    }));
    res.json({ ok: true, data });
  } catch (e) {
    console.error('[booking GET templates] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// POST /api/booking/templates/:id/apply
// 从模板创建草稿订单（日期偏移到以今天为基准的本周）
// ============================================================
router.post('/templates/:id/apply', requireAuth, requireBookingWrite, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [tpl] = await pool.query('SELECT * FROM booking_orders WHERE id=? AND is_template=1 LIMIT 1', [req.params.id]);
    if (!tpl || !tpl.length) return res.status(404).json({ ok: false, error: '模板不存在' });

    const today = new Date();
    const newOrderNo = await genOrderNo(today);
    const newId = require('uuid').v4();
    const userName = (req.user && (req.user.name || req.user.userName)) || '';

    await conn.query(`
      INSERT INTO booking_orders (id, order_no, customer_name, contact_name, contact_phone,
        sales_person, payment_method, remark, status, total_amount, booker_id, booker_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `, [
      newId, newOrderNo,
      tpl.customer_name, tpl.contact_name, tpl.contact_phone,
      tpl.sales_person, tpl.payment_method,
      `[从模板创建] ${tpl.template_name || ''}`,
      Number(tpl.total_amount) || 0,
      req.user && req.user.id ? req.user.id : null,
      userName,
    ]);

    // 复制 items，同时日期偏移：以模板第一个 item 的日期为基准，对齐到"今天所在周"
    const [origItems] = await conn.query('SELECT * FROM booking_items WHERE order_id = ? ORDER BY sort_order ASC, id ASC', [tpl.id]);
    let baseOrigDate = null;
    origItems.forEach(ri => { if (ri.date && !baseOrigDate) baseOrigDate = new Date(String(ri.date).slice(0, 10)); });
    const dow = (today.getDay() + 6) % 7; // 今天是周几(0=周一)
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - dow);

    let sort = 0;
    for (const ri of origItems) {
      let newDate = null;
      if (ri.date && baseOrigDate) {
        const origD = new Date(String(ri.date).slice(0, 10));
        const diff = Math.round((origD - baseOrigDate) / 86400000);
        const target = new Date(weekStart);
        target.setDate(weekStart.getDate() + diff);
        newDate = target.toISOString().slice(0, 10);
      }
      sort += 10;
      await conn.query(`
        INSERT INTO booking_items (id, order_id, item_type, date, adult_count, child_count,
          qty, unit_price, amount, package_code, package_name, remark, extra, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        require('uuid').v4(), newId, ri.item_type, newDate,
        ri.adult_count, ri.child_count, ri.qty, ri.unit_price, ri.amount,
        ri.package_code, ri.package_name, ri.remark, ri.extra, sort,
      ]);
    }

    await conn.commit();
    logOperation(req, '预订订单', '从模板创建', `模板=${tpl.template_name}`, newId);
    const order = await readOrderFull(newId);
    res.json({ ok: true, data: order });
  } catch (e) {
    await conn.rollback();
    console.error('[booking template apply] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
