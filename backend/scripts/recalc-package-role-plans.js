#!/usr/bin/env node
/**
 * recalc-package-role-plans.js
 * ==============================
 * 校正所有销售套餐（booking_packages）的角色方案价格：
 *   booking_package_role_plans.original_total
 *   booking_package_role_plans.discount_rate
 *
 * 背景：
 *   修复前有两个 bug，会导致 original_total 比正确值虚高：
 *     1) listPackageItems SQL 漏查 ci.applicable_roles
 *     2) 兜底关键词未识别 "(男)/（男）/(女)/（女）" 后缀
 *   结果：肿瘤11项(男) 和 肿瘤10项(女) 等带后缀的组合项目会被计入全部角色的明细里，
 *        male 角色包中也包含了 (女) 的肿瘤组合，original_total 被多加 ~¥1130。
 *
 * 本脚本：
 *   - 复用 routes/checkup-templates.js 中已修复的 listPackageItems + aggregateRoleItems
 *   - 遍历所有套餐，对每个启用的角色重新计算真实 original_total
 *   - 保留 discount_price（客户实际支付的谈判价），重新计算 discount_rate
 *         discount_rate_new = discount_price / new_original_total * 100
 *   - 只对有差异（偏差 > 0.5元）的行执行 UPDATE
 *   - 默认 dry-run，传 --apply 才真正写库
 *
 * 用法：
 *   node backend/scripts/recalc-package-role-plans.js            # 预览
 *   node backend/scripts/recalc-package-role-plans.js --apply    # 真正执行
 */
require('dotenv').config();
const pool = require('../db');

// -------- 复制 checkup-templates.js 中的聚合工具函数（保持一致） --------
const ROLES = ['male', 'female_married', 'female_single'];
const MALE_ONLY_KEYS = ['前列腺','阴囊','精液','男科','睾丸','勃起','包皮','精索','附睾','PSA','男性激素'];
const FM_ONLY_KEYS = ['阴超','阴道B','阴道镜','宫腔镜','妇科内诊','双合诊','白带','宫颈刮片','TCT','液基','HPV','宫颈','阴道'];
const FEMALE_KEYS = ['乳腺','卵巢','子宫','盆腔','附件','性激素','雌激素','孕酮','妇科','妇产科','产前','唐筛','孕检','HCG','人绒毛膜','月经','痛经'];
const SINGLE_FORBID_KEYS = ['经阴道'];
function nameHitKeys(name, keys) {
  const n = (name || '').toLowerCase();
  return keys.some(k => n.includes(k.toLowerCase()));
}
function genderTagMode(name) {
  const n = name || '';
  const hasM = /[（(]男[)）]/.test(n) || n.includes('男士') || n.includes('男性专用') || n.includes('男专用') || (n.includes('男性') && !n.includes('女性'));
  const hasF = /[（(]女[)）]/.test(n) || n.includes('女士') || n.includes('女性专用') || n.includes('女专用') || (n.includes('女性') && !n.includes('男性'));
  if (hasM && !hasF) return 'M';
  if (hasF && !hasM) return 'F';
  return 'N';
}
function parseJsonMaybe(v) {
  if (v == null) return null;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch (_) { return null; } }
  return v;
}
function isItemVisibleForRole(it, role) {
  const name = it.item_name_snapshot || it.item_name || '';
  const roles = parseJsonMaybe(it.applicable_roles);
  if (roles && Array.isArray(roles) && roles.length > 0) return roles.includes(role);
  const gMode = genderTagMode(name);
  if (gMode === 'M') return role === 'male';
  if (gMode === 'F') return role === 'female_married' || role === 'female_single';
  if (role === 'male') return !nameHitKeys(name, FM_ONLY_KEYS) && !nameHitKeys(name, FEMALE_KEYS);
  if (role === 'female_married') return !nameHitKeys(name, MALE_ONLY_KEYS);
  if (role === 'female_single') return !nameHitKeys(name, MALE_ONLY_KEYS) && !nameHitKeys(name, FM_ONLY_KEYS) && !nameHitKeys(name, SINGLE_FORBID_KEYS);
  return true;
}
function toNum(n) { const v = parseFloat(n); return Number.isFinite(v) ? v : 0; }
function round2(n) { return Math.round(toNum(n) * 100) / 100; }

