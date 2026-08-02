-- 仓库采购单表添加申请单PDF URL字段（独立于确认单PDF）
-- apply_pdf_url: 采购申请单PDF访问路径（提交审批时生成）
-- pdf_url: 入库确认单PDF访问路径（确认完成时生成）
ALTER TABLE warehouse_purchases
ADD COLUMN apply_pdf_url VARCHAR(500) DEFAULT NULL COMMENT '采购申请单PDF访问路径';
