-- 084: 给体检项目字典 booking_checkup_items 加 clinical_significance 列
-- 用途：套餐详情页（WizardFinish）项目行替换单价显示为检查意义
-- 不在 booking_package_items 快照表存此列，展示时通过 item_id 关联主表读取

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

-- 按分类批量填充检查意义（针对现有项目）
UPDATE booking_checkup_items SET clinical_significance = '用于贫血、感染、白血病等血液疾病的筛查'
  WHERE category = '化验' AND name LIKE '%血常规%';
UPDATE booking_checkup_items SET clinical_significance = '用于泌尿系统感染、肾脏疾病等筛查'
  WHERE category = '化验' AND name LIKE '%尿常规%';
UPDATE booking_checkup_items SET clinical_significance = '评估肝细胞损伤、胆道疾病、肝脏代谢功能'
  WHERE category = '化验' AND name LIKE '%肝功能%';
UPDATE booking_checkup_items SET clinical_significance = '评估肾小球滤过功能、肾功能损伤程度'
  WHERE category = '化验' AND name LIKE '%肾功能%';
UPDATE booking_checkup_items SET clinical_significance = '评估心血管疾病风险，血脂代谢紊乱指标'
  WHERE category = '化验' AND (name LIKE '%血脂%' OR name LIKE '%胆固醇%');
UPDATE booking_checkup_items SET clinical_significance = '空腹血糖筛查，用于糖尿病诊断'
  WHERE category = '化验' AND (name LIKE '%血糖%' OR name LIKE '%葡萄糖%');
UPDATE booking_checkup_items SET clinical_significance = '心脏电活动检测，用于心律失常、心肌缺血诊断'
  WHERE category = '功能检查' AND (name LIKE '%心电图%' OR name LIKE '%ECG%');
UPDATE booking_checkup_items SET clinical_significance = '24小时动态心电监测，提高阵发性心律失常检出率'
  WHERE name LIKE '%动态心电图%' OR name LIKE '%Holter%';
UPDATE booking_checkup_items SET clinical_significance = '肺部影像检查，用于肺炎、结节、肿瘤筛查'
  WHERE category = '影像' AND (name LIKE '%胸部%' OR name LIKE '%X光%' OR name LIKE '%DR%');
UPDATE booking_checkup_items SET clinical_significance = '腹部实质脏器超声，用于肝胆胰脾肾病变筛查'
  WHERE category = '影像' AND (name LIKE '%腹部B超%' OR name LIKE '%彩超%');
UPDATE booking_checkup_items SET clinical_significance = '甲状腺超声，用于结节、囊肿、甲亢筛查'
  WHERE category = '影像' AND name LIKE '%甲状腺%';
UPDATE booking_checkup_items SET clinical_significance = 'CT影像检查，按需选择部位，用于肿瘤、血管病变诊断'
  WHERE category = '影像' AND name LIKE '%CT%';
UPDATE booking_checkup_items SET clinical_significance = '核磁共振检查，软组织分辨率高，用于神经系统、关节病变诊断'
  WHERE category = '影像' AND name LIKE '%MRI%';
UPDATE booking_checkup_items SET clinical_significance = '心脏彩超，评估心脏结构与功能，诊断先心病、心肌病'
  WHERE category = '影像' AND name LIKE '%心脏%';
UPDATE booking_checkup_items SET clinical_significance = '眼部专科检查，含视力、眼压、眼底、裂隙灯等'
  WHERE category = '专科' AND name LIKE '%眼科%';
UPDATE booking_checkup_items SET clinical_significance = '耳鼻喉专科检查，含听力、鼻咽、喉内镜等'
  WHERE category = '专科' AND name LIKE '%耳鼻喉%';
UPDATE booking_checkup_items SET clinical_significance = '口腔专科检查，含口腔全景、牙周评估等'
  WHERE category = '专科' AND name LIKE '%口腔%';
UPDATE booking_checkup_items SET clinical_significance = '妇科专科检查，含TCT、HPV、白带常规等'
  WHERE category = '专科' AND name LIKE '%妇科%';
UPDATE booking_checkup_items SET clinical_significance = '骨密度测定，用于骨质疏松筛查'
  WHERE category = '功能检查' AND name LIKE '%骨密度%';
UPDATE booking_checkup_items SET clinical_significance = '体成分分析，评估肌肉量、体脂率、基础代谢'
  WHERE category = '功能检查' AND name LIKE '%体成分%';
