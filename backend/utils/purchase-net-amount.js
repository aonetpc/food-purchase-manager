// ============================================================
// 采购净额口径（统一封装）
//   net = （actual_amount > 0 ? actual_amount : total_amount）- returned_amount
//   - 保留原有「actual_amount 为 0 时回退 total_amount」的语义
//   - SQL 侧全部用 IFNULL 兜住 NULL，历史单据 returned_amount 默认 0，净额与现状一致
// ============================================================

function toNum(val) {
  if (val === null || val === undefined) return 0;
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

/** JS 侧净额（保留两位小数） */
function computeNetAmount(row) {
  if (!row) return 0;
  const base = toNum(row.actual_amount) > 0 ? toNum(row.actual_amount) : toNum(row.total_amount);
  return Math.round((base - toNum(row.returned_amount)) * 100) / 100;
}

/** SQL 侧净额表达式（alias 为 warehouse_purchases 的表别名） */
function netAmountSql(alias = 'wp') {
  return `(CASE WHEN IFNULL(${alias}.actual_amount, 0) > 0 THEN IFNULL(${alias}.actual_amount, 0) - IFNULL(${alias}.returned_amount, 0) ELSE IFNULL(${alias}.total_amount, 0) END)`;
}

/**
 * 采购明细级「已退金额」聚合子查询（先聚合再 LEFT JOIN，避免行数膨胀）
 * 用法：
 *   LEFT JOIN (${returnedItemAggSql()}) ret ON ret.purchase_item_id = wpi.id
 */
function returnedItemAggSql() {
  return `SELECT ri.purchase_item_id,
                 SUM(ri.quantity) AS returned_qty,
                 SUM(ri.amount) AS returned_amt
          FROM warehouse_purchase_return_items ri
          INNER JOIN warehouse_purchase_returns r ON r.id = ri.return_id
          WHERE r.status IN ('confirmed', 'completed')
          GROUP BY ri.purchase_item_id`;
}

module.exports = { computeNetAmount, netAmountSql, returnedItemAggSql };
