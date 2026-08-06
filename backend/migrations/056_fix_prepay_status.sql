-- 056_fix_prepay_status.sql
-- 修复预付款订单历史数据状态：将 reimbursing 状态的预付款订单改回 confirmed
-- 因为预付款流程应是：确认 → 核销 → 尾款报销，确认后不应直接进入报销中状态

UPDATE warehouse_purchases
SET status = 'confirmed',
    reimbursement_status = NULL,
    reimbursement_sp_no = NULL
WHERE purchase_type = 'prepay'
  AND status = 'reimbursing'
  AND writeoff_status IS NULL;

-- 同时将 total_amount 作为 actual_amount 的兜底（如果 actual_amount 为0）
UPDATE warehouse_purchases
SET actual_amount = total_amount
WHERE purchase_type = 'prepay'
  AND status = 'confirmed'
  AND (actual_amount IS NULL OR actual_amount = 0)
  AND total_amount > 0;