UPDATE booking_checkup_items SET clinical_significance = '胃幽门螺杆菌检测，用于慢性胃炎、胃溃疡病因诊断'
  WHERE category = '化验' AND (name LIKE '%幽门螺杆菌%' OR name LIKE '%C13%');
UPDATE booking_checkup_items SET clinical_significance = '维生素水平检测，评估营养状况'
  WHERE category = '化验' AND name LIKE '%维生素%';
UPDATE booking_checkup_items SET clinical_significance = '肿瘤标志物检测，辅助肿瘤筛查与疗效评估'
  WHERE category = '化验' AND (name LIKE '%肿瘤标志物%' OR name LIKE '%AFP%' OR name LIKE '%CEA%');
UPDATE booking_checkup_items SET clinical_significance = '神经电生理检查，评估神经传导功能'
  WHERE category = '功能检查' AND name LIKE '%神经电生理%';
UPDATE booking_checkup_items SET clinical_significance = '同型半胱氨酸检测，心脑血管疾病独立危险因素'
  WHERE category = '化验' AND (name LIKE '%同型%' OR name LIKE '%HCY%');
UPDATE booking_checkup_items SET clinical_significance = '胆红素代谢检测，用于黄疸、肝胆疾病诊断'
  WHERE category = '化验' AND name LIKE '%胆红素%';
UPDATE booking_checkup_items SET clinical_significance = '尿液沉渣镜检，用于泌尿系统疾病诊断'
  WHERE category = '化验' AND name LIKE '%沉渣%';
UPDATE booking_checkup_items SET clinical_significance = '肺功能检查，评估肺通气和换气功能'
  WHERE category = '功能检查' AND name LIKE '%肺功能%';
UPDATE booking_checkup_items SET clinical_significance = '动脉硬化检测，评估血管弹性与硬化程度'
  WHERE category = '功能检查' AND name LIKE '%动脉硬化%';
UPDATE booking_checkup_items SET clinical_significance = '经颅多普勒超声，评估颅内血管血流动力学'
  WHERE category = '影像' AND name LIKE '%经颅多普勒%';
UPDATE booking_checkup_items SET clinical_significance = '颈动脉超声，评估颈动脉粥样硬化斑块'
  WHERE category = '影像' AND name LIKE '%颈动脉%';
UPDATE booking_checkup_items SET clinical_significance = '脑血管超声，评估脑血管血流情况'
  WHERE category = '影像' AND name LIKE '%脑血管%';
UPDATE booking_checkup_items SET clinical_significance = '阴道超声（已婚），评估盆腔脏器病变'
  WHERE name LIKE '%阴超%' OR name LIKE '%阴道B超%';
UPDATE booking_checkup_items SET clinical_significance = '盆腔超声（经腹），评估子宫附件病变'
  WHERE name LIKE '%盆腔%' AND name NOT LIKE '%阴道%' AND name NOT LIKE '%阴超%';
UPDATE booking_checkup_items SET clinical_significance = '乳腺超声，用于乳腺结节、囊肿筛查'
  WHERE name LIKE '%乳腺%';
UPDATE booking_checkup_items SET clinical_significance = '妇科常规检查，含外阴、阴道、宫颈等视诊'
  WHERE name LIKE '%妇科常规%' OR name LIKE '%妇科检查%';
UPDATE booking_checkup_items SET clinical_significance = '白带常规检查，用于阴道炎诊断'
  WHERE name LIKE '%白带%';
UPDATE booking_checkup_items SET clinical_significance = '宫颈脱落细胞学检查，宫颈癌筛查'
  WHERE name LIKE '%宫颈脱落%' OR name LIKE '%TCT%' OR name LIKE '%液基%';
UPDATE booking_checkup_items SET clinical_significance = '人乳头瘤病毒检测，宫颈癌病因筛查'
  WHERE name LIKE '%HPV%';
UPDATE booking_checkup_items SET clinical_significance = '阴道镜检查，评估宫颈、阴道病变'
  WHERE name LIKE '%阴道镜%';
UPDATE booking_checkup_items SET clinical_significance = '宫腔镜检查，评估宫腔病变'
  WHERE name LIKE '%宫腔镜%';
UPDATE booking_checkup_items SET clinical_significance = '前列腺超声，用于前列腺增生、肿瘤筛查'
  WHERE name LIKE '%前列腺%';
UPDATE booking_checkup_items SET clinical_significance = '阴囊超声，评估睾丸、附睾病变'
  WHERE name LIKE '%阴囊%' OR name LIKE '%睾丸%';
