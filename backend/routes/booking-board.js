const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../db');
const { requireAuth, requireBookingWrite, requireBookingAdmin } = require('../middleware/rbac');
const { logOperation } = require('../middleware/logger');
const { sendBookingNotification, getWecomConfig, updateTemplateCardButton, updateTemplateCard, buildBizSummary, sendTextToUser, sendMarkdownViaWebhook } = require('./wecom');

// ============================================================
// 业务角色判断 helper（requireBookingWrite 已放开入口白名单，
//                    这里做细粒度"谁能操作什么"的限制）
// ============================================================

/**
 * 是否为"配置的审核员"（严格匹配 wecom_config.booking_approver_userid）
 * 审核员必须由企业微信配置页面指定，不再依赖 admin/booker 角色。
 * 负责：审核通过 / 驳回（reviewing阶段） / 标记完成 等管理动作
 */
async function isConfiguredBookingReviewer(user) {
  if (!user) return false;
  try {
    const cfg = await getWecomConfig();
    if (!cfg || !cfg.booking_approver_userid) return false;
    const wecom = String(user.wecom_userid || user.wecomUserId || '');
    if (!wecom) return false;
    return wecom === String(cfg.booking_approver_userid);
  } catch (_) {
    return false;
  }
}

/**
 * @deprecated 保留旧函数签名兼容；内部直接走配置审核员判断
 */
function isBookingReviewer(user) {
  // 同步包装：异步场景下调用方需改用 isConfiguredBookingReviewer
  // 此处保留仅为兼容已有同步调用点（将逐步替换）
  return false;
}

/**
 * 当前登录用户是否为"此订单登记的销售员本人"
 * 匹配顺序：sales_person_id (user.id) → sales_wecom_userid → 姓名包含
 * 满足任意一条即视为本人（允许做销售员确认动作；admin/booker 不用此判断）
 */
function isSalesOwnerOfOrder(user, order) {
  if (!user || !order) return false;
  const uid = String(user.id || '');
  const wecom = String(user.wecom_userid || user.wecomUserId || '');
  const name = user.name || user.realName || user.displayName || '';
  if (uid && order.sales_person_id && String(order.sales_person_id) === uid) return true;
  if (wecom && order.sales_wecom_userid && String(order.sales_wecom_userid) === wecom) return true;
  if (name && order.sales_person && order.sales_person.includes(name)) return true;
  return false;
}

/**
 * 保存用户签字到 user_signatures 表（与采购入库/仓库模块共用）
 *  - user_source='wecom'  -> user_id = wecom_userid
 *  - user_source='system' -> user_id = users.id
 * 失败不抛错（不影响主流程）
 */
/**
 * 保存签字数据（复用采购入库签字策略，共用 user_signatures 表）
 * 🔧 按"对齐采购确认页"方案改造：双写 wecom + system 两个 key，
 *    确保销售员无论从"企微H5"还是"PC 端登录"进入都能读到同一个签字。
 * user_source='wecom'   => user_id = 订单快照 sales_wecom_userid（优先），否则登录态 wecom_userid
 * user_source='system'  => user_id = users.id (系统用户 id)
 *
 * @param {object} opts
 * @param {object} opts.order      订单行（必须含 sales_wecom_userid 快照；不依赖登录态，避免 PC 管理员代确认时写错人）
 * @param {object} opts.loginUser  登录态 req.user（用于兜底 system 键的 user.id，以及 wecom_userid 兜底）
 * @param {string} signatureData   data_url (base64 PNG)
 * @returns {object} { wecomSigId, systemSigId, errors }  errors 数组非空表示有 key 保存失败
 */
async function saveUserSignature({ order, loginUser }, signatureData) {
  if (!signatureData) return { wecomSigId: null, systemSigId: null, errors: [] };
  if (!loginUser && !order) return { wecomSigId: null, systemSigId: null, errors: [] };

  const errors = [];
  // 🔹 构造 (user_id, user_source) 写入对（0~2 组；有重复去重）
  const pairs = [];
  const orderWecomUserId = order && order.sales_wecom_userid;
  const loginWecomUserId = loginUser && (loginUser.wecom_userid || loginUser.wecomUserId);
  const loginSystemId    = loginUser && loginUser.id;

  const pushPair = (uid, source, from) => {
    if (!uid) return;
    if (pairs.some(p => p.uid === uid && p.source === source)) return;
    pairs.push({ uid, source, from });
  };
  pushPair(orderWecomUserId, 'wecom', 'order.sales_wecom_userid');
  pushPair(loginWecomUserId, 'wecom', 'loginUser.wecom_userid');
  pushPair(loginSystemId,  'system', 'loginUser.id');

  const upsertOne = async ({ uid, source, from }) => {
    try {
      // 🔁 对齐采购确认页 user-signatures.js POST 接口使用 ON DUPLICATE KEY UPDATE 模式
      //    需配合 migrations/102_user_signatures_unique.sql 建立 (user_id,user_source) 唯一键。
      const [res] = await pool.query(
        `INSERT INTO user_signatures (id, user_id, user_source, signature_data, created_at, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON DUPLICATE KEY UPDATE signature_data = VALUES(signature_data), updated_at = CURRENT_TIMESTAMP`,
        [uuidv4(), uid, source, signatureData]
      );
      const insertId = res && res.insertId ? res.insertId : null;
      if (insertId && insertId > 0) return insertId;
      // UPDATE 分支（insertId=0）→ 查出已存在 id 返回
      const [rows] = await pool.query(
        'SELECT id FROM user_signatures WHERE user_id = ? AND user_source = ? LIMIT 1',
        [uid, source]
      );
      return rows && rows[0] ? rows[0].id : null;
    } catch (e) {
      console.error('[booking saveUserSignature] error:', { uid, source, from, msg: e && e.message });
      errors.push({ source, from, msg: e && e.message });
      return null;
    }
  };

  const wecomPair  = pairs.find(p => p.source === 'wecom');
  const systemPair = pairs.find(p => p.source === 'system');

  const wecomSigId  = wecomPair  ? await upsertOne(wecomPair)  : null;
  const systemSigId = systemPair ? await upsertOne(systemPair) : null;
  return { wecomSigId, systemSigId, errors };
}

/**
 * 格式化当前时间为中国时区字符串 YYYY-MM-DD HH:mm:ss
 * 用于模板卡按钮灰化：`已确认 (YYYY-MM-DD HH:mm:ss)`
 * - 与食材采购 `purchase-confirmations.js L363` 完全一致
 */
