import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import {
checkupApi, ROLES, ROLE_LABEL, ROLE_EMOJI, CATEGORIES,
type Role, type CheckupTemplate, type CheckupItemRef, type RolePlan, type ShareResult
} from './api';
import { useToast } from '@/components/Toast';

export default function WizardFinish() {
const { id } = useParams();
const navigate = useNavigate();
const location = useLocation();
const justCreated = !!(location.state as any)?.justCreated;
const toast = useToast();
const [pkg, setPkg] = useState<CheckupTemplate | null>(null);
const [loading, setLoading] = useState(true);
const [saving, setSaving] = useState(false);
const [expanded, setExpanded] = useState<Record<Role, boolean>>({ male: true, female_married: false, female_single: false });
const [shareResult, setShareResult] = useState<ShareResult | null>(null);
const [shareExpireDays, setShareExpireDays] = useState<number>(7);

const load = async () => {
  if (!id) return;
  setLoading(true);
  try {
    const res = await checkupApi.get(id);
    if (res?.ok) {
      const p: CheckupTemplate = res.data;
      setPkg(p);
      const prices: any = {}, rates: any = {};
      ROLES.forEach(r => {
        const plan: any = p.role_plans?.[r] || { discount_price: 0, discount_rate: 100 };
        prices[r] = Number(plan.discount_price) || 0;
        rates[r] = Number(plan.discount_rate) || 100;
      });
      setLocalPrice(prices); setLocalRate(rates);
    } else {
      toast.error(res?.error || '加载失败');
    }
  } catch (e: any) {
    toast.error(e.message || '加载失败');
  } finally {
    setLoading(false);
  }
};
useEffect(() => { load(); }, [id]);

const applicable: Role[] = useMemo(() => (pkg?.applicable_roles as any) || ROLES, [pkg]);

const groupByCategory = (items: CheckupItemRef[]) => {
  const groups: Record<string, CheckupItemRef[]> = {};
  for (const it of items) {
    const c = it.category || '其他';
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

const onShare = async () => {
  if (!pkg || !id) return;
  try {
    const res = await checkupApi.share(id, { expire_days: shareExpireDays });
    if (!res?.ok) throw new Error(res?.error || '生成失败');
    setShareResult(res.data as ShareResult);
    toast.success('分享链接已生成（有效期' + shareExpireDays + '天），请先点「先预览后分享」打开客户视角页面，再发送给客户');
  } catch (e: any) {
    toast.error(e.message || '生成分享链接失败');
  }
};

const copyLink = async () => {
  if (!shareResult) return;
  const url = location.origin + shareResult.share_path;
  try {
    await navigator.clipboard.writeText(url);
    toast.success('链接已复制');
  } catch (e: any) {
    const ta = document.createElement('textarea');
    ta.value = url; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast.success('链接已复制'); }
    catch (err) { toast.error('复制失败，请手动复制'); }
    document.body.removeChild(ta);
  }
};

const downloadPDF = (role?: string) => {
  if (!pkg) return;
  const u = checkupApi.pdfUrl(pkg.id, role);
  window.open(u, '_blank', 'noopener');
};

if (loading) return <div className="p-12 text-center text-gray-400 text-sm">加载方案中...</div>;
if (!pkg) return <div className="p-12 text-center text-gray-400 text-sm">套餐不存在</div>;

return (
  <div className="min-h-screen bg-gradient-to-b from-[#f3f7ec] via-[#faf7ee] to-[#f2efe3] pb-36">
    <header className="relative text-white">
      <div className={`absolute inset-x-0 top-0 ${justCreated ? 'h-48' : 'h-36'} bg-gradient-to-br from-[#1f6b3e] via-emerald-800 to-green-900 rounded-b-[32px]`} />
      <div className={`relative px-5 ${justCreated ? 'pt-10 pb-44' : 'pt-10 pb-28'} ${justCreated ? 'text-center' : 'text-left'}`}>
        {justCreated ? (
          <>
            <div className="w-16 h-16 mx-auto rounded-full bg-white/25 backdrop-blur flex items-center justify-center shadow-lg">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><path d="M5 12l5 5L20 7"/></svg>
            </div>
            <h1 className="mt-3 text-2xl font-bold">套餐方案已生成！</h1>
            <p className="mt-1 text-sm text-white/90">共 {applicable.length} 个角色方案</p>
          </>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center text-2xl shadow-sm shrink-0">
                🏥
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-white/80 font-medium">画一体检 · 方案详情</div>
                <h1 className="mt-0.5 text-xl font-bold truncate">{pkg.name}</h1>
                <div className="mt-1 inline-flex flex-wrap gap-1.5">
                  {applicable.map(r => (
                    <span key={r} className={r === 'male'
                      ? 'px-2 py-0.5 rounded-full text-[10px] font-medium bg-white/20 text-white'
                      : 'px-2 py-0.5 rounded-full text-[10px] font-medium bg-white/20 text-white'}>
                      {ROLE_EMOJI[r]} {ROLE_LABEL[r]}
                    </span>
                  ))}
                </div>
                {pkg.description && <div className="mt-2 text-[11px] text-white/80 line-clamp-2">{pkg.description}</div>}
              </div>
            </div>
          </div>
        )}
      </div>
    </header>

    <main className={`px-4 ${justCreated ? '-mt-32' : '-mt-16'} relative`}>
      {justCreated && (
        <div className="bg-white rounded-3xl shadow-lg p-4 mb-4">
          <div className="text-sm text-gray-500">套餐名称</div>
          <div className="text-xl font-bold text-gray-900 mt-1">{pkg.name}</div>
          <div className="flex flex-wrap gap-2 mt-3">
            {applicable.map(r => (
              <span key={r} className={r === 'male'
                ? 'px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-emerald-800'
                : 'px-3 py-1 rounded-full text-xs font-medium bg-pink-100 text-pink-700'}>
                {ROLE_EMOJI[r]} {ROLE_LABEL[r]}
              </span>
            ))}
          </div>
        </div>
      )}

      {applicable.map(r => {
        const plan: any = pkg.role_plans?.[r] || {};
        const roleItems = (pkg.role_items as any)?.[r]?.items || [];
        const total = Number(plan.original_total) || 0;
        const disc = Number(plan.discount_price) || 0;
        const rate = Number(plan.discount_rate) || 100;
        const isOpen = expanded[r];
        const groups = groupByCategory(roleItems);
        return (
          <div key={r} className="bg-white rounded-3xl shadow-sm mb-3 overflow-hidden">
            <button onClick={() => setExpanded(s => ({ ...s, [r]: !isOpen }))}
              className="w-full p-4 flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-11 h-11 rounded-2xl bg-blue-50 flex items-center justify-center text-2xl">{ROLE_EMOJI[r]}</div>
                <div className="text-left">
                  <div className="font-semibold text-gray-900">{ROLE_LABEL[r]}</div>
                  <div className="text-[11px] text-gray-500">{roleItems.length}项检查</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold text-[#0f5132]">
                  ¥{disc.toFixed(0)}
                </div>
                {total > disc && (
                  <div className="text-[11px] text-gray-400 mt-0.5">
                    原价 ¥{total.toFixed(0)} · {rate.toFixed(1)}%
                  </div>
                )}
                <button onClick={(e) => { e.stopPropagation(); navigate(`/h/checkup-templates/${id}/pricing`); }}
                  className="text-[11px] text-emerald-700 underline mt-0.5">定价</button>
              </div>
            </button>
            {isOpen && (
              <div className="px-4 pb-4 border-t border-gray-50 pt-3">
                <div className="flex items-center justify-between text-xs bg-gray-50 rounded-xl px-3 py-2 mb-3">
                  <span className="text-gray-500">原价</span>
                  <span className="font-semibold text-gray-700">¥{total.toFixed(2)}</span>
                </div>
                {total > disc && (
                  <div className="flex items-center justify-between text-xs bg-orange-50 rounded-xl px-3 py-2 mb-3">
                    <span className="text-orange-700">折扣价</span>
                    <span className="font-semibold text-orange-700">¥{disc.toFixed(2)}</span>
                  </div>
                )}
                {total > disc && (
                  <div className="flex items-center justify-between text-xs bg-orange-50/50 rounded-xl px-3 py-2 mb-3">
                    <span className="text-orange-700">折扣率 {rate.toFixed(2)}%</span>
                    <span className="font-semibold text-orange-700">立省 ¥{(total - disc).toFixed(2)}</span>
                  </div>
                )}
                {groups.map(g => (
                  <div key={g.category} className="mb-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-gray-800 mb-2">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2"><path d="M3 7h18M3 12h18M3 17h18"/></svg>
                      <span>{g.category}</span>
                      <span className="text-[10px] text-gray-400">{g.items.length}个</span>
                    </div>
                    <div className="space-y-1">
                      {g.items.map(it => {
                        return (
                          <div key={it.id} className="flex items-center gap-2 py-2 border-b border-dashed border-gray-100 last:border-b-0">
                            <div className="flex-1 min-w-0">
                              <div className="text-sm text-gray-800 font-medium truncate">{it.item_name_snapshot}</div>
                              {it.clinical_significance && (
                                <div className="text-[11px] text-gray-400 truncate mt-0.5">{it.clinical_significance}</div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <button onClick={() => downloadPDF('all')}
        className="w-full h-12 rounded-2xl bg-white border border-gray-200 text-gray-700 font-medium shadow-sm flex items-center justify-center gap-2 mb-3">
        📄 导出PDF方案
      </button>

      <div className="bg-white rounded-3xl p-4 shadow-sm mb-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold text-gray-900">生成分享链接</div>
            <div className="text-[11px] text-gray-500 mt-0.5">客户微信打开即可查看方案+下载PDF</div>
          </div>
          <select value={shareExpireDays} onChange={e => setShareExpireDays(Number(e.target.value))}
            className="text-xs bg-gray-50 rounded-lg px-2 py-1 border border-gray-200 outline-none">
            <option value={7}>7天</option>
            <option value={15}>15天</option>
            <option value={30}>30天</option>
          </select>
        </div>
        {shareResult ? (
          <div className="mt-3 bg-emerald-50 border border-emerald-100 rounded-2xl p-3">
            <div className="text-[11px] text-emerald-700">✅ 链接已生成 · 有效期至 {new Date(shareResult.expire_at).toLocaleString('zh-CN')}</div>
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1 bg-white rounded-xl px-3 py-2 text-xs text-gray-700 border border-emerald-100 truncate">
                {location.origin}{shareResult.share_path}
              </div>
              <button onClick={copyLink} className="h-9 px-3 rounded-xl bg-emerald-600 text-white text-xs font-medium">复制</button>
            </div>
            <button
              onClick={() => window.open(shareResult.share_path, '_blank', 'noopener')}
              className="w-full h-12 mt-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold flex items-center justify-center gap-2 hover:bg-emerald-700 shadow-sm"
            >
              📤 先预览后分享
            </button>
            <div className="mt-2 text-[11px] text-gray-500 leading-relaxed">
              💡 分享流程：① 点上面按钮打开客户视角 → ② 在新页面点右上角「···」→ ③ 选择「发送给朋友」/「分享到朋友圈」
            </div>
          </div>
        ) : (
          <button onClick={onShare} className="w-full h-11 mt-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-medium flex items-center justify-center gap-2 shadow-md shadow-emerald-800/20">
            🔗 生成分享链接
          </button>
        )}
      </div>
    </main>

    <div className="fixed bottom-0 left-0 right-0 p-3 pb-5 bg-gradient-to-t from-gray-50 to-transparent">
      <div className="grid grid-cols-3 gap-2">
        <button onClick={() => navigate(`/h/checkup-templates/${id}/pricing`)}
          className="h-12 rounded-2xl border border-gray-200 bg-white text-gray-700 font-medium text-sm">← 调整定价</button>
        <button onClick={() => navigate('/h/checkup-templates')}
          className="h-12 rounded-2xl border border-gray-200 bg-white text-gray-700 font-medium">返回列表</button>
        <button onClick={() => navigate('/h/checkup-templates/new')}
          className="h-12 rounded-2xl bg-gray-900 text-white font-medium flex items-center justify-center gap-1">
          ↻ 新建
        </button>
      </div>
    </div>
  </div>
  );
}

/**
 * 把 items_by_role 展平为 items-batch 需要的数组。
 * 注意：这里只传 item_id/role/quantity/sort_order/remark，不传 item_price / insurance_price_snapshot，
 * 让后端 items-batch 强制通过 LEFT JOIN booking_checkup_items 回填项目库最新价 + 最新保险价，
 * 保证 original_total 永远和项目库同步，避免"沿用历史套餐老快照"的问题。
 */
function flattenPkgItems(pkg: CheckupTemplate): any[] {
const byRole: any = pkg.items_by_role || {};
const out: any[] = [];
let so = 1;
(['common', ...ROLES] as any).forEach((s: string) => {
  const arr: CheckupItemRef[] = Array.isArray(byRole[s]) ? byRole[s] : [];
  for (const it of arr) {
    out.push({
      item_id: it.item_id,
      role: it.role || s,
      quantity: Math.max(1, Number(it.quantity) || 1),
      sort_order: so++,
      remark: (it as any).remark || null,
      // 故意不传 item_price / insurance_price_snapshot / item_name_snapshot
      // → 后端会 LEFT JOIN 项目库，按最新 default_price + insurance_price + name 回填
    });
  }
});
return out;
}
