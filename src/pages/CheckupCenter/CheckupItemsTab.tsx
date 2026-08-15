import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Save, Search, AlertTriangle, FileSpreadsheet, ChevronDown, ChevronUp } from 'lucide-react';
import { bookingApi, type CheckupItemRow } from '@/lib/api';
import { CATEGORIES } from './api';
import { useToast } from '@/components/Toast';
import { useAuthStore } from '@/store/authStore';

const inputCls =
  'w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-green-500 transition-colors';
const btnGhost =
  'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 transition-colors';
const btnGold =
  'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-green-500 hover:bg-green-600 text-white font-medium transition-colors disabled:opacity-50';

function Upd({ value, onChange, type = 'text', step, placeholder, warn }:
  { value: any; onChange: (v: any) => void; type?: string; step?: string; placeholder?: string; warn?: boolean }) {
  return (
    <input
      type={type}
      step={step}
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => onChange(type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
      className={`${inputCls} text-xs !py-1 !px-2 ${warn ? '!border-amber-400 !bg-amber-50 focus:!border-amber-500' : ''}`}
    />
  );
}

function Checkbox({ value, onChange }: { value: any; onChange: (v: number) => void }) {
  return (
    <input
      type="checkbox"
      checked={Number(value) === 1}
      onChange={(e) => onChange(e.target.checked ? 1 : 0)}
      className="accent-green-500 w-4 h-4"
    />
  );
}

function RowBtn({ children, onClick, cls }: { children: React.ReactNode; onClick?: () => void; cls?: string }) {
  return (
    <button onClick={onClick} className={`text-xs px-2 py-1 rounded border transition-colors ${cls || btnGhost}`}>
      {children}
    </button>
  );
}

function generateCode(existing: { code?: string }[]): string {
  let maxNum = 0;
  existing.forEach(r => {
    const m = (r.code || '').match(/^CI(\d+)$/);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  });
  return `CI${String(maxNum + 1).padStart(3, '0')}`;
}

const DEFAULT_CATEGORY = CATEGORIES[0]; // '体格检查'

const DEFAULT_CHECKUP: Partial<CheckupItemRow> = {
  code: '', name: '', item_type: 'item', category: DEFAULT_CATEGORY,
  description: '', default_price: 0, insurance_price: 0, unit: '次',
  status: 1, sort_order: 100, sub_item_ids: [],
};

export default function CheckupItemsTab() {
  const toast = useToast();
  const isAdmin = useAuthStore(s => s.isAdmin());
  const [rows, setRows] = useState<CheckupItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<{ mode: 'create' | 'update'; data: any } | null>(null);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState<string>('全部');
  const [toolOpen, setToolOpen] = useState(false);
  const [pdfText, setPdfText] = useState('');
  // A2: 手动绑定覆盖：key = pdfName（normalize后），value = db id(string)；用户在下拉框选择后持久化到 state
  const [manualBindMap, setManualBindMap] = useState<Record<string, string>>({});
  // A4: 选中的diff行 key（用行index+name组合）
  const [selectedDiffKeys, setSelectedDiffKeys] = useState<Set<string>>(new Set());
  // A5: 批量同步中进度
  const [syncProgress, setSyncProgress] = useState<{ done: number; total: number; curr: string | null } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await bookingApi.listCheckupItems();
      setRows(data);
    } catch (e: any) {
      toast.error(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const bumpEditing = () => {
    setEditing(prev => prev ? { ...prev } : null);
  };

  const setField = (k: string, v: any) => {
    if (editing) {
      editing.data[k] = v;
      bumpEditing();
    }
  };

  function checkCodeUnique(code: string, excludeId?: string | number): boolean {
    if (!code) return true;
    return !rows.some(r => r.code === code && String(r.id) !== String(excludeId));
  }

  const handleSave = async (d: any) => {
    const data = d as Partial<CheckupItemRow>;
    if (data.code && !checkCodeUnique(data.code, data.id)) {
      toast.error(`编码「${data.code}」已存在，请使用其他编码`);
      return;
    }
    if (!data.name || !String(data.name).trim()) {
      toast.error('项目名称不能为空');
      return;
    }
    if (data.default_price === undefined || data.default_price === null || isNaN(Number(data.default_price))) {
      toast.error('请填写默认定价');
      return;
    }
    const defaultPrice = Number(data.default_price) || 0;
    const insurancePrice = Number(data.insurance_price) || 0;
    if (defaultPrice > 0 && insurancePrice === 0) {
      // 允许继续，但加提醒
      const ok = window.confirm('当前默认定价 > 0，但医保价格为 0。可能是数据漏录，建议补录。是否仍继续保存？');
      if (!ok) return;
    }
    if (insurancePrice > defaultPrice) {
      toast.error(`医保价格(¥${insurancePrice})不能高于默认定价(¥${defaultPrice})`);
      return;
    }
    setSaving(true);
    try {
      if (editing?.mode === 'update' && data.id) {
        await bookingApi.updateCheckupItem(data.id!, data);
      } else {
        await bookingApi.createCheckupItem(data);
      }
      toast.success('保存成功');
      setEditing(null);
      await load();
    } catch (e: any) {
      toast.error('保存失败：' + (e.message || ''));
    } finally {
      setSaving(false);
    }
  };

  const handleDel = async (r: CheckupItemRow) => {
    if (!window.confirm(`确定禁用体检项目「${r.name}」吗？`)) return;
    try {
      await bookingApi.deleteCheckupItem(r.id);
      toast.success('已禁用');
      await load();
    } catch (e: any) {
      toast.error('禁用失败：' + (e.message || ''));
    }
  };

  // 分类：7 大类 + 数据库里存在的扩展分类（但不在7大类里的那些做分组折叠，避免污染默认 Tab）
  const allCategories = useMemo(() => {
    const set = new Set<string>([...CATEGORIES]);
    const extensions: string[] = [];
    rows.forEach(r => {
      if (r.category && !set.has(r.category)) {
        set.add(r.category);
        extensions.push(r.category);
      }
    });
    return { core: [...CATEGORIES], extensions };
  }, [rows]);

  const categoryTabs = ['全部', ...allCategories.core];

  // 过滤
  const filteredRows = rows.filter(r => {
    const kw = search.trim();
    if (kw && !`${r.name}${r.code}`.toLowerCase().includes(kw.toLowerCase())) return false;
    if (catFilter !== '全部' && r.category !== catFilter) return false;
    return true;
  });

  // 组合项目统计（基于当前筛选结果 P1 修复）
  const comboCount = filteredRows.filter(r => r.item_type === 'combo').length;
  const enabledCount = filteredRows.filter(r => r.status === 1).length;

  const isCreating = editing?.mode === 'create';
  const isEditingThis = (r: CheckupItemRow) => editing?.mode === 'update' && editing.data.id === r.id;
  const availableSubItems = rows.filter(r => r.item_type !== 'combo' && r.status === 1);
  const currentEditingId = editing?.data?.id;

  const toggleSubItem = (subId: string) => {
    if (!editing) return;
    const current = editing.data.sub_item_ids || [];
    if (current.includes(subId)) {
      setField('sub_item_ids', current.filter((id: string) => id !== subId));
    } else {
      setField('sub_item_ids', [...current, subId]);
    }
  };

  function renderSubItemPicker() {
    if (!editing) return null;
    const isCombo = editing.data.item_type === 'combo';
    if (!isCombo) return null;
    const selected = editing.data.sub_item_ids || [];
    return (
      <div className="px-3 py-2 bg-amber-50/60 border-t border-amber-100">
        <div className="text-[11px] text-gray-500 mb-1.5">子项目（勾选包含的普通项目）</div>
        <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
          {availableSubItems.filter(r => r.id !== currentEditingId).map(r => {
            const checked = selected.includes(r.id);
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => toggleSubItem(r.id)}
                disabled={!isAdmin}
                className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${
                  checked
                    ? 'bg-cyan-500 text-white border-cyan-500'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-cyan-300 disabled:opacity-60'
                }`}
              >
                {r.name} ¥{Number(r.default_price || 0)}
              </button>
            );
          })}
          {availableSubItems.length === 0 && (
            <span className="text-[11px] text-gray-400">暂无可选的普通项目</span>
          )}
        </div>
      </div>
    );
  }

  function typeLabel(r: CheckupItemRow) {
    if (r.item_type === 'combo') {
      return <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded ml-1">组合</span>;
    }
    return null;
  }

  // P5 价格对拍（A1 + A2 manualBindMap 叠加：若 manualBindMap 设置了则改写 diff 匹配结果）
  const compare = useMemo<PriceCompareResult & {
    diffsWithManual: (DiffRow & { diffKey: string })[];
  }>(() => {
    const base = priceCompare(rows, pdfText) as PriceCompareResult;
    const idMap = new Map<string, CheckupItemRow>();
    rows.forEach(r => { if (r.id) idMap.set(r.id, r); });
    // 每个 diff 叠加 manualBindMap
    const diffsWithManual: (DiffRow & { diffKey: string })[] = base.diffs.map((d, idx) => {
      const key = normalize(d.name);
      const bindId = manualBindMap[key];
      if (!bindId) return { ...d, diffKey: `${idx}:${key}` };
      const bound = idMap.get(bindId);
      if (!bound) return { ...d, diffKey: `${idx}:${key}` };
      // 手动绑定命中：覆盖 dbId/dbName/dbCode/dbPrice/dbInsured，重新计算 reason
      const dbPrice = Math.round((Number(bound.default_price) || 0) * 100) / 100;
      const dbInsured = Math.round((Number(bound.insurance_price) || 0) * 100) / 100;
      const priceDiff = Math.abs(dbPrice - (d.pdfPrice || 0));
      const insuredDiff = d.pdfInsured !== null ? Math.abs(dbInsured - d.pdfInsured) : 0;
      let reason: DiffRow['reason'] = '其他';
      if (priceDiff >= 0.001 && d.pdfInsured !== null && insuredDiff >= 0.001) reason = '定价差+医保';
      else if (priceDiff >= 0.001) reason = '定价差';
      else if (d.pdfInsured !== null && insuredDiff >= 0.001) reason = '医保价差';
      // 手动绑定的同步也加入 hitDbIds，用于反向未匹配统计
      if (bound.id) base.hitDbIds.add(bound.id);
      return {
        ...d,
        dbId: bound.id ?? null, dbName: bound.name, dbCode: bound.code,
        dbPrice, dbInsured, reason,
        matchKind: 'manual' as const, matchScore: 100,
        diffKey: `${idx}:${key}`,
      };
    });
    return { ...base, diffsWithManual };
  }, [rows, pdfText, manualBindMap]);

  // A4 同步执行：把选中的 diffs（带 manualBindMap）回写到 DB
  const applySelected = async (scope: 'price' | 'insured' | 'both') => {
    if (!isAdmin) { toast.error('仅管理员可同步'); return; }
    const picks = compare.diffsWithManual.filter(d => selectedDiffKeys.has(d.diffKey) && d.dbId != null);
    if (picks.length === 0) { toast.error('请先勾选需要同步的行（且该行已绑定到数据库项目）'); return; }
    const fuzzyCount = picks.filter(p => p.matchKind === 'fuzzy' && (p.matchScore || 0) < 85).length;
    const scopeName = scope === 'price' ? '定价' : scope === 'insured' ? '医保价' : '定价+医保价';
    const message = `确认将修改 ${picks.length} 条项目的${scopeName}？${fuzzyCount > 0 ? `其中 ${fuzzyCount} 条为模糊匹配（<85%），建议人工核对。` : ''}此操作会写入数据库，不可撤销。`;
    if (!confirm(message)) return;
    setSyncProgress({ done: 0, total: picks.length, curr: null });
    let failed = 0;
    for (let i = 0; i < picks.length; i++) {
      const d = picks[i];
      setSyncProgress(s => s ? { ...s, done: i, curr: d.dbName || d.name } : s);
      try {
        const body: any = {};
        if (scope === 'price' || scope === 'both') body.default_price = d.pdfPrice;
        if (scope === 'insured' || scope === 'both') body.insurance_price = d.pdfInsured;
        await bookingApi.updateCheckupItem(d.dbId!, body);
      } catch (e: any) {
        failed++;
        toast.error(`${d.dbName || d.name} 同步失败：${e.message || String(e)}`);
      }
    }
    setSyncProgress({ done: picks.length, total: picks.length, curr: null });
    toast.success(`同步完成：${picks.length - failed} 条成功${failed ? `，${failed} 条失败` : ''}`);
    setSelectedDiffKeys(new Set());
    setTimeout(() => setSyncProgress(null), 1200);
    await load();
  };

  return (
    <div className="space-y-4">
      {/* 顶部操作栏：搜索 + 新增 + 价格对拍 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索项目名或编码..."
            className={`${inputCls} !pl-8 !py-2`}
          />
        </div>
        {isAdmin && !editing && (
          <button onClick={() => setEditing({ mode: 'create', data: { ...DEFAULT_CHECKUP, code: generateCode(rows) } })} className={btnGold}>
            <Plus size={12} /> 新增体检项目
          </button>
        )}
        <button onClick={() => setToolOpen(o => !o)} className={btnGhost}>
          <FileSpreadsheet size={12} />
          PDF 价格对拍 {toolOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      </div>

      {/* 分类 Tabs */}
      <div className="flex flex-wrap gap-1.5">
        {categoryTabs.map(c => (
          <button
            key={c}
            onClick={() => setCatFilter(c)}
            className={`px-3 py-1.5 rounded-full text-xs transition-colors ${
              catFilter === c
                ? 'bg-cyan-500 text-white font-medium'
                : 'bg-white text-gray-600 border border-gray-200 hover:border-cyan-200'
            }`}
          >
            {c}
          </button>
        ))}
        {allCategories.extensions.length > 0 && (
          <div className="flex items-center gap-1 text-[11px] text-amber-600 ml-auto px-2 py-0.5 rounded bg-amber-50 border border-amber-200">
            <AlertTriangle size={11} />
            另有 {allCategories.extensions.length} 个扩展分类（{allCategories.extensions.join('、')}），建议并入 7 大类
          </div>
        )}
      </div>

      {/* 统计栏 */}
      <div className="text-sm text-gray-600">
        共 <span className="font-medium text-gray-900">{filteredRows.length}</span> 条
        {comboCount > 0 && (
          <span className="ml-2 text-amber-600">（含 {comboCount} 个组合项目）</span>
        )}
        ，启用 <span className="text-cyan-600 font-medium">{enabledCount}</span> 条
      </div>

      {/* P5: 价格对拍工具面板 */}
      {toolOpen && (
        <div className="bg-gradient-to-br from-sky-50 to-white border border-sky-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-sky-900 flex items-center gap-2">
              <FileSpreadsheet size={15} />
              PDF 价格对拍工具
            </div>
            <span className="text-[11px] text-sky-600">粘贴 PDF 价目表 → 自动对拍 → 一键同步到数据库</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-sky-800 mb-1">
                粘贴 PDF 文本（每行格式：项目名 /t 医保价 /t 2023最新定价，允许列分隔符为制表符/逗号/中文空格）
              </label>
              <textarea
                value={pdfText}
                onChange={e => setPdfText(e.target.value)}
                rows={10}
                placeholder={'示例：\n血常规\t20\t35\n人体成分分析\t50\t120\n彩超-腹部\t100\t170'}
                className="w-full text-xs font-mono bg-white border border-sky-300 rounded-lg p-2 focus:outline-none focus:border-sky-500"
              />
            </div>
            <div className="space-y-2">
              <div className="text-[11px] text-sky-800 flex items-center justify-between flex-wrap gap-2">
                <span>对拍结果（{compare.parsedCount} 条 PDF / {compare.dbNameMap.size} 条数据库）</span>
                <span className="text-sky-700 font-semibold">差异 {compare.diffsWithManual.length}</span>
              </div>

              {/* A4: 批量同步工具栏 */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap text-[11px]">
                  <label className="inline-flex items-center gap-1 px-2 py-1 rounded bg-sky-100/60 text-sky-800">
                    <input
                      type="checkbox"
                      className="accent-sky-600"
                      checked={
                        compare.diffsWithManual.length > 0 &&
                        compare.diffsWithManual
                          .filter(d => d.dbId != null)
                          .every(d => selectedDiffKeys.has(d.diffKey))
                      }
                      onChange={e => {
                        const targets = compare.diffsWithManual.filter(d => d.dbId != null);
                        setSelectedDiffKeys(new Set(e.target.checked ? targets.map(d => d.diffKey) : []));
                      }}
                    />
                    全选（已绑定）
                  </label>
                  <span className="text-gray-500">
                    已选 {compare.diffsWithManual.filter(d => selectedDiffKeys.has(d.diffKey)).length} 条
                  </span>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    onClick={() => applySelected('price')}
                    disabled={!isAdmin || syncProgress !== null}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-semibold shadow-sm"
                  >
                    <Save size={11} /> 应用PDF定价
                  </button>
                  <button
                    onClick={() => applySelected('insured')}
                    disabled={!isAdmin || syncProgress !== null}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded bg-violet-500 hover:bg-violet-600 disabled:opacity-50 text-white font-semibold shadow-sm"
                  >
                    <Save size={11} /> 应用PDF医保价
                  </button>
                  <button
                    onClick={() => applySelected('both')}
                    disabled={!isAdmin || syncProgress !== null}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold shadow-sm"
                  >
                    <Save size={11} /> 全部同步
                  </button>
                </div>
              </div>
              {/* A5 进度条 */}
              {syncProgress && (
                <div className="text-[11px] space-y-1">
                  <div className="flex items-center justify-between text-gray-600">
                    <span>同步进度 {syncProgress.done}/{syncProgress.total}</span>
                    <span className="text-gray-500 truncate max-w-[60%]">{syncProgress.curr}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-sky-100 overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all duration-200"
                      style={{ width: `${syncProgress.total ? (syncProgress.done / syncProgress.total) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              )}

              {compare.diffsWithManual.length === 0 && pdfText ? (
                <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-4 text-center">
                  ✅ 所有已解析的 PDF 项目与数据库定价完全一致
                </div>
              ) : (
                <div className="max-h-64 overflow-auto border border-sky-200 rounded-lg bg-white">
                  <table className="w-full text-[11px]">
                    <thead className="bg-sky-50 text-sky-900 sticky top-0">
                      <tr>
                        <th className="px-1.5 py-1.5 w-7 text-center">选</th>
                        <th className="text-left px-2 py-1.5">项目 (PDF 名 / 绑定DB名)</th>
                        <th className="text-center px-2 py-1.5 w-20">匹配</th>
                        <th className="text-right px-2 py-1.5">PDF定价</th>
                        <th className="text-right px-2 py-1.5">数据库</th>
                        <th className="text-right px-2 py-1.5">PDF医保</th>
                        <th className="text-right px-2 py-1.5">数据库医保</th>
                        <th className="text-center px-2 py-1.5">状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compare.diffsWithManual.slice(0, 80).map((d) => {
                        const matchBadge = (() => {
                          if (d.matchKind === 'exact') return <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-emerald-100 text-emerald-700">精确</span>;
                          if (d.matchKind === 'short') return <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-sky-100 text-sky-700">短名{d.matchScore ?? 0}%</span>;
                          if (d.matchKind === 'fuzzy') return <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-amber-100 text-amber-800">模糊{(d.matchScore ?? 0)}%</span>;
                          if (d.matchKind === 'manual') return <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-indigo-100 text-indigo-700">手绑</span>;
                          return <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-gray-100 text-gray-500">未匹配</span>;
                        })();
                        const key = normalize(d.name);
                        const isFuzzyLow = d.matchKind === 'fuzzy' && (d.matchScore || 0) < 85;
                        return (
                          <tr key={d.diffKey} className={`border-t border-gray-100 ${
                            d.reason === '缺' ? 'bg-rose-50'
                              : d.reason === '定价差' ? 'bg-amber-50'
                              : d.reason === '医保价差' ? 'bg-violet-50'
                              : isFuzzyLow ? 'bg-gray-50/80'
                              : ''
                          }`}>
                            <td className="text-center px-1.5 py-1.5 align-middle">
                              <input
                                type="checkbox"
                                disabled={d.dbId == null}
                                checked={selectedDiffKeys.has(d.diffKey)}
                                onChange={e => {
                                  const next = new Set(selectedDiffKeys);
                                  if (e.target.checked) next.add(d.diffKey);
                                  else next.delete(d.diffKey);
                                  setSelectedDiffKeys(next);
                                }}
                                className="accent-sky-600 disabled:opacity-30"
                              />
                            </td>
                            <td className="px-2 py-1.5 align-middle">
                              <div className="text-gray-800 font-medium">{d.name}</div>
                              {d.dbName && d.dbName !== d.name && (
                                <div className="text-[10px] text-gray-500 flex items-center gap-1 mt-0.5">
                                  ↳ {d.dbCode && <span className="text-slate-400">{d.dbCode}</span>}
                                  {d.dbName}
                                </div>
                              )}
                              {/* A2 手动绑定下拉：始终显示，"缺"和"模糊/短名"都能改绑 */}
                              <div className="mt-1">
                                <select
                                  className="w-full text-[10.5px] bg-sky-50/60 border border-sky-200 rounded px-1.5 py-0.5 focus:outline-none focus:border-sky-500 text-gray-700"
                                  value={manualBindMap[key] ?? d.dbId ?? ''}
                                  onChange={e => {
                                    const val = e.target.value || null;
                                    setManualBindMap(prev => {
                                      const next = { ...prev };
                                      if (val === null) delete next[key];
                                      else next[key] = val;
                                      return next;
                                    });
                                  }}
                                >
                                  <option value="">-- 未绑定 / 自动匹配 --</option>
                                  <optgroup label="所有数据库项目（按分类）">
                                    {(() => {
                                      const grouped = new Map<string, CheckupItemRow[]>();
                                      compare.dbRows.forEach(r => {
                                        const cat = r.category || '未分类';
                                        if (!grouped.has(cat)) grouped.set(cat, []);
                                        grouped.get(cat)!.push(r);
                                      });
                                      return Array.from(grouped.entries()).flatMap(([cat, list]) =>
                                        list.map(r => (
                                          <option key={r.id} value={r.id}>
                                            [{cat}] {r.code} {r.name} {Number(r.default_price) > 0 ? `¥${r.default_price}` : ''}
                                          </option>
                                        ))
                                      );
                                    })()}
                                  </optgroup>
                                </select>
                              </div>
                            </td>
                            <td className="text-center px-2 py-1.5 align-middle">{matchBadge}</td>
                            <td className="px-2 py-1.5 text-right align-middle font-mono">{d.pdfPrice !== null ? '¥' + d.pdfPrice : '-'}</td>
                            <td className="px-2 py-1.5 text-right align-middle font-mono">{d.dbPrice !== null ? '¥' + d.dbPrice : '-'}</td>
                            <td className="px-2 py-1.5 text-right align-middle font-mono">{d.pdfInsured !== null ? '¥' + d.pdfInsured : '-'}</td>
                            <td className="px-2 py-1.5 text-right align-middle font-mono">{d.dbInsured !== null ? '¥' + d.dbInsured : '-'}</td>
                            <td className="px-2 py-1.5 text-center align-middle">
                              <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                                d.reason === '缺' ? 'bg-rose-100 text-rose-700'
                                  : d.reason === '定价差' ? 'bg-amber-100 text-amber-800'
                                  : d.reason === '医保价差' ? 'bg-violet-100 text-violet-800'
                                  : d.reason === '定价差+医保' ? 'bg-orange-100 text-orange-800'
                                  : 'bg-gray-100 text-gray-600'
                              }`}>{d.reason}</span>
                            </td>
                          </tr>
                        );
                      })}
                      {compare.diffsWithManual.length > 80 && (
                        <tr>
                          <td colSpan={8} className="text-center text-[11px] text-gray-400 py-1.5">
                            还有 {compare.diffsWithManual.length - 80} 条，请缩小粘贴范围或直接在数据库查看
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
              {compare.matchedCount > 0 && (
                <div className="text-[10.5px] text-emerald-700">
                  ✔ 对拍一致 {compare.matchedCount} 条（定价 + 医保价都相等）
                </div>
              )}
              {compare.unknownNames.length > 0 && (
                <div className="text-[10.5px] text-sky-700">
                  🟡 PDF 里有 {compare.unknownNames.length} 条未在数据库找到：{compare.unknownNames.slice(0, 5).join('、')}{compare.unknownNames.length > 5 ? '...' : ''}
                  （可点该行"未绑定"下拉手动绑定到 DB 中最相似的项目）
                </div>
              )}
              <div className="text-[10.5px] text-slate-500 mt-2 leading-relaxed">
                ⚠️ 说明：由于 PDF 表格的 OCR 或人工导出格式可能有误差，建议配合"匹配"列确认：
                <span className="mx-1 px-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">精确</span>
                <span className="mx-1 px-1 rounded bg-sky-50 text-sky-700 border border-sky-200">短名70%~100%</span>
                <span className="mx-1 px-1 rounded bg-amber-50 text-amber-800 border border-amber-200">模糊75%~85%</span>
                <span className="mx-1 px-1 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">手绑</span>
                。<span className="text-rose-600">模糊 &lt;85% 的行默认不勾选</span>，请人工核对后再勾选同步。
              </div>

              {/* A3 反向未匹配表：DB有但PDF未提及 */}
              {pdfText && compare.dbUnmatched.length > 0 && (
                <details className="mt-2 border border-sky-200 rounded-lg overflow-hidden">
                  <summary className="px-3 py-1.5 bg-sky-50 text-[11px] text-sky-800 cursor-pointer font-medium">
                    ℹ️ DB中有但PDF未提及的项目：{compare.dbUnmatched.length} 条
                    （其中 <span className="text-amber-700">{compare.dbUnmatched.filter(r => Number(r.insurance_price) || 0 === 0).length}</span> 条无医保价，
                    <span className="text-gray-700">{compare.dbUnmatched.filter(r => Number(r.status) === 1).length}</span> 条已启用）
                  </summary>
                  <div className="max-h-40 overflow-auto bg-white">
                    <table className="w-full text-[10.5px]">
                      <thead className="bg-gray-50 text-gray-600 sticky top-0">
                        <tr>
                          <th className="px-2 py-1 text-left">编码</th>
                          <th className="px-2 py-1 text-left">名称</th>
                          <th className="px-2 py-1 text-left">分类</th>
                          <th className="px-2 py-1 text-right">定价</th>
                          <th className="px-2 py-1 text-right">医保价</th>
                          <th className="px-2 py-1 text-center">状态</th>
                        </tr>
                      </thead>
                      <tbody>
                        {compare.dbUnmatched.slice(0, 50).map(r => {
                          const missIns = (Number(r.insurance_price) || 0) === 0;
                          return (
                            <tr key={r.id} className={`border-t border-gray-100 ${missIns ? 'bg-amber-50/60' : ''}`}>
                              <td className="px-2 py-1 text-gray-600">{r.code}</td>
                              <td className="px-2 py-1 text-gray-800">{r.name}</td>
                              <td className="px-2 py-1 text-gray-600">{r.category || '-'}</td>
                              <td className="px-2 py-1 text-right font-mono">¥{Number(r.default_price) || 0}</td>
                              <td className="px-2 py-1 text-right font-mono">
                                {missIns ? <span className="text-amber-700">⚠未录入</span> : `¥${Number(r.insurance_price) || 0}`}
                              </td>
                              <td className="px-2 py-1 text-center">
                                {Number(r.status) === 1
                                  ? <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[10px]">启用</span>
                                  : <span className="px-1.5 py-0.5 rounded bg-gray-50 text-gray-500 text-[10px]">停用</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-10 text-gray-500 text-sm bg-white rounded-lg border border-dashed border-gray-200">
          <span className="inline-block w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin mr-2 align-middle" />
          加载中...
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-500 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left font-medium w-20">编码</th>
                <th className="px-3 py-2 text-left font-medium">名称</th>
                <th className="px-3 py-2 text-left font-medium w-20">类型</th>
                <th className="px-3 py-2 text-left font-medium w-24">分类</th>
                <th className="px-3 py-2 text-right font-medium w-28">默认定价(¥)</th>
                <th className="px-3 py-2 text-right font-medium w-28">医保价格(¥)</th>
                <th className="px-3 py-2 text-center font-medium w-16">单位</th>
                <th className="px-3 py-2 text-center font-medium w-16">排序</th>
                <th className="px-3 py-2 text-center font-medium w-16">状态</th>
                <th className="px-3 py-2 text-center font-medium w-40">操作</th>
              </tr>
            </thead>
            <tbody>
              {isCreating && (
                <>
                  <tr className="bg-cyan-50/50 border-b border-gray-100">
                    <td className="px-2 py-1.5"><Upd value={editing!.data.code} onChange={(v) => setField('code', v)} /></td>
                    <td className="px-2 py-1.5"><Upd value={editing!.data.name} onChange={(v) => setField('name', v)} /></td>
                    <td className="px-2 py-1.5">
                      <select
                        value={editing!.data.item_type || 'item'}
                        onChange={(e) => setField('item_type', e.target.value)}
                        className={inputCls + ' text-xs !py-1'}
                      >
                        <option value="item">普通项目</option>
                        <option value="combo">组合项目</option>
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <select
                        value={editing!.data.category || DEFAULT_CATEGORY}
                        onChange={(e) => setField('category', e.target.value)}
                        className={inputCls + ' text-xs !py-1'}
                      >
                        {categoryTabs.filter(c => c !== '全部').concat(allCategories.extensions).map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1.5"><Upd type="number" step="0.01" value={editing!.data.default_price} onChange={(v) => setField('default_price', v)} /></td>
                    <td className="px-2 py-1.5">
                      <Upd type="number" step="0.01" value={editing!.data.insurance_price ?? 0}
                        onChange={(v) => setField('insurance_price', v)}
                        warn={Number(editing?.data.default_price) > 0 && (Number(editing?.data.insurance_price) || 0) === 0}
                        placeholder={Number(editing?.data.default_price) > 0 ? '⚠ 建议补录医保价' : ''}
                      />
                    </td>
                    <td className="px-2 py-1.5"><Upd value={editing!.data.unit} onChange={(v) => setField('unit', v)} /></td>
                    <td className="px-2 py-1.5"><Upd type="number" value={editing!.data.sort_order} onChange={(v) => setField('sort_order', v)} /></td>
                    <td className="px-2 py-1.5 text-center"><Checkbox value={editing!.data.status} onChange={(v) => setField('status', v)} /></td>
                    <td className="px-2 py-1.5 text-center space-x-1">
                      <RowBtn cls="!bg-green-500 !text-white !border-green-500 hover:!bg-green-600" onClick={() => handleSave(editing!.data)}>
                        {saving ? '保存中' : <><Save size={10} /> 保存</>}
                      </RowBtn>
                      <RowBtn onClick={() => setEditing(null)}>取消</RowBtn>
                    </td>
                  </tr>
                  {renderSubItemPicker()}
                </>
              )}
              {filteredRows.length === 0 && !isCreating && (
                <tr>
                  <td colSpan={10} className="px-3 py-10 text-center text-gray-400 text-sm">暂无匹配的体检项目</td>
                </tr>
              )}
              {filteredRows.map(r => {
                const editRow = isEditingThis(r);
                const defaultPrice = Number(r.default_price || 0);
                const insurancePrice = Number(r.insurance_price || 0);
                const insuranceMissing = defaultPrice > 0 && insurancePrice === 0;
                return (
                  <React.Fragment key={r.id}>
                    <tr className={`border-t border-gray-100 hover:bg-gray-50/50 ${insuranceMissing ? 'bg-amber-50/30' : ''}`}>
                      <td className="px-3 py-2 font-mono">
                        {editRow ? <Upd value={editing!.data.code} onChange={(v) => setField('code', v)} /> : <span className="font-semibold">{r.code}</span>}
                      </td>
                      <td className="px-3 py-2">
                        {editRow ? <Upd value={editing!.data.name} onChange={(v) => setField('name', v)} /> : (
                          <span className="inline-flex items-center">
                            {insuranceMissing && <AlertTriangle size={12} className="text-amber-500 mr-1" aria-label="医保价未录入" />}
                            <span>{r.name}</span>
                            {typeLabel(r)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {editRow ? (
                          <select value={editing!.data.item_type || 'item'} onChange={(e) => setField('item_type', e.target.value)}
                            className={inputCls + ' text-xs !py-1'}>
                            <option value="item">普通项目</option>
                            <option value="combo">组合项目</option>
                          </select>
                        ) : r.item_type === 'combo' ? (
                          <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">组合</span>
                        ) : (
                          <span className="text-[10px] text-gray-400">普通</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {editRow ? (
                          <select value={editing!.data.category || r.category} onChange={(e) => setField('category', e.target.value)}
                            className={inputCls + ' text-xs !py-1'}>
                            {categoryTabs.filter(c => c !== '全部').concat(allCategories.extensions).map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        ) : r.category}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {editRow ? <Upd type="number" step="0.01" value={editing!.data.default_price} onChange={(v) => setField('default_price', v)} />
                          : `¥${defaultPrice.toLocaleString()}`}
                      </td>
                      <td className={`px-3 py-2 text-right font-mono ${insuranceMissing ? 'text-amber-600 font-semibold' : 'text-indigo-600'}`}>
                        {editRow ? (
                          <Upd type="number" step="0.01" value={editing!.data.insurance_price ?? 0}
                            onChange={(v) => setField('insurance_price', v)}
                            warn={Number(editing?.data.default_price) > 0 && (Number(editing?.data.insurance_price) || 0) === 0}
                          />
                        ) : insuranceMissing
                          ? <span className="inline-flex items-center gap-1" title="医保价未录入，请补录"><AlertTriangle size={11} /> 未录入</span>
                          : `¥${insurancePrice.toLocaleString()}`
                        }
                      </td>
                      <td className="px-3 py-2 text-center">
                        {editRow ? <Upd value={editing!.data.unit} onChange={(v) => setField('unit', v)} /> : r.unit}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {editRow ? <Upd type="number" value={editing!.data.sort_order} onChange={(v) => setField('sort_order', v)} /> : r.sort_order}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {editRow ? <Checkbox value={editing!.data.status} onChange={(v) => setField('status', v)} />
                          : r.status === 1 ? <span className="text-green-600">● 启用</span> : <span className="text-gray-400">● 禁用</span>}
                      </td>
                      <td className="px-3 py-2 text-center space-x-1">
                        {editRow ? (
                          <>
                            <RowBtn cls="!bg-green-500 !text-white !border-green-500 hover:!bg-green-600" onClick={() => handleSave(editing!.data)}>
                              {saving ? '保存中' : <><Save size={10} /> 保存</>}
                            </RowBtn>
                            <RowBtn onClick={() => setEditing(null)}>取消</RowBtn>
                          </>
                        ) : (
                          <>
                            {isAdmin && (
                              <>
                                <RowBtn onClick={() => setEditing({ mode: 'update', data: { ...r, sub_item_ids: (r.sub_items || []).map((si: any) => si.sub_item_id ?? si.id) } })}>
                                  {insuranceMissing ? '补录' : '编辑'}
                                </RowBtn>
                                <RowBtn cls="!text-red-500 hover:!bg-red-50 !border-red-200" onClick={() => handleDel(r)}>
                                  <Trash2 size={10} /> 禁用
                                </RowBtn>
                              </>
                            )}
                            {!isAdmin && <span className="text-[10px] text-gray-400">仅管理员</span>}
                          </>
                        )}
                      </td>
                    </tr>
                    {editRow && renderSubItemPicker()}
                    {!editRow && r.item_type === 'combo' && r.sub_items && r.sub_items.length > 0 && (
                      <tr className="bg-amber-50/30 border-t-0">
                        <td colSpan={10} className="px-3 py-1.5">
                          <div className="flex flex-wrap gap-1">
                            <span className="text-[10px] text-gray-400">包含：</span>
                            {r.sub_items.map((si: any, i: number) => (
                              <span key={i} className="text-[10px] bg-white border border-gray-200 rounded px-1.5 py-0.5 text-gray-600">
                                {si.name} ¥{Number(si.default_price || 0)}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --------- P5: 价格对拍解析（升级版：A1 3层匹配 + 括号内token排序 + 别名表）---------
interface DiffRow {
  name: string;
  pdfPrice: number | null;
  dbPrice: number | null;
  pdfInsured: number | null;
  dbInsured: number | null;
  reason: '缺' | '定价差' | '医保价差' | '定价差+医保' | '其他';
  // A1 匹配增强字段
  dbId?: string | null;
  dbName?: string | null;
  dbCode?: string | null;
  matchKind?: 'exact' | 'short' | 'fuzzy' | 'manual' | null;
  matchScore?: number; // 0~100
}
interface PriceCompareResult {
  parsedCount: number;
  diffs: DiffRow[];
  matchedCount: number;
  unknownNames: string[];
  dbNameMap: Map<string, CheckupItemRow>;
  dbRows: CheckupItemRow[];
  // A3: DB侧未被PDF引用的项目
  dbUnmatched: CheckupItemRow[];
  // A1 已被 PDF 命中过的 db id 集合，用于计算 dbUnmatched
  hitDbIds: Set<string>;
}

// 常见别名（等价词）：PDF里的写法 ↔ DB里的写法。命中任意一个别名即视为相同主体
const ALIASES: [string, string[]][] = [
  ['免疫三项', ['igaiggigm三项', '免疫三项igaiggigm', '免疫3项', 'iga、igm、igg三项']],
  ['三系统', ['三对', '乙肝三系统', '乙肝三对']],
  ['乙肝两对半', ['乙型肝炎病毒5项', '乙肝5项', '乙型肝炎五项', 'hbv-m']],
  ['肝功能', ['肝功']],
  ['肾功能', ['肾功']],
  ['甲状腺功能', ['甲功', '甲功五项', '甲功5项']],
  ['肿瘤标志物', ['肿瘤标记物', '肿瘤筛查标志物', '肿标']],
  ['微量元素', ['微量元']],
  ['微量元素检测5项', ['微量元素5项', '微量元素检测五项']],
  ['微量元素检测6项', ['微量元素6项', '微量元素检测六项']],
  ['微量元素检测7项', ['微量元素7项', '微量元素检测七项']],
  ['人乳头瘤病毒', ['hpv', '人乳头状瘤病毒']],
  ['eb病毒壳抗原iga抗体', ['eb病毒壳抗原iga', ['eb病毒vca-iga'] as any, ['ebvca-iga'] as any]],
  ['血脂四项', ['血脂4项']],
  ['血常规', ['血细胞分析', ['血rt'] as any]],
  ['尿常规', ['尿液分析', ['尿rt'] as any]],
  ['粪常规', ['便常规', ['粪rt'] as any, ['便rt'] as any]],
  ['肝纤维化', ['肝纤四项', '肝纤4项']],
  ['血清肌钙蛋白', ['肌钙蛋白i', '肌钙蛋白t']],
  ['过敏原检测', ['过敏原筛查', '过敏源检测']],
  ['幽门螺杆菌', ['c14呼气', 'c13呼气', ['hp呼气'] as any, ['h.pylori'] as any]],
  ['彩超-腹部', ['腹部彩超', '彩超腹部']],
  ['彩超-甲状腺', ['甲状腺彩超', '彩超甲状腺']],
  ['彩超-心脏', ['心脏彩超', '彩超心脏', '心脏彩色多普勒超声']],
  ['彩超-妇科', ['妇科彩超', '彩超妇科']],
  ['ct-胸部', ['胸部ct', ['ct胸部'] as any]],
  ['胸部正侧位片', ['胸片', '胸部x线']],
  ['心电图', ['12导联心电图', '静息心电图']],
  ['肺功能', ['肺功能测定']],
  ['人体成分分析', ['inbody', '体成分分析']],
  ['骨密度', ['骨密度测定']],
  ['动脉硬化', ['动脉硬化检测']],
  ['碳13', ['c13']],
  ['碳14', ['c14']],
];

// 规范化：去掉所有空格 / 中英文括号统一 / 大小写 / 常见符号
function normalize(s: string) {
  return String(s || '')
    .replace(/\s+/g, '')
    .replace(/（/g, '(').replace(/）/g, ')')
    .replace(/％/g, '%')
    .replace(/·/g, '')
    .replace(/﹣/g, '-').replace(/－/g, '-')
    .replace(/，/g, ',').replace(/：/g, ':')
    .replace(/①/g, '1').replace(/②/g, '2').replace(/③/g, '3').replace(/④/g, '4')
    .replace(/⑤/g, '5').replace(/⑥/g, '6').replace(/⑦/g, '7').replace(/⑧/g, '8')
    .replace(/⑨/g, '9').replace(/⑩/g, '10')
    .replace(/Ⅰ/g, 'i').replace(/Ⅱ/g, 'ii').replace(/Ⅲ/g, 'iii').replace(/Ⅳ/g, 'iv').replace(/Ⅴ/g, 'v')
    .replace(/Ⅵ/g, 'vi').replace(/Ⅶ/g, 'vii').replace(/Ⅷ/g, 'viii').replace(/Ⅸ/g, 'ix').replace(/Ⅹ/g, 'x')
    .replace(/\u00A0/g, '')
    .replace(/[\[\]]/g, '')
    .toLowerCase();
}

// 提取 括号外主名 + 括号内容 tokens 排序后拼接
function decompose(s: string): { main: string; bracketSorted: string; tokens: Set<string> } {
  const n = normalize(s);
  // 去掉所有括号及内容得到"主名"
  const main = n.replace(/\([^)]*\)/g, '').replace(/（[^）]*）/g, '');
  // 收集括号内容，去空
  const bracketMatchList = [...n.matchAll(/\(([^)]*)\)/g)].map(m => m[1]);
  const bracket = bracketMatchList.join(',');
  // 括号内容切分成 token：按 顿号/逗号/空格/分号/斜线/加号/和 拆分
  const tokensRaw = bracket.split(/[、，,\/\\+;\s]/).map(t => t.trim()).filter(Boolean);
  // 常见元素短别名展开：ca=钙, fe=铁, zn=锌, se=硒, cu=铜, mn=锰, mg=镁, sr=锶, cr=镉, pb=铅, hg=汞, as=砷, k=钾, na=钠, cl=氯
  const ELEM_ALIAS: Record<string, string> = {
    ca: '钙', fe: '铁', zn: '锌', se: '硒', cu: '铜', mn: '锰', mg: '镁',
    sr: '锶', cr: '镉', pb: '铅', hg: '汞', as: '砷', k: '钾', na: '钠', cl: '氯',
    p: '磷', s: '硫', i: '碘', mo: '钼', co: '钴', ni: '镍', ge: '锗', v: '钒',
    iga: '免疫球蛋白a', igg: '免疫球蛋白g', igm: '免疫球蛋白m',
    'hp-iii': '幽门螺杆菌iii型', 'hp-c-iv': '幽门螺杆菌civ型', 'cv-iv': 'cv4型', 'cv-iv-ln': 'cv4层粘连蛋白',
    'eb-vca-igm': 'eb病毒壳抗原igm', 'ebvca-igm': 'eb病毒壳抗原igm',
    'eb-vca-iga': 'eb病毒壳抗原iga', 'ebvca-iga': 'eb病毒壳抗原iga',
  };
  const tokens = new Set<string>();
  tokensRaw.forEach(t => {
    const e = ELEM_ALIAS[t.toLowerCase()] || t.toLowerCase();
    tokens.add(e);
  });
  // 主名也跑一遍别名展开（主名作为独立token加入集合，提升主名相似时的得分）
  const mainExpanded = expandAliases(main);
  if (mainExpanded && mainExpanded !== main) tokens.add(mainExpanded);
  const bracketSorted = [...tokens].sort().join('|');
  return { main, bracketSorted, tokens };
}

// 展开别名：若 s 命中某个别名列表，则替换成"标准名"（返回标准名 normalize 后的值）
function expandAliases(s: string): string {
  const n = normalize(s);
  for (const [std, alist] of ALIASES) {
    const ns = normalize(std);
    if (n === ns) return ns;
    if ((alist as any[]).map(String).map(normalize).includes(n)) return ns;
  }
  return n;
}

// Jaccard 相似度 = 交集/并集
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  a.forEach(v => { if (b.has(v)) inter++; });
  const uni = a.size + b.size - inter;
  return uni === 0 ? 0 : inter / uni;
}

// 最长公共子序列长度 / 平均长度占比
function lcsRatio(a: string, b: string): number {
  if (!a || !b) return 0;
  const m = a.length, n = b.length;
  if (m * n > 250000) {
    // 字符串太大改用更便宜的"最长公共子串"
    return longestCommonSubstringRatio(a, b);
  }
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const lcsLen = dp[m][n];
  return (lcsLen * 2) / (m + n);
}
function longestCommonSubstringRatio(a: string, b: string): number {
  if (!a || !b) return 0;
  const m = a.length, n = b.length;
  let max = 0;
  const prev = new Uint16Array(n + 1);
  const curr = new Uint16Array(n + 1);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
        if (curr[j] > max) max = curr[j];
      } else {
        curr[j] = 0;
      }
    }
    for (let j = 0; j <= n; j++) { prev[j] = curr[j]; curr[j] = 0; }
  }
  return (max * 2) / (m + n);
}

// 3 层匹配：返回 {db, matchKind, score}
function matchDbRow(
  pdfName: string,
  dbKeyMap: Map<string, CheckupItemRow>,        // exact key → row
  dbShortMap: Map<string, CheckupItemRow>,      // 去括号主名 → row（第一个）
  dbRows: CheckupItemRow[],
  allDecomposedDb: WeakMap<CheckupItemRow, ReturnType<typeof decompose>>,
): { db: CheckupItemRow | null; kind: DiffRow['matchKind']; score: number } {
  const pdfExp = expandAliases(pdfName);
  const { main: pdfMain, bracketSorted: pdfBracket, tokens: pdfTokens } = decompose(pdfExp);

  // 第 1 层：完全精确 key（主名 + 排序括号tokens）
  const exactKey = `${pdfMain}__${pdfBracket}`;
  const exact = dbKeyMap.get(exactKey);
  if (exact) return { db: exact, kind: 'exact', score: 100 };

  // 第 2 层：主名去括号后完全相同；若两边括号token jaccard ≥ 0.6 则算 short 命中（否则走模糊再兜底）
  const shortHit = dbShortMap.get(pdfMain);
  if (shortHit) {
    const d = allDecomposedDb.get(shortHit) || decompose(shortHit.name);
    const j = jaccard(pdfTokens, d.tokens);
    // 主名相同本身权重极高；即使括号内完全不同（j=0）也命中 short，但分数较低
    const score = 70 + Math.round(j * 30);
    return { db: shortHit, kind: 'short', score };
  }

  // 第 3 层：全局模糊，评分 = 主名 LCS 比*0.6 + tokens Jaccard*0.3 + 全名 LCS*0.1，≥75 命中
  let best: { row: CheckupItemRow; score: number } | null = null;
  for (const r of dbRows) {
    const d = allDecomposedDb.get(r) || decompose(r.name);
    const mainSim = lcsRatio(pdfMain, d.main);
    const fullSim = lcsRatio(normalize(pdfExp), normalize(r.name));
    const tokSim = jaccard(pdfTokens, d.tokens);
    const score100 = Math.round(mainSim * 60 + tokSim * 30 + fullSim * 10);
    if (!best || score100 > best.score) best = { row: r, score: score100 };
  }
  if (best && best.score >= 75) {
    return { db: best.row, kind: 'fuzzy', score: best.score };
  }
  return { db: null, kind: null, score: 0 };
}

function priceCompare(rows: CheckupItemRow[], text: string): PriceCompareResult {
  const diffs: DiffRow[] = [];
  let matchedCount = 0;
  const unknownNames: string[] = [];
  const dbNameMap = new Map<string, CheckupItemRow>();
  rows.forEach(r => {
    const k = normalize(r.name);
    if (!dbNameMap.has(k)) dbNameMap.set(k, r);
  });

  // A1: 构造 key 索引
  const dbDecomposed = new WeakMap<CheckupItemRow, ReturnType<typeof decompose>>();
  const dbKeyMap = new Map<string, CheckupItemRow>();
  const dbShortMap = new Map<string, CheckupItemRow>();
  rows.forEach(r => {
    const dec = decompose(r.name);
    dbDecomposed.set(r, dec);
    const key = `${dec.main}__${dec.bracketSorted}`;
    if (!dbKeyMap.has(key)) dbKeyMap.set(key, r);
    if (dec.main && !dbShortMap.has(dec.main)) dbShortMap.set(dec.main, r);
  });

  const hitDbIds = new Set<string>();
  const lines = text.split(/\r?\n/);
  let parsedCount = 0;

  for (const raw of lines) {
    const line = raw.replace(/^\s+|\s+$/g, '');
    if (!line) continue;
    if (/项目名称|医保价格|定价|2023最新定价/.test(line)) continue;
    const parts = line.split(/\t+|,|\u3001|\u0020{2,}|\s{2,}|，/).map(s => s.replace(/^\s+|\s+$/g, '')).filter(Boolean);
    if (parts.length < 2) continue;
    const digits = parts.map(p => parsePrice(p));
    let priceIdx = -1;
    let insuredIdx = -1;
    for (let i = digits.length - 1; i >= 0; i--) {
      if (digits[i] !== null && priceIdx < 0) { priceIdx = i; continue; }
      if (digits[i] !== null && insuredIdx < 0) { insuredIdx = i; break; }
    }
    if (priceIdx < 0) continue;
    let nameParts: string[];
    if (insuredIdx < 0) { nameParts = parts.slice(0, priceIdx); }
    else { nameParts = parts.slice(0, insuredIdx); }
    const name = nameParts.join(' ').replace(/^\s+|\s+$/g, '');
    if (!name) continue;
    const pdfPrice = parsePrice(parts[priceIdx]);
    const pdfInsured = insuredIdx >= 0 ? parsePrice(parts[insuredIdx]) : null;
    if (pdfPrice === null) continue;
    parsedCount++;

    const { db, kind, score } = matchDbRow(name, dbKeyMap, dbShortMap, rows, dbDecomposed);

    if (!db) {
      unknownNames.push(name);
      diffs.push({ name, pdfPrice, dbPrice: null, pdfInsured, dbInsured: null, reason: '缺', matchKind: null, matchScore: 0 });
      continue;
    }
    // 命中 DB
    if (db.id) hitDbIds.add(db.id);
    const dbPrice = Math.round((Number(db.default_price) || 0) * 100) / 100;
    const dbInsured = Math.round((Number(db.insurance_price) || 0) * 100) / 100;
    const priceDiff = Math.abs(dbPrice - pdfPrice);
    let insuredDiff = 0;
    if (pdfInsured !== null) insuredDiff = Math.abs(dbInsured - pdfInsured);
    if (priceDiff < 0.001 && (pdfInsured === null || insuredDiff < 0.001)) {
      matchedCount++;
      continue;
    }
    let reason: DiffRow['reason'] = '其他';
    if (priceDiff >= 0.001 && pdfInsured !== null && insuredDiff >= 0.001) reason = '定价差+医保';
    else if (priceDiff >= 0.001) reason = '定价差';
    else reason = '医保价差';
    diffs.push({
      name, pdfPrice, dbPrice, pdfInsured, dbInsured, reason,
      dbId: db.id ?? null, dbName: db.name, dbCode: db.code,
      matchKind: kind, matchScore: score,
    });
  }

  const order = (r: DiffRow) => ({
    '缺': 0, '定价差+医保': 1, '定价差': 2, '医保价差': 3, '其他': 4,
  } as any)[r.reason];
  diffs.sort((a, b) => {
    if (order(a) !== order(b)) return order(a) - order(b);
    const absAmt = (r: DiffRow) => Math.max(
      Math.abs((r.pdfPrice || 0) - (r.dbPrice || 0)),
      Math.abs((r.pdfInsured || 0) - (r.dbInsured || 0)),
    );
    return absAmt(b) - absAmt(a);
  });

  // A3: DB 中未被 PDF 引用的项目（按启用状态优先、有医保价缺失优先排）
  const dbUnmatched = rows
    .filter(r => r.id ? !hitDbIds.has(r.id) : false)
    .sort((a, b) => {
      const miss = (r: any) => (Number(r.insurance_price) || 0) === 0 ? 1 : 0;
      if (miss(a) !== miss(b)) return miss(b) - miss(a);
      return Number(b.status || 0) - Number(a.status || 0);
    });

  return { parsedCount, diffs, matchedCount, unknownNames, dbNameMap, dbRows: rows, dbUnmatched, hitDbIds };
}

function parsePrice(s: string): number | null {
  if (!s) return null;
  const raw = String(s).replace(/^\s+|\s+$/g, '').replace(/[¥￥,，\s]/g, '');
  if (/^\d+(?:\.\d+)?\s*[\/:：]\s*\d+(?:\.\d+)?$/.test(raw)) {
    const parts = raw.split(/[\/:：]/).map(Number).filter(n => !isNaN(n));
    if (parts.length >= 2) return parts[1];
  }
  const n = Number(raw);
  if (!isNaN(n) && isFinite(n)) return Math.round(n * 100) / 100;
  return null;
}
