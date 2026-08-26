-- 101 - booking_orders.submit_resend_count（方案S：原生INT列接管重发起计数，根除task_id重复静默）
--
-- 背景：驳回/撤回后，原依赖 JSON 字段内 attempt 递增生成 S{2,3...} 新 task_id，
--   存在 attempt 回退/清零导致企微同一 task_id 去重命中 -> sendCard 返回 errcode=0 但不推送给用户
--   的“静默丢失”现象（BB260825001 等驳回重发起案例）。
-- 本次重写：
--   - 删除 PREPARE/EXECUTE 动态 SQL，改为直接 ALTER（解决 usingNativeCount=false 诊断确认 101 没跑问题）
--   - 回填条件简化：status 非 pending + JSON 非空，不依赖 response_code（驳回会清空 response_code）

ALTER TABLE booking_orders
  ADD COLUMN submit_resend_count INT NOT NULL DEFAULT 0
  COMMENT 'booking submit重发起次数：1=首次任务卡(无后缀)；2=S2；N=SN';

-- 回填：历史已离开 pending 状态的订单 = 至少完成过 1 次 submit
--   submit_resend_count 归 1（下次重发起直接到 2，task_id S2 → 绝不再命中第 1 次提交的去重键）
--   只改 submit_resend_count=0 的行，避免迁移多次运行把已经 >1 的后续数据回退。
UPDATE booking_orders
   SET submit_resend_count = 1
 WHERE submit_resend_count = 0
   AND status IN ('sales_confirming','reviewing','rejected','confirmed','completed')
   AND wecom_card_response_codes IS NOT NULL
   AND CHAR_LENGTH(wecom_card_response_codes) > 2;
