import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
ROLES, ROLE_LABEL, ROLE_EMOJI, CATEGORIES,
type Role, type CheckupTemplate, type CheckupItemRef, type ShareResult
} from './api';
import { useToast } from '@/components/Toast';

// 分享落地页 —— 免登录。后端由 /api/booking/checkup-share/:token 提供
// 但我们统一用 axios/backendApi 鉴权（此处不用登录 token），所以先做一个匿名 fetch
function anonymousShareGet(token: string): Promise<any> {
return fetch('/api/booking/checkup-share/' + encodeURIComponent(token), {
  method: 'GET', headers: { 'Accept': 'application/json' }
}).then(r => r.json().catch(() => ({})));
}

export default function SharePage() {
const { token } = useParams();
const toast = useToast();
const [shareResult, setShareResult] = useState<ShareResult | null>(null);
const [pkg, setPkg] = useState<CheckupTemplate | null>(null);
const [loading, setLoading] = useState(true);
const [expanded, setExpanded] = useState<Record<Role, boolean>>({ male: true, female_married: false, female_single: false });

useEffect(() => {
  if (!token) return;
  anonymousShareGet(token).then(r => {
    if (r?.ok) {
      // r.data 是新格式：直接扁平（template 不再嵌一层）
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
      setShareResult({
        share_url: '',
        token: d.share_token || token,
        expire_at: d.expire_at,
        template: tpl,
        created_by: d.created_by,
        company: d.company,
      } as any);
      setPkg(tpl);
    } else {
      toast.error(r?.error || '链接已失效或不存在');
    }
    setLoading(false);
  }).catch((e: any) => {
    toast.error(e?.message || '加载失败');
    setLoading(false);
  });
}, [token]);

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

const downloadPDF = (role?: string) => {
  if (!pkg) return;
  // PDF 接口用 URL 直接下载（由浏览器直接发起 GET，不会被前端 axios 拦截）
  const u = role
    ? `/api/booking/checkup-templates/${pkg.id}/pdf?role=${role}&share_token=${encodeURIComponent(token || '')}`
    : `/api/booking/checkup-templates/${pkg.id}/pdf?share_token=${encodeURIComponent(token || '')}`;
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

const createdBy = (shareResult as any)?.created_by || null;
const company = (shareResult as any)?.company || null;
const ownerName = createdBy?.name || (shareResult as any)?.template?.created_by_name || '';
const ownerPhone = createdBy?.phone || '';
const ownerLetter = createdBy?.avatar_letter || (ownerName || 'U').slice(0, 1);

// 打开拨号
const tel = (p: string) => { if (p) window.location.href = 'tel:' + p; };
const openMap = (addr: string) => {
  if (!addr) return;
  window.open('https://uri.amap.com/marker?position=&name=' + encodeURIComponent(addr) + '&src=hycheckup&coordinate=gaode&callnative=1', '_blank');
};

return (
  <div className="min-h-screen bg-gradient-to-b from-green-50 via-[#faf7ee] to-[#f2efe3] pb-40">
    {/* 品牌头 */}
    <header className="relative text-white">
      <div className="absolute inset-x-0 top-0 h-52 bg-gradient-to-br from-[#0f5132] via-emerald-800 to-green-900 rounded-b-[32px]" />
      <div className="relative px-5 pt-12 pb-40">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center shadow-lg text-3xl">🏥</div>
          <div className="mt-2 text-[11px] text-white/80 font-medium">{company?.name || '画一体检'} · 为您定制专属方案</div>
          <h1 className="mt-1 text-2xl font-bold">{pkg.name}</h1>
          {ownerName && <div className="mt-1 text-sm text-white/90">客户经理：{ownerName}</div>}
          <div className="mt-3 inline-flex items-center gap-2 text-[11px] bg-white/15 px-3 py-1.5 rounded-full">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M12 8v4l3 2"/><circle cx="12" cy="12" r="9"/></svg>
            有效期至：{shareResult ? new Date(shareResult.expire_at).toLocaleDateString('zh-CN') : '-'}
          </div>
        </div>
      </div>
    </header>

    <main className="px-4 -mt-32 relative">
      <div className="bg-white rounded-3xl shadow-lg p-4 mb-4">
        <div className="text-sm text-gray-500">方案包含角色</div>
        <div className="flex flex-wrap gap-2 mt-2">
          {applicable.map(r => (
            <span key={r} className={r === 'male'
              ? 'px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-emerald-800'
              : 'px-3 py-1 rounded-full text-xs font-medium bg-pink-100 text-pink-700'}>
              {ROLE_EMOJI[r]} {ROLE_LABEL[r]}
            </span>
          ))}
        </div>
      </div>

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
                  <div className="font-semibold text-gray-900">{ROLE_LABEL[r]}方案</div>
                  <div className="text-[11px] text-gray-500">{roleItems.length}项 · 折扣率 {rate.toFixed(2)}%</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xl font-bold text-[#0f5132]">¥{disc.toFixed(0)}</div>
                {total > disc && <div className="text-[10px] text-orange-500 line-through">原价 ¥{total.toFixed(0)}</div>}
              </div>
            </button>
            {isOpen && (
              <div className="px-4 pb-4 border-t border-gray-50 pt-3">
                {groups.map(g => (
                  <div key={g.category} className="mb-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-gray-800 mb-2">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2"><path d="M3 7h18M3 12h18M3 17h18"/></svg>
                      <span>{g.category}</span>
                      <span className="text-[10px] text-gray-400">{g.items.length}个</span>
                    </div>
                    <div className="space-y-1">
                      {g.items.map(it => {
                        const qty = Math.max(1, Number(it.quantity) || 1);
                        return (
                          <div key={it.id} className="flex items-center gap-2 py-2 border-b border-dashed border-gray-100 last:border-b-0">
                            <span className="text-sm text-gray-800 flex-1 min-w-0 truncate">{it.item_name_snapshot}</span>
                            <span className="text-[11px] text-gray-400 shrink-0">x{qty}</span>
                            <span className="text-sm font-semibold text-gray-700 shrink-0 w-14 text-right">¥{(Number(it.item_price) * qty).toFixed(0)}</span>
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

      <div className="bg-white rounded-3xl p-4 shadow-sm mb-4">
        <div className="font-semibold text-gray-900">📄 下载 PDF 方案</div>
        <div className="text-[11px] text-gray-500 mt-0.5">保存到本地，打印或转发都方便</div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button onClick={() => downloadPDF()}
            className="h-11 rounded-2xl bg-[#0f5132] text-white text-sm font-medium shadow-sm shadow-emerald-700/20">
            下载全部PDF
          </button>
          <div className="grid grid-cols-2 gap-2">
            {applicable.slice(0, 2).map(r => (
              <button key={r} onClick={() => downloadPDF(r)}
                className="h-11 rounded-2xl border border-gray-200 bg-white text-gray-700 text-xs font-medium flex items-center justify-center gap-1">
                <span>{ROLE_EMOJI[r]}</span>PDF
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 客户经理卡片 */}
      <div className="bg-white rounded-3xl p-4 shadow-sm mb-3">
        <div className="text-[11px] text-gray-400 font-medium mb-2.5">您的专属客户经理</div>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 text-white flex items-center justify-center text-lg font-bold shadow-sm shrink-0">
            {ownerLetter}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-base font-bold text-gray-900 truncate">{ownerName || '销售顾问'}</div>
            <div className="text-[11px] text-gray-500 truncate">{ownerPhone ? '📱 ' + ownerPhone : '欢迎联系咨询'}</div>
          </div>
          {ownerPhone && (
            <button onClick={() => tel(ownerPhone)}
              className="h-11 px-4 rounded-2xl bg-gradient-to-br from-[#1f6b3e] to-green-800 text-white text-sm font-semibold shadow-sm shadow-emerald-700/20 shrink-0 flex items-center gap-1.5">
              📞 致电
            </button>
          )}
        </div>
      </div>

      {/* 公司信息卡片 */}
      {(company?.name || company?.address || company?.phone) && (
        <div className="bg-white rounded-3xl p-4 shadow-sm mb-4">
          <div className="text-[11px] text-gray-400 font-medium mb-2.5">公司信息</div>
          <div className="space-y-2.5">
            {company?.name && <div className="flex items-start gap-2"><span className="text-gray-400 shrink-0">🏢</span><span className="text-sm text-gray-800 font-medium">{company.name}</span></div>}
            {company?.address && (
              <button onClick={() => openMap(company.address!)} className="flex items-start gap-2 w-full text-left">
                <span className="text-gray-400 shrink-0">📍</span>
                <span className="text-sm text-gray-800 flex-1">{company.address}</span>
                <span className="text-[11px] text-emerald-700 font-medium shrink-0">地图</span>
              </button>
            )}
            {company?.phone && (
              <button onClick={() => tel(company.phone!)} className="flex items-start gap-2 w-full text-left">
                <span className="text-gray-400 shrink-0">☎️</span>
                <span className="text-sm text-gray-800 flex-1">{company.phone}</span>
                <span className="text-[11px] text-emerald-700 font-medium shrink-0">拨打</span>
              </button>
            )}
          </div>
        </div>
      )}
    </main>

    <div className="fixed bottom-0 left-0 right-0 p-3 pb-5 bg-gradient-to-t from-gray-50 to-transparent">
      <button onClick={() => downloadPDF('all')}
        className="w-full h-12 rounded-2xl bg-gradient-to-r from-[#1f6b3e] to-green-800 text-white font-semibold shadow-lg shadow-emerald-700/30 flex items-center justify-center gap-2">
        📥 下载完整方案PDF
      </button>
    </div>
  </div>
);
}