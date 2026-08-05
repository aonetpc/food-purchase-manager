#!/usr/bin/env node
/**
 * 去重 v2：清理重复的即买即用消耗流水，并修复多扣的库存
 * 
 * 修复原因：
 *   多次部署导致 fix-scan-inbound-missing 和 fix-scan-inbound-instant-use
 *   脚本反复执行，产生了重复的 expense 流水和多扣的库存。
 * 
 * 修复逻辑：
 *   1. 查找所有 reason LIKE '即买即用消耗%' 的 expense 记录
 *   2. 按 (requisition_no, item_id, warehouse_id) 分组
 *   3. 每组保留最早的一条，删除其余
 *   4. 若存在多扣（>1条），则向库存补回多扣的数量
 * 
 * 使用方法：
 *   cd /workspace/backend && node fix-dedup-expense-v2.js
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
  const match = reason && reason.match(/RQ\d{8}-\d{3}/);
  return match ? match[0] : null;
}

function formatDateTime(val) {
  if (!val) return '-';
  if (val instanceof Date) return val.toISOString().slice(0, 16);
  if (typeof val === 'string') return val.slice(0, 16);
  if (typeof val === 'object') {
    const s = val.String || val.string || val.val || JSON.stringify(val);
    return s.slice(0, 16);
  }
  return String(val).slice(0, 16);
}

async function dedupExpense() {
  console.log('\n🔧 去重 v2：清理重复的即买即用消耗流水\n');
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
    let duplicateGroups = 0;
    for (const rec of allExpenses) {
      const reqNo = extractRequisitionNo(rec.reason);
      if (!reqNo) {
        console.log(`   ⚠️  记录 ${rec.id} 无法提取领料单号: ${rec.reason}`);
        continue;
      }
      const key = `${reqNo}|${rec.item_id}|${rec.warehouse_id}`;
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(rec);
    }

    // 3. 统计重复组数
    for (const [key, records] of Object.entries(groups)) {
      if (records.length > 1) duplicateGroups++;
    }

    console.log(`📊 分组统计：`);
    console.log(`   总分组数: ${Object.keys(groups).length}`);
    console.log(`   重复分组数: ${duplicateGroups}\n`);

    if (duplicateGroups === 0) {
      console.log('✅ 无重复记录，数据正常');
      return;
    }

    // 4. 处理每组
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
      console.log(`   📂 ${reqNo} / ${keep.item_name} / 仓库ID:${whId}`);
      console.log(`      保留最早记录: ${formatDateTime(keep.created_at)} (${correctQty}${keep.unit || ''})`);
      console.log(`      删除 ${duplicates.length} 条重复记录`);
      if (extraQty > 0) {
        console.log(`      ⚠️  多扣库存: ${extraQty}${keep.unit || ''}，将补回`);
      }

      await conn.beginTransaction();
      try {
        // 删除重复记录
        const ids = duplicates.map(d => d.id);
        const placeholders = ids.map(() => '?').join(',');
        const [delResult] = await conn.query(
          `DELETE FROM stock_movements WHERE id IN (${placeholders})`,
          ids
        );
        deletedCount += delResult.affectedRows;

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
          } else {
            console.log(`      ⚠️  未找到库存记录 (warehouse_id=${whId}, item_id=${itemId})`);
          }
        }

        await conn.commit();
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

    // 5. 验证结果
    console.log('🔍 验证：检查是否还有重复...');
    const [verifyExpenses] = await conn.query(`
      SELECT id, warehouse_id, item_id, item_name, quantity, reason, created_at
      FROM stock_movements
      WHERE movement_type = 'expense'
        AND reason LIKE '即买即用消耗%'
      ORDER BY reason, created_at
    `);
    
    const verifyGroups = {};
    for (const rec of verifyExpenses) {
      const reqNo = extractRequisitionNo(rec.reason);
      if (!reqNo) continue;
      const key = `${reqNo}|${rec.item_id}|${rec.warehouse_id}`;
      if (!verifyGroups[key]) verifyGroups[key] = [];
      verifyGroups[key].push(rec);
    }
    
    let remainingDuplicates = 0;
    for (const [key, recs] of Object.entries(verifyGroups)) {
      if (recs.length > 1) {
        remainingDuplicates++;
        const [reqNo] = key.split('|');
        console.log(`   ⚠️  仍有重复: ${reqNo} (${recs.length}条)`);
      }
    }
    
    if (remainingDuplicates === 0) {
      console.log('   ✅ 验证通过：无重复记录');
    } else {
      console.log(`   ⚠️  仍有 ${remainingDuplicates} 组重复，请手动检查`);
    }

  } catch (err) {
    console.error('去重脚本执行失败:', err);
  } finally {
    if (conn) conn.release();
  }
}

dedupExpense().then(() => {
  console.log('\n✅ 脚本执行完成');
  process.exit(0);
}).catch((err) => {
  console.error('❌ 脚本异常:', err);
  process.exit(1);
});
