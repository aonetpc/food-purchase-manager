-- 043: 部门表增加企微部门ID字段
-- 用于直接映射企微审批中的部门，避免每次调用API匹配

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

CALL safe_add_column('departments', 'wecom_dept_id', 'VARCHAR(50) NULL COMMENT \'企微部门ID（手动配置，用于审批直传）\'');

DROP PROCEDURE IF EXISTS safe_add_column;
