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

  // P5 价格对拍
  const compare = useMemo(() => priceCompare(rows, pdfText), [rows, pdfText]);

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
            <span className="text-[11px] text-sky-600">粘贴 PDF 价目表 → 自动对拍 → 导出差异</span>
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
              <div className="text-[11px] text-sky-800 flex items-center justify-between">
                <span>对拍结果（{compare.parsedCount} 条 PDF / {compare.dbNameMap.size} 条数据库）</span>
                <span className="text-sky-700 font-semibold">差异 {compare.diffs.length}</span>
              </div>
              {compare.diffs.length === 0 && pdfText ? (
                <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-4 text-center">
                  ✅ 所有已解析的 PDF 项目与数据库定价完全一致
                </div>
              ) : (
                <div className="max-h-56 overflow-auto border border-sky-200 rounded-lg bg-white">
                  <table className="w-full text-[11px]">
                    <thead className="bg-sky-50 text-sky-900 sticky top-0">
                      <tr>
                        <th className="text-left px-2 py-1.5">项目</th>
                        <th className="text-right px-2 py-1.5">PDF定价</th>
                        <th className="text-right px-2 py-1.5">数据库</th>
                        <th className="text-right px-2 py-1.5">PDF医保</th>
                        <th className="text-right px-2 py-1.5">数据库医保</th>
                        <th className="text-center px-2 py-1.5">状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compare.diffs.slice(0, 80).map((d, i) => (
                        <tr key={i} className={`border-t border-gray-100 ${
                          d.reason === '缺' ? 'bg-rose-50'
                            : d.reason === '定价差' ? 'bg-amber-50'
                            : d.reason === '医保价差' ? 'bg-violet-50'
                            : ''
                        }`}>
                          <td className="px-2 py-1.5 text-gray-800">{d.name}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{d.pdfPrice !== null ? '¥' + d.pdfPrice : '-'}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{d.dbPrice !== null ? '¥' + d.dbPrice : '-'}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{d.pdfInsured !== null ? '¥' + d.pdfInsured : '-'}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{d.dbInsured !== null ? '¥' + d.dbInsured : '-'}</td>
                          <td className="px-2 py-1.5 text-center">
                            <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                              d.reason === '缺' ? 'bg-rose-100 text-rose-700'
                                : d.reason === '定价差' ? 'bg-amber-100 text-amber-800'
                                : 'bg-violet-100 text-violet-800'
                            }`}>{d.reason}</span>
                          </td>
                        </tr>
                      ))}
                      {compare.diffs.length > 80 && (
                        <tr>
                          <td colSpan={6} className="text-center text-[11px] text-gray-400 py-1.5">
                            还有 {compare.diffs.length - 80} 条，请缩小粘贴范围或直接在数据库查看
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
                </div>
              )}
              <div className="text-[10.5px] text-slate-500 mt-2 leading-relaxed">
                ⚠️ 说明：由于 PDF 表格的 OCR 或人工导出格式可能有误差，建议配合搜索框单独核对每条。
                医保价缺失是导致后续套餐卡片价格与预期不一致的常见原因，建议补录。
              </div>
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

// --------- P5: 价格对拍解析 ---------
interface DiffRow {
  name: string;
  pdfPrice: number | null;
  dbPrice: number | null;
  pdfInsured: number | null;
  dbInsured: number | null;
  reason: '缺' | '定价差' | '医保价差' | '定价差+医保' | '其他';
}
function priceCompare(rows: CheckupItemRow[], text: string) {
  const result: DiffRow[] = [];
  let matchedCount = 0;
  const unknownNames: string[] = [];
  const dbNameMap = new Map<string, CheckupItemRow>();
  rows.forEach(r => {
    const k = normalize(r.name);
    if (!dbNameMap.has(k)) dbNameMap.set(k, r); // 优先保留首个匹配
  });

  const lines = text.split(/\r?\n/);
  let parsedCount = 0;

  for (const raw of lines) {
    const line = raw.replace(/^\s+|\s+$/g, '');
    if (!line) continue;
    // 跳过表头
    if (/项目名称|医保价格|定价|2023最新定价/.test(line)) continue;
    // 按 \t 或 , 或中文逗号、或至少 2 空格、或中文空格分割
    const parts = line.split(/\t+|,|\u3001|\u0020{2,}|\s{2,}|，/).map(s => s.replace(/^\s+|\s+$/g, '')).filter(Boolean);
    if (parts.length < 2) continue;
    // 最后两列 都是数字：parts[-1]定价，parts[-2]医保价；前面剩下的拼接成 name
    let priceRaw = '';
    let insuredRaw = '';
    let nameParts: string[];
    // 从右往左扫，找最后两个数字作为 price / insured
    const digits = parts.map(p => parsePrice(p));
    let priceIdx = -1;
    let insuredIdx = -1;
    for (let i = digits.length - 1; i >= 0; i--) {
      if (digits[i] !== null && priceIdx < 0) { priceIdx = i; continue; }
      if (digits[i] !== null && insuredIdx < 0) { insuredIdx = i; break; }
    }
    if (priceIdx < 0) continue; // 至少要有定价
    if (insuredIdx < 0) { insuredRaw = ''; nameParts = parts.slice(0, priceIdx); }
    else { nameParts = parts.slice(0, insuredIdx); }
    const name = nameParts.join(' ').replace(/^\s+|\s+$/g, '');
    if (!name) continue;
    priceRaw = parts[priceIdx];
    const pdfPrice = parsePrice(priceRaw);
    const pdfInsured = insuredIdx >= 0 ? parsePrice(parts[insuredIdx]) : null;
    if (pdfPrice === null) continue;
    parsedCount++;

    const db = dbNameMap.get(normalize(name));
    if (!db) {
      unknownNames.push(name);
      result.push({ name, pdfPrice, dbPrice: null, pdfInsured, dbInsured: null, reason: '缺' });
      continue;
    }
    const dbPrice = Math.round((Number(db.default_price) || 0) * 100) / 100;
    const dbInsured = Math.round((Number(db.insurance_price) || 0) * 100) / 100;
    const priceDiff = Math.abs(dbPrice - pdfPrice);
    let insuredDiff = 0;
    if (pdfInsured !== null) insuredDiff = Math.abs(dbInsured - pdfInsured);
    if (priceDiff < 0.001 && (pdfInsured === null || insuredDiff < 0.001)) {
      matchedCount++;
      continue;
    }
    if (priceDiff >= 0.001 && pdfInsured !== null && insuredDiff >= 0.001) {
      result.push({ name, pdfPrice, dbPrice, pdfInsured, dbInsured, reason: '定价差' });
      result[result.length - 1].reason = '定价差+医保';
    } else if (priceDiff >= 0.001) {
      result.push({ name, pdfPrice, dbPrice, pdfInsured, dbInsured, reason: '定价差' });
    } else {
      result.push({ name, pdfPrice, dbPrice, pdfInsured, dbInsured, reason: '医保价差' });
    }
  }

  // 排序：缺 > 定价差+医保 > 定价差 > 医保价差；同组按差额降序
  const order = (r: DiffRow) => ({
    '缺': 0,
    '定价差+医保': 1,
    '定价差': 2,
    '医保价差': 3,
    '其他': 4,
  } as any)[r.reason];
  result.sort((a, b) => {
    if (order(a) !== order(b)) return order(a) - order(b);
    const absAmt = (r: DiffRow) => Math.max(
      Math.abs((r.pdfPrice || 0) - (r.dbPrice || 0)),
      Math.abs((r.pdfInsured || 0) - (r.dbInsured || 0)),
    );
    return absAmt(b) - absAmt(a);
  });

  return { parsedCount, diffs: result, matchedCount, unknownNames, dbNameMap };
}
function normalize(s: string) {
  return String(s || '')
    .replace(/\s+/g, '')
    .replace(/（/g, '(').replace(/）/g, ')')
    .replace(/％/g, '%')
    .replace(/·/g, '')
    .replace(/﹣/g, '-').replace(/－/g, '-')
    .replace(/，/g, ',').replace(/：/g, ':')
    .replace(/①/g, '1').replace(/②/g, '2').replace(/③/g, '3').replace(/④/g, '4')
    .replace(/\u00A0/g, '')
    .toLowerCase();
}
function parsePrice(s: string): number | null {
  if (!s) return null;
  const raw = String(s).replace(/^\s+|\s+$/g, '').replace(/[¥￥,，\s]/g, '');
  // 区间价，如 10/70 → 取第一个（截图里出现 CT部位(不含片) 20/120，默认定价取大？这里按 PDF 价列为准：默认取整段解析失败的话返回 null）
  if (/^\d+(?:\.\d+)?\s*[\/:：]\s*\d+(?:\.\d+)?$/.test(raw)) {
    const parts = raw.split(/[\/:：]/).map(Number).filter(n => !isNaN(n));
    if (parts.length >= 2) return parts[1]; // 习惯上 PDF 列是 原价/折扣价，取后面那个更接近"2023最新定价"
  }
  const n = Number(raw);
  if (!isNaN(n) && isFinite(n)) return Math.round(n * 100) / 100;
  return null;
}
