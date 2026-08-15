#!/usr/bin/env node
/*
 * ==========================================================================
 * ⚠️⚠️⚠️ 生产数据保护：危险脚本 — 运行前必须先读 3 层锁说明！⚠️⚠️⚠️
 * ==========================================================================
 * 此脚本会根据 ITEMS（reimport-checkup-items.js 中的旧标准数据），按
 * name 匹配后批量 UPDATE booking_checkup_items 的：
 *    item_type / category / default_price / insurance_price
 *
 * ❌ 生产环境（DB 已从 PDF 导入最终版）严禁直接运行！
 *    原因：
 *      1. ITEMS 中 category 是旧版"化验/专科/其他"，不是 v2"7大类"
 *         → 会把你刚用「🔖 批量修正分类/类型」修正的分类盖回去
 *      2. ITEMS 中价格是旧种子价格，你在前台手动改过的价格会被覆盖
 *
 * 3 层运行保护锁（默认只做 dry-run 预览，不真执行 UPDATE）：
 *   1) 必须带参数 --yes-i-want-to-overwrite-prices 才能真正执行 UPDATE
 *   2) 不传时默认只读预览（dry-run），打印"将会修复的条目"，不碰数据库
 *   3) 默认只改价格（default_price / insurance_price），分类和类型默认不改；
 *      若真想连 category/item_type 也修复，必须显式加 --fix-category
 * ==========================================================================
 */
/**
 * fix-checkup-items-prices.js — 体检项目价格/类型修复脚本（默认 dry-run）
 *
 * 【当前生产已弃用】→ 生产请使用前端「🔖 批量修正分类/类型」或价格对拍工具
 *   「PDF价格对拍 → 勾选差异行 → 🔄 应用PDF定价 → 全部同步」
 *
 * 历史用途：初始化阶段数据已导入但价格为0、类型全item、分类不对时
 * 用脚本快速用 ITEMS 里的标准数据逐条 UPDATE 修正。
 *
 * 用法：
 *   # 🔒 默认 dry-run（只预览，不改数据）
 *   cd /opt/food-purchase/backend && node scripts/fix-checkup-items-prices.js
 *
 *   # 仅修复价格（真正执行 UPDATE 价格，不动分类/类型）
 *   node scripts/fix-checkup-items-prices.js --yes-i-want-to-overwrite-prices
 *
 *   # 修复价格 + 分类 + 类型（分类会被盖回旧版旧种子分类！！三思）
 *   node scripts/fix-checkup-items-prices.js --yes-i-want-to-overwrite-prices --fix-category
 */

const pool = require('../db');
const { ITEMS } = require('./reimport-checkup-items');

// 构造 name → { item_type, category, default_price, insurance_price } 映射
const NAME_MAP = {};
for (const [name, item_type, category, default_price, insurance_price] of ITEMS) {
  NAME_MAP[name] = { item_type, category, default_price, insurance_price };
}

