-- 082: 给体检项目字典 booking_checkup_items 加适用角色字段 applicable_roles
-- 适用场景：配单页 WizardItems 按当前角色 Tab 过滤项目（如男性 Tab 不显示乳腺/盆腔等）
-- NULL / 空数组 = 全角色通用（不区分性别/婚否）
-- 示例值：["male"] / ["female_married","female_single"] / ["female_married"]
-- 注意 MySQL 5.7：JSON/TEXT 列不能加 DEFAULT，必须分两步

-- 第1步：加列（无 DEFAULT，允许 NULL）
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_checkup_items' AND COLUMN_NAME = 'applicable_roles'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE booking_checkup_items ADD COLUMN applicable_roles JSON NULL COMMENT ''适用角色:NULL=全通用,或 [male/female_married/female_single] 数组''',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 第2步：历史数据全部保持 NULL（=通用），不需要 UPDATE 填值
