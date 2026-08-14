-- 068: 体检项目字段扩展 + 全量导入新数据
-- 执行时间: 2026-08-14

-- 1. 扩展字段: booking_checkup_items 增加 insurance_price (医保价格)
SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE booking_checkup_items ADD COLUMN insurance_price DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT ''医保价格,仅展示用'' AFTER default_price',
  'SELECT ''insurance_price already exists in booking_checkup_items''')
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_checkup_items' AND COLUMN_NAME = 'insurance_price');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. 扩展字段: booking_package_items 增加 insurance_price_snapshot (快照)
SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE booking_package_items ADD COLUMN insurance_price_snapshot DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT ''医保价格快照'' AFTER price_snapshot',
  'SELECT ''insurance_price_snapshot already exists in booking_package_items''')
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_package_items' AND COLUMN_NAME = 'insurance_price_snapshot');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. 清空旧数据: 先清子项关联, 再清主表
DELETE FROM booking_item_sub_items WHERE 1 = 1;
DELETE FROM booking_package_items WHERE 1 = 1;
DELETE FROM booking_checkup_items WHERE 1 = 1;

-- ============================================================
-- 4. 导入体检项目数据 (两张表合并)
-- 字段映射:
--   项目名称 -> name
--   医保价格 -> insurance_price
--   2023最新定价 -> default_price
-- 自动分类规则 (无法匹配归 化验):
--   专科: 一般检查/内科/外科/眼科/眼压/裂隙灯/耳鼻喉科/口腔科/妇科常规/骨密度/阴道镜/电子直乙肠镜
--   功能检查: 心电图/动态心电图/动态血压/动脉硬化/肺功能/经颅多普勒/TCD/C13/C14/人体成分/气道阻力
--   影像: 彩超-/X光/CT/MRI/数字DR/出片费/核磁共振/钼靶
--   化验: 其余
-- item_type 规则:
--   combo: 名称包含 "全套"/"套餐"/"生化全套"/"项(男"/"项(女"/"项（男"/"项（女"/"项 (男"/"项 (女"/"组合"
--          或 匹配 "肝功能[0-9]+项"/"肾功能[0-9]+项"/"血脂[0-9]+项"/"肿瘤[0-9]+项"/"甲状腺功能检查[0-9]+项"/"肿瘤全套"/"蛋白芯片[0-9]+项"/"彩超-"/"电解质检测.*项"/"微量元素检测.*项"
--   其余 -> item
-- 先创建临时表辅助
-- ============================================================

CREATE TEMPORARY TABLE _tmp_checkup_items (
  name VARCHAR(200) NOT NULL,
  insurance_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  default_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  raw_category VARCHAR(20) DEFAULT NULL
);

