#!/usr/bin/env node
/**
 * 去重：删除重复的即买即用消耗流水，并修复多扣的库存
 *
 * 问题：多次部署导致 fix-scan-inbound-missing 和 fix-scan-inbound-instant-use
 *       脚本反复执行，产生了重复的 expense 流水和多扣的库存。
 *
 * 逻辑：
 *   1. 查找所有 reason LIKE '即买即用消耗%' 的 expense 记录
 *   2. 按 (requisition_no, item_id, warehouse_id) 分组
 *   3. 每组保留最早的一条，删除其余
 *   4. 若存在多扣（>1条），则向库存补回多扣的数量
 */

const pool = require('./db');

function toNum(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (typeof val === 'object') {
    const str = val.String || val.string || val.val || JSON.stringify(val);
    return parseFloat(str) || 0;
  }
  return parseFloat(val) || 0;
}

function extractRequisitionNo(reason) {
  // 从 "即买即用消耗 RQ20260805-001 - 姚蓓" 提取 RQ20260805-001
  const match = reason && reason.match(/RQ\d{8}-\d{3}/);
  return match ? match[0] : null;
}

async function dedupExpense() {
  console.log('\n🔧 去重：清理重复的即买即用消耗流水\n');
  console.log('═'.repeat(60));

  let conn;
  try {
    conn = await pool.getConnection();

    // 1. 查找所有即买即用消耗记录
    console.log('🔍 步骤1：查找所有即买即用消耗流水...');
    const [allExpenses] = await conn.query(`
      SELECT id, warehouse_id, item_id, item_name, quantity, unit, reason, created_at
      FROM stock_movements
      WHERE movement_type = 'expense'
        AND reason LIKE '即买即用消耗%'
      ORDER BY created_at ASC
    `);
    console.log(`   共找到 ${allExpenses.length} 条即买即用消耗记录\n`);

    if (allExpenses.length === 0) {
      console.log('✅ 无需清理');
      return;
    }

    // 2. 按 (requisition_no, item_id, warehouse_id) 分组
    const groups = {};
    for (const rec of allExpenses) {
      const reqNo = extractRequisitionNo(rec.reason);
      if (!reqNo) continue;
      const key = `${reqNo}|${rec.item_id}|${rec.warehouse_id}`;
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(rec);
    }

    // 3. 处理每组
    let deletedCount = 0;
    let fixedInventoryCount = 0;

    for (const [key, records] of Object.entries(groups)) {
      if (records.length <= 1) continue;

      const keep = records[0];
      const duplicates = records.slice(1);
      const totalQty = records.reduce((s, r) => s + Math.abs(toNum(r.quantity)), 0);
      const correctQty = Math.abs(toNum(keep.quantity));
      const extraQty = totalQty - correctQty;

      const [reqNo, itemId, whId] = key.split('|');
      console.log(`   📂 ${reqNo} / ${keep.item_name} / 仓库`);
      console.log(`      保留 ${keep.created_at.toISOString().slice(0, 16)} (${correctQty}${keep.unit || ''})`);
      console.log(`      删除 ${duplicates.length} 条重复记录`);
      if (extraQty > 0) {
        console.log(`      ⚠️  多扣库存：${extraQty}${keep.unit || ''}，将补回`);
      }

      await conn.beginTransaction();
      try {
        // 删除重复记录
        const ids = duplicates.map(d => d.id);
        const placeholders = ids.map(() => '?').join(',');
        await conn.query(
          `DELETE FROM stock_movements WHERE id IN (${placeholders})`,
          ids
        );

        // 补回多扣的库存
        if (extraQty > 0) {
          const [inv] = await conn.query(
            'SELECT id, quantity FROM inventory WHERE warehouse_id = ? AND item_id = ?',
            [whId, itemId]
          );
          if (inv.length > 0) {
            const currentQty = toNum(inv[0].quantity);
            await conn.query(
              'UPDATE inventory SET quantity = quantity + ? WHERE warehouse_id = ? AND item_id = ?',
              [extraQty, whId, itemId]
            );
            console.log(`      ✅ 库存补回: ${currentQty} → ${currentQty + extraQty}`);
            fixedInventoryCount++;
          }
        }

        await conn.commit();
        deletedCount += duplicates.length;
      } catch (err) {
        await conn.rollback();
        console.error(`      ❌ 处理失败: ${err.message}`);
      }
    }

    console.log('\n' + '═'.repeat(60));
    console.log(`\n📊 去重结果：`);
    console.log(`   删除重复流水: ${deletedCount} 条`);
    console.log(`   补回多扣库存: ${fixedInventoryCount} 条`);
    console.log(`   处理分组: ${Object.keys(groups).length} 组\n`);

  } catch (err) {
    console.error('去重脚本执行失败:', err);
  } finally {
    if (conn) conn.release();
  }
}

dedupExpense().then(() => process.exit(0)).catch(() => process.exit(0));
