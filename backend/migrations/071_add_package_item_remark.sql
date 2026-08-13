-- ============================================================
-- 071_add_package_item_remark.sql — 套餐项目增加备注字段
--
-- 需求：粘贴解析上传时格式为"项目名 | 备注"，
--   备注需要存储在 booking_package_items 表中。
-- 幂等：先检查字段是否存在，不存在才添加。
-- ============================================================

SET @dbname = DATABASE();
SET @tablename = 'booking_package_items';
SET @columnname = 'remark';

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname
    AND table_name = @tablename
    AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' VARCHAR(500) COMMENT ''项目备注（如：需空腹/女性专项等）'' AFTER quantity')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 验证
SELECT '===== 071 套餐项目备注字段添加完成 =====' AS info;
SHOW COLUMNS FROM booking_package_items LIKE 'remark';
