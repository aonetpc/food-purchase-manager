-- 086: 体检项目体检意义（clinical_significance）全量数据
-- 说明：覆盖 201 个体检项目的体检意义描述
-- 迁移 085 因 schema_migrations 已存在记录导致未执行，改用新编号 086

-- 先确保列存在（幂等）
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_checkup_items' AND COLUMN_NAME = 'clinical_significance'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE booking_checkup_items ADD COLUMN clinical_significance VARCHAR(500) NULL COMMENT ''检查意义/临床意义''',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 以下按 name + category 精确匹配更新

-- ===== 化验 (162项) =====
UPDATE booking_checkup_items SET clinical_significance = '检查红细胞、白细胞等，辅助诊断贫血与感染' WHERE name = '血常规' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '确定ABO及RH血型，用于输血及亲子鉴定' WHERE name = '血型（ABO、RH）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '检查红细胞沉降率，辅助判断炎症及免疫疾病' WHERE name = '血沉' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '检查尿液蛋白、糖等，辅助诊断肾脏疾病' WHERE name = '尿常规' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '显微镜检查尿中有形成分，辅助诊断泌尿疾病' WHERE name = '尿沉渣' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '尿常规与尿沉渣联合检查，全面评估泌尿系统' WHERE name = '尿常规+尿沉渣' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '检查消化道微量出血，筛查胃肠道肿瘤' WHERE name = '大便隐血试验' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '检查血液黏稠度，辅助诊断心脑血管疾病' WHERE name = '血流变' AND category = '化验' AND status != 0;

UPDATE booking_checkup_items SET clinical_significance = '检查肝脏损伤指标，辅助诊断肝炎、脂肪肝' WHERE name = '谷丙转氨酶' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '肝脏两项核心指标，评估肝细胞损伤' WHERE name = '肝功能2项' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '肝脏三项关键指标，评估肝细胞损伤与功能' WHERE name = '肝功能3项' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '肝脏四项指标，综合评估肝功能状态' WHERE name = '肝功能4项' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '肝脏五项指标，较全面评估肝功能' WHERE name = '肝功能5项' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '肝脏六项指标，更全面评估肝功能' WHERE name = '肝功能6项' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '综合评估肝脏代谢、蛋白、胆红素等功能' WHERE name = '肝功能10项' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '更全面评估肝脏各项代谢与合成功能' WHERE name = '肝功能12项' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '全面评估肝脏代谢、合成、排泄等功能' WHERE name = '肝功能15项' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '最全面评估肝脏各项功能' WHERE name = '肝功能16项' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '肝功能全项检查，全面评估肝脏健康' WHERE name = '肝功全套' AND category = '化验' AND status != 0;

UPDATE booking_checkup_items SET clinical_significance = '肾脏两项核心指标，评估肾小球滤过功能' WHERE name = '肾功能2项' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '肾脏三项指标，评估肾功能状态' WHERE name = '肾功能3项' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '肾脏四项指标，较全面评估肾功能' WHERE name = '肾功能4项' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '肾脏五项指标，更全面评估肾功能' WHERE name = '肾功能5项' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '肾脏六项指标，全面评估肾功能' WHERE name = '肾功能6项' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '肾脏七项指标，最全面评估肾功能' WHERE name = '肾功能7项' AND category = '化验' AND status != 0;

UPDATE booking_checkup_items SET clinical_significance = '检测空腹血糖浓度，筛查糖尿病' WHERE name = '空腹血糖' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '检测餐后血糖代谢能力，辅助诊断糖尿病' WHERE name = '餐后2h血糖' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '反映近3个月平均血糖，评估糖尿病控制' WHERE name = '糖化血红蛋白' AND category = '化验' AND status != 0;

UPDATE booking_checkup_items SET clinical_significance = '血脂两项核心指标，评估血脂代谢' WHERE name = '血脂2项' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '检测高密度脂蛋白，评估心血管风险' WHERE name = '高密度胆固醇' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '检测低密度脂蛋白，评估心血管风险' WHERE name = '低密度胆固醇' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '血脂四项指标，较全面评估血脂' WHERE name = '血脂4项' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '血脂五项指标，全面评估血脂代谢' WHERE name = '血脂5项' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '血脂六项指标，更全面评估血脂' WHERE name = '血脂6项' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '血脂七项全检查，全面评估血脂代谢' WHERE name = '血脂全套（7项）' AND category = '化验' AND status != 0;

