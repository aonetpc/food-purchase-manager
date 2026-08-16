import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
checkupApi, ROLES, ROLE_LABEL, ROLE_EMOJI, CATEGORIES,
type Role, type CheckupTemplate, type CheckupItem, type CheckupItemRef, type RolePlan
} from './api';
import { useToast } from '@/components/Toast';

// 当前 Tab 的「作用域」
type Scope = 'common' | Role;

interface SelectedItem {
item_id: string;
name_snapshot: string;
price_snapshot: number;
insurance_snapshot: number;
quantity: number;
}

// selected: { [scope: common|Role]: { [itemId]: SelectedItem } }
type SelectedState = Record<Scope, Record<string, SelectedItem>>;

const EMPTY_SCOPE: SelectedState = {
common: {}, male: {}, female_married: {}, female_single: {},
};

export default function WizardItems() {
const { id } = useParams();
const navigate = useNavigate();
const toast = useToast();

const [pkg, setPkg] = useState<CheckupTemplate | null>(null);
const [items, setItems] = useState<CheckupItem[]>([]);
const [loading, setLoading] = useState(true);
const [scope, setScope] = useState<Scope>('common');
const [category, setCategory] = useState<string>('全部');
const [keyword, setKeyword] = useState('');
const [selected, setSelected] = useState<SelectedState>({ ...EMPTY_SCOPE });
const [saving, setSaving] = useState(false);

const applicable: Role[] = (pkg?.applicable_roles as any) || ROLES;

// 加载套餐 + 体检项目原子表 + 回填已选
const loadAll = async () => {
  if (!id) return;
  setLoading(true);
  try {
    const [tplRes, itemsRes] = await Promise.all([
      checkupApi.get(id),
      checkupApi.listItems(),
    ]);
    if (tplRes?.ok) {
      setPkg(tplRes.data);
      // 回填已选（items_by_role）
      const src: any = tplRes.data?.items_by_role || {};
      const next: SelectedState = { common: {}, male: {}, female_married: {}, female_single: {} };
      (['common', ...ROLES] as Scope[]).forEach(s => {
        const arr: CheckupItemRef[] = Array.isArray(src[s]) ? src[s] : [];
        for (const it of arr) {
          next[s][it.item_id] = {
            item_id: it.item_id,
            name_snapshot: it.item_name_snapshot || '',
            price_snapshot: Number(it.item_price) || 0,
            insurance_snapshot: Number(it.insurance_price_snapshot) || 0,
            quantity: Math.max(1, Number(it.quantity) || 1),
          };
        }
      });
      setSelected(next);
    } else {
      toast.error(tplRes?.error || '加载套餐失败');
    }
    if (itemsRes?.ok) setItems(itemsRes.data || []);
  } catch (e: any) {
    toast.error(e.message || '加载失败');
  } finally {
    setLoading(false);
  }
};
useEffect(() => { loadAll(); }, [id]);

// 过滤后的项目列表
const filteredItems = useMemo(() => {
  const kw = keyword.trim().toLowerCase();
  return items.filter(it => {
    if (category !== '全部' && it.category !== category) return false;
    if (kw && !(it.name || '').toLowerCase().includes(kw) && !(it.code || '').toLowerCase().includes(kw)) return false;
    return true;
  });
}, [items, category, keyword]);

// 每个 scope 下是否选中某 item（对于 role scope，还要算 common 里选过的"阴影"显示）
const isSelectedInScope = (itemId: string, s: Scope) => !!selected[s]?.[itemId];

// 当前 role 汇总统计（common + 当前角色合并）
const summaryForRole = (r: Role) => {
  const merged = new Map<string, SelectedItem>();
  Object.values(selected.common || {}).forEach(si => merged.set(si.item_id, { ...si }));
  Object.values(selected[r] || {}).forEach(si => merged.set(si.item_id, { ...si }));
  let total = 0, count = 0;
  for (const si of merged.values()) { total += si.price_snapshot * si.quantity; count += 1; }
  return { total, count };
};

const toggleItem = (item: CheckupItem) => {
  setSelected(prev => {
    const cur = { ...prev[scope] };
    if (cur[item.id]) {
      delete cur[item.id];
    } else {
      cur[item.id] = {
        item_id: item.id,
        name_snapshot: item.name,
        price_snapshot: Number(item.default_price) || 0,
        insurance_snapshot: Number(item.insurance_price) || 0,
        quantity: 1,
      };
    }
    return { ...prev, [scope]: cur };
  });
};

const setQty = (itemId: string, qty: number) => {
  const q = Math.max(1, Math.floor(qty) || 1);
  setSelected(prev => {
    if (!prev[scope][itemId]) return prev;
    return { ...prev, [scope]: { ...prev[scope], [itemId]: { ...prev[scope][itemId], quantity: q } } };
  });
};

// 保存并进入下一步
const onSaveAndNext = async () => {
  if (!pkg || !id) return;
  // 构造 items list：把 selected 的四个 scope 展平
  const flatItems: any[] = [];
  let so = 1;
  (['common', ...ROLES] as Scope[]).forEach(s => {
    Object.values(selected[s]).forEach(si => {
      flatItems.push({
        item_id: si.item_id,
        role: s,
        quantity: si.quantity,
        item_name_snapshot: si.name_snapshot,
        item_price: si.price_snapshot,
        insurance_price_snapshot: si.insurance_snapshot,
        sort_order: so++,
        remark: null,
      });
    });
  });
  // 三角色 price 先按 autoTotal 填（后续 finish 页再手调折扣，discount_rate 自动算）
  const role_plans: Record<string, Partial<RolePlan>> = {};
  for (const r of applicable) {
    const { total } = summaryForRole(r);
    // 初次不打折：discount_price = total，rate=100
    role_plans[r] = { discount_price: Math.round(total * 100) / 100, discount_rate: 100 };
  }
  setSaving(true);
  try {
    const res = await checkupApi.saveItems(id, { items: flatItems, role_plans });
    if (!res?.ok) throw new Error(res?.error || '保存失败');
    toast.success('保存成功，生成方案中...');
    navigate(`/h/checkup-templates/${id}/finish`, { state: { justCreated: true } });
  } catch (e: any) {
    toast.error(e.message || '保存失败');
  } finally {
    setSaving(false);
  }
};

if (!pkg && !loading) return <div className="p-8 text-center text-gray-400">套餐不存在</div>;

return (
  <div className="min-h-screen bg-gradient-to-b from-green-50 via-[#faf7ee] to-[#f2efe3] pb-40">
    {/* Header */}
    <header className="bg-white border-b border-gray-100 sticky top-0 z-20">
      <div className="px-4 pt-3 pb-2 flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <div className="flex-1 mx-3 min-w-0">
          <div className="text-sm font-semibold text-gray-900 truncate">{pkg?.name || '配置项目'}</div>
          <div className="text-[11px] text-gray-500 truncate">已套用【基础套餐】· 可自由加减</div>
        </div>
      </div>
      {/* 三角色 Tabs */}
      <div className="px-2 flex gap-1 overflow-x-auto scrollbar-hide">
        <TabButton active={scope === 'common'} onClick={() => setScope('common')}
          emoji="🔗" name="公共项目" badge={Object.keys(selected.common).length} color="text-gray-800 bg-amber-50 border-amber-200"
          sub="改一次三个人群同步" />
        {applicable.map(r => {
          const smr = summaryForRole(r);
          const active = scope === r;
          return (
            <button key={r} onClick={() => setScope(r)}
              className={`shrink-0 relative flex flex-col items-start px-3 py-2 rounded-xl mx-1 my-1 mb-2 border-2 transition-all min-w-[104px] ${
                active ? 'border-[#0f5132] bg-emerald-50' : 'border-gray-100 bg-white'
              }`}>
              <div className="flex items-center gap-2 w-full">
                <div className="text-2xl leading-none">{ROLE_EMOJI[r]}</div>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-semibold ${active ? 'text-emerald-800' : 'text-gray-800'}`}>{ROLE_LABEL[r]}</div>
                  <div className="text-[10px] text-gray-500">{smr.count}项 · ¥{smr.total.toFixed(0)}</div>
                </div>
                <Badge n={Object.keys(selected[r]).length + Object.keys(selected.common).length} />
              </div>
              <div className="mt-1 text-[10px] font-semibold text-[#0f5132]">¥{smr.total.toFixed(0)}</div>
            </button>
          );
        })}
      </div>
      {/* 搜索框 */}
      <div className="px-4 pb-3">
        <div className="flex items-center bg-gray-100 rounded-xl px-3 h-10">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input value={keyword} onChange={e => setKeyword(e.target.value)}
            className="bg-transparent flex-1 ml-2 outline-none text-sm" placeholder="搜索项目：血脂、CT、甲状腺..." />
          {keyword && <button onClick={() => setKeyword('')} className="text-xs text-gray-400">清空</button>}
        </div>
      </div>
      {/* 分类7 Tabs */}
      <div className="px-3 pb-3 flex gap-1.5 overflow-x-auto scrollbar-hide">
        {['全部', ...CATEGORIES].map(c => (
          <button key={c} onClick={() => setCategory(c)}
            className={`shrink-0 h-7 px-3 rounded-full text-xs transition ${
              category === c ? 'bg-[#0f5132] text-white' : 'bg-white text-gray-600 border border-gray-200'
            }`}>{c}</button>
        ))}
      </div>
    </header>

    {/* 公共项目提示 banner */}
    {scope === 'common' && (
      <div className="mx-3 mt-3 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-xl px-3 py-2 flex items-start gap-2">
        <span className="text-base">💡</span>
        <div>当前：<span className="font-semibold">公共项目区</span>。选中的项目会自动同步给 <span className="font-semibold">{applicable.map(r => ROLE_LABEL[r]).join('、')}</span> 三类角色。</div>
      </div>
    )}

    {/* 项目列表 */}
    <main className="px-3 pt-3">
      {loading && <div className="text-center text-gray-400 text-xs py-12">加载中...</div>}
      {!loading && filteredItems.length === 0 && (
        <div className="text-center py-12 text-gray-400 text-xs">没有匹配的项目</div>
      )}
      <div className="space-y-2">
        {filteredItems.map(it => (
          <ItemCard key={it.id} item={it}
            scope={scope}
            selected={isSelectedInScope(it.id, scope)}
            shadowSelected={scope !== 'common' && isSelectedInScope(it.id, 'common')}
            qty={selected[scope][it.id]?.quantity || 1}
            onToggle={() => toggleItem(it)}
            onQty={n => setQty(it.id, n)}
          />
        ))}
      </div>
    </main>

    {/* 底部汇总 + 生成方案 */}
    <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur border-t border-gray-100 px-3 pt-3 pb-5">
      <div className="flex items-center gap-2 mb-2 overflow-x-auto pb-1">
        {applicable.map(r => {
          const sm = summaryForRole(r);
          return (
            <div key={r} className="shrink-0 px-2 py-1 rounded-full bg-gray-50 border border-gray-100 flex items-center gap-1.5 text-[11px]">
              <span>{ROLE_EMOJI[r]}</span><span>{ROLE_LABEL[r]}</span>
              <span className="font-semibold text-gray-800">{sm.count}项</span>
              <span className="font-bold text-[#0f5132]">¥{sm.total.toFixed(0)}</span>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => navigate(-1)} className="h-12 rounded-2xl border border-gray-200 bg-white text-gray-700 font-medium flex items-center justify-center gap-1">
          ← 返回
        </button>
        <button onClick={onSaveAndNext} disabled={saving}
          className="h-12 rounded-2xl bg-gradient-to-r from-[#0f5132] to-emerald-800 text-white font-semibold shadow-lg shadow-emerald-800/30 flex items-center justify-center gap-1 disabled:opacity-60">
          {saving ? '保存中...' : '生成方案 ✓'}
        </button>
      </div>
    </div>
  </div>
);
}

function Badge({ n }: { n: number }) {
if (n <= 0) return null;
return <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-[#0f5132] text-white text-[10px] font-bold">{n}</span>;
}

function TabButton({ active, onClick, emoji, name, badge, sub, color }: any) {
return (
  <button onClick={onClick}
    className={`shrink-0 relative flex flex-col items-start px-3 py-2 rounded-xl mx-1 my-1 mb-2 border-2 transition-all min-w-[130px] ${
      active ? 'border-amber-400 ' + color : 'border-gray-100 bg-white'
    }`}>
    <div className="flex items-center gap-2 w-full">
      <div className="text-2xl leading-none">{emoji}</div>
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-semibold ${active ? 'text-amber-800' : 'text-gray-800'}`}>{name}</div>
        <div className="text-[10px] text-gray-500 leading-tight">{sub}</div>
      </div>
      <Badge n={badge} />
    </div>
  </button>
);
}

function ItemCard({ item, scope, selected, shadowSelected, qty, onToggle, onQty }: {
item: CheckupItem; scope: Scope;
selected: boolean; shadowSelected: boolean; qty: number;
onToggle: () => void; onQty: (n: number) => void;
}) {
const [expanded, setExpanded] = useState(false);
const isCombo = item.item_type === 'combo';
return (
  <div className={`bg-white rounded-2xl px-3 py-3 shadow-sm border ${
    selected ? 'border-emerald-400' : shadowSelected ? 'border-amber-200' : 'border-gray-100'
  }`}>
    <div className="flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-gray-900 leading-snug">{item.name}</span>
          {isCombo && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800">组合</span>}
        </div>
        <div className="text-[11px] text-gray-500 mt-0.5">
          {item.description || (isCombo ? '组合项目，点击查看明细' : '单项检查')}
        </div>
        <div className="mt-1 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-50 text-gray-500 border border-gray-100">{item.category}</span>
          {isCombo && (
            <button onClick={() => setExpanded(x => !x)} className="text-[11px] text-[#0f5132] flex items-center gap-0.5">
              查看组合子项
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className={`transition ${expanded ? 'rotate-180' : ''}`}><path d="m6 9 6 6 6-6"/></svg>
            </button>
          )}
        </div>
        {expanded && isCombo && (
          <div className="mt-2 text-[11px] text-gray-500 bg-gray-50 rounded-lg px-2 py-1.5 border border-gray-100">
            ⚠️ 组合项目子项由医生根据标准执行，具体包含内容以当日医院公示为准。
          </div>
        )}
      </div>
      <div className="flex flex-col items-end gap-1">
        <div className="text-base font-bold text-[#0f5132]">¥{Number(item.default_price).toFixed(0)}</div>
        {selected ? (
          <div className="flex items-center gap-1">
            <button onClick={() => onQty(qty - 1)} className="w-6 h-6 rounded-full bg-gray-100 text-gray-600 text-sm">-</button>
            <span className="text-xs w-6 text-center">{qty}</span>
            <button onClick={() => onQty(qty + 1)} className="w-6 h-6 rounded-full bg-gray-100 text-gray-600 text-sm">+</button>
          </div>
        ) : shadowSelected && scope !== 'common' ? (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">公共已含</span>
        ) : null}
        <button onClick={onToggle}
          className={`h-8 w-20 rounded-full text-xs font-semibold flex items-center justify-center transition ${
            selected ? 'bg-emerald-500 text-white shadow-sm' : 'border border-gray-300 text-gray-600 bg-white'
          }`}>
          {selected ? '✓ 已添加' : '添加'}
        </button>
      </div>
    </div>
  </div>
);
}