-- ---------- 第1张表（体检套餐表-1） ----------
INSERT INTO _tmp_checkup_items (name, insurance_price, default_price) VALUES
('血常规', 20, 35),
('血型（ABO、RH）', 50, 85),
('血沉', 10, 20),
('尿常规', 10, 20),
('尿沉渣', 20, 35),
('尿常规+尿沉渣', 30, 50),
('大便隐血试验', 10, 20),
('白带常规', 10, 20),
('宫颈脱落细胞检查', 70, 120),
('血流变', 56, 95),
('谷丙转氨酶', 5, 10),
('肝功能2项', 10, 20),
('肝功能3项', 17, 30),
('肝功能4项', 23, 40),
('肝功能5项', 25, 50),
('肝功能6项', 30, 60),
('肝功能10项', 42, 80),
('肝功能12项', 67, 115),
('肝功能15项', 144, 245),
('肝功能16项', 150, 255),
('肝功全套', 208, 355),
('肾功能2项', 10, 20),
('肾功能3项', 20, 35),
('肾功能4项', 55, 95),
('肾功能5项', 102, 178),
('肾功能6项', 120, 205),
('肾功能7项', 150, 255),
('空腹血糖', 5, 10),
('餐后2h血糖', 5, 20),
('糖化血红蛋白', 17, 100),
('血脂2项', 58, 30),
('高密度胆固醇', 15, 25),
('低密度胆固醇', 15, 80),
('血脂4项', 47, 80),
('血脂5项', 85, 150),
('血脂6项', 85, 150),
('血脂全套（7项）', 129, 220),
('α-L糖苷苷藻酶（AFU）', 30, 50),
('尿微量白蛋白(MALB)（尿）', 15, 30),
('N-β-葡萄糖苷酶(NAG)（尿）', 25, 45),
('超敏C反应蛋白（CRP）', 30, 80),
('β2-微球蛋白(β2-MG)', 30, 60),
('胱抑素C(CYC)', 50, 85),
('同型半胱氨酸(HCY)', 120, 205),
('前白蛋白(PA)', 30, 50),
('胆碱酯酶(CHE)', 18, 30),
('D-二聚体(DD)', 50, 85),
('心肌酶谱测定（3项）', 50, 85),
('心肌酶谱测定（4项）', 55, 95),
('类风湿因子测定（ASO）', 30, 50),
('抗链球菌溶血素O（ASO）', 30, 50),
('类风湿因子、血沉、抗"O"、超敏CRP', 117, 200),
('类风湿因子、抗"O"、超敏CRP', 105, 180),
('胃蛋白酶原I/II（I/II）(PG)', 200, 340),
('胃幽门螺杆菌抗体', 20, 50),
('生化全套', 814, 1385),
('总胆汁酸(TBA)', 15, 25),
('肌酸激酶同工酶（CK-MB）', 30, 50),
('谷胱甘肽还原酶(GR)', 20, 35),
('乳酸脱氢酶（LDH）', 5, 10),
('乳酸脱氢酶同工酶（LDH-1）', 15, 25),
('肌酸激酶（CK）', 15, 25),
('促甲状腺素（TSH）', 32, 55),
('游离三碘甲状原氨酸（FT3）', 32, 55),
('游离甲状腺素（FT4）', 32, 55),
('甲状腺素（T4）', 25, 45),
('三碘甲状原氨酸（T3）', 25, 45),
('载脂蛋白A1(APO-A1)', 20, 35),
('载脂蛋白B(APO-B)', 20, 35),
('脂联素(ADPN)', 50, 35),
('小而密低密度脂蛋白胆固醇（SdLDL-C）（外）', 20, 85),
('脂蛋白相关磷脂酶A2(LP-PLA2)（外）', 35, 60),
('胸苷激酶1(TK)（外）', 270, 460),
('抗缪勒管激素（外）', 260, 440),
('25-羟基维生素D（总）（外）', 100, 170),
('25-羟基维生素D(2023)（外）', 100, 170);

-- ---------- 第1张表第2部分 ----------
INSERT INTO _tmp_checkup_items (name, insurance_price, default_price) VALUES
('EB病毒早期抗原IgA抗体（EA-IgA）', 60, 60),
('EB病毒壳抗原IgA抗体（EB-VCA-IgM）', 30, 60),
('EB病毒壳抗原IgM抗体（EB-VCA-IgA）', 40, 100),
('C-肽（C-P）', 30, 70),
('血清肌红蛋白测定（MYO）', 35, 110),
('血清肌钙蛋白I（外）', 120, 205),
('血清肌钙蛋白T(超敏肌钙蛋白T:NT-HS)', 120, 205),
('B型钠尿肽前体（PRO-BNP）', 226, 385),
('促甲状腺激素受体抗体（TP-Ab）', 32, 55),
('恶性肿瘤特异性生长因子（TSGF）', 50, 50),
('梅毒筛查（Anti-TP）', 20, 50),
('艾滋病筛查（Anti-HIV）', 50, 100),
('TCT（液基薄层细胞）', 150, 255),
('人乳头瘤病毒（HPV16/18）定量', 160, 270),
('人乳头瘤病毒（HPV-23）定性', 300, 510),
('激素水平测定（男/女）', 208, 360),
('过敏原检测（混合16项）', 330, 560),
('过敏原检测（混合28项）', 560, 960),
('过敏原检测（混合28项）', 560, 960),
('胃泌素-17', 40, 70),
('免疫球蛋白三项（IgA、IgM、gG）', 60, 100),
('肝纤维化四项（HA，PC-III，IV-C，Ln）', 180, 305),
('电解质检测6项：钾（K）钠（Na）氯（Cl）钙（Ca）磷（P）镁（mg）', 30, 50),
('微量元素检测6项（铅、镉、铁、钙、锌、铁）', 160, 270),
('微量元素检测7项（铅、铜、镁、锰、钙、锌、铁）', 190, 325),
('凝血四项', 55, 95),
('丙型肝炎病毒抗体（IgG）', 40, 70),
('戊型肝炎病毒抗体（IgM）', 12, 30);