UPDATE booking_checkup_items SET clinical_significance = '诊断原发性肝癌的特异性指标' WHERE name = 'α-L糖苷苷藻酶（AFU）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '检测尿中微量白蛋白，早期评估肾损伤' WHERE name = '尿微量白蛋白(MALB)（尿）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '评估肾小管功能，辅助诊断早期肾病' WHERE name = 'N-β-葡萄糖苷酶(NAG)（尿）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '检测体内炎症反应，预测心血管疾病风险' WHERE name = '超敏C反应蛋白（CRP）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '评估肾功能及淋巴细胞增殖情况' WHERE name = 'β2-微球蛋白(β2-MG)' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '早期敏感指标，评估肾小球滤过功能' WHERE name = '胱抑素C(CYC)' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '心脑血管疾病独立危险因素' WHERE name = '同型半胱氨酸(HCY)' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '反映肝脏合成与营养状况' WHERE name = '前白蛋白(PA)' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '评估肝脏储备功能，辅助诊断肝病' WHERE name = '胆碱酯酶(CHE)' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '检测血栓形成指标，辅助诊断血栓性疾病' WHERE name = 'D-二聚体(DD)' AND category = '化验' AND status != 0;

UPDATE booking_checkup_items SET clinical_significance = '检查心肌损伤三项指标，辅助诊断心肌炎' WHERE name = '心肌酶谱测定（3项）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '检查心肌损伤四项指标，更全面诊断心肌疾病' WHERE name = '心肌酶谱测定（4项）' AND category = '化验' AND status != 0;

UPDATE booking_checkup_items SET clinical_significance = '检查类风湿因子，辅助诊断类风湿关节炎' WHERE name = '类风湿因子测定（ASO）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '检测链球菌感染指标，辅助诊断风湿热' WHERE name = '抗链球菌溶血素O（ASO）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '风湿免疫四项联合检查，全面评估炎症状态' WHERE name = '类风湿因子、血沉、抗"O"、超敏CRP' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '风湿免疫三项联合检查，评估炎症状态' WHERE name = '类风湿因子、抗"O"、超敏CRP' AND category = '化验' AND status != 0;

UPDATE booking_checkup_items SET clinical_significance = '评估胃黏膜功能，辅助筛查胃癌' WHERE name = '胃蛋白酶原I/II（I/II）(PG)' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '检测幽门螺杆菌感染，辅助诊断胃炎' WHERE name = '胃幽门螺杆菌抗体' AND category = '化验' AND status != 0;

UPDATE booking_checkup_items SET clinical_significance = '涵盖肝肾功能、血脂血糖等，全面评估健康' WHERE name = '生化全套' AND category = '化验' AND status != 0;

UPDATE booking_checkup_items SET clinical_significance = '评估肝脏胆汁代谢功能，辅助诊断肝胆疾病' WHERE name = '总胆汁酸(TBA)' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '心肌损伤特异性指标，辅助诊断心肌梗死' WHERE name = '肌酸激酶同工酶（CK-MB）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '评估抗氧化能力，辅助判断氧化应激状态' WHERE name = '谷胱甘肽还原酶(GR)' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '组织损伤指标，辅助诊断肝病、心肌疾病' WHERE name = '乳酸脱氢酶（LDH）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '心肌损伤更特异性指标，辅助诊断心梗' WHERE name = '乳酸脱氢酶同工酶（LDH-1）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '评估心肌及横纹肌损伤，辅助诊断心肌疾病' WHERE name = '肌酸激酶（CK）' AND category = '化验' AND status != 0;

UPDATE booking_checkup_items SET clinical_significance = '垂体分泌促甲状腺素，评估甲状腺功能' WHERE name = '促甲状腺素（TSH）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '检测游离T3，评估甲状腺代谢活性' WHERE name = '游离三碘甲状原氨酸（FT3）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '检测游离T4，评估甲状腺激素水平' WHERE name = '游离甲状腺素（FT4）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '检测甲状腺素总量，评估甲状腺功能' WHERE name = '甲状腺素（T4）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '检测T3总量，评估甲状腺代谢功能' WHERE name = '三碘甲状原氨酸（T3）' AND category = '化验' AND status != 0;

