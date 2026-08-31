import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { checkupApi } from './api';
import { useToast } from '@/components/Toast';

/* ================== 类型定义 ================== */
type Role = 'male' | 'female_married' | 'female_unmarried' | 'female_single';
type RoleNorm = 'male' | 'female_married' | 'female_unmarried';
interface CheckupItem {
  id: number | string;
  name: string;
  qty?: number;
  sub_category?: string;
  sub_item_names?: string[];
  unit?: string;
  remark?: string;
  price?: number;
}
interface RolePkg {
  role: Role;
  price: number;
  original_price?: number;
  items: CheckupItem[];
}
interface TemplatePkg {
  id: number | string;
  name: string;
  applicable_roles: Role[];
  remark?: string;
  highlight?: string[];
  primary_color?: string;
  expire_at?: string;
  created_at?: string;
  company?: { name?: string; slogan?: string; logo?: string; phone?: string };
  salesman?: { name?: string; title?: string; phone?: string };
  role_packages?: RolePkg[];
  _male?: RolePkg;
  _female_married?: RolePkg;
  _female_unmarried?: RolePkg;
  _female_single?: RolePkg;
}

/* ================== 常量 / 显示映射 ================== */
// 兼容后端 key：female_single 等同 female_unmarried（别名归一）
const NORM_ROLE = (r: Role | string | null | undefined): RoleNorm | null => {
  if (!r) return null;
  if (r === 'male') return 'male';
  if (r === 'female_married') return 'female_married';
  if (r === 'female_unmarried' || r === 'female_single') return 'female_unmarried';
  return null;
};
const ROLE_LABEL: Record<RoleNorm, string> = {
  male: '男性方案',
  female_married: '已婚女性方案',
  female_unmarried: '未婚女性方案',
};
const ROLE_EMOJI: Record<RoleNorm, string> = { male: '👨', female_married: '👩', female_unmarried: '👧' };

// iOS 健康 App 同款低饱和色板（分类用，避开深 800 档）
const SUB_DISPLAY_NAME: Record<string, { name: string; color: string }> = {
  general:   { name: '一般检查', color: '#059669' },
  lab:       { name: '实验室检查', color: '#0d9488' },
  imaging:   { name: '影像检查', color: '#6366f1' },
  function:  { name: '功能检查', color: '#8b5cf6' },
  tumor:     { name: '肿瘤筛查', color: '#d946ef' },
  endocrine:  { name: '内分泌代谢', color: '#f43f5e' },
  cardio:    { name: '心脑血管', color: '#ea580c' },
  digestive: { name: '消化系统', color: '#65a30d' },
  resp:      { name: '呼吸系统', color: '#0891b2' },
  bone:      { name: '骨密度/骨科', color: '#4f46e5' },
  eye:       { name: '眼科检查', color: '#4ade80' },
  ent:       { name: '耳鼻喉/口腔', color: '#fb923c' },
  gynecology:{ name: '妇科检查', color: '#ec4899' },
  other:     { name: '其他项目', color: '#64748b' },
};
const SUB_FALLBACK_COLORS = Object.values(SUB_DISPLAY_NAME).map((c) => c.color);
function subInfo(subKey?: string) {
  if (!subKey) return { name: '综合检查', color: SUB_FALLBACK_COLORS[0] };
  const k = subKey.toLowerCase();
  if (SUB_DISPLAY_NAME[k]) return SUB_DISPLAY_NAME[k];
  const keys = Object.keys(SUB_DISPLAY_NAME);
  for (const key of keys) if (k.includes(key) || key.includes(k)) return SUB_DISPLAY_NAME[key];
  let h = 0;
  for (let i = 0; i < subKey.length; i++) h = (h * 31 + subKey.charCodeAt(i)) >>> 0;
  const c = SUB_FALLBACK_COLORS[h % SUB_FALLBACK_COLORS.length];
  return { name: subKey, color: c };
}

