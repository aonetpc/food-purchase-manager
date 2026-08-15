-- ============================================================
-- 075: 体检项目数据修正（按2023最新定价拟稿，对应068/069/070重导后已被清空的现状）
-- 执行范围：
--   1. 按名称+分类匹配，UPDATE booking_checkup_items 的：
--        - default_price（2023最新定价）
--        - insurance_price（医保价格）
--        - item_type（普通 item / 组合 combo）
--   2. 回填 booking_package_items：
--        - item_price = 关联体检项目 default_price（当前被清成0导致原价¥0）
--        - item_name_snapshot = 体检项目 name（当前被清空导致显示占位）
--        - insurance_price_snapshot = 关联体检项目 insurance_price
--
--  重要：仅 UPDATE，不 DELETE/重插，保护用户新增的自定义项目和套餐明细关联
-- ============================================================

-- ============================================================
-- STEP 1: 确保 code 字段存在（幂等）
-- ============================================================
SET @add_code_col = (SELECT IF(COUNT(*) = 0,
  "ALTER TABLE booking_checkup_items ADD COLUMN code VARCHAR(50) NOT NULL DEFAULT '' COMMENT '项目编码' AFTER id",
  'SELECT 1')
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_checkup_items' AND COLUMN_NAME = 'code');
PREPARE stmt FROM @add_code_col; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @add_ins_col = (SELECT IF(COUNT(*) = 0,
  "ALTER TABLE booking_checkup_items ADD COLUMN insurance_price DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '医保价格' AFTER default_price",
  'SELECT 1')
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_checkup_items' AND COLUMN_NAME = 'insurance_price');
PREPARE stmt FROM @add_ins_col; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @add_pins_col = (SELECT IF(COUNT(*) = 0,
  "ALTER TABLE booking_package_items ADD COLUMN insurance_price_snapshot DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '医保价格快照' AFTER item_price",
  'SELECT 1')
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_package_items' AND COLUMN_NAME = 'insurance_price_snapshot');
PREPARE stmt FROM @add_pins_col; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @add_pname_col = (SELECT IF(COUNT(*) = 0,
  "ALTER TABLE booking_package_items ADD COLUMN item_name_snapshot VARCHAR(200) NOT NULL DEFAULT '' COMMENT '项目名称快照' AFTER item_id",
  'SELECT 1')
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_package_items' AND COLUMN_NAME = 'item_name_snapshot');
PREPARE stmt FROM @add_pname_col; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ============================================================
-- STEP 2: 按名称匹配修正体检项目（价格/类型/分类，分类=化验保持不变，分类变化的单独写）
--         格式：UPDATE booking_checkup_items SET col=val WHERE name='名称' AND category='分类' LIMIT 1
-- ============================================================

-- ========== 化验 ==========
UPDATE booking_checkup_items SET default_price=35,  insurance_price=20, item_type='item'  WHERE name='血常规' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=85,  insurance_price=50, item_type='item'  WHERE name='血型（ABO、RH）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=20,  insurance_price=10, item_type='item'  WHERE name='血沉' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=20,  insurance_price=10, item_type='item'  WHERE name='尿常规' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=35,  insurance_price=20, item_type='item'  WHERE name='尿沉渣' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=50,  insurance_price=30, item_type='combo' WHERE name='尿常规+尿沉渣' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=20,  insurance_price=10, item_type='item'  WHERE name='大便隐血试验' AND category='化验' LIMIT 1;

-- 专科
UPDATE booking_checkup_items SET default_price=20,  insurance_price=10, item_type='item', category='专科' WHERE name='白带常规' AND (category='化验' OR category='专科') LIMIT 1;
UPDATE booking_checkup_items SET default_price=120, insurance_price=70, item_type='item', category='专科' WHERE name='宫颈脱落细胞检查' AND (category='化验' OR category='专科') LIMIT 1;

UPDATE booking_checkup_items SET default_price=95,  insurance_price=56, item_type='item'  WHERE name='血流变' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=10,  insurance_price=5,  item_type='item'  WHERE name='谷丙转氨酶' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=20,  insurance_price=10, item_type='combo' WHERE name='肝功能2项' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=30,  insurance_price=17, item_type='combo' WHERE name='肝功能3项' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=40,  insurance_price=23, item_type='combo' WHERE name='肝功能4项' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=50,  insurance_price=25, item_type='combo' WHERE name='肝功能5项' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=60,  insurance_price=30, item_type='combo' WHERE name='肝功能6项' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=80,  insurance_price=42, item_type='combo' WHERE name='肝功能10项' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=115, insurance_price=67, item_type='combo' WHERE name='肝功能12项' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=245, insurance_price=144,item_type='combo' WHERE name='肝功能15项' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=255, insurance_price=150,item_type='combo' WHERE name='肝功能16项' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=355, insurance_price=208,item_type='combo' WHERE name='肝功全套' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=20,  insurance_price=10, item_type='combo' WHERE name='肾功能2项' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=35,  insurance_price=20, item_type='combo' WHERE name='肾功能3项' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=95,  insurance_price=55, item_type='combo' WHERE name='肾功能4项' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=175, insurance_price=102,item_type='combo' WHERE name='肾功能5项' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=205, insurance_price=120,item_type='combo' WHERE name='肾功能6项' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=255, insurance_price=150,item_type='combo' WHERE name='肾功能7项' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=10,  insurance_price=5,  item_type='item'  WHERE name='空腹血糖' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=20,  insurance_price=5,  item_type='item'  WHERE name='餐后2h血糖' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=100, insurance_price=17, item_type='item'  WHERE name='糖化血红蛋白' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=30,  insurance_price=17, item_type='combo' WHERE name='血脂2项' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=25,  insurance_price=15, item_type='item'  WHERE name='高密度胆固醇' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=25,  insurance_price=15, item_type='item'  WHERE name='低密度胆固醇' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=80,  insurance_price=47, item_type='combo' WHERE name='血脂4项' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=150, insurance_price=85, item_type='combo' WHERE name='血脂5项' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=150, insurance_price=85, item_type='combo' WHERE name='血脂6项' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=220, insurance_price=129,item_type='combo' WHERE name='血脂全套（7项）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=50,  insurance_price=30, item_type='item'  WHERE name='α-1微肾岩藻糖（AFU）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=30,  insurance_price=15, item_type='item'  WHERE name='尿微量白蛋白(MALB)（尿）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=45,  insurance_price=25, item_type='item'  WHERE name='N-β-葡萄糖酐酶(NAG)（尿）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=80,  insurance_price=30, item_type='item'  WHERE name='超敏C反应蛋白（CRP）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=60,  insurance_price=30, item_type='item'  WHERE name='β2-微球蛋白(β2-MG)' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=85,  insurance_price=50, item_type='item'  WHERE name='胱抑素C(CYC)' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=205, insurance_price=120,item_type='item'  WHERE name='同型半胱氨酸(HCY)' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=30,  insurance_price=30, item_type='item'  WHERE name='前白蛋白(PA)' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=30,  insurance_price=18, item_type='item'  WHERE name='胆碱酯酶' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=85,  insurance_price=50, item_type='item'  WHERE name='D-二聚体(DD)' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=85,  insurance_price=50, item_type='combo' WHERE name='心肌酶谱测定（3项）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=95,  insurance_price=55, item_type='combo' WHERE name='心肌酶谱测定（4项）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=50,  insurance_price=30, item_type='item'  WHERE name='类风湿因子测定' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=50,  insurance_price=30, item_type='item'  WHERE name='抗链球菌溶血素O（ASO）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=200, insurance_price=117,item_type='combo' WHERE name='类风湿因子、血沉、抗"O"、超敏CRP' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=180, insurance_price=105,item_type='combo' WHERE name='类风湿因子、抗"O"、超敏CRP' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=340, insurance_price=200,item_type='item'  WHERE name='胃蛋白酶原I/II（PG）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=50,  insurance_price=20, item_type='item'  WHERE name='胃幽门螺杆菌抗体' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=1385,insurance_price=814,item_type='combo' WHERE name='生化全套' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=25,  insurance_price=15, item_type='item'  WHERE name='总胆汁酸(TBA)' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=35,  insurance_price=30, item_type='item'  WHERE name='肌酸激酶同工酶（CK-MB）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=35,  insurance_price=20, item_type='item'  WHERE name='谷胱甘肽还原酶(GR)' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=10,  insurance_price=5,  item_type='item'  WHERE name='乳酸脱氢酶（LDH）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=25,  insurance_price=15, item_type='item'  WHERE name='乳酸脱氢酶同工酶（LDH-1）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=15,  insurance_price=15, item_type='item'  WHERE name='肌酸激酶（CK）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=55,  insurance_price=32, item_type='item'  WHERE name='促甲状腺素（TSH）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=55,  insurance_price=32, item_type='item'  WHERE name='游离三碘甲状原氨酸（FT3）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=55,  insurance_price=32, item_type='item'  WHERE name='游离甲状腺素（FT4）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=45,  insurance_price=25, item_type='item'  WHERE name='甲状素（T4）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=45,  insurance_price=25, item_type='item'  WHERE name='三碘甲状原氨酸（T3）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=35,  insurance_price=20, item_type='item'  WHERE name='载脂蛋白A1(APO-A1)' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=35,  insurance_price=20, item_type='item'  WHERE name='脂蛋白B(APO-B)' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=35,  insurance_price=20, item_type='item'  WHERE name='脂联素(ADPN)' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=85,  insurance_price=50, item_type='item'  WHERE name='小而密低密度蛋白胆固醇（SdLDL-C）（外）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=60,  insurance_price=35, item_type='item'  WHERE name='脂蛋白相关磷脂酶A2(LP-PLA2)（外）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=460, insurance_price=270,item_type='item'  WHERE name='胸苷激酶1(TK1)（外）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=440, insurance_price=260,item_type='item'  WHERE name='抗缪勒管激素（外）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=170, insurance_price=100,item_type='item'  WHERE name='25-羟基维生素D（总）（外）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=170, insurance_price=100,item_type='item'  WHERE name='25-羟基维生素D(D2/D3)（外）' AND category='化验' LIMIT 1;

-- ========== 项目名称列 ==========
UPDATE booking_checkup_items SET default_price=60,  insurance_price=30, item_type='item'  WHERE name='EB病毒早期抗原IgA抗体（EA-IgA）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=60,  insurance_price=30, item_type='item'  WHERE name='EB病毒壳抗原IgA抗体（EB-VCA-IgA）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=100, insurance_price=40, item_type='item'  WHERE name='EB病毒壳抗原IgM抗体' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=70,  insurance_price=40, item_type='item'  WHERE name='C-肽（C-P）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=110, insurance_price=35, item_type='item'  WHERE name='血清肌红蛋白测定（MYO）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=205, insurance_price=120,item_type='item'  WHERE name='血清肌钙蛋白（外）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=205, insurance_price=120,item_type='item'  WHERE name='血清肌钙蛋白T(超敏肌钙蛋白T:TNT-HS)' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=55,  insurance_price=32, item_type='item'  WHERE name='B型钠尿肽前体（PRO-BNP）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=55,  insurance_price=32, item_type='item'  WHERE name='促甲状腺激素受体抗体（TP-Ab）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=50,  insurance_price=30, item_type='item'  WHERE name='恶性肿瘤特异性生长因子（TSGF）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=50,  insurance_price=30, item_type='item'  WHERE name='梅毒筛查（Anti-TP）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=100, insurance_price=50, item_type='item'  WHERE name='艾滋病筛查（Anti-HIV）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=255, insurance_price=150,item_type='item'  WHERE name='TCT（液基薄层细胞）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=270, insurance_price=160,item_type='item'  WHERE name='人乳头瘤病毒（HPV16/18）定量' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=510, insurance_price=300,item_type='item'  WHERE name='人乳头瘤病毒（HPV-23）定性' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=360, insurance_price=208,item_type='item'  WHERE name='激素水平测定（男/女）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=545, insurance_price=332,item_type='item'  WHERE name='过敏源检测（混合16项）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=960, insurance_price=560,item_type='item'  WHERE name='过敏原检测（混合28项）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=70,  insurance_price=40, item_type='item'  WHERE name='胃泌素-17' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=100, insurance_price=60, item_type='combo' WHERE name='免疫球蛋白三项（IgA,IgM,IgG）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=305, insurance_price=180,item_type='combo' WHERE name='肝纤维化四项（HA，PC-III，IV-C，Ln）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=50,  insurance_price=30, item_type='item'  WHERE name='电解质检测6项：钾（K）钠（Na）氯（Cl）钙（Ca）磷（P）镁（mg）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=270, insurance_price=160,item_type='combo' WHERE name='微量元素检测6项（铅、镉、铁、钙、锌、铁）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=325, insurance_price=190,item_type='combo' WHERE name='微量元素检测7项（铅、铜、镁、锰、钙、锌、铁）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=95,  insurance_price=55, item_type='combo' WHERE name='凝血四项' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=70,  insurance_price=40, item_type='item'  WHERE name='丙型肝炎病毒抗体（IgG）' AND category='化验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=30,  insurance_price=12, item_type='item'  WHERE name='甲型肝炎病毒抗体（IgM）' AND category='化验' LIMIT 1;

-- ========== 第二张表（一般检查 / 内科 / 功能 / 影像） ==========
UPDATE booking_checkup_items SET default_price=25,  insurance_price=14, item_type='item', category='一般检查' WHERE name='一般检查' AND category LIKE '%检查%' LIMIT 1;
UPDATE booking_checkup_items SET default_price=25,  insurance_price=14, item_type='item', category='一般检查' WHERE name='内科' LIMIT 1;
UPDATE booking_checkup_items SET default_price=25,  insurance_price=14, item_type='item', category='一般检查' WHERE name='外科（男、女）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=30,  insurance_price=14, item_type='item', category='一般检查' WHERE name='眼科' LIMIT 1;
UPDATE booking_checkup_items SET default_price=20,  insurance_price=10, item_type='item', category='一般检查' WHERE name='眼压' LIMIT 1;
UPDATE booking_checkup_items SET default_price=40,  insurance_price=8,  item_type='item', category='一般检查' WHERE name='裂隙灯检查' LIMIT 1;
UPDATE booking_checkup_items SET default_price=30,  insurance_price=14, item_type='item', category='一般检查' WHERE name='耳鼻喉科' LIMIT 1;
UPDATE booking_checkup_items SET default_price=30,  insurance_price=14, item_type='item', category='一般检查' WHERE name='口腔科' LIMIT 1;
UPDATE booking_checkup_items SET default_price=25,  insurance_price=14, item_type='item', category='一般检查' WHERE name='妇科常规' LIMIT 1;
UPDATE booking_checkup_items SET default_price=35,  insurance_price=20, item_type='item', category='功能检查' WHERE name='心电图（12导常规）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=270, insurance_price=160,item_type='item', category='功能检查' WHERE name='24小时动态心电图' LIMIT 1;
UPDATE booking_checkup_items SET default_price=225, insurance_price=120,item_type='item', category='功能检查' WHERE name='24小时动态血压' LIMIT 1;
UPDATE booking_checkup_items SET default_price=60,  insurance_price=32, item_type='item', category='化验'       WHERE name='甲胎蛋白定量（AFP）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=60,  insurance_price=15, item_type='item', category='化验'       WHERE name='甲胎蛋白定性（CEA）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=25,  insurance_price=32, item_type='item', category='化验'       WHERE name='癌胚抗原定量（AFP）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=25,  insurance_price=15, item_type='item', category='化验'       WHERE name='癌胚抗原定性（CEA）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=110, insurance_price=55, item_type='item', category='化验'       WHERE name='糖类抗原199（CA199）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=110, insurance_price=55, item_type='item', category='化验'       WHERE name='糖类抗原724（CA724）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=110, insurance_price=55, item_type='item', category='化验'       WHERE name='糖类抗原153（CA153）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=110, insurance_price=55, item_type='item', category='化验'       WHERE name='糖类抗原125（CA125）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=170, insurance_price=100,item_type='item', category='化验'       WHERE name='非小细胞肺癌相关抗原（CA211）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=110, insurance_price=55, item_type='item', category='化验'       WHERE name='糖类抗原50（CA50）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=135, insurance_price=55, item_type='item', category='化验'       WHERE name='骨钙素（OST）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=170, insurance_price=80, item_type='item', category='化验'       WHERE name='人附睾蛋白（HE4）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=70,  insurance_price=40, item_type='item', category='化验'       WHERE name='胃泌素释放前体（proGRP）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=170, insurance_price=100,item_type='item', category='化验'       WHERE name='鳞状细胞癌相关抗体（SCC）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=120, insurance_price=55, item_type='item', category='化验'       WHERE name='糖类抗原242（CA242）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=110, insurance_price=64, item_type='item', category='化验'       WHERE name='神经元特异性烯醇化酶（NSE）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=110, insurance_price=64, item_type='item', category='化验'       WHERE name='总前列腺特异性抗原（T-PSA）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=110, insurance_price=64, item_type='item', category='化验'       WHERE name='游离前列腺特异性抗原（F-PSA）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=110, insurance_price=50, item_type='item', category='化验'       WHERE name='β-绒毛膜促性腺激素（β-HCG）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=100, insurance_price=40, item_type='item', category='化验'       WHERE name='铁蛋白（FER）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=100, insurance_price=32, item_type='item', category='化验'       WHERE name='血空腹胰岛素' LIMIT 1;
UPDATE booking_checkup_items SET default_price=220, insurance_price=128,item_type='combo',category='化验'       WHERE name='前列腺肿瘤两项筛选（PSA+FPSA）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=450, insurance_price=264,item_type='combo',category='化验'       WHERE name='肿瘤5项（男）/（女）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=570, insurance_price=335,item_type='combo',category='化验'       WHERE name='肿瘤6项（男）/（女）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=740, insurance_price=435,item_type='combo',category='化验'       WHERE name='蛋白芯片7项（男）/（女）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=1130,insurance_price=664,item_type='combo',category='化验'       WHERE name='蛋白芯片10项（男）/（女）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=1240,insurance_price=729,item_type='combo',category='化验'       WHERE name='肿瘤指标11项（男）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=1240,insurance_price=729,item_type='combo',category='化验'       WHERE name='肿瘤指标(女)11项（罗）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=1240,insurance_price=729,item_type='combo',category='化验'       WHERE name='肿瘤指标(女)11项（罗）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=1630,insurance_price=958,item_type='combo',category='化验'       WHERE name='肿瘤指标全套(男)15项（罗）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=1690,insurance_price=994,item_type='combo',category='化验'       WHERE name='肿瘤指标全套(女)15项（罗）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=110, insurance_price=64, item_type='item', category='化验'       WHERE name='甲状腺球蛋白（TG）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=100, insurance_price=60, item_type='item', category='化验'       WHERE name='抗甲状腺球蛋白抗体（TG-Ab）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=100, insurance_price=60, item_type='item', category='化验'       WHERE name='抗甲状腺过氧化物酶抗体（TPO-Ab）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=165, insurance_price=96, item_type='combo',category='化验'       WHERE name='甲状腺功能检查3项' LIMIT 1;
UPDATE booking_checkup_items SET default_price=250, insurance_price=156,item_type='combo',category='化验'       WHERE name='甲状腺功能检查5项' LIMIT 1;
UPDATE booking_checkup_items SET default_price=375, insurance_price=220,item_type='combo',category='化验'       WHERE name='甲状腺功能检查5项（新）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=475, insurance_price=280,item_type='combo',category='化验'       WHERE name='甲状腺功能检查6项（新）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=560, insurance_price=330,item_type='combo',category='化验'       WHERE name='甲状腺功能检查8项（新）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=10,  insurance_price=5,  item_type='item', category='化验'       WHERE name='尿素氮（BUN）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=15,  insurance_price=10, item_type='item', category='化验'       WHERE name='尿酸（UA）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=15,  insurance_price=8,  item_type='item', category='化验'       WHERE name='肌酐（CRE）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=10,  insurance_price=5,  item_type='item', category='化验'       WHERE name='总胆固醇(TCH)' LIMIT 1;
UPDATE booking_checkup_items SET default_price=20,  insurance_price=10, item_type='item', category='化验'       WHERE name='甘油三脂(TG)' LIMIT 1;
UPDATE booking_checkup_items SET default_price=10,  insurance_price=5,  item_type='item', category='化验'       WHERE name='丙氨酸氨基转移酶(ALT)' LIMIT 1;
UPDATE booking_checkup_items SET default_price=70,  insurance_price=40, item_type='item', category='化验'       WHERE name='脂蛋白a(Lpa)' LIMIT 1;
UPDATE booking_checkup_items SET default_price=10,  insurance_price=5,  item_type='item', category='化验'       WHERE name='天门冬氨酸氨基转移酶(AST)' LIMIT 1;
UPDATE booking_checkup_items SET default_price=10,  insurance_price=5,  item_type='item', category='化验'       WHERE name='γ-谷氨酰转移酶(GGT)' LIMIT 1;
UPDATE booking_checkup_items SET default_price=10,  insurance_price=5,  item_type='item', category='化验'       WHERE name='总蛋白（TP）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=10,  insurance_price=5,  item_type='item', category='化验'       WHERE name='总胆红素(TBIL)' LIMIT 1;
UPDATE booking_checkup_items SET default_price=10,  insurance_price=5,  item_type='item', category='化验'       WHERE name='直接胆红素(DBIL)' LIMIT 1;
UPDATE booking_checkup_items SET default_price=10,  insurance_price=5,  item_type='item', category='化验'       WHERE name='碱性磷酸酶（ALP）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=10,  insurance_price=5,  item_type='item', category='化验'       WHERE name='白蛋白(ALB)' LIMIT 1;
UPDATE booking_checkup_items SET default_price=10,  insurance_price=5,  item_type='item', category='化验'       WHERE name='球蛋白(GLB)' LIMIT 1;
UPDATE booking_checkup_items SET default_price=10,  insurance_price=5,  item_type='item', category='化验'       WHERE name='白球比例(A/G)' LIMIT 1;
UPDATE booking_checkup_items SET default_price=85,  insurance_price=50, item_type='item', category='化验'       WHERE name='叶酸(外)' LIMIT 1;
UPDATE booking_checkup_items SET default_price=510, insurance_price=300,item_type='item', category='化验'       WHERE name='血管内皮生长因子（VEGF）（外）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=815, insurance_price=480,item_type='item', category='化验'       WHERE name='肺癌SHOX2+RASSF1A+PTGER4基因甲基化检测(外）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=1325,insurance_price=780,item_type='item', category='化验'       WHERE name='Septin9肠癌基因检测（外）' LIMIT 1;
UPDATE booking_checkup_items SET default_price='790',insurance_price=400,item_type='item', category='化验'       WHERE name='RNF180/Septin9基因甲基化（胃癌）早筛和辅助诊断检测（外）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=680, insurance_price=400,item_type='item', category='化验'       WHERE name='Reprimo/SDC2/TCF4胃癌三基因甲基化（外）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=79,  insurance_price=460,item_type='item', category='化验'       WHERE name='淀粉酶测定（外）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=25,  insurance_price=15, item_type='item', category='化验'       WHERE name='纤维蛋白原（外）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=85,  insurance_price=50, item_type='item', category='化验'       WHERE name='降钙素（外）' LIMIT 1;

-- ========== 影像 ==========
UPDATE booking_checkup_items SET default_price=170, insurance_price=100,item_type='item', category='影像' WHERE name='彩超-腹部' LIMIT 1;
UPDATE booking_checkup_items SET default_price=100, insurance_price=60, item_type='item', category='影像' WHERE name='彩超-前列腺' LIMIT 1;
UPDATE booking_checkup_items SET default_price=100, insurance_price=60, item_type='item', category='影像' WHERE name='彩超-盆腔' LIMIT 1;
UPDATE booking_checkup_items SET default_price=100, insurance_price=60, item_type='item', category='影像' WHERE name='彩超-乳腺' LIMIT 1;
UPDATE booking_checkup_items SET default_price=100, insurance_price=60, item_type='item', category='影像' WHERE name='彩超-膀胱' LIMIT 1;
UPDATE booking_checkup_items SET default_price=100, insurance_price=60, item_type='item', category='影像' WHERE name='阴超' LIMIT 1;
UPDATE booking_checkup_items SET default_price=300, insurance_price=130,item_type='item', category='影像' WHERE name='彩超-心脏' LIMIT 1;
UPDATE booking_checkup_items SET default_price=100, insurance_price=60, item_type='item', category='影像' WHERE name='彩超-甲状腺' LIMIT 1;
UPDATE booking_checkup_items SET default_price=340, insurance_price=200,item_type='item', category='影像' WHERE name='彩超-颈动脉' LIMIT 1;
UPDATE booking_checkup_items SET default_price=170, insurance_price=100,item_type='item', category='影像' WHERE name='数字DR摄片/部位' LIMIT 1;
UPDATE booking_checkup_items SET default_price=120, insurance_price=10, item_type='item', category='影像' WHERE name='出片费（DR+CT）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=120, insurance_price=170,item_type='item', category='影像' WHERE name='CT部位（不含片）' LIMIT 1;
UPDATE booking_checkup_items SET default_price=120, insurance_price=70, item_type='item', category='影像' WHERE name='CT动态分析' LIMIT 1;
UPDATE booking_checkup_items SET default_price=120, insurance_price=70, item_type='item', category='影像' WHERE name='人体成分分析' LIMIT 1;
UPDATE booking_checkup_items SET default_price=205, insurance_price=120,item_type='item', category='影像' WHERE name='动脉硬化检测' LIMIT 1;
UPDATE booking_checkup_items SET default_price=120, insurance_price=70, item_type='item', category='影像' WHERE name='肺功能检查' LIMIT 1;
UPDATE booking_checkup_items SET default_price=170, insurance_price=20, item_type='item', category='影像' WHERE name='骨密度' LIMIT 1;
UPDATE booking_checkup_items SET default_price=170, insurance_price=60, item_type='item', category='影像' WHERE name='经颅多普勒TCD' LIMIT 1;
UPDATE booking_checkup_items SET default_price=140, insurance_price=100,item_type='item', category='功能检查' WHERE name='C14呼气试验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=160, insurance_price=110,item_type='item', category='功能检查' WHERE name='C13呼气试验' LIMIT 1;
UPDATE booking_checkup_items SET default_price=160, insurance_price=100,item_type='item', category='功能检查' WHERE name='电子阴道镜' LIMIT 1;
UPDATE booking_checkup_items SET default_price=270, insurance_price=160,item_type='item', category='影像' WHERE name='电子直乙肠镜' LIMIT 1;

-- ============================================================
-- STEP 3: 回填 booking_package_items：item_price / item_name_snapshot / insurance_price_snapshot
--          （按 item_id 关联 booking_checkup_items 回填，NULL/空/0 才填，保留用户手动设置过的）
-- ============================================================
UPDATE booking_package_items AS pi
INNER JOIN booking_checkup_items AS ci ON ci.id = pi.item_id
SET pi.item_price = CASE WHEN (pi.item_price IS NULL OR pi.item_price = 0) THEN ci.default_price ELSE pi.item_price END,
    pi.item_name_snapshot = CASE WHEN (pi.item_name_snapshot IS NULL OR pi.item_name_snapshot = '') THEN ci.name ELSE pi.item_name_snapshot END,
    pi.insurance_price_snapshot = CASE WHEN (pi.insurance_price_snapshot IS NULL OR pi.insurance_price_snapshot = 0) THEN ci.insurance_price ELSE pi.insurance_price_snapshot END
WHERE 1 = 1;

-- ============================================================
-- STEP 4: 回填套餐 code 为 null/空的（用 id 前8位）
-- ============================================================
UPDATE booking_packages SET code = CONCAT('PKG', UPPER(SUBSTRING(id, 1, 8))) WHERE code IS NULL OR code = '';

-- ============================================================
-- STEP 5: 回填体检项目 code（空的按 sort_order/name 生成 T00001~ 保证编码）
-- ============================================================
UPDATE booking_checkup_items SET code = CONCAT('T', LPAD(CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(ROW_NUMBER() OVER (ORDER BY sort_order, name), ' ', 1), ' ', -1) AS UNSIGNED), 5, '0'))
WHERE code IS NULL OR code = '';