-- ---------- 第2张表 ----------
INSERT INTO _tmp_checkup_items (name, insurance_price, default_price) VALUES
('一般检查', 14, 25),
('内科', 14, 25),
('外科（男、女）', 14, 25),
('眼科', 14, 30),
('眼压', 10, 20),
('裂隙灯检查', 8, 40),
('耳鼻喉科', 14, 30),
('口腔科', 14, 30),
('妇科常规', 14, 25),
('心电图（12导常规）', 20, 35),
('24小时动态心电图', 160, 270),
('24小时动态血压', 120, 225),
('甲胎蛋白定量（AFP）', 32, 60),
('甲胎蛋白定性（CEA）', 15, 25),
('癌胚抗原定量（AFP）', 32, 60),
('癌胚抗原定性（CEA）', 15, 25),
('糖类抗原199（CA199）', 55, 110),
('糖类抗原724（CA724）', 55, 110),
('糖类抗原153（CA153）', 55, 110),
('糖类抗原125（CA125）', 55, 110),
('非小细胞肺癌相关抗原（CA211）', 100, 170),
('糖类抗原50（CA50）', 55, 135),
('骨钙素（OST）', 80, 135),
('人附睾蛋白1（HE4）', 100, 170),
('胃泌素释放前体（proGRP）', 40, 70),
('鳞状细胞癌相关抗原（SCC）', 100, 170),
('糖类抗原242（CA242）', 55, 120),
('神经元特异性烯醇化酶（NSE）', 64, 110),
('总前列腺特异性抗原（T-PSA）', 64, 110),
('游离前列腺特异性抗原（F-PSA）', 64, 110),
('β-绒毛膜促性腺激素（β-HCG）', 50, 110),
('铁蛋白（FERR）', 40, 100),
('血空腹胰岛素', 32, 100),
('前列腺肿瘤两项筛选（PSA+FPSAs）', 128, 220),
('肿瘤5项（男）/（女）', 264, 450),
('肿瘤6项（男）/（女）', 335, 570),
('蛋白芯片7项（男）/（女）', 435, 740),
('蛋白芯片10项（女）', 664, 1130),
('蛋白芯片11项（男）/（女）', 729, 1240),
('肿瘤指标(男)11项（罗）', 729, 1240),
('肿瘤指标(女)11项（罗）', 729, 1240),
('肿瘤指标全套(男)15项（罗）', 958, 1630),
('肿瘤指标全套(女)15项（罗）', 994, 1690),
('甲状腺球蛋白（TG）', 64, 110),
('抗甲状腺球蛋白抗体（TG-Ab）', 60, 100),
('抗甲状腺过氧化物酶抗体（TPO-Ab）', 60, 100),
('甲状腺功能检查3项', 96, 165),
('甲状腺功能检查5项', 156, 250),
('甲状腺功能检查5项（新）', 220, 375),
('甲状腺功能检查6项（新）', 280, 475),
('甲状腺功能检查8项（新）', 330, 560),
('尿素氮（BUN）', 5, 10),
('尿酸(UA)', 5, 15),
('肌酐(CRE)', 8, 10),
('总胆固醇(TCH)', 5, 15),
('甘油三脂(TG)', 10, 20),
('丙氨酸氨基转移酶(ALT)', 5, 10),
('脂蛋白A(Lpa)', 40, 70),
('天门冬氨酸氨基转移酶(AST)', 5, 10),
('γ-谷氨酰转移酶(GGT)', 5, 10),
('总蛋白（TP）', 5, 10),
('总胆红素(TBIL)', 5, 10),
('直接胆红素(DBIL)', 5, 10),
('碱性磷酸酶（ALP）', 5, 10),
('白蛋白(ALB)', 10, 10),
('球蛋白(GLB)', 10, 10),
('白球比例(A/G)', 10, 10),
('叶酸(外)', 50, 85),
('血管内皮生长因子（VEGF）（外）', 300, 510),
('肺癌SHOX2+RASSF1A+PTGER4基因甲基化检测（外）', 480, 815),
('Septine9肠癌基因检测（外）', 780, 1325),
('RNF180/Septin9基因甲基化（胃癌）早筛和辅助诊断检测（外）', 400, 790),
('Reprimo/SDC2/TCF4胃癌三基因甲基化（外）', 460, 680),
('淀粉酶测定（外）', 15, 25),
('纤维蛋白原（外）', 15, 20),
('降钙素（外）', 50, 85);