UPDATE booking_checkup_items SET clinical_significance = '高密度脂蛋白主要载脂蛋白，评估心血管风险' WHERE name = '载脂蛋白A1(APO-A1)' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '低密度脂蛋白主要载脂蛋白，评估心血管风险' WHERE name = '载脂蛋白B(APO-B)' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '脂肪细胞分泌因子，与代谢综合征相关' WHERE name = '脂联素(ADPN)' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '更致动脉粥样硬化的LDL亚型，评估心血管风险' WHERE name = '小而密低密度脂蛋白胆固醇（SdLDL-C）（外）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '血管炎症标志物，预测心血管事件风险' WHERE name = '脂蛋白相关磷脂酶A2(LP-PLA2)（外）' AND category = '化验' AND status != 0;

UPDATE booking_checkup_items SET clinical_significance = '细胞增殖标志物，辅助肿瘤筛查' WHERE name = '胸苷激酶1(TK)（外）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '评估卵巢储备功能及肿瘤相关' WHERE name = '抗缪勒管激素（外）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '评估维生素D营养状况，与骨健康相关' WHERE name = '25-羟基维生素D（总）（外）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '评估维生素D代谢，辅助诊断骨质疏松' WHERE name = '25-羟基维生素D(2023)（外）' AND category = '化验' AND status != 0;

UPDATE booking_checkup_items SET clinical_significance = 'EB病毒抗体，辅助筛查鼻咽癌' WHERE name = 'EB病毒早期抗原IgA抗体（EA-IgA）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = 'EB病毒IgA抗体，辅助诊断EB病毒感染' WHERE name = 'EB病毒壳抗原IgA抗体（EB-VCA-IgM）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = 'EB病毒IgM抗体，辅助诊断EB病毒感染' WHERE name = 'EB病毒壳抗原IgM抗体（EB-VCA-IgA）' AND category = '化验' AND status != 0;

UPDATE booking_checkup_items SET clinical_significance = '反映胰岛β细胞分泌功能，评估胰岛素抵抗' WHERE name = 'C-肽（C-P）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '心肌损伤早期指标，辅助诊断心肌梗死' WHERE name = '血清肌红蛋白测定（MYO）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '心肌损伤特异性指标，诊断心肌梗死金标准' WHERE name = '血清肌钙蛋白I（外）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '超敏肌钙蛋白T，早期诊断心肌损伤' WHERE name = '血清肌钙蛋白T(超敏肌钙蛋白T:NT-HS)' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '心衰标志物，辅助诊断心功能不全' WHERE name = 'B型钠尿肽前体（PRO-BNP）' AND category = '化验' AND status != 0;

UPDATE booking_checkup_items SET clinical_significance = 'Graves病特异性抗体，辅助诊断甲亢' WHERE name = '促甲状腺激素受体抗体（TP-Ab）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '广谱肿瘤标志物，辅助肿瘤筛查' WHERE name = '恶性肿瘤特异性生长因子（TSGF）' AND category = '化验' AND status != 0;

UPDATE booking_checkup_items SET clinical_significance = '梅毒螺旋体抗体筛查，预防母婴传播' WHERE name = '梅毒筛查（Anti-TP）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = 'HIV抗体筛查，预防艾滋病传播' WHERE name = '艾滋病筛查（Anti-HIV）' AND category = '化验' AND status != 0;

UPDATE booking_checkup_items SET clinical_significance = '性激素水平检测，评估内分泌功能' WHERE name = '激素水平测定（男/女）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '检测16种常见过敏原，辅助诊断过敏' WHERE name = '过敏原检测（混合16项）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '检测28种常见过敏原，更全面诊断过敏' WHERE name = '过敏原检测（混合28项）' AND category = '化验' AND status != 0;

UPDATE booking_checkup_items SET clinical_significance = '评估胃窦G细胞功能，辅助诊断胃病' WHERE name = '胃泌素-17' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '检测免疫球蛋白，评估体液免疫功能' WHERE name = '免疫球蛋白三项（IgA、IgM、gG）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '评估肝纤维化程度，辅助诊断肝硬化' WHERE name = '肝纤维化四项（HA，PC-III，IV-C，Ln）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '检测体内电解质平衡，评估生理环境' WHERE name = '电解质检测6项：钾（K）钠（Na）氯（Cl）钙（Ca）磷（P）镁（mg）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '检测体内微量元素，评估营养与中毒' WHERE name = '微量元素检测6项（铅、镉、铁、钙、锌、铁）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '检测体内7种微量元素，更全面评估' WHERE name = '微量元素检测7项（铅、铜、镁、锰、钙、锌、铁）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '检测凝血功能，评估出血与血栓风险' WHERE name = '凝血四项' AND category = '化验' AND status != 0;

