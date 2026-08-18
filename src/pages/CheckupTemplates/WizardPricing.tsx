import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  checkupApi, ROLES, ROLE_LABEL, ROLE_EMOJI,
  type Role, type CheckupTemplate, type RolePlan
} from './api';
import { useToast } from '@/components/Toast';

export default function WizardPricing() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [pkg, setPkg] = useState<CheckupTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editRole, setEditRole] = useState<Role | null>(null);
  const [localPrice, setLocalPrice] = useState<Record<Role, number>>({ male: 0, female_married: 0, female_single: 0 });
  const [localRate, setLocalRate] = useState<Record<Role, number>>({ male: 100, female_married: 100, female_single: 100 });

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

  const applicable: Role[] = (pkg?.applicable_roles as any) || ROLES;

  const openEdit = (r: Role) => {
    if (!pkg) return;
    const plan: any = pkg.role_plans?.[r] || { original_total: 0, discount_price: 0, discount_rate: 100 };
    const total = Number(plan.original_total) || 0;
    const priceInit = Number(plan.discount_price) || total;
    const rateInit = total > 0 ? Math.round(priceInit / total * 10000) / 100 : 100;
    setLocalPrice(prev => ({ ...prev, [r]: Math.round(priceInit * 100) / 100 }));
    setLocalRate(prev => ({ ...prev, [r]: Math.max(1, Math.min(100, rateInit)) }));
    setEditRole(r);
  };

  const onChangePrice = (r: Role, v: string) => {
    const n = parseFloat(v);
    const price = isNaN(n) ? 0 : Math.max(0, n);
    const total = Number((pkg?.role_plans as any)?.[r]?.original_total || 0);
    if (total <= 0) {
      setLocalPrice(p => ({ ...p, [r]: price }));
      setLocalRate(p => ({ ...p, [r]: 100 }));
      return;
    }
    const clampedPrice = Math.min(price, total);
    let rate = Math.round(clampedPrice / total * 10000) / 100;
    rate = Math.max(1, Math.min(100, rate));
    setLocalPrice(p => ({ ...p, [r]: clampedPrice }));
    setLocalRate(p => ({ ...p, [r]: rate }));
  };

  const onChangeRate = (r: Role, v: string) => {
    let n = parseFloat(v);
    if (isNaN(n)) n = 100;
    n = Math.max(1, Math.min(100, n));
    const total = Number((pkg?.role_plans as any)?.[r]?.original_total || 0);
    const price = Math.round(total * n) / 100;
    setLocalPrice(p => ({ ...p, [r]: price }));
    setLocalRate(p => ({ ...p, [r]: n }));
  };

  const confirmDiscount = async () => {
    if (!editRole || !pkg || !id) return;
    const role_plans: any = {};
    role_plans[editRole] = {
      discount_price: Math.round(localPrice[editRole] * 100) / 100,
      discount_rate: Math.round(localRate[editRole] * 100) / 100,
    };
    setSaving(true);
    try {
      const res = await checkupApi.saveItems(id, { role_plans });
      if (!res?.ok) throw new Error(res?.error || '保存失败');
      const p = res.data as CheckupTemplate;
      setPkg(p);
      const prices: any = {}, rates: any = {};
      ROLES.forEach(r => {
        const plan: any = p.role_plans?.[r] || { discount_price: 0, discount_rate: 100 };
        prices[r] = Number(plan.discount_price) || 0;
        rates[r] = Number(plan.discount_rate) || 100;
      });
      setLocalPrice(prices); setLocalRate(rates);
      toast.success(`${ROLE_LABEL[editRole]}定价已保存`);
      setEditRole(null);
    } catch (e: any) {
      toast.error(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const onGenerate = async () => {
    if (!pkg || !id) return;
    setSaving(true);
    try {
      const role_plans: any = {};
      for (const r of applicable) {
        const plan: any = pkg.role_plans?.[r] || { discount_price: 0, discount_rate: 100 };
        role_plans[r] = {
          discount_price: Number(plan.discount_price) || Number(plan.original_total) || 0,
          discount_rate: Number(plan.discount_rate) || 100,
        };
      }
      const res = await checkupApi.saveItems(id, { role_plans });
      if (!res?.ok) throw new Error(res?.error || '保存失败');
      toast.success('方案生成成功');
      navigate(`/h/checkup-templates/${id}/finish`, { state: { justCreated: true } });
    } catch (e: any) {
      toast.error(e.message || '生成失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-12 text-center text-gray-400 text-sm">加载定价信息...</div>;
  if (!pkg) return <div className="p-12 text-center text-gray-400 text-sm">套餐不存在</div>;

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f3f7ec] via-[#faf7ee] to-[#f2efe3] pb-36">
      <header className="relative text-white">
        <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-br from-[#1f6b3e] via-emerald-800 to-green-900 rounded-b-[32px]" />
        <div className="relative px-5 pt-10 pb-20">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <div>
              <div className="text-[11px] text-white/80">画一体检 · 定价</div>
              <h1 className="mt-0.5 text-xl font-bold">{pkg.name}</h1>
            </div>
          </div>
        </div>
      </header>

      <main className="px-4 -mt-10 relative space-y-3">
        {/* 说明提示 */}
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-2.5 text-[12px] text-emerald-800 leading-relaxed">
          💡 以下价格由项目自动汇总得出原价。如需给客户折扣，点击✏️输入折扣价，折扣率将自动计算。
        </div>

        {applicable.map(r => {
          const plan: any = pkg.role_plans?.[r] || {};
          const total = Number(plan.original_total) || 0;
          const disc = Number(plan.discount_price) || 0;
          const rate = Number(plan.discount_rate) || 100;
          const hasDiscount = disc < total && total > 0;
          const saved = total - disc;
          const rStyle = r === 'male' ? 'bg-blue-50 border-blue-200'
            : r === 'female_married' ? 'bg-pink-50 border-pink-200'
            : 'bg-purple-50 border-purple-200';
          const rText = r === 'male' ? 'text-blue-800'
            : r === 'female_married' ? 'text-pink-700'
            : 'text-purple-700';

          return (
            <div key={r} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl ${rStyle} border flex items-center justify-center text-xl`}>
                      {ROLE_EMOJI[r]}
                    </div>
                    <div>
                      <div className={`font-semibold ${rText}`}>{ROLE_LABEL[r]}</div>
                      <div className="text-[11px] text-gray-500">{plan.item_count || 0}项检查</div>
                    </div>
                  </div>
                  <button onClick={() => openEdit(r)}
                    className="text-[11px] text-gray-500 underline flex items-center gap-0.5">
                    ✏️ 定价
                  </button>
                </div>

                {/* 原价（始终显示） */}
                <div className="mt-3 flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2">
                  <span className="text-xs text-gray-500">原价</span>
                  <span className="font-semibold text-gray-800">¥{total.toFixed(2)}</span>
                </div>

                {/* 折扣信息（仅在有折扣时显示） */}
                {hasDiscount && (
                  <>
                    <div className="mt-2 flex items-center justify-between bg-orange-50 rounded-xl px-3 py-2">
                      <span className="text-xs text-gray-500">折扣价</span>
                      <span className="font-semibold text-orange-700">¥{disc.toFixed(2)}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between bg-orange-50/50 rounded-xl px-3 py-2">
                      <span className="text-xs text-gray-500">折扣率 {rate.toFixed(2)}%</span>
                      <span className="font-semibold text-orange-700">立省 ¥{saved.toFixed(2)}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </main>

      {/* 底部按钮 */}
      <div className="fixed bottom-0 left-0 right-0 p-3 pb-5 bg-gradient-to-t from-gray-50 to-transparent">
        <div className="flex gap-2">
          <button onClick={() => navigate(`/h/checkup-templates/${id}/items`)}
            className="flex-1 h-12 rounded-2xl border border-gray-300 bg-white text-gray-600 font-semibold flex items-center justify-center gap-1">
            ← 返回项目配置
          </button>
          <button onClick={onGenerate} disabled={saving}
            className="flex-1 h-12 rounded-2xl bg-gradient-to-r from-[#0f5132] to-emerald-800 text-white font-semibold shadow-lg shadow-emerald-800/30 disabled:opacity-60 flex items-center justify-center gap-1">
            {saving ? '生成中...' : '生成方案 ✓'}
          </button>
        </div>
      </div>

      {/* 定价编辑弹窗 */}
      {editRole && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end" onClick={() => setEditRole(null)}>
          <div className="bg-white w-full rounded-t-3xl p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="text-base font-semibold text-gray-900">
                {ROLE_EMOJI[editRole]} {ROLE_LABEL[editRole]}定价
              </div>
              <button onClick={() => setEditRole(null)} className="text-gray-400 text-xl">✕</button>
            </div>
            {(() => {
              const plan: any = pkg.role_plans?.[editRole] || { original_total: 0 };
              const total = Number(plan.original_total) || 0;
              const disc = localPrice[editRole];
              const rate = localRate[editRole];
              const saved = total - disc;
              return (
                <div className="space-y-3">
                  <div className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2">
                    <span className="text-xs text-gray-500">原价（自动汇总）</span>
                    <span className="font-semibold text-gray-800">¥{total.toFixed(2)}</span>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">折扣价</label>
                    <input type="number" value={disc}
                      onChange={e => onChangePrice(editRole, e.target.value)}
                      className="w-full h-12 px-4 rounded-xl border border-gray-200 text-base font-semibold text-orange-700 focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none"
                      placeholder="输入折扣价" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">折扣率（%）</label>
                    <input type="number" value={rate}
                      onChange={e => onChangeRate(editRole, e.target.value)}
                      min={1} max={100} step={0.01}
                      className="w-full h-12 px-4 rounded-xl border border-gray-200 text-base font-semibold text-orange-700 focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none"
                      placeholder="1-100" />
                  </div>
                  {disc < total && total > 0 && (
                    <div className="flex items-center justify-between bg-orange-50 rounded-xl px-3 py-2 text-sm">
                      <span className="text-orange-700">折扣率 {rate.toFixed(2)}%</span>
                      <span className="font-semibold text-orange-700">立省 ¥{saved.toFixed(2)}</span>
                    </div>
                  )}
                  <button onClick={confirmDiscount} disabled={saving}
                    className="w-full h-12 rounded-2xl bg-gradient-to-r from-[#0f5132] to-emerald-800 text-white font-semibold disabled:opacity-60 mt-2">
                    {saving ? '保存中...' : '保存定价'}
                  </button>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
