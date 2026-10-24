-- ================================================
-- 121 - 预订订单：取消订单功能（feat/218）
-- 注意：原编号 120 与 120_purchase_item_stock_at_purchase.sql 冲突，
--       migrate.js 以数字前缀作为 schema_migrations.id（主键），会导致本文件被误判为已执行而跳过。
--
-- 背景：
--   已确认/已完成的订单客户临时取消是高频业务场景，此前只能物理删除（无留痕）。
--   新增终态 cancelled（软取消）：数据保留可追溯，看板置灰展示，所有统计口径排除。
--
-- 变更：
--   1. booking_orders 新增 4 个取消字段（幂等 ALTER）：
--      cancelled_by / cancelled_by_name / cancelled_at / cancelled_reason
--   2. 新增按钮权限 action:booking:cancel（取消订单），挂在 booking-board 模块
--   3. 权限仅默认分配给 admin；booker 等其他角色一律由管理员在角色管理页手动分配
--
-- 幂等：可重复执行不会报错
-- ================================================

SET @dbname = DATABASE();
SET @tablename = 'booking_orders';

-- 1. 取消人 users.id
SET @columnname = 'cancelled_by';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE `', @tablename, '` ADD COLUMN `', @columnname, '` VARCHAR(36) COMMENT ''取消人 users.id'' AFTER `rejected_at`')
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. 取消人姓名（冗余）
SET @columnname = 'cancelled_by_name';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE `', @tablename, '` ADD COLUMN `', @columnname, '` VARCHAR(50) COMMENT ''取消人姓名（冗余）'' AFTER `cancelled_by`')
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3. 取消时间
SET @columnname = 'cancelled_at';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE `', @tablename, '` ADD COLUMN `', @columnname, '` DATETIME COMMENT ''取消时间'' AFTER `cancelled_by_name`')
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4. 取消原因
SET @columnname = 'cancelled_reason';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE `', @tablename, '` ADD COLUMN `', @columnname, '` TEXT COMMENT ''取消原因'' AFTER `cancelled_at`')
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ================================================
-- 5. 新增权限：取消订单（按钮级）
-- ================================================
INSERT IGNORE INTO permissions (id, module_id, code, name, type, parent_id, sort_order, status)
SELECT UUID(), 'booking-board', 'action:booking:cancel', '取消订单', 'button', NULL, 7, 1
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM permissions WHERE code = 'action:booking:cancel' AND module_id = 'booking-board'
);

-- ================================================
-- 6. 仅 admin 默认分配；其他角色由管理员手动分配（严重功能，谨慎开放）
-- ================================================
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'admin'
  AND p.code = 'action:booking:cancel'
  AND p.module_id = 'booking-board';

-- ================================================
-- 7. 验证
-- ================================================
SELECT '===== 121_booking_order_cancel.sql 执行完成 =====' AS info;
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_orders'
  AND COLUMN_NAME LIKE 'cancelled%'
ORDER BY ORDINAL_POSITION;
SELECT p.code, p.name, r.code AS role_code
FROM permissions p
LEFT JOIN role_permissions rp ON rp.permission_id = p.id
LEFT JOIN roles r ON r.id = rp.role_id
WHERE p.code = 'action:booking:cancel';
