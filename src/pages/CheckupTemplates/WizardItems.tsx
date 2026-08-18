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

// 项目名关键字规则（与迁移 083 对应，作为 applicable_roles 未填时的前端兜底）
// 男性专属关键字
const MALE_ONLY_KEYS = ['前列腺','阴囊','精液','男科','睾丸','勃起','包皮','精索','附睾','PSA','男性激素'];
// 已婚女专属（含侵入性）关键字
const FM_ONLY_KEYS = ['阴超','阴道B','阴道镜','宫腔镜','妇科内诊','双合诊','白带','宫颈刮片','TCT','液基','HPV','宫颈','阴道'];
// 已婚女+未婚女通用关键字
const FEMALE_KEYS = ['乳腺','卵巢','子宫','盆腔','附件','性激素','雌激素','孕酮','妇科','妇产科','产前','唐筛','孕检','HCG','人绒毛膜','月经','痛经'];
// 未婚女禁用（已婚女专属，但未命中上述 FM_ONLY_KEYS 的补充）
const SINGLE_FORBID_KEYS = ['经阴道'];

// 判断某项目名是否命中给定关键字数组
function nameHitKeys(name: string, keys: string[]): boolean {
  const n = (name || '').toLowerCase();
  return keys.some(k => n.includes(k.toLowerCase()));
}

// 判断某项目是否对当前 scope 可见
// 优先级：applicable_roles 字段 > 项目名关键字兜底
function scopeVisible(it: CheckupItem, s: Scope): boolean {
  if (s === 'common') return true;
  const name = it.name || '';
  const roles = it.applicable_roles;

  // 优先用字段值
  if (roles && Array.isArray(roles) && roles.length > 0) {
    return roles.includes(s);
  }

  // 否则用关键字兜底
  // 男性视角 → 隐藏所有女性项目（FM_ONLY_KEYS + FEMALE_KEYS）
  if (s === 'male') {
    if (nameHitKeys(name, FM_ONLY_KEYS)) return false;
    if (nameHitKeys(name, FEMALE_KEYS)) return false;
    return true;
  }
  // 已婚女视角 → 隐藏男性专属项目
  if (s === 'female_married') {
    if (nameHitKeys(name, MALE_ONLY_KEYS)) return false;
    return true;
  }
  // 未婚女视角 → 隐藏男性专属项目 + 侵入性已婚女专属项目（FM_ONLY_KEYS + SINGLE_FORBID_KEYS）
  if (s === 'female_single') {
    if (nameHitKeys(name, MALE_ONLY_KEYS)) return false;
    if (nameHitKeys(name, FM_ONLY_KEYS)) return false;
    if (nameHitKeys(name, SINGLE_FORBID_KEYS)) return false;
    return true;
  }
  return true;
}

// 胶囊标记：非通用项目显示适用范围（如「仅男性」「仅女性」）
function getApplicableLabel(it: CheckupItem): string | null {
  const roles = it.applicable_roles;
  if (!roles || !Array.isArray(roles) || roles.length === 0) return null;
  if (roles.length >= 3) return null;
  if (roles.length === 1 && roles[0] === 'male') return '仅男性';
  if (roles.includes('female_married') && roles.includes('female_single') && roles.length === 2) return '仅女性';
  if (roles.length === 1 && roles[0] === 'female_married') return '仅已婚女';
  if (roles.length === 1 && roles[0] === 'female_single') return '仅未婚女';
  // 混合场景，用中文枚举拼接
  return roles.map(r => ROLE_LABEL[r]).join('+');
}