UPDATE booking_checkup_items SET clinical_significance = '丙肝病毒抗体筛查，预防丙型肝炎' WHERE name = '丙型肝炎病毒抗体（IgG）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '戊肝病毒抗体筛查，预防戊型肝炎' WHERE name = '戊型肝炎病毒抗体（IgM）' AND category = '化验' AND status != 0;

UPDATE booking_checkup_items SET clinical_significance = '肝癌特异性标志物，辅助筛查原发性肝癌' WHERE name = '甲胎蛋白定量（AFP）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '定性检测AFP，辅助肝癌筛查' WHERE name = '甲胎蛋白定性（CEA）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '癌胚抗原定量，辅助筛查消化道肿瘤' WHERE name = '癌胚抗原定量（AFP）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '定性检测CEA，辅助消化道肿瘤筛查' WHERE name = '癌胚抗原定性（CEA）' AND category = '化验' AND status != 0;

UPDATE booking_checkup_items SET clinical_significance = '胰腺癌相关抗原，辅助筛查胰腺癌' WHERE name = '糖类抗原199（CA199）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '胃癌相关抗原，辅助筛查胃癌' WHERE name = '糖类抗原724（CA724）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '乳腺癌相关抗原，辅助筛查乳腺癌' WHERE name = '糖类抗原153（CA153）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '卵巢癌相关抗原，辅助筛查卵巢癌' WHERE name = '糖类抗原125（CA125）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '肺癌相关抗原，辅助筛查非小细胞肺癌' WHERE name = '非小细胞肺癌相关抗原（CA211）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '广谱肿瘤标志物，辅助筛查多种肿瘤' WHERE name = '糖类抗原50（CA50）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '评估骨形成功能，辅助诊断骨质疏松' WHERE name = '骨钙素（OST）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '卵巢癌新型标志物，辅助诊断卵巢癌' WHERE name = '人附睾蛋白1（HE4）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '小细胞肺癌标志物，辅助筛查肺癌' WHERE name = '胃泌素释放前体（proGRP）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '鳞状细胞癌标志物，辅助筛查宫颈癌等' WHERE name = '鳞状细胞癌相关抗原（SCC）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '胃肠道肿瘤相关抗原，辅助筛查肠癌' WHERE name = '糖类抗原242（CA242）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '神经内分泌肿瘤标志物，辅助筛查肺癌' WHERE name = '神经元特异性烯醇化酶（NSE）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '前列腺癌标志物，辅助筛查前列腺癌' WHERE name = '总前列腺特异性抗原（T-PSA）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '前列腺癌诊断辅助指标，提高特异性' WHERE name = '游离前列腺特异性抗原（F-PSA）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '妊娠及肿瘤相关标志物，辅助诊断' WHERE name = 'β-绒毛膜促性腺激素（β-HCG）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '储存铁蛋白指标，评估铁代谢与贫血' WHERE name = '铁蛋白（FERR）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '检测空腹胰岛素水平，评估胰岛功能' WHERE name = '血空腹胰岛素' AND category = '化验' AND status != 0;

UPDATE booking_checkup_items SET clinical_significance = '前列腺癌两项联合筛查，提高诊断准确性' WHERE name = '前列腺肿瘤两项筛选（PSA+FPSAs）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '肿瘤标志物五项联合筛查' WHERE name = '肿瘤5项（男）/（女）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '肿瘤标志物六项联合筛查' WHERE name = '肿瘤6项（男）/（女）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '蛋白芯片7项检测，高通量肿瘤筛查' WHERE name = '蛋白芯片7项（男）/（女）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '蛋白芯片10项检测，女性肿瘤高通量筛查' WHERE name = '蛋白芯片10项（女）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '蛋白芯片11项检测，全面肿瘤筛查' WHERE name = '蛋白芯片11项（男）/（女）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '男性肿瘤11项标志物联合筛查' WHERE name = '肿瘤指标(男)11项（罗）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '女性肿瘤11项标志物联合筛查' WHERE name = '肿瘤指标(女)11项（罗）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '男性肿瘤15项全套筛查' WHERE name = '肿瘤指标全套(男)15项（罗）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '女性肿瘤15项全套筛查' WHERE name = '肿瘤指标全套(女)15项（罗）' AND category = '化验' AND status != 0;

