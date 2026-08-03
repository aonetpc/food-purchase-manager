-- 仓库采购单表添加预付款附件字段
-- prepay_attachments: 预付款审批附件清单 JSON [{filename, path, mime, size}]
ALTER TABLE warehouse_purchases
ADD COLUMN prepay_attachments JSON DEFAULT NULL COMMENT '预付款审批附件清单 [{filename, path, mime, size}]';
