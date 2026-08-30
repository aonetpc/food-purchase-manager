import { useEffect, useMemo, useState, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  ROLES, ROLE_LABEL, CATEGORIES, displayCategory,
  type Role, type CheckupTemplate, type CheckupItemRef,
} from './api';
import { useToast } from '@/components/Toast';

/* =========================================================
 * 分享落地页 —— 免登录。后端由 /api/booking/checkup-share/:token 提供
 * 支持 ?demo=1 开发预览模式（无后端即可查看美化效果）
 * ========================================================= */
function anonymousFetch(url: string): Promise<any> {
  return fetch(url, { method: 'GET', headers: { Accept: 'application/json' } })
    .then((r) => r.json().catch(() => ({})));
}

type BrandInfo = {
  name: string;
  logo: string | null;
  slogan: string | null;
  address: string | null;
  phone: string | null;
  primary_color: string;
};
type SalesProfile = {
  user_id: string;
  name: string;
  phone: string | null;
  avatar_url: string | null;
};

/* ---------------- Demo 106 套餐 Mock 数据（?demo=1 时使用） ---------------- */
const DEMO_PKG: CheckupTemplate = {
  id: 9999, code: 'DEMO-106', name: '18人保套餐123（演示）',
  description: '专注高端人群健康管理，涵盖心脑血管、肿瘤、影像等核心检查项目，三工作日出报告，由主任级医师一对一解读。',
  applicable_roles: ['male', 'female_married', 'female_single'],
  created_at: '2026-08-01 09:00:00',
  role_plans: {
    male: {
      original_price: 3145, discount_price: 1200, discount_percent: 38.2,
      items: [
        // 基础体检 10
        { id: 'm1', package_item_id: 'pm1', category: '一般检查', sub_category: '基础体检', name: '一般检查', qty: 1, unit_price: 40, sub_item_names: [] },
        { id: 'm2', package_item_id: 'pm2', category: '一般检查', sub_category: '基础体检', name: '内科', qty: 1, unit_price: 20, sub_item_names: [] },
        { id: 'm3', package_item_id: 'pm3', category: '一般检查', sub_category: '基础体检', name: '外科', qty: 1, unit_price: 25, sub_item_names: [] },
        { id: 'm4', package_item_id: 'pm4', category: '五官科', sub_category: '基础体检', name: '裂隙灯检查', qty: 1, unit_price: 40, sub_item_names: [] },
        { id: 'm5', package_item_id: 'pm5', category: '五官科', sub_category: '基础体检', name: '眼压', qty: 1, unit_price: 20, sub_item_names: [] },
        { id: 'm6', package_item_id: 'pm6', category: '耳鼻喉科', sub_category: '基础体检', name: '耳鼻喉科', qty: 1, unit_price: 30, sub_item_names: [] },
        { id: 'm7', package_item_id: 'pm7', category: '检验科', sub_category: '基础体检', name: '尿常规', qty: 1, unit_price: 20, sub_item_names: [] },
        { id: 'm8', package_item_id: 'pm8', category: '检验科', sub_category: '基础体检', name: '尿沉渣', qty: 1, unit_price: 35, sub_item_names: [] },
        { id: 'm9', package_item_id: 'pm9', category: '检验科', sub_category: '基础体检', name: '血常规', qty: 1, unit_price: 35, sub_item_names: [] },
        { id: 'm10', package_item_id: 'pm10', category: '检验科', sub_category: '基础体检', name: '粪常规', qty: 1, unit_price: 15, sub_item_names: [] },
        // 体检检查组合项
        { id: 'm11', package_item_id: 'pm11', category: '体检检查', sub_category: '体格检查', name: '体检检查', qty: 1, unit_price: 25, sub_item_names: ['体重指数BMI', '血压', '脉搏', '身高'] },
        // 心脑血管与血脂 14
        { id: 'm20', package_item_id: 'pm20', category: '心电图', sub_category: '心脑血管与血脂', name: '心电图(12导常规)', qty: 1, unit_price: 35, sub_item_names: [] },
        { id: 'm21', package_item_id: 'pm21', category: '检验科', sub_category: '心脑血管与血脂', name: '乳酸脱氢酶(LDH)', qty: 1, unit_price: 10, sub_item_names: [] },
        { id: 'm22', package_item_id: 'pm22', category: '检验科', sub_category: '心脑血管与血脂', name: '肌酸激酶同工酶(CK-MB)', qty: 1, unit_price: 50, sub_item_names: [] },
        { id: 'm23', package_item_id: 'pm23', category: '检验科', sub_category: '心脑血管与血脂', name: '总胆固醇(TCHO)', qty: 1, unit_price: 10, sub_item_names: [] },
        { id: 'm24', package_item_id: 'pm24', category: '检验科', sub_category: '心脑血管与血脂', name: '甘油三脂(TG)', qty: 1, unit_price: 20, sub_item_names: [] },
        { id: 'm25', package_item_id: 'pm25', category: '检验科', sub_category: '心脑血管与血脂', name: '高密度胆固醇', qty: 1, unit_price: 25, sub_item_names: [] },
        { id: 'm26', package_item_id: 'pm26', category: '检验科', sub_category: '心脑血管与血脂', name: '低密度胆固醇', qty: 1, unit_price: 25, sub_item_names: [] },
        { id: 'm27', package_item_id: 'pm27', category: '检验科', sub_category: '心脑血管与血脂', name: '脂蛋白a(Lpa)', qty: 1, unit_price: 70, sub_item_names: [] },
        { id: 'm28', package_item_id: 'pm28', category: '检验科', sub_category: '心脑血管与血脂', name: '载脂蛋白A1(APO-A1)', qty: 1, unit_price: 35, sub_item_names: [] },
        { id: 'm29', package_item_id: 'pm29', category: '检验科', sub_category: '心脑血管与血脂', name: '载脂蛋白B(APO-B)', qty: 1, unit_price: 35, sub_item_names: [] },
        { id: 'm30', package_item_id: 'pm30', category: '检验科', sub_category: '心脑血管与血脂', name: '同型半胱氨酸(HCY)', qty: 1, unit_price: 80, sub_item_names: [] },
        { id: 'm31', package_item_id: 'pm31', category: '检验科', sub_category: '心脑血管与血脂', name: '超敏C反应蛋白(hs-CRP)', qty: 1, unit_price: 45, sub_item_names: [] },
        { id: 'm32', package_item_id: 'pm32', category: '超声科', sub_category: '心脑血管与血脂', name: '颈动脉彩超', qty: 1, unit_price: 150, sub_item_names: [] },
        { id: 'm33', package_item_id: 'pm33', category: '功能科', sub_category: '心脑血管与血脂', name: '动脉硬化检测', qty: 1, unit_price: 90, sub_item_names: [] },
        // 影像检查 4
        { id: 'm40', package_item_id: 'pm40', category: '超声科', sub_category: '影像检查', name: '彩超-腹部', qty: 1, unit_price: 170, sub_item_names: [] },
        { id: 'm41', package_item_id: 'pm41', category: '超声科', sub_category: '影像检查', name: '彩超-甲状腺', qty: 1, unit_price: 100, sub_item_names: [] },
        { id: 'm42', package_item_id: 'pm42', category: '放射科', sub_category: '影像检查', name: 'CT-胸部(低剂量)', qty: 1, unit_price: 300, sub_item_names: [] },
        { id: 'm43', package_item_id: 'pm43', category: '超声科', sub_category: '影像检查', name: '彩超-前列腺', qty: 1, unit_price: 100, sub_item_names: [] },
        // 肝胆功能 10
        { id: 'm50', package_item_id: 'pm50', category: '检验科', sub_category: '肝胆功能', name: '总胆红素(TBIL)', qty: 1, unit_price: 10, sub_item_names: [] },
        { id: 'm51', package_item_id: 'pm51', category: '检验科', sub_category: '肝胆功能', name: '直接胆红素(DBIL)', qty: 1, unit_price: 10, sub_item_names: [] },
        { id: 'm52', package_item_id: 'pm52', category: '检验科', sub_category: '肝胆功能', name: '间接胆红素(IBIL)', qty: 1, unit_price: 10, sub_item_names: [] },
        { id: 'm53', package_item_id: 'pm53', category: '检验科', sub_category: '肝胆功能', name: '总蛋白(TP)', qty: 1, unit_price: 10, sub_item_names: [] },
        { id: 'm54', package_item_id: 'pm54', category: '检验科', sub_category: '肝胆功能', name: '白蛋白(ALB)', qty: 1, unit_price: 10, sub_item_names: [] },
        { id: 'm55', package_item_id: 'pm55', category: '检验科', sub_category: '肝胆功能', name: '谷丙转氨酶(ALT)', qty: 1, unit_price: 10, sub_item_names: [] },
        { id: 'm56', package_item_id: 'pm56', category: '检验科', sub_category: '肝胆功能', name: '谷草转氨酶(AST)', qty: 1, unit_price: 10, sub_item_names: [] },
        { id: 'm57', package_item_id: 'pm57', category: '检验科', sub_category: '肝胆功能', name: '谷氨酰转肽酶(GGT)', qty: 1, unit_price: 15, sub_item_names: [] },
        { id: 'm58', package_item_id: 'pm58', category: '检验科', sub_category: '肝胆功能', name: '碱性磷酸酶(ALP)', qty: 1, unit_price: 15, sub_item_names: [] },
        { id: 'm59', package_item_id: 'pm59', category: '检验科', sub_category: '肝胆功能', name: '肝胆酸(CG)', qty: 1, unit_price: 30, sub_item_names: [] },
        // 肾功能 6
        { id: 'm60', package_item_id: 'pm60', category: '检验科', sub_category: '肾功能', name: '尿酸(UA)', qty: 1, unit_price: 10, sub_item_names: [] },
        { id: 'm61', package_item_id: 'pm61', category: '检验科', sub_category: '肾功能', name: '尿素(Urea)', qty: 1, unit_price: 10, sub_item_names: [] },
        { id: 'm62', package_item_id: 'pm62', category: '检验科', sub_category: '肾功能', name: '肌酐(Cr)', qty: 1, unit_price: 10, sub_item_names: [] },
        { id: 'm63', package_item_id: 'pm63', category: '检验科', sub_category: '肾功能', name: '胱抑素C(Cys-C)', qty: 1, unit_price: 40, sub_item_names: [] },
        { id: 'm64', package_item_id: 'pm64', category: '检验科', sub_category: '肾功能', name: '估算肾小球滤过率(eGFR)', qty: 1, unit_price: 20, sub_item_names: [] },
        { id: 'm65', package_item_id: 'pm65', category: '检验科', sub_category: '肾功能', name: 'β2微球蛋白(β2-MG)', qty: 1, unit_price: 35, sub_item_names: [] },
        // 糖尿病 3
        { id: 'm70', package_item_id: 'pm70', category: '检验科', sub_category: '糖尿病筛查', name: '空腹血糖(GLU)', qty: 1, unit_price: 10, sub_item_names: [] },
        { id: 'm71', package_item_id: 'pm71', category: '检验科', sub_category: '糖尿病筛查', name: '糖化血红蛋白(HbA1c)', qty: 1, unit_price: 70, sub_item_names: [] },
        { id: 'm72', package_item_id: 'pm72', category: '检验科', sub_category: '糖尿病筛查', name: '胰岛素(INS)', qty: 1, unit_price: 45, sub_item_names: [] },
        // 肿瘤筛查 6
        { id: 'm80', package_item_id: 'pm80', category: '检验科', sub_category: '肿瘤标志物', name: '甲胎蛋白(AFP)', qty: 1, unit_price: 30, sub_item_names: [] },
        { id: 'm81', package_item_id: 'pm81', category: '检验科', sub_category: '肿瘤标志物', name: '癌胚抗原(CEA)', qty: 1, unit_price: 30, sub_item_names: [] },
        { id: 'm82', package_item_id: 'pm82', category: '检验科', sub_category: '肿瘤标志物', name: '糖类抗原CA19-9', qty: 1, unit_price: 90, sub_item_names: [] },
        { id: 'm83', package_item_id: 'pm83', category: '检验科', sub_category: '肿瘤标志物', name: '糖类抗原CA72-4', qty: 1, unit_price: 90, sub_item_names: [] },
        { id: 'm84', package_item_id: 'pm84', category: '检验科', sub_category: '肿瘤标志物', name: '前列腺特异性抗原(TPSA)', qty: 1, unit_price: 80, sub_item_names: [] },
        { id: 'm85', package_item_id: 'pm85', category: '检验科', sub_category: '肿瘤标志物', name: '游离前列腺特异性抗原(FPSA)', qty: 1, unit_price: 90, sub_item_names: [] },
      ],
    },
    female_married: {
      original_price: 3755, discount_price: 1400, discount_percent: 37.3,
      items: [
        { id: 'fm1', package_item_id: 'pfm1', category: '一般检查', sub_category: '基础体检', name: '一般检查', qty: 1, unit_price: 40, sub_item_names: [] },
        { id: 'fm2', package_item_id: 'pfm2', category: '体检检查', sub_category: '体格检查', name: '体检检查', qty: 1, unit_price: 25, sub_item_names: ['体重指数BMI', '血压', '脉搏'] },
        { id: 'fm3', package_item_id: 'pfm3', category: '心电图', sub_category: '心脑血管与血脂', name: '心电图(12导常规)', qty: 1, unit_price: 35, sub_item_names: [] },
        { id: 'fm4', package_item_id: 'pfm4', category: '放射科', sub_category: '影像检查', name: 'CT-胸部(低剂量)', qty: 1, unit_price: 300, sub_item_names: [] },
        { id: 'fm5', package_item_id: 'pfm5', category: '超声科', sub_category: '影像检查', name: '彩超-腹部', qty: 1, unit_price: 170, sub_item_names: [] },
        { id: 'fm6', package_item_id: 'pfm6', category: '超声科', sub_category: '影像检查', name: '彩超-甲状腺', qty: 1, unit_price: 100, sub_item_names: [] },
        { id: 'fm7', package_item_id: 'pfm7', category: '超声科', sub_category: '影像检查', name: '彩超-乳腺', qty: 1, unit_price: 140, sub_item_names: [] },
        { id: 'fm8', package_item_id: 'pfm8', category: '超声科', sub_category: '影像检查', name: '彩超-妇科', qty: 1, unit_price: 120, sub_item_names: [] },
        { id: 'fm9', package_item_id: 'pfm9', category: '检验科', sub_category: '肿瘤标志物', name: '甲胎蛋白(AFP)', qty: 1, unit_price: 30, sub_item_names: [] },
        { id: 'fm10', package_item_id: 'pfm10', category: '检验科', sub_category: '肿瘤标志物', name: '癌胚抗原(CEA)', qty: 1, unit_price: 30, sub_item_names: [] },
        { id: 'fm11', package_item_id: 'pfm11', category: '检验科', sub_category: '肿瘤标志物', name: '糖类抗原CA15-3', qty: 1, unit_price: 90, sub_item_names: [] },
        { id: 'fm12', package_item_id: 'pfm12', category: '检验科', sub_category: '肿瘤标志物', name: '糖类抗原CA12-5', qty: 1, unit_price: 90, sub_item_names: [] },
        { id: 'fm13', package_item_id: 'pfm13', category: '检验科', sub_category: '肿瘤标志物', name: '人附睾蛋白4(HE4)', qty: 1, unit_price: 120, sub_item_names: [] },
        { id: 'fm14', package_item_id: 'pfm14', category: '妇科', sub_category: '妇科两癌筛查', name: '妇科检查', qty: 1, unit_price: 30, sub_item_names: [] },
        { id: 'fm15', package_item_id: 'pfm15', category: '病理科', sub_category: '妇科两癌筛查', name: '液基薄层细胞检测(TCT)', qty: 1, unit_price: 150, sub_item_names: [] },
        { id: 'fm16', package_item_id: 'pfm16', category: '病理科', sub_category: '妇科两癌筛查', name: '人乳头瘤病毒检测(HPV高危分型)', qty: 1, unit_price: 280, sub_item_names: [] },
        { id: 'fm17', package_item_id: 'pfm17', category: '检验科', sub_category: '肝胆功能', name: '肝功能10项', qty: 1, unit_price: 130, sub_item_names: ['TBIL', 'DBIL', 'IBIL', 'TP', 'ALB', 'ALT', 'AST', 'GGT', 'ALP', 'CG'] },
        { id: 'fm18', package_item_id: 'pfm18', category: '检验科', sub_category: '肾功能', name: '肾功能6项', qty: 1, unit_price: 125, sub_item_names: ['UA', 'Urea', 'Cr', 'Cys-C', 'eGFR', 'β2-MG'] },
        { id: 'fm19', package_item_id: 'pfm19', category: '检验科', sub_category: '心脑血管与血脂', name: '血脂12项', qty: 1, unit_price: 455, sub_item_names: ['LDH','CK-MB','TCHO','TG','HDL-C','LDL-C','Lpa','Apo-A1','Apo-B','HCY','hs-CRP'] },
        { id: 'fm20', package_item_id: 'pfm20', category: '检验科', sub_category: '基础体检', name: '血常规', qty: 1, unit_price: 35, sub_item_names: [] },
        { id: 'fm21', package_item_id: 'pfm21', category: '检验科', sub_category: '基础体检', name: '尿常规', qty: 1, unit_price: 20, sub_item_names: [] },
        { id: 'fm22', package_item_id: 'pfm22', category: '检验科', sub_category: '糖尿病筛查', name: '空腹血糖+糖化', qty: 1, unit_price: 80, sub_item_names: ['GLU','HbA1c'] },
      ],
    },
    female_single: {
      original_price: 2880, discount_price: 1400, discount_percent: 48.6,
      items: [
        { id: 'fs1', package_item_id: 'pfs1', category: '一般检查', sub_category: '基础体检', name: '一般检查', qty: 1, unit_price: 40, sub_item_names: [] },
        { id: 'fs2', package_item_id: 'pfs2', category: '体检检查', sub_category: '体格检查', name: '体检检查', qty: 1, unit_price: 25, sub_item_names: ['体重指数BMI','血压'] },
        { id: 'fs3', package_item_id: 'pfs3', category: '心电图', sub_category: '心脑血管与血脂', name: '心电图(12导常规)', qty: 1, unit_price: 35, sub_item_names: [] },
        { id: 'fs4', package_item_id: 'pfs4', category: '放射科', sub_category: '影像检查', name: 'DR-胸部(正位)', qty: 1, unit_price: 80, sub_item_names: [] },
        { id: 'fs5', package_item_id: 'pfs5', category: '超声科', sub_category: '影像检查', name: '彩超-腹部', qty: 1, unit_price: 170, sub_item_names: [] },
        { id: 'fs6', package_item_id: 'pfs6', category: '超声科', sub_category: '影像检查', name: '彩超-甲状腺', qty: 1, unit_price: 100, sub_item_names: [] },
        { id: 'fs7', package_item_id: 'pfs7', category: '超声科', sub_category: '影像检查', name: '彩超-乳腺', qty: 1, unit_price: 140, sub_item_names: [] },
        { id: 'fs8', package_item_id: 'pfs8', category: '检验科', sub_category: '肿瘤标志物', name: 'AFP+CEA+CA153+CA125', qty: 1, unit_price: 240, sub_item_names: ['AFP','CEA','CA15-3','CA12-5'] },
        { id: 'fs9', package_item_id: 'pfs9', category: '检验科', sub_category: '肝胆功能', name: '肝功能8项', qty: 1, unit_price: 95, sub_item_names: ['TBIL','DBIL','TP','ALB','ALT','AST','GGT','ALP'] },
        { id: 'fs10', package_item_id: 'pfs10', category: '检验科', sub_category: '肾功能', name: '肾功能5项', qty: 1, unit_price: 80, sub_item_names: ['UA','Urea','Cr','Cys-C','eGFR'] },
        { id: 'fs11', package_item_id: 'pfs11', category: '检验科', sub_category: '心脑血管与血脂', name: '血脂8项', qty: 1, unit_price: 250, sub_item_names: ['TCHO','TG','HDL-C','LDL-C','Apo-A1','Apo-B','HCY','hs-CRP'] },
        { id: 'fs12', package_item_id: 'pfs12', category: '检验科', sub_category: '基础体检', name: '血常规', qty: 1, unit_price: 35, sub_item_names: [] },
        { id: 'fs13', package_item_id: 'pfs13', category: '检验科', sub_category: '基础体检', name: '尿常规', qty: 1, unit_price: 20, sub_item_names: [] },
        { id: 'fs14', package_item_id: 'pfs14', category: '检验科', sub_category: '基础体检', name: '尿沉渣', qty: 1, unit_price: 35, sub_item_names: [] },
        { id: 'fs15', package_item_id: 'pfs15', category: '检验科', sub_category: '基础体检', name: '粪常规+隐血', qty: 1, unit_price: 25, sub_item_names: [] },
        { id: 'fs16', package_item_id: 'pfs16', category: '检验科', sub_category: '糖尿病筛查', name: '空腹血糖(GLU)', qty: 1, unit_price: 10, sub_item_names: [] },
        { id: 'fs17', package_item_id: 'pfs17', category: '五官科', sub_category: '基础体检', name: '耳鼻喉+视力+眼压', qty: 1, unit_price: 70, sub_item_names: ['耳鼻喉科','视力','眼压'] },
        { id: 'fs18', package_item_id: 'pfs18', category: '功能科', sub_category: '心脑血管与血脂', name: '动脉硬化检测', qty: 1, unit_price: 90, sub_item_names: [] },
        { id: 'fs19', package_item_id: 'pfs19', category: '检验科', sub_category: '基础体检', name: ' ABO血型+Rh血型', qty: 1, unit_price: 50, sub_item_names: [] },
        { id: 'fs20', package_item_id: 'pfs20', category: '检验科', sub_category: '糖尿病筛查', name: '糖化血红蛋白', qty: 1, unit_price: 70, sub_item_names: [] },
      ],
    },
  },
};
const DEMO_COMPANY: BrandInfo = {
  name: '上海画一养生度假村',
  logo: null,
  slogan: '专注高端体检 · 为您定制专属方案',
  address: '上海市徐汇区康健路 1 号',
  phone: '400-001-1888',
  primary_color: '#134e3a', // 升级后的祖母绿默认色
};
const DEMO_SALES: SalesProfile = {
  user_id: 'sales-demo',
  name: '李健康',
  phone: '13800138000',
  avatar_url: null,
};
const DEMO_EXPIRE = '2026-09-05';