/* ---------------- 工具函数 ---------------- */
const DEFAULT_PRIMARY = '#1dbf9a';
function shade(hex: string, percent: number): string {
  const p = Math.max(-100, Math.min(100, percent));
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const num = parseInt(h, 16);
  let r = (num >> 16) & 0xff;
  let g = (num >> 8) & 0xff;
  let b = num & 0xff;
  if (p >= 0) {
    r = Math.round(r + (255 - r) * (p / 100));
    g = Math.round(g + (255 - g) * (p / 100));
    b = Math.round(b + (255 - b) * (p / 100));
  } else {
    const k = 1 + p / 100;
    r = Math.round(r * k);
    g = Math.round(g * k);
    b = Math.round(b * k);
  }
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}
function displayCategory(it: CheckupItem): string {
  return it.sub_category || '综合检查';
}
function parseDD(dateStr?: string | null) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}
function splitHighlight(text: string) {
  const re = /([,.，。、])/g;
  const idxs: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) idxs.push(m.index);
  if (idxs.length === 0) return { head: text, tail: '' };
  const cut = (idxs[1] ?? idxs[0]) + 1;
  return { head: text.slice(0, cut), tail: text.slice(cut).trim() };
}
function truncate(s: string, n = 6): string {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}
/* unused after highlight rewrite */
void truncate;

/* =========================================================
   DEMO 模式：?demo=1 → 无需后端即可预览全套 UI
   ========================================================= */
function makeDemoPkg(): TemplatePkg {
  const categories: [string, string[]][] = [
    ['general',   ['身高体重BMI', '血压心率', '血氧', '体温测量', '视力', '听力', '体脂率', '基础代谢', '腰围臀围', '四肢围度', '脊柱外形', '皮肤初筛', '口腔视诊', '耳鼻喉初查']],
    ['lab',       ['血常规23项', '血糖', '肝功9项', '肾功5项', '血脂6项', '尿常规14项', '同型半胱氨酸', '甲状腺功能5项', '糖化血红蛋白', '幽门螺杆菌抗体', 'EB病毒抗体', '乙肝两对半', '肿瘤标志物5项', '维生素D']],
    ['imaging',   ['胸部正位DR', '颈椎正侧DR', '腹部彩超', '甲状腺彩超', '颈动脉彩超', '泌尿系彩超', '头颅CT', '胸部CT（低剂量）', '腰椎MRI', '骨密度']],
    ['function',  ['静息心电图', '动脉硬化检测', '肺功能通气', '经颅多普勒(TCD)', '24h动态心电图', '脑电图', '心脏彩超', '运动平板', '眼底照相']],
    ['tumor',     ['AFP', 'CEA', 'CA19-9', 'CA125', 'CA153', 'PSA', 'TSGF', 'SCCA', 'CYFRA21-1', 'NSE']],
    ['endocrine', ['甲功5项', '性激素6项', '胰岛素抗体', '皮质醇节律', '生长激素']],
    ['cardio',    ['血脂6项', '同型半胱氨酸', '颈动脉彩超', '心脏彩超', '动脉硬化', '心电图', '24h动态血压', '冠脉CTA评估']],
    ['digestive', ['腹部彩超', '肝功9项', '幽门螺杆菌C14', '胃镜', '肠镜', '便潜血', '胆囊收缩功能']],
    ['eye',       ['视力', '眼压', '眼底照相', '视网膜OCT', '视野筛查', '色觉']],
    ['ent',       ['电测听', '鼻内镜', '咽喉镜', '口腔全景片', '颞下颌关节']],
  ];
  const makeItems = (spec: Record<string, number>, extraSub?: Record<string, string[][]>): CheckupItem[] => {
    const out: CheckupItem[] = [];
    let idSeed = 1;
    for (const [key, count] of Object.entries(spec)) {
      const cat = categories.find((c) => c[0] === key);
      if (!cat) continue;
      const names = cat[1].slice(0, Math.min(count, cat[1].length));
      for (let i = 0; i < names.length; i++) {
        const subs = extraSub?.[`${key}-${i}`];
        out.push({ id: idSeed++, name: names[i], qty: 1, sub_category: key, sub_item_names: subs });
      }
    }
    return out;
  };
  const male = makeItems(
    { general: 14, lab: 14, imaging: 10, function: 5, tumor: 6, cardio: 2, endocrine: 3 },
    {
      'lab-13': ['总25羟维生素D', 'D2/D3比例'],
      'imaging-3': ['甲状腺左叶', '甲状腺右叶', '峡部大小', '血流信号'],
      'function-0': ['窦性心律评估', 'ST段', 'T波', 'QT间期'],
      'tumor-5': ['总PSA', '游离PSA', 'fPSA/PSA比值'],
    },
  );
  const married = makeItems(
    { general: 10, lab: 10, imaging: 7, function: 4, tumor: 5, gynecology: 6, eye: 4, ent: 3 },
    {
      'gynecology-0': ['TCT液基薄层细胞学', '异常细胞分类'],
      'gynecology-1': ['HPV高危分型16/18/31/33/45/52/58'],
      'gynecology-2': ['子宫', '附件', '盆腔积液'],
      'gynecology-3': ['双侧乳腺结构', 'BI-RADS分级'],
      'eye-2': ['视乳头', '杯盘比', '动静脉比', '出血/渗出'],
    },
  );
  const unmarried = makeItems(
    { general: 8, lab: 8, imaging: 5, function: 3, tumor: 3, eye: 3, ent: 2 },
    { 'imaging-3': ['子宫轮廓', '卵巢形态'] },
  );
  return {
    id: 'demo-123',
    name: '18人保套餐123（演示）',
    applicable_roles: ['male', 'female_married', 'female_unmarried'],
    remark: '专注高端人群健康管理，涵盖心脑血管、肿瘤、影像等核心检查项目，7 个工作日出具完成报告，由主任级医师一对一解读。',
    primary_color: '#1dbf9a',
    expire_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    created_at: new Date().toISOString(),
    company: { name: '上海画一养生度假村', slogan: '专注高端体检 · 为您定制专属方案', logo: '', phone: '400-800-1234' },
    salesman: { name: '李健康', title: '客户经理', phone: '13800138000' },
    role_packages: [
      { role: 'male', price: 1200, original_price: 3145, items: male },
      { role: 'female_married', price: 1400, original_price: 3755, items: married },
      { role: 'female_unmarried', price: 1400, original_price: 2880, items: unmarried },
    ],
  };
}

