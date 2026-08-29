-- 为 booking_orders 增加 last_edit_diff JSON 列，记录最近一次编辑的字段变更摘要
-- 用于 /booking-confirm 审批页显示"改了什么"

ALTER TABLE booking_orders
  ADD COLUMN last_edit_diff JSON NULL COMMENT '最近一次编辑的变更摘要(JSON): { time, operator, changes: [{field, from, to}] }'
  AFTER remark;
