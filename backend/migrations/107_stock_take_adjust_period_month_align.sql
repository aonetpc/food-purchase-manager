-- ================================================
-- 107 - 盘点 adjust 流水按归属月(period_month)对齐 created_at
-- 背景：
--   盘点在 period_month 的次月才完成复核（如 8月盘点在9月3日完成），
--   stock_movements.created_at 默认写成操作日(9月)，导致管理报表
--   按 created_at 过滤时盘亏金额计入了9月成本而不是应归属的8月。
--   本脚本将所有盘点 adjust 类型流水的 created_at 回写为
--   其盘点单 period_month 月末最后一秒 23:59:59。
-- 幂等：仅更新 created_at 不等于目标月末的行。无需 DDL。
-- ================================================

SET @dbname = DATABASE();

-- 利用临时表做 UPDATE JOIN 兼容 MySQL 5.7/8.0
DROP TEMPORARY TABLE IF EXISTS tmp_stock_take_align_107;

CREATE TEMPORARY TABLE tmp_stock_take_align_107 AS
SELECT
  sm.id AS movement_id,
  st.period_month,
  -- 月末：DATE_ADD(DATE_ADD(CONCAT(period_month,'-01'), INTERVAL 1 MONTH), INTERVAL -1 DAY)
  DATE_FORMAT(
    DATE_SUB(
      DATE_ADD(CONCAT(st.period_month, '-01'), INTERVAL 1 MONTH),
      INTERVAL 1 DAY
    ),
    '%Y-%m-%d 23:59:59'
  ) AS target_created_at
FROM stock_movements sm
JOIN stock_takes st ON sm.related_id = st.id
WHERE sm.movement_type = 'adjust'
  AND sm.related_type = 'take'
  AND sm.related_id IS NOT NULL;

-- 建索引加速 UPDATE JOIN（小表可不建，但留着更稳）
ALTER TABLE tmp_stock_take_align_107 ADD PRIMARY KEY (movement_id);

-- 仅更新那些 created_at 与目标不一致的行，保持幂等
UPDATE stock_movements sm
  INNER JOIN tmp_stock_take_align_107 t ON sm.id = t.movement_id
SET sm.created_at = t.target_created_at
WHERE DATE_FORMAT(sm.created_at, '%Y-%m-%d %H:%i:%s') != t.target_created_at;

-- 输出变更行数方便日志排查
SELECT CONCAT('[107] 调整盘点adjust流水行数: ', ROW_COUNT()) AS message;

DROP TEMPORARY TABLE IF EXISTS tmp_stock_take_align_107;
