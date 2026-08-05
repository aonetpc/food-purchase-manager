-- 054 - 扩展 stock_movements.movement_type ENUM，新增 'expense'（即买即用消耗）
-- 原: ENUM('inbound','outbound','adjust')
-- 新: ENUM('inbound','outbound','adjust','expense')

ALTER TABLE stock_movements
  MODIFY COLUMN movement_type ENUM('inbound','outbound','adjust','expense') NOT NULL COMMENT '类型：入库/出库/盘点调整/即买即用消耗';
