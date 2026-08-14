-- ================================================
-- 067 - 体检组合项目支持
--
-- 新增：
--   1. booking_checkup_items 增加 item_type 字段 ('item'=普通项目, 'combo'=组合项目)
--   2. booking_item_sub_items 组合项目-子项目关联表
--
-- 幂等执行：可重复运行不会报错
-- ================================================

-- ================================================
-- 1. booking_checkup_items 增加 item_type 字段
-- ================================================
SET @dbname = DATABASE();
SET @tablename = 'booking_checkup_items';

SET @columnname = 'item_type';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, " ENUM('item', 'combo') NOT NULL DEFAULT 'item' COMMENT '项目类型 (item=普通项目, combo=组合项目)' AFTER name")
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;


-- ================================================
-- 2. 创建组合项目-子项目关联表
-- ================================================
CREATE TABLE IF NOT EXISTS booking_item_sub_items (
  id VARCHAR(36) PRIMARY KEY,
  combo_item_id VARCHAR(36) NOT NULL COMMENT '组合项目ID (booking_checkup_items.id)',
  sub_item_id VARCHAR(36) NOT NULL COMMENT '子项目ID (booking_checkup_items.id)',
  sort_order INT NOT NULL DEFAULT 0 COMMENT '排序',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_combo_subitem (combo_item_id, sub_item_id),
  INDEX idx_combo_item (combo_item_id),
  INDEX idx_sub_item (sub_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='体检组合项目-子项目关联表';


-- ================================================
-- 3. 插入示例组合项目及其子项目关联 (基于已有数据)
-- ================================================

-- 3.1 血脂全套 (7项)
-- 先确保组合项目本身存在
INSERT IGNORE INTO booking_checkup_items (id, code, name, item_type, category, description, default_price, unit, status, sort_order)
VALUES (UUID(), 'COMBO_LIPID_7', '血脂全套（7项）', 'combo', '化验', '包含：总胆固醇、甘油三酯、高密度胆固醇、低密度胆固醇、动脉硬化指数、载脂蛋白A1、载脂蛋白B', 129, '次', 1, 100);

-- 获取组合项目ID
SET @combo_lipid_7_id = (SELECT id FROM booking_checkup_items WHERE code = 'COMBO_LIPID_7');

-- 获取子项目ID
SET @chol_id = (SELECT id FROM booking_checkup_items WHERE name = '总胆固醇(TC)' AND category = '化验' LIMIT 1);
SET @tg_id = (SELECT id FROM booking_checkup_items WHERE name = '甘油三酯(TG)' AND category = '化验' LIMIT 1);
SET @hdl_id = (SELECT id FROM booking_checkup_items WHERE name = '高密度胆固醇(HDL-CH)' AND category = '化验' LIMIT 1);
SET @ldl_id = (SELECT id FROM booking_checkup_items WHERE name = '低密度胆固醇(LDL-CH)' AND category = '化验' LIMIT 1);
SET @apoA1_id = (SELECT id FROM booking_checkup_items WHERE name = '载脂蛋白A1(APO-A1)' AND category = '化验' LIMIT 1);
SET @apoB_id = (SELECT id FROM booking_checkup_items WHERE name = '载脂蛋白B(APO-B)' AND category = '化验' LIMIT 1);
-- 动脉硬化指数没有单独项目，我们用血脂四项来涵盖，这里先跳过或找合适的项目
-- 为了保证脚本运行，我们先插入存在的项目

-- 插入子项目关联
INSERT IGNORE INTO booking_item_sub_items (id, combo_item_id, sub_item_id, sort_order)
SELECT UUID(), @combo_lipid_7_id, sub_id, ord FROM (
  SELECT @chol_id AS sub_id, 1 AS ord UNION ALL
  SELECT @tg_id, 2 UNION ALL
  SELECT @hdl_id, 3 UNION ALL
  SELECT @ldl_id, 4 UNION ALL
  SELECT @apoA1_id, 6 UNION ALL
  SELECT @apoB_id, 7
) AS tmp WHERE sub_id IS NOT NULL;


-- 3.2 肝功全套
INSERT IGNORE INTO booking_checkup_items (id, code, name, item_type, category, description, default_price, unit, status, sort_order)
VALUES (UUID(), 'COMBO_LIVER_FULL', '肝功全套', 'combo', '化验', '包含：谷丙转氨酶、谷草转氨酶、碱性磷酸酶、γ-谷氨酰转酶、总胆红素、直接胆红素、白蛋白、球蛋白、白球比、总胆汁酸', 814, '次', 1, 101);

SET @combo_liver_full_id = (SELECT id FROM booking_checkup_items WHERE code = 'COMBO_LIVER_FULL');

SET @alt_id = (SELECT id FROM booking_checkup_items WHERE name = '谷丙转氨酶(ALT)' AND category = '化验' LIMIT 1);
SET @ast_id = (SELECT id FROM booking_checkup_items WHERE name = '谷草转氨酶(AST)' AND category = '化验' LIMIT 1);
SET @alp_id = (SELECT id FROM booking_checkup_items WHERE name = '碱性磷酸酶(ALP)' AND category = '化验' LIMIT 1);
SET @ggt_id = (SELECT id FROM booking_checkup_items WHERE name = 'γ-谷氨酰转酶(GGT)' AND category = '化验' LIMIT 1);
SET @tbil_id = (SELECT id FROM booking_checkup_items WHERE name = '总胆红素(TBIL)' AND category = '化验' LIMIT 1);
SET @dbil_id = (SELECT id FROM booking_checkup_items WHERE name = '直接胆红素(DBIL)' AND category = '化验' LIMIT 1);
SET @alb_id = (SELECT id FROM booking_checkup_items WHERE name = '白蛋白(ALB)' AND category = '化验' LIMIT 1);
SET @glb_id = (SELECT id FROM booking_checkup_items WHERE name = '球蛋白(GLB)' AND category = '化验' LIMIT 1);
SET @ag_id = (SELECT id FROM booking_checkup_items WHERE name = '白球比(A/G)' AND category = '化验' LIMIT 1);
SET @tba_id = (SELECT id FROM booking_checkup_items WHERE name = '总胆汁酸(TBA)' AND category = '化验' LIMIT 1);

INSERT IGNORE INTO booking_item_sub_items (id, combo_item_id, sub_item_id, sort_order)
SELECT UUID(), @combo_liver_full_id, sub_id, ord FROM (
  SELECT @alt_id AS sub_id, 1 AS ord UNION ALL
  SELECT @ast_id, 2 UNION ALL
  SELECT @alp_id, 3 UNION ALL
  SELECT @ggt_id, 4 UNION ALL
  SELECT @tbil_id, 5 UNION ALL
  SELECT @dbil_id, 6 UNION ALL
  SELECT @alb_id, 7 UNION ALL
  SELECT @glb_id, 8 UNION ALL
  SELECT @ag_id, 9 UNION ALL
  SELECT @tba_id, 10
) AS tmp WHERE sub_id IS NOT NULL;


-- 3.3 肾功全套
INSERT IGNORE INTO booking_checkup_items (id, code, name, item_type, category, description, default_price, unit, status, sort_order)
VALUES (UUID(), 'COMBO_KIDNEY_FULL', '肾功全套', 'combo', '化验', '包含：尿素氮、肌酐、尿酸、肾小球滤过率、β2-微球蛋白、尿白蛋白、尿IgG、尿NAG', 255, '次', 1, 102);

SET @combo_kidney_full_id = (SELECT id FROM booking_checkup_items WHERE code = 'COMBO_KIDNEY_FULL');

SET @bun_id = (SELECT id FROM booking_checkup_items WHERE name = '尿素氮(BUN)' AND category = '化验' LIMIT 1);
SET @cr_id = (SELECT id FROM booking_checkup_items WHERE name = '肌酐(CRE)' AND category = '化验' LIMIT 1);
SET @ua_id = (SELECT id FROM booking_checkup_items WHERE name = '尿酸(UA)' AND category = '化验' LIMIT 1);
SET @β2mg_id = (SELECT id FROM booking_checkup_items WHERE name = 'β2-微球蛋白(β2-MG)' AND category = '化验' LIMIT 1);
SET @malb_id = (SELECT id FROM booking_checkup_items WHERE name = '尿微量白蛋白（MALB）' AND category = '化验' LIMIT 1);
SET @iggu_id = (SELECT id FROM booking_checkup_items WHERE name = '尿IgG' AND category = '化验' LIMIT 1);
SET @nag_id = (SELECT id FROM booking_checkup_items WHERE name = '尿NAG' AND category = '化验' LIMIT 1);

INSERT IGNORE INTO booking_item_sub_items (id, combo_item_id, sub_item_id, sort_order)
SELECT UUID(), @combo_kidney_full_id, sub_id, ord FROM (
  SELECT @bun_id AS sub_id, 1 AS ord UNION ALL
  SELECT @cr_id, 2 UNION ALL
  SELECT @ua_id, 3 UNION ALL
  SELECT @β2mg_id, 4 UNION ALL
  SELECT @malb_id, 5 UNION ALL
  SELECT @iggu_id, 6 UNION ALL
  SELECT @nag_id, 7
) AS tmp WHERE sub_id IS NOT NULL;


-- 3.4 肿瘤标志物全套 (女性)
INSERT IGNORE INTO booking_checkup_items (id, code, name, item_type, category, description, default_price, unit, status, sort_order)
VALUES (UUID(), 'COMBO_TUMOR_FEMALE', '肿瘤标志物全套(女)', 'combo', '化验', '包含：AFP, CEA, CA125, CA153, CA199, CA724, NSE', 640, '次', 1, 103);

SET @combo_tumor_female_id = (SELECT id FROM booking_checkup_items WHERE code = 'COMBO_TUMOR_FEMALE');

SET @afp_id = (SELECT id FROM booking_checkup_items WHERE name = '甲胎蛋白(AFP)' AND category = '化验' LIMIT 1);
SET @cea_id = (SELECT id FROM booking_checkup_items WHERE name = '癌胚抗原(CEA)' AND category = '化验' LIMIT 1);
SET @ca125_id = (SELECT id FROM booking_checkup_items WHERE name = '糖类抗原125(CA125)' AND category = '化验' LIMIT 1);
SET @ca153_id = (SELECT id FROM booking_checkup_items WHERE name = '糖类抗原153(CA153)' AND category = '化验' LIMIT 1);
SET @ca199_id = (SELECT id FROM booking_checkup_items WHERE name = '糖类抗原199(CA199)' AND category = '化验' LIMIT 1);
SET @ca724_id = (SELECT id FROM booking_checkup_items WHERE name = '糖类抗原724(CA724)' AND category = '化验' LIMIT 1);
SET @nse_id = (SELECT id FROM booking_checkup_items WHERE name = '神经元特异性烯醇化酶(NSE)' AND category = '化验' LIMIT 1);

INSERT IGNORE INTO booking_item_sub_items (id, combo_item_id, sub_item_id, sort_order)
SELECT UUID(), @combo_tumor_female_id, sub_id, ord FROM (
  SELECT @afp_id AS sub_id, 1 AS ord UNION ALL
  SELECT @cea_id, 2 UNION ALL
  SELECT @ca125_id, 3 UNION ALL
  SELECT @ca153_id, 4 UNION ALL
  SELECT @ca199_id, 5 UNION ALL
  SELECT @ca724_id, 6 UNION ALL
  SELECT @nse_id, 7
) AS tmp WHERE sub_id IS NOT NULL;


-- 3.5 肿瘤标志物全套 (男性)
INSERT IGNORE INTO booking_checkup_items (id, code, name, item_type, category, description, default_price, unit, status, sort_order)
VALUES (UUID(), 'COMBO_TUMOR_MALE', '肿瘤标志物全套(男)', 'combo', '化验', '包含：AFP, CEA, CA199, PSA, FPSA, CA724, NSE', 560, '次', 1, 104);

SET @combo_tumor_male_id = (SELECT id FROM booking_checkup_items WHERE code = 'COMBO_TUMOR_MALE');

SET @psa_id = (SELECT id FROM booking_checkup_items WHERE name = '总前列腺特异性抗原(T-PSA)' AND category = '化验' LIMIT 1);
SET @fpsa_id = (SELECT id FROM booking_checkup_items WHERE name = '游离前列腺特异性抗原(F-PSA)' AND category = '化验' LIMIT 1);

INSERT IGNORE INTO booking_item_sub_items (id, combo_item_id, sub_item_id, sort_order)
SELECT UUID(), @combo_tumor_male_id, sub_id, ord FROM (
  SELECT @afp_id AS sub_id, 1 AS ord UNION ALL
  SELECT @cea_id, 2 UNION ALL
  SELECT @ca199_id, 3 UNION ALL
  SELECT @psa_id, 4 UNION ALL
  SELECT @fpsa_id, 5 UNION ALL
  SELECT @ca724_id, 6 UNION ALL
  SELECT @nse_id, 7
) AS tmp WHERE sub_id IS NOT NULL;


-- ================================================
-- 4. 验证
-- ================================================
SELECT '===== 067_combo_items.sql 执行完成 =====' AS info;
SELECT '体检项目类型分布：' AS info, item_type, COUNT(*) FROM booking_checkup_items GROUP BY item_type;
SELECT '组合项目列表：' AS info, id, name, default_price FROM booking_checkup_items WHERE item_type = 'combo';
SELECT '组合项目子项关联数：' AS info, combo_item_id, COUNT(*) FROM booking_item_sub_items GROUP BY combo_item_id;
