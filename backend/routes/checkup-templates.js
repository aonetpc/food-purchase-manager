/**
 * 工具：体检销售套餐模板 / 套餐方案（Phase 2-1 ~ 2-7）
 * 说明：所有接口挂在 /api/booking/checkup-templates（需登录）和 /api/booking/checkup-share（免登录）
 * 响应结构：{ ok: boolean, data: any, error?: string }
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../db');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

// ---------- 项目名关键字规则（与前端 WizardItems 保持一致） ----------
const MALE_ONLY_KEYS = ['前列腺','阴囊','精液','男科','睾丸','勃起','包皮','精索','附睾','PSA','男性激素'];
const FM_ONLY_KEYS = ['阴超','阴道B','阴道镜','宫腔镜','妇科内诊','双合诊','白带','宫颈刮片','TCT','液基','HPV','宫颈','阴道'];
const FEMALE_KEYS = ['乳腺','卵巢','子宫','盆腔','附件','性激素','雌激素','孕酮','妇科','妇产科','产前','唐筛','孕检','HCG','人绒毛膜','月经','痛经'];
const SINGLE_FORBID_KEYS = ['经阴道'];
function nameHitKeys(name, keys) {
  const n = (name || '').toLowerCase();
  return keys.some(k => n.includes(k.toLowerCase()));
}
// 识别 (男)/(女) / （男）/（女） 后缀模式：判断是否是单性别专属（只含一种性别标记）
// 例："肿瘤标志11项（男）" → male-only；"肿瘤5项（男）/（女）" → 两者都有 非专属
function genderTagMode(name) {
  const n = name || '';
  const hasM = /[（(]男[)）]/.test(n) || n.includes('男士') || n.includes('男性专用') || n.includes('男专用') || (n.includes('男性') && !n.includes('女性'));
  const hasF = /[（(]女[)）]/.test(n) || n.includes('女士') || n.includes('女性专用') || n.includes('女专用') || (n.includes('女性') && !n.includes('男性'));
  if (hasM && !hasF) return 'M';
  if (hasF && !hasM) return 'F';
  return 'N';
}
// 判断 common 区某项目是否对指定角色适用（与前端 scopeVisible 逻辑一致）
function isItemVisibleForRole(it, role) {
  const name = it.item_name_snapshot || it.item_name || '';
  const roles = it.applicable_roles ? (typeof it.applicable_roles === 'string' ? (() => { try { return JSON.parse(it.applicable_roles); } catch(_) { return null; } })() : it.applicable_roles) : null;
  if (roles && Array.isArray(roles) && roles.length > 0) {
    return roles.includes(role);
  }
  // (男)/(女) 后缀模式兜底（适用于 applicable_roles 未填充的老项目，如肿瘤11项（男）/（女））
  const gMode = genderTagMode(name);
  if (gMode === 'M') {
    return role === 'male';
  }
  if (gMode === 'F') {
    return role === 'female_married' || role === 'female_single';
  }
  if (role === 'male') {
    if (nameHitKeys(name, FM_ONLY_KEYS)) return false;
    if (nameHitKeys(name, FEMALE_KEYS)) return false;
    return true;
  }
  if (role === 'female_married') {
    if (nameHitKeys(name, MALE_ONLY_KEYS)) return false;
    return true;
  }
  if (role === 'female_single') {
    if (nameHitKeys(name, MALE_ONLY_KEYS)) return false;
    if (nameHitKeys(name, FM_ONLY_KEYS)) return false;
    if (nameHitKeys(name, SINGLE_FORBID_KEYS)) return false;
    return true;
  }
  return true;
}

// 根据项目名称关键词自动推断/纠正角色可见性（方案C）
// 当前端传入 role='common' 但项目名命中男性专属/侵入性妇科关键字时，自动纠正为对应角色
// 优先级：MALE_ONLY_KEYS → male，FM_ONLY_KEYS/SINGLE_FORBID_KEYS → female_married
// FEMALE_KEYS 类项目保持 common（因 read-time isItemVisibleForRole 已正确过滤）
function autoCorrectItemRole(item) {
  const name = (item.item_name_snapshot || item.item_name || '').toLowerCase();
  const origName = item.item_name_snapshot || item.item_name || '';
  const currentRole = item.role || 'common';

  // 仅当角色为 common 时才做自动纠正（前端显式指定 role 的保持不变）
  if (currentRole !== 'common') return currentRole;

  // (男)/(女) 后缀识别：命中单性别 → 纠正到对应 role
  const gMode = genderTagMode(origName);
  if (gMode === 'M') return 'male';
  if (gMode === 'F') {
    // 女性专属再看是否是侵入性检查
    if (nameHitKeys(name, FM_ONLY_KEYS) || nameHitKeys(name, SINGLE_FORBID_KEYS)) return 'female_married';
    // 非侵入性的保持 common（isItemVisibleForRole 读时就会排除男性视角）
    return currentRole;
  }

  // 男性专属关键字 → 改为 male
  if (nameHitKeys(name, MALE_ONLY_KEYS)) return 'male';
  // 侵入性妇科关键字 → 改为 female_married
  if (nameHitKeys(name, FM_ONLY_KEYS)) return 'female_married';
  // 未婚禁用关键字 → 改为 female_married
  if (nameHitKeys(name, SINGLE_FORBID_KEYS)) return 'female_married';

  return currentRole; // 保持 common
}

// ---------- 路径常量 ----------
const PDF_DIR = '/opt/food-purchase/backend/uploads/pdfs';
if (!fs.existsSync(PDF_DIR)) {
  try { fs.mkdirSync(PDF_DIR, { recursive: true }); } catch (_) { /* 忽略 */ }
}

// 三个角色枚举
const ROLES = ['male', 'female_married', 'female_single', 'female_unmarried'];
// feat/107 Fix#4: female_unmarried 别名归一：防止 DB applicable_roles / 前端传来 female_unmarried
//   逻辑：female_single 和 female_unmarried 是同一个语义，aggregate/readPackageFull 末尾合并
const ROLE_NORM = (r) => {
  if (r === 'female_unmarried' || r === 'female_single') return 'female_single';
  return r;
};
const ROLE_META = {
  male:             { name: '男性',    emoji: '👨' },
  female_married:   { name: '已婚女性', emoji: '👩' },
  female_single:    { name: '未婚女性', emoji: '👧' },
};

// ---------- 工具函数 ----------
function parseMaybeJson(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch (_) { return null; }
  }
  return value;
}
function toNum(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  if (typeof v === 'object') {
    const s = v.String || v.string || v.val || '';
    return parseFloat(s) || 0;
  }
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}
function round2(n) { return Math.round(toNum(n) * 100) / 100; }
/**
 * 判断用户是否拥有管理员/董事长/manager 级权限
 * 三级兜底（与 rbac.js requireRole / requireBookingAdmin 保持一致）：
 *   1. user.role 主角色命中
 *   2. 多角色表（user_roles UNION users.role_id）兜底查询
 *   3. permissionCodes 权限码降级（menu:permission / menu:users 等管理级权限）
 */
async function isAdminOrManager(user) {
  if (!user) return false;
  const ADMIN_ROLES = ['admin', 'boss', 'manager'];

  // 1. 主角色命中
  const mainRole = (user.role || '').toLowerCase();
  if (ADMIN_ROLES.includes(mainRole)) return true;

  // 2. 多角色表兜底查询（只有当 user.id 存在时才查库）
  if (user.id) {
    try {
      const [roleCodeRows] = await pool.query(`
        SELECT DISTINCT r.code
        FROM (
          SELECT role_id FROM user_roles WHERE user_id = ?
          UNION
          SELECT role_id FROM users WHERE id = ? AND role_id IS NOT NULL
        ) t
        JOIN roles r ON r.id = t.role_id
      `, [user.id, user.id]);
      const userRoleCodes = roleCodeRows.map(r => (r.code || '').toLowerCase());
      if (ADMIN_ROLES.some(r => userRoleCodes.includes(r))) return true;
    } catch (_) {
      // 查询失败保守处理：继续走第 3 层
    }
  }

  // 3. permissionCodes 权限码降级（有任一管理级权限即视为管理员）
  if (user.permissionCodes && user.permissionCodes.size > 0) {
    const adminPermCodes = [
      'menu:permission', 'menu:users', 'menu:roles',
      'menu:departments', 'menu:wecom', 'action:booking:config',
    ];
    if (adminPermCodes.some(code => user.permissionCodes.has(code))) return true;
  }
  // 兼容：旧场景 permissions.codes 是字符串数组
  const permArr = (user.permissions && user.permissions.codes) ? user.permissions.codes : null;
  if (Array.isArray(permArr) && permArr.length > 0) {
    const adminPermCodes = ['menu:permission','menu:users','menu:roles','menu:departments','menu:wecom','action:booking:config'];
    if (adminPermCodes.some(code => permArr.includes(code))) return true;
  }

  return false;
}
// SQL JSON_CONTAINS(JSON, string) 兼容 MySQL 5.7/8.0
function coverIncludes(coverJsonField, userId) {
  // 返回 WHERE 片段数组，外部拼 `(1=2 OR ${clauses.join(' OR ')})`
  return `JSON_CONTAINS(${coverJsonField}, ${pool.escape(JSON.stringify(userId))})`;
}

