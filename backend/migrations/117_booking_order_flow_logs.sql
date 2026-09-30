-- 117_booking_order_flow_logs.sql
-- 预订订单审批流程历史记录表
-- 记录每一步操作（提交/确认/驳回/修改/审核通过/标记完成/撤回），支持多次循环

CREATE TABLE IF NOT EXISTS booking_order_flow_logs (
  id            VARCHAR(36)  PRIMARY KEY,
  order_id      VARCHAR(36)  NOT NULL,
  action        VARCHAR(32)  NOT NULL COMMENT 'submit/sales_confirm/reject/edit/approve/complete/withdraw',
  action_label  VARCHAR(32)  NOT NULL COMMENT '预订员提交/销售员确认/驳回/修改/审核通过/标记完成/撤回',
  operator_id   VARCHAR(36),
  operator_name VARCHAR(100),
  remark        TEXT         COMMENT '驳回原因、修改摘要等',
  signature     LONGTEXT     COMMENT '签字图片 base64（如有）',
  created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_flow_order (order_id),
  INDEX idx_flow_order_time (order_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='预订订单审批流程历史';
