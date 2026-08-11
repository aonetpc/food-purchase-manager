import { useEffect, useState } from 'react';
import { X, Plus, Trash2, Save, Settings, ChevronDown, Search } from 'lucide-react';
import { bookingApi, type PackageRow, type PackageItemRow, type CheckupItemRow, type RoomTypeRow, type MeetingHallRow, type WellnessTypeRow } from '../../lib/api';

// ================================================
// 样式常量（与 Create.tsx 一致）
// ================================================
const inputCls =
  'w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-green-500 transition-colors';
const labelCls = 'block text-xs text-gray-500 mb-1.5';
const btnGhost =
  'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 transition-colors';
const btnGold =
  'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-green-500 hover:bg-green-600 text-white font-medium transition-colors';

type TabKey = 'packages' | 'checkupItems' | 'roomTypes' | 'meetingHalls' | 'wellnessTypes';
const TABS: { key: TabKey; label: string; color: string }[] = [
  { key: 'packages',     label: '体检套餐', color: '#10b981' },
  { key: 'checkupItems', label: '体检项目', color: '#06b6d4' },
  { key: 'roomTypes',    label: '房型',     color: '#3b82f6' },
  { key: 'meetingHalls', label: '会议厅',   color: '#8b5cf6' },
  { key: 'wellnessTypes',label: '康乐项目', color: '#f59e0b' },
];

// 新增默认值
const DEFAULT_PKG: Partial<PackageRow> = { code: '', name: '', price: 0, status: 1, sort_order: 100 };
const DEFAULT_ROOM: Partial<RoomTypeRow> = { code: '', name: '', price: 0, status: 1, sort_order: 100 };
const DEFAULT_HALL: Partial<MeetingHallRow> = { code: '', name: '', capacity: 20, half_price: 0, full_price: 0, status: 1, sort_order: 100 };
const DEFAULT_WELL: Partial<WellnessTypeRow> = { code: '', name: '', min_hours: 0, price: 0, is_free: 0, status: 1, sort_order: 100 };
const DEFAULT_CHECKUP: Partial<CheckupItemRow> = { code: '', name: '', category: '其他', description: '', default_price: 0, unit: '次', status: 1, sort_order: 100 };

