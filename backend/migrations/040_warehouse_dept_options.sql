-- ================================================
-- 040 - wecom_config 表增加仓库采购部门选项缓存字段
-- 用于缓存企微审批模板中 MultiSelector 控件的部门选项列表（key+text）
-- 避免每次提交审批都调企微API获取模板
-- 兼容 MySQL 5.7/8.0
-- ================================================

SET @dbname = DATABASE();
SET @tablename = 'wecom_config';
SET @columnname = 'warehouse_dept_options';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname
    AND table_name = @tablename
    AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' JSON COMMENT "仓库采购审批模板部门选项缓存（MultiSelector的key+text列表）"')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SELECT '040_warehouse_dept_options.sql 执行完成' AS message;
