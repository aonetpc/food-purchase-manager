-- ============================================================
-- 090: 体检项目分类重映射 → 8 大类（客户健康关注点视角）
-- 新分类（8类，UI顶部8个Tab）：
--   基础体检 / 肝胆功能 / 心脑血管与血脂 / 糖代谢与肾功能
--   / 肿瘤标志物筛查 / 专项功能与系统 / 影像检查 / 性别专属
-- 策略：先归并老值 → 再 CASE WHEN 关键词匹配 → 按优先级排序
--       仅 UPDATE，不新增/删除记录，幂等安全。
-- 注意：本迁移基于 name LIKE 关键词匹配，比精确 IN 更健壮
-- ============================================================
-- 🔒 数据保护：Step 1 + Step 2 的 WHERE 条件都只处理"残留的旧分类值"。
--    category 已经是新 8 类中任一类的项目（包括管理员在前端手动改过的分类），
--    每次部署重新跑 090 都不会被覆盖，保留你手动分类的优先级。
--    若手动分类改错了 → 请在前端「批量修正分类」手动调回来，而不是靠 090 重跑。
-- ============================================================
SET @NEW8_CATS = '基础体检,肝胆功能,心脑血管与血脂,糖代谢与肾功能,肿瘤标志物筛查,专项功能与系统,影像检查,性别专属';

-- Step 1: 归并老分类值（077 之前的历史数据可能有 category=化验/专科/功能检查/影像/一般检查）
--         仅当 category 是"旧 7 类之前"更老的值（化验/专科/影像/一般检查）时才执行，
--         不会触碰新 8 类，也不会触碰 旧 7 类（体格检查/实验室/影像检查/功能检查/肿瘤筛查/妇科专项/特色加项）
UPDATE booking_checkup_items
SET category = CASE
  WHEN category = '化验' THEN '实验室'
  WHEN category = '专科' THEN '体格检查'
  WHEN category = '功能检查' THEN '功能检查'  -- 保持，后面再细分
  WHEN category = '影像' THEN '影像检查'
  WHEN category = '一般检查' THEN '体格检查'
  ELSE category
END
WHERE category IN ('化验','专科','影像','一般检查');

