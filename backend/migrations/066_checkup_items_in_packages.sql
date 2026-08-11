-- ================================================
-- 066 - 体检套餐项目化改造
--
-- 新增：
--   1. booking_checkup_items    体检项目主表（所有可选的体检检查项目）
--   2. booking_package_items    套餐-项目关联表（每个套餐包含哪些项目、对应单价）
--   3. booking_packages 新增 item_count 冗余字段
--
-- 幂等执行：可重复运行不会报错
-- ================================================

-- ================================================
-- 1. 体检项目主表
-- ================================================
CREATE TABLE IF NOT EXISTS booking_checkup_items (
  id VARCHAR(36) PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE COMMENT '项目编码',
  name VARCHAR(100) NOT NULL COMMENT '项目名称',
  category VARCHAR(50) NOT NULL DEFAULT '其他' COMMENT '分类：内科/外科/影像/化验/功能检查/其他',
  description VARCHAR(500) COMMENT '项目描述',
  default_price DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '默认单价',
  unit VARCHAR(20) NOT NULL DEFAULT '次' COMMENT '单位：次/项/人',
  status TINYINT NOT NULL DEFAULT 1 COMMENT '1=启用 0=禁用',
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_category (category),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='预订调度-体检项目主表';

-- 默认体检项目分类（常见体检项目）
INSERT IGNORE INTO booking_checkup_items (id, code, name, category, description, default_price, unit, status, sort_order) VALUES
(UUID(), 'CBC',   '血常规',         '化验',  '红细胞、白细胞、血小板等20余项指标', 35,  '次', 1, 1),
(UUID(), 'URINE', '尿常规',         '化验',  '尿液外观、比重、酸碱度、蛋白等',   25,  '次', 1, 2),
(UUID(), 'LIVER', '肝功能',         '化验',  'ALT/AST/ALP/GGT/胆红素/白蛋白等',  60,  '次', 1, 3),
(UUID(), 'KIDNEY','肾功能',         '化验',  '肌酐/尿素/尿酸/肾小球滤过率',       55,  '次', 1, 4),
(UUID(), 'LIPID', '血脂四项',       '化验',  '总胆固醇/甘油三酯/高密度/低密度',   45,  '次', 1, 5),
(UUID(), 'GLUCOSE','血糖',          '化验',  '空腹血糖',                           20,  '次', 1, 6),
(UUID(), 'ECG',   '心电图',         '功能检查','12导联心电图',                   30,  '次', 1, 7),
(UUID(), 'EKG24H','24小时动态心电图','功能检查','Holter监测',                    150, '次', 1, 8),
(UUID(), 'XRAY',  '胸部X光',        '影像',  '正位胸片',                           80,  '次', 1, 9),
(UUID(), 'BABOOM','腹部B超',        '影像',  '肝胆胰脾肾彩超',                     100, '次', 1, 10),
(UUID(), 'THYROID','甲状腺B超',     '影像',  '甲状腺彩超',                         80,  '次', 1, 11),
(UUID(), 'CT',    'CT检查',         '影像',  '按需选择部位',                       300, '次', 1, 12),
(UUID(), 'MRI',   '核磁共振',       '影像',  '按需选择部位',                       600, '次', 1, 13),
(UUID(), 'EYES',  '眼科检查',       '专科',  '视力/眼压/眼底/裂隙灯',             60,  '次', 1, 14),
(UUID(), 'ENT',   '耳鼻喉检查',     '专科',  '听力/鼻咽/喉内镜',                   80,  '次', 1, 15),
(UUID(), 'DENTAL','口腔检查',       '专科',  '口腔全景/牙周',                      80,  '次', 1, 16),
(UUID(), 'PAP',   '妇科检查',       '专科',  'TCT/HPV/白带常规',                  200, '次', 1, 17),
(UUID(), 'BONE',  '骨密度',         '功能检查','DEXA骨密度测定',                  80,  '次', 1, 18),
(UUID(), 'BODYFAT','体成分分析',    '功能检查','肌肉量/体脂率/基础代谢',          60,  '次', 1, 19),
(UUID(), 'CARDIAC','心脏彩超',      '影像',  '心脏结构与功能',                    300, '次', 1, 20),
(UUID(), 'ABDOMEN','胃幽门螺杆菌',  '化验',  'C13呼气试验',                       80,  '次', 1, 21),
(UUID(), 'VITAMIN','维生素检测',    '化验',  'VitB12/叶酸/VitD',                 200, '次', 1, 22),
(UUID(), 'TUMOR', '肿瘤标志物',     '化验',  'AFP/CEA/CA199等',                  300, '次', 1, 23),
(UUID(), 'NERVOUS','神经电生理',    '功能检查','神经传导速度/肌电图',             250, '次', 1, 24);

-- ================================================
-- 2. 套餐-项目关联表
-- ================================================
CREATE TABLE IF NOT EXISTS booking_package_items (
  id VARCHAR(36) PRIMARY KEY,
  package_id VARCHAR(36) NOT NULL COMMENT '套餐ID booking_packages.id',
  item_id VARCHAR(36) NOT NULL COMMENT '体检项目ID booking_checkup_items.id',
  item_name_snapshot VARCHAR(100) NOT NULL COMMENT '项目名称快照（冗余，避免JOIN）',
  item_price DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '套餐内单价（可独立于默认价格）',
  quantity INT NOT NULL DEFAULT 1 COMMENT '数量',
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_package_item (package_id, item_id),
  INDEX idx_package (package_id),
  INDEX idx_item (item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='预订调度-套餐项目关联表';

-- ================================================
-- 3. booking_packages 增加 item_count 冗余字段
-- ================================================
SET @dbname = DATABASE();
SET @tablename = 'booking_packages';

SET @columnname = 'item_count';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' INT NOT NULL DEFAULT 0 COMMENT ''项目数量（冗余字段）'' AFTER price')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @columnname = 'remark';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' VARCHAR(500) COMMENT ''备注'' AFTER item_count')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- ================================================
-- 4. 为现有套餐填充默认项目
-- ================================================

-- 获取体检项目ID映射（按code）
-- A套餐：基础体检 - 血常规+尿常规+肝功能+肾功能+血脂+血糖+心电图+胸部X光
INSERT IGNORE INTO booking_package_items (id, package_id, item_id, item_name_snapshot, item_price, quantity, sort_order)
SELECT UUID(), p.id, ci.id, ci.name, ci.default_price, 1, ci.sort_order
FROM booking_packages p
JOIN booking_checkup_items ci ON ci.code IN ('CBC','URINE','LIVER','KIDNEY','LIPID','GLUCOSE','ECG','XRAY')
WHERE p.code = 'A';

-- B套餐：综合体检 - A套餐项目 + 腹部B超+眼科+耳鼻喉+口腔+体成分
INSERT IGNORE INTO booking_package_items (id, package_id, item_id, item_name_snapshot, item_price, quantity, sort_order)
SELECT UUID(), p.id, ci.id, ci.name, ci.default_price, 1, ci.sort_order
FROM booking_packages p
JOIN booking_checkup_items ci ON ci.code IN ('CBC','URINE','LIVER','KIDNEY','LIPID','GLUCOSE','ECG','XRAY','BABOOM','EYES','ENT','DENTAL','BODYFAT')
WHERE p.code = 'B';

-- C套餐：深度体检 - B套餐项目 + 甲状腺B超+24小时心电图+骨密度+心脏彩超
INSERT IGNORE INTO booking_package_items (id, package_id, item_id, item_name_snapshot, item_price, quantity, sort_order)
SELECT UUID(), p.id, ci.id, ci.name, ci.default_price, 1, ci.sort_order
FROM booking_packages p
JOIN booking_checkup_items ci ON ci.code IN ('CBC','URINE','LIVER','KIDNEY','LIPID','GLUCOSE','ECG','XRAY','BABOOM','EYES','ENT','DENTAL','BODYFAT','THYROID','EKG24H','BONE','CARDIAC')
WHERE p.code = 'C';

-- D套餐：VIP体检 - C套餐 + CT+MRI+肿瘤标志物+维生素+妇科+胃幽门螺杆菌+神经电生理
INSERT IGNORE INTO booking_package_items (id, package_id, item_id, item_name_snapshot, item_price, quantity, sort_order)
SELECT UUID(), p.id, ci.id, ci.name, ci.default_price, 1, ci.sort_order
FROM booking_packages p
JOIN booking_checkup_items ci ON ci.code IN ('CBC','URINE','LIVER','KIDNEY','LIPID','GLUCOSE','ECG','XRAY','BABOOM','EYES','ENT','DENTAL','BODYFAT','THYROID','EKG24H','BONE','CARDIAC','CT','MRI','TUMOR','VITAMIN','PAP','ABDOMEN','NERVOUS')
WHERE p.code = 'D';

-- 更新 package 的 item_count 和 price（根据关联项自动计算）
UPDATE booking_packages p
SET item_count = (
  SELECT COUNT(*) FROM booking_package_items pi WHERE pi.package_id = p.id
),
price = (
  SELECT COALESCE(SUM(pi.item_price * pi.quantity), 0)
  FROM booking_package_items pi WHERE pi.package_id = p.id
);

-- ================================================
-- 5. 验证
-- ================================================
SELECT '===== 066_checkup_items_in_packages.sql 执行完成 =====' AS info;
SELECT '体检项目表：' AS info;
SELECT COUNT(*) AS total_items FROM booking_checkup_items;
SELECT '套餐-项目关联：' AS info;
SELECT p.code AS 套餐编码, p.name AS 套餐名, COUNT(pi.id) AS 项目数, SUM(pi.item_price * pi.quantity) AS 自动计算总价
FROM booking_packages p
LEFT JOIN booking_package_items pi ON pi.package_id = p.id
GROUP BY p.id, p.code, p.name;