-- ---------- 第2张表影像/功能检查部分 ----------
INSERT INTO _tmp_checkup_items (name, insurance_price, default_price) VALUES
('彩超-腹部', 100, 170),
('彩超-前列腺', 60, 100),
('彩超-盆腔', 60, 100),
('彩超-乳腺', 60, 100),
('彩超-膀胱', 60, 100),
('阴超', 60, 100),
('彩超-心脏', 130, 300),
('彩超-甲状腺', 60, 100),
('彩超-颈动脉', 200, 340),
('数字DR摄片/部位', 100, 170),
('出片费（DR-CT）', 10, 20),
('CT部位（不含片）', 170, 120),
('CT动态分析', 70, 120),
('人体成分分析', 120, 100),
('动脉硬化检测', 120, 205),
('肺功能检查', 70, 120),
('骨密度', 20, 170),
('经颅多普勒TCD', 60, 100),
('C14呼气试验', 100, 140),
('C13呼气试验', 110, 160),
('电子阴道镜', 100, 170),
('电子直乙肠镜', 160, 270);

-- ============================================================
-- 5. 从临时表插入正式表，按规则设置 category / item_type / 编码
-- ============================================================

INSERT INTO booking_checkup_items (
  id, code, name, item_type, category, description,
  default_price, insurance_price, unit, status, sort_order,
  created_at, updated_at
)
SELECT
  UUID() AS id,
  CONCAT('T', LPAD(@num := @num + 1, 5, '0')) AS code,
  t.name,
  CASE
    WHEN t.name REGEXP '全套|套餐|生化全套|组合' THEN 'combo'
    WHEN t.name REGEXP '项\\(男|项\\(女|项（男|项（女|项 \\(男|项 \\(女' THEN 'combo'
    WHEN t.name REGEXP '肝功能[0-9]+项|肾功能[0-9]+项|血脂[0-9]+项|肿瘤[0-9]+项|肿瘤全套|蛋白芯片[0-9]+项|甲状腺功能检查[0-9]+项|电解质检测.*项|微量元素检测.*项' THEN 'combo'
    WHEN t.name LIKE '彩超-%' THEN 'combo'
    WHEN t.name IN (
      '尿常规+尿沉渣','血脂全套（7项）','生化全套',
      '类风湿因子、血沉、抗"O"、超敏CRP',
      '类风湿因子、抗"O"、超敏CRP',
      '胃蛋白酶原I/II（I/II）(PG)',
      '前列腺肿瘤两项筛选（PSA+FPSAs）'
    ) THEN 'combo'
    ELSE 'item'
  END AS item_type,
  CASE
    WHEN t.name REGEXP '一般检查|内科|外科|眼科|眼压|裂隙灯|耳鼻喉科|口腔科|妇科常规|骨密度|电子阴道镜|电子直乙肠镜' THEN '专科'
    WHEN t.name REGEXP '心电图|动态心电图|动态血压|动脉硬化|肺功能|经颅多普勒|TCD|C13|C14|人体成分分析' THEN '功能检查'
    WHEN t.name REGEXP '彩超-|X光|CT|数字DR|出片费|核磁共振|钼靶|阴道镜$|直乙肠镜' THEN '影像'
    ELSE '化验'
  END AS category,
  '' AS description,
  t.default_price,
  t.insurance_price,
  '次' AS unit,
  1 AS status,
  100 AS sort_order,
  NOW() AS created_at,
  NOW() AS updated_at
FROM _tmp_checkup_items t, (SELECT @num := 0) _v
ORDER BY category ASC, FIELD(item_type, 'combo', 'item'), t.insurance_price ASC;

-- 去重: 删除重复名称的记录 (保留 default_price 较大的)
DELETE t1 FROM booking_checkup_items t1
INNER JOIN booking_checkup_items t2
WHERE t1.name = t2.name AND t1.id > t2.id;

-- 清理临时表
DROP TEMPORARY TABLE IF EXISTS _tmp_checkup_items;