-- Step 2: 用关键词匹配方式把残留的旧分类项目映射到新 8 类
-- 🔒 WHERE 关键约束：只处理 category 不在新 8 类中的行（即还是旧 7 类/脏值）。
--    已经在新 8 类中的项目（包括用户手动通过前端修正过的分类）一律跳过，不会被关键词覆盖。
-- 注意顺序：匹配到的第一个 WHEN 生效，所以肿瘤 > 性别 > 具体分类 的优先级必须正确
UPDATE booking_checkup_items
SET category = CASE

  -- ============ 性别专属（最优先，避免妇科项目被"功能检查"等宽泛关键词匹配）============
  WHEN name IN (
    '妇科常规','白带常规','宫颈脱落细胞检查',
    'TCT（液基薄层细胞）','TCT（液基薄层细胞）',
    '人乳头瘤病毒（HPV16/18）定量','人乳头瘤病毒（HPV-23）定性',
    '电子阴道镜','阴超','抗缪勒管激素（外）',
    '性激素六项','激素水平测定（男/女）',
    'β-绒毛膜促性腺激素（β-HCG）',
    '彩超-乳腺','彩超-盆腔','彩超-前列腺'
  )
  OR name LIKE '%阴道%' OR name LIKE '%宫颈%' OR name LIKE '%妇科%'
  OR name LIKE '%HPV%' OR name LIKE '%TCT%' OR name LIKE '%阴超%'
  OR name LIKE '%前列腺%' OR name LIKE '%乳腺%'
  OR name LIKE '%盆腔%' OR name LIKE '%子宫%' OR name LIKE '%卵巢%' OR name LIKE '%附件%'
  OR name LIKE '%男科%' OR name LIKE '%睾丸%' OR name LIKE '%阴囊%' OR name LIKE '%精液%'
  THEN '性别专属'

  -- ============ 肿瘤标志物筛查（第二优先，包含所有肿瘤相关项目 + 基因甲基化）============
  WHEN name LIKE '%肿瘤%' OR name LIKE '%癌胚%' OR name LIKE '%甲胎%'
  OR name LIKE '%糖类抗原%' OR name LIKE '%抗原%' AND name LIKE '%CA%'
  OR name LIKE '%PSA%' OR name LIKE '%NSE%' OR name LIKE '%SCC%' OR name LIKE '%CYFRA%'
  OR name LIKE '%AFP%' OR name LIKE '%CEA%' OR name LIKE '%CA125%' OR name LIKE '%CA153%' OR name LIKE '%CA199%'
  OR name LIKE '%CA724%' OR name LIKE '%CA242%' OR name LIKE '%CA50%'
  OR name LIKE '%TSGF%' OR name LIKE '%VEGF%' OR name LIKE '%TK1%' OR name LIKE '%Septin%'
  OR name LIKE '%HE4%' OR name LIKE '%proGRP%' OR name LIKE '%降钙素%'
  OR name LIKE '%基因甲基化%' OR name LIKE '%RNF180%' OR name LIKE '%Reprimo%' OR name LIKE '%SDC2%'
  OR name LIKE '%蛋白芯片%' OR name LIKE '%肿瘤指标%'
  OR name LIKE '%肺癌%' OR name LIKE '%肠癌%' OR name LIKE '%胃癌%'
  THEN '肿瘤标志物筛查'

  -- ============ 肝胆功能（第三优先，肝功能全套 + 肝酶 + 肝纤维化）============
  WHEN name LIKE '%肝功能%' OR name LIKE '%肝功%'
  OR name LIKE '谷丙转氨酶' OR name LIKE 'ALT'
  OR name LIKE '谷草转氨酶' OR name LIKE 'AST'
  OR name LIKE 'GGT' OR name LIKE '%谷氨酰%'
  OR name LIKE '总蛋白' OR name LIKE '白蛋白' OR name LIKE '球蛋白' OR name LIKE '白球比例'
  OR name LIKE '总胆红素' OR name LIKE '直接胆红素' OR name LIKE '总胆汁酸'
  OR name LIKE '碱性磷酸酶' OR name LIKE 'ALP'
  OR name LIKE '前白蛋白' OR name LIKE 'PA'
  OR name LIKE '胆碱酯酶' OR name LIKE 'CHE'
  OR name LIKE '谷胱甘肽还原酶' OR name LIKE '肝纤维化%'
  OR name LIKE '%彩超-腹部%'
  THEN '肝胆功能'

  -- ============ 心脑血管与血脂（第四优先，血脂+心肌酶+心电+动脉硬化）============
  WHEN name LIKE '%血脂%' OR name LIKE '%胆固醇%' OR name LIKE '%甘油三%'
  OR name LIKE '%载脂蛋白%' OR name LIKE '%脂联素%'
  OR name LIKE 'Lpa' OR name LIKE 'Lp-PLA2' OR name LIKE 'SdLDL'
  OR name LIKE '心肌酶%' OR name LIKE '肌酸激酶%' OR name LIKE 'CK-MB' OR name LIKE 'CK)'
  OR name LIKE '乳酸脱氢酶%' OR name LIKE 'LDH'
  OR name LIKE '肌钙蛋白%' OR name LIKE '肌红蛋白%' OR name LIKE '钠尿肽%' OR name LIKE 'PRO-BNP'
  OR name LIKE '同型半胱氨酸%' OR name LIKE 'CRP%' OR name LIKE 'D-二聚体%'
  OR name LIKE '%心电图%' OR name LIKE '心脏彩超%' OR name LIKE '颈动脉%'
  OR name LIKE '动脉硬化%' OR name LIKE 'TCD%'
  OR name LIKE '血压%' AND name LIKE '动态'
  THEN '心脑血管与血脂'

  -- ============ 糖代谢与肾功能（第五优先，血糖+肾功能+电解质+微量元素）============
  WHEN name LIKE '%血糖%' OR name LIKE '%糖化血红蛋白%' OR name LIKE '%胰岛素%' OR name LIKE '%C-肽%'
  OR name LIKE '%肾功能%' OR name LIKE '%尿素氮%' OR name LIKE '%尿酸%' OR name LIKE '%肌酐%'
  OR name LIKE '%BUN%' OR name LIKE '%UA%' OR name LIKE '%CRE%'
  OR name LIKE '%微量白蛋白%' OR name LIKE '%NAG%' OR name LIKE '%β2-微球蛋白%' OR name LIKE '%胱抑素%'
  OR name LIKE '%电解质%' OR name LIKE '%微量元素%' OR name LIKE '%凝血%'
  THEN '糖代谢与肾功能'

  -- ============ 基础体检（第六优先，体格检查 + 基础化验）============
  WHEN name IN (
    '一般检查','内科','外科（男、女）','眼科','眼压','裂隙灯检查',
    '耳鼻喉科','口腔科','血压','眼科检查','一般检查(身高/体重/BMI)'
  )
  OR name LIKE '%体格检查%' OR name LIKE '%体检%'
  OR name LIKE '%血常规%' OR name LIKE '%尿常规%' OR name LIKE '%尿沉渣%'
  OR name LIKE '%血型%' OR name LIKE '%血沉%' OR name LIKE '%大便隐血%' OR name LIKE '%血流变%'
  THEN '基础体检'

  -- ============ 专项功能与系统（第七优先，甲状腺+消化+免疫+传染病+营养）============
  WHEN name LIKE '%甲状腺%' OR name LIKE '%TSH%' OR name LIKE '%FT3%' OR name LIKE '%FT4%'
  OR name LIKE '%T3%' OR name LIKE '%T4%' OR name LIKE '%甲状腺球蛋白%' OR name LIKE '%TPO%'
  OR name LIKE '%胃蛋白酶%' OR name LIKE '%胃幽门%' OR name LIKE '%胃泌素%'
  OR name LIKE '%呼气试验%' OR name LIKE '%C13%' OR name LIKE '%C14%' OR name LIKE '%肠镜%' OR name LIKE '%直乙%'
  OR name LIKE '%肺功能%' OR name LIKE '%骨密度%'
  OR name LIKE '%类风湿%' OR name LIKE '%免疫球蛋白%' OR name LIKE '%过敏原%'
  OR name LIKE '%梅毒%' OR name LIKE '%艾滋病%' OR name LIKE '%肝炎%' OR name LIKE '%EB病毒%'
  OR name LIKE '%维生素D%' OR name LIKE '%叶酸%' OR name LIKE '%铁蛋白%'
  THEN '专项功能与系统'

  -- ============ 影像检查（第八优先，DR+CT+出片费）============
  WHEN name LIKE '%DR%' OR name LIKE '%CT%' OR name LIKE '%出片费%' OR name LIKE '%影像%'
  THEN '影像检查'

  ELSE category  -- 兜底：保持原值
END
WHERE FIND_IN_SET(category, @NEW8_CATS) = 0;