/* ---------------- 工具函数 ---------------- */
// 升级后的默认主色：祖母绿 #134e3a
const DEFAULT_PRIMARY = '#134e3a';

// shade: 正负 +/- percent。+更亮 / -更暗。0 返回原色。
function shade(hex: string, percent: number): string {
  const p = Math.max(-100, Math.min(100, percent));
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const num = parseInt(h, 16);
  let r = (num >> 16) & 0xff;
  let g = (num >> 8) & 0xff;
  let b = num & 0xff;
  const adjust = (c: number) =>
    p >= 0
      ? Math.round(c + ((255 - c) * p) / 100)
      : Math.round(c * (1 + p / 100));
  r = adjust(r); g = adjust(g); b = adjust(b);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

// 高亮行三色渐变（深绿 → 靛蓝 → 紫酱），提升节奏感
const HIGHLIGHT_DOT_COLORS = ['#134e3a', '#4338ca', '#7e22ce'];

function formatDiscount(pct: number | undefined | null): string {
  if (pct == null || isNaN(pct)) return '';
  const off = 100 - pct;
  // 折扣率 < 50 用折扣，>= 50 用 off%
  if (off <= 50) return `${(off / 10).toFixed(1)}折`;
  return `折扣 ${pct.toFixed(1)}%`;
}

const ROLE_EMOJI: Record<Role, string> = {
  male: '🧔‍♂️',
  female_married: '👩‍🦰',
  female_single: '👧',
};

/* ---------------- 主组件 ---------------- */
export default function SharePage() {
  const { token } = useParams();
  const [searchParams] = useSearchParams();
  const isDemo = searchParams.get('demo') === '1';
  const toast = useToast();

  const [pkg, setPkg] = useState<CheckupTemplate | null>(null);
  const [company, setCompany] = useState<BrandInfo | null>(null);
  const [sales, setSales] = useState<SalesProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [expireAt, setExpireAt] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [invalid, setInvalid] = useState(false);

  // ===== C (Q5) 折叠控制 =====
  // 默认全部收起，客户按需展开
  const [expanded, setExpanded] = useState<Record<Role, boolean>>({
    male: false, female_married: false, female_single: false,
  });
  // 分类折叠：Record<`${role}-${sub_category}-expanded`, boolean>
  const [catExpanded, setCatExpanded] = useState<Record<string, boolean>>({});
  const isCatExpanded = (role: Role, sub: string) => !!catExpanded[`${role}-${sub}-expanded`];
  const toggleCat = (role: Role, sub: string) =>
    setCatExpanded((s) => ({ ...s, [`${role}-${sub}-expanded`]: !s[`${role}-${sub}-expanded`] }));

  // 组合项目子项
  const [expandedCombos, setExpandedCombos] = useState<Record<string, boolean>>({});
  const toggleCombo = (itemId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedCombos((s) => ({ ...s, [itemId]: !s[itemId] }));
  };

  // 每个分类默认显示前 4 项，超出点击再展开
  const DEFAULT_CAT_ITEMS_SHOW = 4;

  // 角色卡 DOM ref 用于快速跳转 scrollIntoView
  const roleCardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  /* ---------- 数据加载 ---------- */
  useEffect(() => {
    if (isDemo) {
      // Demo 模式：延迟 400ms 给点加载反馈，然后填充假数据
      setLoading(true);
      const t = setTimeout(() => {
        setPkg(DEMO_PKG);
        setCompany(DEMO_COMPANY);
        setSales(DEMO_SALES);
        setExpireAt(DEMO_EXPIRE);
        setExpired(false);
        setInvalid(false);
        setLoading(false);
      }, 400);
      return () => clearTimeout(t);
    }
    if (!token) return;
    Promise.all([
      anonymousFetch('/api/booking/checkup-share/' + encodeURIComponent(token)),
      anonymousFetch('/api/booking/checkup-share/brand-config'),
    ]).then(([r, brandR]) => {
      if (r?.ok) {
        const d = r.data || {};
        const tpl: CheckupTemplate = {
          id: d.id, code: d.code, name: d.name, description: d.description,
          applicable_roles: d.applicable_roles,
          created_at: d.created_at,
          role_plans: d.role_plans,
        };
        setPkg(tpl);
        const comp = (brandR?.ok && brandR.data) || d.company || null;
        if (comp) {
          setCompany({
            name: comp.name || '体检中心',
            logo: comp.logo || null,
            slogan: comp.slogan || null,
            address: comp.address || null,
            phone: comp.phone || null,
            primary_color: comp.primary_color || DEFAULT_PRIMARY,
          });
        }
        if (d.sales) setSales(d.sales);
        if (d.expire_at) setExpireAt(d.expire_at);
        if (d.expired) setExpired(true);
      } else if (r?.error === 'invalid') {
        setInvalid(true);
      } else if (r?.error === 'expired') {
        setExpired(true);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [token, isDemo]);

  /* ---------- 派生：主色（品牌配置优先，否则默认祖母绿） ---------- */
  const primaryColor = company?.primary_color || DEFAULT_PRIMARY;

  /* ---------- 派生：全部角色的去重项目 ---------- */
  const allItems = useMemo<CheckupItemRef[]>(() => {
    if (!pkg) return [];
    const seen = new Set<string>();
    const arr: CheckupItemRef[] = [];
    for (const role of pkg.applicable_roles) {
      for (const it of pkg.role_plans[role].items) {
        if (!seen.has(it.id)) { seen.add(it.id); arr.push(it); }
      }
    }
    return arr;
  }, [pkg]);

  const totalItems = allItems.length;

  /* ---------- B (Q2)：亮点 → 数据驱动，1-3 条浮动，不凑数 ---------- */
  const highlights = useMemo<{ text: string; dot: string }[]>(() => {
    if (!pkg) return [];
    const hs: { text: string; dot: string }[] = [];
    // 亮点 1：项目总数（必含）
    hs.push({ text: `🧪 ${totalItems} 项深度检查`, dot: HIGHLIGHT_DOT_COLORS[0] });

    // 分类计数（按 sub_category / displayCategory 聚合）
    const catCount = new Map<string, number>();
    for (const it of allItems) {
      const bucket = displayCategory(it);
      catCount.set(bucket, (catCount.get(bucket) || 0) + (it.qty || 1));
    }

    // 亮点 2：Top 1 大分类，含明细
    let topCat = ''; let topCount = 0;
    for (const [c, n] of catCount) if (n > topCount) { topCat = c; topCount = n; }
    if (topCat && topCount >= 3) {
      const subHints: string[] = [];
      const sampleKws: Record<string, string[]> = {
        '影像检查': ['CT', '彩超', '钼靶', 'DR'],
        '心脑血管与血脂': ['心电图', '颈动脉彩超', '动脉硬化'],
        '肿瘤标志物': ['AFP', 'CEA', 'CA系列', 'PSA'],
        '肝胆功能': ['ALT', 'AST', '胆红素'],
        '肾功能': ['肌酐', '尿酸', '胱抑素C'],
        '糖尿病筛查': ['空腹血糖', '糖化', '胰岛素'],
        '妇科两癌筛查': ['TCT', 'HPV', '乳腺'],
      };
      for (const kw of sampleKws[topCat] || []) {
        if (allItems.some((it) => (it.category + it.name).includes(kw))) subHints.push(kw);
      }
      const tail = subHints.length ? `（${subHints.slice(0, 3).join(' / ')}${subHints.length > 3 ? '等' : ''}）` : '';
      hs.push({ text: `🩻 ${topCat} ${topCount} 项${tail}`, dot: HIGHLIGHT_DOT_COLORS[1] });
    }

    // 亮点 3：角色专属特色（有则显示，没就算了，不凑）
    const hasMale = pkg.applicable_roles.includes('male');
    const hasFemale = pkg.applicable_roles.includes('female_married') || pkg.applicable_roles.includes('female_single');
    const hasTctHpv = allItems.some((it) => /TCT|液基|HPV|乳头瘤/i.test(it.name) || /两癌/.test(it.sub_category || ''));
    const hasPsa = allItems.some((it) => /PSA|前列腺特异/i.test(it.name));
    if (hasFemale && hasTctHpv) {
      hs.push({ text: `♀️ 已婚女专属 · 含 TCT + HPV 两癌筛查`, dot: HIGHLIGHT_DOT_COLORS[2] });
    } else if (hasMale && hasPsa) {
      hs.push({ text: `♂️ 男性专属 · 含 PSA（总+游离）前列腺筛查`, dot: HIGHLIGHT_DOT_COLORS[2] });
    }
    // 注意：废除兜底凑数文案（不再硬塞"出报告/客户经理"），宁缺毋滥
    return hs;
  }, [pkg, totalItems, allItems]);

  /* ---------- 派生：按角色分组（sub_category → items[]）并统计 ---------- */
  function groupByCategory(role: Role) {
    if (!pkg) return [] as { sub: string; items: CheckupItemRef[] }[];
    const m = new Map<string, CheckupItemRef[]>();
    for (const it of pkg.role_plans[role].items) {
      const bucket = displayCategory(it);
      if (!m.has(bucket)) m.set(bucket, []);
      m.get(bucket)!.push(it);
    }
    return Array.from(m, ([sub, items]) => ({ sub, items }));
  }

  const roleItemCount = (r: Role) => pkg?.role_plans[r].items.length || 0;

  /* ---------- 动作 ---------- */
  const handlePdf = (which: 'all' | Role) => {
    if (isDemo) { toast('演示模式暂不提供真实 PDF 下载'); return; }
    if (!token) return;
    const url = `/api/booking/checkup-share/${encodeURIComponent(token)}/pdf${which === 'all' ? '' : '?role=' + which}`;
    window.open(url, '_blank');
  };
  const handleCall = () => {
    const p = sales?.phone || company?.phone;
    if (!p) return;
    window.location.href = 'tel:' + p.replace(/[^\d+]/g, '');
  };
  const handleCopyPhone = async () => {
    const p = sales?.phone || company?.phone;
    if (!p) return;
    try {
      await navigator.clipboard.writeText(p);
      toast('号码已复制：' + p);
    } catch {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = p;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      toast('号码已复制：' + p);
    }
  };

  const jumpToRole = (r: Role) => {
    const el = roleCardRefs.current[r];
    if (!el) return;
    setExpanded((prev) => ({ ...prev, [r]: true }));
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /* ---------- 错误态 ---------- */
  if (!isDemo && invalid) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md text-center">
          <div className="w-16 h-16 mx-auto rounded-full bg-red-100 flex items-center justify-center text-red-600 text-3xl mb-4">⚠️</div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">分享链接已失效</h2>
          <p className="text-gray-500 text-sm">请联系客户经理获取最新的套餐分享链接</p>
          {company?.phone && (
            <button onClick={handleCall} className="mt-6 px-6 py-3 rounded-xl text-white font-semibold" style={{ backgroundColor: primaryColor }}>
              📞 联系咨询
            </button>
          )}
        </div>
      </div>
    );
  }
  if (!isDemo && expired) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md text-center">
          <div className="w-16 h-16 mx-auto rounded-full bg-amber-100 flex items-center justify-center text-amber-600 text-3xl mb-4">⌛</div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">报价已过期</h2>
          <p className="text-gray-500 text-sm">该套餐报价超过有效期，请联系客户经理重新报价</p>
          {company?.phone && (
            <button onClick={handleCall} className="mt-6 px-6 py-3 rounded-xl text-white font-semibold" style={{ backgroundColor: primaryColor }}>
              📞 联系重新报价
            </button>
          )}
        </div>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-4 border-gray-200" style={{ borderTopColor: primaryColor, animation: 'spin 1s linear infinite' }} />
          <div className="text-gray-500 text-sm">正在加载体检方案…</div>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }
  if (!pkg) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md text-center">
          <h2 className="text-lg font-bold text-gray-800 mb-2">套餐不存在</h2>
          <p className="text-gray-500 text-sm">分享链接无法识别，请检查链接是否完整</p>
        </div>
      </div>
    );
  }

  /* ======================== 正常渲染 ======================== */
  const roleBg = (r: Role) => (
    r === 'male' ? '#eff6ff' : (r === 'female_married' ? '#fae8ff' : '#fdf2f8')
  );
  // 4-stop 祖母绿渐变（绿头）：亮绿高光 → 主体 → 暗部 → 底部压黑纱
  const headerBg = `linear-gradient(160deg, ${shade(primaryColor, 30)} 0%, ${shade(primaryColor, 10)} 25%, ${primaryColor} 65%, ${shade(primaryColor, -28)} 100%)`;
  // 双层柔光阴影（卡片）
  const cardShadow = '0 1px 2px rgba(15,23,42,0.06), 0 8px 20px -18px rgba(15,23,42,0.18), inset 0 1px 0 rgba(255,255,255,0.75)';
  // 主 CTA 按钮：渐变 + 顶部高光 + 双层阴影
  const ctaStyle = {
    backgroundImage: `linear-gradient(135deg, ${shade(primaryColor, 18)} 0%, ${primaryColor} 55%, ${shade(primaryColor, -18)} 100%)`,
    boxShadow: `0 12px 28px -20px ${shade(primaryColor, -20)}aa, 0 2px 6px -2px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.32)`,
  };
  const pageBg = `linear-gradient(180deg, #fafbf9 0%, #f4f1e6 45%, #ebe6d6 100%)`;

  return (
    <div className="min-h-full min-h-screen w-full" style={{ backgroundImage: pageBg }}>
      {/* ===== Q1: 缩头 h-64→h-44 ===== */}
      <div
        className="relative w-full overflow-hidden text-white"
        style={{ height: '11rem', backgroundImage: headerBg, borderBottomLeftRadius: '36px', borderBottomRightRadius: '36px' }}
      >
        {/* 装饰光斑 3 个（左下 / 右上 / 中下 错落） */}
        <div className="pointer-events-none absolute -left-6 -bottom-16 w-52 h-52 rounded-full opacity-20" style={{ backgroundColor: shade(primaryColor, 40) }} />
        <div className="pointer-events-none absolute -right-10 top-8 w-40 h-40 rounded-full opacity-20" style={{ backgroundColor: shade(primaryColor, 35), filter: 'blur(4px)' }} />
        <div className="pointer-events-none absolute left-1/3 bottom-0 w-28 h-28 rounded-full opacity-15" style={{ backgroundColor: shade(primaryColor, 50), filter: 'blur(8px)' }} />
        <div className="pointer-events-none absolute inset-0 opacity-60" style={{ backgroundImage: 'linear-gradient(to bottom, rgba(0,0,0,0), rgba(0,0,0,0.08))' }} />

        {/* Q1: pt-8→pt-5 pb-36→pb-24 */}
        <div className="relative px-5 pt-5 pb-24 max-w-2xl mx-auto">
          {/* 品牌条 */}
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center text-lg" aria-hidden>
              {company?.logo ? <img src={company.logo} alt="" className="w-full h-full rounded-xl object-cover" /> : '🏥'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-[15px] leading-tight truncate">{company?.name || '体检中心'}</div>
              {company?.slogan && <div className="text-[11px] text-white/80 mt-0.5 truncate">{company.slogan}</div>}
            </div>
            {isDemo && (
              <div className="text-[10px] px-2 py-1 rounded-full bg-white/20 border border-white/25">演示 Demo</div>
            )}
          </div>

          {/* 套餐标题 + 角色标签 + 有效期 */}
          <h1 className="font-bold text-[20px] leading-tight text-center mb-2.5">{pkg.name}</h1>
          <div className="flex items-center justify-center flex-wrap gap-1.5 mb-2">
            {pkg.applicable_roles.map((r) => (
              <span key={r} className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-white/12 border border-white/20 text-[11px] text-white/95">
                <span>{ROLE_EMOJI[r]}</span>
                <span className="font-medium">{ROLE_LABEL[r]}</span>
              </span>
            ))}
          </div>
          {expireAt && (
            <div className="flex items-center justify-center text-[11px] text-white/90">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mr-1 opacity-80" aria-hidden>
                <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" strokeLinecap="round" />
              </svg>
              有效期至 {expireAt}
            </div>
          )}
        </div>
      </div>

      {/* ===== 主内容区：-mt-28 → -mt-16 ===== */}
      <main className="relative -mt-16 px-4 pb-28 max-w-2xl mx-auto">
        {/* ---------- 亮点卡片 ---------- */}
        <section className="bg-white border border-gray-100/70 rounded-2xl px-5 py-4 mb-3" style={{ boxShadow: cardShadow }}>
          <div className="text-[12.5px] font-semibold mb-3" style={{ color: shade(primaryColor, -2) }}>✨ 本方案亮点</div>
          <ul className="space-y-2">
            {highlights.map((h, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span className="inline-block w-1.5 h-1.5 mt-2.5 rounded-full shrink-0" style={{ backgroundColor: h.dot }} />
                <span className="text-[13.5px] text-gray-700 leading-relaxed">{h.text}</span>
              </li>
            ))}
            {highlights.length === 0 && (
              <li className="text-[13.5px] text-gray-500">具体检查项目请参考下方各人群方案。</li>
            )}
          </ul>
          {pkg.description && (
            <div className="mt-3.5 pt-3 border-t border-dashed border-gray-100 text-[12px] text-gray-500 leading-relaxed" style={{ background: 'linear-gradient(180deg, #fffbeb00, #fffbeb55); border-radius:10px; padding: 8px 10px; margin-top: 10px;' }}>
              💬 {pkg.description}
            </div>
          )}
        </section>

        {/* ---------- C (Q5) 新增：角色快速跳转胶囊 ---------- */}
        <section className="flex items-center gap-2 justify-center mb-3 px-2 flex-wrap">
          {pkg.applicable_roles.map((r) => (
            <button
              key={r}
              onClick={() => jumpToRole(r)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white border text-[12px] font-medium text-gray-700 active:scale-95 transition"
              style={{ boxShadow: cardShadow, borderColor: `${primaryColor}18` }}
            >
              <span>{ROLE_EMOJI[r]}</span>
              <span>{ROLE_LABEL[r]}方案</span>
              <span className="text-gray-400 font-normal">· {roleItemCount(r)}项</span>
            </button>
          ))}
        </section>

        {/* ---------- 角色方案卡 ---------- */}
        {pkg.applicable_roles.map((r) => {
          const plan = pkg.role_plans[r];
          const groups = groupByCategory(r);
          const open = expanded[r];
          const total = plan.items.length;
          const priceBig = plan.discount_price != null;
          const saved = (plan.original_price ?? 0) - (plan.discount_price ?? plan.price ?? 0); // 保留变量，只不渲染
          const discLine = formatDiscount(plan.discount_percent);
          const subCatColors = ['#134e3a', '#0f766e', '#4338ca', '#7e22ce', '#c026d3', '#be123c', '#b45309', '#365314'];
          return (
            <div
              key={r}
              ref={(el) => { roleCardRefs.current[r] = el; }}
              className="bg-white border border-gray-100/70 rounded-2xl mb-3 overflow-hidden"
              style={{ boxShadow: cardShadow }}
            >
              {/* 卡片头 */}
              <button
                onClick={() => setExpanded((p) => ({ ...p, [r]: !p[r] }))}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
              >
                <div className="w-11 h-11 rounded-xl shrink-0 flex items-center justify-center text-[20px]" style={{ backgroundColor: roleBg(r) }}>
                  {ROLE_EMOJI[r]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] font-bold text-gray-800">{ROLE_LABEL[r]}方案</span>
                    {/* Q4：立省徽章已删除 */}
                  </div>
                  <div className="flex items-center gap-2.5 mt-1 text-[11.5px] text-gray-500">
                    <span className="inline-flex items-center gap-1">
                      <span>🧪</span>{total}项检查
                    </span>
                    {plan.original_price != null && priceBig && (
                      <span className="line-through decoration-gray-300">原价 ¥{plan.original_price}</span>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-bold" style={{ color: primaryColor, fontSize: priceBig ? '24px' : '16px', lineHeight: 1 }}>
                    <span className="align-top" style={{ fontSize: '14px' }}>¥</span>
                    <span className="ml-0.5">{priceBig ? plan.discount_price : (plan.price ?? '—')}</span>
                  </div>
                  <div className="mt-1 text-[11px] font-medium flex items-center justify-end gap-1"
                       style={{ color: shade(primaryColor, -6) }}>
                    {/* Q4：🎁 emoji 删除，折扣颜色改为同色系浅绿 */}
                    {discLine}
                  </div>
                </div>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                     className={`shrink-0 ml-1 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>

              {/* 展开的项目区 */}
              {open && (
                <div className="px-4 pb-4 space-y-3 border-t border-gray-50 pt-3">
                  {groups.map((g, gi) => {
                    const scOpen = isCatExpanded(r, g.sub);
                    const showItems = scOpen ? g.items : g.items.slice(0, DEFAULT_CAT_ITEMS_SHOW);
                    const remaining = g.items.length - DEFAULT_CAT_ITEMS_SHOW;
                    const cColor = subCatColors[gi % subCatColors.length];
                    return (
                      <div key={g.sub} className="rounded-xl overflow-hidden" style={{ backgroundColor: `${cColor}0a` }}>
                        <div className="flex items-center gap-2 px-3 py-2" style={{ borderLeft: `3px solid ${cColor}` }}>
                          <span className="text-[12.5px] font-semibold" style={{ color: cColor }}>{g.sub}</span>
                          <span className="text-[10.5px] px-1.5 py-0.5 rounded-md bg-white/70 text-gray-500 border border-gray-100">{g.items.length}项</span>
                        </div>
                        <div className="px-3 pt-1 pb-2 divide-y divide-gray-100/70">
                          {showItems.map((it) => {
                            const hasCombo = it.sub_item_names && it.sub_item_names.length > 0;
                            const comboOpen = !!expandedCombos[it.package_item_id || it.id];
                            return (
                              <div key={it.package_item_id || it.id} className="py-2">
                                <div className="flex items-start gap-2">
                                  {hasCombo ? (
                                    <button
                                      onClick={(e) => toggleCombo(it.package_item_id || it.id, e)}
                                      className="mt-0.5 text-gray-400 hover:text-gray-600 shrink-0 w-4 h-4 flex items-center justify-center"
                                      aria-label={comboOpen ? '收起子项' : '展开子项'}
                                    >
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                                           className={`transition-transform ${comboOpen ? 'rotate-90' : ''}`}>
                                        <polyline points="9 18 15 12 9 6" />
                                      </svg>
                                    </button>
                                  ) : (
                                    <span className="inline-block w-1 h-1 rounded-full bg-gray-300 mt-2 mx-1.5 shrink-0" />
                                  )}
                                  <div className="flex-1 min-w-0">
                                    <div className="text-[13px] text-gray-800 leading-snug">
                                      {it.name}
                                      {it.qty > 1 && <span className="text-gray-400 text-[11px] ml-1">×{it.qty}</span>}
                                    </div>
                                    {hasCombo && comboOpen && (
                                      <div className="mt-1.5 ml-0.5 rounded-lg border border-gray-100 bg-white/70 py-1.5 px-2.5 space-y-1">
                                        {it.sub_item_names!.map((s, i) => (
                                          <div key={i} className="text-[11.5px] text-gray-500 leading-snug flex items-start gap-1.5">
                                            <span className="mt-1 inline-block w-[3px] h-[3px] rounded-full bg-gray-300 shrink-0" />
                                            <span>{s}</span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                          {!scOpen && remaining > 0 && (
                            <button
                              onClick={() => toggleCat(r, g.sub)}
                              className="w-full mt-1 py-1.5 rounded-lg text-[11.5px] font-medium flex items-center justify-center gap-1"
                              style={{ color: cColor, backgroundColor: `${cColor}10` }}
                            >
                              展开剩余 {remaining} 项
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="6 9 12 15 18 9" />
                              </svg>
                            </button>
                          )}
                          {scOpen && remaining > 0 && (
                            <button
                              onClick={() => toggleCat(r, g.sub)}
                              className="w-full mt-1 py-1.5 rounded-lg text-[11.5px] text-gray-500 font-medium flex items-center justify-center gap-1 bg-gray-50"
                            >
                              收起
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="rotate-180">
                                <polyline points="6 9 12 15 18 9" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* 角色合计行 */}
                  <div className="flex items-center justify-between mt-1 px-3 py-2.5 rounded-xl"
                       style={{ backgroundColor: `${primaryColor}0d`, border: `1px solid ${primaryColor}16` }}>
                    <div className="text-[12px] text-gray-600">{ROLE_LABEL[r]}合计 · 共 {total} 项</div>
                    <div className="text-right">
                      <span className="text-[11px] text-gray-400 mr-2 line-through decoration-gray-300">
                        原价 ¥{plan.original_price ?? '—'}
                      </span>
                      <span className="font-bold text-[16px]" style={{ color: primaryColor }}>
                        ¥{priceBig ? plan.discount_price : (plan.price ?? '—')}
                      </span>
                    </div>
                  </div>

                  {/* 单人下载 PDF 小按钮 */}
                  <button
                    onClick={() => handlePdf(r)}
                    className="w-full mt-1 py-2 rounded-xl text-[12px] font-medium flex items-center justify-center gap-1.5 active:scale-[0.98] transition"
                    style={{
                      color: primaryColor,
                      backgroundColor: `${primaryColor}10`,
                      border: `1px solid ${primaryColor}22`,
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    下载{ROLE_LABEL[r]}单人方案
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {/* ---------- 下载完整 PDF 大卡（G：副行文案改） ---------- */}
        <section className="bg-white border border-gray-100/70 rounded-2xl px-5 py-4 mb-3 flex items-center gap-4" style={{ boxShadow: cardShadow }}>
          <div className="w-10 h-10 rounded-xl shrink-0 flex items-center justify-center text-[18px]"
               style={{ backgroundColor: `${primaryColor}10`, color: primaryColor }}>
            📄
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-semibold text-gray-800">下载 PDF 方案</div>
            <div className="text-[11.5px] text-gray-500 mt-0.5">保存到本地，打印或转发都方便</div>
          </div>
          <button
            onClick={() => handlePdf('all')}
            className="shrink-0 px-3.5 py-2 rounded-xl text-[12px] font-semibold text-white active:scale-[0.97] transition"
            style={ctaStyle}
          >
            立即下载
          </button>
        </section>

        {/* ---------- 客户经理卡片 ---------- */}
        {sales && (
          <section className="bg-white border border-gray-100/70 rounded-2xl px-5 py-4 mb-3 flex items-center gap-3" style={{ boxShadow: cardShadow }}>
            <div className="w-11 h-11 rounded-full shrink-0 flex items-center justify-center text-[18px] bg-gradient-to-br from-gray-100 to-gray-200 overflow-hidden">
              {sales.avatar_url ? <img src={sales.avatar_url} alt="" className="w-full h-full object-cover" /> : '👤'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-semibold text-gray-800">
                {sales.name}
                <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded text-white" style={{ backgroundColor: primaryColor }}>客户经理</span>
              </div>
              {sales.phone && <div className="text-[12px] text-gray-500 mt-0.5">📱 {sales.phone}</div>}
            </div>
            {sales.phone && (
              <button
                onClick={handleCall}
                className="shrink-0 px-3 py-1.5 rounded-lg text-[12px] font-medium flex items-center gap-1 active:scale-[0.97] transition"
                style={{ color: primaryColor, border: `1px solid ${primaryColor}30`, backgroundColor: `${primaryColor}0a` }}
              >
                📞 咨询
              </button>
            )}
          </section>
        )}

        {/* ---------- 公司信息 ---------- */}
        {company && (company.address || company.phone) && (
          <section className="text-center px-4 pb-2 mt-4 text-[11px] text-gray-400 leading-relaxed">
            <div className="font-medium text-gray-500">{company.name}</div>
            {company.address && <div className="mt-0.5">📍 {company.address}</div>}
            {company.phone && <div className="mt-0.5">📞 {company.phone}</div>}
          </section>
        )}
      </main>

      {/* ===== 底部吸底 CTA ===== */}
      <div className="fixed bottom-0 left-0 right-0 z-50">
        <div className="max-w-2xl mx-auto bg-white/90 backdrop-blur-md border-t border-gray-100 px-4 py-2.5 flex items-center gap-2.5 pb-[calc(10px+env(safe-area-inset-bottom))]">
          <button
            onClick={handleCall}
            className="shrink-0 flex flex-col items-center justify-center w-16 py-1 rounded-xl active:bg-gray-50"
          >
            <div className="text-[20px]" style={{ color: primaryColor }}>📞</div>
            <div className="text-[10px] text-gray-600 mt-0.5">联系咨询</div>
          </button>
          <button
            onClick={handleCopyPhone}
            className="shrink-0 flex flex-col items-center justify-center w-16 py-1 rounded-xl active:bg-gray-50"
          >
            <div className="text-[20px]">📋</div>
            <div className="text-[10px] text-gray-600 mt-0.5">复制号码</div>
          </button>
          <button
            onClick={() => handlePdf('all')}
            className="flex-1 h-11 rounded-2xl text-white font-semibold flex items-center justify-center gap-2 active:scale-[0.98] transition"
            style={ctaStyle}
          >
            <span className="flex flex-col items-start leading-tight">
              <span className="text-[15px]">下载完整 PDF</span>
              {/* Q6 G：副行文案改为"3 个人群 · 完整方案"（不再误导说含价格明细） */}
              <span className="text-[10.5px] font-normal text-white/85">
                {pkg.applicable_roles.length} 个人群 · 完整方案
              </span>
            </span>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
