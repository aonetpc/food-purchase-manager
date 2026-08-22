-- =====================================================
-- 089_room_type_dual_pricing.sql
-- 房型双计价+床位数改造（088基础上再演进）
--
-- 需求背景：
--   1. 两种计价模式都常用，用户不希望房型配置翻倍（1行配置解决）
--   2. 同一房型同时支持按间和按人，需要两个独立单价列
--   3. 按间模式下早餐人数 = 间数 × 床位数（每个房型配一个 beds_per_room）
--   4. 按人模式下除了人头数也要同时存间数（方便酒店开房+防止1个人开1间超售）
--
-- 策略：
--   旧字段 price + pricing_mode 暂时保留（过渡期），不删。
--   新增：beds_per_room / price_per_room / price_per_person
--   数据回填：根据 pricing_mode 把老 price 塞到对应新列，另一列置 0
--             （0 代表不支持该模式，前端可据此禁用切换按钮）
--   兜底：如果回填后两列价格都为 0，说明该记录 pricing_mode 有异常，
--         把原 price 按 per_room 模式塞回去。
-- =====================================================

-- ① 新增三列
ALTER TABLE booking_room_types
  ADD COLUMN beds_per_room    INT NOT NULL DEFAULT 2        COMMENT '每间床位数（按间模式下早餐=间数×该值）'   AFTER pricing_mode,
  ADD COLUMN price_per_room   DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '按间单价（元/间/晚），0=不支持按间'     AFTER beds_per_room,
  ADD COLUMN price_per_person DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '按人单价（元/人/晚），0=不支持按人'     AFTER price_per_room;

-- ② beds_per_room 按名称关键字回填（尽量贴近实际）
UPDATE booking_room_types SET beds_per_room = CASE
  WHEN name LIKE '%单人%'                                          THEN 1
  WHEN name LIKE '%大床%' AND name NOT LIKE '%双床%'               THEN 1
  WHEN name LIKE '%大床露台'                                        THEN 1
  WHEN name LIKE '%标准%' AND name LIKE '%双床%'                   THEN 2
  WHEN name LIKE '%双床%'                                          THEN 2
  WHEN name LIKE '%家庭%'                                          THEN 4
  WHEN name LIKE '%多床%'                                          THEN 4
  WHEN name LIKE '%行政%'                                          THEN 2
  WHEN name LIKE '%别墅%' AND (name LIKE '%大床%' OR name LIKE '%整%大床%') THEN 1
  WHEN name LIKE '%别墅%' AND name LIKE '%双床%'                   THEN 2
  WHEN name LIKE '%别墅%' AND name LIKE '%多床%'                   THEN 4
  WHEN name LIKE '%别墅%'                                          THEN 8   -- 湖畔/整栋别墅默认8人
  ELSE 2
END;

-- ③ 按 pricing_mode 回填双单价
UPDATE booking_room_types SET
  price_per_room   = IF(pricing_mode='per_room',   IFNULL(price,0), 0),
  price_per_person = IF(pricing_mode='per_person', IFNULL(price,0), 0);

-- ④ 兜底：如果回填后两个新价格都是0（pricing_mode 异常或没设），按 per_room 填充老 price
UPDATE booking_room_types
   SET price_per_room = IFNULL(price,0)
 WHERE price_per_room=0 AND price_per_person=0;