UPDATE booking_checkup_items SET clinical_significance = '精液分析，用于男性不育评估'
  WHERE name LIKE '%精液%';
UPDATE booking_checkup_items SET clinical_significance = '24小时动态血压监测，诊断白大衣高血压、夜间高血压'
  WHERE name LIKE '%动态血压%';
UPDATE booking_checkup_items SET clinical_significance = '眼压测量，用于青光眼筛查'
  WHERE name LIKE '%眼压%';
UPDATE booking_checkup_items SET clinical_significance = '裂隙灯检查，评估眼前节病变'
  WHERE name LIKE '%裂隙灯%';
UPDATE booking_checkup_items SET clinical_significance = '眼底照相，用于糖尿病视网膜病变、高血压视网膜病变筛查'
  WHERE name LIKE '%眼底%';
UPDATE booking_checkup_items SET clinical_significance = '幽门螺旋杆菌抗体检测，判断既往感染'
  WHERE name LIKE '%幽门螺旋杆菌抗体%';
UPDATE booking_checkup_items SET clinical_significance = '甲胎蛋白检测，肝癌辅助诊断指标'
  WHERE name LIKE '%AFP%';
UPDATE booking_checkup_items SET clinical_significance = '癌胚抗原检测，消化道肿瘤辅助诊断指标'
  WHERE name LIKE '%CEA%';
UPDATE booking_checkup_items SET clinical_significance = '尿常规+尿沉渣，泌尿系统疾病综合筛查'
  WHERE name LIKE '%尿常规%' AND name LIKE '%沉渣%';
UPDATE booking_checkup_items SET clinical_significance = '血常规+CRP，感染与贫血综合评估'
  WHERE name LIKE '%血常规%' AND name LIKE '%CRP%';
UPDATE booking_checkup_items SET clinical_significance = '肝功十二项，全面评估肝脏功能'
  WHERE name LIKE '%肝功十二项%';
UPDATE booking_checkup_items SET clinical_significance = '肾功五项，全面评估肾脏功能'
  WHERE name LIKE '%肾功五项%';
UPDATE booking_checkup_items SET clinical_significance = '血脂六项，心血管疾病风险评估'
  WHERE name LIKE '%血脂六项%';
UPDATE booking_checkup_items SET clinical_significance = '糖耐量试验，用于糖尿病前期诊断'
  WHERE name LIKE '%糖耐量%';
UPDATE booking_checkup_items SET clinical_significance = '胰岛素释放试验，评估胰岛β细胞功能'
  WHERE name LIKE '%胰岛素%';
UPDATE booking_checkup_items SET clinical_significance = '性激素六项，评估内分泌功能'
  WHERE name LIKE '%性激素%';
UPDATE booking_checkup_items SET clinical_significance = '甲状腺功能五项，评估甲状腺功能'
  WHERE name LIKE '%甲状腺功能%' OR name LIKE '%甲功%';
UPDATE booking_checkup_items SET clinical_significance = '肿瘤标志物十二项，广谱肿瘤筛查'
  WHERE name LIKE '%肿瘤标志物十二项%';
UPDATE booking_checkup_items SET clinical_significance = '贫血三项（铁蛋白、叶酸、VitB12），评估营养性贫血'
  WHERE name LIKE '%贫血三项%';
UPDATE booking_checkup_items SET clinical_significance = '电解质检测，评估水盐平衡'
  WHERE name LIKE '%电解质%';
UPDATE booking_checkup_items SET clinical_significance = '凝血四项，评估凝血功能'
  WHERE name LIKE '%凝血%';
UPDATE booking_checkup_items SET clinical_significance = '血型鉴定+Rh分型，输血前必备检查'
  WHERE name LIKE '%血型%';
UPDATE booking_checkup_items SET clinical_significance = 'C反应蛋白，感染与炎症指标'
  WHERE name LIKE '%CRP%';
UPDATE booking_checkup_items SET clinical_significance = '降钙素原，细菌感染早期指标'
  WHERE name LIKE '%PCT%';
UPDATE booking_checkup_items SET clinical_significance = '糖化血红蛋白，近3月平均血糖评估'
  WHERE name LIKE '%糖化血红蛋白%' OR name LIKE '%HbA1c%';
UPDATE booking_checkup_items SET clinical_significance = '同型半胱氨酸，心脑血管疾病危险因素'
  WHERE name LIKE '%同型半胱氨酸%';
