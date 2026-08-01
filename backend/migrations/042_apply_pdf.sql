-- 042: 仓库采购申请PDF路径字段
-- 用于存储提交审批时生成的采购申请单PDF路径

-- 使用存储过程安全添加字段（兼容MySQL 5.7）
DELIMITER $$
DROP PROCEDURE IF EXISTS safe_add_column$$
CREATE PROCEDURE safe_add_column(
    IN table_name VARCHAR(255),
    IN column_name VARCHAR(255),
    IN column_def VARCHAR(1024)
)
BEGIN
    DECLARE column_exists INT DEFAULT 0;
    SELECT COUNT(*) INTO column_exists
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = table_name
      AND COLUMN_NAME = column_name;
    IF column_exists = 0 THEN
        SET @sql = CONCAT('ALTER TABLE ', table_name, ' ADD COLUMN ', column_name, ' ', column_def);
        PREPARE stmt FROM @sql;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END$$
DELIMITER ;

-- 为 warehouse_purchases 表添加 apply_pdf_path 字段
CALL safe_add_column('warehouse_purchases', 'apply_pdf_path', 'VARCHAR(500) NULL COMMENT \'采购申请单PDF路径\'');

DROP PROCEDURE IF EXISTS safe_add_column;
