-- ============================================================
-- 069_dedup_room_types.sql — 彻底清理重复房型 + 加唯一索引
--
-- 修复目标：
--   1. 处理【同 code 重复】（核心问题）：067 在无唯一约束时会重复插入 RM001-RM016
--   2. 处理【同 name 不同 code 重复】：之前 067 动态生成 code 导致的 RM017+ 记录
--   3. 将订单引用的重复编码迁移到规范编码
--   4. 最终加唯一索引防止再发
-- ============================================================

-- ============================================================
-- Phase 1: 处理【同 name 不同 code】的重复（例如 RM017-RM032 与 RM001-RM016 同名）
-- ============================================================

-- 1.1 先把订单中引用的"非规范 code"（code > RM016）更新为规范 code（同名且 code 最小）
UPDATE booking_items bi
INNER JOIN (
  -- 对每个 name，找出 code 最小的那条作为 keep_code
  SELECT name, MIN(code) AS keep_code
  FROM booking_room_types
  GROUP BY name
) name_mapping
  ON JSON_UNQUOTE(JSON_EXTRACT(bi.extra, '$.lodgingType')) = (
    SELECT rt.code
    FROM booking_room_types rt
    WHERE rt.name = name_mapping.name AND rt.code > name_mapping.keep_code
    LIMIT 1
  )
SET bi.extra = JSON_SET(bi.extra, '$.lodgingType', name_mapping.keep_code)
WHERE bi.item_type = 'lodging'
  AND JSON_UNQUOTE(JSON_EXTRACT(bi.extra, '$.lodgingType')) IN (
    SELECT code FROM booking_room_types WHERE code > 'RM016' AND code REGEXP '^RM[0-9]+$'
  );

-- 1.2 删除【同 name 不同 code】的重复记录（保留 code 最小的）
DELETE rt1 FROM booking_room_types rt1
INNER JOIN booking_room_types rt2
  ON rt1.name = rt2.name AND rt1.code > rt2.code;

-- ============================================================
-- Phase 2: 处理【同 code 重复】（例如两条 RM001）
-- ============================================================

-- 2.1 把订单中引用的"重复 code 中多余记录"迁移到同 code 保留的记录
-- （这里直接更新所有引用到重复记录的订单，后面删除多余记录）
-- 这步主要是保险：如果重复记录有不同 id，先把订单引用统一
UPDATE booking_items bi
INNER JOIN (
  SELECT code, MIN(id) AS keep_id
  FROM booking_room_types
  GROUP BY code
  HAVING COUNT(*) > 1
) dup_code ON 1=1
INNER JOIN booking_room_types rt
  ON rt.code = dup_code.code AND rt.id != dup_code.keep_id
SET bi.extra = JSON_SET(bi.extra, '$.lodgingType', dup_code.code)
WHERE bi.item_type = 'lodging'
  AND JSON_UNQUOTE(JSON_EXTRACT(bi.extra, '$.lodgingType')) = dup_code.code;

-- 2.2 删除【同 code 重复】中 id 较大的记录
DELETE rt1 FROM booking_room_types rt1
INNER JOIN (
  SELECT code, MIN(id) AS keep_id
  FROM booking_room_types
  GROUP BY code
  HAVING COUNT(*) > 1
) dup ON rt1.code = dup.code AND rt1.id > dup.keep_id;

-- ============================================================
-- Phase 3: 确保唯一索引
-- ============================================================

SET @dbname = DATABASE();
SET @tablename = 'booking_room_types';
SET @indexname = 'uniq_room_type_code';

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE table_schema = @dbname
    AND table_name = @tablename
    AND index_name = @indexname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD UNIQUE INDEX ', @indexname, ' (code)')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- ============================================================
-- 验证结果
-- ============================================================
SELECT '===== 069 去重验证 =====' AS info;
SELECT COUNT(*) AS total_count FROM booking_room_types;
SELECT code, name, price, status, sort_order FROM booking_room_types ORDER BY code ASC;
