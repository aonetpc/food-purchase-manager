-- 101 - booking_orders.submit_resend_count（方案S：原生INT列接管重发起计数，根除task_id重复静默）
--
-- 背景：驳回/撤回后，原依赖 JSON 字段内 attempt 递增生成 S{2,3...} 新 task_id，
--   存在 attempt 回退/清零导致企微同一 task_id 去重命中 -> sendCard 返回 errcode=0 但不推送给用户
--   的“静默丢失”现象（BB260825001 等驳回重发起案例）。
--
-- 方案S：
--   - 新增原生 NOT NULL DEFAULT 0 INT submit_resend_count。
--   - submit 路由在 UPDATE status='sales_confirming' 时同步 submit_resend_count += 1，
--     1 条 SQL 完成（比 JSON 结构里 merge attempt 少 1 次 SELECT + 1 次 JSON UPDATE）。
--   - submitAttempt = submit_resend_count（更新后的值）。
--       submit_resend_count=1 -> 首次提交 (task_id = booking_{orderNo})
--       submit_resend_count=2 -> 第 1 次重发起 (task_id = booking_{orderNo}_S2)
--       submit_resend_count=N -> N-1 次重发起 (task_id = booking_{orderNo}_SN)
--     兼容老卡 (S1 不带后缀)，且完全摆脱 JSON parse 对 attempt 计数不变量的依赖。
--   - 回填：把“已经成功发出过销售卡（JSON 内有 response_code）且当前不是 pending”
--     的订单直接 SET submit_resend_count=1，以便下一次驳回后重发起立刻走 S2。

SET @colExists = (
  SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'booking_orders'
     AND COLUMN_NAME = 'submit_resend_count'
);

SET @sql = IF(
  @colExists = 0,
  'ALTER TABLE booking_orders ADD COLUMN submit_resend_count INT NOT NULL DEFAULT 0 COMMENT ''booking submit重发起次数：1=首次任务卡(无后缀)；2=S2；N=SN''',
  'SELECT 1 AS skip_add_column'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- 回填：历史已成功发过销售卡、且当前已离开 pending 的订单 = 至少完成 1 次 submit
--   submit_resend_count 归 1（下次重发起直接到 2，task_id S2 → 绝不再命中第 1 次提交的去重键）
--   只改 submit_resend_count=0 的行，避免迁移多次运行把已经 >1 的后续数据回退。
UPDATE booking_orders
   SET submit_resend_count = 1
 WHERE submit_resend_count = 0
   AND status IN ('sales_confirming','reviewing','rejected','confirmed','completed')
   AND wecom_card_response_codes IS NOT NULL
   AND CHAR_LENGTH(wecom_card_response_codes) > 2
   AND JSON_UNQUOTE(JSON_EXTRACT(wecom_card_response_codes, '$.sales_confirm.response_code')) IS NOT NULL
   AND JSON_UNQUOTE(JSON_EXTRACT(wecom_card_response_codes, '$.sales_confirm.response_code')) <> '';
