import { useEffect, useMemo, useState } from 'react';
import { X, Plus, Search, Save, ChevronLeft, ChevronRight, Check, Sparkles, AlertTriangle } from 'lucide-react';
import {
  checkupApi, ROLES, ROLE_LABEL, ROLE_EMOJI, ROLE_HINT, CATEGORIES,
  type Role, type CheckupTemplate, type CheckupItem, type CheckupItemRef, type RolePlan
} from './api';
import { scopeVisible, isRoleSpecific, type Scope } from '@/pages/CheckupTemplates/roleVisibility';
import { useToast } from '@/components/Toast';
import { useAuthStore } from '@/store/authStore';

interface SelectedItem {
  item_id: string;
  name_snapshot: string;
  price_snapshot: number;
  insurance_snapshot: number;
  quantity: number;
}
type SelectedState = Record<Scope, Record<string, SelectedItem>>;
const EMPTY_SCOPE: SelectedState = {
  common: {}, male: {}, female_married: {}, female_single: {},
};

type Step = 'info' | 'items' | 'plan';

export default function PackageDrawer({
  open, templateId, onClose, onSaved,
}: {
  open: boolean;
  templateId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const isAdmin = useAuthStore(s => s.isAdmin());

  const [step, setStep] = useState<Step>('info');
  const [pkg, setPkg] = useState<CheckupTemplate | null>(null);
  const [items, setItems] = useState<CheckupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 基本信息表单
  const [form, setForm] = useState({
    name: '',
    description: '',
    is_public: false,
    applicable_roles: [...ROLES] as Role[],
  });

  // 项目选择状态
  const [scope, setScope] = useState<Scope>('common');
  const [category, setCategory] = useState<string>('全部');
  const [keyword, setKeyword] = useState('');
  const [selected, setSelected] = useState<SelectedState>({ ...EMPTY_SCOPE });

  // 价格方案
  const [rolePlans, setRolePlans] = useState<Record<Role, Partial<RolePlan>>>({} as any);

  const applicable: Role[] = form.applicable_roles.length > 0 ? form.applicable_roles : ROLES;

  // 打开抽屉时重置状态并加载
  useEffect(() => {
    if (!open) return;
    setStep(templateId ? 'items' : 'info');
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, templateId]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const itemsRes: any = await checkupApi.listItems();
      if (itemsRes?.ok) setItems(itemsRes.data || []);

      if (templateId) {
        const tplRes: any = await checkupApi.get(templateId);
        if (tplRes?.ok) {
          const t: CheckupTemplate = tplRes.data;
          setPkg(t);
          setForm({
            name: t.name,
            description: t.description || '',
            is_public: !!t.is_public,
            applicable_roles: (t.applicable_roles?.length ? t.applicable_roles : [...ROLES]) as Role[],
          });
          // 回填已选项目
          const src: any = t.items_by_role || {};
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
          // 回填价格方案
          const rp: any = {};
          const pl = t.role_plans || t.role_price_capsule || {};
          for (const r of ROLES) {
            const p: any = (pl as any)[r] || {};
            rp[r] = {
              original_total: Number(p.original_total || 0),
              discount_price: Number(p.discount_price || 0),
              discount_rate: Number(p.discount_rate || 100),
              remark: p.remark || '',
            };
          }
          setRolePlans(rp);
        } else {
          toast.error(tplRes?.error || '加载套餐失败');
        }
      } else {
        setPkg(null);
        setForm({ name: '', description: '', is_public: isAdmin, applicable_roles: [...ROLES] });
        setSelected({ ...EMPTY_SCOPE });
        setRolePlans({} as any);
      }
    } catch (e: any) {
      toast.error(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  // -------- 项目选择逻辑 --------
  const filteredItems = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const matchKw = (it: CheckupItem) =>
      !kw || (it.name || '').toLowerCase().includes(kw) || (it.code || '').toLowerCase().includes(kw);
    const matchCat = (it: CheckupItem) =>
      category === '全部' || it.category === category;

    if (scope === 'common') {
      return items.filter(it => it.status === 1 && matchKw(it) && matchCat(it));
    }

    // 角色 tab：强制 scopeVisible 前置，再判断是否展示
    return items.filter(it => {
      if (it.status !== 1) return false;
      if (!matchKw(it) || !matchCat(it)) return false;
      if (!scopeVisible(it, scope)) return false;
      if (selected.common?.[it.id]) return true;
      if (selected[scope]?.[it.id]) return true;
      if (isRoleSpecific(it, scope)) return true;
      return false;
    });
  }, [items, category, keyword, scope, selected]);

  const isSelectedInScope = (itemId: string, s: Scope) => !!selected[s]?.[itemId];

  const summaryForRole = (r: Role) => {
    const merged = new Map<string, SelectedItem>();
    // common 中只合并对该角色适用的项目（妇科不计入男性等）
    Object.values(selected.common || {}).forEach(si => {
      const item = items.find(i => i.id === si.item_id);
      if (item && scopeVisible(item, r)) {
        merged.set(si.item_id, { ...si });
      }
    });
    Object.values(selected[r] || {}).forEach(si => merged.set(si.item_id, { ...si }));
    let total = 0, count = 0, insurance = 0;
    for (const si of merged.values()) {
      total += si.price_snapshot * si.quantity;
      insurance += si.insurance_snapshot * si.quantity;
      count += 1;
    }
    return { total, count, insurance };
  };

  // 切到 plan 步骤时自动按当前项目汇总填充 role_plans
  const goToPlan = () => {
    const rp: any = {};
    for (const r of applicable) {
      const { total } = summaryForRole(r);
      const prev = rolePlans[r];
      const discountPrice = prev?.discount_price
        ? Number(prev.discount_price)
        : Math.round(total * 100) / 100;
      const rate = total > 0 ? Math.round((discountPrice / total) * 10000) / 100 : 100;
      rp[r] = {
        original_total: Math.round(total * 100) / 100,
        discount_price: discountPrice,
        discount_rate: rate,
        remark: prev?.remark || '',
      };
    }
    setRolePlans(rp);
    setStep('plan');
  };

  const toggleItem = (item: CheckupItem) => {
    setSelected(prev => {
      const cur = { ...prev[scope] };
      if (cur[item.id]) delete cur[item.id];
      else {
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

  const setRolePlanField = (r: Role, k: keyof RolePlan, v: any) => {
    setRolePlans(prev => {
      const cur = { ...(prev[r] || {}) } as Partial<RolePlan>;
      (cur as any)[k] = v;
      // 自动计算折扣率或折扣价
      if (k === 'discount_price' && cur.original_total) {
        const ot = Number(cur.original_total) || 0;
        const dp = Number(cur.discount_price) || 0;
        cur.discount_rate = ot > 0 ? Math.round((dp / ot) * 10000) / 100 : 100;
      }
      if (k === 'discount_rate' && cur.original_total) {
        const ot = Number(cur.original_total) || 0;
        const rate = Number(cur.discount_rate) || 0;
        cur.discount_price = Math.round(ot * rate) / 100;
      }
      return { ...prev, [r]: cur };
    });
  };

  // 一键统折扣：所有角色按相同 rate
  const applySameRate = (rate: number) => {
    setRolePlans(prev => {
      const next: any = { ...prev };
      for (const r of applicable) {
        const ot = Number(next[r]?.original_total || 0);
        next[r] = {
          ...(next[r] || {}),
          discount_rate: rate,
          discount_price: Math.round(ot * rate) / 100,
        };
      }
      return next;
    });
  };

  // P4: 按当前选中项目重新生成三角色方案（原价 = 项目*数量汇总，优惠价 = 原价，折扣率 = 100）
  // 如果之前已设置统一折扣率（比如 90），则沿用上次折扣率重算 discount_price
  const recomputeRolePlansByItems = () => {
    setRolePlans(prev => {
      const next: any = { ...prev };
      for (const r of applicable) {
        const { total } = summaryForRole(r);
        const previous = next[r] || {};
        const keepRate = previous.discount_rate && Number(previous.discount_rate) > 0
          ? Number(previous.discount_rate)
          : 100;
        const roundedTotal = Math.round(total * 100) / 100;
        next[r] = {
          ...previous,
          original_total: roundedTotal,
          discount_rate: keepRate,
          discount_price: Math.round(roundedTotal * keepRate) / 100,
        };
      }
      return next;
    });
    toast.success('已按当前项目重新生成三角色价格方案');
  };

  // -------- 保存：基本信息 → （如需创建）→ items & plans --------
  const saveInfo = async () => {
    if (!form.name.trim()) { toast.error('请填写套餐名称'); return; }
    if (form.applicable_roles.length === 0) { toast.error('请至少选择一个适用角色'); return; }

    // 新建或更新基本信息
    setSaving(true);
    try {
      let currentPkgId = templateId;
      const body: any = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        applicable_roles: form.applicable_roles,
        is_public: form.is_public,
        status: 1,
      };
      if (currentPkgId) {
        const res: any = await checkupApi.update(currentPkgId, body);
        if (!res?.ok) throw new Error(res?.error || '保存失败');
        setPkg(res.data);
      } else {
        const res: any = await checkupApi.create(body);
        if (!res?.ok) throw new Error(res?.error || '创建失败');
        currentPkgId = res.data?.id;
        setPkg(res.data);
        toast.success('套餐已创建');
      }
      // 跳到下一步
      if (currentPkgId) {
        // 把 id 回传给父是通过父 state 管理，但父没有 setEditingId，我们这里直接修改 pkg
        // 用小 trick：直接改 state 然后跳到 items
        setPkg(prev => prev ? { ...prev, id: currentPkgId! } : prev);
        setStep('items');
      }
    } catch (e: any) {
      toast.error(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  // 完成最终保存（items + role_plans）
  const finalSave = async () => {
    if (!pkg?.id) { toast.error('请先完成基本信息保存'); return; }
    setSaving(true);
    try {
      // 构造 flatItems
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
      const res = await checkupApi.saveItems(pkg.id, { items: flatItems, role_plans: rolePlans as any });
      if (!res?.ok) throw new Error(res?.error || '保存失败');
      toast.success('套餐保存成功');
      onSaved();
    } catch (e: any) {
      toast.error(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const steps: { key: Step; name: string; icon: string }[] = [
    { key: 'info', name: '基本信息', icon: '📝' },
    { key: 'items', name: '选项目', icon: '🧪' },
    { key: 'plan', name: '定方案', icon: '💰' },
  ];
  const stepIdx = steps.findIndex(s => s.key === step);

  // 校验每个步骤能否前进
  const canNextItems = applicable.some(r => summaryForRole(r).count > 0);

  return (
    <div className="fixed inset-0 z-[80] flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-4xl h-full bg-gray-50 shadow-2xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* 顶部栏 */}
        <div className="shrink-0 bg-white border-b border-gray-200 px-5 py-3 flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-700 to-emerald-900 text-white flex items-center justify-center font-bold">
              {pkg?.id ? '✏️' : '✨'}
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">
                {pkg?.id ? '编辑套餐' : '新建套餐'}
              </h2>
              <p className="text-[11px] text-gray-400">
                {pkg?.code ? `编号 ${pkg.code}` : '完成后将自动生成编号'}
              </p>
            </div>
          </div>

          {/* 步骤条 */}
          <div className="flex items-center gap-1 mx-4 flex-1 max-w-xl">
            {steps.map((s, i) => (
              <div key={s.key} className="flex items-center gap-1 flex-1 min-w-0">
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  stepIdx === i
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : stepIdx > i
                      ? 'bg-emerald-100/40 text-emerald-700 border border-emerald-100'
                      : 'text-gray-400'
                }`}>
                  <span>{stepIdx > i ? <Check size={12} /> : s.icon}</span>
                  <span className="truncate">{i + 1}. {s.name}</span>
                </div>
                {i < steps.length - 1 && (
                  <div className={`h-px flex-1 ${stepIdx > i ? 'bg-emerald-300' : 'bg-gray-200'}`} />
                )}
              </div>
            ))}
          </div>

          <button onClick={onClose} className="shrink-0 w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-500 flex items-center justify-center">
            <X size={16} />
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="text-center py-20 text-gray-400 text-sm">
              <span className="inline-block w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin mr-2 align-middle" />
              加载中...
            </div>
          ) : step === 'info' ? (
            <InfoStep
              form={form}
              setForm={setForm}
              isAdmin={isAdmin}
            />
          ) : step === 'items' ? (
            <ItemsStep
              scope={scope} setScope={setScope}
              category={category} setCategory={setCategory}
              keyword={keyword} setKeyword={setKeyword}
              filteredItems={filteredItems}
              selected={selected}
              isSelectedInScope={isSelectedInScope}
              summaryForRole={summaryForRole}
              applicable={applicable}
              toggleItem={toggleItem}
              setQty={setQty}
            />
          ) : (
            <PlanStep
              applicable={applicable}
              rolePlans={rolePlans}
              summaryForRole={summaryForRole}
              setRolePlanField={setRolePlanField}
              applySameRate={applySameRate}
              recomputeRolePlansByItems={recomputeRolePlansByItems}
            />
          )}
        </div>

        {/* 底部操作栏 */}
        <div className="shrink-0 bg-white border-t border-gray-200 px-5 py-3 flex items-center justify-between gap-3">
          <div className="text-xs text-gray-500">
            {step === 'items' && canNextItems && (
              <span className="inline-flex items-center gap-1">
                <Sparkles size={12} className="text-amber-500" />
                下一步将自动生成价格方案
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {stepIdx > 0 && (
              <button onClick={() => setStep(steps[stepIdx - 1].key)}
                className="px-4 py-2 text-sm rounded-lg bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 inline-flex items-center gap-1">
                <ChevronLeft size={14} /> 上一步
              </button>
            )}
            {step === 'info' && (
              <button onClick={saveInfo} disabled={saving}
                className="px-5 py-2 text-sm rounded-lg bg-gradient-to-r from-emerald-700 to-emerald-800 hover:from-emerald-800 hover:to-emerald-900 text-white font-medium inline-flex items-center gap-1.5 disabled:opacity-60">
                {saving ? '保存中...' : <><Save size={14} /> 下一步：选项目</>}
              </button>
            )}
            {step === 'items' && (
              <button onClick={goToPlan} disabled={!canNextItems}
                className="px-5 py-2 text-sm rounded-lg bg-gradient-to-r from-emerald-700 to-emerald-800 hover:from-emerald-800 hover:to-emerald-900 text-white font-medium inline-flex items-center gap-1.5 disabled:opacity-50">
                {canNextItems ? <>下一步：定方案 <ChevronRight size={14} /></> : '请至少添加一个项目'}
              </button>
            )}
            {step === 'plan' && (
              <button onClick={finalSave} disabled={saving}
                className="px-5 py-2 text-sm rounded-lg bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-700 hover:to-amber-800 text-white font-medium inline-flex items-center gap-1.5 disabled:opacity-60">
                {saving ? '保存中...' : <><Save size={14} /> 完成保存</>}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// -------- 步骤1：基本信息 --------
function InfoStep({ form, setForm, isAdmin }: {
  form: any; setForm: (f: any) => void; isAdmin: boolean;
}) {
  const inputCls =
    'w-full bg-white border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-green-500 transition-colors';
  const labelCls = 'block text-sm font-medium text-gray-700 mb-1.5';
  return (
    <div className="p-6">
      <div className="max-w-2xl mx-auto space-y-5">
        <div>
          <label className={labelCls}>
            套餐名称 <span className="text-red-500">*</span>
          </label>
          <input
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            placeholder="例如：全家安心基础体检套餐"
            maxLength={50}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>套餐简介</label>
          <textarea
            value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
            rows={3}
            maxLength={500}
            placeholder="适合人群 / 核心亮点（将展示在套餐首页和分享链接）"
            className={inputCls + ' resize-none'}
          />
        </div>
        <div>
          <label className={labelCls}>适用人群 <span className="text-red-500">*</span></label>
          <div className="grid grid-cols-3 gap-3">
            {ROLES.map(r => {
              const checked = form.applicable_roles.includes(r);
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    const arr = checked
                      ? form.applicable_roles.filter((x: Role) => x !== r)
                      : [...form.applicable_roles, r];
                    setForm({ ...form, applicable_roles: arr });
                  }}
                  className={`p-3 rounded-xl border-2 text-left transition-all ${
                    checked
                      ? 'border-emerald-500 bg-emerald-50'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-2xl">{ROLE_EMOJI[r]}</span>
                    <span className={`text-sm font-semibold ${checked ? 'text-emerald-800' : 'text-gray-800'}`}>
                      {ROLE_LABEL[r]}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-500 leading-snug">{ROLE_HINT[r]}</p>
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label className={`${labelCls} flex items-center gap-2`}>
            <input
              type="checkbox"
              checked={!!form.is_public}
              onChange={e => setForm({ ...form, is_public: e.target.checked })}
              disabled={!isAdmin}
              className="accent-green-500 w-4 h-4"
            />
            <span className={isAdmin ? '' : 'text-gray-400'}>
              设为基础套餐
              <span className="text-[11px] text-gray-400 ml-1.5">（公开，销售员可克隆）</span>
            </span>
            {!isAdmin && (
              <span className="text-[11px] text-amber-600 ml-auto inline-flex items-center gap-1">
                🔒 仅管理员可设置
              </span>
            )}
          </label>
          {form.is_public && (
            <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-[12px] text-amber-800">
              基础套餐将展示在所有销售员的「基础套餐」列表中，可被销售员一键克隆为自己的套餐（克隆后项目与价格可自由调整）。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// -------- 步骤2：选项目 --------
function ItemsStep(props: any) {
  const {
    scope, setScope,
    category, setCategory,
    keyword, setKeyword,
    filteredItems,
    selected,
    isSelectedInScope,
    summaryForRole,
    applicable,
    toggleItem,
    setQty,
  } = props;

  return (
    <div className="flex flex-col lg:flex-row h-full">
      {/* 左侧：Scopes（公共+三角色） */}
      <aside className="lg:w-64 shrink-0 bg-white border-r border-gray-200 p-3 space-y-2 overflow-y-auto">
        <ScopeCard
          active={scope === 'common'}
          onClick={() => setScope('common')}
          emoji="🔗"
          title="公共项目"
          sub="三角色共同项"
          badge={Object.keys(selected.common).length}
          color="amber"
          hint={`包含：${applicable.map((r: Role) => ROLE_LABEL[r]).join('、')}`}
        />
        {applicable.map((r: Role) => {
          const sm = summaryForRole(r);
          return (
            <ScopeCard
              key={r}
              active={scope === r}
              onClick={() => setScope(r)}
              emoji={ROLE_EMOJI[r]}
              title={ROLE_LABEL[r]}
              sub={ROLE_HINT[r]}
              badge={Object.keys(selected[r]).length}
              price={sm.total}
              count={sm.count}
              color={r === 'male' ? 'blue' : r === 'female_married' ? 'pink' : 'purple'}
            />
          );
        })}
        <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-[11px] text-emerald-800 leading-relaxed">
          💡 <span className="font-semibold">公共项目</span> 选中后会自动同步给下方三个角色，建议把共有的项目（血常规、胸片、心电图等）放在公共区集中管理。
        </div>
      </aside>

      {/* 右侧：筛选 + 项目列表 */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Scope 描述 */}
        {scope === 'common' && (
          <div className="bg-amber-50 border-b border-amber-100 text-amber-800 text-xs px-5 py-2 flex items-start gap-2">
            <span>💡</span>
            <div>当前：<span className="font-semibold">公共项目区</span>。选中的项目会自动同步给 <span className="font-semibold">{applicable.map((r: Role) => ROLE_LABEL[r]).join('、')}</span>。</div>
          </div>
        )}
        {/* 筛选区 */}
        <div className="bg-white border-b border-gray-200 px-5 py-3 space-y-2.5">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              placeholder="搜索项目：血脂、CT、甲状腺..."
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 !pl-8 text-sm focus:outline-none focus:border-green-500"
            />
            {keyword && (
              <button onClick={() => setKeyword('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600 px-1.5">
                清空
              </button>
            )}
          </div>
          <div className="flex gap-1.5 overflow-x-auto">
            {['全部', ...CATEGORIES].map(c => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`shrink-0 h-7 px-3 rounded-full text-xs transition ${
                  category === c
                    ? 'bg-emerald-700 text-white'
                    : 'bg-gray-50 text-gray-600 border border-gray-200 hover:border-emerald-200'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
        {/* 项目列表 */}
        <div className="flex-1 overflow-y-auto p-5 space-y-2.5">
          {filteredItems.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-sm">没有匹配的项目</div>
          ) : (
            filteredItems.map((it: CheckupItem) => {
              const sel = isSelectedInScope(it.id, scope);
              const shadow = scope !== 'common' && isSelectedInScope(it.id, 'common');
              const q = selected[scope]?.[it.id]?.quantity || 1;
              return (
                <ItemCard key={it.id} item={it}
                  selected={sel} shadow={shadow} qty={q}
                  onToggle={() => toggleItem(it)}
                  onQty={(n: number) => setQty(it.id, n)}
                />
              );
            })
          )}
        </div>
      </main>
    </div>
  );
}

function ScopeCard({ active, onClick, emoji, title, sub, badge, price, count, color, hint }: any) {
  const colors: any = {
    amber: active ? 'border-amber-400 bg-amber-50' : 'border-gray-200 bg-white hover:border-amber-200',
    blue: active ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white hover:border-blue-200',
    pink: active ? 'border-pink-400 bg-pink-50' : 'border-gray-200 bg-white hover:border-pink-200',
    purple: active ? 'border-purple-400 bg-purple-50' : 'border-gray-200 bg-white hover:border-purple-200',
  };
  return (
    <button onClick={onClick}
      className={`w-full text-left rounded-xl border-2 p-3 transition-all ${colors[color || 'amber']}`}>
      <div className="flex items-start gap-2.5">
        <span className="text-2xl leading-none">{emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={`text-sm font-semibold ${active ? 'text-gray-900' : 'text-gray-800'}`}>{title}</span>
            {badge > 0 && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-700 text-white text-[10px] font-bold">
                {badge}
              </span>
            )}
          </div>
          <div className="text-[10.5px] text-gray-500 leading-tight mt-0.5">{sub}</div>
          {price !== undefined && (
            <div className="mt-1.5 flex items-end justify-between">
              <span className="text-[10px] text-gray-500">{count}项</span>
              <span className="text-base font-bold text-emerald-800 leading-none">¥{Number(price).toFixed(0)}</span>
            </div>
          )}
          {hint && (
            <div className="mt-1 text-[10px] text-amber-700 leading-snug">{hint}</div>
          )}
        </div>
      </div>
    </button>
  );
}

function ItemCard({ item, selected, shadow, qty, onToggle, onQty }: {
  item: CheckupItem; selected: boolean; shadow: boolean; qty: number;
  onToggle: () => void; onQty: (n: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isCombo = item.item_type === 'combo';
  return (
    <div className={`bg-white rounded-xl px-4 py-3 border transition-colors ${
      selected ? 'border-emerald-400 bg-emerald-50/30' : shadow ? 'border-amber-200 bg-amber-50/20' : 'border-gray-200'
    }`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900 leading-snug">{item.name}</span>
            <span className="text-[10px] text-gray-400 font-mono">{item.code}</span>
            {isCombo && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800">组合</span>}
          </div>
          <div className="text-[11px] text-gray-500 mt-0.5">
            {item.description || (isCombo ? '组合项目，包含多个子项' : '单项检查')}
          </div>
          <div className="mt-1.5 flex items-center gap-2 flex-wrap">
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-50 text-gray-500 border border-gray-100">{item.category}</span>
            <span className="text-[11px] text-gray-400">{item.unit}</span>
            {isCombo && (
              <button onClick={() => setExpanded(x => !x)} className="text-[11px] text-emerald-700 flex items-center gap-0.5">
                明细
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
                  className={`transition ${expanded ? 'rotate-180' : ''}`}>
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
            )}
          </div>
          {expanded && isCombo && (
            <div className="mt-2 text-[11px] text-gray-500 bg-gray-50 rounded-lg px-2.5 py-1.5 border border-gray-100">
              ⚠️ 组合项目子项由医生根据标准执行，具体包含内容以当日医院公示为准。
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <div>
            <div className="text-base font-bold text-emerald-800 text-right">¥{Number(item.default_price).toFixed(0)}</div>
            {item.insurance_price > 0 && (
              <div className="text-[10px] text-indigo-500 text-right">医保 ¥{Number(item.insurance_price).toFixed(0)}</div>
            )}
          </div>
          {selected ? (
            <div className="flex items-center gap-1 bg-white rounded-lg border border-gray-200 p-0.5">
              <button onClick={() => onQty(qty - 1)} className="w-7 h-7 rounded-md hover:bg-gray-100 text-gray-600">
                <Plus size={14} className="rotate-45" />
              </button>
              <span className="text-sm font-medium w-6 text-center">{qty}</span>
              <button onClick={() => onQty(qty + 1)} className="w-7 h-7 rounded-md hover:bg-gray-100 text-gray-600">
                <Plus size={14} />
              </button>
            </div>
          ) : shadow ? (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">公共已含</span>
          ) : null}
          <button onClick={onToggle}
            className={`h-8 w-20 rounded-lg text-xs font-semibold flex items-center justify-center transition ${
              selected ? 'bg-emerald-500 text-white shadow-sm' : 'border border-gray-300 text-gray-600 bg-white hover:bg-gray-50'
            }`}>
            {selected ? '✓ 已添加' : '添加'}
          </button>
        </div>
      </div>
    </div>
  );
}

// -------- 步骤3：定方案（价格折扣） --------
function PlanStep({ applicable, rolePlans, summaryForRole, setRolePlanField, applySameRate, recomputeRolePlansByItems }: any) {
  return (
    <div className="p-6 space-y-6">
      {/* 统一折扣快捷操作 */}
      <div className="bg-gradient-to-r from-amber-50 to-amber-100/50 rounded-xl border border-amber-200 px-5 py-3 flex items-center gap-3 flex-wrap">
        <Sparkles size={16} className="text-amber-600 shrink-0" />
        <span className="text-sm font-medium text-amber-900">一键统折扣：</span>
        <div className="flex flex-wrap gap-2">
          {[95, 90, 85, 80, 70, 100].map(r => (
            <button key={r} onClick={() => applySameRate(r)}
              className={`h-8 px-3 rounded-lg text-xs font-medium transition-colors ${
                r === 100
                  ? 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                  : 'bg-white text-amber-700 border border-amber-300 hover:bg-amber-100'
              }`}>
              {r === 100 ? '原价(100%)' : `${r}折`}
            </button>
          ))}
        </div>
        {typeof recomputeRolePlansByItems === 'function' && (
          <button onClick={recomputeRolePlansByItems}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white shadow-sm">
            <Sparkles size={12} /> 按当前项目重新生成方案
          </button>
        )}
        <span className="text-[11px] text-amber-700 ml-auto">对所有角色同时生效</span>
      </div>

      {/* 三角色价格卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {applicable.map((r: Role) => {
          const auto = summaryForRole(r);
          const p: any = rolePlans[r] || {};
          const orig = Number(p.original_total || auto.total || 0);
          const dp = Number(p.discount_price || 0);
          const rate = Number(p.discount_rate || 100);
          const saved = orig - dp;
          const driftPct = auto.total > 0 || orig > 0
            ? (orig === 0 ? 100 : ((orig - auto.total) / orig) * 100)
            : 0;
          const drift = Math.abs(driftPct) > 5;
          const color = r === 'male' ? 'blue' : r === 'female_married' ? 'pink' : 'purple';
          const headerCls: any = {
            blue: drift ? 'from-rose-500 to-rose-600' : 'from-blue-500 to-blue-600',
            pink: drift ? 'from-rose-500 to-rose-600' : 'from-pink-500 to-rose-600',
            purple: drift ? 'from-rose-500 to-rose-600' : 'from-purple-500 to-violet-600',
          };
          return (
            <div key={r} className={`bg-white rounded-2xl overflow-hidden flex flex-col border-2 transition-colors ${
              drift ? 'border-rose-300 ring-1 ring-rose-100' : 'border border-gray-200'
            }`}>
              {/* 头：角色 + 汇总 */}
              <div className={`bg-gradient-to-br ${headerCls[color]} text-white px-5 py-4`}>
                {drift && (
                  <div className="mb-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/20 text-[11px] font-semibold">
                    <AlertTriangle size={11} />
                    原价已偏离项目汇总 {driftPct > 0 ? '+' : ''}{driftPct.toFixed(1)}%
                  </div>
                )}
                <div className="flex items-center gap-2.5 mb-2">
                  <span className="text-3xl leading-none">{ROLE_EMOJI[r]}</span>
                  <div>
                    <div className="text-base font-semibold leading-tight">{ROLE_LABEL[r]}</div>
                    <div className="text-[11px] opacity-80">{ROLE_HINT[r]}</div>
                  </div>
                  <div className="ml-auto text-right">
                    <div className="text-[11px] opacity-80">共 {auto.count} 项</div>
                    <div className="text-xs opacity-90">医保合计 ¥{auto.insurance.toFixed(0)}</div>
                    {drift && (
                      <div className="text-[11px] mt-0.5 opacity-95">
                        项目合计 ¥{Number(auto.total).toFixed(0)}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-end justify-between">
                  <div>
                    <div className="text-[11px] opacity-80">原价</div>
                    <div className="text-lg font-bold line-through opacity-90">¥{orig.toFixed(2)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] opacity-90 mb-0.5">优惠价</div>
                    <div className="text-2xl font-extrabold leading-none">
                      ¥{dp.toFixed(0)}
                    </div>
                  </div>
                </div>
                {saved > 0 && (
                  <div className="mt-2 inline-flex items-center gap-1 bg-white/20 rounded-full px-2 py-0.5 text-[11px]">
                    💰 省 ¥{saved.toFixed(0)} ({(100 - rate).toFixed(1)}% off)
                  </div>
                )}
              </div>
              {/* 中：手动调整 */}
              <div className="px-5 py-4 space-y-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                    原价合计
                    {drift && <span className="text-rose-600 font-medium">⚠ 与项目汇总不一致，建议"按当前项目重新生成"</span>}
                  </label>
                  <input
                    type="number"
                    step="1"
                    value={orig || ''}
                    onChange={e => setRolePlanField(r, 'original_total', e.target.value === '' ? 0 : Number(e.target.value))}
                    className={`w-full border rounded-lg px-3 py-2 text-sm font-semibold focus:outline-none focus:border-green-500 ${
                      drift
                        ? 'bg-rose-50 border-rose-200 text-rose-700'
                        : 'bg-gray-50 border-gray-200 text-gray-700'
                    }`}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">优惠价（元）</label>
                  <input
                    type="number"
                    step="1"
                    value={dp || ''}
                    onChange={e => setRolePlanField(r, 'discount_price', e.target.value === '' ? 0 : Number(e.target.value))}
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-semibold text-emerald-800 focus:outline-none focus:border-green-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">折扣率（%)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={rate || ''}
                    onChange={e => setRolePlanField(r, 'discount_rate', e.target.value === '' ? 0 : Number(e.target.value))}
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">方案备注</label>
                  <input
                    type="text"
                    value={p.remark || ''}
                    onChange={e => setRolePlanField(r, 'remark', e.target.value)}
                    placeholder="例如：618限时优惠 / 开业首月活动价"
                    maxLength={50}
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500"
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
