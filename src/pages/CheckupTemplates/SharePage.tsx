import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  ROLES, ROLE_LABEL, ROLE_EMOJI, CATEGORIES, displayCategory,
  type Role, type CheckupTemplate, type CheckupItemRef
} from './api';
import { useToast } from '@/components/Toast';

// 分享落地页 —— 免登录。后端由 /api/booking/checkup-share/:token 提供
function anonymousFetch(url: string): Promise<any> {
  return fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } })
    .then(r => r.json().catch(() => ({})));
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

export default function SharePage() {
  const { token } = useParams();
  const toast = useToast();
  const [pkg, setPkg] = useState<CheckupTemplate | null>(null);
  const [company, setCompany] = useState<BrandInfo | null>(null);
  const [sales, setSales] = useState<SalesProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [expireAt, setExpireAt] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<Role, boolean>>({ male: true, female_married: false, female_single: false });
  // 方案A：组合项目默认折叠。key = package_item_id（即明细行的唯一主键）。
  // 不写入 localStorage，刷新页面重新进入就恢复默认折叠。
  const [expandedCombos, setExpandedCombos] = useState<Record<string, boolean>>({});
  const toggleCombo = (itemId: string, e: React.MouseEvent) => {
    e.stopPropagation();   // 关键：防止冒泡到父按钮（父按钮是展开/收起整份角色方案卡片）
    setExpandedCombos(s => ({ ...s, [itemId]: !s[itemId] }));
  };

  useEffect(() => {
    if (!token) return;
    // 并行拉取：分享套餐数据 + 品牌配置（品牌也可以从套餐接口里company拿，这里优先用独立接口兜底）
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
          role_items: d.role_items,
          role_price_capsule: d.role_price_capsule,
          status: 1,
          item_count: 0,
        } as any;
        setPkg(tpl);
        setExpireAt(d.expire_at || null);

        // 品牌：套餐接口返回的优先（已读配置表），没有再用独立接口
        const c1 = d.company;
        const c2 = brandR?.ok ? brandR.data : null;
        const companyData = c1 || c2 || { name: '上海画一健康管理有限公司', logo: null, slogan: '专注高端体检 · 为您定制专属方案', address: null, phone: null, primary_color: '#0f5132' };
        setCompany({
          name: companyData.name || '上海画一健康管理有限公司',
          logo: companyData.logo || null,
          slogan: companyData.slogan || '专注高端体检 · 为您定制专属方案',
          address: companyData.address || null,
          phone: companyData.phone || null,
          primary_color: companyData.primary_color || '#0f5132',
        });

        // 客户经理名片：sales_profile 优先（带avatar），没有就用 created_by（兼容老数据）
        const sp = d.sales_profile;
        const cb = d.created_by;
        if (sp?.name || cb?.name) {
          setSales({
            user_id: sp?.user_id || cb?.id || '',
            name: sp?.name || cb?.name || '',
            phone: sp?.phone || cb?.phone || null,
            avatar_url: sp?.avatar_url || null,
          });
        } else {
          setSales(null);
        }
      } else {
        // 分享页面面向未登录客户，不显示"未登录"等系统级错误提示；
        // 真正的401一般是部署配置问题，统一展示"打开失败请在微信重试"的友好文案。
        const isAuthErr = /未登录|请先登录|Unauthorized|401/i.test(String(r?.error || ''));
        if (!isAuthErr) {
          toast.error(r?.error || '链接已失效或不存在');
        }
      }
      setLoading(false);
    }).catch((e: any) => {
      // 网络类错误（CORS / 超时 / 500）也静默，不在客户侧弹 Toast
      console.warn('[SharePage] load error:', e);
      setLoading(false);
    });
  }, [token]);

  // 强制标准顺序：男→已婚女→未婚女
  const _ROLE_ORDER: Role[] = ['male', 'female_married', 'female_single'];
  const applicable: Role[] = useMemo(() => {
    const raw = (pkg?.applicable_roles as any) || ROLES;
    return _ROLE_ORDER.filter(r => raw.includes(r));
  }, [pkg]);
  const primaryColor = company?.primary_color || '#0f5132';

  // ✅ 所有 useMemo / hook 派生值必须在条件 return 之前，否则 React 会因 hooks 数量不一致报错
  const highlights = useMemo(() => {
    const hs: string[] = [];
    if (!pkg) return hs;
    const totalItems = applicable.reduce((sum, r) => {
      return sum + ((pkg.role_items as any)?.[r]?.items?.length || 0);
    }, 0);
    if (totalItems > 0) hs.push(`🧪 ${totalItems}项深度检查`);
    let hasCT = false, hasTumor = false, hasImaging = false;
    applicable.forEach(r => {
      const items: CheckupItemRef[] = (pkg.role_items as any)?.[r]?.items || [];
      items.forEach(it => {
        const n = (it.item_name_snapshot || '').toLowerCase();
        if (/ct|磁共振|钼靶|dr|摄片|拍片/.test(n)) hasImaging = true;
        if (/肿瘤|癌胚|甲胎|afp|cea|tct|hpv/.test(n)) hasTumor = true;
        if (n.includes('ct')) hasCT = true;
      });
    });
    if (hasCT) hs.push('🩻 含CT影像检查');
    else if (hasImaging) hs.push('🩻 含彩超/DR影像检查');
    if (hasTumor) hs.push('🔬 含肿瘤标志物筛查');
    else if (applicable.length > 1) hs.push(`👥 覆盖${applicable.length}类人群方案`);
    if (hs.length < 3) hs.push('📋 三工作日出报告 · 专家解读');
    if (hs.length < 3) hs.push('💬 专属客户经理一对一服务');
    return hs.slice(0, 3);
  }, [pkg, applicable]);

  // 派生变量（非hook，可放在条件return之后也可之前，但统一前置更安全）
  const ownerName = sales?.name || '';
  const ownerPhone = sales?.phone || '';
  const ownerAvatar = sales?.avatar_url || null;
  const ownerLetter = ownerName ? ownerName.slice(0, 1) : 'U';

  const groupByCategory = (items: CheckupItemRef[]) => {
    const groups: Record<string, CheckupItemRef[]> = {};
    for (const it of items) {
      const c = displayCategory(it.category);
      if (!groups[c]) groups[c] = [];
      groups[c].push(it);
    }
    const order = [...CATEGORIES];
    const keys = Object.keys(groups).sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia >= 0 ? ia : 999) - (ib >= 0 ? ib : 999);
    });
    return keys.map(k => ({ category: k, items: groups[k] }));
  };

  const downloadPDF = (role?: string) => {
    if (!pkg) return;
    const u = role
      ? `/api/booking/checkup-share/${encodeURIComponent(token || '')}/pdf?role=${role}`
      : `/api/booking/checkup-share/${encodeURIComponent(token || '')}/pdf`;
    window.open(u, '_blank', 'noopener');
  };

  // 失效态
  if (!loading && !pkg) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 via-[#faf7ee] to-[#f2efe3] flex flex-col items-center justify-center p-8 text-center">
        <div className="w-20 h-20 rounded-full bg-red-100 text-red-500 text-4xl flex items-center justify-center mb-4">🔗</div>
        <div className="text-xl font-bold text-gray-800 mb-2">链接已失效</div>
        <div className="text-sm text-gray-500 max-w-xs">该分享链接不存在，或已超过有效期，请联系销售重新生成。</div>
      </div>
    );
  }

  if (loading) return <div className="p-12 text-center text-gray-400 text-sm">加载中...</div>;
  if (!pkg) return null;

  const tel = (p: string) => { if (p) window.location.href = 'tel:' + p; };
  const copyText = async (text: string, label = '已复制') => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(label);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast.success(label); } catch { toast.error('复制失败，请长按复制'); }
      document.body.removeChild(ta);
    }
  };
  const openMap = (addr: string) => {
    if (!addr) return;
    window.open('https://uri.amap.com/marker?position=&name=' + encodeURIComponent(addr) + '&src=hycheckup&coordinate=gaode&callnative=1', '_blank');
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 via-[#f5f2e8] to-[#eee9db] pb-48">
      {/* ===================== 品牌头 ===================== */}
      <header className="relative text-white overflow-hidden">
        <div
          className="absolute inset-x-0 top-0 h-64 rounded-b-[36px]"
          style={{ background: `linear-gradient(135deg, ${shade(primaryColor, 18)} 0%, ${shade(primaryColor, 8)} 55%, ${primaryColor} 100%)` }}
        />
        {/* 装饰光斑 */}
        <div className="absolute -top-16 -right-16 w-64 h-64 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute top-28 -left-20 w-56 h-56 rounded-full bg-white/6 blur-3xl" />

        <div className="relative px-5 pt-8 pb-36">
          {/* 品牌条 */}
          <div className="flex items-center gap-3 mb-4">
            <div className="w-11 h-11 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center overflow-hidden shadow-sm shrink-0 border border-white/25">
              {company?.logo ? (
                <img src={company.logo} alt="" className="w-full h-full object-cover"
                  onError={(e) => { (e.currentTarget.style.display = 'none'); const p = e.currentTarget.parentElement; if (p) p.innerHTML = '🏥'; }} />
              ) : (
                <span className="text-xl">🏥</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold leading-tight">{company?.name || '画一体检'}</div>
              {company?.slogan && <div className="text-[11px] text-white/85 leading-tight mt-0.5 truncate">{company.slogan}</div>}
            </div>
          </div>

          {/* 套餐标题卡 */}
          <div className="text-center">
            <h1 className="text-[22px] font-bold leading-tight tracking-wide">{pkg.name}</h1>
            <div className="mt-2.5 flex flex-wrap justify-center gap-1.5">
              {applicable.map(r => (
                <span key={r} className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-white/18 backdrop-blur border border-white/25">
                  {ROLE_EMOJI[r]} {ROLE_LABEL[r]}
                </span>
              ))}
            </div>
            {expireAt && (
              <div className="mt-3 inline-flex items-center gap-1.5 text-[10px] bg-white/14 border border-white/20 px-2.5 py-1 rounded-full backdrop-blur">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2"><path d="M12 8v4l3 2"/><circle cx="12" cy="12" r="9"/></svg>
                有效期至 {new Date(expireAt).toLocaleDateString('zh-CN')}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ===================== 方案亮点 ===================== */}
      <main className="px-4 -mt-28 relative space-y-3">
        <div className="bg-white rounded-[24px] shadow-md shadow-gray-900/5 p-4 border border-white">
          <div className="text-[11px] font-medium text-gray-400 mb-2.5 tracking-wider">✨ 本方案亮点</div>
          <div className="grid grid-cols-1 gap-2">
            {highlights.map((h, i) => (
              <div key={i} className="flex items-center gap-2 text-[13px] text-gray-700 leading-tight py-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: primaryColor }} />
                <span className="flex-1">{h}</span>
              </div>
            ))}
          </div>
          {pkg.description && (
            <div className="mt-3 pt-3 border-t border-gray-100 text-[12px] text-gray-500 leading-relaxed">{pkg.description}</div>
          )}
        </div>

        {/* ===================== 角色方案卡片 ===================== */}
        {applicable.map(r => {
          const plan: any = pkg.role_plans?.[r] || {};
          const roleAgg = (pkg.role_items as any)?.[r] || { items: [], total: 0, item_count: 0 };
          const roleItems = roleAgg.items || [];
          // 原价分母：用 role_items[r].total（按当前实际展示给客户看的明细 + 角色可见性重算出来的值），
          // 而不是 role_plans 里存的旧快照 —— 保证 "展示项目数 × 单价 = 原价 = 折扣分母" 三角对齐。
          const calcTotal = Number(roleAgg.total) || 0;
          const planOrig = Number(plan.original_total) || 0;
          const total = calcTotal > 0 ? calcTotal : planOrig;      // 优先取重算值，兜底老快照
          const disc = Number(plan.discount_price) || 0;
          // 折扣率：以"保持折扣价不变"原则，用新分母反推折扣率
          const rate = (total > 0 && disc > 0)
            ? Math.round((disc / total) * 10000) / 100              // 保留2位小数
            : (Number(plan.discount_rate) || 100);
          const saved = total - disc;
          const isOpen = expanded[r];
          const groups = groupByCategory(roleItems);
          return (
            <div key={r} className="bg-white rounded-[22px] shadow-sm overflow-hidden border border-gray-100">
              <button
                onClick={() => setExpanded(s => ({ ...s, [r]: !isOpen }))}
                className="w-full p-4 flex items-center justify-between"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl shrink-0 shadow-sm"
                    style={{ background: r === 'male' ? '#eff6ff' : '#fdf2f8' }}>
                    {ROLE_EMOJI[r]}
                  </div>
                  <div className="text-left min-w-0 flex-1">
                    <div className="font-bold text-gray-900 text-[16px] flex items-center gap-2 flex-wrap">
                      {ROLE_LABEL[r]}方案
                      {saved > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-orange-600 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-full shrink-0">
                          💰 立省¥{saved.toFixed(0)}
                        </span>
                      )}
                    </div>
                    <div className="text-[12px] text-gray-500 mt-0.5 flex items-center gap-3 flex-wrap">
                      <span>🧪 {roleItems.length}项检查</span>
                      {total > 0 && total !== disc ? (
                        <span className="text-gray-400 line-through">原价 ¥{total.toFixed(0)}</span>
                      ) : (
                        rate < 100 && <span className="text-gray-400">{(rate/10).toFixed(1)}折</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-right shrink-0 ml-2">
                  <div className="text-2xl font-extrabold tabular-nums" style={{ color: primaryColor }}>
                    ¥{disc.toFixed(0)}
                  </div>
                  {total > 0 && total !== disc ? (
                    <div className="text-[11px] text-orange-500 font-medium mt-0.5">🎁 折扣 {rate.toFixed(1)}%</div>
                  ) : (
                    rate < 100 && <div className="text-[11px] text-orange-500 font-medium mt-0.5">🎁 {(rate/10).toFixed(1)}折</div>
                  )}
                </div>
                <svg className={`ml-2 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2.5">
                  <path d="m6 9 6 6 6-6"/>
                </svg>
              </button>

              {isOpen && (
                <div className="px-4 pb-4 border-t border-gray-50 pt-3 bg-gray-50/40">
                  {/* 明细分类 —— 客户页不展示单价/小计，改为项目名 + 体检意义 */}
                  {groups.map(g => {
                    return (
                    <div key={g.category} className="mb-3 last:mb-0">
                      <div className="flex items-center gap-2 mb-1.5 px-2.5 py-1.5 rounded-lg"
                        style={{ background: primaryColor + '0d' }}>
                        <span className="inline-block w-1 h-3.5 rounded-sm shrink-0" style={{ background: primaryColor }} />
                        <span className="text-[12px] font-bold text-gray-800">{g.category}</span>
                        <span className="text-[10px] text-gray-400 font-normal">{g.items.length}项</span>
                      </div>
                      <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50 overflow-hidden">
                        {g.items.map((it, idx) => {
                          const qty = Math.max(1, Number(it.quantity) || 1);
                          const subList = Array.isArray((it as any).sub_item_names) && (it as any).sub_item_names.length > 0
                            ? (it as any).sub_item_names as string[]
                            : null;
                          const isCombo = !!subList;
                          const open = isCombo && !!expandedCombos[it.id || idx];
                          return (
                            <div
                              key={it.id || idx}
                              className={`flex items-start gap-2 px-3 py-2.5 last:border-b-0 ${isCombo ? 'cursor-pointer active:bg-gray-50' : ''}`}
                              onClick={isCombo ? (e) => toggleCombo(it.id || String(idx), e) : undefined}
                            >
                              <span className="w-1 h-1 rounded-full bg-gray-300 shrink-0 mt-2 ml-1.5" />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-start gap-2 flex-wrap">
                                  <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
                                    <span className="text-[13px] text-gray-800 font-medium truncate">{it.item_name_snapshot}</span>
                                    {qty > 1 && <span className="text-[10px] text-gray-400 shrink-0">×{qty}</span>}
                                  </div>
                                  {isCombo && (
                                    <span className={`shrink-0 text-xs text-gray-400 w-4 text-center leading-6 mt-[-2px] transition-transform duration-150 inline-block ${open ? 'rotate-90' : ''}`}>
                                      ▶
                                    </span>
                                  )}
                                </div>
                                {subList && open && (
                                  <div className="mt-0.5 ml-3 space-y-0.5">
                                    {subList.map(name => (
                                      <div key={name} className="text-[11px] text-gray-400 leading-snug">· {name}</div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* ===================== 下载 PDF ===================== */}
        <div className="bg-white rounded-[22px] shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center text-base" style={{ background: primaryColor + '15', color: primaryColor }}>📄</div>
            <div>
              <div className="font-semibold text-gray-900 text-[14px]">下载 PDF 方案</div>
              <div className="text-[11px] text-gray-500 mt-0.5">保存到本地，打印或转发都方便</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => downloadPDF()}
              className="col-span-2 h-11 rounded-xl text-white text-sm font-medium shadow-sm"
              style={{
                background: `linear-gradient(135deg, ${shade(primaryColor, 8)}, ${primaryColor}, ${shade(primaryColor, -5)})`,
                boxShadow: `0 8px 22px -16px ${primaryColor}aa`
              }}
            >
              ⬇️ 下载完整方案 PDF
            </button>
            {applicable.map(r => (
              <button key={r} onClick={() => downloadPDF(r)}
                className="h-10 rounded-xl border border-gray-200 bg-white text-gray-700 text-[12px] font-medium flex items-center justify-center gap-1.5 hover:bg-gray-50 transition-colors">
                <span className="text-base">{ROLE_EMOJI[r]}</span>
                {ROLE_LABEL[r]} PDF
              </button>
            ))}
          </div>
        </div>

        {/* ===================== 客户经理卡片 ===================== */}
        {(ownerName || ownerPhone) && (
          <div className="bg-white rounded-[22px] shadow-sm overflow-hidden border border-gray-100">
            <div className="px-5 pt-4 pb-2">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-bold tracking-[0.14em]" style={{ color: primaryColor }}>
                  💼 您的专属客户经理
                </div>
                <span className="text-[10px] text-gray-400 bg-gray-50 border border-gray-100 px-2 py-0.5 rounded-full">
                  一对一服务
                </span>
              </div>
            </div>
            <div className="px-5 pb-5">
              <div className="flex items-center gap-4 p-3 rounded-2xl bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-100/50">
                {ownerAvatar ? (
                  <img
                    src={ownerAvatar} alt=""
                    className="w-16 h-16 rounded-2xl object-cover shrink-0 shadow-md border-2 border-white"
                    onError={(e) => { (e.currentTarget.style.display = 'none'); const sib = e.currentTarget.nextElementSibling as HTMLElement | null; if (sib) sib.style.display = 'flex'; }}
                  />
                ) : null}
                <div
                  className="w-16 h-16 rounded-2xl shrink-0 items-center justify-center text-2xl font-extrabold text-white shadow-md border-2 border-white"
                  style={{
                    display: ownerAvatar ? 'none' : 'flex',
                    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 50%, #b45309 100%)'
                  }}
                >{ownerLetter}</div>
                <div className="min-w-0 flex-1">
                  <div className="text-[18px] font-extrabold text-gray-900 truncate">{ownerName || '销售顾问'}</div>
                  {ownerPhone ? (
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-[13px] font-semibold text-gray-700 tracking-wide">{ownerPhone}</span>
                      <span className="inline-flex items-center gap-0.5 text-[9px] text-green-700 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded-md font-semibold">
                        🟢 在线
                      </span>
                    </div>
                  ) : (
                    <div className="text-[13px] text-gray-500 mt-1">欢迎咨询</div>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2.5 mt-4">
                {ownerPhone ? (
                  <>
                    <button
                      onClick={() => tel(ownerPhone)}
                      className="h-12 rounded-2xl text-white text-[14px] font-bold shadow-md flex items-center justify-center gap-1.5 active:scale-[0.97] transition-transform"
                      style={{
                        background: `linear-gradient(135deg, ${shade(primaryColor, 5)}, ${shade(primaryColor, -15)})`,
                        boxShadow: `0 8px 18px -10px ${primaryColor}aa`
                      }}
                    >
                      📞 一键致电
                    </button>
                    <button
                      onClick={() => copyText(ownerPhone, '手机号已复制，快去微信添加吧')}
                      className="h-12 rounded-2xl border-2 text-[14px] font-bold flex items-center justify-center gap-1.5 active:scale-[0.97] transition-colors transition-transform bg-white hover:bg-gray-50"
                      style={{ borderColor: primaryColor + '50', color: primaryColor }}
                    >
                      📋 复制号码
                    </button>
                  </>
                ) : (
                  <div className="col-span-2 h-12 rounded-2xl bg-gray-50 text-gray-400 text-[13px] flex items-center justify-center">
                    该顾问暂未留电话，欢迎到店或拨打客服热线
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ===================== 企业信息 ===================== */}
        {(company?.name || company?.address || company?.phone) && (
          <div className="bg-white rounded-[22px] shadow-sm p-4 border border-gray-100">
            <div className="text-[11px] font-medium text-gray-400 tracking-wider mb-3">🏢 {company?.name || '公司信息'}</div>
            <div className="space-y-3">
              {company?.address && (
                <button onClick={() => openMap(company.address!)} className="flex items-start gap-2.5 w-full text-left group">
                  <span className="text-gray-400 shrink-0 mt-0.5">📍</span>
                  <span className="text-[13px] text-gray-700 flex-1 leading-relaxed">{company.address}</span>
                  <span className="text-[11px] font-medium shrink-0 mt-0.5" style={{ color: primaryColor }}>导航 ›</span>
                </button>
              )}
              {company?.phone && (
                <button onClick={() => tel(company.phone!)} className="flex items-start gap-2.5 w-full text-left group">
                  <span className="text-gray-400 shrink-0 mt-0.5">☎️</span>
                  <span className="text-[13px] text-gray-700 flex-1 leading-relaxed">{company.phone}</span>
                  <span className="text-[11px] font-medium shrink-0 mt-0.5" style={{ color: primaryColor }}>拨打 ›</span>
                </button>
              )}
              {!company?.address && !company?.phone && company?.name && (
                <div className="text-[12px] text-gray-500">感谢您的关注与信任</div>
              )}
            </div>
          </div>
        )}

        {/* 底部位距 */}
        <div className="h-4" />
      </main>

      {/* ===================== 底部固定 CTA ===================== */}
      <div className="fixed bottom-0 left-0 right-0 z-30">
        {/* 安全遮罩 */}
        <div className="absolute inset-x-0 top-0 h-6 -translate-y-full" style={{ background: 'linear-gradient(to top, rgba(245,242,232,0.98), rgba(245,242,232,0))' }} />
        <div className="relative px-4 pt-3 pb-4" style={{ background: 'rgba(245,242,232,0.98)', backdropFilter: 'blur(12px)' }}>
          <div className="grid grid-cols-5 gap-2 max-w-[620px] mx-auto">
            {/* 左：2个快捷联系按钮 */}
            <button
              onClick={() => { if (ownerPhone) tel(ownerPhone); else if (company?.phone) tel(company.phone); }}
              disabled={!ownerPhone && !company?.phone}
              className="col-span-1 h-[52px] rounded-2xl bg-white border border-gray-200 text-gray-700 shadow-sm flex flex-col items-center justify-center gap-0.5 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-transform"
            >
              <span className="text-xl leading-none">📞</span>
              <span className="text-[10px] font-medium">联系咨询</span>
            </button>
            <button
              onClick={() => { if (ownerPhone) copyText(ownerPhone, '手机号已复制'); else if (company?.phone) copyText(company.phone, '电话已复制'); }}
              disabled={!ownerPhone && !company?.phone}
              className="col-span-1 h-[52px] rounded-2xl bg-white border border-gray-200 text-gray-700 shadow-sm flex flex-col items-center justify-center gap-0.5 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-transform"
            >
              <span className="text-xl leading-none">📋</span>
              <span className="text-[10px] font-medium">复制号码</span>
            </button>
            {/* 右：3格 —— 大按钮下载PDF */}
            <button
              onClick={() => downloadPDF('all')}
              className="col-span-3 h-[52px] rounded-2xl text-white font-bold text-[15px] shadow-lg flex items-center justify-center gap-1.5 active:scale-[0.97] transition-transform"
              style={{
                background: `linear-gradient(135deg, ${shade(primaryColor, 8)}, ${primaryColor}, ${shade(primaryColor, -5)})`,
                boxShadow: `0 8px 22px -16px ${primaryColor}aa, inset 0 1px 0 rgba(255,255,255,0.25)`
              }}
            >
              <span className="text-xl leading-none">⬇️</span>
              <div className="flex flex-col items-start leading-none">
                <span>下载完整 PDF</span>
                <span className="text-[10px] font-medium opacity-80 mt-0.5">{applicable.length}个人群 · 含价格明细</span>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// 颜色加深/变浅辅助（hex color，percent -100 ~ +100）
function shade(hex: string, percent: number): string {
  try {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const num = parseInt(h, 16);
    let r = (num >> 16) + percent * 2.55;
    let g = ((num >> 8) & 0xff) + percent * 2.55;
    let b = (num & 0xff) + percent * 2.55;
    r = Math.max(0, Math.min(255, Math.round(r)));
    g = Math.max(0, Math.min(255, Math.round(g)));
    b = Math.max(0, Math.min(255, Math.round(b)));
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  } catch { return hex; }
}
