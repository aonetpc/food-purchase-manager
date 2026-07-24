-- ================================================
-- 026 - 打卡时间精确到分钟 + 岗位每日打卡次数限制
-- ================================================

-- 1. 修改 checkin_records 表，新增 checkin_time 字段
ALTER TABLE checkin_records
ADD COLUMN checkin_time DATETIME NULL DEFAULT CURRENT_TIMESTAMP COMMENT '打卡精确时间' AFTER checkin_date;

-- 2. 修改 positions 表，新增 daily_limit 字段
ALTER TABLE positions
ADD COLUMN daily_limit INT DEFAULT 1 COMMENT '每日打卡次数限制(0=不限制)';

-- 3. 更新已有记录的 checkin_time（使用 created_at 作为打卡时间）
UPDATE checkin_records
SET checkin_time = created_at
WHERE checkin_time IS NULL;

-- 4. 设置按小时岗位默认不限制
UPDATE positions
SET daily_limit = 0
WHERE pay_type = 'per_hour';

SELECT '026_checkin_precision_and_daily_limit.sql 执行完成' AS message;