#!/usr/bin/env node
/**
 * fix-checkup-items-prices.js — 快速修复体检项目的价格/类型/分类
 *
 * 适用场景：数据已导入但价格为0、类型全是"普通"(item)、分类不对等。
 * 原理：用项目名称(name)匹配标准数据，逐条 UPDATE 修正。
 *
 * 用法：
 *   cd /opt/food-purchase/backend && node scripts/fix-checkup-items-prices.js
 */

const pool = require('../db');
const { ITEMS } = require('./reimport-checkup-items');

// 构造 name → { item_type, category, default_price, insurance_price } 映射
const NAME_MAP = {};
for (const [name, item_type, category, default_price, insurance_price] of ITEMS) {
  NAME_MAP[name] = { item_type, category, default_price, insurance_price };
}

async function main() {
  console.log('🔧 体检项目价格/类型修复脚本');
  console.log(`   标准数据 ${ITEMS.length} 项\n`);

  // 1. 确保列存在（幂等）
  const conn = await pool.getConnection();
  async function ensureColumn(table, col, def) {
    const [rows] = await conn.query(
      `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, col]
    );
    if (rows[0].c === 0) {
      await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${def}`);
      console.log(`  ✅ 补列 ${table}.${col}`);
    }
  }
  await ensureColumn('booking_checkup_items', 'insurance_price',
    "DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '医保价格' AFTER default_price");
  await ensureColumn('booking_checkup_items', 'item_type',
    "ENUM('item','combo') NOT NULL DEFAULT 'item' COMMENT '项目类型' AFTER name");
  conn.release();

  // 2. 查询当前所有项目
  const [rows] = await pool.query(
    'SELECT id, code, name, item_type, category, default_price, insurance_price FROM booking_checkup_items ORDER BY code'
  );
  console.log(`===== 修复前：数据库共 ${rows.length} 条 =====`);

  let matched = 0, notMatched = 0, alreadyCorrect = 0, fixed = 0;
  const notMatchedNames = [];

  for (const row of rows) {
    const std = NAME_MAP[row.name];
    if (!std) {
      notMatched++;
      notMatchedNames.push(`${row.code} ${row.name} (¥${row.default_price}/${row.item_type})`);
      continue;
    }
    matched++;

    // 检查是否需要修复
    const needFix =
      String(row.item_type) !== String(std.item_type) ||
      Number(row.default_price) !== Number(std.default_price) ||
      Number(row.insurance_price) !== Number(std.insurance_price) ||
      String(row.category) !== String(std.category);

    if (!needFix) {
      alreadyCorrect++;
      continue;
    }

    // 执行修复
    await pool.query(
      `UPDATE booking_checkup_items
       SET item_type = ?, category = ?, default_price = ?, insurance_price = ?
       WHERE id = ?`,
      [std.item_type, std.category, std.default_price, std.insurance_price, row.id]
    );
    fixed++;
    if (fixed <= 10) {
      console.log(`  🔧 ${row.code} ${row.name}: ${row.item_type}/¥${row.default_price}/医¥${row.insurance_price} → ${std.item_type}/¥${std.default_price}/医¥${std.insurance_price}`);
    } else if (fixed === 11) {
      console.log(`  ... 后续修复省略`);
    }
  }

  console.log(`\n===== 修复结果 =====`);
  console.log(`  总计: ${rows.length} 条`);
  console.log(`  匹配标准数据: ${matched} 条`);
  console.log(`  已正确(无需修): ${alreadyCorrect} 条`);
  console.log(`  已修复: ${fixed} 条`);
  console.log(`  未匹配(标准库无此名称): ${notMatched} 条`);
  if (notMatched > 0 && notMatchedNames.length <= 30) {
    console.log(`  未匹配列表:`);
    for (const n of notMatchedNames) console.log(`    - ${n}`);
  }

  // 3. 验证：打印分类统计 + 价格示例
  console.log(`\n===== 修复后分类统计 =====`);
  const [stats] = await pool.query(
    `SELECT category, item_type, COUNT(*) AS c, SUM(default_price) AS total_price
     FROM booking_checkup_items GROUP BY category, item_type
     ORDER BY FIELD(category,'化验','专科','功能检查','影像'), item_type`
  );
  for (const s of stats) {
    console.log(`  [${s.category}] ${s.item_type}: ${s.c}项, 总价¥${s.total_price}`);
  }

  console.log(`\n===== 价格非0验证（前10条） =====`);
  const [sample] = await pool.query(
    'SELECT code, name, item_type, category, default_price, insurance_price FROM booking_checkup_items ORDER BY code LIMIT 10'
  );
  for (const r of sample) {
    console.log(`  ${r.code} | ${r.name} | ${r.category}/${r.item_type} | ¥${r.default_price} / 医保¥${r.insurance_price}`);
  }

  console.log('\n🎉 修复完成');
  process.exit(0);
}

main().catch((e) => {
  console.error('\n❌ 致命错误:', e.message);
  console.error(e.stack);
  process.exit(1);
});