export default function BizConfigModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<TabKey>('packages');
  const [saving, setSaving] = useState(false);

  // 5 类数据
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [checkupItems, setCheckupItems] = useState<CheckupItemRow[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomTypeRow[]>([]);
  const [meetingHalls, setMeetingHalls] = useState<MeetingHallRow[]>([]);
  const [wellnessTypes, setWellnessTypes] = useState<WellnessTypeRow[]>([]);

  // 编辑/新增表单
  const [editing, setEditing] = useState<
    | { mode: 'create' | 'update'; data: any }
    | null
  >(null);

  const bumpEditing = () => {
    setEditing(prev => prev ? { ...prev } : null);
  };

  const loadAll = async () => {
    try {
      const [ps, cs, rs, hs, ws] = await Promise.all([
        bookingApi.listPackages(),
        bookingApi.listCheckupItems(),
        bookingApi.listRoomTypes(),
        bookingApi.listMeetingHalls(),
        bookingApi.listWellnessTypes(),
      ]);
      setPackages((ps as any[]) || []);
      setCheckupItems((cs as any[]) || []);
      setRoomTypes((rs as any[]) || []);
      setMeetingHalls((hs as any[]) || []);
      setWellnessTypes((ws as any[]) || []);
    } catch (e) {
      alert('加载业务常量失败：' + (e as Error).message);
    }
  };

  useEffect(() => {
    if (open) {
      loadAll();
      setEditing(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ========== 通用增删改 ==========
  async function handleSave(
    apiFn: () => Promise<any>,
    onSuccess: () => void = () => {},
  ) {
    setSaving(true);
    try {
      await apiFn();
      await loadAll();
      setEditing(null);
      onSuccess();
    } catch (e) {
      alert('保存失败：' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(
    apiFn: () => Promise<any>,
    confirmMsg: string,
  ) {
    if (!confirm(confirmMsg)) return;
    try {
      await apiFn();
      await loadAll();
    } catch (e) {
      alert('删除失败：' + (e as Error).message);
    }
  }

  if (!open) return null;

  // ========== 渲染 ==========
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative bg-white rounded-xl border border-gray-200 shadow-2xl w-full max-w-5xl max-h-[88vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* 头 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 shrink-0">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Settings size={18} className="text-green-600" /> 业务常量配置
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-800">
            <X size={18} />
          </button>
        </div>

        {/* Tab 栏 */}
        <div className="flex border-b border-gray-200 bg-gray-50 px-3 pt-3 shrink-0">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setEditing(null); }}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg border border-b-0 transition-colors relative ${
                tab === t.key
                  ? 'bg-white border-gray-200 text-gray-900'
                  : 'text-gray-500 hover:text-gray-700 border-transparent'
              }`}
              style={tab === t.key ? { borderTop: `3px solid ${t.color}` } : undefined}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {tab === 'packages' && (
            <PackagesTable
              rows={packages}
              checkupItems={checkupItems}
              editing={editing?.mode ? editing : null}
              bumpEditing={bumpEditing}
              onNew={() => setEditing({ mode: 'create', data: { ...DEFAULT_PKG, items: [] } })}
              onEdit={(r) => setEditing({ mode: 'update', data: { ...r, items: (r as any).items || [] } })}
              onCancel={() => setEditing(null)}
              onSave={(d) => {
                const data = d as any;
                const itemsData = data.items || [];
                if ((editing as any)?.mode === 'update' && data.id) {
                  handleSave(
                    async () => {
                      await bookingApi.updatePackage(data.id, data);
                      if (itemsData.length >= 0) {
                        await bookingApi.batchUpdatePackageItems(data.id, itemsData);
                      }
                    },
                    () => {},
                  );
                } else {
                  handleSave(
                    async () => {
                      const created = await bookingApi.createPackage(data);
                      if (created.id && itemsData.length > 0) {
                        await bookingApi.batchUpdatePackageItems(created.id, itemsData);
                      }
                    },
                    () => {},
                  );
                }
              }}
              onDel={(r) => handleDelete(
                () => bookingApi.deletePackage(r.id),
                `确定禁用套餐「${r.name}」吗？禁用后订单下拉不会再显示它，已有订单不受影响。`,
              )}
              saving={saving}
            />
          )}

          {tab === 'checkupItems' && (
            <CheckupItemsTable
              rows={checkupItems}
              editing={editing?.mode ? editing : null}
              onNew={() => setEditing({ mode: 'create', data: { ...DEFAULT_CHECKUP } })}
              onEdit={(r) => setEditing({ mode: 'update', data: { ...r } })}
              onCancel={() => setEditing(null)}
              onSave={(d) => {
                const data = d as Partial<CheckupItemRow>;
                if ((editing as any)?.mode === 'update' && data.id) {
                  handleSave(() => bookingApi.updateCheckupItem(data.id!, data), () => {});
                } else {
                  handleSave(() => bookingApi.createCheckupItem(data), () => {});
                }
              }}
              onDel={(r) => handleDelete(
                () => bookingApi.deleteCheckupItem(r.id),
                `确定禁用体检项目「${r.name}」吗？`,
              )}
              saving={saving}
            />
          )}

          {tab === 'roomTypes' && (
            <RoomTypesTable
              rows={roomTypes}
              editing={editing?.mode ? editing : null}
              onNew={() => setEditing({ mode: 'create', data: { ...DEFAULT_ROOM } })}
              onEdit={(r) => setEditing({ mode: 'update', data: { ...r } })}
              onCancel={() => setEditing(null)}
              onSave={(d) => {
                const data = d as Partial<RoomTypeRow>;
                if ((editing as any)?.mode === 'update' && data.id) {
                  handleSave(() => bookingApi.updateRoomType(data.id!, data), () => {});
                } else {
                  handleSave(() => bookingApi.createRoomType(data), () => {});
                }
              }}
              onDel={(r) => handleDelete(
                () => bookingApi.deleteRoomType(r.id),
                `确定禁用房型「${r.name}」吗？`,
              )}
              saving={saving}
            />
          )}

          {tab === 'meetingHalls' && (
            <MeetingHallsTable
              rows={meetingHalls}
              editing={editing?.mode ? editing : null}
              onNew={() => setEditing({ mode: 'create', data: { ...DEFAULT_HALL } })}
              onEdit={(r) => setEditing({ mode: 'update', data: { ...r } })}
              onCancel={() => setEditing(null)}
              onSave={(d) => {
                const data = d as Partial<MeetingHallRow>;
                if ((editing as any)?.mode === 'update' && data.id) {
                  handleSave(() => bookingApi.updateMeetingHall(data.id!, data), () => {});
                } else {
                  handleSave(() => bookingApi.createMeetingHall(data), () => {});
                }
              }}
              onDel={(r) => handleDelete(
                () => bookingApi.deleteMeetingHall(r.id),
                `确定禁用会议厅「${r.name}」吗？`,
              )}
              saving={saving}
            />
          )}

          {tab === 'wellnessTypes' && (
            <WellnessTypesTable
              rows={wellnessTypes}
              editing={editing?.mode ? editing : null}
              onNew={() => setEditing({ mode: 'create', data: { ...DEFAULT_WELL } })}
              onEdit={(r) => setEditing({ mode: 'update', data: { ...r } })}
              onCancel={() => setEditing(null)}
              onSave={(d) => {
                const data = d as Partial<WellnessTypeRow>;
                if ((editing as any)?.mode === 'update' && data.id) {
                  handleSave(() => bookingApi.updateWellnessType(data.id!, data), () => {});
                } else {
                  handleSave(() => bookingApi.createWellnessType(data), () => {});
                }
              }}
              onDel={(r) => handleDelete(
                () => bookingApi.deleteWellnessType(r.id),
                `确定禁用康乐项目「${r.name}」吗？`,
              )}
              saving={saving}
            />
          )}
        </div>

        {/* 底部 */}
        <div className="px-5 py-3 border-t border-gray-200 shrink-0 flex items-center justify-between">
          <div className="text-xs text-gray-400">
            修改后立即生效；「删除」为软禁用，不影响历史订单数据。
          </div>
          <button onClick={onClose} className={btnGhost}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 表格通用接口 & 组件
// ============================================================

interface TableProps<T> {
  rows: T[];
  editing: { mode: 'create' | 'update'; data: any } | null;
  onNew: () => void;
  onEdit: (r: T) => void;
  onCancel: () => void;
  onSave: (d: any) => void;
  onDel: (r: T) => void;
  saving: boolean;
}

function Upd({ value, onChange, type = 'text', step }:
  { value: any; onChange: (v: any) => void; type?: string; step?: string }) {
  return (
    <input
      type={type}
      step={step}
      value={value ?? ''}
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

// ============================================================
// 体检套餐表（含 items 子表）
// ============================================================
function PackagesTable(props: TableProps<PackageRow> & { checkupItems: CheckupItemRow[]; bumpEditing: () => void }) {
  const { rows, checkupItems, editing, bumpEditing, onNew, onEdit, onCancel, onSave, onDel, saving } = props;
  const isCreating = editing?.mode === 'create';
  const isEditingThis = (r: PackageRow) => editing?.mode === 'update' && editing.data.id === r.id;

  const setField = (k: string, v: any) => {
    if (editing) {
      editing.data[k] = v;
      bumpEditing();
    }
  };

  // auto_total 计算
  const calcAutoTotal = (items: PackageItemRow[] = []) =>
    items.reduce((s, i) => s + Number(i.item_price || 0) * Number(i.quantity || 1), 0);

  // 行展示的单价
  const displayPrice = (r: PackageRow) => {
    const autoTotal = calcAutoTotal((r as any).items || []);
    const p = Number(r.price || 0);
    if (autoTotal > 0 && p === 0) {
      return { text: `¥${autoTotal.toLocaleString()}`, tag: '自动' };
    }
    if (p > 0 && p !== autoTotal) {
      return { text: `¥${p.toLocaleString()}`, tag: '手动' };
    }
    return { text: `¥${p.toLocaleString()}`, tag: '' };
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600">共 {rows.length} 条配置，其中 <span className="text-green-600 font-medium">{rows.filter(r => r.status === 1).length}</span> 条启用</div>
        {!editing && <button onClick={onNew} className={btnGold}><Plus size={12}/> 新增套餐</button>}
      </div>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium w-20">编码</th>
              <th className="px-3 py-2 text-left font-medium">名称</th>
              <th className="px-3 py-2 text-center font-medium w-16">项目数</th>
              <th className="px-3 py-2 text-right font-medium w-28">单价(¥)</th>
              <th className="px-3 py-2 text-center font-medium w-16">排序</th>
              <th className="px-3 py-2 text-center font-medium w-16">状态</th>
              <th className="px-3 py-2 text-center font-medium w-36">操作</th>
            </tr>
          </thead>
          <tbody>
            {isCreating && (
              <PackageEditRow
                editing={editing!}
                checkupItems={checkupItems}
                bumpEditing={bumpEditing}
                saving={saving}
                onSave={onSave}
                onCancel={onCancel}
                setField={setField}
                calcAutoTotal={calcAutoTotal}
              />
            )}
            {rows.map(r => {
              const editRow = isEditingThis(r);
              if (editRow) return null; // edit row rendered below
              const dp = displayPrice(r);
              const itemCount = (r as any).items?.length ?? (r as any).item_count ?? 0;
              return (
                <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50/50">
                  <td className="px-3 py-2 font-mono"><span className="font-semibold">{r.code}</span></td>
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-center">{itemCount}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    {dp.text}
                    {dp.tag && <span className={`ml-1 text-[10px] ${dp.tag === '自动' ? 'text-cyan-500' : 'text-amber-500'}`}>{dp.tag}</span>}
                  </td>
                  <td className="px-3 py-2 text-center">{r.sort_order}</td>
                  <td className="px-3 py-2 text-center">
                    {r.status === 1 ? <span className="text-green-600">● 启用</span> : <span className="text-gray-400">● 禁用</span>}
                  </td>
                  <td className="px-3 py-2 text-center space-x-1">
                    <RowBtn onClick={() => onEdit(r)}>编辑</RowBtn>
                    <RowBtn cls="!text-red-500 hover:!bg-red-50 !border-red-200" onClick={() => onDel(r)}><Trash2 size={10}/> 禁用</RowBtn>
                  </td>
                </tr>
              );
            })}
            {/* 编辑行（update 模式） */}
            {editing?.mode === 'update' && (
              <PackageEditRow
                editing={editing}
                checkupItems={checkupItems}
                bumpEditing={bumpEditing}
                saving={saving}
                onSave={onSave}
                onCancel={onCancel}
                setField={setField}
                calcAutoTotal={calcAutoTotal}
              />
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// -------- 套餐编辑行（含 items 子表） --------
function PackageEditRow({
  editing,
  checkupItems,
  bumpEditing,
  saving,
  onSave,
  onCancel,
  setField,
  calcAutoTotal,
}: {
  editing: { mode: 'create' | 'update'; data: any };
  checkupItems: CheckupItemRow[];
  bumpEditing: () => void;
  saving: boolean;
  onSave: (d: any) => void;
  onCancel: () => void;
  setField: (k: string, v: any) => void;
  calcAutoTotal: (items: PackageItemRow[]) => number;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerFilter, setPickerFilter] = useState('');

  const data = editing.data;
  const items: PackageItemRow[] = data.items || [];

  const availableItems = checkupItems
    .filter(ci => ci.status === 1)
    .filter(ci => !items.some(pi => pi.item_id === ci.id))
    .filter(ci => !pickerFilter || ci.name.includes(pickerFilter) || ci.code.includes(pickerFilter));

  function addItemToPackage(ci: CheckupItemRow) {
    const newItem: PackageItemRow = {
      id: '',
      package_id: data.id || '',
      item_id: ci.id,
      item_name_snapshot: ci.name,
      item_price: ci.default_price || 0,
      quantity: 1,
      sort_order: (items.length) * 10 + 10,
    };
    data.items = [...items, newItem];
    editing.data = { ...data };
    bumpEditing();
    setPickerOpen(false);
    setPickerFilter('');
  }

  function removeItem(idx: number) {
    data.items = items.filter((_, i) => i !== idx);
    editing.data = { ...data };
    bumpEditing();
  }

  function updateItemField(idx: number, field: string, value: any) {
    const arr = [...items];
    (arr[idx] as any)[field] = value;
    data.items = arr;
    editing.data = { ...data };
    bumpEditing();
  }

  const autoTotal = calcAutoTotal(items);
  const itemCount = items.length;

  return (
    <>
      <tr className="bg-green-50/50 border-b border-gray-100">
        <td className="px-2 py-1.5"><Upd value={data.code} onChange={(v) => setField('code', v)} /></td>
        <td className="px-2 py-1.5"><Upd value={data.name} onChange={(v) => setField('name', v)} /></td>
        <td className="px-2 py-1.5 text-center">{itemCount}</td>
        <td className="px-2 py-1.5">
          <div className="flex items-center gap-1">
            <Upd type="number" step="0.01" value={data.price} onChange={(v) => setField('price', v)} />
            {autoTotal > 0 && data.price == 0 && (
              <span className="text-[10px] text-cyan-500 whitespace-nowrap">自动 ¥{autoTotal.toLocaleString()}</span>
            )}
          </div>
        </td>
        <td className="px-2 py-1.5"><Upd type="number" value={data.sort_order} onChange={(v) => setField('sort_order', v)} /></td>
        <td className="px-2 py-1.5 text-center"><Checkbox value={data.status} onChange={(v) => setField('status', v)} /></td>
        <td className="px-2 py-1.5 text-center space-x-1">
          <RowBtn cls="!bg-green-500 !text-white !border-green-500 hover:!bg-green-600" onClick={() => onSave(editing.data)}>{saving ? '保存中' : <><Save size={10}/> 保存</>}</RowBtn>
          <RowBtn onClick={onCancel}>取消</RowBtn>
        </td>
      </tr>
      {/* items 子表 */}
      {itemCount > 0 && (
        <tr className="bg-green-50/30">
          <td colSpan={7} className="px-4 py-2">
            <div className="rounded-lg border border-green-200 bg-white p-2">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] text-gray-500 font-medium">套餐项目明细</span>
              </div>
              <table className="w-full text-[11px]">
                <thead className="text-gray-400">
                  <tr>
                    <th className="text-left font-medium py-1 pr-2">项目名称</th>
                    <th className="text-right font-medium py-1 px-2 w-20">单价(¥)</th>
                    <th className="text-center font-medium py-1 px-2 w-14">数量</th>
                    <th className="text-right font-medium py-1 px-2 w-20">小计(¥)</th>
                    <th className="text-center font-medium py-1 w-16">排序</th>
                    <th className="text-center font-medium py-1 w-16">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => {
                    const subtotal = Number(item.item_price || 0) * Number(item.quantity || 1);
                    return (
                      <tr key={idx} className="border-t border-gray-100">
                        <td className="py-1 pr-2 text-gray-700">{item.item_name_snapshot}</td>
                        <td className="py-1 px-2">
                          <Upd type="number" step="0.01" value={item.item_price} onChange={(v) => updateItemField(idx, 'item_price', v)} />
                        </td>
                        <td className="py-1 px-2">
                          <Upd type="number" value={item.quantity} onChange={(v) => updateItemField(idx, 'quantity', v)} />
                        </td>
                        <td className="py-1 px-2 text-right font-mono">¥{subtotal.toLocaleString()}</td>
                        <td className="py-1">
                          <Upd type="number" value={item.sort_order} onChange={(v) => updateItemField(idx, 'sort_order', v)} />
                        </td>
                        <td className="py-1 text-center">
                          <button
                            onClick={() => removeItem(idx)}
                            className="text-red-500 hover:text-red-700 inline-flex items-center gap-0.5"
                          >
                            <Trash2 size={10}/> 移除
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-200">
                    <td colSpan={3} className="py-1.5 text-right font-medium text-gray-500">合计：</td>
                    <td className="py-1.5 text-right font-mono font-semibold text-green-600">¥{autoTotal.toLocaleString()}</td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </td>
        </tr>
      )}
      {/* 添加项目按钮 + 选择器 */}
      <tr className="bg-green-50/20">
        <td colSpan={7} className="px-4 py-2">
          <div className="relative inline-block">
            <button
              onClick={() => setPickerOpen(!pickerOpen)}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-green-500 text-white hover:bg-green-600 transition-colors"
            >
              <Plus size={12}/> 添加项目
              <ChevronDown size={12} className={`transition-transform ${pickerOpen ? 'rotate-180' : ''}`}/>
            </button>
            {pickerOpen && (
              <div className="absolute z-50 mt-1 w-80 bg-white border border-gray-200 rounded-lg shadow-lg">
                <div className="p-2 border-b border-gray-100">
                  <div className="relative">
                    <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400"/>
                    <input
                      value={pickerFilter}
                      onChange={(e) => setPickerFilter(e.target.value)}
                      placeholder="搜索项目名称或编码..."
                      className={`${inputCls} text-xs !py-1 !pl-6`}
                      autoFocus
                    />
                  </div>
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {availableItems.length === 0 ? (
                    <div className="px-3 py-4 text-center text-xs text-gray-400">
                      {checkupItems.filter(ci => ci.status === 1).length === 0 ? '暂无可用体检项目，请先到「体检项目」tab 添加' : '所有体检项目已添加'}
                    </div>
                  ) : (
                    availableItems.map(ci => (
                      <button
                        key={ci.id}
                        onClick={() => addItemToPackage(ci)}
                        className="w-full text-left px-3 py-2 hover:bg-green-50 border-b border-gray-50 flex items-center justify-between text-xs"
                      >
                        <div>
                          <div className="font-medium text-gray-800">{ci.name}</div>
                          <div className="text-gray-400 text-[10px]">{ci.code} · {ci.category} · {ci.unit}</div>
                        </div>
                        <div className="font-mono text-green-600">¥{ci.default_price || 0}</div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </td>
      </tr>
    </>
  );
}

// ============================================================
// 体检项目表（CheckupItems）
// ============================================================
function CheckupItemsTable(props: TableProps<CheckupItemRow>) {
  const { rows, editing, onNew, onEdit, onCancel, onSave, onDel, saving } = props;
  const isCreating = editing?.mode === 'create';
  const isEditingThis = (r: CheckupItemRow) => editing?.mode === 'update' && editing.data.id === r.id;
  const setField = (k: string, v: any) => {
    if (editing) editing.data[k] = v;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600">共 {rows.length} 条配置，其中 <span className="text-cyan-600 font-medium">{rows.filter(r => r.status === 1).length}</span> 条启用</div>
        {!editing && <button onClick={onNew} className={btnGold}><Plus size={12}/> 新增体检项目</button>}
      </div>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium w-20">编码</th>
              <th className="px-3 py-2 text-left font-medium">名称</th>
              <th className="px-3 py-2 text-left font-medium w-20">分类</th>
              <th className="px-3 py-2 text-right font-medium w-24">默认单价(¥)</th>
              <th className="px-3 py-2 text-center font-medium w-16">单位</th>
              <th className="px-3 py-2 text-center font-medium w-16">排序</th>
              <th className="px-3 py-2 text-center font-medium w-16">状态</th>
              <th className="px-3 py-2 text-center font-medium w-36">操作</th>
            </tr>
          </thead>
          <tbody>
            {isCreating && (
              <tr className="bg-cyan-50/50 border-b border-gray-100">
                <td className="px-2 py-1.5"><Upd value={editing.data.code} onChange={(v) => setField('code', v)} /></td>
                <td className="px-2 py-1.5"><Upd value={editing.data.name} onChange={(v) => setField('name', v)} /></td>
                <td className="px-2 py-1.5">
                  <select
                    value={editing.data.category || '其他'}
                    onChange={(e) => setField('category', e.target.value)}
                    className={inputCls}
                  >
                    <option value="其他">其他</option>
                    <option value="检验科">检验科</option>
                    <option value="放射科">放射科</option>
                    <option value="功能检查">功能检查</option>
                    <option value="内科">内科</option>
                    <option value="外科">外科</option>
                    <option value="妇科">妇科</option>
                    <option value="五官科">五官科</option>
                  </select>
                </td>
                <td className="px-2 py-1.5"><Upd type="number" step="0.01" value={editing.data.default_price} onChange={(v) => setField('default_price', v)} /></td>
                <td className="px-2 py-1.5"><Upd value={editing.data.unit} onChange={(v) => setField('unit', v)} /></td>
                <td className="px-2 py-1.5"><Upd type="number" value={editing.data.sort_order} onChange={(v) => setField('sort_order', v)} /></td>
                <td className="px-2 py-1.5 text-center"><Checkbox value={editing.data.status} onChange={(v) => setField('status', v)} /></td>
                <td className="px-2 py-1.5 text-center space-x-1">
                  <RowBtn cls="!bg-green-500 !text-white !border-green-500 hover:!bg-green-600" onClick={() => onSave(editing.data)}>{saving ? '保存中' : <><Save size={10}/> 保存</>}</RowBtn>
                  <RowBtn onClick={onCancel}>取消</RowBtn>
                </td>
              </tr>
            )}
            {rows.map(r => {
              const editRow = isEditingThis(r);
              return (
                <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50/50">
                  <td className="px-3 py-2 font-mono">{editRow ? <Upd value={editing!.data.code} onChange={(v) => setField('code', v)} /> : <span className="font-semibold">{r.code}</span>}</td>
                  <td className="px-3 py-2">{editRow ? <Upd value={editing!.data.name} onChange={(v) => setField('name', v)} /> : r.name}</td>
                  <td className="px-3 py-2">
                    {editRow ? (
                      <select
                        value={editing!.data.category || '其他'}
                        onChange={(e) => setField('category', e.target.value)}
                        className={inputCls}
                      >
                        <option value="其他">其他</option>
                        <option value="检验科">检验科</option>
                        <option value="放射科">放射科</option>
                        <option value="功能检查">功能检查</option>
                        <option value="内科">内科</option>
                        <option value="外科">外科</option>
                        <option value="妇科">妇科</option>
                        <option value="五官科">五官科</option>
                      </select>
                    ) : r.category}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{editRow ? <Upd type="number" step="0.01" value={editing!.data.default_price} onChange={(v) => setField('default_price', v)} /> : `¥${Number(r.default_price || 0).toLocaleString()}`}</td>
                  <td className="px-3 py-2 text-center">{editRow ? <Upd value={editing!.data.unit} onChange={(v) => setField('unit', v)} /> : r.unit}</td>
                  <td className="px-3 py-2 text-center">{editRow ? <Upd type="number" value={editing!.data.sort_order} onChange={(v) => setField('sort_order', v)} /> : r.sort_order}</td>
                  <td className="px-3 py-2 text-center">
                    {editRow ? <Checkbox value={editing!.data.status} onChange={(v) => setField('status', v)} />
                             : r.status === 1 ? <span className="text-green-600">● 启用</span> : <span className="text-gray-400">● 禁用</span>}
                  </td>
                  <td className="px-3 py-2 text-center space-x-1">
                    {editRow ? (
                      <>
                        <RowBtn cls="!bg-green-500 !text-white !border-green-500 hover:!bg-green-600" onClick={() => onSave(editing!.data)}>{saving ? '保存中' : <><Save size={10}/> 保存</>}</RowBtn>
                        <RowBtn onClick={onCancel}>取消</RowBtn>
                      </>
                    ) : (
                      <>
                        <RowBtn onClick={() => onEdit(r)}>编辑</RowBtn>
                        <RowBtn cls="!text-red-500 hover:!bg-red-50 !border-red-200" onClick={() => onDel(r)}><Trash2 size={10}/> 禁用</RowBtn>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================
// 房型表
// ============================================================
function RoomTypesTable(props: TableProps<RoomTypeRow>) {
  const { rows, editing, onNew, onEdit, onCancel, onSave, onDel, saving } = props;
  const isCreating = editing?.mode === 'create';
  const isEditingThis = (r: RoomTypeRow) => editing?.mode === 'update' && editing.data.id === r.id;
  const setField = (k: string, v: any) => {
    if (editing) editing.data[k] = v;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600">共 {rows.length} 条配置，其中 <span className="text-blue-600 font-medium">{rows.filter(r => r.status === 1).length}</span> 条启用</div>
        {!editing && <button onClick={onNew} className={btnGold}><Plus size={12}/> 新增房型</button>}
      </div>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium w-28">编码</th>
              <th className="px-3 py-2 text-left font-medium">名称</th>
              <th className="px-3 py-2 text-right font-medium w-32">单价(¥/间/晚)</th>
              <th className="px-3 py-2 text-center font-medium w-16">排序</th>
              <th className="px-3 py-2 text-center font-medium w-16">状态</th>
              <th className="px-3 py-2 text-center font-medium w-36">操作</th>
            </tr>
          </thead>
          <tbody>
            {isCreating && (
              <tr className="bg-blue-50/50 border-b border-gray-100">
                <td className="px-2 py-1.5"><Upd value={editing!.data.code} onChange={(v) => setField('code', v)} /></td>
                <td className="px-2 py-1.5"><Upd value={editing!.data.name} onChange={(v) => setField('name', v)} /></td>
                <td className="px-2 py-1.5"><Upd type="number" step="0.01" value={editing!.data.price} onChange={(v) => setField('price', v)} /></td>
                <td className="px-2 py-1.5"><Upd type="number" value={editing!.data.sort_order} onChange={(v) => setField('sort_order', v)} /></td>
                <td className="px-2 py-1.5 text-center"><Checkbox value={editing!.data.status} onChange={(v) => setField('status', v)} /></td>
                <td className="px-2 py-1.5 text-center space-x-1">
                  <RowBtn cls="!bg-green-500 !text-white !border-green-500 hover:!bg-green-600" onClick={() => onSave(editing!.data)}>{saving ? '保存中' : <><Save size={10}/> 保存</>}</RowBtn>
                  <RowBtn onClick={onCancel}>取消</RowBtn>
                </td>
              </tr>
            )}
            {rows.map(r => {
              const editRow = isEditingThis(r);
              return (
                <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50/50">
                  <td className="px-3 py-2 font-mono">{editRow ? <Upd value={editing!.data.code} onChange={(v) => setField('code', v)} /> : <span className="font-semibold">{r.code}</span>}</td>
                  <td className="px-3 py-2">{editRow ? <Upd value={editing!.data.name} onChange={(v) => setField('name', v)} /> : r.name}</td>
                  <td className="px-3 py-2 text-right font-mono">{editRow ? <Upd type="number" step="0.01" value={editing!.data.price} onChange={(v) => setField('price', v)} /> : `¥${Number(r.price).toLocaleString()}`}</td>
                  <td className="px-3 py-2 text-center">{editRow ? <Upd type="number" value={editing!.data.sort_order} onChange={(v) => setField('sort_order', v)} /> : r.sort_order}</td>
                  <td className="px-3 py-2 text-center">
                    {editRow ? <Checkbox value={editing!.data.status} onChange={(v) => setField('status', v)} />
                             : r.status === 1 ? <span className="text-green-600">● 启用</span> : <span className="text-gray-400">● 禁用</span>}
                  </td>
                  <td className="px-3 py-2 text-center space-x-1">
                    {editRow ? (
                      <>
                        <RowBtn cls="!bg-green-500 !text-white !border-green-500 hover:!bg-green-600" onClick={() => onSave(editing!.data)}>{saving ? '保存中' : <><Save size={10}/> 保存</>}</RowBtn>
                        <RowBtn onClick={onCancel}>取消</RowBtn>
                      </>
                    ) : (
                      <>
                        <RowBtn onClick={() => onEdit(r)}>编辑</RowBtn>
                        <RowBtn cls="!text-red-500 hover:!bg-red-50 !border-red-200" onClick={() => onDel(r)}><Trash2 size={10}/> 禁用</RowBtn>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================
// 会议厅表
// ============================================================
function MeetingHallsTable(props: TableProps<MeetingHallRow>) {
  const { rows, editing, onNew, onEdit, onCancel, onSave, onDel, saving } = props;
  const isCreating = editing?.mode === 'create';
  const isEditingThis = (r: MeetingHallRow) => editing?.mode === 'update' && editing.data.id === r.id;
  const setField = (k: string, v: any) => {
    if (editing) editing.data[k] = v;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600">共 {rows.length} 条配置，其中 <span className="text-purple-600 font-medium">{rows.filter(r => r.status === 1).length}</span> 条启用</div>
        {!editing && <button onClick={onNew} className={btnGold}><Plus size={12}/> 新增会议厅</button>}
      </div>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium w-28">编码</th>
              <th className="px-3 py-2 text-left font-medium">名称</th>
              <th className="px-3 py-2 text-right font-medium w-20">容量</th>
              <th className="px-3 py-2 text-right font-medium w-24">半天(¥)</th>
              <th className="px-3 py-2 text-right font-medium w-24">全天(¥)</th>
              <th className="px-3 py-2 text-center font-medium w-16">排序</th>
              <th className="px-3 py-2 text-center font-medium w-16">状态</th>
              <th className="px-3 py-2 text-center font-medium w-36">操作</th>
            </tr>
          </thead>
          <tbody>
            {isCreating && (
              <tr className="bg-purple-50/50 border-b border-gray-100">
                <td className="px-2 py-1.5"><Upd value={editing!.data.code} onChange={(v) => setField('code', v)} /></td>
                <td className="px-2 py-1.5"><Upd value={editing!.data.name} onChange={(v) => setField('name', v)} /></td>
                <td className="px-2 py-1.5"><Upd type="number" value={editing!.data.capacity} onChange={(v) => setField('capacity', v)} /></td>
                <td className="px-2 py-1.5"><Upd type="number" step="0.01" value={editing!.data.half_price} onChange={(v) => setField('half_price', v)} /></td>
                <td className="px-2 py-1.5"><Upd type="number" step="0.01" value={editing!.data.full_price} onChange={(v) => setField('full_price', v)} /></td>
                <td className="px-2 py-1.5"><Upd type="number" value={editing!.data.sort_order} onChange={(v) => setField('sort_order', v)} /></td>
                <td className="px-2 py-1.5 text-center"><Checkbox value={editing!.data.status} onChange={(v) => setField('status', v)} /></td>
                <td className="px-2 py-1.5 text-center space-x-1">
                  <RowBtn cls="!bg-green-500 !text-white !border-green-500 hover:!bg-green-600" onClick={() => onSave(editing!.data)}>{saving ? '保存中' : <><Save size={10}/> 保存</>}</RowBtn>
                  <RowBtn onClick={onCancel}>取消</RowBtn>
                </td>
              </tr>
            )}
            {rows.map(r => {
              const editRow = isEditingThis(r);
              return (
                <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50/50">
                  <td className="px-3 py-2 font-mono">{editRow ? <Upd value={editing!.data.code} onChange={(v) => setField('code', v)} /> : <span className="font-semibold">{r.code}</span>}</td>
                  <td className="px-3 py-2">{editRow ? <Upd value={editing!.data.name} onChange={(v) => setField('name', v)} /> : r.name}</td>
                  <td className="px-3 py-2 text-right font-mono">{editRow ? <Upd type="number" value={editing!.data.capacity} onChange={(v) => setField('capacity', v)} /> : r.capacity}</td>
                  <td className="px-3 py-2 text-right font-mono">{editRow ? <Upd type="number" step="0.01" value={editing!.data.half_price} onChange={(v) => setField('half_price', v)} /> : `¥${Number(r.half_price).toLocaleString()}`}</td>
                  <td className="px-3 py-2 text-right font-mono">{editRow ? <Upd type="number" step="0.01" value={editing!.data.full_price} onChange={(v) => setField('full_price', v)} /> : `¥${Number(r.full_price).toLocaleString()}`}</td>
                  <td className="px-3 py-2 text-center">{editRow ? <Upd type="number" value={editing!.data.sort_order} onChange={(v) => setField('sort_order', v)} /> : r.sort_order}</td>
                  <td className="px-3 py-2 text-center">
                    {editRow ? <Checkbox value={editing!.data.status} onChange={(v) => setField('status', v)} />
                             : r.status === 1 ? <span className="text-green-600">● 启用</span> : <span className="text-gray-400">● 禁用</span>}
                  </td>
                  <td className="px-3 py-2 text-center space-x-1">
                    {editRow ? (
                      <>
                        <RowBtn cls="!bg-green-500 !text-white !border-green-500 hover:!bg-green-600" onClick={() => onSave(editing!.data)}>{saving ? '保存中' : <><Save size={10}/> 保存</>}</RowBtn>
                        <RowBtn onClick={onCancel}>取消</RowBtn>
                      </>
                    ) : (
                      <>
                        <RowBtn onClick={() => onEdit(r)}>编辑</RowBtn>
                        <RowBtn cls="!text-red-500 hover:!bg-red-50 !border-red-200" onClick={() => onDel(r)}><Trash2 size={10}/> 禁用</RowBtn>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================
// 康乐项目表
// ============================================================
function WellnessTypesTable(props: TableProps<WellnessTypeRow>) {
  const { rows, editing, onNew, onEdit, onCancel, onSave, onDel, saving } = props;
  const isCreating = editing?.mode === 'create';
  const isEditingThis = (r: WellnessTypeRow) => editing?.mode === 'update' && editing.data.id === r.id;
  const setField = (k: string, v: any) => {
    if (editing) editing.data[k] = v;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600">共 {rows.length} 条配置，其中 <span className="text-amber-600 font-medium">{rows.filter(r => r.status === 1).length}</span> 条启用</div>
        {!editing && <button onClick={onNew} className={btnGold}><Plus size={12}/> 新增康乐项目</button>}
      </div>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium w-28">编码</th>
              <th className="px-3 py-2 text-left font-medium">名称</th>
              <th className="px-3 py-2 text-center font-medium w-20">最少小时</th>
              <th className="px-3 py-2 text-right font-medium w-24">单价(¥/小时)</th>
              <th className="px-3 py-2 text-center font-medium w-16">免费</th>
              <th className="px-3 py-2 text-center font-medium w-16">排序</th>
              <th className="px-3 py-2 text-center font-medium w-16">状态</th>
              <th className="px-3 py-2 text-center font-medium w-36">操作</th>
            </tr>
          </thead>
          <tbody>
            {isCreating && (
              <tr className="bg-amber-50/50 border-b border-gray-100">
                <td className="px-2 py-1.5"><Upd value={editing!.data.code} onChange={(v) => setField('code', v)} /></td>
                <td className="px-2 py-1.5"><Upd value={editing!.data.name} onChange={(v) => setField('name', v)} /></td>
                <td className="px-2 py-1.5 text-center"><Upd type="number" value={editing!.data.min_hours} onChange={(v) => setField('min_hours', v)} /></td>
                <td className="px-2 py-1.5"><Upd type="number" step="0.01" value={editing!.data.price} onChange={(v) => setField('price', v)} /></td>
                <td className="px-2 py-1.5 text-center"><Checkbox value={editing!.data.is_free} onChange={(v) => setField('is_free', v)} /></td>
                <td className="px-2 py-1.5"><Upd type="number" value={editing!.data.sort_order} onChange={(v) => setField('sort_order', v)} /></td>
                <td className="px-2 py-1.5 text-center"><Checkbox value={editing!.data.status} onChange={(v) => setField('status', v)} /></td>
                <td className="px-2 py-1.5 text-center space-x-1">
                  <RowBtn cls="!bg-green-500 !text-white !border-green-500 hover:!bg-green-600" onClick={() => onSave(editing!.data)}>{saving ? '保存中' : <><Save size={10}/> 保存</>}</RowBtn>
                  <RowBtn onClick={onCancel}>取消</RowBtn>
                </td>
              </tr>
            )}
            {rows.map(r => {
              const editRow = isEditingThis(r);
              return (
                <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50/50">
                  <td className="px-3 py-2 font-mono">{editRow ? <Upd value={editing!.data.code} onChange={(v) => setField('code', v)} /> : <span className="font-semibold">{r.code}</span>}</td>
                  <td className="px-3 py-2">{editRow ? <Upd value={editing!.data.name} onChange={(v) => setField('name', v)} /> : r.name}</td>
                  <td className="px-3 py-2 text-center font-mono">{editRow ? <Upd type="number" value={editing!.data.min_hours} onChange={(v) => setField('min_hours', v)} /> : r.min_hours || 0}</td>
                  <td className="px-3 py-2 text-right font-mono">{editRow ? <Upd type="number" step="0.01" value={editing!.data.price} onChange={(v) => setField('price', v)} /> : `¥${Number(r.price).toLocaleString()}`}</td>
                  <td className="px-3 py-2 text-center">
                    {editRow ? <Checkbox value={editing!.data.is_free} onChange={(v) => setField('is_free', v)} />
                             : Number(r.is_free) === 1 ? <span className="text-emerald-600 font-medium">免费</span> : <span className="text-gray-500">收费</span>}
                  </td>
                  <td className="px-3 py-2 text-center">{editRow ? <Upd type="number" value={editing!.data.sort_order} onChange={(v) => setField('sort_order', v)} /> : r.sort_order}</td>
                  <td className="px-3 py-2 text-center">
                    {editRow ? <Checkbox value={editing!.data.status} onChange={(v) => setField('status', v)} />
                             : r.status === 1 ? <span className="text-green-600">● 启用</span> : <span className="text-gray-400">● 禁用</span>}
                  </td>
                  <td className="px-3 py-2 text-center space-x-1">
                    {editRow ? (
                      <>
                        <RowBtn cls="!bg-green-500 !text-white !border-green-500 hover:!bg-green-600" onClick={() => onSave(editing!.data)}>{saving ? '保存中' : <><Save size={10}/> 保存</>}</RowBtn>
                        <RowBtn onClick={onCancel}>取消</RowBtn>
                      </>
                    ) : (
                      <>
                        <RowBtn onClick={() => onEdit(r)}>编辑</RowBtn>
                        <RowBtn cls="!text-red-500 hover:!bg-red-50 !border-red-200" onClick={() => onDel(r)}><Trash2 size={10}/> 禁用</RowBtn>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}