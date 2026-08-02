-- 仓库表添加确认人字段
ALTER TABLE warehouses 
ADD COLUMN confirmer_userid VARCHAR(100) DEFAULT NULL COMMENT '仓库确认人企业微信userid';