/* =========================================================
   页面组件
   ========================================================= */
export default function SharePage() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [pkg, setPkg] = useState<TemplatePkg | null>(null);
  const [expanded, setExpanded] = useState<Record<RoleNorm, boolean>>({ male: false, female_married: false, female_unmarried: false });
  const [catShowAll, setCatShowAll] = useState<Record<string, boolean>>({});
  const DEFAULT_CAT_ITEMS_SHOW = 4;
  const roleRefs = {
    male: useRef<HTMLDivElement>(null),
    female_married: useRef<HTMLDivElement>(null),
    female_unmarried: useRef<HTMLDivElement>(null),
  };

  const isDemo = sp.get('demo') === '1';

  useEffect(() => {
    let aborted = false;
    async function load() {
      setLoading(true);
      try {
        if (isDemo) {
          if (aborted) return;
          setPkg(makeDemoPkg());
          setLoading(false);
          return;
        }
        if (!id) { setPkg(null); setLoading(false); return; }
        // 免登录公开分享端点
        const res: any = await checkupApi.sharePublic(id);
        if (aborted) return;
        setPkg(res?.template || res || null);
      } catch (e: any) {
        if (!aborted) {
          console.error('load package failed:', e);
          toast.error(e?.message || '套餐加载失败');
        }
      } finally {
        if (!aborted) setLoading(false);
      }
    }
    load();
    return () => { aborted = true; };
  }, [id, isDemo, toast]);

  const company = pkg?.company;
  const salesman = pkg?.salesman;
  const expireAt = parseDD(pkg?.expire_at);
  const primaryColor = (pkg?.primary_color && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(pkg.primary_color))
    ? pkg.primary_color
    : DEFAULT_PRIMARY;

  // ===== 聚合（统一 female_single → female_unmarried 归一）=====
  const rolePkgs = useMemo<(RolePkg & { norm: RoleNorm })[]>(() => {
    if (!pkg) return [];
    const list: RolePkg[] = [];
    if (Array.isArray(pkg.role_packages) && pkg.role_packages.length > 0) list.push(...pkg.role_packages);
    else {
      for (const raw of ['male', 'female_married', 'female_unmarried', 'female_single'] as const) {
        const k = `_${raw}` as const;
        const rp = (pkg as any)[k] as RolePkg | undefined;
        if (rp) list.push(rp);
      }
    }
    // 归并同角色（防止同时出现 female_single + female_unmarried 两个 key）
    const merged = new Map<RoleNorm, RolePkg & { norm: RoleNorm }>();
    for (const rp of list) {
      const n = NORM_ROLE(rp.role);
      if (!n) continue;
      const existing = merged.get(n);
      if (!existing) {
        merged.set(n, { ...rp, norm: n });
      } else {
        existing.items = [...existing.items, ...rp.items];
        existing.price = Math.min(existing.price, rp.price);
        existing.original_price = Math.max(existing.original_price || 0, rp.original_price || 0) || undefined;
      }
    }
    return Array.from(merged.values());
  }, [pkg]);

  // ===== 亮点：3 条固定卖点 + 第3条角色专属特色（有则显示，没有就降级）=====
  const HIGHLIGHT_DOT_COLORS = ['#1dbf9a', '#0ea5e9', '#a855f7'];
  const highlights = useMemo<{ text: string; dot: string }[]>(() => {
    if (!pkg) return [];
    const hs: { text: string; dot: string }[] = [
      { text: '🏥 主任级医师主检 + 三甲合作影像审图', dot: HIGHLIGHT_DOT_COLORS[0] },
      { text: '⏱ 7 个工作日出具完成报告 · 主任级医师一对一解读', dot: HIGHLIGHT_DOT_COLORS[1] },
    ];
    // 第 3 条：角色专属特色（动态匹配，没有就不显示）
    const roles = (pkg.applicable_roles || []).map(NORM_ROLE).filter(Boolean) as RoleNorm[];
    let matched3 = false;
    if (roles.includes('female_married')) {
      const fmItems = rolePkgs.find((r) => r.norm === 'female_married')?.items || [];
      const joined = fmItems.map((it) => (it.name || '')).join('|').toUpperCase();
      const hasTCT = joined.includes('TCT') || joined.includes('液基');
      const hasHPV = joined.includes('HPV') || joined.includes('人乳头瘤');
      if (hasTCT && hasHPV) {
        hs.push({ text: '♀ 已婚女专属 · 含 TCT + HPV 两癌筛查', dot: HIGHLIGHT_DOT_COLORS[2] });
        matched3 = true;
      } else if (hasTCT || hasHPV) {
        hs.push({ text: `♀ 已婚女专属 · 含 ${hasTCT ? 'TCT 宫颈液基' : 'HPV 病毒分型'} 重点筛查`, dot: HIGHLIGHT_DOT_COLORS[2] });
        matched3 = true;
      }
    }
    if (!matched3 && roles.includes('male')) {
      const maleItems = rolePkgs.find((r) => r.norm === 'male')?.items || [];
      const joined = maleItems.map((it) => (it.name || '')).join('|').toUpperCase();
      if (joined.includes('PSA') || joined.includes('前列腺')) {
        hs.push({ text: '♂ 男性专属 · 含 PSA + 前列腺早筛', dot: HIGHLIGHT_DOT_COLORS[2] });
      }
    }
    return hs;
  }, [pkg, rolePkgs]);

  const jumpToRole = (r: RoleNorm) => {
    setExpanded((p) => ({ ...p, [r]: true }));
    setTimeout(() => {
      const el = roleRefs[r].current;
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  };

  const callClient = () => {
    const phone = salesman?.phone || company?.phone;
    if (!phone) { toast.error('暂无可拨打的电话'); return; }
    window.location.href = `tel:${phone}`;
  };
  const copyNumber = async () => {
    const num = salesman?.phone || '';
    try {
      await navigator.clipboard.writeText(num);
      toast.success('号码已复制：' + num);
    } catch {
      toast.error('复制失败，请长按号码文本手动复制');
    }
  };
  // 项目暂无独立预约页路由，用户统一通过底部客户经理拨号咨询预约
  const downloadPdf = () => {
    if (!id && !isDemo) { toast.error('暂无可下载的套餐'); return; }
    if (isDemo) {
      toast.info('演示模式：部署后端并使用真实分享 token 后，即可下载完整 PDF');
      return;
    }
    try {
      const url = checkupApi.sharePublicPdfUrl(id!);
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noreferrer';
      a.download = `${pkg?.name || '体检套餐'}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      toast.success('PDF 已开始下载');
    } catch {
      toast.error('PDF 下载失败，请稍后再试');
    }
  };

  const roleBg = (r: RoleNorm) => (
    r === 'male' ? '#eff6ff' : (r === 'female_married' ? '#fae8ff' : '#fdf2f8')
  );
  const headerBg = `linear-gradient(180deg, #f0fdf4 0%, #ecfdf5 100%)`;
  const cardShadow = '0 2px 12px -6px rgba(15,23,42,0.08)';
  const ctaStyle: React.CSSProperties = {
    backgroundColor: primaryColor,
    boxShadow: `0 3px 10px -4px rgba(29,191,154,0.38)`,
  };
  const pageBg = `linear-gradient(180deg, #fbfcfa 0%, #f4f7f4 100%)`;

  // 加载态（极简化）
  if (loading && !pkg) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center text-slate-500 text-[13px]" style={{ backgroundImage: pageBg }}>
        <div className="flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" className="animate-spin text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M21 12a9 9 0 1 1-6.22-8.56" strokeLinecap="round" />
          </svg>
          正在加载套餐…
        </div>
      </div>
    );
  }
  if (!pkg) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center text-slate-600 text-[14px] p-6" style={{ backgroundImage: pageBg }}>
        <div className="text-center max-w-md">
          <div className="text-[40px] mb-3" aria-hidden>🧾</div>
          <div className="font-semibold mb-1 text-slate-800">套餐未找到或已过期</div>
          <div className="text-[12.5px] text-slate-500 leading-relaxed mb-4">
            请向客户经理重新索取分享链接
            {isDemo ? '' : '，或追加 ?demo=1 查看演示页'}
          </div>
          <div className="text-[11.5px] text-slate-400">技术支持：上海画一养生度假村</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full min-h-screen w-full" style={{ backgroundImage: pageBg }}>
      {/* ===== Header：内容自撑 + 极浅薄荷 + 深色字（修复遮挡） ===== */}
      <div
        className="relative w-full overflow-visible text-slate-800"
        style={{ backgroundImage: headerBg, borderBottomLeftRadius: '36px', borderBottomRightRadius: '36px' }}
      >
        <div className="relative px-5 pt-6 pb-20 max-w-2xl mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-white shadow-[0_2px_8px_-2px_rgba(15,23,42,0.08)] flex items-center justify-center text-lg" aria-hidden>
              {company?.logo ? <img src={company.logo} alt="" className="w-full h-full rounded-xl object-cover" /> : '🏥'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-[15px] leading-tight text-slate-900 truncate">{company?.name || '体检中心'}</div>
              {company?.slogan && <div className="text-[11px] text-slate-500 mt-0.5 truncate">{company.slogan}</div>}
            </div>
            {isDemo && (
              <div className="text-[11px] px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 font-medium">演示 Demo</div>
            )}
          </div>

          <h1 className="font-bold text-[20px] leading-tight text-center text-slate-900 mb-2.5">{pkg?.name || '体检套餐分享'}</h1>
          <div className="flex items-center justify-center flex-wrap gap-1.5 mb-2">
            {rolePkgs.map((rp) => (
              <span key={rp.norm} className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-white text-[11px] text-slate-700 border border-slate-200/80">
                <span>{ROLE_EMOJI[rp.norm]}</span>
                <span className="font-medium">{ROLE_LABEL[rp.norm]}</span>
              </span>
            ))}
          </div>
          {expireAt && (
            <div className="flex items-center justify-center text-[11px] text-slate-500">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mr-1 opacity-80" aria-hidden>
                <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" strokeLinecap="round" />
              </svg>
              有效期至 {expireAt}
            </div>
          )}
        </div>
      </div>

      {/* ===== 主内容区：-mt-12 轻叠 ===== */}
      <main className="relative -mt-12 px-4 pb-28 max-w-2xl mx-auto">
        {/* ---------- 亮点卡片 ---------- */}
        <section className="bg-white border border-slate-100 rounded-2xl px-5 py-4 mb-3" style={{ boxShadow: cardShadow }}>
          <div className="text-[12.5px] font-semibold mb-3" style={{ color: primaryColor }}>✨ 本方案亮点</div>
          <ul className="space-y-2.5">
            {highlights.map((h, i) => {
              const { head, tail } = splitHighlight(h.text);
              return (
                <li key={i} className="flex items-start gap-2.5">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: h.dot }} aria-hidden />
                  <div className="text-[13px] leading-[1.55] text-slate-700">
                    <span className="font-medium text-slate-900">{head}</span>
                    {tail && <span className="text-slate-500"> {tail}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
          {pkg?.remark && (
            <div className="mt-3 pt-3 border-t border-dashed border-slate-100 text-[12px] leading-[1.65] text-slate-500 flex items-start gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" className="mt-[2px] shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M12 2a7 7 0 0 0-4 12.74V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.26A7 7 0 0 0 12 2ZM10 21h4" strokeLinecap="round" />
              </svg>
              <span>{pkg.remark}</span>
            </div>
          )}
        </section>

        {/* ---------- 角色跳转胶囊 ---------- */}
        {rolePkgs.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2 mb-2.5 px-1" role="tablist" aria-label="按角色快速跳转">
            {rolePkgs.map((rp) => {
              const count = rp.items.reduce((a, it) => a + (it.qty || 1), 0);
              const active = !!expanded[rp.norm];
              return (
                <button
                  key={rp.norm}
                  type="button"
                  onClick={() => jumpToRole(rp.norm)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white text-[12px] border border-slate-200/70 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors"
                  style={active ? { backgroundColor: `${primaryColor}14`, borderColor: `${primaryColor}4d`, color: primaryColor } : { color: '#334155' }}
                  aria-selected={active}
                >
                  <span>{ROLE_EMOJI[rp.norm]}</span>
                  <span className="font-medium">{ROLE_LABEL[rp.norm]}</span>
                  <span className="opacity-70">· {count}项</span>
                </button>
              );
            })}
          </div>
        )}

        {/* ---------- 角色方案卡 ---------- */}
        <section className="space-y-2.5">
          {rolePkgs.map((rp) => {
            const norm = rp.norm;
            const count = rp.items.reduce((a, it) => a + (it.qty || 1), 0);
            const ori = rp.original_price || 0;
            const saved = ori && ori > rp.price ? ori - rp.price : 0;
            const discount = ori && ori > 0 ? Math.max(1, Math.round(1000 - (rp.price / ori) * 1000)) / 10 : 0;
            const groupBy = new Map<string, CheckupItem[]>();
            for (const it of rp.items) {
              const key = displayCategory(it);
              if (!groupBy.has(key)) groupBy.set(key, []);
              groupBy.get(key)!.push(it);
            }
            const expandedThis = !!expanded[norm];
            return (
              <div
                key={norm}
                ref={roleRefs[norm]}
                className="bg-white rounded-2xl border border-slate-100 overflow-hidden"
                style={{ boxShadow: cardShadow }}
              >
                <button
                  type="button"
                  onClick={() => setExpanded((p) => ({ ...p, [norm]: !p[norm] }))}
                  className="w-full px-4 py-3.5 flex items-center gap-3"
                  aria-expanded={expandedThis}
                >
                  <div
                    className="w-12 h-12 shrink-0 rounded-2xl flex items-center justify-center text-2xl"
                    style={{ backgroundColor: roleBg(norm) }}
                  >{ROLE_EMOJI[norm]}</div>
                  <div className="flex-1 min-w-0 text-left">
                    <div className="font-semibold text-[15.5px] text-slate-900">{ROLE_LABEL[norm]}</div>
                    <div className="text-[12px] text-slate-500 mt-0.5 inline-flex items-center gap-2">
                      <span className="inline-flex items-center gap-1"><span aria-hidden>🧪</span><span>{count}项检查</span></span>
                      {ori > 0 && <span className="text-slate-400 line-through">原价 ¥{ori}</span>}
                    </div>
                    {discount > 0 && (
                      <div className="inline-flex items-center mt-1 text-[11px] px-2 py-[3px] rounded-md"
                        style={{ color: shade(primaryColor, -8), backgroundColor: `${primaryColor}12` }}>
                        折扣 {discount}%
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="flex items-baseline justify-end gap-0.5">
                      <span className="text-[13px] font-semibold" style={{ color: primaryColor }}>¥</span>
                      <span className="text-[22px] font-bold tracking-tight" style={{ color: primaryColor }}>{rp.price}</span>
                    </div>
                    <svg
                      width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                      className="mx-auto mt-1 text-slate-400 transition-transform duration-200"
                      style={{ transform: expandedThis ? 'rotate(180deg)' : 'rotate(0)' }}
                      aria-hidden
                    >
                      <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </button>

                {expandedThis && (
                  <div className="px-4 pb-4 pt-1">
                    {Array.from(groupBy.entries()).map(([cat, catItems]) => {
                      const si = subInfo(cat);
                      const catKey = `${norm}-${cat}`;
                      const showAll = !!catShowAll[catKey];
                      const visibleCount = showAll ? catItems.length : Math.min(DEFAULT_CAT_ITEMS_SHOW, catItems.length);
                      const hiddenCount = catItems.length - visibleCount;
                      return (
                        <div key={cat} className="mt-3">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-1 h-3.5 rounded-full" style={{ backgroundColor: si.color }} aria-hidden />
                            <div className="text-[13px] font-semibold text-slate-800">{si.name}</div>
                            <div className="text-[11px] text-slate-400">{catItems.length} 项</div>
                          </div>
                          <div className="rounded-xl border border-slate-100 bg-slate-50/50 divide-y divide-slate-100/70 overflow-hidden">
                            {catItems.slice(0, visibleCount).map((it) => (
                              <ItemRow key={String(it.id)} it={it} />
                            ))}
                            {hiddenCount > 0 && (
                              <button
                                type="button"
                                className="w-full px-3 py-2 text-left text-[12px] flex items-center justify-between"
                                style={{ color: primaryColor }}
                                onClick={() => setCatShowAll((p) => ({ ...p, [catKey]: true }))}
                              >
                                <span>展开剩余 {hiddenCount} 项</span>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                                  <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}

                  </div>
                )}
              </div>
            );
          })}
        </section>

        {/* ---------- 下载 PDF 卡片 ---------- */}
        <section className="mt-3 bg-white rounded-2xl px-4 py-3.5 flex items-center gap-3" style={{ boxShadow: cardShadow }}>
          <div className="w-12 h-12 shrink-0 rounded-xl bg-emerald-50 flex items-center justify-center text-slate-500" aria-hidden>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" strokeLinejoin="round" />
              <path d="M14 3v5h5" strokeLinejoin="round" />
              <path d="M9 15h6M9 18h6M9 12h2" strokeLinecap="round" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[14.5px] font-semibold text-slate-900">下载 PDF 方案</div>
            <div className="text-[11.5px] text-slate-500 mt-0.5">保存到本地，打印或转发都方便</div>
          </div>
          <button
            type="button"
            onClick={downloadPdf}
            className="shrink-0 text-[13px] font-semibold text-white rounded-xl px-4 py-2 transition active:opacity-90"
            style={{ backgroundColor: primaryColor, boxShadow: '0 2px 6px -2px rgba(29,191,154,0.4)' }}
          >
            立即下载
          </button>
        </section>

        {/* ---------- 客户经理 ---------- */}
        {salesman && (
          <section className="mt-3 bg-white rounded-2xl px-4 py-3.5 flex items-center gap-3" style={{ boxShadow: cardShadow }}>
            <div className="w-12 h-12 shrink-0 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 text-xl" aria-hidden>
              {salesman.name?.charAt?.(0) || '👤'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="text-[14.5px] font-semibold text-slate-900">{salesman.name || '客户经理'}</div>
                {salesman.title && (
                  <div className="text-[11px] px-2 py-[3px] rounded-md text-white font-medium" style={{ backgroundColor: primaryColor }}>
                    {salesman.title}
                  </div>
                )}
              </div>
              <div className="text-[12.5px] text-slate-500 mt-0.5 inline-flex items-center gap-1.5">
                <span aria-hidden>📱</span>
                <span>{salesman.phone || '暂无联系方式'}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={callClient}
              className="shrink-0 text-[13px] font-semibold rounded-xl px-3.5 py-2 transition active:opacity-90"
              style={{ backgroundColor: `${primaryColor}12`, color: primaryColor }}
            >
              <span className="inline-flex items-center gap-1">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                咨询
              </span>
            </button>
          </section>
        )}

        <div className="mt-6 text-center text-[11px] text-slate-400">
          上海画一养生度假村 · 高端体检中心
        </div>
      </main>

      {/* ===== 底部固定：双入口 + 主 CTA ===== */}
      <footer className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200/60 bg-white/80 backdrop-blur-md">
        <div className="max-w-2xl mx-auto flex items-center gap-2 px-3 py-2.5">
          <button
            type="button"
            onClick={callClient}
            className="shrink-0 flex flex-col items-center justify-center w-[60px] text-[11px] text-slate-500"
            aria-label="电话联系咨询"
          >
            <span className="text-[22px] leading-none" aria-hidden>📞</span>
            <span className="mt-0.5">联系咨询</span>
          </button>
          <button
            type="button"
            onClick={copyNumber}
            className="shrink-0 flex flex-col items-center justify-center w-[60px] text-[11px] text-slate-500"
            aria-label="复制客户经理号码"
          >
            <span className="text-[22px] leading-none" aria-hidden>📋</span>
            <span className="mt-0.5">复制号码</span>
          </button>
          <button
            type="button"
            onClick={downloadPdf}
            className="flex-1 h-12 rounded-2xl text-white font-semibold flex items-center justify-center gap-2 transition active:opacity-90"
            style={ctaStyle}
          >
            <span className="flex flex-col items-start leading-tight">
              <span className="text-[14.5px]">下载完整 PDF</span>
              <span className="text-[11.5px] font-normal opacity-90">{rolePkgs.length || 3} 个人群 · 完整方案</span>
            </span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="m7 10 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M12 15V3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </footer>
    </div>
  );
}

/* ================== 单个项目行 ================== */
function ItemRow({ it }: { it: CheckupItem }) {
  const [open, setOpen] = useState(false);
  const subs = Array.isArray(it.sub_item_names) ? it.sub_item_names : [];
  const hasSubs = subs.length > 0;
  return (
    <div className="px-3 py-2.5">
      <button
        type="button"
        onClick={() => hasSubs && setOpen((v) => !v)}
        className="w-full flex items-start gap-2 text-left"
      >
        <div className="text-[13.5px] text-slate-800 leading-snug flex-1 min-w-0">
          <span className="font-medium">{it.name}</span>
          {(it.qty ?? 0) > 1 && <span className="text-[11.5px] text-slate-400 ml-1.5">× {it.qty}</span>}
          {it.remark && <div className="text-[11.5px] text-slate-500 mt-0.5 leading-snug">{it.remark}</div>}
        </div>
        {hasSubs && (
          <svg
            width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            className="mt-0.5 text-slate-400 transition-transform shrink-0"
            style={{ transform: open ? 'rotate(90deg)' : 'rotate(0)' }}
            aria-hidden
          >
            <path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
      {hasSubs && open && (
        <ul className="mt-2 ml-1 pl-3 border-l border-dashed border-slate-200 space-y-1">
          {subs.map((s, i) => (
            <li key={i} className="text-[12px] text-slate-500 leading-snug">· {s}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
