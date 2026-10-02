/**
 * 恢复误生成的月结账单
 * ============================================
 * 背景：用户在「供应商对账中心」点击了「生成月结账单」，把尚未发起付款申请的
 *       月结采购单全部归入了 pending 状态的月结账单，导致「待月结采购单」列表变空。
 *
 * 恢复逻辑：
 *   1. 找出所有 status='pending' 且 purchase_type='monthly' 的月结账单
 *   2. 将这些账单关联的 warehouse_purchases.monthly_statement_id 重置为 NULL
 *   3. 删除这些 pending 月结账单记录
 *   4. 采购单会重新出现在「待月结采购单」列表（monthly_pending 字段在生成账单时未被修改，仍为 1）
 *
 * 安全措施：
 *   - 默认 dry-run，只打印影响范围，不修改数据
 *   - 加 --apply 才真正执行，且包裹在事务中
 *   - 只处理 pending 状态的账单，confirmed/approved/paid 状态的账单不动
 *   - 执行后自动校验：确认采购单 monthly_statement_id 已清空、pending 账单已删除
 *
 * 使用方式：
 *   node recover-monthly-statements.js          # 预览（dry-run）
 *   node recover-monthly-statements.js --apply  # 实际执行恢复
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const pool = require('./db');

function parsePurchaseIds(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch (e) { return []; }
  }
  if (typeof raw === 'object' && raw !== null) {
    // mysql2 有时返回 { type: 'Buffer', data: [...] } 或字符串化对象
    try { return JSON.parse(String(raw)); } catch (e) { return []; }
  }
  return [];
}

async function main() {
  const apply = process.argv.includes('--apply');
  const conn = await pool.getConnection();

  try {
    console.log('\n========== 月结账单恢复脚本 ==========');
    console.log(`模式: ${apply ? '✅ 实际执行（--apply）' : '🔍 预览模式（dry-run）'}`);
    console.log('');

    // 1. 查询所有 pending 的月结账单
    const [pendingStmts] = await conn.query(
      `SELECT id, supplier_id, supplier_name, statement_month, total_amount,
              purchase_ids, created_at
       FROM monthly_statements
       WHERE status = 'pending' AND purchase_type = 'monthly'
       ORDER BY created_at DESC`
    );

    console.log(`找到 ${pendingStmts.length} 张待对账（pending）的月结账单：\n`);

    if (pendingStmts.length === 0) {
      console.log('没有需要恢复的 pending 月结账单，脚本结束。');
      return;
    }

    let totalPurchases = 0;
    const allPurchaseIds = [];
    let alreadySubmittedCount = 0;
    let notSubmittedCount = 0;

    for (const stmt of pendingStmts) {
      const ids = parsePurchaseIds(stmt.purchase_ids);
      totalPurchases += ids.length;
      ids.forEach(id => allPurchaseIds.push(id));

      console.log(`  账单ID: ${stmt.id.substring(0, 8)}...`);
      console.log(`    供应商: ${stmt.supplier_name || stmt.supplier_id}`);
      console.log(`    月份: ${stmt.statement_month}`);
      console.log(`    金额: ¥${Number(stmt.total_amount).toFixed(2)}`);
      console.log(`    关联采购单数: ${ids.length}`);
      console.log(`    创建时间: ${stmt.created_at}`);

      // 查询该账单下每张采购单的付款状态
      if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',');
        const [purchases] = await conn.query(
          `SELECT id, purchase_no, supplier_name, total_amount, actual_amount,
                  monthly_pending, monthly_payment_sp_no, monthly_paid_at,
                  monthly_statement_id
           FROM warehouse_purchases
           WHERE id IN (${placeholders})`,
          ids
        );

        let stmtSubmitted = 0;
        let stmtNotSubmitted = 0;
        for (const p of purchases) {
          const hasPayment = !!p.monthly_payment_sp_no;
          const statusText = hasPayment
            ? `✅ 已发起付款 (sp_no=${p.monthly_payment_sp_no}, monthly_pending=${p.monthly_pending}, paid=${p.monthly_paid_at ? '是' : '否'})`
            : `⏳ 未发起付款 (monthly_pending=${p.monthly_pending})`;
          console.log(`      - ${p.purchase_no || p.id.substring(0, 12)}  ¥${Number(p.actual_amount || p.total_amount).toFixed(2)}  ${statusText}`);
          if (hasPayment) { stmtSubmitted++; alreadySubmittedCount++; }
          else { stmtNotSubmitted++; notSubmittedCount++; }
        }
        console.log(`    小计: ${stmtSubmitted} 张已发起付款, ${stmtNotSubmitted} 张未发起付款`);
      }
      console.log('');
    }

    console.log(`─────────────────────────────────────`);
    console.log(`合计: ${pendingStmts.length} 张账单, ${totalPurchases} 张采购单`);
    console.log(`  其中: ${alreadySubmittedCount} 张已发起付款申请（恢复后仍留在「月结付款审批中」）`);
    console.log(`        ${notSubmittedCount} 张未发起付款（恢复后回到「待月结采购单」列表）`);
    console.log('');

    if (alreadySubmittedCount > 0) {
      console.log('⚠️  注意：部分采购单已发起付款申请。恢复操作只会清空 monthly_statement_id，');
      console.log('   不会影响 monthly_payment_sp_no，已发起付款的采购单仍在「月结付款审批中」列表。');
      console.log('');
    }

    // 2. 预览模式到此结束
    if (!apply) {
      console.log('🔍 预览模式：未修改任何数据。');
      console.log('   确认无误后，执行: node recover-monthly-statements.js --apply');
      return;
    }

    // 3. 实际执行恢复（事务）
    console.log('🚀 开始执行恢复...');

    await conn.beginTransaction();

    try {
      // 3.1 重置所有关联采购单的 monthly_statement_id
      if (allPurchaseIds.length > 0) {
        const placeholders = allPurchaseIds.map(() => '?').join(',');
        const [resetResult] = await conn.query(
          `UPDATE warehouse_purchases
           SET monthly_statement_id = NULL
           WHERE id IN (${placeholders})
             AND monthly_statement_id IS NOT NULL`,
          allPurchaseIds
        );
        console.log(`✅ 已重置 ${resetResult.affectedRows} 张采购单的 monthly_statement_id 为 NULL`);
      }

      // 3.2 删除所有 pending 月结账单
      const stmtIds = pendingStmts.map(s => s.id);
      const stmtPlaceholders = stmtIds.map(() => '?').join(',');
      const [deleteResult] = await conn.query(
        `DELETE FROM monthly_statements
         WHERE id IN (${stmtPlaceholders})
           AND status = 'pending'
           AND purchase_type = 'monthly'`,
        stmtIds
      );
      console.log(`✅ 已删除 ${deleteResult.affectedRows} 张 pending 月结账单`);

      await conn.commit();
      console.log('✅ 事务已提交，恢复完成！');

      // 4. 校验
      console.log('\n────────── 恢复后校验 ──────────');

      // 4.1 确认 pending 月结账单已清空
      const [remainingPending] = await conn.query(
        `SELECT COUNT(*) AS cnt FROM monthly_statements
         WHERE status = 'pending' AND purchase_type = 'monthly'`
      );
      console.log(`剩余 pending 月结账单数: ${remainingPending[0].cnt}（应为 0）`);

      // 4.2 确认采购单已回到待月结状态
      if (allPurchaseIds.length > 0) {
        const placeholders = allPurchaseIds.map(() => '?').join(',');
        const [backToPending] = await conn.query(
          `SELECT COUNT(*) AS cnt,
                  SUM(CASE WHEN monthly_statement_id IS NULL THEN 1 ELSE 0 END) AS unlinked,
                  SUM(CASE WHEN monthly_pending = 1 THEN 1 ELSE 0 END) AS monthly_pending_1,
                  SUM(CASE WHEN monthly_payment_sp_no IS NOT NULL THEN 1 ELSE 0 END) AS has_payment_sp,
                  SUM(CASE WHEN monthly_payment_sp_no IS NOT NULL AND monthly_paid_at IS NOT NULL THEN 1 ELSE 0 END) AS already_paid
           FROM warehouse_purchases
           WHERE id IN (${placeholders})`,
          allPurchaseIds
        );
        const r = backToPending[0];
        console.log(`受影响采购单总数: ${r.cnt}`);
        console.log(`  monthly_statement_id 已清空: ${r.unlinked}/${r.cnt}`);
        console.log(`  monthly_pending = 1（回到待月结列表）: ${r.monthly_pending_1}/${r.cnt}`);
        console.log(`  有付款审批单号（留在审批中/已付款）: ${r.has_payment_sp}/${r.cnt}`);
        if (r.already_paid > 0) {
          console.log(`  其中已付款完成: ${r.already_paid}/${r.cnt}`);
        }
      }

      console.log('\n✅ 恢复完成！请刷新「供应商对账中心」页面，采购单应已回到「待月结采购单」列表。');

    } catch (err) {
      await conn.rollback();
      console.error('❌ 恢复失败，事务已回滚：', err.message);
      throw err;
    }

  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('脚本执行出错:', err);
  process.exit(1);
});
