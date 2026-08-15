-- ============================================================
-- 076: 紧急重建体检项目种子数据（booking_checkup_items 因误执行_DONE
--       文件里的 DELETE 被清空，本迁移按图片确认的定价+新分类7大类
--       重新 INSERT IGNORE 全量数据，code 按顺序生成 T00001~。
--       仅 INSERT，无 DELETE，幂等安全。
-- ============================================================

-- Step 1: 确保字段齐全
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

SET @add_unit_col = (SELECT IF(COUNT(*) = 0,
  "ALTER TABLE booking_checkup_items ADD COLUMN unit VARCHAR(20) NOT NULL DEFAULT '次' COMMENT '单位' AFTER insurance_price",
  'SELECT 1')
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_checkup_items' AND COLUMN_NAME = 'unit');
PREPARE stmt FROM @add_unit_col; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @add_item_type_col = (SELECT IF(COUNT(*) = 0,
  "ALTER TABLE booking_checkup_items ADD COLUMN item_type ENUM('item','combo') NOT NULL DEFAULT 'item' COMMENT '项目类型：item单项/combo组合'",
  'SELECT 1')
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_checkup_items' AND COLUMN_NAME = 'item_type');
PREPARE stmt FROM @add_item_type_col; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @add_description_col = (SELECT IF(COUNT(*) = 0,
  "ALTER TABLE booking_checkup_items ADD COLUMN description VARCHAR(500) NULL COMMENT '项目说明'",
  'SELECT 1')
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_checkup_items' AND COLUMN_NAME = 'description');
PREPARE stmt FROM @add_description_col; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @add_status_col = (SELECT IF(COUNT(*) = 0,
  "ALTER TABLE booking_checkup_items ADD COLUMN status TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1启用 0禁用'",
  'SELECT 1')
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_checkup_items' AND COLUMN_NAME = 'status');
PREPARE stmt FROM @add_status_col; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @add_sort_col = (SELECT IF(COUNT(*) = 0,
  "ALTER TABLE booking_checkup_items ADD COLUMN sort_order INT NOT NULL DEFAULT 100",
  'SELECT 1')
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_checkup_items' AND COLUMN_NAME = 'sort_order');
PREPARE stmt FROM @add_sort_col; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Step 2: 创建临时种子表，7大类分类（category_enum）
-- 分类顺序（控制 sort_order）：1体格检查 / 2实验室 / 3影像检查 / 4功能检查 / 5肿瘤筛查 / 6妇科专项 / 7特色加项
DROP TEMPORARY TABLE IF EXISTS _tmp_seed_items;
CREATE TEMPORARY TABLE _tmp_seed_items (
  rn INT AUTO_INCREMENT PRIMARY KEY,
  cat_sort INT NOT NULL,
  category VARCHAR(20) NOT NULL,
  name VARCHAR(200) NOT NULL,
  item_type ENUM('item','combo') NOT NULL DEFAULT 'item',
  default_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  insurance_price DECIMAL(10,2) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===== 1. 体格检查 =====
INSERT INTO _tmp_seed_items (cat_sort,category,name,item_type,default_price,insurance_price) VALUES
(1,'体格检查','一般检查(身高/体重/BMI)','item',25,14),
(1,'体格检查','内科','item',25,14),
(1,'体格检查','外科（男、女）','item',25,14),
(1,'体格检查','眼科','item',30,14),
(1,'体格检查','眼压','item',20,10),
(1,'体格检查','裂隙灯检查','item',40,8),
(1,'体格检查','耳鼻喉科','item',30,14),
(1,'体格检查','口腔科','item',30,14),
(1,'体格检查','妇科常规','item',25,14),

(1,'体格检查','血压','item',10,5),
(1,'体格检查','眼科检查','combo',50,30);

-- ===== 2. 实验室 =====
INSERT INTO _tmp_seed_items (cat_sort,category,name,item_type,default_price,insurance_price) VALUES
(2,'实验室','血常规(五分类)','item',35,20),
(2,'实验室','血型（ABO、RH）','item',85,50),
(2,'实验室','血沉','item',20,10),
(2,'实验室','尿常规','item',20,10),
(2,'实验室','尿沉渣','item',35,20),
(2,'实验室','尿常规+尿沉渣','combo',50,30),
(2,'实验室','大便隐血试验','item',20,10),
(2,'实验室','血流变','item',95,56),
(2,'实验室','谷丙转氨酶','item',10,5),
(2,'实验室','肝功能2项','combo',20,10),
(2,'实验室','肝功能3项','combo',30,17),
(2,'实验室','肝功能4项','combo',40,23),
(2,'实验室','肝功能5项','combo',50,25),
(2,'实验室','肝功能6项','combo',60,30),
(2,'实验室','肝功能10项','combo',80,42),
(2,'实验室','肝功能12项','combo',115,67),
(2,'实验室','肝功能15项','combo',245,144),
(2,'实验室','肝功能16项','combo',255,150),
(2,'实验室','肝功全套','combo',355,208),
(2,'实验室','肾功能2项','combo',20,10),
(2,'实验室','肾功能3项','combo',35,20),
(2,'实验室','肾功能4项','combo',95,55),
(2,'实验室','肾功能5项','combo',175,102),
(2,'实验室','肾功能6项','combo',205,120),
(2,'实验室','肾功能7项','combo',255,150),
(2,'实验室','空腹血糖','item',10,5),
(2,'实验室','餐后2h血糖','item',20,5),
(2,'实验室','糖化血红蛋白','item',100,17),
(2,'实验室','血脂2项','combo',30,17),
(2,'实验室','高密度胆固醇','item',25,15),
(2,'实验室','低密度胆固醇','item',25,15),
(2,'实验室','血脂4项','combo',80,47),
(2,'实验室','血脂5项','combo',150,85),
(2,'实验室','血脂6项','combo',150,85),
(2,'实验室','血脂全套（7项）','combo',220,129),
(2,'实验室','α-1微肾岩藻糖（AFU）','item',50,30),
(2,'实验室','尿微量白蛋白(MALB)（尿）','item',30,15),
(2,'实验室','N-β-葡萄糖酐酶(NAG)（尿）','item',45,25),
(2,'实验室','超敏C反应蛋白（CRP）','item',80,30),
(2,'实验室','β2-微球蛋白(β2-MG)','item',60,30),
(2,'实验室','胱抑素C(CYC)','item',85,50),
(2,'实验室','同型半胱氨酸(HCY)','item',205,120),
(2,'实验室','前白蛋白(PA)','item',30,30),
(2,'实验室','胆碱酯酶','item',30,18),
(2,'实验室','D-二聚体(DD)','item',85,50),
(2,'实验室','心肌酶谱测定（3项）','combo',85,50),
(2,'实验室','心肌酶谱测定（4项）','combo',95,55),
(2,'实验室','类风湿因子测定','item',50,30),
(2,'实验室','抗链球菌溶血素O（ASO）','item',50,30),
(2,'实验室','类风湿因子、血沉、抗"O"、超敏CRP','combo',200,117),
(2,'实验室','类风湿因子、抗"O"、超敏CRP','combo',180,105),
(2,'实验室','胃蛋白酶原I/II（PG）','item',340,200),
(2,'实验室','胃幽门螺杆菌抗体','item',50,20),
(2,'实验室','生化全套','combo',1385,814),
(2,'实验室','总胆汁酸(TBA)','item',25,15),
(2,'实验室','肌酸激酶同工酶（CK-MB）','item',35,30),
(2,'实验室','谷胱甘肽还原酶(GR)','item',35,20),
(2,'实验室','乳酸脱氢酶（LDH）','item',10,5),
(2,'实验室','乳酸脱氢酶同工酶（LDH-1）','item',25,15),
(2,'实验室','肌酸激酶（CK）','item',15,15),
(2,'实验室','促甲状腺素（TSH）','item',55,32),
(2,'实验室','游离三碘甲状原氨酸（FT3）','item',55,32),
(2,'实验室','游离甲状腺素（FT4）','item',55,32),
(2,'实验室','甲状素（T4）','item',45,25),
(2,'实验室','三碘甲状原氨酸（T3）','item',45,25),
(2,'实验室','载脂蛋白A1(APO-A1)','item',35,20),
(2,'实验室','脂蛋白B(APO-B)','item',35,20),
(2,'实验室','脂联素(ADPN)','item',35,20),
(2,'实验室','小而密低密度蛋白胆固醇（SdLDL-C）（外）','item',85,50),
(2,'实验室','脂蛋白相关磷脂酶A2(LP-PLA2)（外）','item',60,35),
(2,'实验室','EB病毒早期抗原IgA抗体（EA-IgA）','item',60,30),
(2,'实验室','EB病毒壳抗原IgA抗体（EB-VCA-IgA）','item',60,30),
(2,'实验室','EB病毒壳抗原IgM抗体','item',100,40),
(2,'实验室','C-肽（C-P）','item',70,40),
(2,'实验室','血清肌红蛋白测定（MYO）','item',110,35),
(2,'实验室','血清肌钙蛋白T(超敏肌钙蛋白T:TNT-HS)','item',205,120),
(2,'实验室','B型钠尿肽前体（PRO-BNP）','item',55,32),
(2,'实验室','促甲状腺激素受体抗体（TP-Ab）','item',55,32),
(2,'实验室','恶性肿瘤特异性生长因子（TSGF）','item',50,30),
(2,'实验室','梅毒筛查（Anti-TP）','item',50,30),
(2,'实验室','艾滋病筛查（Anti-HIV）','item',100,50),
(2,'实验室','TCT（液基薄层细胞）','item',255,150),
(2,'实验室','人乳头瘤病毒（HPV16/18）定量','item',270,160),
(2,'实验室','人乳头瘤病毒（HPV-23）定性','item',510,300),
(2,'实验室','激素水平测定（男/女）','item',360,208),
(2,'实验室','免疫球蛋白三项（IgA,IgM,IgG）','combo',100,60),
(2,'实验室','肝纤维化四项（HA，PC-III，IV-C，Ln）','combo',305,180),
(2,'实验室','电解质检测6项：钾（K）钠（Na）氯（Cl）钙（Ca）磷（P）镁（mg）','item',50,30),
(2,'实验室','微量元素检测6项（铅、镉、铁、钙、锌、铁）','combo',270,160),
(2,'实验室','微量元素检测7项（铅、铜、镁、锰、钙、锌、铁）','combo',325,190),
(2,'实验室','凝血四项','combo',95,55),
(2,'实验室','丙型肝炎病毒抗体（IgG）','item',70,40),
(2,'实验室','甲型肝炎病毒抗体（IgM）','item',30,12),
(2,'实验室','甲状腺球蛋白（TG）','item',110,64),
(2,'实验室','抗甲状腺球蛋白抗体（TG-Ab）','item',100,60),
(2,'实验室','抗甲状腺过氧化物酶抗体（TPO-Ab）','item',100,60),
(2,'实验室','甲状腺功能检查3项','combo',165,96),
(2,'实验室','甲状腺功能检查5项','combo',250,156),
(2,'实验室','甲状腺功能检查5项（新）','combo',375,220),
(2,'实验室','甲状腺功能检查6项（新）','combo',475,280),
(2,'实验室','甲状腺功能检查8项（新）','combo',560,330),
(2,'实验室','尿素氮（BUN）','item',10,5),
(2,'实验室','尿酸（UA）','item',15,10),
(2,'实验室','肌酐（CRE）','item',15,8),
(2,'实验室','总胆固醇(TCH)','item',10,5),
(2,'实验室','甘油三脂(TG)','item',20,10),
(2,'实验室','丙氨酸氨基转移酶(ALT)','item',10,5),
(2,'实验室','脂蛋白a(Lpa)','item',70,40),
(2,'实验室','天门冬氨酸氨基转移酶(AST)','item',10,5),
(2,'实验室','γ-谷氨酰转移酶(GGT)','item',10,5),
(2,'实验室','总蛋白（TP）','item',10,5),
(2,'实验室','总胆红素(TBIL)','item',10,5),
(2,'实验室','直接胆红素(DBIL)','item',10,5),
(2,'实验室','碱性磷酸酶（ALP）','item',10,5),
(2,'实验室','白蛋白(ALB)','item',10,5),
(2,'实验室','球蛋白(GLB)','item',10,5),
(2,'实验室','白球比例(A/G)','item',10,5),
(2,'实验室','叶酸(外)','item',85,50),
(2,'实验室','血空腹胰岛素','item',100,32),
(2,'实验室','铁蛋白（FER）','item',100,40),
(2,'实验室','胃泌素-17','item',70,40),
(2,'实验室','淀粉酶测定（外）','item',79,460),
(2,'实验室','纤维蛋白原（外）','item',25,15);

-- ===== 3. 影像检查 =====
INSERT INTO _tmp_seed_items (cat_sort,category,name,item_type,default_price,insurance_price) VALUES
(3,'影像检查','彩超-腹部','item',170,100),
(3,'影像检查','彩超-前列腺','item',100,60),
(3,'影像检查','彩超-盆腔','item',100,60),
(3,'影像检查','彩超-乳腺','item',100,60),
(3,'影像检查','彩超-膀胱','item',100,60),
(3,'影像检查','阴超','item',100,60),
(3,'影像检查','彩超-心脏','item',300,130),
(3,'影像检查','彩超-甲状腺','item',100,60),
(3,'影像检查','彩超-颈动脉','item',340,200),
(3,'影像检查','数字DR摄片/部位','item',170,100),
(3,'影像检查','出片费（DR+CT）','item',120,10),
(3,'影像检查','CT部位（不含片）','item',120,170),
(3,'影像检查','CT动态分析','item',120,70),
(3,'影像检查','电子直乙肠镜','item',270,160);

-- ===== 4. 功能检查 =====
INSERT INTO _tmp_seed_items (cat_sort,category,name,item_type,default_price,insurance_price) VALUES
(4,'功能检查','心电图（12导常规）','item',35,20),
(4,'功能检查','24小时动态心电图','item',270,160),
(4,'功能检查','24小时动态血压','item',225,120),
(4,'功能检查','人体成分分析','item',120,70),
(4,'功能检查','动脉硬化检测','item',205,120),
(4,'功能检查','肺功能检查','item',120,70),
(4,'功能检查','骨密度','item',170,20),
(4,'功能检查','经颅多普勒TCD','item',170,60),
(4,'功能检查','C14呼气试验','item',140,100),
(4,'功能检查','C13呼气试验','item',160,110),
(4,'功能检查','电子阴道镜','item',160,100);

-- ===== 5. 肿瘤筛查 =====
INSERT INTO _tmp_seed_items (cat_sort,category,name,item_type,default_price,insurance_price) VALUES
(5,'肿瘤筛查','甲胎蛋白定量（AFP）','item',60,32),
(5,'肿瘤筛查','甲胎蛋白定性','item',60,15),
(5,'肿瘤筛查','癌胚抗原定量（CEA）','item',25,32),
(5,'肿瘤筛查','癌胚抗原定性','item',25,15),
(5,'肿瘤筛查','糖类抗原199（CA199）','item',110,55),
(5,'肿瘤筛查','糖类抗原724（CA724）','item',110,55),
(5,'肿瘤筛查','糖类抗原153（CA153）','item',110,55),
(5,'肿瘤筛查','糖类抗原125（CA125）','item',110,55),
(5,'肿瘤筛查','非小细胞肺癌相关抗原（CYFRA211）','item',170,100),
(5,'肿瘤筛查','糖类抗原50（CA50）','item',110,55),
(5,'肿瘤筛查','骨钙素（OST）','item',135,55),
(5,'肿瘤筛查','人附睾蛋白（HE4）','item',170,80),
(5,'肿瘤筛查','胃泌素释放前体（proGRP）','item',70,40),
(5,'肿瘤筛查','鳞状细胞癌相关抗体（SCC）','item',170,100),
(5,'肿瘤筛查','糖类抗原242（CA242）','item',120,55),
(5,'肿瘤筛查','神经元特异性烯醇化酶（NSE）','item',110,64),
(5,'肿瘤筛查','总前列腺特异性抗原（T-PSA）','item',110,64),
(5,'肿瘤筛查','游离前列腺特异性抗原（F-PSA）','item',110,64),
(5,'肿瘤筛查','β-绒毛膜促性腺激素（β-HCG）','item',110,50),
(5,'肿瘤筛查','前列腺肿瘤两项筛选（PSA+FPSA）','combo',220,128),
(5,'肿瘤筛查','肿瘤5项（男）/（女）','combo',450,264),
(5,'肿瘤筛查','肿瘤6项（男）/（女）','combo',570,335),
(5,'肿瘤筛查','蛋白芯片7项（男）/（女）','combo',740,435),
(5,'肿瘤筛查','蛋白芯片10项（男）/（女）','combo',1130,664),
(5,'肿瘤筛查','肿瘤指标11项（男）','combo',1240,729),
(5,'肿瘤筛查','肿瘤指标(女)11项','combo',1240,729),
(5,'肿瘤筛查','肿瘤指标全套(男)15项','combo',1630,958),
(5,'肿瘤筛查','肿瘤指标全套(女)15项','combo',1690,994),
(5,'肿瘤筛查','胸苷激酶1(TK1)（外）','item',460,270),
(5,'肿瘤筛查','血管内皮生长因子（VEGF）（外）','item',510,300),
(5,'肿瘤筛查','肺癌SHOX2+RASSF1A+PTGER4基因甲基化检测(外）','item',815,480),
(5,'肿瘤筛查','Septin9肠癌基因检测（外）','item',1325,780),
(5,'肿瘤筛查','RNF180/Septin9基因甲基化（胃癌）早筛和辅助诊断检测（外）','item',790,400),
(5,'肿瘤筛查','Reprimo/SDC2/TCF4胃癌三基因甲基化（外）','item',680,400),
(5,'肿瘤筛查','降钙素（外）','item',85,50);

-- ===== 6. 妇科专项 =====
INSERT INTO _tmp_seed_items (cat_sort,category,name,item_type,default_price,insurance_price) VALUES
(6,'妇科专项','白带常规','item',20,10),
(6,'妇科专项','宫颈脱落细胞检查','item',120,70);

-- ===== 7. 特色加项 =====
INSERT INTO _tmp_seed_items (cat_sort,category,name,item_type,default_price,insurance_price) VALUES
(7,'特色加项','抗缪勒管激素（外）','item',440,260),
(7,'特色加项','25-羟基维生素D（总）（外）','item',170,100),
(7,'特色加项','25-羟基维生素D(D2/D3)（外）','item',170,100),
(7,'特色加项','过敏源检测（混合16项）','item',545,332),
(7,'特色加项','过敏原检测（混合28项）','item',960,560);

-- Step 3: 仅当主表为空时才从临时表批量 INSERT，避免重复
INSERT INTO booking_checkup_items
  (id, code, name, item_type, category, description, default_price, insurance_price, unit, status, sort_order)
SELECT
  UUID() AS id,
  CONCAT('T', LPAD(s.rn, 5, '0')) AS code,
  s.name,
  s.item_type,
  s.category,
  NULL AS description,
  s.default_price,
  s.insurance_price,
  '次' AS unit,
  1 AS status,
  (s.cat_sort * 10000 + s.rn) AS sort_order
FROM _tmp_seed_items s
WHERE NOT EXISTS (SELECT 1 FROM booking_checkup_items LIMIT 1);

DROP TEMPORARY TABLE IF EXISTS _tmp_seed_items;