// WizardItems 角色配色（Tab 选中态 + 底部价格胶囊）
const TAB_ROLE_STYLE: Record<Role, {
  active: { border: string; bg: string; text: string; price: string };
  bottom: string;
}> = {
  male: {
    active: { border: 'border-blue-500', bg: 'bg-blue-50', text: 'text-blue-800', price: 'text-blue-800' },
    bottom: 'bg-blue-50   border-blue-100   text-blue-900',
  },
  female_married: {
    active: { border: 'border-pink-500', bg: 'bg-pink-50', text: 'text-pink-800', price: 'text-pink-800' },
    bottom: 'bg-pink-50   border-pink-100   text-pink-900',
  },
  female_single: {
    active: { border: 'border-purple-500', bg: 'bg-purple-50', text: 'text-purple-800', price: 'text-purple-800' },
    bottom: 'bg-purple-50 border-purple-100 text-purple-900',
  },
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
      // 项目库最新价格表（按 item_id 查），避免沿用旧模板快照导致原价错误
      const itemLib: Record<string, CheckupItem> = {};
      if (itemsRes?.ok && Array.isArray(itemsRes.data)) {
        for (const ci of itemsRes.data) itemLib[ci.id] = ci;
      }
      const next: SelectedState = { common: {}, male: {}, female_married: {}, female_single: {} };
      (['common', ...ROLES] as Scope[]).forEach(s => {
        const arr: CheckupItemRef[] = Array.isArray(src[s]) ? src[s] : [];
        for (const it of arr) {
          const ci = itemLib[it.item_id];
          next[s][it.item_id] = {
            item_id: it.item_id,
            name_snapshot: (ci?.name || it.item_name_snapshot || '') as string,
            price_snapshot: ci ? Number(ci.default_price) || 0 : (Number(it.item_price) || 0),
            insurance_snapshot: ci ? Number(ci.insurance_price) || 0 : (Number(it.insurance_price_snapshot) || 0),
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

// 过滤后的项目列表（分类 + 关键字 + 适用角色）
const filteredItems = useMemo(() => {
  const kw = keyword.trim().toLowerCase();
  return items.filter(it => {
    if (category !== '全部' && it.category !== category) return false;
    if (kw && !(it.name || '').toLowerCase().includes(kw) && !(it.code || '').toLowerCase().includes(kw)) return false;
    if (!scopeVisible(it, scope)) return false;
    return true;
  });
}, [items, category, keyword, scope]);

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
// 公共项目汇总（仅 common）
const summaryCommonTotal = () => {
  let total = 0;
  for (const si of Object.values(selected.common || {})) { total += si.price_snapshot * si.quantity; }
  return total;
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
  // 项目库最新价格表（按 item_id 查），保存时用最新 default_price 而非旧快照，
  // 确保后端按真实项目库价格重算 original_total
  const itemLib: Record<string, CheckupItem> = {};
  for (const ci of items) itemLib[ci.id] = ci;
  // 构造 items list：把 selected 的四个 scope 展平
  const flatItems: any[] = [];
  let so = 1;
  (['common', ...ROLES] as Scope[]).forEach(s => {
    Object.values(selected[s]).forEach(si => {
      const ci = itemLib[si.item_id];
      flatItems.push({
        item_id: si.item_id,
        role: s,
        quantity: si.quantity,
        item_name_snapshot: ci?.name || si.name_snapshot,
        item_price: ci ? Number(ci.default_price) || 0 : si.price_snapshot,
        insurance_price_snapshot: ci ? Number(ci.insurance_price) || 0 : si.insurance_snapshot,
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
      {/* 三角色 Tabs（单行：emoji+名称+数量价格，无Badge，公共略宽） */}
      <div className="px-2 flex gap-1 pb-2">
        {/* 公共：占比 5 份 */}
        <TabButton active={scope === 'common'} onClick={() => setScope('common')}
          color="text-gray-800 bg-amber-50 border-amber-200"
          flexClass="flex-[1.2]"
          emoji="🔗" label="公共" meta={`(${Object.keys(selected.common).length}) ¥${summaryCommonTotal().toFixed(0)}`} />
        {/* 三角色：各占 4 份 */}
        {applicable.map(r => {
          const smr = summaryForRole(r);
          const active = scope === r;
          const st = TAB_ROLE_STYLE[r].active;
          const label = r === 'male' ? '男' : r === 'female_married' ? '已婚' : '未婚';
          return (
            <button key={r} onClick={() => setScope(r)}
              className={`flex-1 relative px-1.5 py-1.5 rounded-lg border transition-all ${
                active ? `${st.border} ${st.bg}` : 'border-gray-100 bg-white hover:border-gray-200'
              }`}>
              <div className="flex items-center gap-1 w-full justify-center">
                <div className="text-sm leading-none">{ROLE_EMOJI[r]}</div>
                <div className={`text-[11px] font-semibold leading-tight whitespace-nowrap ${active ? st.text : 'text-gray-800'}`}>
                  {label}
                </div>
                <div className={`text-[10px] font-semibold whitespace-nowrap ${active ? 'text-gray-700' : 'text-gray-500'}`}>
                  {smr.count}¥{smr.total.toFixed(0)}
                </div>
              </div>
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

    {/* 角色视角提示 banner */}
    {scope !== 'common' && (
      <div className={`mx-3 mt-3 border text-xs rounded-xl px-3 py-2 flex items-start gap-2 ${
        scope === 'male' ? 'bg-blue-50 border-blue-200 text-blue-800' :
        scope === 'female_married' ? 'bg-pink-50 border-pink-200 text-pink-800' :
        'bg-purple-50 border-purple-200 text-purple-800'
      }`}>
        <span className="text-base">🎯</span>
        <div>当前：<span className="font-semibold">{ROLE_EMOJI[scope as Role]} {ROLE_LABEL[scope as Role]}视角</span>。仅显示「公共已含」+「{ROLE_LABEL[scope as Role]}可选」项目，可在此增删专属项目。</div>
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
            <div key={r} className={`shrink-0 px-2 py-1 rounded-full border flex items-center gap-1.5 text-[11px] ${TAB_ROLE_STYLE[r].bottom}`}>
              <span>{ROLE_EMOJI[r]}</span><span>{ROLE_LABEL[r]}</span>
              <span className="font-semibold">{sm.count}项</span>
              <span className="font-bold">¥{sm.total.toFixed(0)}</span>
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

function TabButton({ active, onClick, emoji, label, meta, color, flexClass }: any) {
return (
  <button onClick={onClick}
    className={`${flexClass || 'flex-1'} relative px-1.5 py-1.5 rounded-lg border transition-all ${
      active ? 'border-amber-400 ' + color : 'border-gray-100 bg-white'
    }`}>
    <div className="flex items-center gap-1 w-full justify-center">
      <div className="text-sm leading-none">{emoji}</div>
      <div className={`text-[11px] font-semibold leading-tight whitespace-nowrap ${active ? 'text-amber-800' : 'text-gray-800'}`}>{label}</div>
      <div className={`text-[10px] font-semibold whitespace-nowrap ${active ? 'text-gray-700' : 'text-gray-500'}`}>{meta}</div>
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
          {(() => {
            const label = getApplicableLabel(item);
            return label ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-800">{label}</span> : null;
          })()}
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