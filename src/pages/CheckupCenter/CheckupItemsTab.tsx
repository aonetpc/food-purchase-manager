import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Save, Search } from 'lucide-react';
import { bookingApi, type CheckupItemRow } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { useAuthStore } from '@/store/authStore';

const CATEGORY_OPTIONS = ['体格检查', '实验室', '影像检查', '功能检查', '肿瘤筛查', '妇科专项', '特色加项', '化验', '专科', '其他'] as const;

const inputCls =
  'w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-green-500 transition-colors';
const btnGhost =
  'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 transition-colors';
const btnGold =
  'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-green-500 hover:bg-green-600 text-white font-medium transition-colors disabled:opacity-50';

function Upd({ value, onChange, type = 'text', step, placeholder }:
  { value: any; onChange: (v: any) => void; type?: string; step?: string; placeholder?: string }) {
  return (
    <input
      type={type}
      step={step}
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => onChange(type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
      className={`${inputCls} text-xs !py-1 !px-2`}
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

const DEFAULT_CHECKUP: Partial<CheckupItemRow> = {
  code: '', name: '', item_type: 'item', category: '化验',
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

  // 合并分类：既有 7 大类 + 旧 BizConfig 中的 4 类，去重排序
  const allCategories = useUniqueCategories(rows);

  // 过滤
  const filteredRows = rows.filter(r => {
    const kw = search.trim();
    if (kw && !`${r.name}${r.code}`.includes(kw)) return false;
    if (catFilter !== '全部' && r.category !== catFilter) return false;
    return true;
  });

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

  return (
    <div className="space-y-4">
      {/* 顶部操作栏：搜索 + 分类 Tabs + 新增 */}
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
      </div>

      {/* 分类 Tabs */}
      <div className="flex flex-wrap gap-1.5">
        {['全部', ...allCategories].map(c => (
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
      </div>

      {/* 统计栏 */}
      <div className="text-sm text-gray-600">
        共 <span className="font-medium text-gray-900">{filteredRows.length}</span> 条
        {rows.some(r => r.item_type === 'combo') && (
          <span className="ml-2 text-amber-600">（含 {rows.filter(r => r.item_type === 'combo').length} 个组合项目）</span>
        )}
        ，启用 <span className="text-cyan-600 font-medium">{filteredRows.filter(r => r.status === 1).length}</span> 条
      </div>

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
                        value={editing!.data.category || '化验'}
                        onChange={(e) => setField('category', e.target.value)}
                        className={inputCls + ' text-xs !py-1'}
                      >
                        {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1.5"><Upd type="number" step="0.01" value={editing!.data.default_price} onChange={(v) => setField('default_price', v)} /></td>
                    <td className="px-2 py-1.5"><Upd type="number" step="0.01" value={editing!.data.insurance_price ?? 0} onChange={(v) => setField('insurance_price', v)} /></td>
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
                return (
                  <React.Fragment key={r.id}>
                    <tr className="border-t border-gray-100 hover:bg-gray-50/50">
                      <td className="px-3 py-2 font-mono">
                        {editRow ? <Upd value={editing!.data.code} onChange={(v) => setField('code', v)} /> : <span className="font-semibold">{r.code}</span>}
                      </td>
                      <td className="px-3 py-2">
                        {editRow ? <Upd value={editing!.data.name} onChange={(v) => setField('name', v)} /> : (
                          <span>{r.name}{typeLabel(r)}</span>
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
                            {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        ) : r.category}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {editRow ? <Upd type="number" step="0.01" value={editing!.data.default_price} onChange={(v) => setField('default_price', v)} />
                          : `¥${Number(r.default_price || 0).toLocaleString()}`}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-indigo-600">
                        {editRow ? <Upd type="number" step="0.01" value={editing!.data.insurance_price ?? 0} onChange={(v) => setField('insurance_price', v)} />
                          : `¥${Number(r.insurance_price || 0).toLocaleString()}`}
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
                                <RowBtn onClick={() => setEditing({ mode: 'update', data: { ...r, sub_item_ids: (r.sub_items || []).map((si: any) => si.sub_item_id ?? si.id) } })}>编辑</RowBtn>
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

function useUniqueCategories(rows: CheckupItemRow[]): string[] {
  const set = new Set<string>([...CATEGORY_OPTIONS]);
  rows.forEach(r => { if (r.category) set.add(r.category); });
  return Array.from(set);
}
