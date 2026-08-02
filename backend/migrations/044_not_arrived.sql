-- 044: 仓库采购明细 - 未到货标记
-- 收货时部分物资可能未到货，需要标记以便PDF显示和库存处理

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

-- 为 warehouse_purchase_items 表添加 not_arrived 字段
CALL safe_add_column('warehouse_purchase_items', 'not_arrived', 'TINYINT(1) DEFAULT 0 COMMENT \'是否未到货（0=已到货，1=未到货）\'');

DROP PROCEDURE IF EXISTS safe_add_column;
