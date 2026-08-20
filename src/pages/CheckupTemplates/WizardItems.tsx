import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
checkupApi, ROLES, ROLE_LABEL, ROLE_EMOJI, CATEGORIES,
type Role, type CheckupTemplate, type CheckupItem, type CheckupItemRef, type RolePlan
} from './api';
import {
  scopeVisible, isRoleSpecific, nameHitKeys,
  MALE_ONLY_KEYS, FM_ONLY_KEYS, FEMALE_KEYS, SINGLE_FORBID_KEYS,
} from './roleVisibility';
import type { Scope } from './roleVisibility';
import { useToast } from '@/components/Toast';

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

// 分类 → emoji 映射（胶囊美化：左侧小图标增加可识别度）
const CATEGORY_EMOJI: Record<string, string> = {
  '体格检查': '🩺',
  '实验室检查': '🔬',
  '影像检查': '📸',
  '功能检查': '💓',
  '肿瘤筛查': '🎗️',
  '妇科专项': '🌸',
  '男科专项': '♂️',
  '特色加项': '⭐',
  '其他': '📌',
};
function categoryEmoji(cat?: string): string {
  if (!cat) return '📌';
  return CATEGORY_EMOJI[cat] || '📌';
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
// 角色级排除：某角色排除某个公共项目
const [excluded, setExcluded] = useState<Record<Role, Set<string>>>({
  male: new Set(), female_married: new Set(), female_single: new Set(),
});

// 强制标准顺序：男→已婚女→未婚女，不受后端存储顺序影响
const _ROLE_ORDER: Role[] = ['male', 'female_married', 'female_single'];
const applicable: Role[] = (() => {
  const raw = (pkg?.applicable_roles as any) || ROLES;
  return _ROLE_ORDER.filter(r => raw.includes(r));
})();

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

// 过滤后的项目列表
// 公共tab：显示全部项目
// 角色tab：只显示「本角色专属项」+「公共区已选项」+「本角色已选项」，其余全隐藏
const filteredItems = useMemo(() => {
  const kw = keyword.trim().toLowerCase();
  const matchKw = (it: CheckupItem) =>
    !kw || (it.name || '').toLowerCase().includes(kw) || (it.code || '').toLowerCase().includes(kw);
  const matchCat = (it: CheckupItem) =>
    category === '全部' || it.category === category;

  // 公共tab：全部项目
  if (scope === 'common') {
    return items.filter(it => matchKw(it) && matchCat(it));
  }

  // 角色 tab：先强制 scopeVisible（对当前角色不可见的项目一律不显示），再判断是否展示
  return items.filter(it => {
    if (!matchKw(it) || !matchCat(it)) return false;
    // 强制可见性校验：不可见的项目（如未婚女视角的阴超）一律不显示
    if (!scopeVisible(it, scope)) return false;
    // 公共已选（且本角色未排除）/ 本角色已选 / 本角色专属 → 显示
    if (selected.common?.[it.id] && !excluded[scope as Role]?.has(it.id)) return true;
    if (selected.common?.[it.id] && excluded[scope as Role]?.has(it.id)) return true; // 已排除也显示（灰色态）
    if (selected[scope]?.[it.id]) return true;
    if (isRoleSpecific(it, scope)) return true;
    return false;
  });
}, [items, category, keyword, scope, selected]);

// 每个 scope 下是否选中某 item（对于 role scope，还要算 common 里选过的"阴影"显示）
const isSelectedInScope = (itemId: string, s: Scope) => !!selected[s]?.[itemId];

// 当前 role 汇总统计（common 中适用的 + 当前角色专属的，排除被角色级排除的项目）
const summaryForRole = (r: Role) => {
  const merged = new Map<string, SelectedItem>();
  const excludedSet = excluded[r] || new Set<string>();
  // common 中只合并对该角色适用的项目（妇科不计入男性等），且排除角色级排除的
  Object.values(selected.common || {}).forEach(si => {
    const item = items.find(i => i.id === si.item_id);
    if (item && scopeVisible(item, r) && !excludedSet.has(si.item_id)) {
      merged.set(si.item_id, { ...si });
    }
  });
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
  // 角色 tab 中：如果是公共阴影项 → 切换排除状态
  if (scope !== 'common' && selected.common?.[item.id]) {
    const role = scope as Role;
    setExcluded(prev => {
      const next = { ...prev };
      const set = new Set(next[role]);
      if (set.has(item.id)) {
        set.delete(item.id); // 恢复：从排除移除
        toast.info(`已恢复「${item.name}」到${ROLE_LABEL[role]}`);
      } else {
        set.add(item.id); // 排除：加入排除
        toast.info(`已排除「${item.name}」，不参与${ROLE_LABEL[role]}`);
      }
      next[role] = set;
      return next;
    });
    return;
  }
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

// 保存并进入下一步
const onSaveAndNext = async () => {
  if (!pkg || !id) return;
  // 项目库最新价格表（按 item_id 查），保存时用最新 default_price 而非旧快照，
  // 确保后端按真实项目库价格重算 original_total
  const itemLib: Record<string, CheckupItem> = {};
  for (const ci of items) itemLib[ci.id] = ci;
  // 构造 items list：把 selected 的四个 scope 展平
  // 处理角色级排除：被某角色排除的公共项目 → 该角色不再参与，由其他角色单独包含
  const flatItems: any[] = [];
  let so = 1;

  // 1) 公共项目：检查每个角色的排除状态
  Object.values(selected.common).forEach(si => {
    const ci = itemLib[si.item_id];
    const excludedRoles = ROLES.filter(r => excluded[r].has(si.item_id));
    const includedRoles = ROLES.filter(r => !excluded[r].has(si.item_id));
    if (excludedRoles.length === 0) {
      // 没有角色排除 → 保持公共
      flatItems.push({
        item_id: si.item_id,
        role: 'common',
        quantity: si.quantity,
        item_name_snapshot: ci?.name || si.name_snapshot,
        item_price: ci ? Number(ci.default_price) || 0 : si.price_snapshot,
        insurance_price_snapshot: ci ? Number(ci.insurance_price) || 0 : si.insurance_snapshot,
        sort_order: so++,
        remark: null,
      });
    } else {
      // 有角色排除 → 公共项目按 includedRoles 拆分（只包含未排除的角色）
      if (includedRoles.length === ROLES.length) {
        // 全部未排除 → 保持公共
        flatItems.push({
          item_id: si.item_id,
          role: 'common',
          quantity: si.quantity,
          item_name_snapshot: ci?.name || si.name_snapshot,
          item_price: ci ? Number(ci.default_price) || 0 : si.price_snapshot,
          insurance_price_snapshot: ci ? Number(ci.insurance_price) || 0 : si.insurance_snapshot,
          sort_order: so++,
          remark: null,
        });
      } else {
        // 按剩余角色单独添加
        includedRoles.forEach(r => {
          flatItems.push({
            item_id: si.item_id,
            role: r,
            quantity: si.quantity,
            item_name_snapshot: ci?.name || si.name_snapshot,
            item_price: ci ? Number(ci.default_price) || 0 : si.price_snapshot,
            insurance_price_snapshot: ci ? Number(ci.insurance_price) || 0 : si.insurance_snapshot,
            sort_order: so++,
            remark: null,
          });
        });
      }
    }
  });

  // 2) 角色专属项目
  ROLES.forEach(r => {
    Object.values(selected[r] || {}).forEach(si => {
      const ci = itemLib[si.item_id];
      flatItems.push({
        item_id: si.item_id,
        role: r,
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
    toast.success('项目保存成功，进入定价环节...');
    navigate(`/h/checkup-templates/${id}/pricing`);
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
      {/* 三角色 Tabs（单行：emoji+名称+数量，无价格无Badge，统一flex-1） */}
      <div className="px-2 flex gap-1 pb-2">
        <TabButton active={scope === 'common'} onClick={() => setScope('common')}
          color="text-gray-800 bg-amber-50 border-amber-200"
          emoji="🔗" label="公共" meta={`${Object.keys(selected.common).length}`} />
        {applicable.map(r => {
          const smr = summaryForRole(r);
          const active = scope === r;
          const st = TAB_ROLE_STYLE[r].active;
          const label = r === 'male' ? '男' : r === 'female_married' ? '已婚女' : '未婚女';
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
                  {smr.count}
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

    {/* 项目列表（双列胶囊网格） */}
    <main className="px-3 pt-3">
      {loading && <div className="text-center text-gray-400 text-xs py-12">加载中...</div>}
      {!loading && filteredItems.length === 0 && (
        <div className="text-center py-12 text-gray-400 text-xs">没有匹配的项目</div>
      )}
      <div className="grid grid-cols-2 gap-2">
        {filteredItems.map(it => {
          const isExcluded = scope !== 'common' && isSelectedInScope(it.id, 'common') && excluded[scope as Role]?.has(it.id);
          return (
            <ItemCard key={it.id} item={it}
              scope={scope}
              selected={isSelectedInScope(it.id, scope)}
              shadowSelected={scope !== 'common' && isSelectedInScope(it.id, 'common')}
              isExcluded={isExcluded}
              onToggle={() => toggleItem(it)}
            />
          );
        })}
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
          {saving ? '保存中...' : '下一步：定价 →'}
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

function TabButton({ active, onClick, emoji, label, meta, color }: any) {
return (
  <button onClick={onClick}
    className={`flex-1 relative px-1.5 py-1.5 rounded-lg border transition-all ${
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

function ItemCard({ item, scope, selected, shadowSelected, isExcluded, onToggle }: {
item: CheckupItem; scope: Scope;
selected: boolean; shadowSelected: boolean; isExcluded: boolean;
onToggle: () => void;
}) {
const isCombo = item.item_type === 'combo';
const label = getApplicableLabel(item);
const isPublic = shadowSelected && scope !== 'common';
const catEmoji = categoryEmoji(item.category);

// 选中态：渐变绿+白字+轻阴影
// 公共已含且未排除：琥珀+橙描边
// 公共已含且已排除：灰色+红描边+删除线效果
// 未选中：白底+灰描边+悬停加深
const cardClass = isExcluded
  ? 'bg-gray-100 border-red-300 text-gray-400 shadow-sm opacity-70'
  : selected
  ? 'bg-gradient-to-br from-emerald-400 to-emerald-600 border-emerald-500 text-white shadow-md shadow-emerald-500/30'
  : isPublic
  ? 'bg-gradient-to-br from-amber-50 to-amber-100 border-amber-400 text-amber-900 shadow-sm'
  : 'bg-white border-gray-200 text-gray-800 shadow-sm hover:border-emerald-300 hover:shadow-md';

return (
  <button onClick={onToggle}
    className={`w-full h-16 text-left rounded-2xl border px-2.5 py-2 transition-all active:scale-[0.98] ${cardClass}`}>
    <div className="flex items-center gap-1.5 h-full">
      {/* 左侧分类 emoji */}
      <span className="text-base leading-none shrink-0">{catEmoji}</span>
      {/* 中间项目名 */}
      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <div className={`truncate text-[13px] font-semibold leading-tight ${isExcluded ? 'line-through' : ''}`}>{item.name}</div>
        <div className="mt-0.5 flex items-center gap-1 flex-wrap">
          {isCombo && (
            <span className={`text-[9px] px-1 py-0 rounded ${
              isExcluded ? 'bg-gray-300 text-gray-500' :
              selected ? 'bg-white/30 text-white' : 'bg-amber-100 text-amber-800'
            }`}>组合</span>
          )}
          {label && (
            <span className={`text-[9px] px-1 py-0 rounded ${
              isExcluded ? 'bg-gray-300 text-gray-500' :
              selected ? 'bg-white/30 text-white' : 'bg-purple-100 text-purple-700'
            }`}>{label}</span>
          )}
          {isPublic && !isExcluded && (
            <span className="text-[9px] px-1 py-0 rounded bg-amber-300 text-amber-900 font-semibold">公共</span>
          )}
          {isExcluded && (
            <span className="text-[9px] px-1 py-0 rounded bg-red-100 text-red-600 font-semibold">已排除</span>
          )}
        </div>
      </div>
      {/* 右侧状态图标 */}
      {isExcluded && <span className="text-red-400 text-sm shrink-0">✕</span>}
      {selected && <span className="text-emerald-50 text-sm shrink-0">✓</span>}
      {isPublic && !selected && !isExcluded && <span className="text-amber-500 text-sm shrink-0">📌</span>}
    </div>
  </button>
);
}