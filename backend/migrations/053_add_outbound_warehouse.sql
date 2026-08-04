-- 053 - 扫码领料单增加出库仓库字段
-- 区分出库仓库（扫码二维码对应的仓库，物资从这里出）与入库仓库（领料目标部门仓库）
-- 修正之前 warehouse_id 被误用作出库仓库扣库存的问题

ALTER TABLE scan_requisitions
  ADD COLUMN outbound_warehouse_id VARCHAR(36) COMMENT '出库仓库ID（扫码二维码对应仓库）' AFTER warehouse_name,
  ADD COLUMN outbound_warehouse_name VARCHAR(50) COMMENT '出库仓库名称' AFTER outbound_warehouse_id;

-- 历史数据回填：已审核/自动出库的领料单，出库仓库 = 原仓库（兼容旧逻辑）
UPDATE scan_requisitions
SET outbound_warehouse_id = warehouse_id,
    outbound_warehouse_name = warehouse_name
WHERE outbound_warehouse_id IS NULL;
