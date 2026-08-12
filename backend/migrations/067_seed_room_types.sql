-- ============================================================
-- 067_seed_room_types.sql  —  房型初始化（16 条）
-- 幂等：已存在（同 code 或同名）则跳过，不会重复插入
-- ============================================================

-- 计算当前最大 RM 编码序号
SET @rm_max_num = (
  SELECT COALESCE(MAX(CAST(SUBSTRING(code, 3) AS UNSIGNED)), 0)
  FROM booking_room_types
  WHERE code REGEXP '^RM[0-9]+$'
);

-- 计算当前最大 sort_order
SET @so_base = (SELECT COALESCE(MAX(sort_order), 0) FROM booking_room_types);

-- 【稻香楼】系列（4 间）
INSERT IGNORE INTO booking_room_types (id, code, name, price, status, sort_order)
  SELECT UUID(), CONCAT('RM', LPAD(@rm_max_num := @rm_max_num + 1, 3, '0')), '【稻香楼】标准大床房', 1118, 1, @so_base := @so_base + 1;
INSERT IGNORE INTO booking_room_types (id, code, name, price, status, sort_order)
  SELECT UUID(), CONCAT('RM', LPAD(@rm_max_num := @rm_max_num + 1, 3, '0')), '【稻香楼】标准双床房', 1118, 1, @so_base := @so_base + 1;
INSERT IGNORE INTO booking_room_types (id, code, name, price, status, sort_order)
  SELECT UUID(), CONCAT('RM', LPAD(@rm_max_num := @rm_max_num + 1, 3, '0')), '【稻香楼】稻香山林大床房', 1118, 1, @so_base := @so_base + 1;
INSERT IGNORE INTO booking_room_types (id, code, name, price, status, sort_order)
  SELECT UUID(), CONCAT('RM', LPAD(@rm_max_num := @rm_max_num + 1, 3, '0')), '【稻香楼】稻香山林双床房', 1118, 1, @so_base := @so_base + 1;

-- 【蝉鸣院】系列（7 间）
INSERT IGNORE INTO booking_room_types (id, code, name, price, status, sort_order)
  SELECT UUID(), CONCAT('RM', LPAD(@rm_max_num := @rm_max_num + 1, 3, '0')), '【蝉鸣院】单人房', 1500, 1, @so_base := @so_base + 1;
INSERT IGNORE INTO booking_room_types (id, code, name, price, status, sort_order)
  SELECT UUID(), CONCAT('RM', LPAD(@rm_max_num := @rm_max_num + 1, 3, '0')), '【蝉鸣院】标准大床房', 1500, 1, @so_base := @so_base + 1;
INSERT IGNORE INTO booking_room_types (id, code, name, price, status, sort_order)
  SELECT UUID(), CONCAT('RM', LPAD(@rm_max_num := @rm_max_num + 1, 3, '0')), '【蝉鸣院】大床房', 1680, 1, @so_base := @so_base + 1;
INSERT IGNORE INTO booking_room_types (id, code, name, price, status, sort_order)
  SELECT UUID(), CONCAT('RM', LPAD(@rm_max_num := @rm_max_num + 1, 3, '0')), '【蝉鸣院】双床房', 1680, 1, @so_base := @so_base + 1;
INSERT IGNORE INTO booking_room_types (id, code, name, price, status, sort_order)
  SELECT UUID(), CONCAT('RM', LPAD(@rm_max_num := @rm_max_num + 1, 3, '0')), '【蝉鸣院】大床房带露台', 1780, 1, @so_base := @so_base + 1;
INSERT IGNORE INTO booking_room_types (id, code, name, price, status, sort_order)
  SELECT UUID(), CONCAT('RM', LPAD(@rm_max_num := @rm_max_num + 1, 3, '0')), '【蝉鸣院】行政双床套房', 1780, 1, @so_base := @so_base + 1;
INSERT IGNORE INTO booking_room_types (id, code, name, price, status, sort_order)
  SELECT UUID(), CONCAT('RM', LPAD(@rm_max_num := @rm_max_num + 1, 3, '0')), '【蝉鸣院】多床家庭套房', 2380, 1, @so_base := @so_base + 1;

-- 竹風系列（4 间）
INSERT IGNORE INTO booking_room_types (id, code, name, price, status, sort_order)
  SELECT UUID(), CONCAT('RM', LPAD(@rm_max_num := @rm_max_num + 1, 3, '0')), '竹風别墅大床房', 2880, 1, @so_base := @so_base + 1;
INSERT IGNORE INTO booking_room_types (id, code, name, price, status, sort_order)
  SELECT UUID(), CONCAT('RM', LPAD(@rm_max_num := @rm_max_num + 1, 3, '0')), '竹風临湖别墅大床房', 3380, 1, @so_base := @so_base + 1;
INSERT IGNORE INTO booking_room_types (id, code, name, price, status, sort_order)
  SELECT UUID(), CONCAT('RM', LPAD(@rm_max_num := @rm_max_num + 1, 3, '0')), '竹風别墅多床房', 3580, 1, @so_base := @so_base + 1;
INSERT IGNORE INTO booking_room_types (id, code, name, price, status, sort_order)
  SELECT UUID(), CONCAT('RM', LPAD(@rm_max_num := @rm_max_num + 1, 3, '0')), '竹風临湖别墅多床房', 4080, 1, @so_base := @so_base + 1;

-- 湖畔别墅（1 间）
INSERT IGNORE INTO booking_room_types (id, code, name, price, status, sort_order)
  SELECT UUID(), CONCAT('RM', LPAD(@rm_max_num := @rm_max_num + 1, 3, '0')), '湖畔别墅', 11888, 1, @so_base := @so_base + 1;