// 读取套餐明细（LEFT JOIN 回填 price/name 快照；合并 common + 单独角色）
let _hasClinicalSignificance = null; // 缓存列存在性
async function listPackageItems(packageId) {
  // 动态检测 clinical_significance 列是否存在（兼容迁移未执行的情况）
  if (_hasClinicalSignificance === null) {
    try {
      const [cols] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_checkup_items' AND COLUMN_NAME = 'clinical_significance'`
      );
      _hasClinicalSignificance = (cols[0].cnt > 0);
    } catch (_) {
      _hasClinicalSignificance = false;
    }
  }
  const csSelect = _hasClinicalSignificance ? 'ci.clinical_significance' : 'NULL AS clinical_significance';
  const [rows] = await pool.query(
    `SELECT pi.id, pi.package_id, pi.item_id, pi.role, pi.quantity, pi.remark, pi.sort_order,
            CASE WHEN (pi.item_name_snapshot IS NULL OR pi.item_name_snapshot = '') THEN ci.name ELSE pi.item_name_snapshot END AS item_name_snapshot,
            CASE WHEN (pi.item_price IS NULL OR pi.item_price = 0) THEN ci.default_price ELSE pi.item_price END AS item_price,
            CASE WHEN (pi.insurance_price_snapshot IS NULL OR pi.insurance_price_snapshot = 0) THEN ci.insurance_price ELSE pi.insurance_price_snapshot END AS insurance_price_snapshot,
            ci.category, ci.item_type, ${csSelect}, ci.applicable_roles
     FROM booking_package_items AS pi
     LEFT JOIN booking_checkup_items AS ci ON ci.id = pi.item_id
     WHERE pi.package_id = ?
     ORDER BY pi.role ASC, pi.sort_order ASC, pi.id ASC`,
    [packageId]
  );
  // 组合项目：批量查 booking_item_sub_items 里的真实子项配置（用户要求只读取后台已配置好的关系，不用兜底）
  // 只要 combo_item_id 在本次套餐项目的 item_id 集合里，就按 sort_order + 子项id 排序返回子项目名
  const itemIds = rows.map(r => r.item_id).filter(Boolean);
  if (itemIds.length > 0) {
    const placeholders = itemIds.map(() => '?').join(',');
    try {
      const [subRows] = await pool.query(
        `SELECT sub.combo_item_id, ci.name AS sub_name
           FROM booking_item_sub_items AS sub
           LEFT JOIN booking_checkup_items AS ci ON ci.id = sub.sub_item_id
          WHERE sub.combo_item_id IN (${placeholders})
          ORDER BY sub.combo_item_id, sub.sort_order ASC, sub.id ASC`,
        itemIds
      );
      const subMap = new Map();
      for (const s of subRows) {
        if (!s || !s.sub_name) continue;
        if (!subMap.has(s.combo_item_id)) subMap.set(s.combo_item_id, []);
        subMap.get(s.combo_item_id).push(s.sub_name);
      }
      for (const r of rows) {
        if (subMap.has(r.item_id)) {
          r.sub_item_names = subMap.get(r.item_id);
        }
      }
    } catch (err) {
      // booking_item_sub_items 表不存在（极旧库）时静默忽略，不影响主流程
      if (!/Table.*doesn.*exist/i.test(String(err.message || ''))) throw err;
    }
  }
  return rows;
}

// 合并 common + 单角色，返回三个角色的 {total, item_count, items:[{...}]}
function aggregateRoleItems(items, applicableRoles = ROLES) {
  const enabled = Array.isArray(applicableRoles) && applicableRoles.length
    ? applicableRoles
    : ROLES;
  const commons = items.filter(i => !i.role || i.role === 'common');
  const result = {};
  for (const role of ROLES) {
    // feat/107 Fix#4: 归一后 enabled 判断，female_unmarried 和 female_single 视为都能过
    const norm = ROLE_NORM(role);
    const enabledMatch = enabled.includes(role) || (norm !== role && enabled.includes(norm));
    if (!enabledMatch) { result[role] = { total: 0, item_count: 0, items: [] }; continue; }
    const roleItems = items.filter(i => ROLE_NORM(i.role) === norm);
    // 以 item_id 去重：单独角色项优先覆盖 common（同 item_id 出现两次时用 role 那一条的 qty/price）
    const map = new Map();
    for (const c of commons) {
      // common 区只合并对该角色适用的项目（妇科不计入男性等）
      if (!isItemVisibleForRole(c, norm)) continue;
      map.set(c.item_id + '|common', { ...c, role });
    }
    for (const r of roleItems) {
      if (!isItemVisibleForRole(r, norm)) continue;
      const commonKey = r.item_id + '|common';
      if (map.has(commonKey)) map.delete(commonKey);
      map.set(r.item_id + '|' + role, r);
    }
    const merged = [...map.values()];
    let total = 0;
    for (const it of merged) {
      const qty = Math.max(1, toNum(it.quantity) || 1);
      total += toNum(it.item_price) * qty;
    }
    result[role] = {
      total: round2(total),
      item_count: merged.length,
      items: merged,
    };
  }
  // feat/107 Fix#4 归一合并：female_single 和 female_unmarried 同语义 → 两套去重叠加后两边都有值
  const fs = result.female_single;
  const fu = result.female_unmarried;
  if (fs && fu && fs.item_count !== fu.item_count) {
    const merged = mergeRoleBucket([fs, fu]);
    result.female_single = merged;
    result.female_unmarried = merged;
  } else if (fu && (!fs || fs.item_count === 0)) {
    result.female_single = fu;
  } else if (fs && (!fu || fu.item_count === 0)) {
    result.female_unmarried = fs;
  }
  return result;
}
// 辅助：合并多个 role bucket（按 item_id 去重叠加 items，total 求和去重）
function mergeRoleBucket(buckets) {
  const m = new Map();
  for (const b of buckets) {
    for (const it of (b.items || [])) {
      const k = String(it.item_id ?? it.id);
      if (!m.has(k)) m.set(k, it);
    }
  }
  const items = [...m.values()];
  let total = 0;
  for (const it of items) total += toNum(it.item_price) * Math.max(1, toNum(it.quantity) || 1);
  return { total: round2(total), item_count: items.length, items };
}

// 归一化：原价为0但折扣价有值时，用折扣价当原价（老套餐未写original_total的兜底）
function normalizePlanOrig(plan) {
  const ot = round2(plan.original_total);
  const dp = round2(plan.discount_price);
  return {
    original_total: ot === 0 && dp > 0 ? dp : ot,
    discount_price: dp,
    discount_rate: round2(plan.discount_rate),
    remark: plan.remark ?? null,
  };
}

// 读取单个套餐 + role_plans + 明细聚合
async function readPackageFull(packageId) {
  const [rows] = await pool.query('SELECT * FROM booking_packages WHERE id = ?', [packageId]);
  if (rows.length === 0) return null;
  const pkg = rows[0];
  pkg.applicable_roles = parseMaybeJson(pkg.applicable_roles) || ROLES;
  pkg.cover_sales_ids = parseMaybeJson(pkg.cover_sales_ids) || null;
  const [plans] = await pool.query('SELECT * FROM booking_package_role_plans WHERE package_id = ?', [packageId]);
  pkg.role_plans = plans.reduce((m, r) => {
    m[r.role] = normalizePlanOrig(r);
    return m;
  }, {});
  // 缺失的角色补默认（空套餐）
  for (const r of ROLES) {
    if (!pkg.role_plans[r]) {
      pkg.role_plans[r] = { original_total: 0, discount_price: 0, discount_rate: 100, remark: null };
    }
  }
  // feat/107 Fix#4 别名归一：DB 存的是 female_single 但前端查 female_unmarried → 给 role_plans 两边都写
  const fu = pkg.role_plans.female_unmarried;
  const fs = pkg.role_plans.female_single;
  if (!fu && fs) pkg.role_plans.female_unmarried = fs;
  if (!fs && fu) pkg.role_plans.female_single = fu;
  // 明细：按 role 拆
  const allItems = await listPackageItems(packageId);
  const agg = aggregateRoleItems(allItems, pkg.applicable_roles);
  pkg.role_items = {};
  for (const r of ROLES) pkg.role_items[r] = agg[r];
  pkg.item_count = Math.max(...ROLES.map(r => agg[r].item_count));

  // ====== 价格对齐（关键修复）======
  // DB 里存的 role_plans.original_total 可能是历史bug期间的快照（含跨角色项目），
  // 而现在 role_items[r].total 是基于"修好的可见性 + 当前套餐明细"动态重算的正确值。
  // 保证前端读 role_plans 或 role_items.total 都得到一致的原价：
  //   以 role_items[r].total 为 original_total 基准，discount_price 保持不变（销售谈判价），
  //   discount_rate = discount_price / new_original_total × 100 重算。
  for (const r of ROLES) {
    const computedTotal = round2(pkg.role_items[r]?.total || 0);
    if (computedTotal <= 0) continue;
    const plan = pkg.role_plans[r] || {};
    const price = round2(plan.discount_price) || 0;
    const newRate = price > 0 ? round2(price / computedTotal * 100) : round2(plan.discount_rate) || 100;
    pkg.role_plans[r] = {
      ...plan,
      original_total: computedTotal,
      discount_rate: newRate,
      discount_price: price,
    };
  }
  // feat/107 Fix#4: role_plans 价格对齐后再同步一次别名（归一时新增的 role_plans 条目也需要被处理）
  if (!pkg.role_plans.female_unmarried && pkg.role_plans.female_single) pkg.role_plans.female_unmarried = pkg.role_plans.female_single;
  if (!pkg.role_plans.female_single && pkg.role_plans.female_unmarried) pkg.role_plans.female_single = pkg.role_plans.female_unmarried;

  // 原始明细（前端编辑用，按 role 分组）
  const byRole = { common: [], male: [], female_married: [], female_single: [], female_unmarried: [] };
  for (const it of allItems) {
    const key = it.role && byRole[it.role] ? it.role : 'common';
    byRole[key].push(it);
  }
  // female_unmarried 别名也同步一份
  byRole.female_unmarried = byRole.female_single;
  pkg.items_by_role = byRole;
  return pkg;
}

// 校验可见性：当前用户能否看到某套餐
async function canUserViewPackage(user, pkg) {
  if (await isAdminOrManager(user)) return true;
  if (pkg.is_public === 1) return true;  // 公共模板所有销售都能克隆（也能看到，保护字段不展示折扣价详情由前端控制）
  if (pkg.owner_sales_id === user.id) return true;
  // 管理员分配给我的
  const covers = parseMaybeJson(pkg.cover_sales_ids);
  if (Array.isArray(covers) && covers.includes(user.id)) return true;
  return false;
}
async function canUserEditPackage(user, pkg) {
  if (await isAdminOrManager(user)) return true;
  // 销售只能编辑自己创建的；公共模板和分配给我的只能克隆不能改
  return pkg.owner_sales_id === user.id;
}

// ============================================================
// PHASE 2-1: 销售套餐模板 CRUD + 权限过滤
// ============================================================

/**
 * GET /api/booking/checkup-templates
 *  Query: scope(可选)=mine|shared|public|all（默认：销售→mine+public+shared，管理员→all）
 *         keyword: 按名称搜索
 *  权限：登录
 */
