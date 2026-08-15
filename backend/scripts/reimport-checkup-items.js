#!/usr/bin/env node
/*
 * ==========================================================================
 * ⚠️⚠️⚠️ 生产数据保护：危险脚本 — 运行前必须先读 3 层锁说明！⚠️⚠️⚠️
 * ==========================================================================
 * 此脚本会：
 *   ① DELETE booking_item_sub_items 全表（体检项目组合子项关联）
 *   ② DELETE booking_package_items 全表（套餐-项目关联明细，含价格快照！）
 *   ③ DELETE booking_checkup_items 全表（所有体检项目）
 *   ④ 插入 201 条旧版标准种子数据（旧分类/旧价格/旧编码）
 *
 * ❌ 生产环境（当前 DB 已从 PDF 手动导入 201 条最终数据）严禁运行此脚本！
 * ❌ 一旦运行，你刚刚通过「PDF 批量导入 + 🔖 批量修正分类/类型」整理好的
 *    分类、编码、价格、组合子项、套餐明细 全部会被旧数据覆盖，且无法恢复。
 *
 * 3 层运行保护锁（任意一条不满足直接 exit）：
 *   1) 命令行必须带参数  --i-know-what-im-doing
 *   2) NODE_ENV 不能等于 "production"（生产环境直接拦截）
 *   3) 运行前 SELECT COUNT(*):  booking_checkup_items > 100 条时退出
 *      （意味着生产数据已存在，要真跑请先手动改脚本移除这层）
 * ==========================================================================
 */
/**
 * reimport-checkup-items.js — 体检项目重导（Node.js 版，仅开发/初始化环境使用）
 *
 * 【生产环境当前已弃用】：
 *   生产体检项目库 → 走前端「📥 从PDF批量导入 → 🔖 批量修正分类/类型」流程
 *   初始化/测试环境如需用此脚本，请先确保库内无重要数据后再解锁。
 *
 * 为什么要脚本化（历史背景）：
 *   1. 070 SQL 有致命问题在 MySQL 5.7 过不去：
 *      - code 列 NOT NULL 无默认值，INSERT 省略 code → 1364 整批失败
 *      - UPDATE ... JOIN ... ORDER BY → 1221（MySQL 5.7 多表UPDATE不允许ORDER BY）
 *      - booking_package_items ALTER 使用了不存在的 price_snapshot 列名
 *   2. 服务器没装 PHP，之前的 PHP 兜底没跑
 *   3. migrate.js 有迁移 ID 冲突（070 两个文件），mysql CLI 错误中断
 *
 * 正确用法（仅开发/初始化）：
 *   cd /opt/food-purchase/backend && NODE_ENV=development \
 *     node scripts/reimport-checkup-items.js --i-know-what-im-doing
 */

const pool = require('../db');

// ===== 3 层运行保护锁（任何一层不满足都直接退出，绝对不执行 DELETE / INSERT）=====
(function runProtectionChecks() {
  // 锁1：必须传 --i-know-what-im-doing
  if (!process.argv.includes('--i-know-what-im-doing')) {
    console.error([
      '',
      '❌ 【生产保护锁1】未传参数 --i-know-what-im-doing，脚本被拦截。',
      '   此脚本会清空所有体检项目+套餐明细，生产禁止随意运行。',
      '   你确定要这么做？请重新运行加参数：',
      '     node scripts/reimport-checkup-items.js --i-know-what-im-doing',
      '',
    ].join('\n'));
    process.exit(2);
  }
  // 锁2：NODE_ENV !== production
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    console.error([
      '',
      '❌ 【生产保护锁2】NODE_ENV=production，脚本被拦截。',
      '   生产环境严禁运行此脚本（会覆盖你从 PDF 导入的最终版数据）。',
      '   如果确要初始化，请切换 NODE_ENV=development 再试。',
      '',
    ].join('\n'));
    process.exit(3);
  }
})();

