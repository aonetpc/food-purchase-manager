-- ================================================
-- 109 - booking_packages.code 字段从 VARCHAR(20) 扩大到 VARCHAR(50)
--
-- 背景：
--   clone 接口的 code 生成逻辑是 srcPkg.code + '_' + 6位时间戳，
--   衍生再衍生会导致 code 叠加变长：
--     第1代: PKxxxxxxxx (10)
--     第2代: PKxxxxxxxx_xxxxxx (17)
--     第3代: PKxxxxxxxx_xxxxxx_xxxxxx (24) > VARCHAR(20) → Data too long
--   即使 clone 逻辑改为固定长度生成，扩大字段也是兜底保险，
--   防止历史数据/未来逻辑变更导致超长。
--
-- 影响：仅扩大字段长度，不改变数据，幂等可重复执行
-- ================================================

ALTER TABLE booking_packages MODIFY COLUMN code VARCHAR(50) NOT NULL COMMENT '套餐编码';

-- 验证
SELECT '===== 109 booking_packages.code 字段验证 =====' AS info;
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'booking_packages'
  AND COLUMN_NAME = 'code';