UPDATE booking_checkup_items SET clinical_significance = '甲状腺滤泡分泌指标，辅助诊断甲状腺疾病' WHERE name = '甲状腺球蛋白（TG）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '甲状腺自身抗体，辅助诊断桥本甲状腺炎' WHERE name = '抗甲状腺球蛋白抗体（TG-Ab）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '甲状腺自身免疫抗体，辅助诊断桥本甲状腺炎' WHERE name = '抗甲状腺过氧化物酶抗体（TPO-Ab）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '甲状腺功能三项评估，筛查甲状腺疾病' WHERE name = '甲状腺功能检查3项' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '甲状腺功能五项评估，更全面筛查' WHERE name = '甲状腺功能检查5项' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '甲状腺功能五项（新）评估' WHERE name = '甲状腺功能检查5项（新）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '甲状腺功能六项（新）全面评估' WHERE name = '甲状腺功能检查6项（新）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '甲状腺功能八项（新）最全面评估' WHERE name = '甲状腺功能检查8项（新）' AND category = '化验' AND status != 0;

UPDATE booking_checkup_items SET clinical_significance = '评估肾功能及蛋白质代谢' WHERE name = '尿素氮（BUN）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '检测血尿酸水平，辅助诊断痛风' WHERE name = '尿酸(UA)' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '评估肾小球滤过功能，诊断肾功能不全' WHERE name = '肌酐(CRE)' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '检测血液中胆固醇总量，评估血脂' WHERE name = '总胆固醇(TCH)' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '检测血液中甘油三酯，评估血脂代谢' WHERE name = '甘油三脂(TG)' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '肝脏损伤敏感指标，辅助诊断肝病' WHERE name = '丙氨酸氨基转移酶(ALT)' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '脂蛋白a，独立心血管危险因素' WHERE name = '脂蛋白A(Lpa)' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '心肌及肝脏损伤指标，辅助诊断疾病' WHERE name = '天门冬氨酸氨基转移酶(AST)' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '胆道及肝脏疾病辅助诊断指标' WHERE name = 'γ-谷氨酰转移酶(GGT)' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '检测血清总蛋白，评估营养与免疫' WHERE name = '总蛋白（TP）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '评估肝脏胆红素代谢功能' WHERE name = '总胆红素(TBIL)' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '评估肝脏直接胆红素代谢' WHERE name = '直接胆红素(DBIL)' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '胆道梗阻及骨病辅助诊断指标' WHERE name = '碱性磷酸酶（ALP）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '肝脏合成功能及营养状况评估' WHERE name = '白蛋白(ALB)' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '免疫球蛋白水平评估，辅助诊断免疫疾病' WHERE name = '球蛋白(GLB)' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '白蛋白与球蛋白比值，评估肝肾功能' WHERE name = '白球比例(A/G)' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '检测叶酸水平，辅助诊断巨幼红细胞贫血' WHERE name = '叶酸(外)' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '血管生成标志物，辅助评估肿瘤血管' WHERE name = '血管内皮生长因子（VEGF）（外）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '肺癌早期基因甲基化筛查' WHERE name = '肺癌SHOX2+RASSF1A+PTGER4基因甲基化检测（外）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '肠癌血液基因甲基化筛查' WHERE name = 'Septine9肠癌基因检测（外）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '胃癌基因甲基化早筛' WHERE name = 'RNF180/Septin9基因甲基化（胃癌）早筛和辅助诊断检测（外）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '胃癌三基因甲基化联合早筛' WHERE name = 'Reprimo/SDC2/TCF4胃癌三基因甲基化（外）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '检测淀粉酶活性，辅助诊断胰腺疾病' WHERE name = '淀粉酶测定（外）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '检测纤维蛋白原水平，评估凝血功能' WHERE name = '纤维蛋白原（外）' AND category = '化验' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '细菌感染指标，辅助诊断败血症' WHERE name = '降钙素（外）' AND category = '化验' AND status != 0;