// ============================================================
// 体检项目全量数据（和 070 SQL 保持一致，共 201 项）
// 字段顺序：[name, item_type, category, default_price, insurance_price, unit]
// ============================================================
const ITEMS = [
  // ---- 化验 ----
  ['血常规','item','化验',35.00,20.00,'次'],
  ['血型（ABO、RH）','item','化验',85.00,50.00,'次'],
  ['血沉','item','化验',20.00,10.00,'次'],
  ['尿常规','item','化验',20.00,10.00,'次'],
  ['尿沉渣','item','化验',35.00,20.00,'次'],
  ['尿常规+尿沉渣','combo','化验',50.00,30.00,'次'],
  ['大便隐血试验','item','化验',20.00,10.00,'次'],
  ['白带常规','item','专科',20.00,10.00,'次'],
  ['宫颈脱落细胞检查','item','专科',120.00,70.00,'次'],
  ['血流变','item','化验',95.00,56.00,'次'],
  ['谷丙转氨酶','item','化验',10.00,5.00,'次'],
  ['肝功能2项','combo','化验',20.00,10.00,'次'],
  ['肝功能3项','combo','化验',30.00,17.00,'次'],
  ['肝功能4项','combo','化验',40.00,23.00,'次'],
  ['肝功能5项','combo','化验',50.00,25.00,'次'],
  ['肝功能6项','combo','化验',60.00,30.00,'次'],
  ['肝功能10项','combo','化验',80.00,42.00,'次'],
  ['肝功能12项','combo','化验',115.00,67.00,'次'],
  ['肝功能15项','combo','化验',245.00,144.00,'次'],
  ['肝功能16项','combo','化验',255.00,150.00,'次'],
  ['肝功全套','combo','化验',355.00,208.00,'次'],
  ['肾功能2项','combo','化验',20.00,10.00,'次'],
  ['肾功能3项','combo','化验',35.00,20.00,'次'],
  ['肾功能4项','combo','化验',95.00,55.00,'次'],
  ['肾功能5项','combo','化验',178.00,102.00,'次'],
  ['肾功能6项','combo','化验',205.00,120.00,'次'],
  ['肾功能7项','combo','化验',255.00,150.00,'次'],
  ['空腹血糖','item','化验',10.00,5.00,'次'],
  ['餐后2h血糖','item','化验',20.00,5.00,'次'],
  ['糖化血红蛋白','item','化验',100.00,17.00,'次'],
  ['血脂2项','combo','化验',30.00,58.00,'次'],
  ['高密度胆固醇','item','化验',25.00,15.00,'次'],
  ['低密度胆固醇','item','化验',80.00,15.00,'次'],
  ['血脂4项','combo','化验',80.00,47.00,'次'],
  ['血脂5项','combo','化验',150.00,85.00,'次'],
  ['血脂6项','combo','化验',150.00,85.00,'次'],
  ['血脂全套（7项）','combo','化验',220.00,129.00,'次'],
  ['α-L糖苷苷藻酶（AFU）','item','化验',50.00,30.00,'次'],
  ['尿微量白蛋白(MALB)（尿）','item','化验',30.00,15.00,'次'],
  ['N-β-葡萄糖苷酶(NAG)（尿）','item','化验',45.00,25.00,'次'],
  ['超敏C反应蛋白（CRP）','item','化验',80.00,30.00,'次'],
  ['β2-微球蛋白(β2-MG)','item','化验',60.00,30.00,'次'],
  ['胱抑素C(CYC)','item','化验',85.00,50.00,'次'],
  ['同型半胱氨酸(HCY)','item','化验',205.00,120.00,'次'],
  ['前白蛋白(PA)','item','化验',50.00,30.00,'次'],
  ['胆碱酯酶(CHE)','item','化验',30.00,18.00,'次'],
  ['D-二聚体(DD)','item','化验',85.00,50.00,'次'],
  ['心肌酶谱测定（3项）','combo','化验',85.00,50.00,'次'],
  ['心肌酶谱测定（4项）','combo','化验',95.00,55.00,'次'],
  ['类风湿因子测定（ASO）','item','化验',50.00,30.00,'次'],
  ['抗链球菌溶血素O（ASO）','item','化验',50.00,30.00,'次'],
  ['类风湿因子、血沉、抗"O"、超敏CRP','combo','化验',200.00,117.00,'次'],
  ['类风湿因子、抗"O"、超敏CRP','combo','化验',180.00,105.00,'次'],
  ['胃蛋白酶原I/II（I/II）(PG)','combo','化验',340.00,200.00,'次'],
  ['胃幽门螺杆菌抗体','item','化验',50.00,20.00,'次'],
  ['生化全套','combo','化验',1385.00,814.00,'次'],
  ['总胆汁酸(TBA)','item','化验',25.00,15.00,'次'],
  ['肌酸激酶同工酶（CK-MB）','item','化验',50.00,30.00,'次'],
  ['谷胱甘肽还原酶(GR)','item','化验',35.00,20.00,'次'],
  ['乳酸脱氢酶（LDH）','item','化验',10.00,5.00,'次'],
  ['乳酸脱氢酶同工酶（LDH-1）','item','化验',25.00,15.00,'次'],
  ['肌酸激酶（CK）','item','化验',25.00,15.00,'次'],
  ['促甲状腺素（TSH）','item','化验',55.00,32.00,'次'],
  ['游离三碘甲状原氨酸（FT3）','item','化验',55.00,32.00,'次'],
  ['游离甲状腺素（FT4）','item','化验',55.00,32.00,'次'],
  ['甲状腺素（T4）','item','化验',45.00,25.00,'次'],
  ['三碘甲状原氨酸（T3）','item','化验',45.00,25.00,'次'],
  ['载脂蛋白A1(APO-A1)','item','化验',35.00,20.00,'次'],
  ['载脂蛋白B(APO-B)','item','化验',35.00,20.00,'次'],
  ['脂联素(ADPN)','item','化验',35.00,50.00,'次'],
  ['小而密低密度脂蛋白胆固醇（SdLDL-C）（外）','item','化验',85.00,20.00,'次'],
  ['脂蛋白相关磷脂酶A2(LP-PLA2)（外）','item','化验',60.00,35.00,'次'],
  ['胸苷激酶1(TK)（外）','item','化验',460.00,270.00,'次'],
  ['抗缪勒管激素（外）','item','化验',440.00,260.00,'次'],
  ['25-羟基维生素D（总）（外）','item','化验',170.00,100.00,'次'],
  ['25-羟基维生素D(2023)（外）','item','化验',170.00,100.00,'次'],
  ['EB病毒早期抗原IgA抗体（EA-IgA）','item','化验',60.00,60.00,'次'],
  ['EB病毒壳抗原IgA抗体（EB-VCA-IgM）','item','化验',60.00,30.00,'次'],
  ['EB病毒壳抗原IgM抗体（EB-VCA-IgA）','item','化验',100.00,40.00,'次'],
  ['C-肽（C-P）','item','化验',70.00,30.00,'次'],
  ['血清肌红蛋白测定（MYO）','item','化验',110.00,35.00,'次'],
  ['血清肌钙蛋白I（外）','item','化验',205.00,120.00,'次'],
  ['血清肌钙蛋白T(超敏肌钙蛋白T:NT-HS)','item','化验',205.00,120.00,'次'],
  ['B型钠尿肽前体（PRO-BNP）','item','化验',385.00,226.00,'次'],
  ['促甲状腺激素受体抗体（TP-Ab）','item','化验',55.00,32.00,'次'],
  ['恶性肿瘤特异性生长因子（TSGF）','item','化验',50.00,50.00,'次'],
  ['梅毒筛查（Anti-TP）','item','化验',50.00,20.00,'次'],
  ['艾滋病筛查（Anti-HIV）','item','化验',100.00,50.00,'次'],
  ['TCT（液基薄层细胞）','item','专科',255.00,150.00,'次'],
  ['人乳头瘤病毒（HPV16/18）定量','item','专科',270.00,160.00,'次'],
  ['人乳头瘤病毒（HPV-23）定性','item','专科',510.00,300.00,'次'],
  ['激素水平测定（男/女）','combo','化验',360.00,208.00,'次'],
  ['过敏原检测（混合16项）','combo','化验',560.00,330.00,'次'],
  ['过敏原检测（混合28项）','combo','化验',960.00,560.00,'次'],
  ['胃泌素-17','item','化验',70.00,40.00,'次'],
  ['免疫球蛋白三项（IgA、IgM、gG）','combo','化验',100.00,60.00,'次'],
  ['肝纤维化四项（HA，PC-III，IV-C，Ln）','combo','化验',305.00,180.00,'次'],
  ['电解质检测6项：钾（K）钠（Na）氯（Cl）钙（Ca）磷（P）镁（mg）','combo','化验',50.00,30.00,'次'],
  ['微量元素检测6项（铅、镉、铁、钙、锌、铁）','combo','化验',270.00,160.00,'次'],
  ['微量元素检测7项（铅、铜、镁、锰、钙、锌、铁）','combo','化验',325.00,190.00,'次'],
  ['凝血四项','combo','化验',95.00,55.00,'次'],
  ['丙型肝炎病毒抗体（IgG）','item','化验',70.00,40.00,'次'],
  ['戊型肝炎病毒抗体（IgM）','item','化验',30.00,12.00,'次'],
  // ---- 专科 / 功能检查 / 影像 / 化验 ----
  ['一般检查','item','专科',25.00,14.00,'次'],
  ['内科','item','专科',25.00,14.00,'次'],
  ['外科（男、女）','item','专科',25.00,14.00,'次'],
  ['眼科','item','专科',30.00,14.00,'次'],
  ['眼压','item','专科',20.00,10.00,'次'],
  ['裂隙灯检查','item','专科',40.00,8.00,'次'],
  ['耳鼻喉科','item','专科',30.00,14.00,'次'],
  ['口腔科','item','专科',30.00,14.00,'次'],
  ['妇科常规','item','专科',25.00,14.00,'次'],
  ['心电图（12导常规）','item','功能检查',35.00,20.00,'次'],
  ['24小时动态心电图','item','功能检查',270.00,160.00,'次'],
  ['24小时动态血压','item','功能检查',225.00,120.00,'次'],
  ['甲胎蛋白定量（AFP）','item','化验',60.00,32.00,'次'],
  ['甲胎蛋白定性（CEA）','item','化验',25.00,15.00,'次'],
  ['癌胚抗原定量（AFP）','item','化验',60.00,32.00,'次'],
  ['癌胚抗原定性（CEA）','item','化验',25.00,15.00,'次'],
  ['糖类抗原199（CA199）','item','化验',110.00,55.00,'次'],
  ['糖类抗原724（CA724）','item','化验',110.00,55.00,'次'],
  ['糖类抗原153（CA153）','item','化验',110.00,55.00,'次'],
  ['糖类抗原125（CA125）','item','化验',110.00,55.00,'次'],
  ['非小细胞肺癌相关抗原（CA211）','item','化验',170.00,100.00,'次'],
  ['糖类抗原50（CA50）','item','化验',135.00,55.00,'次'],
  ['骨钙素（OST）','item','化验',135.00,80.00,'次'],
  ['人附睾蛋白1（HE4）','item','化验',170.00,100.00,'次'],
  ['胃泌素释放前体（proGRP）','item','化验',70.00,40.00,'次'],
  ['鳞状细胞癌相关抗原（SCC）','item','化验',170.00,100.00,'次'],
  ['糖类抗原242（CA242）','item','化验',120.00,55.00,'次'],
  ['神经元特异性烯醇化酶（NSE）','item','化验',110.00,64.00,'次'],
  ['总前列腺特异性抗原（T-PSA）','item','化验',110.00,64.00,'次'],
  ['游离前列腺特异性抗原（F-PSA）','item','化验',110.00,64.00,'次'],
  ['β-绒毛膜促性腺激素（β-HCG）','item','化验',110.00,50.00,'次'],
  ['铁蛋白（FERR）','item','化验',100.00,40.00,'次'],
  ['血空腹胰岛素','item','化验',100.00,32.00,'次'],
  ['前列腺肿瘤两项筛选（PSA+FPSAs）','combo','化验',220.00,128.00,'次'],
  ['肿瘤5项（男）/（女）','combo','化验',450.00,264.00,'次'],
  ['肿瘤6项（男）/（女）','combo','化验',570.00,335.00,'次'],
  ['蛋白芯片7项（男）/（女）','combo','化验',740.00,435.00,'次'],
  ['蛋白芯片10项（女）','combo','化验',1130.00,664.00,'次'],
  ['蛋白芯片11项（男）/（女）','combo','化验',1240.00,729.00,'次'],
  ['肿瘤指标(男)11项（罗）','combo','化验',1240.00,729.00,'次'],
  ['肿瘤指标(女)11项（罗）','combo','化验',1240.00,729.00,'次'],
  ['肿瘤指标全套(男)15项（罗）','combo','化验',1630.00,958.00,'次'],
  ['肿瘤指标全套(女)15项（罗）','combo','化验',1690.00,994.00,'次'],
  ['甲状腺球蛋白（TG）','item','化验',110.00,64.00,'次'],
  ['抗甲状腺球蛋白抗体（TG-Ab）','item','化验',100.00,60.00,'次'],
  ['抗甲状腺过氧化物酶抗体（TPO-Ab）','item','化验',100.00,60.00,'次'],
  ['甲状腺功能检查3项','combo','化验',165.00,96.00,'次'],
  ['甲状腺功能检查5项','combo','化验',250.00,156.00,'次'],
  ['甲状腺功能检查5项（新）','combo','化验',375.00,220.00,'次'],
  ['甲状腺功能检查6项（新）','combo','化验',475.00,280.00,'次'],
  ['甲状腺功能检查8项（新）','combo','化验',560.00,330.00,'次'],
  ['尿素氮（BUN）','item','化验',10.00,5.00,'次'],
  ['尿酸(UA)','item','化验',15.00,5.00,'次'],
  ['肌酐(CRE)','item','化验',10.00,8.00,'次'],
  ['总胆固醇(TCH)','item','化验',15.00,5.00,'次'],
  ['甘油三脂(TG)','item','化验',20.00,10.00,'次'],
  ['丙氨酸氨基转移酶(ALT)','item','化验',10.00,5.00,'次'],
  ['脂蛋白A(Lpa)','item','化验',70.00,40.00,'次'],
  ['天门冬氨酸氨基转移酶(AST)','item','化验',10.00,5.00,'次'],
  ['γ-谷氨酰转移酶(GGT)','item','化验',10.00,5.00,'次'],
  ['总蛋白（TP）','item','化验',10.00,5.00,'次'],
  ['总胆红素(TBIL)','item','化验',10.00,5.00,'次'],
  ['直接胆红素(DBIL)','item','化验',10.00,5.00,'次'],
  ['碱性磷酸酶（ALP）','item','化验',10.00,5.00,'次'],
  ['白蛋白(ALB)','item','化验',10.00,10.00,'次'],
  ['球蛋白(GLB)','item','化验',10.00,10.00,'次'],
  ['白球比例(A/G)','item','化验',10.00,10.00,'次'],
  ['叶酸(外)','item','化验',85.00,50.00,'次'],
  ['血管内皮生长因子（VEGF）（外）','item','化验',510.00,300.00,'次'],
  ['肺癌SHOX2+RASSF1A+PTGER4基因甲基化检测（外）','item','化验',815.00,480.00,'次'],
  ['Septine9肠癌基因检测（外）','item','化验',1325.00,780.00,'次'],
  ['RNF180/Septin9基因甲基化（胃癌）早筛和辅助诊断检测（外）','item','化验',790.00,400.00,'次'],
  ['Reprimo/SDC2/TCF4胃癌三基因甲基化（外）','item','化验',680.00,460.00,'次'],
  ['淀粉酶测定（外）','item','化验',25.00,15.00,'次'],
  ['纤维蛋白原（外）','item','化验',20.00,15.00,'次'],
  ['降钙素（外）','item','化验',85.00,50.00,'次'],
  // ---- 影像 / 功能检查 ----
  ['彩超-腹部','combo','影像',170.00,100.00,'次'],
  ['彩超-前列腺','combo','影像',100.00,60.00,'次'],
  ['彩超-盆腔','combo','影像',100.00,60.00,'次'],
  ['彩超-乳腺','combo','影像',100.00,60.00,'次'],
  ['彩超-膀胱','combo','影像',100.00,60.00,'次'],
  ['阴超','item','影像',100.00,60.00,'次'],
  ['彩超-心脏','combo','影像',300.00,130.00,'次'],
  ['彩超-甲状腺','combo','影像',100.00,60.00,'次'],
  ['彩超-颈动脉','combo','影像',340.00,200.00,'次'],
  ['数字DR摄片/部位','item','影像',170.00,100.00,'次'],
  ['出片费（DR-CT）','item','影像',20.00,10.00,'次'],
  ['CT部位（不含片）','item','影像',120.00,170.00,'次'],
  ['CT动态分析','item','影像',120.00,70.00,'次'],
  ['人体成分分析','item','功能检查',100.00,120.00,'次'],
  ['动脉硬化检测','item','功能检查',205.00,120.00,'次'],
  ['肺功能检查','item','功能检查',120.00,70.00,'次'],
  ['骨密度','item','专科',170.00,20.00,'次'],
  ['经颅多普勒TCD','item','功能检查',100.00,60.00,'次'],
  ['C14呼气试验','item','功能检查',140.00,100.00,'次'],
  ['C13呼气试验','item','功能检查',160.00,110.00,'次'],
  ['电子阴道镜','item','专科',170.00,100.00,'次'],
  ['电子直乙肠镜','item','专科',270.00,160.00,'次'],
];