UPDATE booking_checkup_items SET clinical_significance = '肌酸激酶同工酶，心肌损伤标志物'
  WHERE name LIKE '%CK-MB%';
UPDATE booking_checkup_items SET clinical_significance = '肌钙蛋白，心肌损伤特异性标志物'
  WHERE name LIKE '%肌钙蛋白%' OR name LIKE '%cTnI%';
UPDATE booking_checkup_items SET clinical_significance = 'D-二聚体，血栓性疾病筛查指标'
  WHERE name LIKE '%D-二聚体%';
UPDATE booking_checkup_items SET clinical_significance = '纤维蛋白原，凝血功能评估'
  WHERE name LIKE '%纤维蛋白原%';
UPDATE booking_checkup_items SET clinical_significance = '乙肝五项，乙型肝炎病毒感染筛查'
  WHERE name LIKE '%乙肝%' OR name LIKE '%HBV%';
UPDATE booking_checkup_items SET clinical_significance = '丙肝抗体，丙型肝炎病毒感染筛查'
  WHERE name LIKE '%丙肝%' OR name LIKE '%HCV%';
UPDATE booking_checkup_items SET clinical_significance = '梅毒螺旋体抗体，梅毒感染筛查'
  WHERE name LIKE '%梅毒%' OR name LIKE '%TP%';
UPDATE booking_checkup_items SET clinical_significance = '艾滋病抗体，HIV感染筛查'
  WHERE name LIKE '%艾滋病%' OR name LIKE '%HIV%';
UPDATE booking_checkup_items SET clinical_significance = 'TORCH筛查，优生优育检查'
  WHERE name LIKE '%TORCH%';
UPDATE booking_checkup_items SET clinical_significance = 'NT彩超，早期唐氏综合征筛查'
  WHERE name LIKE '%NT%';
UPDATE booking_checkup_items SET clinical_significance = '唐氏筛查，神经管畸形及染色体异常筛查'
  WHERE name LIKE '%唐筛%';
UPDATE booking_checkup_items SET clinical_significance = '无创DNA检测，染色体异常精准筛查'
  WHERE name LIKE '%无创DNA%' OR name LIKE '%NIPT%';
UPDATE booking_checkup_items SET clinical_significance = '羊水穿刺，产前诊断金标准'
  WHERE name LIKE '%羊水穿刺%';
UPDATE booking_checkup_items SET clinical_significance = '胎心监护，评估胎儿宫内状况'
  WHERE name LIKE '%胎心监护%';
UPDATE booking_checkup_items SET clinical_significance = '脐血流检测，评估胎盘循环功能'
  WHERE name LIKE '%脐血流%';
UPDATE booking_checkup_items SET clinical_significance = '动脉硬化检测，心脑血管风险评估'
  WHERE name LIKE '%动脉硬化%';
UPDATE booking_checkup_items SET clinical_significance = '脉搏波速度，评估动脉僵硬度'
  WHERE name LIKE '%PWV%';
UPDATE booking_checkup_items SET clinical_significance = '踝肱指数，外周动脉疾病筛查'
  WHERE name LIKE '%ABI%';
UPDATE booking_checkup_items SET clinical_significance = '认知功能评估，老年痴呆早期筛查'
  WHERE name LIKE '%认知%';
UPDATE booking_checkup_items SET clinical_significance = '情绪测评，心理健康状况评估'
  WHERE name LIKE '%情绪%' OR name LIKE '%心理%';
UPDATE booking_checkup_items SET clinical_significance = '睡眠监测，睡眠质量评估'
  WHERE name LIKE '%睡眠%';
UPDATE booking_checkup_items SET clinical_significance = '基因检测，遗传性疾病风险评估'
  WHERE name LIKE '%基因%';
UPDATE booking_checkup_items SET clinical_significance = '叶酸代谢基因检测，指导叶酸补充'
  WHERE name LIKE '%叶酸代谢%';
UPDATE booking_checkup_items SET clinical_significance = '酒精代谢基因检测，指导饮酒安全'
  WHERE name LIKE '%酒精代谢%';
UPDATE booking_checkup_items SET clinical_significance = '药物代谢基因检测，指导个体化用药'
  WHERE name LIKE '%药物代谢%';

-- 未命中的默认给一个通用描述
UPDATE booking_checkup_items SET clinical_significance = '用于相关疾病的筛查与诊断'
  WHERE clinical_significance IS NULL;