router.get('/', async (req, res) => {
  try {
    const user = req.user;
    const { scope, keyword = '' } = req.query;
    const clauses = [];
    const args = [];

    // 可见性 + scope 过滤（管理员 / 销售均按 Tab 切）
    if (!(await isAdminOrManager(user))) {
      // 销售：三Tab严格区分，避免"我的套餐"混入公共模板
      if (scope === 'mine') {
        clauses.push(`owner_sales_id = ?`);
        args.push(user.id);
      } else if (scope === 'public') {
        clauses.push(`is_public = 1`);
      } else if (scope === 'shared') {
        clauses.push(`JSON_CONTAINS(cover_sales_ids, ?)`);
        args.push(JSON.stringify(user.id));
      } else {
        // 兜底：scope 缺省时，返回"我能看到的全部"（同旧逻辑）
        clauses.push(`(
          is_public = 1
          OR owner_sales_id = ?
          OR JSON_CONTAINS(cover_sales_ids, ?)
        )`);
        args.push(user.id, JSON.stringify(user.id));
      }
    } else {
      // 管理员：三Tab独立筛选；shared 通过 cover_sales_ids 过滤；缺省返回全部
      if (scope === 'mine') {
        clauses.push(`(owner_sales_id IS NULL OR owner_sales_id = ?)`);
        args.push(user.id);
      } else if (scope === 'public') {
        clauses.push(`is_public = 1`);
      } else if (scope === 'shared') {
        clauses.push(`JSON_CONTAINS(cover_sales_ids, ?)`);
        args.push(JSON.stringify(user.id));
      }
    }

    if (keyword) {
      clauses.push(`(name LIKE ? OR code LIKE ?)`);
      args.push(`%${keyword}%`, `%${keyword}%`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const [rows] = await pool.query(
      `SELECT p.* FROM booking_packages p ${where} ORDER BY p.sort_order ASC, p.created_at DESC`,
      args
    );

    // 补齐 role_plans（三角色胶囊价格）
    const pids = rows.map(r => r.id);
    const plansMap = new Map();
    if (pids.length > 0) {
      const [plans] = await pool.query(
        `SELECT * FROM booking_package_role_plans WHERE package_id IN (${pids.map(() => '?').join(',')})`,
        pids
      );
      for (const pl of plans) {
        if (!plansMap.has(pl.package_id)) plansMap.set(pl.package_id, {});
        plansMap.get(pl.package_id)[pl.role] = normalizePlanOrig(pl);
      }
    }
    // ========== 兜底：对 role_plans.price=0 的套餐，从 items 快照临算，避免 ListPage 显示 ¥0 ==========
    // 场景：克隆生成的套餐用户中途退出没点「生成方案」时，DB 还没被 items-batch 重写过就会停留在 0
    const fallbackPids = [];
    for (const [pid, plans] of plansMap.entries()) {
      for (const r of ROLES) {
        const pl = plans[r];
        if (!pl || Number(pl.discount_price) === 0) { fallbackPids.push(pid); break; }
      }
    }
    // 兼容 plansMap 中没有 pid（三角色都没建 plans 行）的情况
    for (const pid of pids) {
      if (!plansMap.has(pid) && !fallbackPids.includes(pid)) fallbackPids.push(pid);
    }
    if (fallbackPids.length > 0) {
      const [itemsRows] = await pool.query(
        `SELECT package_id, role, item_price, insurance_price_snapshot, quantity
         FROM booking_package_items
         WHERE package_id IN (${fallbackPids.map(() => '?').join(',')})`,
        fallbackPids
      );
      const byPkg = new Map();
      for (const it of itemsRows) {
        if (!byPkg.has(it.package_id)) byPkg.set(it.package_id, []);
        byPkg.get(it.package_id).push(it);
      }
      for (const pid of fallbackPids) {
        const plans = plansMap.get(pid) || {};
        const arr = byPkg.get(pid) || [];
        const totals = { male: 0, female_married: 0, female_single: 0 };
        for (const it of arr) {
          const amt = (toNum(it.item_price) + toNum(it.insurance_price_snapshot)) * Math.max(1, toNum(it.quantity) || 1);
          if (it.role === 'common') { for (const r of ROLES) totals[r] += amt; }
          else if (totals[it.role] !== undefined) totals[it.role] += amt;
        }
        for (const r of ROLES) {
          if (!plans[r] || Number(plans[r].discount_price) === 0) {
            const t = round2(totals[r]);
            plans[r] = { original_total: t, discount_price: t, discount_rate: 100 };
          }
        }
        plansMap.set(pid, plans);
      }
    }
    // =====================================================================================

    const list = rows.map(p => {
      const plans = plansMap.get(p.id) || {};
      for (const r of ROLES) {
        if (!plans[r]) plans[r] = { original_total: 0, discount_price: 0, discount_rate: 100 };
      }
      return {
        id: p.id, code: p.code, name: p.name, description: p.description,
        status: p.status, sort_order: p.sort_order,
        owner_sales_id: p.owner_sales_id, is_public: !!p.is_public,
        base_template_id: p.base_template_id || null,
        applicable_roles: parseMaybeJson(p.applicable_roles) || ROLES,
        cover_sales_ids: parseMaybeJson(p.cover_sales_ids) || [],
        has_share: !!p.share_token,
        share_expire_at: p.share_expire_at || null,
        created_at: p.created_at, updated_at: p.updated_at,
        price: p.price,  // 兼容旧字段
        role_price_capsule: plans,
      };
    });
    res.json({ ok: true, data: list });
  } catch (e) {
    console.error('[checkup-templates list] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * POST /api/booking/checkup-templates
 *   Body: { name, code?, applicable_roles: string[], base_template_id?, is_public?(管理员可true) }
 *   空壳创建，items 通过 items-batch 接口批量保存；克隆请走 POST /:id/clone
 */
router.post('/', async (req, res) => {
  try {
    const user = req.user;
    const {
      name, code,
      applicable_roles = ROLES,
      base_template_id = null,
      is_public = false,
      description = null,
    } = req.body || {};

    if (!name || !String(name).trim()) {
      return res.status(400).json({ ok: false, error: '套餐名称必填' });
    }
    const roleArr = Array.isArray(applicable_roles)
      ? applicable_roles.filter(r => ROLES.includes(r))
      : ROLES;
    if (roleArr.length === 0) return res.status(400).json({ ok: false, error: '至少选择一种适用角色' });

    // 只有管理员能建公共套餐
    const pubFlag = (is_public === true || is_public === 1) && (await isAdminOrManager(user)) ? 1 : 0;

    const id = uuidv4();
    let finalCode = code && String(code).trim() ? String(code).trim() : 'PK' + Date.now().toString().slice(-8);
    // code 唯一性（忽略重复，附加随机）
    const [exist] = await pool.query('SELECT id FROM booking_packages WHERE code = ? LIMIT 1', [finalCode]);
    if (exist.length > 0) finalCode += '_' + Math.floor(Math.random() * 9999);

    // 双保险：先检查 description 列是否存在（历史数据库 080 迁移未执行时兜底）
    let hasDescCol = true;
    try {
      const [crows] = await pool.query(
        `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='booking_packages' AND COLUMN_NAME='description'`
      );
      hasDescCol = (crows && crows[0] && Number(crows[0].c) > 0);
    } catch (e) {
      hasDescCol = true; // 失败按有列处理，随后 SQL 报错被 catch
    }

    const columns = ['id', 'code', 'name'];
    if (hasDescCol) columns.push('description');
    columns.push('owner_sales_id', 'is_public', 'base_template_id', 'applicable_roles', 'status', 'sort_order', 'price', 'discount_rate');

    const placeholders = new Array(columns.length).fill('?').join(',');
    const args = [id, finalCode, String(name).trim()];
    if (hasDescCol) args.push(description || null);
    args.push(
      pubFlag === 1 ? null : user.id,
      pubFlag,
      base_template_id || null,
      JSON.stringify(roleArr),
      1, 100, 0, 100
    );

    const [ins] = await pool.query(
      `INSERT INTO booking_packages (${columns.join(',')}) VALUES (${placeholders})`,
      args
    );

    // 初始化三条 role_plans
    for (const r of ROLES) {
      await pool.query(
        `INSERT INTO booking_package_role_plans (id, package_id, role, original_total, discount_price, discount_rate)
         VALUES (?, ?, ?, 0, 0, 100)
         ON DUPLICATE KEY UPDATE original_total=original_total`,
        [uuidv4(), id, r]
      );
    }

    const pkg = await readPackageFull(id);
    res.json({ ok: true, data: pkg });
  } catch (e) {
    console.error('[checkup-templates create] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// PHASE 2-8: 品牌配置 & 客户经理名片（路由必须在 /:id 之前，否则会被参数路由吞掉）
// ============================================================

// ---- 品牌配置：读 ----
router.get('/brand-config', async (req, res) => {
  try {
    const cfg = await getBrandConfigMap();
    res.json({ ok: true, data: buildCompanyFromCfg(cfg) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---- 品牌配置：写（管理员） ----
router.put('/brand-config', async (req, res) => {
  try {
    if (!(await isAdminOrManager(req.user))) return res.status(403).json({ ok: false, error: '仅管理员可设置品牌信息' });
    const b = req.body || {};
    // 字段映射：同时兼容前端短名(phone/address)和DB长名(company_phone/company_address)
    const pick = (keys) => {
      for (const k of keys) if (b[k] !== undefined && b[k] !== null) return b[k];
      return undefined;
    };
    const fields = [
      ['company_name', pick(['company_name', 'name'])],
      ['company_logo', pick(['company_logo', 'logo'])],
      ['company_slogan', pick(['company_slogan', 'slogan'])],
      ['company_address', pick(['company_address', 'address'])],
      ['company_phone', pick(['company_phone', 'phone'])],
      ['service_hours', b.service_hours],
      ['qualification', b.qualification],
      ['wechat_qrcode', b.wechat_qrcode],
      ['primary_color', b.primary_color],
    ];
    for (const [k, v] of fields) {
      const val = (v === undefined) ? null : String(v == null ? '' : v).trim() || null;
      await pool.query(
        `INSERT INTO checkup_brand_config (config_key, config_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
        [k, val]
      );
    }
    const cfg = await getBrandConfigMap();
    // 同时返回长名和短名字段，前端无论哪种命名都能拿到
    const c = buildCompanyFromCfg(cfg);
    res.json({ ok: true, data: { ...c, phone: c.phone, address: c.address } });
  } catch (e) {
    console.error('[brand-config put] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---- 客户经理名片：读 ----
router.get('/sales-profile/:userId', async (req, res) => {
  try {
    const userId = String(req.params.userId || '').trim();
    if (!userId) return res.status(400).json({ ok: false, error: 'userId必填' });
    const [rows] = await pool.query(
      `SELECT sp.*, u.name, u.phone
       FROM checkup_sales_profiles sp
       LEFT JOIN users u ON u.id = sp.user_id
       WHERE sp.user_id = ? LIMIT 1`,
      [userId]
    );
    let data = null;
    if (rows.length > 0) {
      const r = rows[0];
      data = {
        user_id: r.user_id,
        name: r.name,
        phone: r.phone,
        avatar_url: r.avatar_url,
        title: r.title,
        wechat_qrcode: r.wechat_qrcode,
        bio: r.bio,
        email: r.email,
      };
    } else {
      const [uRows] = await pool.query('SELECT id, name, phone FROM users WHERE id = ? LIMIT 1', [userId]);
      if (uRows.length > 0) {
        const u = uRows[0];
        data = {
          user_id: u.id, name: u.name, phone: u.phone || null,
          avatar_url: null, title: null, wechat_qrcode: null, bio: null, email: null,
        };
      }
    }
    res.json({ ok: true, data });
  } catch (e) {
    console.error('[sales-profile get] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---- 客户经理名片：保存（登录用户保存自己的） ----
router.put('/sales-profile', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: '请先登录' });
    const b = req.body || {};
    const avatar_url = b.avatar_url ? String(b.avatar_url).trim().slice(0, 512) : null;
    const title = b.title ? String(b.title).trim().slice(0, 64) : null;
    const wechat_qrcode = b.wechat_qrcode ? String(b.wechat_qrcode).trim().slice(0, 512) : null;
    const bio = b.bio ? String(b.bio).trim().slice(0, 255) : null;
    const email = b.email ? String(b.email).trim().slice(0, 128) : null;
    await pool.query(
      `INSERT INTO checkup_sales_profiles (user_id, avatar_url, title, wechat_qrcode, bio, email)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE avatar_url = VALUES(avatar_url), title = VALUES(title),
         wechat_qrcode = VALUES(wechat_qrcode), bio = VALUES(bio), email = VALUES(email)`,
      [userId, avatar_url, title, wechat_qrcode, bio, email]
    );
    const [uRows] = await pool.query('SELECT id, name, phone FROM users WHERE id = ? LIMIT 1', [userId]);
    const u = uRows[0] || { id: userId, name: '', phone: null };
    res.json({
      ok: true,
      data: {
        user_id: userId,
        name: u.name,
        phone: u.phone,
        avatar_url, title, wechat_qrcode, bio, email,
      }
    });
  } catch (e) {
    console.error('[sales-profile put] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /api/booking/checkup-templates/:id/preview
 *   预览端点：仅需登录，不做 canUserViewPackage 严格检查
 *   用于订单详情/体检预览等场景，和 listSalesCapsules 保持一致的权限哲学
 *   （预订功能本身已有权限控制，此处不重复检查）
 */
router.get('/:id/preview', async (req, res) => {
  try {
    const pkg = await readPackageFull(req.params.id);
    if (!pkg) return res.status(404).json({ ok: false, error: '套餐不存在' });
    // 仅需登录即可查看模板详情（用于订单详情/预览场景）
    // 敏感字段（owner/分配等）在 readPackageFull 中已处理
    res.json({ ok: true, data: pkg });
  } catch (e) {
    console.error('[checkup-templates preview] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /api/booking/checkup-templates/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const pkg = await readPackageFull(req.params.id);
    if (!pkg) return res.status(404).json({ ok: false, error: '套餐不存在' });
    if (!(await canUserViewPackage(req.user, pkg))) {
      return res.status(403).json({ ok: false, error: '无权查看此套餐' });
    }
    res.json({ ok: true, data: pkg });
  } catch (e) {
    console.error('[checkup-templates detail] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * PUT /api/booking/checkup-templates/:id
 *   Body: { name, code?, description?, status?, applicable_roles?, sort_order? }
 *   注意：折扣价、items 分别走 role-plans 和 items-batch 接口
 */
router.put('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM booking_packages WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ ok: false, error: '套餐不存在' });
    const pkg = rows[0];
    if (!(await canUserEditPackage(req.user, pkg))) {
      return res.status(403).json({ ok: false, error: '无权编辑此套餐' });
    }
    const {
      name, code, description, status, applicable_roles, sort_order,
    } = req.body || {};

    // 双保险：description 列不存在则跳过
    let hasDescCol = true;
    try {
      const [crows] = await pool.query(
        `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='booking_packages' AND COLUMN_NAME='description'`
      );
      hasDescCol = (crows && crows[0] && Number(crows[0].c) > 0);
    } catch (e) { hasDescCol = true; }

    const sets = [];
    const args = [];
    if (name !== undefined && String(name).trim()) { sets.push('name=?'); args.push(String(name).trim()); }
    if (code !== undefined && String(code).trim()) { sets.push('code=?'); args.push(String(code).trim()); }
    if (description !== undefined && hasDescCol) { sets.push('description=?'); args.push(description || null); }
    if (status !== undefined) { sets.push('status=?'); args.push(status ? 1 : 0); }
    if (sort_order !== undefined) { sets.push('sort_order=?'); args.push(Number(sort_order) || 100); }
    if (applicable_roles !== undefined && Array.isArray(applicable_roles)) {
      const roleArr = applicable_roles.filter(r => ROLES.includes(r));
      sets.push('applicable_roles=?'); args.push(JSON.stringify(roleArr));
    }
    if (sets.length > 0) {
      sets.push('updated_at=NOW()');
      args.push(pkg.id);
      await pool.query(`UPDATE booking_packages SET ${sets.join(',')} WHERE id = ?`, args);
    }
    const refreshed = await readPackageFull(pkg.id);
    res.json({ ok: true, data: refreshed });
  } catch (e) {
    console.error('[checkup-templates update] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * DELETE /api/booking/checkup-templates/:id
 *   管理员 / owner 可删，软删除 + 清空关联套餐项目和 role_plans
 */
router.delete('/:id', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM booking_packages WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ ok: false, error: '套餐不存在' });
    const pkg = rows[0];
    if (!(await canUserEditPackage(req.user, pkg))) {
      return res.status(403).json({ ok: false, error: '无权删除此套餐' });
    }
    await conn.query('DELETE FROM booking_package_items WHERE package_id = ?', [pkg.id]);
    await conn.query('DELETE FROM booking_package_role_plans WHERE package_id = ?', [pkg.id]);
    await conn.query('DELETE FROM booking_packages WHERE id = ?', [pkg.id]);
    await conn.commit();
    res.json({ ok: true, data: { id: pkg.id } });
  } catch (e) {
    try { await conn.rollback(); } catch (_) {}
    console.error('[checkup-templates delete] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  } finally { conn.release(); }
});

// ============================================================
// PHASE 2-2: 公共套餐克隆
// ============================================================
/**
 * POST /api/booking/checkup-templates/:id/clone
 *   Body: { name?, applicable_roles? }
 *   管理员克隆：owner=NULL 且 is_public=1
 *   销售克隆：owner=me 且 is_public=0（私有的），base_template_id 指向源
 */
router.post('/:id/clone', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [src] = await conn.query('SELECT * FROM booking_packages WHERE id = ?', [req.params.id]);
    if (src.length === 0) return res.status(404).json({ ok: false, error: '源套餐不存在' });
    const srcPkg = src[0];
    // 可见性：公共的谁都能克隆；自己的可以克隆；管理员可克隆任何
    if (!(await isAdminOrManager(req.user))
        && !(srcPkg.is_public === 1)
        && !(srcPkg.owner_sales_id === req.user.id)) {
      return res.status(403).json({ ok: false, error: '无权克隆此套餐' });
    }
    const { name, applicable_roles } = req.body || {};
    const roleArr = Array.isArray(applicable_roles)
      ? applicable_roles.filter(r => ROLES.includes(r))
      : parseMaybeJson(srcPkg.applicable_roles) || ROLES;
    const newName = String(name || `${srcPkg.name}副本`).trim();
    const adminMode = await isAdminOrManager(req.user);
    const newId = uuidv4();
    const code = (srcPkg.code ? srcPkg.code : 'PK') + '_' + Date.now().toString().slice(-6);

    await conn.query(
      `INSERT INTO booking_packages
        (id, code, name, description, owner_sales_id, is_public, base_template_id, applicable_roles, status, sort_order, price, discount_rate, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0, 100, NOW(), NOW())`,
      [
        newId, code, newName, srcPkg.description,
        adminMode ? null : req.user.id,
        adminMode ? 1 : 0,
        srcPkg.id,
        JSON.stringify(roleArr),
        Number(srcPkg.sort_order) || 100,
      ]
    );

    // 克隆 items（全 role：common + male + female_married + female_single）
    const [srcItems] = await conn.query(
      `SELECT item_id, role, item_name_snapshot, item_price, insurance_price_snapshot, quantity, remark, sort_order
       FROM booking_package_items WHERE package_id = ?`,
      [srcPkg.id]
    );
    if (srcItems.length > 0) {
      const batch = srcItems.map(si => [
        uuidv4(), newId, si.item_id, si.role, si.item_name_snapshot, si.item_price,
        si.insurance_price_snapshot, si.quantity, si.remark, si.sort_order,
      ]);
      await conn.query(
        `INSERT INTO booking_package_items
          (id, package_id, item_id, role, item_name_snapshot, item_price, insurance_price_snapshot, quantity, remark, sort_order)
         VALUES ?`,
        [batch]
      );
    }
    // 克隆 role_plans：按刚克隆出来的项目快照即时重算三角色价格（不含保险价）
    // 防止用户中途退出 WizardItems 未点「生成方案」时，ListPage 显示 ¥0
    const roleTotals = { male: 0, female_married: 0, female_single: 0 };
    for (const it of srcItems) {
      const amt = toNum(it.item_price) * Math.max(1, toNum(it.quantity) || 1);
      if (it.role === 'common') {
        for (const r of ROLES) roleTotals[r] += amt;
      } else if (roleTotals[it.role] !== undefined) {
        roleTotals[it.role] += amt;
      }
    }
    for (const r of ROLES) {
      const total = round2(roleTotals[r]);
      await conn.query(
        `INSERT INTO booking_package_role_plans (id, package_id, role, original_total, discount_price, discount_rate)
         VALUES (?, ?, ?, ?, ?, 100)`,
        [uuidv4(), newId, r, total, total]
      );
    }
    await conn.commit();
    const cloned = await readPackageFull(newId);
    res.json({ ok: true, data: cloned });
  } catch (e) {
    try { await conn.rollback(); } catch (_) {}
    console.error('[checkup-templates clone] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  } finally { conn.release(); }
});

// ============================================================
// PHASE 2-3: 套餐-角色-项目批量保存 + 重算三角色价格
// ============================================================
/**
 * PUT /api/booking/checkup-templates/:id/items-batch
 *   Body: {
 *     items: [ {item_id, role: 'common'|'male'|'female_married'|'female_single', quantity, remark, sort_order?, item_name_snapshot?, item_price?, insurance_price_snapshot?} ]
 *     // 注意：items 是完整替换（先删再插），UI 上就是全量保存
 *     role_plans?: { [role]: {discount_price, discount_rate?, remark?} }
 *     // role_plans.original_total 服务端会按明细重算，折扣率若只给了 discount_price 自动算
 *   }
 */
router.put('/:id/items-batch', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM booking_packages WHERE id = ? FOR UPDATE', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ ok: false, error: '套餐不存在' });
    const pkg = rows[0];
    if (!(await canUserEditPackage(req.user, pkg))) {
      return res.status(403).json({ ok: false, error: '无权编辑此套餐' });
    }
    const { role_plans: rolePlansInput = {} } = req.body || {};
    // 仅当前端显式传 items 数组时才重建项目明细；只传 role_plans（定价/生成方案）时不动 items，避免误清空
    const hasItems = req.body && Array.isArray(req.body.items);
    const items = hasItems ? req.body.items : [];

    if (hasItems) {
      // 1. 全删现有 items（按套餐）
      await conn.query('DELETE FROM booking_package_items WHERE package_id = ?', [pkg.id]);

      // 2. 批量 INSERT 新 items，对缺失快照/价格的 LEFT JOIN checkup_items 回填
      //    先把请求items做一轮基本格式化 + 非法role过滤
      const cleanItems = items.map((raw, idx) => {
        const role = (raw.role && ROLES.includes(raw.role)) ? raw.role : 'common';
        return {
          id: uuidv4(),
          item_id: raw.item_id,
          role,
          quantity: Math.max(1, toNum(raw.quantity) || 1),
          remark: raw.remark || null,
          sort_order: raw.sort_order != null ? toNum(raw.sort_order) : (idx + 1),
          item_name_snapshot: raw.item_name_snapshot || null,
          item_price: raw.item_price != null ? round2(raw.item_price) : null,
          insurance_price_snapshot: raw.insurance_price_snapshot != null ? round2(raw.insurance_price_snapshot) : null,
        };
      }).filter(it => it.item_id);

      if (cleanItems.length > 0) {
        // 取出 item_id → checkup_items 最新 default_price / name
        const itemIds = [...new Set(cleanItems.map(it => it.item_id))];
        const placeholders = itemIds.map(() => '?').join(',');
        const [ciRows] = await conn.query(
          `SELECT id, name, default_price, insurance_price FROM booking_checkup_items WHERE id IN (${placeholders})`,
          itemIds
        );
        const ciMap = new Map(ciRows.map(c => [c.id, c]));
        const batch = cleanItems.map(it => {
          const ci = ciMap.get(it.item_id) || {};
          const nameSnap = it.item_name_snapshot && String(it.item_name_snapshot).trim()
            ? it.item_name_snapshot : (ci.name || null);
          const priceSnap = it.item_price != null ? it.item_price : round2(ci.default_price || 0);
          const insSnap = it.insurance_price_snapshot != null
            ? it.insurance_price_snapshot : round2(ci.insurance_price || 0);
          // 方案C：根据项目名称自动纠正角色可见性
          const correctedRole = autoCorrectItemRole({
            role: it.role,
            item_name_snapshot: nameSnap,
            item_name: ci.name,
          });
          return [
            it.id, pkg.id, it.item_id, correctedRole,
            nameSnap, priceSnap, insSnap,
            it.quantity, it.remark, it.sort_order,
          ];
        });
        await conn.query(
          `INSERT INTO booking_package_items
            (id, package_id, item_id, role, item_name_snapshot, item_price, insurance_price_snapshot, quantity, remark, sort_order)
           VALUES ?`,
          [batch]
        );
      }
    }

    // 3. 重新计算 three roles 的 original_total
    const applicable = parseMaybeJson(pkg.applicable_roles) || ROLES;
    const allItems = await listPackageItems(pkg.id);
    const agg = aggregateRoleItems(allItems, applicable);

    // 4. 写回 booking_package_role_plans（以 original_total 为基准，price/rate 永远三角一致）
    //    规则：
    //      - 前端传 discount_price → 以 price 为准（销售谈判价），rate = price / original_total × 100 自动重算
    //      - 前端只传 discount_rate（没传 price）→ rate 为准，price = original_total × rate / 100 反推
    //      - 两者都没传 且 前端没明确传该角色 key → 读取该角色现存的 discount_price/rate（避免单角色更新把其他角色折扣清掉）
    //      - 两者都没传 且 前端明确传了该角色（可能是要清空/复位）→ price=original_total，rate=100
    // 先把现存三角色折扣一次性读出来，避免 for 内逐行查询
    const [existingPlans] = await conn.query(
      `SELECT role, discount_price, discount_rate, remark FROM booking_package_role_plans WHERE package_id = ?`,
      [pkg.id]
    );
    const existingMap = new Map();
    existingPlans.forEach(p => existingMap.set(p.role, p));
    for (const role of ROLES) {
      const originalTotal = round2(agg[role].total);
      const roleProvided = !!(rolePlansInput && rolePlansInput[role]);
      const input = roleProvided ? rolePlansInput[role] : {};
      const existing = existingMap.get(role) || {};
      let discountPrice = originalTotal;
      let discountRate = 100;
      const hasPrice = input.discount_price != null;
      const hasRate = input.discount_rate != null;
      if (hasPrice && hasRate) {
        discountPrice = round2(Math.max(0, input.discount_price));
        discountRate = originalTotal > 0 ? round2(discountPrice / originalTotal * 100) : 100;
      } else if (hasPrice) {
        discountPrice = round2(Math.max(0, input.discount_price));
        discountRate = originalTotal > 0 ? round2(discountPrice / originalTotal * 100) : 100;
      } else if (hasRate) {
        const r = toNum(input.discount_rate);
        discountRate = (r >= 1 && r <= 100) ? round2(r) : 100;
        discountPrice = round2(originalTotal * discountRate / 100);
      } else if (!roleProvided && existing.discount_price != null) {
        // 前端没传这个角色 → 复用现存折扣（三角对齐：以现存price为准，用新original_total重算rate）
        const prevPrice = round2(Math.max(0, existing.discount_price));
        discountPrice = prevPrice;
        discountRate = originalTotal > 0 ? round2(prevPrice / originalTotal * 100) : 100;
      }
      // 边界：rate 不能低于 1 或高于 100
      if (discountRate < 1) { discountRate = 1; discountPrice = Math.max(discountPrice, round2(originalTotal * 0.01)); }
      if (discountRate > 100) { discountRate = 100; discountPrice = originalTotal; }
      await conn.query(
        `INSERT INTO booking_package_role_plans (id, package_id, role, original_total, discount_price, discount_rate, remark)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           original_total = VALUES(original_total),
           discount_price = VALUES(discount_price),
           discount_rate  = VALUES(discount_rate),
           remark         = VALUES(remark),
           updated_at     = NOW()`,
        [
          uuidv4(), pkg.id, role,
          originalTotal, discountPrice, discountRate,
          roleProvided ? (input.remark || null) : (existing.remark ?? null),
        ]
      );
    }

    // 5. 套餐价格 = 男性折扣价（做兼容兜底，PC旧页面依赖 booking_packages.price）
    const [malePlan] = await conn.query(
      `SELECT discount_price FROM booking_package_role_plans WHERE package_id = ? AND role='male'`,
      [pkg.id]
    );
    if (malePlan.length === 1) {
      const price = toNum(malePlan[0].discount_price);
      await conn.query(`UPDATE booking_packages SET price = ?, updated_at = NOW() WHERE id = ?`, [price, pkg.id]);
    }
    await conn.query(
      `UPDATE booking_packages SET item_count = (SELECT COUNT(*) FROM booking_package_items WHERE package_id = ?) WHERE id = ?`,
      [pkg.id, pkg.id]
    );

    await conn.commit();
    const refreshed = await readPackageFull(pkg.id);
    res.json({ ok: true, data: refreshed });
  } catch (e) {
    try { await conn.rollback(); } catch (_) {}
    console.error('[checkup-templates items-batch] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  } finally { conn.release(); }
});

// 兼容旧路由：/config/packages/:pkgId/items-batch（旧API用）→ 这里我们保留原有 booking-board.js 的行为，不重复挂载

// ============================================================
// PHASE 2-5: 管理员公共套餐分配 / 停用启用
// ============================================================

/**
 * PUT /api/booking/checkup-templates/:id/cover-sales
 *   Body: { sales_ids: string[] }  // 管理员分配给哪些销售可见
 *   要求：当前用户是管理员
 */
router.put('/:id/cover-sales', async (req, res) => {
  try {
    if (!(await isAdminOrManager(req.user))) return res.status(403).json({ ok: false, error: '仅管理员可分配套餐' });
    const [rows] = await pool.query('SELECT * FROM booking_packages WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ ok: false, error: '套餐不存在' });
    const { sales_ids = [] } = req.body || {};
    if (!Array.isArray(sales_ids)) return res.status(400).json({ ok: false, error: 'sales_ids 必须是数组' });
    await pool.query(
      `UPDATE booking_packages SET cover_sales_ids = ?, is_public = ?, updated_at = NOW() WHERE id = ?`,
      [
        JSON.stringify(sales_ids.map(String)),
        rows[0].is_public === 1 ? 1 : 0,  // 不自动改 is_public，管理员可以既有公共又有分配
        req.params.id,
      ]
    );
    const pkg = await readPackageFull(req.params.id);
    res.json({ ok: true, data: pkg });
  } catch (e) {
    console.error('[checkup-templates cover-sales] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// PHASE 2-4: 预订端胶囊接口：按销售员返回其名下套餐
// ============================================================
/**
 * GET /api/booking/checkup-templates/sales/:salesId/capsules
 *   返回：套餐胶囊列表，含三角色折扣价，供预订下单横滑选择
 *   权限：仅需登录（预订功能本身已有权限控制，此处不重复检查）
 */
router.get('/sales/:salesId/capsules', async (req, res) => {
  try {
    const { salesId } = req.params;
    // 注意：此处不做额外权限检查
    // 预订下单功能本身已有权限控制（不是所有用户都能操作），
    // 因此任何已登录用户在预订流程中都应能查看指定销售员的套餐

    const where = `(
      owner_sales_id = ?
      OR is_public = 1
      OR JSON_CONTAINS(cover_sales_ids, ?)
    ) AND status = 1`;
    const [pkgs] = await pool.query(
      `SELECT * FROM booking_packages WHERE ${where} ORDER BY sort_order ASC, created_at DESC`,
      [salesId, JSON.stringify(salesId)]
    );

    // 兜底：如果该销售员名下没有任何套餐，返回所有公共套餐
    let finalPkgs = pkgs;
    if (pkgs.length === 0) {
      const [publicPkgs] = await pool.query(
        `SELECT * FROM booking_packages WHERE is_public = 1 AND status = 1 ORDER BY sort_order ASC, created_at DESC`
      );
      finalPkgs = publicPkgs;
    }

    const pids = finalPkgs.map(p => p.id);
    const capsules = finalPkgs.map(p => ({
      id: p.id, code: p.code, name: p.name, description: p.description,
      applicable_roles: parseMaybeJson(p.applicable_roles) || ROLES,
      base_template_id: p.base_template_id || null,
      prices: {
        male: { discount_price: 0, discount_rate: 100, original_total: 0 },
        female_married: { discount_price: 0, discount_rate: 100, original_total: 0 },
        female_single: { discount_price: 0, discount_rate: 100, original_total: 0 },
      },
    }));
    if (pids.length > 0) {
      const [plans] = await pool.query(
        `SELECT * FROM booking_package_role_plans WHERE package_id IN (${pids.map(() => '?').join(',')})`,
        pids
      );
      const map = new Map();
      for (const c of capsules) map.set(c.id, c);
      for (const pl of plans) {
        const c = map.get(pl.package_id);
        if (c && c.prices[pl.role]) {
          c.prices[pl.role] = {
            original_total: round2(pl.original_total),
            discount_price: round2(pl.discount_price),
            discount_rate: round2(pl.discount_rate),
          };
        }
      }
    }
    res.json({ ok: true, data: capsules });
  } catch (e) {
    console.error('[checkup-templates sales capsules] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// PHASE 2-6: 分享链接生成 + 免登录查询
//   注：/api/booking/checkup-share/:token 需要挂为免登录路由（外部自己调用server.use不加requireAuth）
//   因此在 booking-board.js 中挂载；该 router 内部只有 generate 需要登录，share public read
// ============================================================

/**
 * POST /api/booking/checkup-templates/:id/share
 *   Body: { expire_days?: number, default=7 (已确认默认7天) }
 *   生成 share_token = random 32bytes hex + 写入 share_expire_at
 *   返回：{ share_token, share_url, expire_at }
 *   权限：owner 或 管理员
 */
router.post('/:id/share', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM booking_packages WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ ok: false, error: '套餐不存在' });
    const pkg = rows[0];
    // 分享权限：能看 + （管理员/自己创建/公共模板/分配给我）
    if (!(await canUserViewPackage(req.user, pkg))) {
      return res.status(403).json({ ok: false, error: '无权生成分享链接' });
    }
    if (!(await isAdminOrManager(req.user)) && pkg.owner_sales_id !== req.user.id) {
      const covers = parseMaybeJson(pkg.cover_sales_ids);
      const isAssigned = Array.isArray(covers) && covers.includes(req.user.id);
      if (!pkg.is_public && !isAssigned) {
        return res.status(403).json({ ok: false, error: '无权生成分享链接' });
      }
    }
    const { expire_days } = req.body || {};
    const days = Math.min(365, Math.max(1, toNum(expire_days) || 7));  // 默认7天（用户已确认）
    const token = require('crypto').randomBytes(24).toString('hex');
    const expireAt = new Date(Date.now() + days * 86400 * 1000);
    await pool.query(
      `UPDATE booking_packages SET share_token = ?, share_expire_at = ?, updated_at = NOW() WHERE id = ?`,
      [token, expireAt, pkg.id]
    );
    // 生成分享URL：基础域名可前端拼，这里返回相对路径
    res.json({
      ok: true,
      data: {
        share_token: token,
        expire_at: expireAt.toISOString(),
        expire_days: days,
        share_path: `/h/checkup-share/${token}`,  // 前端可自行拼接 origin
      },
    });
  } catch (e) {
    console.error('[checkup-templates share] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 免登录读取分享内容（实际挂载在 server.js 的 /api/booking/checkup-share 不带auth）
/**
 * GET /api/booking/checkup-share/:token
 *   权限：免登录；404/过期返回 ok:false
 *   返回：{ package: {...}, role_plans, role_items }  不含 owner/分配等敏感字段
 */
router.get('/share-public/:token', async (req, res) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token) return res.status(400).json({ ok: false, error: 'token必填' });
    const [rows] = await pool.query(
      `SELECT * FROM booking_packages WHERE share_token = ? LIMIT 1`,
      [token]
    );
    if (rows.length === 0) return res.status(404).json({ ok: false, error: '分享链接不存在或已失效' });
    const pkg = rows[0];
    if (pkg.share_expire_at && new Date(pkg.share_expire_at).getTime() < Date.now()) {
      return res.status(410).json({ ok: false, error: '分享链接已过期' });
    }
    if (pkg.status !== 1) return res.status(410).json({ ok: false, error: '套餐已停用' });

    const full = await readPackageFull(pkg.id);
    // 客户经理信息
    let createdBy = null;
    if (pkg.owner_sales_id) {
      const [uRows] = await pool.query(
        'SELECT id, name, username, phone FROM users WHERE id = ? LIMIT 1',
        [pkg.owner_sales_id]
      );
      if (uRows.length > 0) {
        const u = uRows[0];
        createdBy = {
          id: u.id, name: u.name, username: u.username, phone: u.phone || null,
          avatar_letter: (u.name || 'U').slice(0, 1),
        };
      }
    }
    const cfg = await getBrandConfigMap();
    const company = buildCompanyFromCfg(cfg);
    // 客户经理名片
    let sales_profile = null;
    if (pkg.owner_sales_id) {
      const [spRows] = await pool.query(
        `SELECT sp.*, u.name, u.phone
         FROM checkup_sales_profiles sp
         RIGHT JOIN users u ON u.id = sp.user_id
         WHERE u.id = ? LIMIT 1`,
        [pkg.owner_sales_id]
      );
      if (spRows.length > 0) {
        const s = spRows[0];
        sales_profile = {
          user_id: s.user_id || pkg.owner_sales_id,
          name: s.name || createdBy?.name || '',
          phone: s.phone || createdBy?.phone || null,
          avatar_url: s.avatar_url || null,
          title: s.title || null,
          wechat_qrcode: s.wechat_qrcode || null,
          bio: s.bio || null,
          email: s.email || null,
        };
      }
    }
    const safe = {
      id: full.id, code: full.code, name: full.name, description: full.description,
      applicable_roles: full.applicable_roles,
      created_at: full.created_at,
      created_by: createdBy,
      company,
      sales_profile,
      role_price_capsule: ROLES.reduce((m, r) => {
        m[r] = {
          original_total: round2(full.role_plans[r].original_total),
          discount_price: round2(full.role_plans[r].discount_price),
          discount_rate: round2(full.role_plans[r].discount_rate),
        };
        return m;
      }, {}),
      role_plans: full.role_plans,
      role_items: full.role_items,  // 三类角色分别的 items 列表
    };
    res.json({ ok: true, data: safe });
  } catch (e) {
    console.error('[checkup-share public] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// PHASE 2-7: 套餐方案 PDF 导出
function findChineseFont() {
  const paths = [
    path.join(__dirname, '..', 'fonts', 'SourceHanSansSC-Regular.otf'),
    path.join(__dirname, '..', 'node_modules', '@fontpkg', 'source-han-sans-sc', 'SourceHanSansSC-Regular.otf'),
    '/usr/share/fonts/truetype/wqy/wqy-microhei.ttf',
    '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttf',
    '/usr/share/fonts/truetype/noto/NotoSansCJKsc-Regular.ttf'
  ];
  for (const p of paths) if (fs.existsSync(p) && !p.endsWith('.ttc')) return p;
  return null;
}
function findChineseBoldFont() {
  const paths = [
    path.join(__dirname, '..', 'fonts', 'SourceHanSansSC-Bold.otf'),
    path.join(__dirname, '..', 'node_modules', '@fontpkg', 'source-han-sans-sc', 'SourceHanSansSC-Bold.otf'),
    '/usr/share/fonts/truetype/wqy/wqy-microhei.ttf',
    '/usr/share/fonts/truetype/noto/NotoSansCJKsc-Bold.ttf'
  ];
  for (const p of paths) if (fs.existsSync(p) && !p.endsWith('.ttc')) return p;
  return null;
}

/** PDF 明细渲染 helper v3：分类有序 + items 有序 + 高度统一 + 分页精准。
 *  修复 feat/106 遗留的 5 个「格式乱序」根因：
 *    Bug-1 分类无序：Map.entries() 按插入顺序遍历（= DB 插入顺序），导致「影像→肿瘤→影像」反复跳
 *    Bug-2 items 无序：同一分类下也按 DB 顺序，没按 sort_order/id 稳定排序
 *    Bug-3 高度不一致：estimateCategoryHeight 用 +14 但实际渲染 +6，分页预判与实际对不上
 *    Bug-4 PAGE_BOTTOM 硬编码 800：改成 doc.page.height - margin_bottom 动态取值
 *    Bug-5 行距增量混乱：text() 多行时 doc.y 已被 pdfkit 推进，再加 +6 就跳太多 → 改用 moveDown(12)
 */
function renderPdfItemsSection(doc, items, ctx) {
  const { FONT_REG, FONT_BOLD } = ctx;

  // ===== 动态页边界 =====
  const MARGIN_TOP = doc.page.margins.top || 40;
  const MARGIN_BOTTOM = doc.page.margins.bottom || 40;
  const PAGE_BOTTOM = doc.page.height - MARGIN_BOTTOM;
  const PAGE_TOP_AFTER_BREAK = MARGIN_TOP + 20;

  // ===== 分类优先级（和前端 SUB_DISPLAY_NAME 对齐）=====
  const SUB_ORDER = [
    '一般检查', '体格检查', '五官科', '耳鼻喉科',
    '实验室检查', '检验科', '检验科-basic',
    '心脑血管与血脂', '检验科-lipid', '心电图', '超声科-vascular', '功能科-vascular',
    '影像检查', '放射科', '超声科-imaging',
    '肝胆功能', '检验科-hepatic',
    '肾功能', '检验科-renal',
    '糖尿病筛查', '检验科-glucose',
    '肿瘤标志物', '检验科-tumor',
    '妇科两癌筛查', '妇科', '病理科',
    '妇科检查',
    '眼科检查',
    '耳鼻喉/口腔',
    '内分泌代谢',
    '消化系统',
    '呼吸系统',
    '骨密度/骨科',
    '其他项目', '其他',
  ];
  const subRank = new Map(SUB_ORDER.map((s, i) => [s, i]));
  function rankOf(sub) {
    return subRank.has(sub) ? subRank.get(sub) : SUB_ORDER.length;
  }

  // ===== displaySub（推断 sub_category，与前端对齐）=====
  const SUB_DISPLAY_NAME = ctx.SUB_DISPLAY_NAME || {
    '体格检查': '基础体检',
    '五官科': '基础体检',
    '耳鼻喉科': '基础体检',
    '检验科-basic': '基础体检',
    '检验科-lipid': '心脑血管与血脂',
    '心电图': '心脑血管与血脂',
    '超声科-vascular': '心脑血管与血脂',
    '功能科-vascular': '心脑血管与血脂',
    '放射科': '影像检查',
    '超声科-imaging': '影像检查',
    '检验科-hepatic': '肝胆功能',
    '检验科-renal': '肾功能',
    '检验科-glucose': '糖尿病筛查',
    '检验科-tumor': '肿瘤标志物',
    '病理科': '妇科两癌筛查',
    '妇科': '妇科两癌筛查',
  };
  function displaySub(it) {
    if (it.sub_category) return it.sub_category;
    if (SUB_DISPLAY_NAME[it.category]) return SUB_DISPLAY_NAME[it.category];
    const nm = (it.item_name_snapshot || it.item_id || it.name || '').toString();
    if (/TCT|液基|HPV|乳头瘤|妇科|两癌/i.test(nm)) return '妇科两癌筛查';
    if (/PSA|AFP|CEA|CA\d|肿瘤|癌标/i.test(nm)) return '肿瘤标志物';
    if (/CT|DR|彩超|钼靶|放射|影像|超声/i.test(nm)) return '影像检查';
    if (/心电|血脂|胆固醇|同型|动脉硬化|动脉|LDL|HDL|甘油|肌酸|载脂|胱抑/i.test(nm)) return '心脑血管与血脂';
    if (/胆红素|ALT|AST|谷丙|谷草|蛋白|GGT|ALP|肝胆/i.test(nm)) return '肝胆功能';
    if (/尿酸|尿素|肌酐|肾|Cys|肾小球|β2|微球/i.test(nm)) return '肾功能';
    if (/血糖|糖化|胰岛素|GLU|HbA1c/i.test(nm)) return '糖尿病筛查';
    return it.category || '其他';
  }

  // ===== 1) 按 sub_category 分组 =====
  const bySub = new Map();
  for (const it of items) {
    const sub = displaySub(it);
    if (!bySub.has(sub)) bySub.set(sub, []);
    bySub.get(sub).push(it);
  }

  // ===== 2) 分组内 items 稳定排序：sort_order ASC, id ASC =====
  for (const [, arr] of bySub) {
    arr.sort((a, b) => {
      const soA = Number(a.sort_order || 0);
      const soB = Number(b.sort_order || 0);
      if (soA !== soB) return soA - soB;
      const idA = Number(a.id || a.item_id || 0);
      const idB = Number(b.id || b.item_id || 0);
      return idA - idB;
    });
  }

  // ===== 3) 分类排序：按 SUB_ORDER 优先级 =====
  const sortedSubs = Array.from(bySub.keys()).sort((a, b) => rankOf(a) - rankOf(b));

  // ===== 4) 统一高度常量 =====
  // 主项行：fontSize 10pt → line-height ≈ 14pt，取 moveDown(12) 留呼吸空间
  // 子项行：fontSize 8.5pt → line-height ≈ 12pt，取 moveDown(9)
  const MAIN_LINE_H = 12;
  const SUB_LINE_H = 9;
  const CAT_TITLE_H = 22;   // 分类标题行（fontSize 11 粗体 + 4pt 分隔线 + 4pt 间距）
  const CAT_BOTTOM_GAP = 10; // 分类尾部留白
  function estimateCategoryHeight(catItems) {
    let h = CAT_TITLE_H + CAT_BOTTOM_GAP;
    for (const it of catItems) {
      h += MAIN_LINE_H;
      const subs = Array.isArray(it.sub_item_names) ? it.sub_item_names : null;
      if (subs && subs.length > 0) h += 2 + subs.length * SUB_LINE_H;
    }
    return h;
  }

  // ===== 5) 渲染循环（y 增量统一用 moveDown 常量，不再硬编码）=====
  for (const sub of sortedSubs) {
    const catItems = bySub.get(sub);
    const est = estimateCategoryHeight(catItems);

    // 分页预判：剩余空间不够 → 换页
    if (doc.y + est > PAGE_BOTTOM - 30) {
      doc.addPage();
      doc.y = PAGE_TOP_AFTER_BREAK;
    }

    // === 分类标题 ===
    doc.fontSize(11).font(FONT_BOLD).fillColor('#111827');
    doc.text(`【${sub}】`, 40, doc.y, { continued: false });
    // 分隔横线
    const lineY = doc.y + 4;
    doc.moveTo(40, lineY).lineTo(560, lineY).strokeColor('#eee8dd').lineWidth(0.6).stroke();
    doc.lineWidth(1);
    doc.y = lineY + 4;

    for (const it of catItems) {
      const name = it.item_name_snapshot || it.item_id || it.name || '-';
      const subs = Array.isArray(it.sub_item_names) ? it.sub_item_names : null;

      // 主项分页保护：剩余 < 主项高度就换页
      const mainNeeds = MAIN_LINE_H + (subs && subs.length ? 2 + subs.length * SUB_LINE_H : 0);
      if (doc.y + mainNeeds > PAGE_BOTTOM - 10) {
        doc.addPage();
        doc.y = PAGE_TOP_AFTER_BREAK;
      }

      // === 主项 ===
      doc.fontSize(10).font(FONT_REG).fillColor('#111827');
      doc.text(name, 44, doc.y, { width: 506, continued: false });
      doc.moveDown(MAIN_LINE_H / 12); // 12pt ≈ 1 line（pdfkit moveDown 单位是 "lines"，按 fontSize=10 计算）

      // === 子项 ===
      if (subs && subs.length > 0) {
        // 重置子项字号 + 颜色（避免残留）
        doc.fontSize(8.5).font(FONT_REG).fillColor('#6b7280');
        for (const s of subs) {
          if (doc.y > PAGE_BOTTOM - 12) {
            doc.addPage();
            doc.y = PAGE_TOP_AFTER_BREAK;
            doc.fontSize(8.5).font(FONT_REG).fillColor('#6b7280');
          }
          doc.text(`· ${s}`, 62, doc.y, { width: 490, continued: false });
          doc.moveDown(SUB_LINE_H / 12); // 9pt / 12pt per line
        }
        doc.moveDown(2 / 12);
      }
    }
    doc.moveDown(CAT_BOTTOM_GAP / 12);
  }
}

router.get('/:id/pdf', async (req, res) => {
  try {
    const { role = 'all' } = req.query;
    const pkg = await readPackageFull(req.params.id);
    if (!pkg) return res.status(404).json({ ok: false, error: '套餐不存在' });
    if (!(await canUserViewPackage(req.user, pkg))) {
      // 也接受token方式：/pdf?share_token=xxx
      const t = req.query.share_token;
      if (!t || pkg.share_token !== t) {
        return res.status(403).json({ ok: false, error: '无权查看' });
      }
      if (pkg.share_expire_at && new Date(pkg.share_expire_at).getTime() < Date.now()) {
        return res.status(410).json({ ok: false, error: '链接已过期' });
      }
    }

    const roles = role === 'all'
      ? (pkg.applicable_roles && pkg.applicable_roles.length ? pkg.applicable_roles : ROLES)
      : ROLES.includes(role) ? [role] : ROLES;

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chineseFont = findChineseFont();
    const chineseBoldFont = findChineseBoldFont();
    if (chineseFont) {
      doc.registerFont('Chinese-Regular', chineseFont);
      doc.registerFont('Chinese-Bold', chineseBoldFont || chineseFont);
    }
    const FONT_REG = chineseFont ? 'Chinese-Regular' : 'Helvetica';
    const FONT_BOLD = chineseFont ? 'Chinese-Bold' : 'Helvetica-Bold';

    // 文件名：直接 inline download
    const filename = `体检套餐方案_${pkg.code}_${new Date().toISOString().slice(0,10)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
    doc.pipe(res);

    // --- 页眉 ---
    doc.fontSize(18).font(FONT_BOLD).text('体检套餐方案', { align: 'center' });
    doc.moveDown(0.2);
    doc.fontSize(11).font(FONT_REG)
       .text(`套餐名称：${pkg.name || ''}`)
       .text(`套餐编码：${pkg.code || ''}`);
    if (pkg.description) doc.text(`说明：${pkg.description}`);
    doc.moveDown(0.3);

    for (const r of roles) {
      const meta = ROLE_META[r] || { name: r, emoji: '' };
      const plan = pkg.role_plans[r] || { original_total: 0, discount_price: 0, discount_rate: 100 };
      const items = (pkg.role_items[r] && pkg.role_items[r].items) || [];

      // 角色标题 + 价格
      doc.fontSize(14).font(FONT_BOLD).fillColor('#1f4e3d').text(`${meta.emoji} ${meta.name}方案`);
      doc.fontSize(11).font(FONT_REG).fillColor('#000')
         .text(`原价：¥${round2(plan.original_total).toFixed(2)}    折后价：¥${round2(plan.discount_price).toFixed(2)}    折扣率：${round2(plan.discount_rate).toFixed(2)}%`);
      if (plan.remark) doc.text(`备注：${plan.remark}`);
      doc.moveDown(0.2);

      // 按 category 分组 + 项目明细渲染
      renderPdfItemsSection(doc, items, { FONT_REG, FONT_BOLD });
      // 该角色合计
      doc.moveDown(0.3);
      doc.fontSize(11).font(FONT_BOLD).fillColor('#b91c1c')
         .text(`${meta.name} 合计：¥${round2(plan.discount_price).toFixed(2)}（原价¥${round2(plan.original_total).toFixed(2)}，折扣${round2(plan.discount_rate).toFixed(2)}%）`,
               { align: 'right' });
      doc.fillColor('#000').font(FONT_REG);
      doc.moveDown(0.6);
      if (doc.y > 720) doc.addPage();
    }

    // 页脚
    doc.fontSize(8).font(FONT_REG).fillColor('#666')
       .text(`华医OA管理平台  ·  生成时间：${new Date().toLocaleString('zh-CN')}`, 40, 820, { align: 'center', width: 520 });

    doc.end();
  } catch (e) {
    console.error('[checkup-templates pdf] error:', e);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: e.message });
    }
  }
});

// ============================================================
// PHASE 2-8: 品牌配置 & 客户经理名片（工具函数：必须在 sharePublicRouter 之前定义）
// ============================================================

async function getBrandConfigMap() {
  try {
    const [rows] = await pool.query('SELECT config_key, config_value FROM checkup_brand_config');
    const map = {};
    for (const r of rows) map[r.config_key] = r.config_value;
    return map;
  } catch (e) {
    console.warn('[brand-config] 读取失败，使用兜底值：', e.message);
    return {};
  }
}
function buildCompanyFromCfg(cfg) {
  return {
    name: cfg.company_name || process.env.COMPANY_NAME || '上海画一健康管理有限公司',
    logo: cfg.company_logo || null,
    slogan: cfg.company_slogan || '专注高端体检 · 为您定制专属方案',
    address: cfg.company_address || process.env.COMPANY_ADDRESS || null,
    phone: cfg.company_phone || process.env.COMPANY_PHONE || null,
    service_hours: cfg.service_hours || null,
    qualification: cfg.qualification || null,
    wechat_qrcode: cfg.wechat_qrcode || null,
    primary_color: cfg.primary_color || '#1dbf9a',
  };
}

// 免登录分享公开读取（独立 router，在 server.js 单独挂在 /api/booking/checkup-share 不加 requireAuth）
// ⚠️ 路由顺序非常重要：固定路径必须放在参数路由 `/:token` 之前，否则会被吞掉！
const sharePublicRouter = express.Router();

// 1）固定路径 — 品牌配置（必须放第一，否则会被 /:token 当成 token=brand-config）
sharePublicRouter.get('/brand-config', async (req, res) => {
  try {
    const cfg = await getBrandConfigMap();
    res.json({ ok: true, data: buildCompanyFromCfg(cfg) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 2）固定路径 + 子参数 — PDF 下载
sharePublicRouter.get('/:token/pdf', async (req, res) => {
  try {
    const { role = 'all' } = req.query;
    const token = String(req.params.token || '').trim();
    if (!token) return res.status(400).json({ ok: false, error: 'token必填' });
    const [rows] = await pool.query(`SELECT * FROM booking_packages WHERE share_token = ? LIMIT 1`, [token]);
    if (rows.length === 0) return res.status(404).json({ ok: false, error: '分享链接不存在或已失效' });
    const pkg = rows[0];
    if (pkg.share_expire_at && new Date(pkg.share_expire_at).getTime() < Date.now()) {
      return res.status(410).json({ ok: false, error: '分享链接已过期' });
    }
    if (pkg.status !== 1) return res.status(410).json({ ok: false, error: '套餐已停用' });

    const full = await readPackageFull(pkg.id);
    const roles = role === 'all'
      ? (full.applicable_roles && full.applicable_roles.length ? full.applicable_roles : ROLES)
      : ROLES.includes(role) ? [role] : ROLES;

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chineseFont = findChineseFont();
    const chineseBoldFont = findChineseBoldFont();
    if (chineseFont) {
      doc.registerFont('Chinese-Regular', chineseFont);
      doc.registerFont('Chinese-Bold', chineseBoldFont || chineseFont);
    }
    const FONT_REG = chineseFont ? 'Chinese-Regular' : 'Helvetica';
    const FONT_BOLD = chineseFont ? 'Chinese-Bold' : 'Helvetica-Bold';

    const filename = `体检套餐方案_${full.code}_${new Date().toISOString().slice(0,10)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
    doc.pipe(res);

    doc.fontSize(18).font(FONT_BOLD).text('体检套餐方案', { align: 'center' });
    doc.moveDown(0.2);
    doc.fontSize(11).font(FONT_REG)
       .text(`套餐名称：${full.name || ''}`)
       .text(`套餐编码：${full.code || ''}`);
    if (full.description) doc.text(`说明：${full.description}`);
    doc.moveDown(0.3);

    for (const r of roles) {
      const meta = ROLE_META[r] || { name: r, emoji: '' };
      const plan = full.role_plans[r] || { original_total: 0, discount_price: 0, discount_rate: 100 };
      const items = (full.role_items[r] && full.role_items[r].items) || [];
      doc.fontSize(14).font(FONT_BOLD).fillColor(company_primary || '#1dbf9a').text(`${meta.emoji} ${meta.name}方案`);
      doc.fontSize(11).font(FONT_REG).fillColor('#000')
         .text(`原价：¥${round2(plan.original_total).toFixed(2)}    折后价：¥${round2(plan.discount_price).toFixed(2)}    折扣率：${round2(plan.discount_rate).toFixed(2)}%`);
      if (plan.remark) doc.text(`备注：${plan.remark}`);
      doc.moveDown(0.2);
      // feat/106：直接复用升级后的 renderPdfItemsSection（自动去价格列 + 两级分类 + 智能分页 + 分隔线）
      renderPdfItemsSection(doc, items, { FONT_REG, FONT_BOLD });
      doc.moveDown(0.3);
      doc.fontSize(11).font(FONT_BOLD).fillColor('#b91c1c')
         .text(`${meta.name} 合计：¥${round2(plan.discount_price).toFixed(2)}（原价¥${round2(plan.original_total).toFixed(2)}，折扣${round2(plan.discount_rate).toFixed(2)}%）`, { align: 'right' });
      doc.fillColor('#000').font(FONT_REG);
      doc.moveDown(0.6);
      if (doc.y > 720) doc.addPage();
    }
    doc.fontSize(8).font(FONT_REG).fillColor('#666')
       .text(`华医OA管理平台  ·  生成时间：${new Date().toLocaleString('zh-CN')}`, 40, 820, { align: 'center', width: 520 });
    doc.end();
  } catch (e) {
    console.error('[checkup-share public pdf] error:', e);
    if (!res.headersSent) res.status(500).json({ ok: false, error: e.message });
  }
});

// 3）参数路由放在最后 — 分享详情
sharePublicRouter.get('/:token', async (req, res) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token) return res.status(400).json({ ok: false, error: 'token必填' });
    const [rows] = await pool.query(
      `SELECT * FROM booking_packages WHERE share_token = ? LIMIT 1`,
      [token]
    );
    if (rows.length === 0) return res.status(404).json({ ok: false, error: '分享链接不存在或已失效' });
    const pkg = rows[0];
    if (pkg.share_expire_at && new Date(pkg.share_expire_at).getTime() < Date.now()) {
      return res.status(410).json({ ok: false, error: '分享链接已过期' });
    }
    if (pkg.status !== 1) return res.status(410).json({ ok: false, error: '套餐已停用' });

    const full = await readPackageFull(pkg.id);
    // 客户经理信息
    let createdBy = null;
    if (pkg.owner_sales_id) {
      const [uRows] = await pool.query(
        'SELECT id, name, username, phone FROM users WHERE id = ? LIMIT 1',
        [pkg.owner_sales_id]
      );
      if (uRows.length > 0) {
        const u = uRows[0];
        createdBy = {
          id: u.id, name: u.name, username: u.username, phone: u.phone || null,
          avatar_letter: (u.name || 'U').slice(0, 1),
        };
      }
    }
    const cfg = await getBrandConfigMap();
    const company = buildCompanyFromCfg(cfg);
    // 客户经理名片
    let sales_profile = null;
    if (pkg.owner_sales_id) {
      const [spRows] = await pool.query(
        `SELECT sp.*, u.name, u.phone
         FROM checkup_sales_profiles sp
         RIGHT JOIN users u ON u.id = sp.user_id
         WHERE u.id = ? LIMIT 1`,
        [pkg.owner_sales_id]
      );
      if (spRows.length > 0) {
        const s = spRows[0];
        sales_profile = {
          user_id: s.user_id || pkg.owner_sales_id,
          name: s.name || createdBy?.name || '',
          phone: s.phone || createdBy?.phone || null,
          avatar_url: s.avatar_url || null,
          title: s.title || null,
          wechat_qrcode: s.wechat_qrcode || null,
          bio: s.bio || null,
          email: s.email || null,
        };
      }
    }
    const safe = {
      id: full.id, code: full.code, name: full.name, description: full.description,
      applicable_roles: full.applicable_roles,
      created_at: full.created_at,
      created_by: createdBy,
      company,
      sales_profile,
      expire_at: pkg.share_expire_at || null,
      role_price_capsule: ROLES.reduce((m, r) => {
        m[r] = {
          original_total: round2(full.role_plans[r].original_total),
          discount_price: round2(full.role_plans[r].discount_price),
          discount_rate: round2(full.role_plans[r].discount_rate),
        };
        return m;
      }, {}),
      role_plans: full.role_plans,
      role_items: full.role_items,  // 三类角色分别的 items 列表
    };
    res.json({ ok: true, data: safe });
  } catch (e) {
    console.error('[checkup-share public] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
module.exports.sharePublicRouter = sharePublicRouter;