function aggregateRoleItems(items, applicableRoles = ROLES) {
  const enabled = Array.isArray(applicableRoles) && applicableRoles.length ? applicableRoles : ROLES;
  const commons = items.filter(i => !i.role || i.role === 'common');
  const result = {};
  for (const role of ROLES) {
    if (!enabled.includes(role)) { result[role] = { total: 0, item_count: 0, items: [] }; continue; }
    const roleItems = items.filter(i => i.role === role);
    const map = new Map();
    for (const c of commons) {
      if (!isItemVisibleForRole(c, role)) continue;
      map.set(c.item_id + '|common', { ...c, role });
    }
    for (const r of roleItems) {
      if (!isItemVisibleForRole(r, role)) continue;
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
    result[role] = { total: round2(total), item_count: merged.length, items: merged };
  }
  return result;
}

async function listPackageItems(packageId) {
  const [rows] = await pool.query(
    `SELECT pi.id, pi.package_id, pi.item_id, pi.role, pi.quantity, pi.remark, pi.sort_order,
            CASE WHEN (pi.item_name_snapshot IS NULL OR pi.item_name_snapshot = '') THEN ci.name ELSE pi.item_name_snapshot END AS item_name_snapshot,
            CASE WHEN (pi.item_price IS NULL OR pi.item_price = 0) THEN ci.default_price ELSE pi.item_price END AS item_price,
            CASE WHEN (pi.insurance_price_snapshot IS NULL OR pi.insurance_price_snapshot = 0) THEN ci.insurance_price ELSE pi.insurance_price_snapshot END AS insurance_price_snapshot,
            ci.category, ci.item_type, ci.applicable_roles
     FROM booking_package_items AS pi
     LEFT JOIN booking_checkup_items AS ci ON ci.id = pi.item_id
     WHERE pi.package_id = ?
     ORDER BY pi.role ASC, pi.sort_order ASC, pi.id ASC`,
    [packageId]
  );
  return rows;
}

// ---------- 主流程 ----------
const APPLY = process.argv.includes('--apply');

async function main() {
  console.log('='.repeat(72));
  console.log(APPLY ? '运行模式：--apply 真实执行 UPDATE' : '运行模式：dry-run（仅预览，不传--apply）');
  console.log('='.repeat(72));

  const [packages] = await pool.query(
    `SELECT p.id, p.name, p.template_name,
            JSON_UNQUOTE(JSON_EXTRACT(p.applicable_roles, '$')) AS applicable_roles
       FROM booking_packages AS p
      WHERE p.status != 0
      ORDER BY p.id ASC`
  );
  console.log(`\n共发现 ${packages.length} 个套餐\n`);

  let totalFixes = 0;
  for (const pkg of packages) {
    let roles;
    try { roles = JSON.parse(pkg.applicable_roles); } catch(_) { roles = null; }
    if (!Array.isArray(roles) || !roles.length) roles = ROLES;

    const items = await listPackageItems(pkg.id);
    if (!items.length) continue;

    const agg = aggregateRoleItems(items, roles);

    // 读现有 plans
    const [plans] = await pool.query(
      `SELECT id, role, original_total, discount_price, discount_rate
         FROM booking_package_role_plans
        WHERE package_id = ?`,
      [pkg.id]
    );
    const planMap = new Map(plans.map(p => [p.role, p]));

    const pkgFixes = [];
    for (const role of roles) {
      const calcTotal = agg[role]?.total || 0;
      const stored = planMap.get(role);
      if (!stored) continue;
      const storedOrig = round2(stored.original_total);
      const storedDisc = round2(stored.discount_price);
      const diff = Math.abs(calcTotal - storedOrig);
      if (diff > 0.5) {
        // 重算折扣率（discount_price 保持不变）
        let newRate = 100;
        if (calcTotal > 0 && storedDisc > 0) {
          newRate = round2(storedDisc / calcTotal * 100);
        }
        pkgFixes.push({
          role,
          planId: stored.id,
          before_orig: storedOrig,
          after_orig: calcTotal,
          delta: round2(calcTotal - storedOrig),
          before_rate: round2(stored.discount_rate),
          after_rate: newRate,
          discount_price: storedDisc,
          item_count: agg[role]?.item_count || 0,
        });
      }
    }

    if (pkgFixes.length === 0) continue;
    console.log(`【套餐 #${pkg.id}】${pkg.template_name || pkg.name}  需校正 ${pkgFixes.length} 个角色方案`);
    for (const f of pkgFixes) {
      const sign = f.delta >= 0 ? '+' : '';
      console.log(`  · role=${f.role}  ` +
                  `原价 ${f.before_orig} → ${f.after_orig} (${sign}${f.delta})  ` +
                  `折扣率 ${f.before_rate}% → ${f.after_rate}%  ` +
                  `折扣价保持 ¥${f.discount_price}  ` +
                  `明细项数=${f.item_count}`);
      totalFixes++;
      if (APPLY) {
        await pool.query(
          `UPDATE booking_package_role_plans
              SET original_total = ?, discount_rate = ?
            WHERE id = ?`,
          [f.after_orig, f.after_rate, f.planId]
        );
      }
    }
  }

  console.log(`\n完成。共识别 ${totalFixes} 个角色方案需要校正。`);
  if (!APPLY) console.log('（预览模式，未写库；如需执行请加 --apply 参数）');
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
