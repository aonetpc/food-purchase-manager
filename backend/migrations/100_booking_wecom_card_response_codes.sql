-- 预订订单：企微模板卡 response_code 绑定
-- 用途：用户在 H5 页完成确认/审核/驳回后，可通过 response_code 回调
-- 将企微原消息里的蓝色「去确认/去审核/驳回」按钮直接替换为灰色「已确认 (YYYY-MM-DD HH:mm:ss)」
-- （与采购入库 purchase_confirmations.user_departments[].response_code 机制完全对齐）
-- 键：
--   $.sales_confirm  : 发给销售员的「订单待确认」submit 卡 response_code
--   $.approve        : 发给审核员的「订单待审核」salesConfirm 卡 response_code
-- 每张值结构：{ userid, response_code, at }
ALTER TABLE `booking_orders`
  ADD COLUMN `wecom_card_response_codes` JSON NULL COMMENT '企微模板卡response_code：用于H5确认后灰化原卡按钮' AFTER `rejection_reason`;
