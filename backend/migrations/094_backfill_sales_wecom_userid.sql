-- ================================================
-- 094 - 回填现有订单的 sales_wecom_userid
--
-- 用途：给已经存在、但 sales_wecom_userid 为空的订单自动补全销售员企微userid
-- 逻辑：通过 sales_person_id 关联 users.wecom_userid
-- 幂等：安全执行，只更新为空的记录
-- ================================================

UPDATE booking_orders bo
JOIN users u ON bo.sales_person_id = u.id
SET bo.sales_wecom_userid = u.wecom_userid
WHERE bo.sales_wecom_userid IS NULL 
  AND bo.sales_wecom_userid = '' 
  AND u.wecom_userid IS NOT NULL 
  AND u.wecom_userid != '';

-- 同时清理空字符串
UPDATE booking_orders 
SET sales_wecom_userid = NULL 
WHERE sales_wecom_userid = '';