function formatNowCN(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * 写 booking_orders.wecom_card_response_codes（JSON 兼容）
 * @param {string|number} orderId
 * @param {Object} patches    e.g. { sales_confirm: {userid, response_code}, approve: {...} }
 * 为每个 patch 附加 at: CURRENT_TIMESTAMP 可追溯
 */
// 格式化当前时间为 MySQL DATETIME 格式字符串
function formatMySQLTimestamp(date) {
  const d = date || new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${dd} ${hh}:${mm}:${ss}`;
}

async function saveCardResponseCodes(orderId, patches) {
  if (!orderId || !patches || Object.keys(patches).length === 0) return;
  try {
    const [existingRows] = await pool.query(
      'SELECT wecom_card_response_codes AS c FROM booking_orders WHERE id = ? LIMIT 1',
      [orderId]
    );
    const existing = parseMaybeJson(existingRows?.[0]?.c) || {};
    const nowStr = formatMySQLTimestamp();
    const build = (prev, obj) => {
      prev = prev || null;
      if (!obj) return prev;
      // 显式废弃标记：驳回 / 撤回 → cleared=true 把"当前这张卡"作废，submit 重发起绝不复用其 task_id
      if (obj.cleared === true) {
        return {
          userid: (prev && prev.userid) || null,
          response_code: null,
          at: null,
          task_id: (prev && prev.task_id) || null,
          status: 'discarded',
          discarded_at: nowStr,
          attempt: (prev && prev.attempt) ? Number(prev.attempt) : null,
          cleared: true,
        };
      }
      const merged = {};
      merged.userid = obj.userid ? String(obj.userid) : ((prev && prev.userid) || null);
      merged.response_code = obj.response_code ? String(obj.response_code) : ((prev && prev.response_code) || null);
      merged.task_id = (typeof obj.task_id === 'string' && obj.task_id) ? obj.task_id : ((prev && prev.task_id) || null);
      if (obj.status && typeof obj.status === 'string') {
        merged.status = obj.status;
      } else {
        merged.status = (prev && prev.status) ? String(prev.status) : (merged.response_code ? 'sent' : null);
      }
      if (obj.discarded_at) merged.discarded_at = obj.discarded_at;
      else if (prev && prev.discarded_at && merged.status !== 'discarded') merged.discarded_at = prev.discarded_at;
      // 修复：使用应用层时间字符串，不再用 CURRENT_TIMESTAMP/NOW() 占位
      if (obj.response_code) merged.at = nowStr;
      else if (merged.response_code && prev && prev.at) merged.at = prev.at;
      else merged.at = null;
      merged.attempt = (prev && prev.attempt) ? Number(prev.attempt) : null;
      merged.cleared = (obj.cleared === false) ? false : (obj.cleared === true ? true : ((prev && prev.cleared === true) ? true : false));
      if (merged.cleared === false) delete merged.cleared;
      return merged;
    };
    for (const key of Object.keys(patches)) {
      const patch = patches[key];
      if (!patch) continue;
      const prev = existing[key] || null;
      existing[key] = build(prev, patch);
    }
    // 修复：使用 JSON_OBJECT 构造 JSON 值，避免直接拼接 NOW() 导致 JSON 格式错误
    const jsonStr = JSON.stringify(existing);
    // 正确转义 JSON 字符串用于 SQL 参数
    const escapedJson = jsonStr.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const sql = `UPDATE booking_orders SET wecom_card_response_codes = ? WHERE id = ?`;
    await pool.query(sql, [jsonStr, orderId]);
    console.log(`[saveCardResponseCodes] OK: orderId=${orderId}, keys=${Object.keys(patches).join(',')}`);
  } catch (e) {
    console.error('[booking saveCardResponseCodes] error:', e && e.message);
    // 重新抛出错误，让调用方能感知到保存失败
    throw e;
  }
}

/**
 * 企微模板卡按钮灰化（调用 updateTemplateCardButton，已对齐食材采购）
 * - 失败不抛错，不影响主业务
 */
async function greyBookingCardButton(userid, responseCode, label) {
  if (!userid || !responseCode) return;
  try {
    const cfg = await getWecomConfig();
    if (!cfg || !cfg.corp_id || !cfg.agent_id) return;
    const nowStr = formatNowCN();
    await updateTemplateCardButton(cfg, userid, responseCode, `${label} (${nowStr})`);
    console.log(`[greyBookingCardButton] OK: label=${label}, user=${userid}`);
  } catch (e) {
    console.error(`[greyBookingCardButton] FAIL: ${label} user=${userid}:`, e && e.message);
  }
}

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
//
// 日期规则（2026-08-22 修正）：
//  - 体检当天早上 → 早餐
//  - 住宿：入住第二天起 → 退房当天早上（不含入住当天）
//    例：8/18入住 → 8/20退房（2晚）→ 早餐日期=8/19、8/20
//
// 人数规则（2026-08-22 修正v2）：
  //  - 体检：早餐人数 = 体检 pax
  //  - 住宿：优先用实际 pax（人头数），仅当 pax=0 时按 rooms×beds 兜底
  //    （按间模式房间可能不满床，用实际 pax 更准确）
// ------------------------------------------------------------
function deriveBreakfastItems(items) {
  const checkups = items.filter(i => i.item_type === 'checkup');
  const lodgings = items.filter(i => i.item_type === 'lodging');
  // dayMap: date → { checkupPax, lodgingPax }
  const dayMap = {};
  const ensure = (d) => dayMap[d] || (dayMap[d] = { checkupPax: 0, lodgingPax: 0 });

  // ① 体检当天：早餐人数 = 体检人数
  checkups.forEach(c => {
    ensure(c.date).checkupPax += Number(c.pax) || 0;
  });

  // ② 住宿：入住第二天起，到退房当天
  lodgings.forEach(l => {
    const extra = l.extra || {};
    const checkIn = extra.dateCheckIn || l.date;
    const checkOut = extra.dateCheckOut || l.date;
    if (!checkIn || !checkOut) return;

    // 计算晚数
    const d1 = new Date(checkIn + 'T00:00:00');
    const d2 = new Date(checkOut + 'T00:00:00');
    const nights = Math.max(0, Math.round((d2 - d1) / 86400000));
    if (nights <= 0) return;

    const mode = extra.pricingMode || 'per_room';
    const rooms = Number(extra.rooms) || 0;
    const pax = Number(extra.pax) || 0;
    const bedsSnapshot = Number(extra.bedsPerRoomSnapshot);
    const beds = (bedsSnapshot > 0) ? bedsSnapshot : 2; // 兜底2床

    let lodgingAdd = 0;
    if (pax > 0) {
      // ✅ 优先用实际人头数（两种模式都适用）
      lodgingAdd = pax;
    } else if (mode === 'per_room') {
      // 兜底：旧订单没有 pax 时按 rooms×beds 推算
      lodgingAdd = Math.max(0, rooms) * beds;
    }
    // 按人模式 pax=0 时不贡献早餐

    // 入住第二天起算（i=1），退房当天也有早餐
    for (let i = 1; i <= nights; i++) {
      const d = addDays(checkIn, i);
      ensure(d).lodgingPax += lodgingAdd;
    }
  });

  // 汇总输出
  const result = Object.entries(dayMap)
    .map(([date, v]) => ({
      id: 'bf-' + date,
      item_type: 'breakfast',
      date,
      start_time: '07:30',
      // 体检人数与住宿人数取较大值（体检的人通常就是住宿的人，不重复计数）
      pax: Math.max(v.checkupPax || 0, v.lodgingPax || 0),
      extra: {
        source: { checkup: v.checkupPax || 0, lodging: v.lodgingPax || 0 },
      },
      amount: 0,
      derived: true,
    }))
    .filter(s => s.pax > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

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
    wecom_card_response_codes: parseMaybeJson(order.wecom_card_response_codes),
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

// 业务类型映射（用于搜索结果展示 biz_label）
const BIZ_MAP = {
  checkup:   { label: '体检' },
  lodging:   { label: '住宿' },
  breakfast: { label: '早餐' },
  lunch:     { label: '午餐' },
  dinner:    { label: '晚餐' },
  meeting:   { label: '会务' },
  wellness:  { label: '康乐' },
  carpickup: { label: '用车' },
};

// 可编辑状态：除 completed 外均可编辑；reviewing/confirmed/sales_confirming 修改后会触发卡片更新+通知
const EDITABLE_STATUS = ['pending', 'rejected', 'sales_confirming', 'reviewing', 'confirmed'];

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
    // 增加 wecom_userid 字段，前端下单时快照存入订单
    let salesUsers = [];
    try {
      [salesUsers] = await pool.query(`
        SELECT DISTINCT u.id, u.name, u.username, u.wecom_userid
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
          SELECT u.id, u.name, u.username, u.wecom_userid
          FROM users u
          JOIN roles r ON r.id = u.role_id AND r.code = 'sales'
          WHERE u.status = 1
          ORDER BY u.name ASC
        `);
      } catch (e2) {
        salesUsers = [];
      }
    }

    // 预订审批配置（固定审核员）
    let bookingApprover = null;
    try {
      const [wecomCfgRows] = await pool.query('SELECT booking_approver_userid, booking_approver_name FROM wecom_config WHERE id = 1 LIMIT 1');
      if (wecomCfgRows.length > 0 && wecomCfgRows[0].booking_approver_userid) {
        bookingApprover = {
          userid: wecomCfgRows[0].booking_approver_userid,
          name: wecomCfgRows[0].booking_approver_name || '',
        };
      }
    } catch (e) {
      // wecom_config 表或字段可能不存在（迁移未执行时）
    }

    res.json({
      ok: true,
      data: { packages, roomTypes, meetingHalls, wellnessTypes, mealTypes, checkupItems, salesUsers, bookingApprover },
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
  routerRef.post('/config/packages', requireAuth, requireBookingAdmin, async (req, res) => {
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
  routerRef.put('/config/packages/:id', requireAuth, requireBookingAdmin, async (req, res) => {
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
  routerRef.delete('/config/packages/:id', requireAuth, requireBookingAdmin, async (req, res) => {
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
  const editableFields = ['item_type', 'category', 'description', 'clinical_significance', 'default_price', 'insurance_price', 'unit', 'status', 'sort_order', 'applicable_roles'];

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
      // 只查询启用的项目（status != 0），禁用的项目不显示
      const [rows] = await pool.query(
        `SELECT * FROM ${table} WHERE status != 0 ORDER BY category ASC, sort_order ASC, id ASC`
      );
      // 为组合项目附加子项目列表；applicable_roles 做 JSON 反序列化
      const conn = await pool.getConnection();
      try {
        for (const row of rows) {
          if (row.item_type === 'combo') {
            row.sub_items = await getSubItems(conn, row.id);
          }
          if (typeof row.applicable_roles === 'string') {
            try { row.applicable_roles = JSON.parse(row.applicable_roles); } catch (_) { row.applicable_roles = null; }
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

  routerRef.post(`${basePath}`, requireAuth, requireBookingAdmin, async (req, res) => {
    const conn = await pool.getConnection();
    try {
      for (const f of requiredFields) {
        if (req.body[f] === undefined || req.body[f] === null || req.body[f] === '') {
          return res.status(400).json({ ok: false, error: `缺少必要字段：${f}` });
        }
      }
      const id = uuidv4();
      const fields = ['id', ...requiredFields];
      const values = [id, ...requiredFields.map(f => req.body[f])];
      // editableFields 单独处理（applicable_roles 需要 stringify；其他字段直接 push）
      for (const f of editableFields) {
        if (req.body[f] === undefined) continue;
        fields.push(f);
        if (f === 'applicable_roles') {
          if (req.body[f] == null || (Array.isArray(req.body[f]) && req.body[f].length === 0)) {
            // NULL 或空数组 → DB 存 NULL（通用）
            values.push(null);
          } else if (Array.isArray(req.body[f])) {
            values.push(JSON.stringify(req.body[f]));
          } else {
            values.push(null);
          }
        } else {
          values.push(req.body[f]);
        }
      }
      if (!fields.includes('item_type')) { fields.push('item_type'); values.push('item'); }
      if (!fields.includes('default_price')) { fields.push('default_price'); values.push(0); }
      if (!fields.includes('insurance_price')) { fields.push('insurance_price'); values.push(0); }
      if (!fields.includes('unit')) { fields.push('unit'); values.push('次'); }
      if (!fields.includes('category')) { fields.push('category'); values.push('化验'); }
      if (!fields.includes('sort_order')) { fields.push('sort_order'); values.push(100); }
      if (!fields.includes('status')) { fields.push('status'); values.push(1); }
      if (!fields.includes('applicable_roles')) { fields.push('applicable_roles'); values.push(null); }
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
      if (typeof rows[0].applicable_roles === 'string') {
        try { rows[0].applicable_roles = JSON.parse(rows[0].applicable_roles); } catch (_) { rows[0].applicable_roles = null; }
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

  routerRef.put(`${basePath}/:id`, requireAuth, requireBookingAdmin, async (req, res) => {
    const conn = await pool.getConnection();
    try {
      const { id } = req.params;
      const [exist] = await conn.query(`SELECT * FROM ${table} WHERE id = ?`, [id]);
      if (exist.length === 0) return res.status(404).json({ ok: false, error: '记录不存在' });
      const sets = [];
      const values = [];
      [...requiredFields, ...editableFields].forEach(f => {
        if (req.body[f] === undefined) return;
        sets.push(`${f} = ?`);
        if (f === 'applicable_roles') {
          if (req.body[f] == null || (Array.isArray(req.body[f]) && req.body[f].length === 0)) {
            values.push(null);
          } else if (Array.isArray(req.body[f])) {
            values.push(JSON.stringify(req.body[f]));
          } else {
            values.push(null);
          }
        } else {
          values.push(req.body[f]);
        }
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
      if (typeof rows[0].applicable_roles === 'string') {
        try { rows[0].applicable_roles = JSON.parse(rows[0].applicable_roles); } catch (_) { rows[0].applicable_roles = null; }
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

  routerRef.delete(`${basePath}/:id`, requireAuth, requireBookingAdmin, async (req, res) => {
    const conn = await pool.getConnection();
    try {
      const { id } = req.params;
      // 1. 先清理组合子项目关联
      await conn.query(`DELETE FROM booking_item_sub_items WHERE combo_item_id = ? OR sub_item_id = ?`, [id, id]);
      // 2. 清理套餐中的项目引用：item_name_snapshot/item_price 保留（套餐历史明细快照），只把item_id置空
      //    如果item_id是NOT NULL，MySQL不允许SET NULL→此时直接删这条package_items明细（价格快照还在logOperation，不影响历史）
      let affected = 0;
      try {
        const [upd] = await conn.query(`UPDATE booking_package_items SET item_id = NULL WHERE item_id = ?`, [id]);
        affected = typeof upd.affectedRows === 'number' ? upd.affectedRows : 0;
      } catch (_e) {
        // NOT NULL约束时改用DELETE明细表行（只删item_id=当前被删项目的）
        await conn.query(`DELETE FROM booking_package_items WHERE item_id = ?`, [id]);
      }
      // 3. 物理删除主表记录
      await conn.query(`DELETE FROM ${table} WHERE id = ?`, [id]);
      await logOperation(req.user.id, id, table, 'delete', { packageItemsCleared: affected }, req);
      res.json({ ok: true });
    } catch (e) {
      console.error(`[${basePath} delete] error:`, e);
      res.status(500).json({ ok: false, error: e.message });
    } finally {
      conn.release();
    }
  });

  // ==========================================================================
  // ⚠️⚠️⚠️ 【生产数据保护】：批量 wipeAll 接口（前端「🗑️ 清空全部重导」按钮调用）
  // ==========================================================================
  // 此接口会：
  //   ① DELETE booking_item_sub_items 全表
  //   ② UPDATE booking_package_items.item_id = NULL（或 NOT NULL 时 ALTER MODIFY / DELETE）
  //   ③ DELETE booking_checkup_items 全表 → 编码下次从 T00001 开始重置
  //
  // 🔒 已内置多层权限/确认保护：
  //   - requireAuth + requireBookingWrite：非采购/管理员无权调
  //   - 前端要求两次确认：prompt 输入「确定清空体检项目」+ confirm
  //   - 操作会写 logOperation 并 console.warn（详见下面），后端日志永久留痕
  //
  // ❌ 正常使用场景（只改单个/几个项目）严禁调此接口！请使用 DELETE /:id 行内删除
  // ==========================================================================
  routerRef.delete(`${basePath}`, requireAuth, requireBookingAdmin, async (req, res) => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // 1) 清组合子项目关联表（全表清空，不保留——因为checkup_items都要全删）
      const [r1] = await conn.query(`DELETE FROM booking_item_sub_items`);
      // 2) 处理套餐明细表：如果 item_id 列允许 NULL→置 NULL；否则 DELETE
      let packageItemsFixed = 0;
      try {
        const [upd] = await conn.query(`UPDATE booking_package_items SET item_id = NULL WHERE item_id IS NOT NULL`);
        packageItemsFixed = typeof upd.affectedRows === 'number' ? upd.affectedRows : 0;
      } catch (_e) {
        // NOT NULL 时尝试先改列为允许 NULL（一次性 DDL，后续都能走 UPDATE）
        try {
          await conn.query(`ALTER TABLE booking_package_items MODIFY COLUMN item_id VARCHAR(36) NULL`);
          const [upd] = await conn.query(`UPDATE booking_package_items SET item_id = NULL WHERE item_id IS NOT NULL`);
          packageItemsFixed = typeof upd.affectedRows === 'number' ? upd.affectedRows : 0;
        } catch (_e2) {
          // 实在不行就 DELETE 套餐明细中 item_id 非空的行
          const [del] = await conn.query(`DELETE FROM booking_package_items WHERE item_id IS NOT NULL`);
          packageItemsFixed = typeof del.affectedRows === 'number' ? del.affectedRows : 0;
        }
      }
      // 3) 物理删除全部体检项目
      const [r3] = await conn.query(`DELETE FROM ${table}`);
      await conn.commit();
      const affected = typeof r3.affectedRows === 'number' ? r3.affectedRows : 0;
      const subCleared = r1?.affectedRows || 0;
      // ===== ⚠️ 审计日志：后端日志永久留痕（谁、什么时候、删了多少条），方便以后出问题回溯 =====
      console.warn(
        `[⚠️ CHECKUP_ITEMS_WIPE_ALL] user_id=${req.user?.id || '?'}` +
        ` user_name=${req.user?.username || req.user?.name || '?'}  ` +
        ` deleted=${affected}  subItemsCleared=${subCleared}  packageItemsFixed=${packageItemsFixed}  ` +
        ` ip=${req.ip}  ua=${(req.get('user-agent') || '').slice(0, 120)}`
      );
      await logOperation(req.user.id, '-', table, 'wipe_all', { deleted: affected, subItemsCleared: subCleared, packageItemsFixed }, req);
      res.json({ ok: true, data: { deleted: affected, subItemsCleared: subCleared, packageItemsFixed } });
    } catch (e) {
      try { await conn.rollback(); } catch (_) {}
      console.error(`[${basePath} wipeAll] error:`, e);
      res.status(500).json({ ok: false, error: e.message });
    } finally {
      conn.release();
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
  routerRef.post('/config/packages/:pkgId/items', requireAuth, requireBookingAdmin, async (req, res) => {
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
  routerRef.put('/config/packages/:pkgId/items/:id', requireAuth, requireBookingAdmin, async (req, res) => {
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
  routerRef.delete('/config/packages/:pkgId/items/:id', requireAuth, requireBookingAdmin, async (req, res) => {
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
  routerRef.put('/config/packages/:pkgId/items-batch', requireAuth, requireBookingAdmin, async (req, res) => {
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
  // pricing_mode 旧字段保留；新字段支持一房两价+床位数
  editableFields: ['status', 'sort_order', 'pricing_mode', 'beds_per_room', 'price_per_room', 'price_per_person'],
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
// GET /api/booking/orders/search
// 历史订单搜索（无日期范围限制，支持关键词 + 业务类型 + 状态）
// 用于"🔍 历史搜索" Modal，快速找到历史订单进行查看/复制
// 参数：keyword=xxx（客户名/手机号/订单号，模糊 OR）
//       bizTypes=checkup,lunch（可选，逗号分隔）
//       statuses=pending,confirmed（可选，逗号分隔）
//       page=1&page_size=20（可选）
// ============================================================
router.get('/orders/search', requireAuth, async (req, res) => {
  try {
    const { keyword, bizTypes, statuses, page = 1, page_size = 20 } = req.query;
    const kw = String(keyword || '').trim();
    const p = Math.max(1, Math.min(1000, Number(page) || 1));
    const ps = Math.max(1, Math.min(100, Number(page_size) || 20));
    const offset = (p - 1) * ps;

    const wheres = ['o.is_template = 0'];
    const params = [];

    if (kw) {
      wheres.push('(o.customer_name LIKE ? OR o.order_no LIKE ? OR o.contact_phone LIKE ?)');
      params.push(`%${kw}%`, `%${kw}%`, `%${kw}%`);
    }

    if (bizTypes) {
      const list = String(bizTypes).split(',').map(s => s.trim()).filter(Boolean);
      if (list.length) {
        wheres.push(`o.id IN (SELECT DISTINCT order_id FROM booking_items WHERE item_type IN (${list.map(() => '?').join(',')}))`);
        params.push(...list);
      }
    }

    if (statuses) {
      const list = String(statuses).split(',').map(s => s.trim()).filter(Boolean);
      if (list.length) {
        wheres.push(`o.status IN (${list.map(() => '?').join(',')})`);
        params.push(...list);
      }
    }

    const whereSql = `WHERE ${wheres.join(' AND ')}`;

    const [countRows] = await pool.query(`SELECT COUNT(*) AS cnt FROM booking_orders o ${whereSql}`, params);
    const total = Number(countRows[0]?.cnt) || 0;

    const [rows] = await pool.query(`
      SELECT o.*,
             (SELECT COALESCE(SUM(bi.pax * bi.amount), 0) FROM booking_items bi WHERE bi.order_id = o.id) AS calc_total
      FROM booking_orders o
      ${whereSql}
      ORDER BY o.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, ps, offset]);

    const result = [];
    for (const o of rows) {
      const [typeRows] = await pool.query(
        'SELECT DISTINCT item_type FROM booking_items WHERE order_id = ?',
        [o.id]
      );
      const bizTypesArr = typeRows.map(t => t.item_type);
      const [paxRow] = await pool.query(
        'SELECT COALESCE(SUM(pax), 0) AS total FROM booking_items WHERE order_id = ? AND item_type = "checkup"',
        [o.id]
      );
      const totalPeople = Number(paxRow[0]?.total) || 0;

      // 优先使用订单自身的 total_amount，其次用子查询计算值
      const totalAmount = Number(o.total_amount) > 0
        ? Number(o.total_amount)
        : Number(o.calc_total) || 0;

      result.push({
        id: o.id,
        customer_name: o.customer_name || '-',
        contact_phone: o.contact_phone
          ? String(o.contact_phone).replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
          : null,
        order_no: o.order_no || null,
        biz_types: bizTypesArr,
        biz_label: bizTypesArr.map(t => BIZ_MAP[t]?.label || t).join(' / '),
        status: o.status,
        total_people: totalPeople,
        total_amount: totalAmount,
        created_at: o.created_at,
        appointment_date: o.created_at ? o.created_at.slice(0, 10) : null,
        remark: o.remark || null,
        sales_person: o.sales_person || null,
      });
    }

    res.json({
      ok: true,
      data: { total, page: p, page_size: ps, orders: result },
    });
  } catch (e) {
    console.error('[booking search] error:', e);
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
    // 存储销售员企微userid快照：直接从销售员数据中取，避免运行时查users表
    const salesWecomUserid = req.body.salesWecomUserid || null;
    await conn.query(`
      INSERT INTO booking_orders
        (id, order_no, customer_name, contact_name, contact_phone,
         sales_person, sales_person_id, sales_wecom_userid, payment_method, remark, status, total_amount,
         booker_id, booker_name)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, [
      orderId, orderNo,
      req.body.customerName || null,
      req.body.contactName || null,
      req.body.contactPhone || null,
      req.body.salesPerson || null,
      req.body.salesPersonId || null,
      salesWecomUserid,
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
    // 订单号重新生成，复制销售员企微userid快照
    const orderNo = await genOrderNo(new Date());
    const newOrderId = uuidv4();
    await conn.query(`
      INSERT INTO booking_orders
        (id, order_no, customer_name, contact_name, contact_phone,
         sales_person, sales_wecom_userid, payment_method, remark, status, total_amount,
         booker_id, booker_name)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, [
      newOrderId, orderNo,
      src.customer_name, src.contact_name, src.contact_phone,
      src.sales_person, src.sales_wecom_userid || null, src.payment_method,
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

// POST /api/booking/orders/:id/submit   提交确认：pending → sales_confirming
router.post('/orders/:id/submit', requireAuth, requireBookingWrite, async (req, res) => {
  try {
    const orderId = req.params.id;
    const [rows] = await pool.query('SELECT * FROM booking_orders WHERE id = ? LIMIT 1', [orderId]);
    if (!rows.length) return res.status(404).json({ ok: false, error: '订单不存在' });
    const o = rows[0];
    // 允许 pending 和 rejected 状态提交
    if (!['pending', 'rejected'].includes(o.status)) {
      return res.status(400).json({ ok: false, error: `状态 ${o.status} 不能提交` });
    }

    // 【方案S：兼容迁移101未跑】
    // 优先使用原生列 submit_resend_count 原子自增（迁移101跑后路径，1次SQL、性能更快）；
    // 如果列不存在（部署动作里：代码复制到服务器 <-> 迁移脚本跑完中间的竞态窗口；或Actions迁移步骤报错中断），
    //   catch 分支降级成"只UPDATE status，submitAttempt = 1"兜底，不让用户看到 500。
    // 兜底期间 task_id 会用 booking_{orderNo} 老卡命名：如果历史上推送过同名卡且重发起，可能触发企微去重（这是降级模式可接受的代价），
    //   一旦迁移101执行完，下次submit就切回原生计数，task_id S{N} 永久唯一。
    let usingNativeCount = true;
    try {
      await pool.query(
        "UPDATE booking_orders SET status = 'sales_confirming', submit_resend_count = submit_resend_count + 1 WHERE id = ?",
        [orderId]
      );
    } catch (eUpdate) {
      // 只在"列不存在"错误降级；其他 SQL 错误（连接失败/权限/主键等）继续抛，避免掩盖真实问题
      const msg = String(eUpdate && eUpdate.message || '');
      if (!/Unknown column 'submit_resend_count' in 'field list'/i.test(msg)) throw eUpdate;
      console.warn(`[booking submit] submit_resend_count列缺失，降级运行(orderId=${orderId}, orderNo=${o.order_no})：请尽快执行migrations/101_booking_submit_resend_count.sql`);
      usingNativeCount = false;
      await pool.query("UPDATE booking_orders SET status = 'sales_confirming' WHERE id = ?", [orderId]);
    }
    logOperation(req, '预订订单', '提交确认', `订单号=${o.order_no}`, orderId);

    // 【方案 S】submitAttempt 走原生列 submit_resend_count（更新后已自增 1）
    //   N=1 -> 首次任务卡：task_id = booking_{orderNo}（兼容老卡）
    //   N≥2 -> 重发起：task_id = booking_{orderNo}_S{N}
    // 再次读现行拿到提交后的计数（若迁移 101 未跑 submit_resend_count 返回 NULL -> 强制 fallback=1，不静默）
    let submitAttempt = 1;
    if (usingNativeCount) {
      try {
        const [afterRows] = await pool.query(
          'SELECT submit_resend_count AS c FROM booking_orders WHERE id = ? LIMIT 1',
          [orderId]
        );
        submitAttempt = Number(afterRows?.[0]?.c) > 0 ? Number(afterRows[0].c) : 1;
      } catch (eRead) {
        const msg = String(eRead && eRead.message || '');
        if (!/Unknown column 'submit_resend_count' in 'field list'/i.test(msg)) throw eRead;
        submitAttempt = 1;
      }
    }

    const order = await readOrderFull(orderId);
    let notifyError = null;
    let notifyRes = null;
    try {
      notifyRes = await sendBookingNotification('submit', order, { submitAttempt });
      if (notifyRes && notifyRes.salesResponseCode) {
        await saveCardResponseCodes(orderId, {
          sales_confirm: {
            userid: notifyRes.salesUserid,
            response_code: notifyRes.salesResponseCode,
            task_id: notifyRes.submitTaskId || null,
            status: 'sent',
          },
        });
      } else {
        // 通知失败 / 无 response_code：只保留最终 task_id + status='sent_attempt' 便于排错
        // 计数不变量已靠原生列 submit_resend_count 保障，不需要再写 JSON attempt
        await saveCardResponseCodes(orderId, {
          sales_confirm: {
            userid: (notifyRes && notifyRes.salesUserid) || (order.wecom_card_response_codes && order.wecom_card_response_codes.sales_confirm && order.wecom_card_response_codes.sales_confirm.userid) || null,
            task_id: (notifyRes && notifyRes.submitTaskId) || null,
            status: 'sent_attempt_failed',
          },
        });
        if (notifyRes && notifyRes.salesCardError) {
          notifyError = notifyRes.salesCardError;
        }
      }
    } catch (e) {
      notifyError = { errmsg: e && e.message || String(e) };
      // notify 抛错不影响计数不变量（已经 UPDATE submit_resend_count）；补一个状态标签方便排查
      await saveCardResponseCodes(orderId, {
        sales_confirm: { status: 'sent_throw' },
      }).catch(()=>{});
    }
    if (notifyError) {
      console.error(`[booking submit notify] FAIL orderNo=${o.order_no} submitAttempt=${submitAttempt}:`, JSON.stringify(notifyError));
    }
    // 诊断信息一并返回前端，方便排查"没有报错但收不到消息"
    res.json({
      ok: true,
      data: order,
      _notifyDebug: {
        orderNo: o.order_no,
        submitAttempt,
        usingNativeCount,
        salesUserid: (notifyRes && notifyRes.salesUserid) || null,
        salesResponseCode: (notifyRes && notifyRes.salesResponseCode) || null,
        submitTaskId: (notifyRes && notifyRes.submitTaskId) || null,
        salesCardError: (notifyRes && notifyRes.salesCardError) || notifyError || null,
        salesWecomUserid: o.sales_wecom_userid || null,
      },
    });
  } catch (e) {
    console.error('[booking submit] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/booking/orders/:id/sales-confirm  销售员确认：sales_confirming → reviewing
// body: { signature_data: string (base64 PNG, 必填) }
router.post('/orders/:id/sales-confirm', requireAuth, requireBookingWrite, async (req, res) => {
  try {
    const user = req.user || {};
    const orderId = req.params.id;
    const signatureData = (req.body && req.body.signature_data) || '';
    if (!signatureData) {
      return res.status(400).json({ ok: false, error: '请先签字再确认' });
    }
    const [rows] = await pool.query('SELECT * FROM booking_orders WHERE id = ? LIMIT 1', [orderId]);
    if (!rows.length) return res.status(404).json({ ok: false, error: '订单不存在' });
    const o = rows[0];
    if (o.status !== 'sales_confirming') {
      return res.status(400).json({ ok: false, error: `状态 ${o.status} 不能确认` });
    }

    // --- 业务角色限制 ---
    // 销售员确认仅限订单登记的销售员本人（严格身份匹配）
    if (!isSalesOwnerOfOrder(user, o)) {
      return res.status(403).json({
        ok: false,
        error: `仅订单登记的销售员本人（${o.sales_person || '—'}）可确认此订单`,
      });
    }

    await pool.query(`
      UPDATE booking_orders SET
        status = 'reviewing',
        sales_confirmed_at = NOW(),
        sales_confirmed_by = ?,
        sales_confirmed_by_name = ?,
        sales_confirmed_signature = ?
      WHERE id = ?
    `, [
      user.id || null,
      user.name || user.realName || user.displayName || null,
      signatureData,
      orderId,
    ]);
    logOperation(req, '预订订单', '销售员确认', `订单号=${o.order_no} 确认人=${user.name || user.id}`, orderId);

    // 🔧 对齐采购确认页：签字保存同步 await + 双写 wecom+system 两把 key（销售快照优先），不再 fire-and-forget
    const sigResult = await saveUserSignature({ order: o, loginUser: user }, signatureData);

    const order = await readOrderFull(orderId);

    // 诊断容器（同步收集三个问题的结果，直接返回前端）
    const _notifyDebug = {
      orderNo: o.order_no,
      saveSignature: {
        wecomSigId: sigResult.wecomSigId,
        systemSigId: sigResult.systemSigId,
        errors: sigResult.errors && sigResult.errors.length ? sigResult.errors : null,
      },
      greySalesButton: null,
      approveNotify: null,
    };

    // 1) 🔁 对齐采购确认页：灰化销售员原「订单待确认」蓝卡按钮 = 同步 await
    //    ✅ userid/response_code 只用 submit 时落库的 salesCard（=发给谁、就灰谁），不再用登录态推断
    //    失败只写错误到 _notifyDebug，不阻塞主流程
    let salesCard = order.wecom_card_response_codes && order.wecom_card_response_codes.sales_confirm;
    if (!salesCard || !salesCard.response_code) {
      try {
        const [recheckRows] = await pool.query(
          'SELECT wecom_card_response_codes AS c FROM booking_orders WHERE id = ? LIMIT 1',
          [orderId]
        );
        const recheck = parseMaybeJson(recheckRows?.[0]?.c);
        if (recheck && recheck.sales_confirm) {
          salesCard = recheck.sales_confirm;
          if (!order.wecom_card_response_codes) order.wecom_card_response_codes = {};
          order.wecom_card_response_codes.sales_confirm = salesCard;
        }
      } catch (_) { /* ignore */ }
    }
    const salesGreyUserid = salesCard && salesCard.userid;
    const salesGreyCode   = salesCard && salesCard.response_code;
    if (salesGreyUserid && salesGreyCode) {
      try {
        await greyBookingCardButton(salesGreyUserid, salesGreyCode, '已确认');
        await saveCardResponseCodes(orderId, { sales_confirm: { status: 'greyed' } });
        _notifyDebug.greySalesButton = { ok: true, userid: salesGreyUserid };
      } catch (e) {
        _notifyDebug.greySalesButton = { ok: false, userid: salesGreyUserid, errmsg: e && e.message };
      }
    } else {
      _notifyDebug.greySalesButton = { ok: false, reason: 'submit时没有保存response_code或userid', salesCardExists: !!salesCard, salesCardUserid: salesGreyUserid || null, salesCardHasCode: !!salesGreyCode };
    }

    // 2) 🔁 对齐采购确认页：审核员通知 = 同步 await（采购for循环同步，不再IIFE fire-and-forget）
    //    成功 -> 同步保存approve卡response_code + status='sent'
    //    失败 -> 把approverUserid/approveCardError直接写到_ntifyDebug，前端toast红条
    try {
      const notifyRes = await sendBookingNotification('salesConfirm', order);
      if (notifyRes && notifyRes.approverResponseCode) {
        await saveCardResponseCodes(orderId, {
          approve: {
            userid: notifyRes.approverUserid,
            response_code: notifyRes.approverResponseCode,
            task_id: notifyRes.approveTaskId || null,
            status: 'sent',
          },
        });
        _notifyDebug.approveNotify = {
          ok: true,
          approverUserid: notifyRes.approverUserid,
          approverResponseCode: notifyRes.approverResponseCode,
          approveTaskId: notifyRes.approveTaskId || null,
        };
      } else {
        const errInfo = (notifyRes && notifyRes.approveCardError) || { errmsg: 'approverResponseCode为空（审核员通知未发）' };
        const approver  = (notifyRes && notifyRes.approverUserid) || (function(){ try{ const w=getWecomConfig(); return w && w.booking_approver_userid || 'unconfigured'; }catch(_){return 'wecom_config_failed';}})();
        _notifyDebug.approveNotify = {
          ok: false,
          approverUserid: approver,
          approveTaskId: (notifyRes && notifyRes.approveTaskId) || null,
          approveCardError: errInfo,
        };
        console.error(`[booking sales-confirm] 审核员通知 FAIL: orderNo=${o.order_no}, approver=${approver}, detail=${JSON.stringify(errInfo)}`);
      }
    } catch (e) {
      _notifyDebug.approveNotify = {
        ok: false,
        approverUserid: 'notify-throw',
        approveCardError: { errmsg: e && e.message || String(e) },
      };
      console.error(`[booking sales-confirm notify] catch FAIL orderNo=${o.order_no}:`, e && e.message, e);
    }

    res.json({ ok: true, data: order, _notifyDebug });
  } catch (e) {
    console.error('[booking sales-confirm] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/booking/orders/:id/withdraw  撤回：sales_confirming → pending
router.post('/orders/:id/withdraw', requireAuth, requireBookingWrite, async (req, res) => {
  try {
    const orderId = req.params.id;
    const [rows] = await pool.query('SELECT * FROM booking_orders WHERE id = ? LIMIT 1', [orderId]);
    if (!rows.length) return res.status(404).json({ ok: false, error: '订单不存在' });
    const o = rows[0];
    if (o.status !== 'sales_confirming') {
      return res.status(400).json({ ok: false, error: `状态 ${o.status} 不能撤回` });
    }

    await pool.query("UPDATE booking_orders SET status = 'pending' WHERE id = ?", [orderId]);
    logOperation(req, '预订订单', '撤回', `订单号=${o.order_no}`, orderId);

    // 【方案 S】撤回 = 当前销售卡作废（语义化标记 status='discarded' + 记录时间）
    //   同步 await：确保返回前端时标记已落库 → 避免 submit 重发起读到旧 attempt / 旧状态命中去重
    //   计数不变量 submit_resend_count 由原生列接管，这里不需要再改 attempt
    await saveCardResponseCodes(orderId, { sales_confirm: { cleared: true } }).catch(() => {});

    const order = await readOrderFull(orderId);
    res.json({ ok: true, data: order });
  } catch (e) {
    console.error('[booking withdraw] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/booking/orders/:id/approve  审核通过 reviewing → confirmed
// body: { signature_data: string (base64 PNG, 必填) }
router.post('/orders/:id/approve', requireAuth, requireBookingWrite, async (req, res) => {
  try {
    const user = req.user || {};
    const orderId = req.params.id;
    const signatureData = (req.body && req.body.signature_data) || '';
    if (!signatureData) {
      return res.status(400).json({ ok: false, error: '请先签字再审核通过' });
    }
    const [rows] = await pool.query('SELECT * FROM booking_orders WHERE id = ? LIMIT 1', [orderId]);
    if (!rows.length) return res.status(404).json({ ok: false, error: '订单不存在' });
    const o = rows[0];
    if (o.status !== 'reviewing') return res.status(400).json({ ok: false, error: `状态 ${o.status} 不能审核` });

    // --- 业务角色限制 ---
    // 审核通过仅限配置的审核员（wecom_config.booking_approver_userid）
    const isReviewer = await isConfiguredBookingReviewer(user);
    if (!isReviewer) {
      return res.status(403).json({
        ok: false,
        error: '仅企业微信配置中指定的审核员可审核订单',
      });
    }

    await pool.query(`
      UPDATE booking_orders SET
        status = 'confirmed',
        confirmed_at = NOW(),
        approved_signature = ?,
        approved_by = ?,
        approved_by_name = ?
      WHERE id = ?
    `, [
      signatureData,
      user.id || null,
      user.name || user.realName || user.displayName || null,
      orderId,
    ]);
    logOperation(req, '预订订单', '审核通过', `订单号=${o.order_no} 审核人=${user.name || user.id}`, orderId);

    // 🔧 对齐采购确认页：审核通过签字 同步 await 双写（审核人通常=系统管理员PC端，保证system键+企微审核员键都能读到）
    await saveUserSignature({ order: o, loginUser: user }, signatureData);

    const order = await readOrderFull(orderId);
    // 灰化审核员原「订单待审核」卡按钮（"已审核 (时间)"）
    //  优先级：approveCard 存的 userid → 当前操作审核人 wecom_userid → getWecomConfig().booking_approver_userid
    const approveCard = order.wecom_card_response_codes && order.wecom_card_response_codes.approve;
    let approveGreyUserid = (approveCard && approveCard.userid) || user.wecom_userid || null;
    if (!approveGreyUserid) {
      try {
        const wcfg = await getWecomConfig();
        approveGreyUserid = wcfg && wcfg.booking_approver_userid ? wcfg.booking_approver_userid : null;
      } catch(_) { /* ignore */ }
    }
    if (approveGreyUserid && approveCard && approveCard.response_code) {
      greyBookingCardButton(approveGreyUserid, approveCard.response_code, '已审核')
        .then(() => saveCardResponseCodes(orderId, { approve: { status: 'greyed' } }).catch(()=>{}))
        .catch(()=>{});
    }
    // 异步通知预订群+销售员
    sendBookingNotification('approve', order).catch(e => console.error('[booking approve notify] error:', e));
    res.json({ ok: true, data: order });
  } catch (e) {
    console.error('[booking approve] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/booking/orders/:id/reject   驳回
//   sales_confirming → rejected（销售员驳回/撤回修改）
//   reviewing → rejected（审核员驳回）
router.post('/orders/:id/reject', requireAuth, requireBookingWrite, async (req, res) => {
  try {
    const user = req.user || {};
    const orderId = req.params.id;
    const [rows] = await pool.query('SELECT * FROM booking_orders WHERE id = ? LIMIT 1', [orderId]);
    if (!rows.length) return res.status(404).json({ ok: false, error: '订单不存在' });
    const o = rows[0];
    if (!['sales_confirming', 'reviewing'].includes(o.status)) {
      return res.status(400).json({ ok: false, error: `状态 ${o.status} 不能驳回` });
    }
    const rejectionReason = (req.body && req.body.rejectionReason) || '未填驳回原因';

    // --- 业务角色限制（按驳回阶段区分）---
    // ① sales_confirming 阶段：仅订单销售员本人可撤回
    // ② reviewing     阶段：仅配置的审核员可驳回
    const isReviewer = await isConfiguredBookingReviewer(user);
    if (o.status === 'reviewing' && !isReviewer) {
      return res.status(403).json({
        ok: false,
        error: '仅企业微信配置中指定的审核员可驳回此订单',
      });
    }
    if (o.status === 'sales_confirming' && !isSalesOwnerOfOrder(user, o)) {
      return res.status(403).json({
        ok: false,
        error: `仅订单登记的销售员本人（${o.sales_person || '—'}）可撤回此订单`,
      });
    }

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

    // 根据驳回阶段灰对应按钮
    if (o.status === 'sales_confirming') {
      // 销售员自己驳回→灰化图 1 原「订单待确认」按钮为"已驳回 (时间)"
      const salesCard = order.wecom_card_response_codes && order.wecom_card_response_codes.sales_confirm;
      const greyUserId = user.wecom_userid || (salesCard && salesCard.userid) || null;
      if (greyUserId && salesCard && salesCard.response_code) {
        greyBookingCardButton(greyUserId, salesCard.response_code, '已驳回').catch(()=>{});
      }
      // 【方案 S】驳回 (阶段=sales_confirming) = 销售卡作废
      //   同步 await：确保提交下一次 submit 之前，discarded 标记 & 计数列都已有正确值
      await saveCardResponseCodes(orderId, { sales_confirm: { cleared: true } }).catch(() => {});
    } else if (o.status === 'reviewing') {
      // 审核员驳回→灰化「订单待审核」卡按钮为"已驳回 (时间)"
      const approveCard = order.wecom_card_response_codes && order.wecom_card_response_codes.approve;
      let greyUserId = (approveCard && approveCard.userid) || user.wecom_userid || null;
      if (!greyUserId) {
        try {
          const wcfg = await getWecomConfig();
          greyUserId = wcfg && wcfg.booking_approver_userid ? wcfg.booking_approver_userid : null;
        } catch(_) { /* ignore */ }
      }
      if (greyUserId && approveCard && approveCard.response_code) {
        greyBookingCardButton(greyUserId, approveCard.response_code, '已驳回').catch(()=>{});
      }
      // 【方案 S】审核员驳回 → 审核卡作废（同样同步 await 写标记）
      await saveCardResponseCodes(orderId, { approve: { cleared: true } }).catch(() => {});
    }

    // 异步通知销售员（仅审核员驳回时通知）
    if (o.status === 'reviewing') {
      sendBookingNotification('reject', order, { rejectionReason }).catch(e => console.error('[booking reject notify] error:', e));
    }
    res.json({ ok: true, data: order });
  } catch (e) {
    console.error('[booking reject] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/booking/orders/:id/complete  标记完成 confirmed → completed
// body: { signature_data: string (base64 PNG, 必填) }
router.post('/orders/:id/complete', requireAuth, requireBookingWrite, async (req, res) => {
  try {
    const user = req.user || {};
    const orderId = req.params.id;
    const signatureData = (req.body && req.body.signature_data) || '';
    if (!signatureData) {
      return res.status(400).json({ ok: false, error: '请先签字再标记完成' });
    }
    const [rows] = await pool.query('SELECT * FROM booking_orders WHERE id = ? LIMIT 1', [orderId]);
    if (!rows.length) return res.status(404).json({ ok: false, error: '订单不存在' });
    const o = rows[0];
    if (o.status !== 'confirmed') return res.status(400).json({ ok: false, error: `状态 ${o.status} 不能标记完成` });

    // --- 业务角色限制 ---
    // 标记完成仅限配置的审核员（wecom_config.booking_approver_userid）
    const isReviewer = await isConfiguredBookingReviewer(user);
    if (!isReviewer) {
      return res.status(403).json({
        ok: false,
        error: '仅企业微信配置中指定的审核员可标记完成此订单',
      });
    }

    const completedByName = user.name || user.realName || user.displayName || null;
    await pool.query(`
      UPDATE booking_orders SET
        status = 'completed',
        completed_at = NOW(),
        completed_signature = ?,
        completed_by_name = ?
      WHERE id = ?
    `, [signatureData, completedByName, orderId]);
    logOperation(req, '预订订单', '标记完成', `订单号=${o.order_no} 操作人=${user.name || user.id}`, orderId);

    // 🔧 对齐采购确认页：标记完成签字 同步 await 双写
    await saveUserSignature({ order: o, loginUser: user }, signatureData);

    const order = await readOrderFull(orderId);
    res.json({ ok: true, data: order });
  } catch (e) {
    console.error('[booking complete] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// DELETE /api/booking/orders/:id  删除订单
// - admin：可删除任何状态的订单（级联删 items）
// - 其他角色：仅允许删除 pending 状态的订单（草稿专用）
// ============================================================
router.delete('/orders/:id', requireAuth, requireBookingWrite, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query('SELECT * FROM booking_orders WHERE id = ? LIMIT 1', [req.params.id]);
    if (!rows || !rows.length) return res.status(404).json({ ok: false, error: '订单不存在' });
    const o = rows[0];
    if (o.is_template === 1) {
      return res.status(400).json({ ok: false, error: '模板订单请使用 unset-template 接口删除' });
    }

    const isAdmin = req.user && req.user.role === 'admin';

    // 非管理员仅允许删除 pending 草稿
    if (!isAdmin && o.status !== 'pending') {
      return res.status(400).json({ ok: false, error: `仅草稿状态（pending）可删除，当前状态 ${o.status} 不允许删除；如需删除请联系管理员` });
    }

    await conn.beginTransaction();
    await conn.query('DELETE FROM booking_items WHERE order_id = ?', [req.params.id]);
    if (isAdmin) {
      // 管理员：删除该订单的所有业务 items，允许删除任何状态
      await conn.query('DELETE FROM booking_orders WHERE id = ? AND is_template = 0', [req.params.id]);
    } else {
      // 非管理员：仅删除 pending 状态订单
      await conn.query('DELETE FROM booking_orders WHERE id = ? AND status = ? AND is_template = 0', [req.params.id, 'pending']);
    }
    await conn.commit();
    logOperation(req, '预订订单', isAdmin ? '管理员删除订单' : '删除草稿', `订单号=${o.order_no}`, req.params.id);
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

// PUT /api/booking/orders/:id   编辑（放开所有非 completed 状态；reviewing/confirmed 触发卡片更新+通知）
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
    const originalStatus = cur.status;
    if (!EDITABLE_STATUS.includes(originalStatus)) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: `当前状态 ${cur.status} 不允许编辑` });
    }

    const items = (req.body.items || []).filter(it => it.item_type !== 'breakfast');
    const totalAmount = computeTotalAmount(items);

    await conn.query(`
      UPDATE booking_orders SET
        customer_name = ?, contact_name = ?, contact_phone = ?,
        sales_person = ?, sales_person_id = ?, sales_wecom_userid = ?,
        payment_method = ?, remark = ?, total_amount = ?
      WHERE id = ?
    `, [
      req.body.customerName || cur.customer_name,
      req.body.contactName || cur.contact_name,
      req.body.contactPhone || cur.contact_phone,
      req.body.salesPerson || cur.sales_person,
      req.body.salesPersonId || cur.sales_person_id,
      req.body.salesWecomUserid || cur.sales_wecom_userid,
      req.body.paymentMethod || cur.payment_method,
      req.body.remark ?? cur.remark,
      totalAmount,
      orderId,
    ]);

    // 先删旧 items，再插入新的（简单可靠）
    await conn.query('DELETE FROM booking_items WHERE order_id = ?', [orderId]);
    await insertItems(conn, orderId, items);

    // confirmed 状态修改 → 自动降级为 reviewing 重新审批
    if (originalStatus === 'confirmed') {
      await conn.query("UPDATE booking_orders SET status = 'reviewing', confirmed_at = NULL, confirmed_by = NULL WHERE id = ?", [orderId]);
    }

    await conn.commit();
    logOperation(req, '预订订单', '编辑', `订单号=${cur.order_no} 原状态=${originalStatus}`, orderId);

    // --- 提交后通知逻辑（事务外，失败不回滚）---
    const order = await readOrderFull(orderId);
    const notifyInfo = await handleOrderEditNotification(originalStatus, order, req);

    res.json({ ok: true, data: order, notify: notifyInfo });
  } catch (e) {
    await conn.rollback();
    console.error('[booking PUT order] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    conn.release();
  }
});

// ============================================================
// 订单编辑后通知处理（reviewing 更新审核卡+通知；confirmed→reviewing 重走审批；sales_confirming 更新销售卡）
// ============================================================
async function handleOrderEditNotification(originalStatus, order, req) {
  const result = { action: originalStatus === 'confirmed' ? 'confirmed_to_reviewing' : (originalStatus + '_modified') };
  try {
    if (!order) return result;

    const config = await getWecomConfig();
    if (!config) {
      console.warn('[handleOrderEditNotification] wecom_config 未配置，跳过通知');
      return result;
    }

    const orderNo = order.order_no || order.id;
    const customerName = order.customer_name || '未知客户';
    const bizSummary = buildBizSummary(order.items);
    const changeTime = formatNowCN();
    const cardUrl = config.app_domain ? `${config.app_domain}/booking-confirm?id=${encodeURIComponent(order.id || '')}` : '';
    const cardCodes = parseMaybeJson(order.wecom_card_response_codes) || {};

    // --- 给审核员发文字提醒（reviewing / confirmed 均发）---
    if ((originalStatus === 'reviewing' || originalStatus === 'confirmed') && config.booking_approver_userid) {
      // 发送文字通知
      try {
        const text = originalStatus === 'confirmed'
          ? `📋 订单 ${orderNo}（${customerName}）已修改，需重新审核。\n业务：${bizSummary}\n金额：¥${order.total_amount || 0}\n时间：${changeTime}\n${cardUrl ? '链接：' + cardUrl : ''}`
          : `📝 订单 ${orderNo}（${customerName}）已被修改，请重新审核。\n业务：${bizSummary}\n金额：¥${order.total_amount || 0}\n时间：${changeTime}\n${cardUrl ? '链接：' + cardUrl : ''}`;
        await sendTextToUser(config, config.booking_approver_userid, text);
        console.log(`[handleOrderEditNotification] 审核员文字通知已发送: orderNo=${orderNo}, approver=${config.booking_approver_userid}`);
      } catch (e) {
        console.error(`[handleOrderEditNotification] 审核员文字通知失败:`, e && e.message);
      }
    }

    // --- 更新审核卡片内容（reviewing / confirmed 均更新）---
    if ((originalStatus === 'reviewing' || originalStatus === 'confirmed')) {
      const approveCard = cardCodes.approve;
      if (approveCard && approveCard.response_code) {
        try {
          const mainTitle = originalStatus === 'confirmed'
            ? '📋 订单待审核（已变更·需重审）'
            : '📋 订单待审核（已修改）';
          const subTitle = `订单号：${orderNo}\n订单已于 ${changeTime} 被修改，请${originalStatus === 'confirmed' ? '重新审批' : '重新审核'}`;
          const hContent = [
            { keyname: '客户', value: customerName },
            { keyname: '业务', value: bizSummary },
            { keyname: '金额', value: `¥${order.total_amount || 0}` },
          ];
          if (order.remark) hContent.push({ keyname: '备注', value: order.remark });

          const card = {
            card_type: 'button_interaction',
            source: { desc: '预订管理系统' },
            main_title: { title: mainTitle, desc: customerName },
            sub_title_text: subTitle,
            horizontal_content_list: hContent,
            button_list: [{
              text: originalStatus === 'confirmed' ? '重新审批' : '去审核',
              style: 1,
              type: 1,
              key: `go_booking_${order.id}`,
              url: cardUrl,
            }],
          };
          await updateTemplateCard(config, config.booking_approver_userid, 'button_interaction', approveCard.response_code, {
            main_title: card.main_title,
            sub_title_text: card.sub_title_text,
            horizontal_content_list: card.horizontal_content_list,
            button_list: card.button_list,
          });
          console.log(`[handleOrderEditNotification] 审核卡片已更新: orderNo=${orderNo}`);
        } catch (e) {
          console.error(`[handleOrderEditNotification] 审核卡片更新失败:`, e && e.message);
        }
      }
    }

    // --- 更新销售员确认卡片（sales_confirming）---
    if (originalStatus === 'sales_confirming') {
      const salesCard = cardCodes.sales_confirm;
      if (salesCard && salesCard.response_code) {
        try {
          const hContent = [
            { keyname: '客户', value: customerName },
            { keyname: '业务', value: bizSummary },
            { keyname: '金额', value: `¥${order.total_amount || 0}` },
          ];
          if (order.remark) hContent.push({ keyname: '备注', value: order.remark });

          await updateTemplateCard(config, salesCard.userid, 'button_interaction', salesCard.response_code, {
            main_title: { title: '📋 订单待确认（已修改）', desc: customerName },
            sub_title_text: `订单号：${orderNo}\n订单已于 ${changeTime} 被修改，请重新确认`,
            horizontal_content_list: hContent,
            button_list: [{
              text: '去确认',
              style: 1,
              type: 1,
              key: `go_booking_${order.id}`,
              url: cardUrl,
            }],
          });
          console.log(`[handleOrderEditNotification] 销售员确认卡片已更新: orderNo=${orderNo}`);
        } catch (e) {
          console.error(`[handleOrderEditNotification] 销售员卡片更新失败:`, e && e.message);
        }
      }
    }

    // --- 群通知（可选）---
    if (config.booking_webhook_url && (originalStatus === 'confirmed')) {
      try {
        const md = `⚠️ **订单已修改（需重新审核）**\n` +
          `> 订单号：${orderNo}\n` +
          `> 客户：${customerName}\n` +
          `> 业务：${bizSummary}\n` +
          `> 金额：¥${order.total_amount || 0}\n` +
          `> 修改时间：${changeTime}\n` +
          `> 状态：已退回审批中`;
        await sendMarkdownViaWebhook(config.booking_webhook_url, md);
      } catch (e) {
        console.error(`[handleOrderEditNotification] 群通知失败:`, e && e.message);
      }
    }
  } catch (e) {
    console.error(`[handleOrderEditNotification] 主逻辑失败:`, e && e.message);
  }
  return result;
}

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
