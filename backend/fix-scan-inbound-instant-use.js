#!/usr/bin/env node
/**
 * 修复即买即用物资被错误入库到部门仓库的历史数据
 *
 * 问题：即买即用物资（instant_use=1）扫码领用后，
 *       被错误地入库到部门仓库（movement_type='inbound'），
 *       导致部门仓库存在不应有的库存。
 *
 * 修复逻辑：
 *   1. 查找所有 reason LIKE '扫码领料入库%' 的 inbound 流水
 *   2. 检查对应物资是否为即买即用（instant_use=1）
 *   3. 若是，则：
 *      a. 从部门仓库库存中扣减对应数量
 *      b. 将流水类型从 inbound 改为 expense，数量取负，更新 reason
 *
 * 幂等：已为 expense 类型的流水会被跳过
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

async function fixScanInboundInstantUse() {
  console.log('\n🔧 修复即买即用物资错误入库记录\n');
  console.log('═'.repeat(60));

  let conn;
  try {
    conn = await pool.getConnection();

    // 0. 先确保 movement_type ENUM 包含 'expense'
    try {
      await conn.query(
        `ALTER TABLE stock_movements
         MODIFY COLUMN movement_type ENUM('inbound','outbound','adjust','expense') NOT NULL COMMENT '类型：入库/出库/盘点调整/即买即用消耗'`
      );
      console.log('✅ 已确保 movement_type 包含 expense\n');
    } catch (e) {
      // 已包含则忽略
    }

    // 1. 查找所有扫码领料入库流水中，物资为即买即用的记录
    console.log('🔍 步骤1：查找即买即用物资的错误入库记录...');
    const [movements] = await conn.query(`
      SELECT sm.id, sm.warehouse_id, sm.item_id, sm.item_name,
             sm.quantity, sm.unit, sm.unit_price, sm.total_amount,
             sm.reason, sm.operator_id, sm.operator_name,
             sm.department_id, sm.department_name,
             wi.instant_use
      FROM stock_movements sm
      JOIN warehouse_items wi ON sm.item_id = wi.id
      WHERE sm.movement_type = 'inbound'
        AND sm.reason LIKE '扫码领料入库%'
        AND wi.instant_use = 1
      ORDER BY sm.created_at ASC
    `);
    console.log(`   找到 ${movements.length} 条错误入库记录\n`);

    if (movements.length === 0) {
      console.log('✅ 无需修复');
      return;
    }

    let fixedCount = 0;
    let failedCount = 0;

    for (const mv of movements) {
      const qty = Math.abs(toNum(mv.quantity));
      if (qty <= 0) {
        console.log(`   ⏭️  ${mv.item_name}: 数量为0，跳过`);
        continue;
      }

      console.log(`   🔧 ${mv.item_name} (${mv.reason}): 扣减 ${qty} ${mv.unit}`);

      await conn.beginTransaction();

      try {
        // 1. 从部门仓库扣减库存
        const [inv] = await conn.query(
          'SELECT id, quantity FROM inventory WHERE warehouse_id = ? AND item_id = ?',
          [mv.warehouse_id, mv.item_id]
        );

        if (inv.length > 0) {
          const currentQty = toNum(inv[0].quantity);
          const newQty = Math.max(0, currentQty - qty);
          await conn.query(
            'UPDATE inventory SET quantity = ? WHERE warehouse_id = ? AND item_id = ?',
            [newQty, mv.warehouse_id, mv.item_id]
          );
          console.log(`      库存: ${currentQty} → ${newQty}`);
        } else {
          console.log(`      ⚠️  库存记录不存在，跳过扣减`);
        }

        // 2. 将入库流水改为消耗流水
        const newReason = mv.reason.replace('扫码领料入库', '即买即用消耗');
        await conn.query(
          `UPDATE stock_movements
           SET movement_type = 'expense', quantity = ?, reason = ?
           WHERE id = ?`,
          [-Math.abs(qty), newReason, mv.id]
        );
        console.log(`      流水: inbound → expense, reason: ${newReason}`);

        await conn.commit();
        console.log(`   ✅ 修复完成`);
        fixedCount++;
      } catch (err) {
        await conn.rollback();
        console.error(`   ❌ 修复失败 - ${err.message}`);
        failedCount++;
      }
    }

    console.log('\n' + '═'.repeat(60));
    console.log(`\n📊 修复结果：`);
    console.log(`   修复: ${fixedCount} 条`);
    console.log(`   失败: ${failedCount} 条`);
    console.log(`   总计: ${movements.length} 条\n`);

  } catch (err) {
    console.error('修复脚本执行失败:', err);
  } finally {
    if (conn) conn.release();
  }
}

fixScanInboundInstantUse().then(() => process.exit(0)).catch(() => process.exit(0));
