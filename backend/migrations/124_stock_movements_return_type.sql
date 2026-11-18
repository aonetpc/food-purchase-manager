-- 124 - stock_movements.movement_type 追加 'return'（采购退货）
-- 背景：迁移 122 已包含该枚举扩展，但 CI 的 migrate job 在跑完 migrate.js 后
--       继续执行 fix-scan-inbound-missing.js / fix-scan-inbound-instant-use.js，
--       这两个脚本旧版会无条件 ALTER 枚举回 4 个值，导致 122 记录为已执行、
--       枚举却缺少 'return'，确认退货时写入被截断（WARN_DATA_TRUNCATED 1265）。
-- 处理：本次已删除两个脚本里的旧枚举 ALTER，并单开本迁移重新扩展枚举。
-- 约束：仅追加枚举末尾，不调整既有顺序；不涉及任何 DML/UPDATE 回填。

ALTER TABLE stock_movements
  MODIFY COLUMN movement_type ENUM('inbound','outbound','adjust','expense','return') NOT NULL COMMENT '类型：入库/出库/盘点调整/即买即用消耗/采购退货';
