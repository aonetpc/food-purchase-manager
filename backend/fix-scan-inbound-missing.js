#!/usr/bin/env node
/**
 * 修复扫码领料缺失的入库记录
 *
 * 问题：审核通过的领料单只执行了出库（从总仓扣库存），
 *       没有执行入库（向部门仓库增加库存）。
 *
 * 修复逻辑：
 *   1. 查找所有已审核/自动出库的领料单（status IN ('approved', 'auto')）
 *   2. 对每条领料单，检查是否已存在对应的入库流水
 *   3. 若缺失，则补录入库流水 + 更新入库仓库库存
 *   4. 即买即用物资（instant_use=1）跳过入库，仅记录消耗流水
 *
 * 幂等：通过检查 reason 字段中的领料单号避免重复补录
 */

const pool = require('./db');
const { v4: uuidv4 } = require('uuid');

function toNum(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (typeof val === 'object') {
    const str = val.String || val.string || val.val || JSON.stringify(val);
    return parseFloat(str) || 0;
  }
  return parseFloat(val) || 0;
}

async function fixScanInboundMissing() {
  console.log('\n🔧 修复扫码领料缺失的入库记录\n');
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

    // 1. 查找所有已审核/自动出库的领料单
    console.log('🔍 步骤1：查找已审核领料单...');
    const [requisitions] = await conn.query(`
      SELECT id, requisition_no, temp_user_id, user_name,
             warehouse_id, warehouse_name,
             outbound_warehouse_id, outbound_warehouse_name,
             items, status, created_at
      FROM scan_requisitions
      WHERE status IN ('approved', 'auto')
      ORDER BY created_at ASC
    `);
    console.log(`   找到 ${requisitions.length} 条已审核/自动领料单\n`);

    if (requisitions.length === 0) {
      console.log('✅ 无需修复');
      return;
    }

    let fixedCount = 0;
    let skippedCount = 0;

    for (const req of requisitions) {
      const items = typeof req.items === 'string' ? JSON.parse(req.items) : req.items;
      if (!Array.isArray(items) || items.length === 0) {
        console.log(`   ⏭️  ${req.requisition_no}: 无物资明细，跳过`);
        skippedCount++;
        continue;
      }

      // 入库仓库 = warehouse_id（领料单上的入库仓库）
      const inboundWhId = req.warehouse_id;
      const inboundWhName = req.warehouse_name;
      if (!inboundWhId) {
        console.log(`   ⏭️  ${req.requisition_no}: 无入库仓库，跳过`);
        skippedCount++;
        continue;
      }

      // 检查是否已存在入库流水（通过 reason 字段匹配领料单号）
      const inboundReason = `扫码领料入库 ${req.requisition_no}`;
      const [existing] = await conn.query(
        `SELECT COUNT(*) as cnt FROM stock_movements
         WHERE warehouse_id = ? AND reason LIKE ? AND movement_type = 'inbound'`,
        [inboundWhId, `%${req.requisition_no}%`]
      );

      if (existing[0].cnt > 0) {
        console.log(`   ⏭️  ${req.requisition_no}: 已有入库记录，跳过`);
        skippedCount++;
        continue;
      }

      // 需要补录
      console.log(`   🔧 ${req.requisition_no}: 补录入库到「${inboundWhName}」...`);

      // 查询即买即用属性
      const itemIds = items.map(i => i.item_id).filter(Boolean);
      let instantUseMap = {};
      if (itemIds.length > 0) {
        const placeholders = itemIds.map(() => '?').join(',');
        const [iuRows] = await conn.query(
          `SELECT id, instant_use FROM warehouse_items WHERE id IN (${placeholders})`,
          itemIds
        );
        for (const r of iuRows) {
          instantUseMap[r.id] = Number(r.instant_use) === 1;
        }
      }

      await conn.beginTransaction();

      try {
        for (const item of items) {
          const qty = toNum(item.quantity);
          if (qty <= 0) continue;

          const unitPrice = toNum(item.unit_price);
          const totalAmount = unitPrice ? qty * unitPrice : null;

          // 即买即用物资：不入库，仅记录消耗流水
          if (instantUseMap[item.item_id]) {
            await conn.query(
              `INSERT INTO stock_movements (id, warehouse_id, item_id, item_name, movement_type, quantity, unit, unit_price, total_amount, reason, related_type, operator_id, operator_name, department_id, department_name)
               VALUES (?, ?, ?, ?, 'expense', ?, ?, ?, ?, ?, 'scan', ?, ?, NULL, ?)`,
              [
                uuidv4(), inboundWhId, item.item_id, item.item_name,
                -Math.abs(qty), item.unit, unitPrice || null, totalAmount,
                `即买即用消耗 ${req.requisition_no} - ${req.user_name}`,
                req.temp_user_id || null, req.user_name || null,
                inboundWhName || null
              ]
            );
            console.log(`      - ${item.item_name}: ${qty} ${item.unit} (即买即用，仅记录消耗)`);
            continue;
          }

          // 写入库流水
          await conn.query(
            `INSERT INTO stock_movements (id, warehouse_id, item_id, item_name, movement_type, quantity, unit, unit_price, total_amount, reason, related_type, operator_id, operator_name, department_id, department_name)
             VALUES (?, ?, ?, ?, 'inbound', ?, ?, ?, ?, ?, 'scan', ?, ?, NULL, ?)`,
            [
              uuidv4(), inboundWhId, item.item_id, item.item_name,
              qty, item.unit, unitPrice || null, totalAmount,
              `${inboundReason} - ${req.user_name}`,
              req.temp_user_id || null, req.user_name || null,
              inboundWhName || null
            ]
          );

          // 更新库存（不存在则插入）
          const [inv] = await conn.query(
            'SELECT id FROM inventory WHERE warehouse_id = ? AND item_id = ?',
            [inboundWhId, item.item_id]
          );
          if (inv.length > 0) {
            await conn.query(
              'UPDATE inventory SET quantity = quantity + ?, unit = ? WHERE warehouse_id = ? AND item_id = ?',
              [qty, item.unit, inboundWhId, item.item_id]
            );
          } else {
            await conn.query(
              'INSERT INTO inventory (id, warehouse_id, item_id, quantity, unit) VALUES (?, ?, ?, ?, ?)',
              [uuidv4(), inboundWhId, item.item_id, qty, item.unit]
            );
          }

          console.log(`      + ${item.item_name}: ${qty} ${item.unit}`);
        }

        await conn.commit();
        console.log(`   ✅ ${req.requisition_no}: 补录完成`);
        fixedCount++;
      } catch (err) {
        await conn.rollback();
        console.error(`   ❌ ${req.requisition_no}: 补录失败 - ${err.message}`);
      }
    }

    console.log('\n' + '═'.repeat(60));
    console.log(`\n📊 修复结果：`);
    console.log(`   补录: ${fixedCount} 条`);
    console.log(`   跳过: ${skippedCount} 条`);
    console.log(`   总计: ${requisitions.length} 条\n`);

  } catch (err) {
    console.error('修复脚本执行失败:', err);
  } finally {
    if (conn) conn.release();
  }
}

fixScanInboundMissing();