// 分类顺序（用于编码）
const CATEGORY_ORDER = ['化验', '专科', '功能检查', '影像'];
const TYPE_ORDER = ['combo', 'item'];

async function q(pool, sql, params) {
  try {
    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (e) {
    return e;
  }
}

function isError(v) { return v instanceof Error; }

// 幂等添加列：用 PREPARE + INFORMATION_SCHEMA 判断（MySQL 5.7 可用）
async function addColumnIfNotExists(conn, table, column, def) {
  const check = await conn.query(
    `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  if (check[0][0].c > 0) {
    console.log(`  ⚠️  ${table}.${column} 已存在，跳过`);
    return;
  }
  await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${def}`);
  console.log(`  ✅ ${table}.${column} 已添加`);
}

async function showStats(label) {
  console.log(`===== ${label} =====`);
  const t = await pool.query('SELECT COUNT(*) AS c FROM booking_checkup_items');
  console.log(`  booking_checkup_items 总数: ${t[0][0].c}`);
  if (t[0][0].c > 0) {
    const grp = await pool.query(
      `SELECT category, item_type, COUNT(*) AS c FROM booking_checkup_items
       GROUP BY category, item_type
       ORDER BY FIELD(category,'化验','专科','功能检查','影像'), item_type`
    );
    for (const r of grp[0]) {
      console.log(`    - [${r.category}] ${r.item_type}: ${r.c}`);
    }
  }
  const s = await pool.query('SELECT COUNT(*) AS c FROM booking_item_sub_items');
  console.log(`  booking_item_sub_items 总数: ${s[0][0].c}\n`);
}

async function main() {
  console.log(`🚀 体检项目重导：共 ${ITEMS.length} 项\n`);
  await showStats('导入前');

  // ===== 【生产保护锁3】：如果库内已有 > 100 条体检项目数据 → 绝对不执行，防止有人解锁1、2层锁还误操作 =====
  const [countRow] = await pool.query('SELECT COUNT(*) AS c FROM booking_checkup_items');
  const currentCount = Number(countRow[0].c || 0);
  if (currentCount > 100) {
    console.error([
      '',
      '❌ 【生产保护锁3】booking_checkup_items 已有 ' + currentCount + ' 条数据。',
      '   现有数据量过大，极有可能是你已经通过「PDF 批量导入」整理好的最终版数据。',
      '   此脚本会把它们清掉并插入旧版种子（旧分类/旧价格），因此被拦截。',
      '   ',
      '   如果真的确定要重建（已备份或全新初始化），请：',
      '     ① 手动执行 SQL 清库，然后再跑本脚本',
      '     ② 或直接编辑本脚本，注释掉这段 COUNT>100 的保护退出',
      '',
    ].join('\n'));
    process.exit(4);
  }

  const conn = await pool.getConnection();

  // ---- 1. 扩展字段（幂等，用 INFORMATION_SCHEMA 判断） ----
  console.log('──── 步骤1：扩展字段（幂等检查） ────');
  await addColumnIfNotExists(conn, 'booking_checkup_items', 'insurance_price',
    "DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '医保价格,仅展示用' AFTER default_price");
  // 注意：066 建表时列名是 item_price，不是 price_snapshot；这里 AFTER item_price
  await addColumnIfNotExists(conn, 'booking_package_items', 'insurance_price_snapshot',
    "DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '医保价格快照' AFTER item_price");

  // ---- 2. 清空旧数据（按依赖顺序，逐条执行便于看日志） ----
  // ⚠️【生产数据保护】：即使解锁了前 3 层锁，这里默认也只打印日志，不真删。
  //   如需真的清空 + 插入旧种子，请手动把下面的「PROTECTION_BLOCKED = true」改成 false。
  const PROTECTION_BLOCKED = true;
  console.log('\n──── 步骤2：清空旧数据 ────');
  if (PROTECTION_BLOCKED) {
    console.log([
      '  ⚠️ 生产保护：清库段已被注释（PROTECTION_BLOCKED=true）。',
      '     如需真的执行 DELETE booking_item_sub_items / booking_package_items / booking_checkup_items，',
      '     请手动修改本脚本的 PROTECTION_BLOCKED = false 再运行。',
    ].join('\n'));
  } else {
    const del1 = await conn.query('DELETE FROM booking_item_sub_items');
    console.log(`  booking_item_sub_items 删除 ${del1[0].affectedRows} 行`);
    const del2 = await conn.query('DELETE FROM booking_package_items');
    console.log(`  booking_package_items 删除 ${del2[0].affectedRows} 行`);
    const del3 = await conn.query('DELETE FROM booking_checkup_items');
    console.log(`  booking_checkup_items 删除 ${del3[0].affectedRows} 行`);
  }

  // ---- 3. 排序后生成编码并批量 INSERT ----
  console.log('\n──── 步骤3：按分类/类型/价格 排序并生成编码批量插入 ────');
  const sorted = [...ITEMS].sort((a, b) => {
    const ca = CATEGORY_ORDER.indexOf(a[2]) - CATEGORY_ORDER.indexOf(b[2]);
    if (ca !== 0) return ca;
    const ta = TYPE_ORDER.indexOf(a[1]) - TYPE_ORDER.indexOf(b[1]);
    if (ta !== 0) return ta;
    const pa = a[4] - b[4]; // 按医保价格升序
    return pa;
  });

  // 分批 INSERT，每批 50 条，避免包过大
  const SQL_INSERT = `INSERT INTO booking_checkup_items
    (id, code, name, item_type, category, default_price, insurance_price, unit, status, sort_order, created_at, updated_at)
    VALUES ?`;
  const BATCH = 50;
  let rn = 0;
  let inserted = 0;
  let codeDedup = new Set();
  for (let i = 0; i < sorted.length; i += BATCH) {
    const chunk = sorted.slice(i, i + BATCH);
    const values = [];
    for (let j = 0; j < chunk.length; j++) {
      rn++;
      const code = 'T' + String(rn).padStart(5, '0');
      if (codeDedup.has(code)) {
        console.log(`  ❌ 编码重复: ${code}`);
      }
      codeDedup.add(code);
      const [name, item_type, category, default_price, insurance_price, unit] = chunk[j];
      values.push([
        cryptoUUID(),
        code,
        name,
        item_type,
        category,
        default_price,
        insurance_price,
        unit,
        1, // status
        100, // sort_order
        new Date(),
        new Date(),
      ]);
    }
    const r = await conn.query(SQL_INSERT, [values]);
    inserted += r[0].affectedRows;
    console.log(`  批 ${i / BATCH + 1}/${Math.ceil(sorted.length / BATCH)}: 插入 ${r[0].affectedRows} 行`);
  }
  console.log(`  ✅ 合计插入 ${inserted} 行 / ${rn} 编码 (T00001 ~ T${String(rn).padStart(5, '0')})`);

  // ---- 4. 去重：同名称保留id较小的（DELETE JOIN 方式，MySQL 5.7 支持） ----
  console.log('\n──── 步骤4：按名称去重（保留小ID） ────');
  const ded = await conn.query(`
    DELETE t1 FROM booking_checkup_items t1
    INNER JOIN booking_checkup_items t2
    WHERE t1.name = t2.name AND t1.id > t2.id
  `);
  console.log(`  删除重名 ${ded[0].affectedRows} 行`);

  conn.release();

  // ---- 5. 验证 ----
  await showStats('导入后');

  const sample = await pool.query(
    `SELECT code, name, category, item_type, default_price, insurance_price
     FROM booking_checkup_items ORDER BY code LIMIT 10`
  );
  console.log('===== 编码示例（前10条） =====');
  for (const r of sample[0]) {
    console.log(`  ${r.code} | ${r.name} | ${r.category}/${r.item_type} | ¥${r.default_price} / 医保¥${r.insurance_price}`);
  }
  console.log('\n🎉 体检项目重导完成');
  process.exit(0);
}

// 生成 UUIDv4（和 MySQL UUID() 等价，纯 JS，避免依赖差异）
function cryptoUUID() {
  if (typeof require('crypto').randomUUID === 'function') {
    return require('crypto').randomUUID();
  }
  // 回退：用 randomBytes 拼接
  const b = require('crypto').randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20,32);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('\n❌ 致命错误:', e.message);
    console.error(e.stack);
    process.exit(1);
  });
}

module.exports = { ITEMS, CATEGORY_ORDER };
