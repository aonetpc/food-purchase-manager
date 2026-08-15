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
    // 套餐（包含 items）
    const [packagesRaw] = await pool.query('SELECT * FROM booking_packages WHERE status = 1 ORDER BY sort_order ASC, id ASC');
    // 批量加载每个套餐的项目：item_price=0 或 name 空时自动回填 checkup_items.default_price/name
    const packages = [];
    for (const p of packagesRaw) {
      const [items] = await pool.query(
        `SELECT pi.id, pi.package_id, pi.item_id,
                CASE WHEN (pi.item_name_snapshot IS NULL OR pi.item_name_snapshot = '') THEN ci.name ELSE pi.item_name_snapshot END AS item_name_snapshot,
                CASE WHEN (pi.item_price IS NULL OR pi.item_price = 0)     THEN ci.default_price ELSE pi.item_price END AS item_price,
                CASE WHEN (pi.insurance_price_snapshot IS NULL OR pi.insurance_price_snapshot = 0) THEN ci.insurance_price ELSE pi.insurance_price_snapshot END AS insurance_price_snapshot,
                pi.quantity, pi.remark, pi.sort_order
         FROM booking_package_items AS pi
         LEFT JOIN booking_checkup_items AS ci ON ci.id = pi.item_id
         WHERE pi.package_id = ?
         ORDER BY pi.sort_order ASC`,
        [p.id]
      );
      const autoTotal = items.reduce((s, i) => s + Number(i.item_price || 0) * Number(i.quantity || 1), 0);
      packages.push({ ...p, items, item_count: items.length, auto_total: autoTotal });
    }

    const [roomTypes] = await pool.query('SELECT * FROM booking_room_types WHERE status = 1 ORDER BY sort_order ASC, id ASC');
    const [meetingHalls] = await pool.query('SELECT * FROM booking_meeting_halls WHERE status = 1 ORDER BY sort_order ASC, id ASC');
    const [wellnessTypes] = await pool.query('SELECT * FROM booking_wellness_types WHERE status = 1 ORDER BY sort_order ASC, id ASC');
    const [mealTypes] = await pool.query('SELECT * FROM booking_meal_types WHERE status = 1 ORDER BY sort_order ASC, id ASC');
    // 体检项目主表（全部，含禁用，供前端管理面板使用）
    const [checkupItems] = await pool.query('SELECT * FROM booking_checkup_items ORDER BY category ASC, sort_order ASC, id ASC');

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
      data: { packages, roomTypes, meetingHalls, wellnessTypes, mealTypes, checkupItems, salesUsers },
    });
  } catch (e) {
    console.error('[booking config] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// 业务常量 CRUD（体检套餐 / 房型 / 会议厅 / 康乐项目）
// 公用读写权限：写 requireBookingWrite  读 requireAuth
// ============================================================

function makeBizConfigCrud({ basePath, table, requiredFields, editableFields, sortDefault, autoIncrementId }) {
  // list（含禁用，按 sort_order+id 排）
  router.get(`${basePath}`, requireAuth, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT * FROM ${table} ORDER BY sort_order ASC, id ASC`
      );
      res.json({ ok: true, data: rows });
    } catch (e) {
      console.error(`[${basePath} list] error:`, e);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // create
  router.post(`${basePath}`, requireAuth, requireBookingWrite, async (req, res) => {
    const conn = await pool.getConnection();
    try {
      for (const f of requiredFields) {
        if (req.body[f] === undefined || req.body[f] === null || req.body[f] === '') {
          return res.status(400).json({ ok: false, error: `缺少必要字段：${f}` });
        }
      }
      let id;
      const fields = [...requiredFields, ...editableFields.filter(f => req.body[f] !== undefined)];
      const values = [...requiredFields.map(f => req.body[f])];
      editableFields.filter(f => req.body[f] !== undefined).forEach(f => values.push(req.body[f]));
      if (!fields.includes('sort_order')) { fields.push('sort_order'); values.push(sortDefault != null ? sortDefault : 0); }
      if (!fields.includes('status')) { fields.push('status'); values.push(1); }
      if (!autoIncrementId) {
        id = uuidv4();
        fields.unshift('id');
        values.unshift(id);
      }
      const placeholders = fields.map(() => '?').join(',');
      await conn.query(`INSERT INTO ${table} (${fields.join(',')}) VALUES (${placeholders})`, values);
      if (autoIncrementId) {
        const [idRes] = await conn.query('SELECT LAST_INSERT_ID() AS newId');
        id = idRes[0].newId;
      }
      const [rows] = await conn.query(`SELECT * FROM ${table} WHERE id = ?`, [id]);
      await logOperation(req.user.id, String(id), table, 'create', req.body, req);
      res.json({ ok: true, data: rows[0] });
    } catch (e) {
      console.error(`[${basePath} create] error:`, e);
      res.status(500).json({ ok: false, error: e.message });
    } finally {
      conn.release();
    }
  });

  // update
  router.put(`${basePath}/:id`, requireAuth, requireBookingWrite, async (req, res) => {
    const conn = await pool.getConnection();
    try {
      const { id } = req.params;
      const [exist] = await conn.query(`SELECT * FROM ${table} WHERE id = ?`, [id]);
      if (exist.length === 0) return res.status(404).json({ ok: false, error: '记录不存在' });
      const sets = [];
      const values = [];
      [...requiredFields, ...editableFields].forEach(f => {
        if (req.body[f] !== undefined) { sets.push(`${f} = ?`); values.push(req.body[f]); }
      });
      if (sets.length > 0) {
        values.push(id);
        await conn.query(`UPDATE ${table} SET ${sets.join(',')} WHERE id = ?`, values);
      }
      const [rows] = await conn.query(`SELECT * FROM ${table} WHERE id = ?`, [id]);
      await logOperation(req.user.id, id, table, 'update', req.body, req);
      res.json({ ok: true, data: rows[0] });
    } catch (e) {
      console.error(`[${basePath} update] error:`, e);
      res.status(500).json({ ok: false, error: e.message });
    } finally {
      conn.release();
    }
  });

  // delete（软删除：status=0）
  router.delete(`${basePath}/:id`, requireAuth, requireBookingWrite, async (req, res) => {
    try {
      const { id } = req.params;
      await pool.query(`UPDATE ${table} SET status = 0 WHERE id = ?`, [id]);
      await logOperation(req.user.id, id, table, 'delete', {}, req);
      res.json({ ok: true });
    } catch (e) {
      console.error(`[${basePath} delete] error:`, e);
      res.status(500).json({ ok: false, error: e.message });
    }
  });
}

// ============================================================
// 体检套餐增强：list 返回附带 items + 自动计算 item_count/price
// ============================================================
function enhancePackageList(routerRef) {
  // 覆盖 packages list：附带 items
  routerRef.get('/config/packages', requireAuth, async (req, res) => {
    try {
      const [packages] = await pool.query(
        `SELECT * FROM booking_packages ORDER BY sort_order ASC, id ASC`
      );
      // 批量加载每个套餐的项目
      // 注意：item_price / item_name_snapshot 若被历史重导清空（item_price=0 或 name 空串），
      //       这里会自动从 booking_checkup_items 回填 default_price/name，保证原价和名称能正确显示
      const result = [];
      for (const p of packages) {
        const [items] = await pool.query(
          `SELECT pi.id, pi.package_id, pi.item_id,
                  CASE WHEN (pi.item_name_snapshot IS NULL OR pi.item_name_snapshot = '') THEN ci.name ELSE pi.item_name_snapshot END AS item_name_snapshot,
                  CASE WHEN (pi.item_price IS NULL OR pi.item_price = 0)     THEN ci.default_price ELSE pi.item_price END AS item_price,
                  CASE WHEN (pi.insurance_price_snapshot IS NULL OR pi.insurance_price_snapshot = 0) THEN ci.insurance_price ELSE pi.insurance_price_snapshot END AS insurance_price_snapshot,
                  pi.quantity, pi.remark, pi.sort_order
           FROM booking_package_items AS pi
           LEFT JOIN booking_checkup_items AS ci ON ci.id = pi.item_id
           WHERE pi.package_id = ?
           ORDER BY pi.sort_order ASC`,
          [p.id]
        );
        const autoTotal = items.reduce((s, i) => s + Number(i.item_price || 0) * Number(i.quantity || 1), 0);
        result.push({
          ...p,
          items,
          item_count: items.length,
          auto_total: autoTotal,
        });
      }
      res.json({ ok: true, data: result });
    } catch (e) {
      console.error('[packages list enhanced] error:', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 覆盖 package create：同时初始化 item_count
  routerRef.post('/config/packages', requireAuth, requireBookingWrite, async (req, res) => {
    const conn = await pool.getConnection();
    try {
      const { code, name, price, status, sort_order, remark } = req.body;
      if (!code || !name) return res.status(400).json({ ok: false, error: '缺少必要字段：code / name' });
      const id = uuidv4();
      await conn.query(
        `INSERT INTO booking_packages (id, code, name, price, status, sort_order, item_count, remark) VALUES (?,?,?,?,?,?,0,?)`,
        [id, code, name, price || 0, status != null ? status : 1, sort_order != null ? sort_order : 1, remark || null]
      );
      const [rows] = await conn.query(`SELECT * FROM booking_packages WHERE id = ?`, [id]);
      const [items] = await conn.query(`SELECT * FROM booking_package_items WHERE package_id = ?`, [id]);
      await logOperation(req.user.id, id, 'booking_packages', 'create', req.body, req);
      res.json({ ok: true, data: { ...rows[0], items, item_count: 0, auto_total: 0 } });
    } catch (e) {
      console.error('[packages create] error:', e);
      res.status(500).json({ ok: false, error: e.message });
    } finally {
      conn.release();
    }
  });

  // 覆盖 package update：支持 remark 字段 + 自动重算
  routerRef.put('/config/packages/:id', requireAuth, requireBookingWrite, async (req, res) => {
    const conn = await pool.getConnection();
    try {
      const { id } = req.params;
      const [exist] = await conn.query(`SELECT * FROM booking_packages WHERE id = ?`, [id]);
      if (exist.length === 0) return res.status(404).json({ ok: false, error: '记录不存在' });
      const sets = [];
      const values = [];
      ['code','name','price','status','sort_order','remark'].forEach(f => {
        if (req.body[f] !== undefined) { sets.push(`${f} = ?`); values.push(req.body[f]); }
      });
      if (sets.length > 0) {
        values.push(id);
        await conn.query(`UPDATE booking_packages SET ${sets.join(',')} WHERE id = ?`, values);
      }
      // 自动重算 item_count
      await conn.query(
        `UPDATE booking_packages p SET item_count = (SELECT COUNT(*) FROM booking_package_items pi WHERE pi.package_id = p.id) WHERE p.id = ?`,
        [id]
      );
      const [rows] = await conn.query(`SELECT * FROM booking_packages WHERE id = ?`, [id]);
      const [items] = await conn.query(
        `SELECT pi.id, pi.package_id, pi.item_id,
                CASE WHEN (pi.item_name_snapshot IS NULL OR pi.item_name_snapshot = '') THEN ci.name ELSE pi.item_name_snapshot END AS item_name_snapshot,
                CASE WHEN (pi.item_price IS NULL OR pi.item_price = 0)     THEN ci.default_price ELSE pi.item_price END AS item_price,
                CASE WHEN (pi.insurance_price_snapshot IS NULL OR pi.insurance_price_snapshot = 0) THEN ci.insurance_price ELSE pi.insurance_price_snapshot END AS insurance_price_snapshot,
                pi.quantity, pi.remark, pi.sort_order
         FROM booking_package_items AS pi
         LEFT JOIN booking_checkup_items AS ci ON ci.id = pi.item_id
         WHERE pi.package_id = ?
         ORDER BY pi.sort_order ASC`,
        [id]
      );
      const autoTotal = items.reduce((s, i) => s + Number(i.item_price || 0) * Number(i.quantity || 1), 0);
      await logOperation(req.user.id, id, 'booking_packages', 'update', req.body, req);
      res.json({ ok: true, data: { ...rows[0], items, item_count: items.length, auto_total: autoTotal } });
    } catch (e) {
      console.error('[packages update] error:', e);
      res.status(500).json({ ok: false, error: e.message });
    } finally {
      conn.release();
    }
  });

  // get single package with items
  routerRef.get('/config/packages/:id', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const [rows] = await pool.query(`SELECT * FROM booking_packages WHERE id = ?`, [id]);
      if (rows.length === 0) return res.status(404).json({ ok: false, error: '套餐不存在' });
      const [items] = await pool.query(
        `SELECT pi.id, pi.package_id, pi.item_id,
                CASE WHEN (pi.item_name_snapshot IS NULL OR pi.item_name_snapshot = '') THEN ci.name ELSE pi.item_name_snapshot END AS item_name_snapshot,
                CASE WHEN (pi.item_price IS NULL OR pi.item_price = 0)     THEN ci.default_price ELSE pi.item_price END AS item_price,
                CASE WHEN (pi.insurance_price_snapshot IS NULL OR pi.insurance_price_snapshot = 0) THEN ci.insurance_price ELSE pi.insurance_price_snapshot END AS insurance_price_snapshot,
                pi.quantity, pi.remark, pi.sort_order
         FROM booking_package_items AS pi
         LEFT JOIN booking_checkup_items AS ci ON ci.id = pi.item_id
         WHERE pi.package_id = ?
         ORDER BY pi.sort_order ASC`,
        [id]
      );
      const autoTotal = items.reduce((s, i) => s + Number(i.item_price || 0) * Number(i.quantity || 1), 0);
      res.json({ ok: true, data: { ...rows[0], items, item_count: items.length, auto_total: autoTotal } });
    } catch (e) {
      console.error('[package detail] error:', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // delete package（级联删除关联的项目）
  routerRef.delete('/config/packages/:id', requireAuth, requireBookingWrite, async (req, res) => {
    const conn = await pool.getConnection();
    try {
      const { id } = req.params;
      // 软删除套餐（status=0）+ 删除关联的项目（跟随禁用逻辑，方便恢复）
      await conn.query(`UPDATE booking_packages SET status = 0 WHERE id = ?`, [id]);
      await conn.query(`DELETE FROM booking_package_items WHERE package_id = ?`, [id]);
      await logOperation(req.user.id, id, 'booking_packages', 'delete', {}, req);
      res.json({ ok: true });
    } catch (e) {
      console.error('[packages delete] error:', e);
      res.status(500).json({ ok: false, error: e.message });
    } finally {
      conn.release();
    }
  });
}

// 先移除 makeBizConfigCrud 生成的默认 packages 路由（通过在后面注册增强版本实现覆盖）
// 注意：Express 按注册顺序匹配，所以我们通过增强版本实现完整逻辑
// makeBizConfigCrud 调用在下方，但实际生效的是增强版本

// 体检项目主表 CRUD（检查项目字典）
function makeCheckupItemCrud(routerRef) {
  const basePath = '/config/checkup-items';
  const table = 'booking_checkup_items';
  const requiredFields = ['code', 'name'];
  const editableFields = ['item_type', 'category', 'description', 'default_price', 'insurance_price', 'unit', 'status', 'sort_order'];

  // 查询组合项目的子项目列表
  async function getSubItems(conn, comboItemId) {
    const [subs] = await conn.query(
      `SELECT si.sub_item_id, si.sort_order, ci.name, ci.code, ci.default_price, ci.insurance_price, ci.category, ci.unit
       FROM booking_item_sub_items si
       JOIN booking_checkup_items ci ON ci.id = si.sub_item_id
       WHERE si.combo_item_id = ? ORDER BY si.sort_order ASC`,
      [comboItemId]
    );
    return subs;
  }

  // 保存组合项目的子项目关联（先删后插）
  async function saveSubItems(conn, comboItemId, subItemIds) {
    await conn.query(`DELETE FROM booking_item_sub_items WHERE combo_item_id = ?`, [comboItemId]);
    if (subItemIds && subItemIds.length > 0) {
      for (let i = 0; i < subItemIds.length; i++) {
        await conn.query(
          `INSERT IGNORE INTO booking_item_sub_items (id, combo_item_id, sub_item_id, sort_order) VALUES (UUID(), ?, ?, ?)`,
          [comboItemId, subItemIds[i], (i + 1) * 10]
        );
      }
    }
  }

  routerRef.get(`${basePath}`, requireAuth, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT * FROM ${table} ORDER BY category ASC, sort_order ASC, id ASC`
      );
      // 为组合项目附加子项目列表
      const conn = await pool.getConnection();
      try {
        for (const row of rows) {
          if (row.item_type === 'combo') {
            row.sub_items = await getSubItems(conn, row.id);
          }
        }
      } finally {
        conn.release();
      }
      res.json({ ok: true, data: rows });
    } catch (e) {
      console.error(`[${basePath} list] error:`, e);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  routerRef.post(`${basePath}`, requireAuth, requireBookingWrite, async (req, res) => {
    const conn = await pool.getConnection();
    try {
      for (const f of requiredFields) {
        if (req.body[f] === undefined || req.body[f] === null || req.body[f] === '') {
          return res.status(400).json({ ok: false, error: `缺少必要字段：${f}` });
        }
      }
      const id = uuidv4();
      const fields = ['id', ...requiredFields, ...editableFields.filter(f => req.body[f] !== undefined)];
      const values = [id, ...requiredFields.map(f => req.body[f])];
      editableFields.filter(f => req.body[f] !== undefined).forEach(f => values.push(req.body[f]));
      if (!fields.includes('item_type')) { fields.push('item_type'); values.push('item'); }
      if (!fields.includes('default_price')) { fields.push('default_price'); values.push(0); }
      if (!fields.includes('insurance_price')) { fields.push('insurance_price'); values.push(0); }
      if (!fields.includes('unit')) { fields.push('unit'); values.push('次'); }
      if (!fields.includes('category')) { fields.push('category'); values.push('化验'); }
      if (!fields.includes('sort_order')) { fields.push('sort_order'); values.push(100); }
      if (!fields.includes('status')) { fields.push('status'); values.push(1); }
      const placeholders = fields.map(() => '?').join(',');
      await conn.query(`INSERT INTO ${table} (${fields.join(',')}) VALUES (${placeholders})`, values);
      // 保存子项目关联
      if (req.body.item_type === 'combo' && Array.isArray(req.body.sub_item_ids)) {
        await saveSubItems(conn, id, req.body.sub_item_ids);
      }
      const [rows] = await conn.query(`SELECT * FROM ${table} WHERE id = ?`, [id]);
      if (rows[0].item_type === 'combo') {
        rows[0].sub_items = await getSubItems(conn, id);
      }
      await logOperation(req.user.id, id, table, 'create', req.body, req);
      res.json({ ok: true, data: rows[0] });
    } catch (e) {
      console.error(`[${basePath} create] error:`, e);
      res.status(500).json({ ok: false, error: e.message });
    } finally {
      conn.release();
    }
  });

  routerRef.put(`${basePath}/:id`, requireAuth, requireBookingWrite, async (req, res) => {
    const conn = await pool.getConnection();
    try {
      const { id } = req.params;
      const [exist] = await conn.query(`SELECT * FROM ${table} WHERE id = ?`, [id]);
      if (exist.length === 0) return res.status(404).json({ ok: false, error: '记录不存在' });
      const sets = [];
      const values = [];
      [...requiredFields, ...editableFields].forEach(f => {
        if (req.body[f] !== undefined) { sets.push(`${f} = ?`); values.push(req.body[f]); }
      });
      if (sets.length > 0) {
        values.push(id);
        await conn.query(`UPDATE ${table} SET ${sets.join(',')} WHERE id = ?`, values);
      }
      // 同步更新套餐-项目关联表中的名称快照
      if (req.body.name !== undefined) {
        await conn.query(
          `UPDATE booking_package_items SET item_name_snapshot = ? WHERE item_id = ?`,
          [req.body.name, id]
        );
      }
      // 更新子项目关联
      if (Array.isArray(req.body.sub_item_ids)) {
        await saveSubItems(conn, id, req.body.sub_item_ids);
      }
      const [rows] = await conn.query(`SELECT * FROM ${table} WHERE id = ?`, [id]);
      if (rows[0].item_type === 'combo') {
        rows[0].sub_items = await getSubItems(conn, id);
      }
      await logOperation(req.user.id, id, table, 'update', req.body, req);
      res.json({ ok: true, data: rows[0] });
    } catch (e) {
      console.error(`[${basePath} update] error:`, e);
      res.status(500).json({ ok: false, error: e.message });
    } finally {
      conn.release();
    }
  });

  routerRef.delete(`${basePath}/:id`, requireAuth, requireBookingWrite, async (req, res) => {
    try {
      const { id } = req.params;
      await pool.query(`UPDATE ${table} SET status = 0 WHERE id = ?`, [id]);
      await logOperation(req.user.id, id, table, 'delete', {}, req);
      res.json({ ok: true });
    } catch (e) {
      console.error(`[${basePath} delete] error:`, e);
      res.status(500).json({ ok: false, error: e.message });
    }
  });
}

// 套餐内项目 CRUD（子资源）
function makePackageItemCrud(routerRef) {
  // list package items：item_price=0 或 name 空时自动回填 checkup_items 表
  routerRef.get('/config/packages/:pkgId/items', requireAuth, async (req, res) => {
    try {
      const { pkgId } = req.params;
      const [rows] = await pool.query(
        `SELECT pi.id, pi.package_id, pi.item_id,
                CASE WHEN (pi.item_name_snapshot IS NULL OR pi.item_name_snapshot = '') THEN ci.name ELSE pi.item_name_snapshot END AS item_name_snapshot,
                CASE WHEN (pi.item_price IS NULL OR pi.item_price = 0)     THEN ci.default_price ELSE pi.item_price END AS item_price,
                CASE WHEN (pi.insurance_price_snapshot IS NULL OR pi.insurance_price_snapshot = 0) THEN ci.insurance_price ELSE pi.insurance_price_snapshot END AS insurance_price_snapshot,
                pi.quantity, pi.remark, pi.sort_order
         FROM booking_package_items AS pi
         LEFT JOIN booking_checkup_items AS ci ON ci.id = pi.item_id
         WHERE pi.package_id = ?
         ORDER BY pi.sort_order ASC`,
        [pkgId]
      );
      res.json({ ok: true, data: rows });
    } catch (e) {
      console.error('[package-items list] error:', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // add item to package
  routerRef.post('/config/packages/:pkgId/items', requireAuth, requireBookingWrite, async (req, res) => {
    const conn = await pool.getConnection();
    try {
      const { pkgId } = req.params;
      const { item_id, item_price, quantity, sort_order, remark } = req.body;
      if (!item_id) return res.status(400).json({ ok: false, error: '缺少 item_id' });

      const [items] = await conn.query(`SELECT * FROM booking_checkup_items WHERE id = ?`, [item_id]);
      if (items.length === 0) return res.status(404).json({ ok: false, error: '体检项目不存在' });
      const item = items[0];

      // 获取最大 sort_order
      const [maxSort] = await conn.query(
        `SELECT MAX(sort_order) AS ms FROM booking_package_items WHERE package_id = ?`,
        [pkgId]
      );
      const newSort = (maxSort[0].ms || 0) + 10;

      const id = uuidv4();
      await conn.query(
        `INSERT INTO booking_package_items (id, package_id, item_id, item_name_snapshot, item_price, quantity, remark, sort_order) VALUES (?,?,?,?,?,?,?)`,
        [id, pkgId, item_id, item.name, item_price != null ? item_price : item.default_price || 0, quantity || 1, remark || '', sort_order || newSort]
      );

      // 更新套餐 item_count
      await conn.query(
        `UPDATE booking_packages SET item_count = (SELECT COUNT(*) FROM booking_package_items WHERE package_id = ?) WHERE id = ?`,
        [pkgId, pkgId]
      );

      const [rows] = await conn.query(`SELECT * FROM booking_package_items WHERE id = ?`, [id]);
      await logOperation(req.user.id, id, 'booking_package_items', 'create', req.body, req);
      res.json({ ok: true, data: rows[0] });
    } catch (e) {
      console.error('[package-items create] error:', e);
      res.status(500).json({ ok: false, error: e.message });
    } finally {
      conn.release();
    }
  });

  // update package item
  routerRef.put('/config/packages/:pkgId/items/:id', requireAuth, requireBookingWrite, async (req, res) => {
    const conn = await pool.getConnection();
    try {
      const { id } = req.params;
      const [exist] = await conn.query(`SELECT * FROM booking_package_items WHERE id = ?`, [id]);
      if (exist.length === 0) return res.status(404).json({ ok: false, error: '记录不存在' });
      const sets = [];
      const values = [];
      ['item_price', 'quantity', 'remark', 'sort_order'].forEach(f => {
        if (req.body[f] !== undefined) { sets.push(`${f} = ?`); values.push(req.body[f]); }
      });
      if (sets.length > 0) {
        values.push(id);
        await conn.query(`UPDATE booking_package_items SET ${sets.join(',')} WHERE id = ?`, values);
      }
      const [rows] = await conn.query(`SELECT * FROM booking_package_items WHERE id = ?`, [id]);
      await logOperation(req.user.id, id, 'booking_package_items', 'update', req.body, req);
      res.json({ ok: true, data: rows[0] });
    } catch (e) {
      console.error('[package-items update] error:', e);
      res.status(500).json({ ok: false, error: e.message });
    } finally {
      conn.release();
    }
  });

  // delete package item
  routerRef.delete('/config/packages/:pkgId/items/:id', requireAuth, requireBookingWrite, async (req, res) => {
    const conn = await pool.getConnection();
    try {
      const { pkgId, id } = req.params;
      await conn.query(`DELETE FROM booking_package_items WHERE id = ?`, [id]);
      // 更新套餐 item_count
      await conn.query(
        `UPDATE booking_packages SET item_count = (SELECT COUNT(*) FROM booking_package_items WHERE package_id = ?) WHERE id = ?`,
        [pkgId, pkgId]
      );
      await logOperation(req.user.id, id, 'booking_package_items', 'delete', {}, req);
      res.json({ ok: true });
    } catch (e) {
      console.error('[package-items delete] error:', e);
      res.status(500).json({ ok: false, error: e.message });
    } finally {
      conn.release();
    }
  });

  // 批量更新套餐 items（一次保存全部）
  routerRef.put('/config/packages/:pkgId/items-batch', requireAuth, requireBookingWrite, async (req, res) => {
    const conn = await pool.getConnection();
    try {
      const { pkgId } = req.params;
      const items = req.body.items; // [{ id, item_id, item_price, quantity, remark, sort_order }]
      if (!Array.isArray(items)) return res.status(400).json({ ok: false, error: 'items 必须为数组' });

      // 删除现有关联
      await conn.query(`DELETE FROM booking_package_items WHERE package_id = ?`, [pkgId]);

      // 重新插入
      for (const it of items) {
        if (!it.item_id) continue;
        const [checkItems] = await conn.query(`SELECT * FROM booking_checkup_items WHERE id = ?`, [it.item_id]);
        if (checkItems.length === 0) continue;
        const checkItem = checkItems[0];
        const id = it.id || uuidv4();
        await conn.query(
          `INSERT INTO booking_package_items (id, package_id, item_id, item_name_snapshot, item_price, quantity, remark, sort_order) VALUES (?,?,?,?,?,?,?,?)`,
          [id, pkgId, it.item_id, it.item_name_snapshot || checkItem.name, it.item_price ?? checkItem.default_price ?? 0, it.quantity ?? 1, it.remark ?? '', it.sort_order ?? 0]
        );
      }

      // 更新 item_count
      await conn.query(
        `UPDATE booking_packages SET item_count = (SELECT COUNT(*) FROM booking_package_items WHERE package_id = ?) WHERE id = ?`,
        [pkgId, pkgId]
      );

      const [rows] = await conn.query(
        `SELECT pi.id, pi.package_id, pi.item_id,
                CASE WHEN (pi.item_name_snapshot IS NULL OR pi.item_name_snapshot = '') THEN ci.name ELSE pi.item_name_snapshot END AS item_name_snapshot,
                CASE WHEN (pi.item_price IS NULL OR pi.item_price = 0)     THEN ci.default_price ELSE pi.item_price END AS item_price,
                CASE WHEN (pi.insurance_price_snapshot IS NULL OR pi.insurance_price_snapshot = 0) THEN ci.insurance_price ELSE pi.insurance_price_snapshot END AS insurance_price_snapshot,
                pi.quantity, pi.remark, pi.sort_order
         FROM booking_package_items AS pi
         LEFT JOIN booking_checkup_items AS ci ON ci.id = pi.item_id
         WHERE pi.package_id = ?
         ORDER BY pi.sort_order ASC`,
        [pkgId]
      );
      res.json({ ok: true, data: rows });
    } catch (e) {
      console.error('[package-items batch] error:', e);
      res.status(500).json({ ok: false, error: e.message });
    } finally {
      conn.release();
    }
  });
}

// 注册以上路由增强
enhancePackageList(router);
makeCheckupItemCrud(router);
makePackageItemCrud(router);

makeBizConfigCrud({
  basePath: '/config/room-types',
  table: 'booking_room_types',
  requiredFields: ['code', 'name', 'price'],
  editableFields: ['status', 'sort_order'],
  sortDefault: 1,
});

makeBizConfigCrud({
  basePath: '/config/meeting-halls',
  table: 'booking_meeting_halls',
  requiredFields: ['code', 'name', 'capacity', 'half_price', 'full_price'],
  editableFields: ['status', 'sort_order'],
  sortDefault: 1,
});

makeBizConfigCrud({
  basePath: '/config/wellness-types',
  table: 'booking_wellness_types',
  requiredFields: ['code', 'name', 'min_hours', 'price', 'is_free', 'pricing_mode'],
  editableFields: ['package_hours', 'price_guest', 'price_external', 'time_window', 'status', 'sort_order'],
  sortDefault: 1,
});

makeBizConfigCrud({
  basePath: '/config/meal-types',
  table: 'booking_meal_types',
  requiredFields: ['code', 'name', 'pricing_mode', 'unit_price'],
  editableFields: ['default_time', 'default_tables', 'default_per_table', 'default_pax', 'description', 'status', 'sort_order'],
  sortDefault: 1,
  autoIncrementId: true,
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
  const conn = await pool.getConnection();
  try {
    // 打开订单页时也自动触发历史模板修复（确保被误转为模板的订单立即恢复可见）
    await ensureFixLegacyTemplates(conn);
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

    const [rows] = await conn.query(`
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
    const [itemRows] = await conn.query(`
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
  } finally {
    conn.release();
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
// DELETE /api/booking/orders/:id  删除订单（草稿专用，级联删 items）
// 仅允许 pending 状态的订单删除
// ============================================================
router.delete('/orders/:id', requireAuth, requireBookingWrite, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query('SELECT * FROM booking_orders WHERE id = ? LIMIT 1', [req.params.id]);
    if (!rows || !rows.length) return res.status(404).json({ ok: false, error: '订单不存在' });
    const o = rows[0];
    if (o.status !== 'pending') {
      return res.status(400).json({ ok: false, error: `仅草稿状态（pending）可删除，当前状态 ${o.status} 不允许删除` });
    }
    if (o.is_template === 1) {
      return res.status(400).json({ ok: false, error: '模板订单请使用 unset-template 接口删除' });
    }
    await conn.beginTransaction();
    await conn.query('DELETE FROM booking_items WHERE order_id = ?', [req.params.id]);
    await conn.query('DELETE FROM booking_orders WHERE id = ? AND status = ? AND is_template = 0', [req.params.id, 'pending']);
    await conn.commit();
    logOperation(req, '预订订单', '删除草稿', `订单号=${o.order_no}`, req.params.id);
    res.json({ ok: true });
  } catch (e) {
    try { await conn.rollback(); } catch (_) {}
    console.error('[booking DELETE order] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    conn.release();
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
// 工具：克隆一条订单为模板（原订单保持不变，克隆产生新记录为 is_template=1）
// ============================================================
async function cloneOrderAsTemplate(conn, sourceOrderId, templateName, operatorId) {
  const uuid = require('uuid');
  // 查原订单（必须是普通订单或历史误转为模板的订单都行）
  const [src] = await conn.query('SELECT * FROM booking_orders WHERE id = ? LIMIT 1', [sourceOrderId]);
  if (!src || !src.length) throw new Error('来源订单不存在');
  const o = src[0];

  const newId = uuid.v4();
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const rand = Math.floor(Math.random() * 9000 + 1000);
  const newOrderNo = `TPL${yyyy}${mm}${dd}${rand}`;

  await conn.query(`
    INSERT INTO booking_orders (
      id, order_no, customer_name, contact_name, contact_phone,
      sales_person, payment_method, remark, status, total_amount,
      is_template, template_name, booker_id, booker_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `, [
    newId, newOrderNo,
    o.customer_name, o.contact_name, o.contact_phone,
    o.sales_person, o.payment_method, o.remark,
    o.status || 'pending',
    Number(o.total_amount) || 0,
    templateName,
    operatorId || (o.booker_id || null),
    o.booker_name || null,
  ]);

  // 克隆 items（与迁移 064 表结构一致：item_type/date/start_time/end_time/pax/extra/amount/sort_order）
  const [origItems] = await conn.query(
    'SELECT * FROM booking_items WHERE order_id = ? ORDER BY sort_order ASC, id ASC',
    [sourceOrderId]
  );
  if (origItems && origItems.length) {
    const itemPlaceholders = origItems.map(() =>
      `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).join(',\n');
    const itemValues = [];
    origItems.forEach(ri => {
      const nid = uuid.v4();
      // 兼容字段别名：优先用新字段，缺失时尝试从旧字段兼容取值
      const itemType = ri.item_type || ri.type || '';
      const extraStr = ri.extra
        ? (typeof ri.extra === 'string' ? ri.extra : JSON.stringify(ri.extra))
        : null;
      const amount = ri.amount != null ? Number(ri.amount)
                   : (ri.total_price != null ? Number(ri.total_price) : 0);
      itemValues.push(
        nid, newId, itemType,
        ri.date ? String(ri.date).slice(0, 10) : null,
        ri.start_time || null,
        ri.end_time || null,
        Number(ri.pax) || 0,
        extraStr,
        amount,
        Number(ri.sort_order) || 0,
      );
    });
    await conn.query(`
      INSERT INTO booking_items (
        id, order_id, item_type, date, start_time, end_time, pax, extra, amount, sort_order
      ) VALUES ${itemPlaceholders}
    `, itemValues);
  }
  return { id: newId, order_no: newOrderNo };
}

// ============================================================
// POST /api/booking/orders/:id/set-template
// 克隆为模板（原订单保持普通订单不变，新生成一条模板记录）
// ============================================================
router.post('/orders/:id/set-template', requireAuth, requireBookingWrite, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { templateName } = req.body;
    if (!templateName) return res.status(400).json({ ok: false, error: '模板名称必填' });
    const [existing] = await conn.query('SELECT id FROM booking_orders WHERE id=? LIMIT 1', [req.params.id]);
    if (!existing || !existing.length) return res.status(404).json({ ok: false, error: '订单不存在' });

    await conn.beginTransaction();
    const tpl = await cloneOrderAsTemplate(conn, req.params.id, templateName, req.user && req.user.id);
    await conn.commit();
    logOperation(req, '预订订单', '克隆为模板', `模板名=${templateName}, 新模板ID=${tpl.order_no}`, req.params.id);
    res.json({ ok: true, data: tpl });
  } catch (e) {
    try { await conn.rollback(); } catch (_) {}
    console.error('[booking set-template] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    conn.release();
  }
});

// ============================================================
// POST /api/booking/orders/:id/unset-template
// 删除模板副本（不影响来源订单本身）
// ============================================================
router.post('/orders/:id/unset-template', requireAuth, requireBookingWrite, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const [existing] = await conn.query('SELECT id, template_name, order_no FROM booking_orders WHERE id=? AND is_template=1 LIMIT 1', [req.params.id]);
    if (!existing || !existing.length) return res.status(404).json({ ok: false, error: '模板不存在' });
    await conn.beginTransaction();
    await conn.query('DELETE FROM booking_items WHERE order_id = ?', [req.params.id]);
    await conn.query('DELETE FROM booking_orders WHERE id = ? AND is_template = 1', [req.params.id]);
    await conn.commit();
    logOperation(req, '预订订单', '删除模板', `模板名=${existing[0].template_name}, 模板单号=${existing[0].order_no}`, req.params.id);
    res.json({ ok: true });
  } catch (e) {
    try { await conn.rollback(); } catch (_) {}
    console.error('[booking unset-template] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    conn.release();
  }
});

// ============================================================
// 内部工具：一次性修复历史数据（把被误转为 is_template=1 的正常订单
//   恢复为普通订单 + 克隆同名模板，保证两者都存在）
// 触发方式：/templates 或 /orders 首次调用时自动检测并修复
// ============================================================
let _legacyTemplateFixDone = false;
async function ensureFixLegacyTemplates(conn) {
  if (_legacyTemplateFixDone) return;
  try {
    // 找出所有 is_template=1 但"本应是普通订单"的记录：
    // ① order_no 不带 TPL 前缀（不是克隆产生的模板单号）
    // ② 存在 booking_items（有实际业务项目，非空壳模板）
    const [needFix] = await conn.query(`
      SELECT o.id, o.order_no, o.template_name
      FROM booking_orders o
      WHERE o.is_template = 1
        AND o.order_no NOT LIKE 'TPL%'
        AND EXISTS (SELECT 1 FROM booking_items bi WHERE bi.order_id = o.id)
    `);
    if (!needFix || !needFix.length) { _legacyTemplateFixDone = true; }

    if (_legacyTemplateFixDone) {
      // 继续清理旧的克隆空模板：TPL 前缀但没有 booking_items 的模板（之前 clone INSERT 字段错误导致）
      const [emptyTpls] = await conn.query(`
        SELECT o.id, o.order_no, o.template_name
        FROM booking_orders o
        WHERE o.is_template = 1
          AND o.order_no LIKE 'TPL%'
          AND NOT EXISTS (SELECT 1 FROM booking_items bi WHERE bi.order_id = o.id)
      `);
      if (emptyTpls && emptyTpls.length) {
        console.log(`[booking-tpl-fix] 清理 ${emptyTpls.length} 条空模板（克隆字段错误导致items丢失）:`, emptyTpls.map(r => r.order_no));
        for (const t of emptyTpls) {
          await conn.query('DELETE FROM booking_orders WHERE id=? AND is_template=1 AND order_no LIKE ?', [t.id, 'TPL%']);
          console.log(`[booking-tpl-fix] 已清理空模板 ${t.order_no}`);
        }
      }
      return;
    }
    console.log(`[booking-tpl-fix] 发现 ${needFix.length} 条历史模板数据需修复：`, needFix.map(r => r.order_no));

    for (const row of needFix) {
      try {
        // 1) 先恢复为普通订单（原订单保留在列表中）
        await conn.query(
          'UPDATE booking_orders SET is_template=0, template_name=NULL WHERE id=? AND is_template=1',
          [row.id]
        );
        // 2) 再克隆一条同名模板
        await cloneOrderAsTemplate(conn, row.id, row.template_name || `${row.order_no}模板`, null);
        console.log(`[booking-tpl-fix] 已修复 ${row.order_no}: 恢复普通订单 + 克隆模板`);
      } catch (inner) {
        console.error(`[booking-tpl-fix] 修复 ${row.order_no} 失败:`, inner.message);
      }
    }
    _legacyTemplateFixDone = true;
  } catch (e) {
    console.error('[booking-tpl-fix] 整体修复失败:', e.message);
  }
}

// ============================================================
// GET /api/booking/templates
// 模板列表（精简信息+items）
// ============================================================
router.get('/templates', requireAuth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureFixLegacyTemplates(conn);
    const [rows] = await conn.query(`
      SELECT id, order_no, customer_name, template_name, total_amount, remark
      FROM booking_orders
      WHERE is_template = 1
      ORDER BY updated_at DESC
      LIMIT 100
    `);
    if (!rows || rows.length === 0) return res.json({ ok: true, data: [] });
    const ids = rows.map(r => r.id);
    const [itemRows] = await conn.query(
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
  } finally {
    conn.release();
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
    // 修复解构：pool.query 返回 [rows, fields]
    const [tplRows] = await conn.query('SELECT * FROM booking_orders WHERE id=? AND is_template=1 LIMIT 1', [req.params.id]);
    const tpl = tplRows && tplRows[0];
    if (!tpl) return res.status(404).json({ ok: false, error: '模板不存在' });

    const today = new Date();
    const newOrderNo = await genOrderNo(today);
    const newId = require('uuid').v4();
    const userName = (req.user && (req.user.name || req.user.userName)) || '';

    // 兼容：customer_name 为空时给一个占位值，避免 NOT NULL 列报错
    const safeCustomer = tpl.customer_name || (tpl.template_name ? `${tpl.template_name}-客户` : '未命名客户');

    await conn.query(`
      INSERT INTO booking_orders (id, order_no, customer_name, contact_name, contact_phone,
        sales_person, payment_method, remark, status, total_amount, booker_id, booker_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `, [
      newId, newOrderNo,
      safeCustomer,
      tpl.contact_name || null,
      tpl.contact_phone || null,
      tpl.sales_person || null,
      tpl.payment_method || null,
      `[从模板创建] ${tpl.template_name || ''}`,
      Number(tpl.total_amount) || 0,
      req.user && req.user.id ? req.user.id : null,
      userName,
    ]);

    // 复制 items，同时日期偏移：以模板第一个 item 的日期为基准，对齐到"今天所在周"
    // 字段与迁移 064 保持一致：item_type/date/start_time/end_time/pax/extra/amount/sort_order
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
      } else if (!baseOrigDate) {
        // 模板没有 date 时，默认放到本周一
        newDate = weekStart.toISOString().slice(0, 10);
      }
      sort += 10;
      await conn.query(`
        INSERT INTO booking_items (id, order_id, item_type, date, start_time, end_time, pax, extra, amount, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        require('uuid').v4(), newId,
        ri.item_type || ri.type || 'checkup',
        newDate,
        ri.start_time || null,
        ri.end_time || null,
        Number(ri.pax) || 0,
        ri.extra ? (typeof ri.extra === 'string' ? ri.extra : JSON.stringify(ri.extra)) : null,
        Number(ri.amount) || 0,
        sort,
      ]);
    }

    await conn.commit();
    logOperation(req, '预订订单', '从模板创建', `模板=${tpl.template_name}`, newId);
    const order = await readOrderFull(newId);
    res.json({ ok: true, data: order });
  } catch (e) {
    try { await conn.rollback(); } catch (_) {}
    console.error('[booking template apply] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
