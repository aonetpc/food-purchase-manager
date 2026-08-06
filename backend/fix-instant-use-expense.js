#!/usr/bin/env node
/**
 * 修复仓库采购即采即用出库记录 movement_type 错误
 *
 * 问题：仓库采购收货时，即采即用物资的自动出库记录
 *       movement_type 被错误写为 'outbound'（应为 'expense'），
 *       导致管理报表（只统计 expense）无法包含这些消耗数据。
 *
 * 修复逻辑：
 *   1. 查找 stock_movements 中 related_type='purchase'
 *      且 reason LIKE '即采即用自动出库%'
 *      且 movement_type='outbound' 的记录
 *   2. 将 movement_type 从 'outbound' 改为 'expense'
 *
 * 幂等：已为 expense 类型的记录会被跳过
 */

const pool = require('./db');

async function main() {
  console.log('====== 修复仓库采购即采即用出库 movement_type ======\n');

  // 1. 统计需要修复的记录
  const [badRows] = await pool.query(`
    SELECT id, item_name, movement_type, reason, related_type,
           quantity, total_amount, created_at
    FROM stock_movements
    WHERE related_type = 'purchase'
      AND movement_type = 'outbound'
      AND reason LIKE '即采即用自动出库%'
    ORDER BY created_at ASC
  `);

  if (badRows.length === 0) {
    console.log('✅ 没有需要修复的记录，所有即采即用出库记录已经是 expense 类型');
    process.exit(0);
  }

  console.log(`找到 ${badRows.length} 条需要修复的记录：\n`);
  for (const r of badRows) {
    console.log(`  [${r.created_at}] ${r.item_name} | type: ${r.movement_type} → expense | qty: ${r.quantity} | amount: ${r.total_amount} | reason: ${r.reason}`);
  }
  console.log('');

  // 2. 批量更新
  const [result] = await pool.query(`
    UPDATE stock_movements
    SET movement_type = 'expense'
    WHERE related_type = 'purchase'
      AND movement_type = 'outbound'
      AND reason LIKE '即采即用自动出库%'
  `);

  console.log(`✅ 已修复 ${result.affectedRows} 条记录：movement_type outbound → expense`);

  // 3. 验证
  const [check] = await pool.query(`
    SELECT movement_type, COUNT(*) as cnt
    FROM stock_movements
    WHERE related_type = 'purchase'
      AND reason LIKE '即采即用自动出库%'
    GROUP BY movement_type
  `);
  console.log('\n验证结果：');
  for (const c of check) {
    console.log(`  movement_type='${c.movement_type}': ${c.cnt} 条`);
  }

  console.log('\n====== 修复完成 ======');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ 修复失败:', err);
  process.exit(1);
});