async function main() {
  // ===== 运行保护锁解析 =====
  const allowWrite = process.argv.includes('--yes-i-want-to-overwrite-prices');
  const fixCategory = process.argv.includes('--fix-category');   // 改分类/类型的独立开关
  const readline = require('readline');

  console.log('🔧 体检项目价格/类型修复脚本（' + (allowWrite ? '可写模式' : '🔒 DRY-RUN 只读预览') + '）');
  console.log(`   标准数据 ${ITEMS.length} 项 / --fix-category 分类修复独立开关=${fixCategory ? 'ON(有风险!)' : 'OFF(默认)'}\n`);
  if (!allowWrite) {
    console.log([
      '   🔒 目前是只读预览(dry-run)模式，不会真的 UPDATE 数据库。',
      '      若确认执行修复请重跑加参数：',
      '        node scripts/fix-checkup-items-prices.js --yes-i-want-to-overwrite-prices',
      '',
    ].join('\n'));
  }
  if (fixCategory && allowWrite) {
    console.log([
      '   ⚠️ --fix-category 已开启：UPDATE 会同时覆盖 item_type / category！',
      '      （旧种子分类是"化验/专科/其他"旧版，生产当前分类为 v2 7大类，',
      '       开了会把你前端「🔖 批量修正分类/类型」修好的分类盖回去，请三思！）',
      '',
    ].join('\n'));
    // 再做一次交互式 confirm：输入 YES 才放行
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await new Promise(resolve => {
      rl.question('   👉 确定要覆盖分类/类型？会破坏 v2 7 大类修复结果！\n      输入 YES 继续：', (ans) => {
        if (String(ans).trim() !== 'YES') {
          console.log('\n   用户取消，退出。');
          rl.close();
          process.exit(5);
        }
        rl.close();
        resolve();
      });
    });
  }

  // 1. 确保列存在（幂等）
  const conn = await pool.getConnection();
  async function ensureColumn(table, col, def) {
    const [rows] = await conn.query(
      `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, col]
    );
    if (rows[0].c === 0) {
      if (allowWrite) {
        await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${def}`);
        console.log(`  ✅ 补列 ${table}.${col}`);
      } else {
        console.log(`  ℹ️  缺少列 ${table}.${col}（dry-run 模式跳过补列）`);
      }
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

  let matched = 0, notMatched = 0, alreadyCorrect = 0, fixed = 0, willFix = 0;
  const notMatchedNames = [];
  const previewSample = [];

  for (const row of rows) {
    const std = NAME_MAP[row.name];
    if (!std) {
      notMatched++;
      notMatchedNames.push(`${row.code} ${row.name} (¥${row.default_price}/${row.item_type})`);
      continue;
    }
    matched++;

    // ===== 保护：fixCategory=OFF 时，needFix 只比较价格，不关心分类/类型变化 =====
    const willChangeType = String(row.item_type) !== String(std.item_type);
    const willChangeCat  = String(row.category)  !== String(std.category);
    const willChangeP    = Number(row.default_price)    !== Number(std.default_price);
    const willChangeIns  = Number(row.insurance_price)  !== Number(std.insurance_price);

    const needFix =
      (willChangeP || willChangeIns) ||  // 价格永远纳入判断
      (fixCategory && (willChangeType || willChangeCat));  // 分类/类型必须 fixCategory=ON 才纳入

    if (!needFix) {
      alreadyCorrect++;
      continue;
    }

    // 真正要 SET 的字段（只写需要变化的，fixCategory=OFF 不覆盖分类/类型）
    const setFields = [];
    const setValues = [];
    if (willChangeP) { setFields.push('default_price = ?'); setValues.push(std.default_price); }
    if (willChangeIns) { setFields.push('insurance_price = ?'); setValues.push(std.insurance_price); }
    if (fixCategory && willChangeType) { setFields.push('item_type = ?'); setValues.push(std.item_type); }
    if (fixCategory && willChangeCat)  { setFields.push('category = ?');  setValues.push(std.category);  }
    setValues.push(row.id);

    // 预览/执行
    if (!allowWrite) {
      willFix++;
      if (willFix <= 10) {
        previewSample.push(
          `  [${row.code}] ${row.name}：  ` +
          `旧=(${row.item_type} / ${row.category} / 定价¥${row.default_price} / 医保¥${row.insurance_price})  ` +
          `新=(${fixCategory ? std.item_type : '不动'} / ${fixCategory ? std.category : '不动'} / 定价¥${std.default_price} / 医保¥${std.insurance_price})`
        );
      }
    } else {
      await pool.query(
        `UPDATE booking_checkup_items SET ${setFields.join(', ')} WHERE id = ?`,
        setValues
      );
      fixed++;
      if (fixed <= 10) {
        console.log(`  🔧 ${row.code} ${row.name}: ${row.item_type}/${row.category}/¥${row.default_price}/医¥${row.insurance_price} → ${fixCategory ? std.item_type : '不动'}/${fixCategory ? std.category : '不动'}/¥${std.default_price}/医¥${std.insurance_price}`);
      } else if (fixed === 11) {
        console.log(`  ... 后续修复省略`);
      }
    }
  }

  console.log(`\n===== 修复结果 =====`);
  console.log(`  总计: ${rows.length} 条`);
  console.log(`  匹配标准数据: ${matched} 条`);
  console.log(`  已正确(无需修): ${alreadyCorrect} 条`);
  if (allowWrite) {
    console.log(`  已修复: ${fixed} 条`);
  } else {
    console.log(`  🔒 DRY-RUN 预览：共 ${willFix} 条需要修复（未真正执行 UPDATE）`);
    if (willFix > 0 && previewSample.length) {
      console.log(`  前 10 条预览：`);
      for (const s of previewSample) console.log(s);
      console.log(`  确认无误？真正执行请加参数：--yes-i-want-to-overwrite-prices`);
      if (!fixCategory) console.log(`  若需要连分类/类型一起覆盖（⚠️ 会盖回旧分类三思），再加 --fix-category`);
    }
  }
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
