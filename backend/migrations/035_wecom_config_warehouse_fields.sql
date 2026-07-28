-- ================================================
-- 035 - 给 wecom_config 表添加仓库采购审批相关字段
-- 用于仓库采购流程独立的审批模板和字段映射
-- 幂等执行：使用 INFORMATION_SCHEMA 动态判断，可重复执行
-- ================================================

-- 给 wecom_config 表添加 warehouse_approval_template_id 字段（仓库采购审批模板ID）
SET @dbname = DATABASE();
SET @tablename = 'wecom_config';
SET @columnname = 'warehouse_approval_template_id';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname
    AND table_name = @tablename
    AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' VARCHAR(100) COMMENT ''仓库采购审批模板ID''')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 给 wecom_config 表添加 warehouse_field_mapping 字段（仓库采购审批字段映射JSON）
SET @columnname = 'warehouse_field_mapping';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname
    AND table_name = @tablename
    AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' JSON COMMENT ''仓库采购审批字段映射''')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SELECT '035_wecom_config_warehouse_fields.sql 执行完成' AS message;