-- ===== 专科 (17项) =====
UPDATE booking_checkup_items SET clinical_significance = '检查阴道分泌物，辅助诊断妇科炎症' WHERE name = '白带常规' AND category = '专科' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '检查宫颈脱落细胞，筛查宫颈癌前病变' WHERE name = '宫颈脱落细胞检查' AND category = '专科' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '液基薄层宫颈细胞学检查，筛查宫颈癌' WHERE name = 'TCT（液基薄层细胞）' AND category = '专科' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = 'HPV16/18型定量检测，筛查宫颈癌高危病毒' WHERE name = '人乳头瘤病毒（HPV16/18）定量' AND category = '专科' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = 'HPV23型定性检测，全面筛查HPV感染' WHERE name = '人乳头瘤病毒（HPV-23）定性' AND category = '专科' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '身高、体重、血压等基础体格检查' WHERE name = '一般检查' AND category = '专科' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '内科体格检查，听诊心肺触诊腹部' WHERE name = '内科' AND category = '专科' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '外科体格检查，检查皮肤、淋巴结等' WHERE name = '外科（男、女）' AND category = '专科' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '眼科常规检查，视力、眼底等评估' WHERE name = '眼科' AND category = '专科' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '测量眼内压，辅助诊断青光眼' WHERE name = '眼压' AND category = '专科' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '裂隙灯显微镜检查，评估眼前节病变' WHERE name = '裂隙灯检查' AND category = '专科' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '耳鼻喉科常规检查，评估耳鼻咽喉健康' WHERE name = '耳鼻喉科' AND category = '专科' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '口腔常规检查，评估牙齿、牙周健康' WHERE name = '口腔科' AND category = '专科' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '妇科常规检查，评估生殖系统健康' WHERE name = '妇科常规' AND category = '专科' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '检测骨密度，辅助诊断骨质疏松' WHERE name = '骨密度' AND category = '专科' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '电子阴道镜检查，评估宫颈及阴道病变' WHERE name = '电子阴道镜' AND category = '专科' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '电子直乙肠镜检查，筛查直肠乙状结肠病变' WHERE name = '电子直乙肠镜' AND category = '专科' AND status != 0;

-- ===== 功能检查 (9项) =====
UPDATE booking_checkup_items SET clinical_significance = '12导联心电图，检测心脏电活动异常' WHERE name = '心电图（12导常规）' AND category = '功能检查' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '24小时持续心电监测，发现阵发性心律失常' WHERE name = '24小时动态心电图' AND category = '功能检查' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '24小时动态血压监测，诊断高血压类型' WHERE name = '24小时动态血压' AND category = '功能检查' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '分析肌肉、脂肪、水分等身体组成' WHERE name = '人体成分分析' AND category = '功能检查' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '检测动脉僵硬度，评估心血管风险' WHERE name = '动脉硬化检测' AND category = '功能检查' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '评估肺通气与换气功能，诊断呼吸疾病' WHERE name = '肺功能检查' AND category = '功能检查' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '经颅多普勒检测颅内血流，评估脑血管' WHERE name = '经颅多普勒TCD' AND category = '功能检查' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = 'C14呼气试验，检测幽门螺杆菌感染' WHERE name = 'C14呼气试验' AND category = '功能检查' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = 'C13呼气试验，检测幽门螺杆菌感染（无辐射）' WHERE name = 'C13呼气试验' AND category = '功能检查' AND status != 0;

-- ===== 影像 (13项) =====
UPDATE booking_checkup_items SET clinical_significance = '腹部彩超，检查肝胆胰脾肾等脏器形态结构' WHERE name = '彩超-腹部' AND category = '影像' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '前列腺彩超，检查前列腺大小与形态' WHERE name = '彩超-前列腺' AND category = '影像' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '盆腔彩超，检查子宫附件等盆腔脏器' WHERE name = '彩超-盆腔' AND category = '影像' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '乳腺彩超，检查乳腺结节与病变' WHERE name = '彩超-乳腺' AND category = '影像' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '膀胱彩超，检查膀胱壁与容量' WHERE name = '彩超-膀胱' AND category = '影像' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '经阴道超声，更清晰检查子宫附件' WHERE name = '阴超' AND category = '影像' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '心脏彩超，检查心腔结构与心功能' WHERE name = '彩超-心脏' AND category = '影像' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '甲状腺彩超，检查甲状腺结节与形态' WHERE name = '彩超-甲状腺' AND category = '影像' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '颈动脉彩超，检查颈动脉斑块与狭窄' WHERE name = '彩超-颈动脉' AND category = '影像' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = '数字DR X光摄片，检查骨骼及肺部' WHERE name = '数字DR摄片/部位' AND category = '影像' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = 'DR或CT影像出片费用' WHERE name = '出片费（DR-CT）' AND category = '影像' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = 'CT检查费用（不含胶片）' WHERE name = 'CT部位（不含片）' AND category = '影像' AND status != 0;
UPDATE booking_checkup_items SET clinical_significance = 'CT动态扫描分析，评估脏器血流灌注' WHERE name = 'CT动态分析' AND category = '影像' AND status != 0;

-- 兜底：未命中的给一个通用描述
UPDATE booking_checkup_items SET clinical_significance = '用于相关疾病的筛查与诊断'
  WHERE clinical_significance IS NULL AND status != 0;
