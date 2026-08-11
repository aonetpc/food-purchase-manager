import { useEffect, useState } from 'react';
import { X, Plus, Trash2, Save, Settings } from 'lucide-react';
import { bookingApi, type PackageRow, type RoomTypeRow, type MeetingHallRow, type WellnessTypeRow } from '../../lib/api';

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

type TabKey = 'packages' | 'roomTypes' | 'meetingHalls' | 'wellnessTypes';
const TABS: { key: TabKey; label: string; color: string }[] = [
  { key: 'packages',     label: '体检套餐', color: '#10b981' },
  { key: 'roomTypes',    label: '房型',     color: '#3b82f6' },
  { key: 'meetingHalls', label: '会议厅',   color: '#8b5cf6' },
  { key: 'wellnessTypes',label: '康乐项目', color: '#f59e0b' },
];

// 新增默认值
const DEFAULT_PKG: Partial<PackageRow> = { code: '', name: '', price: 0, status: 1, sort_order: 100 };
const DEFAULT_ROOM: Partial<RoomTypeRow> = { code: '', name: '', price: 0, status: 1, sort_order: 100 };
const DEFAULT_HALL: Partial<MeetingHallRow> = { code: '', name: '', capacity: 20, half_price: 0, full_price: 0, status: 1, sort_order: 100 };
const DEFAULT_WELL: Partial<WellnessTypeRow> = { code: '', name: '', min_hours: 0, price: 0, is_free: 0, status: 1, sort_order: 100 };

export default function BizConfigModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<TabKey>('packages');
  const [saving, setSaving] = useState(false);

  // 4 类数据
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomTypeRow[]>([]);
  const [meetingHalls, setMeetingHalls] = useState<MeetingHallRow[]>([]);
  const [wellnessTypes, setWellnessTypes] = useState<WellnessTypeRow[]>([]);

  // 编辑/新增表单
  const [editing, setEditing] = useState<
    | { mode: 'create' | 'update'; data: Partial<PackageRow> }
    | { mode: 'create' | 'update'; data: Partial<RoomTypeRow> }
    | { mode: 'create' | 'update'; data: Partial<MeetingHallRow> }
    | { mode: 'create' | 'update'; data: Partial<WellnessTypeRow> }
    | null
  >(null);

  const loadAll = async () => {
    try {
      const [ps, rs, hs, ws] = await Promise.all([
        bookingApi.listPackages(),
        bookingApi.listRoomTypes(),
        bookingApi.listMeetingHalls(),
        bookingApi.listWellnessTypes(),
      ]);
      setPackages((ps as any[]) || []);
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
    onSuccess: () => void,
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
              editing={editing?.mode ? (editing as any) : null}
              onNew={() => setEditing({ mode: 'create', data: { ...DEFAULT_PKG } })}
              onEdit={(r) => setEditing({ mode: 'update', data: { ...r } })}
              onCancel={() => setEditing(null)}
              onSave={(d) => {
                const data = d as Partial<PackageRow>;
                if ((editing as any)?.mode === 'update' && data.id) {
                  handleSave(
                    () => bookingApi.updatePackage(data.id!, data),
                    () => {},
                  );
                } else {
                  handleSave(
                    () => bookingApi.createPackage(data),
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

          {tab === 'roomTypes' && (
            <RoomTypesTable
              rows={roomTypes}
              editing={editing?.mode ? (editing as any) : null}
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
              editing={editing?.mode ? (editing as any) : null}
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
              editing={editing?.mode ? (editing as any) : null}
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
// 4 个表格 + 编辑行组件
// ============================================================

interface TableProps<T> {
  rows: T[];
  editing: { mode: 'create' | 'update'; data: Partial<T> } | null;
  onNew: () => void;
  onEdit: (r: T) => void;
  onCancel: () => void;
  onSave: (d: Partial<T>) => void;
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

// -------- 体检套餐表 --------
function PackagesTable(props: TableProps<PackageRow>) {
  const { rows, editing, onNew, onEdit, onCancel, onSave, onDel, saving } = props;
  const isCreating = editing?.mode === 'create';
  const isEditingThis = (r: PackageRow) => editing?.mode === 'update' && (editing.data as any).id === r.id;
  const setField = (k: keyof PackageRow, v: any) => {
    if (editing) (editing as { data: any }).data[k] = v;
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
              <th className="px-3 py-2 text-right font-medium w-28">单价(¥)</th>
              <th className="px-3 py-2 text-center font-medium w-16">排序</th>
              <th className="px-3 py-2 text-center font-medium w-16">状态</th>
              <th className="px-3 py-2 text-center font-medium w-36">操作</th>
            </tr>
          </thead>
          <tbody>
            {isCreating && (
              <tr className="bg-green-50/50 border-b border-gray-100">
                <td className="px-2 py-1.5"><Upd value={(editing.data as any).code} onChange={(v) => setField('code', v)} /></td>
                <td className="px-2 py-1.5"><Upd value={(editing.data as any).name} onChange={(v) => setField('name', v)} /></td>
                <td className="px-2 py-1.5"><Upd type="number" step="0.01" value={(editing.data as any).price} onChange={(v) => setField('price', v)} /></td>
                <td className="px-2 py-1.5"><Upd type="number" value={(editing.data as any).sort_order} onChange={(v) => setField('sort_order', v)} /></td>
                <td className="px-2 py-1.5 text-center"><Checkbox value={(editing.data as any).status} onChange={(v) => setField('status', v)} /></td>
                <td className="px-2 py-1.5 text-center space-x-1">
                  <RowBtn cls="!bg-green-500 !text-white !border-green-500 hover:!bg-green-600" onClick={() => onSave((editing as any).data)}>{saving ? '保存中' : <><Save size={10}/> 保存</>}</RowBtn>
                  <RowBtn onClick={onCancel}>取消</RowBtn>
                </td>
              </tr>
            )}
            {rows.map(r => {
              const editRow = isEditingThis(r);
              const d = editRow ? (editing!.data as PackageRow) : r;
              return (
                <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50/50">
                  <td className="px-3 py-2 font-mono">{editRow ? <Upd value={d.code} onChange={(v) => setField('code', v)} /> : <span className="font-semibold">{r.code}</span>}</td>
                  <td className="px-3 py-2">{editRow ? <Upd value={d.name} onChange={(v) => setField('name', v)} /> : r.name}</td>
                  <td className="px-3 py-2 text-right font-mono">{editRow ? <Upd type="number" step="0.01" value={d.price} onChange={(v) => setField('price', v)} /> : `¥${Number(r.price).toLocaleString()}`}</td>
                  <td className="px-3 py-2 text-center">{editRow ? <Upd type="number" value={d.sort_order} onChange={(v) => setField('sort_order', v)} /> : r.sort_order}</td>
                  <td className="px-3 py-2 text-center">
                    {editRow ? <Checkbox value={d.status} onChange={(v) => setField('status', v)} />
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

// -------- 房型表 --------
function RoomTypesTable(props: TableProps<RoomTypeRow>) {
  const { rows, editing, onNew, onEdit, onCancel, onSave, onDel, saving } = props;
  const isCreating = editing?.mode === 'create';
  const isEditingThis = (r: RoomTypeRow) => editing?.mode === 'update' && (editing.data as any).id === r.id;
  const setField = (k: keyof RoomTypeRow, v: any) => {
    if (editing) (editing as { data: any }).data[k] = v;
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
                <td className="px-2 py-1.5"><Upd value={(editing.data as any).code} onChange={(v) => setField('code', v)} /></td>
                <td className="px-2 py-1.5"><Upd value={(editing.data as any).name} onChange={(v) => setField('name', v)} /></td>
                <td className="px-2 py-1.5"><Upd type="number" step="0.01" value={(editing.data as any).price} onChange={(v) => setField('price', v)} /></td>
                <td className="px-2 py-1.5"><Upd type="number" value={(editing.data as any).sort_order} onChange={(v) => setField('sort_order', v)} /></td>
                <td className="px-2 py-1.5 text-center"><Checkbox value={(editing.data as any).status} onChange={(v) => setField('status', v)} /></td>
                <td className="px-2 py-1.5 text-center space-x-1">
                  <RowBtn cls="!bg-green-500 !text-white !border-green-500 hover:!bg-green-600" onClick={() => onSave((editing as any).data)}>{saving ? '保存中' : <><Save size={10}/> 保存</>}</RowBtn>
                  <RowBtn onClick={onCancel}>取消</RowBtn>
                </td>
              </tr>
            )}
            {rows.map(r => {
              const editRow = isEditingThis(r);
              const d = editRow ? (editing!.data as RoomTypeRow) : r;
              return (
                <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50/50">
                  <td className="px-3 py-2 font-mono">{editRow ? <Upd value={d.code} onChange={(v) => setField('code', v)} /> : <span className="font-semibold">{r.code}</span>}</td>
                  <td className="px-3 py-2">{editRow ? <Upd value={d.name} onChange={(v) => setField('name', v)} /> : r.name}</td>
                  <td className="px-3 py-2 text-right font-mono">{editRow ? <Upd type="number" step="0.01" value={d.price} onChange={(v) => setField('price', v)} /> : `¥${Number(r.price).toLocaleString()}`}</td>
                  <td className="px-3 py-2 text-center">{editRow ? <Upd type="number" value={d.sort_order} onChange={(v) => setField('sort_order', v)} /> : r.sort_order}</td>
                  <td className="px-3 py-2 text-center">
                    {editRow ? <Checkbox value={d.status} onChange={(v) => setField('status', v)} />
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

// -------- 会议厅表 --------
function MeetingHallsTable(props: TableProps<MeetingHallRow>) {
  const { rows, editing, onNew, onEdit, onCancel, onSave, onDel, saving } = props;
  const isCreating = editing?.mode === 'create';
  const isEditingThis = (r: MeetingHallRow) => editing?.mode === 'update' && (editing.data as any).id === r.id;
  const setField = (k: keyof MeetingHallRow, v: any) => {
    if (editing) (editing as { data: any }).data[k] = v;
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
                <td className="px-2 py-1.5"><Upd value={(editing.data as any).code} onChange={(v) => setField('code', v)} /></td>
                <td className="px-2 py-1.5"><Upd value={(editing.data as any).name} onChange={(v) => setField('name', v)} /></td>
                <td className="px-2 py-1.5"><Upd type="number" value={(editing.data as any).capacity} onChange={(v) => setField('capacity', v)} /></td>
                <td className="px-2 py-1.5"><Upd type="number" step="0.01" value={(editing.data as any).half_price} onChange={(v) => setField('half_price', v)} /></td>
                <td className="px-2 py-1.5"><Upd type="number" step="0.01" value={(editing.data as any).full_price} onChange={(v) => setField('full_price', v)} /></td>
                <td className="px-2 py-1.5"><Upd type="number" value={(editing.data as any).sort_order} onChange={(v) => setField('sort_order', v)} /></td>
                <td className="px-2 py-1.5 text-center"><Checkbox value={(editing.data as any).status} onChange={(v) => setField('status', v)} /></td>
                <td className="px-2 py-1.5 text-center space-x-1">
                  <RowBtn cls="!bg-green-500 !text-white !border-green-500 hover:!bg-green-600" onClick={() => onSave((editing as any).data)}>{saving ? '保存中' : <><Save size={10}/> 保存</>}</RowBtn>
                  <RowBtn onClick={onCancel}>取消</RowBtn>
                </td>
              </tr>
            )}
            {rows.map(r => {
              const editRow = isEditingThis(r);
              const d = editRow ? (editing!.data as MeetingHallRow) : r;
              return (
                <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50/50">
                  <td className="px-3 py-2 font-mono">{editRow ? <Upd value={d.code} onChange={(v) => setField('code', v)} /> : <span className="font-semibold">{r.code}</span>}</td>
                  <td className="px-3 py-2">{editRow ? <Upd value={d.name} onChange={(v) => setField('name', v)} /> : r.name}</td>
                  <td className="px-3 py-2 text-right font-mono">{editRow ? <Upd type="number" value={d.capacity} onChange={(v) => setField('capacity', v)} /> : r.capacity}</td>
                  <td className="px-3 py-2 text-right font-mono">{editRow ? <Upd type="number" step="0.01" value={d.half_price} onChange={(v) => setField('half_price', v)} /> : `¥${Number(r.half_price).toLocaleString()}`}</td>
                  <td className="px-3 py-2 text-right font-mono">{editRow ? <Upd type="number" step="0.01" value={d.full_price} onChange={(v) => setField('full_price', v)} /> : `¥${Number(r.full_price).toLocaleString()}`}</td>
                  <td className="px-3 py-2 text-center">{editRow ? <Upd type="number" value={d.sort_order} onChange={(v) => setField('sort_order', v)} /> : r.sort_order}</td>
                  <td className="px-3 py-2 text-center">
                    {editRow ? <Checkbox value={d.status} onChange={(v) => setField('status', v)} />
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

// -------- 康乐项目表 --------
function WellnessTypesTable(props: TableProps<WellnessTypeRow>) {
  const { rows, editing, onNew, onEdit, onCancel, onSave, onDel, saving } = props;
  const isCreating = editing?.mode === 'create';
  const isEditingThis = (r: WellnessTypeRow) => editing?.mode === 'update' && (editing.data as any).id === r.id;
  const setField = (k: keyof WellnessTypeRow, v: any) => {
    if (editing) (editing as { data: any }).data[k] = v;
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
                <td className="px-2 py-1.5"><Upd value={(editing.data as any).code} onChange={(v) => setField('code', v)} /></td>
                <td className="px-2 py-1.5"><Upd value={(editing.data as any).name} onChange={(v) => setField('name', v)} /></td>
                <td className="px-2 py-1.5 text-center"><Upd type="number" value={(editing.data as any).min_hours} onChange={(v) => setField('min_hours', v)} /></td>
                <td className="px-2 py-1.5"><Upd type="number" step="0.01" value={(editing.data as any).price} onChange={(v) => setField('price', v)} /></td>
                <td className="px-2 py-1.5 text-center"><Checkbox value={(editing.data as any).is_free} onChange={(v) => setField('is_free', v)} /></td>
                <td className="px-2 py-1.5"><Upd type="number" value={(editing.data as any).sort_order} onChange={(v) => setField('sort_order', v)} /></td>
                <td className="px-2 py-1.5 text-center"><Checkbox value={(editing.data as any).status} onChange={(v) => setField('status', v)} /></td>
                <td className="px-2 py-1.5 text-center space-x-1">
                  <RowBtn cls="!bg-green-500 !text-white !border-green-500 hover:!bg-green-600" onClick={() => onSave((editing as any).data)}>{saving ? '保存中' : <><Save size={10}/> 保存</>}</RowBtn>
                  <RowBtn onClick={onCancel}>取消</RowBtn>
                </td>
              </tr>
            )}
            {rows.map(r => {
              const editRow = isEditingThis(r);
              const d = editRow ? (editing!.data as WellnessTypeRow) : r;
              return (
                <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50/50">
                  <td className="px-3 py-2 font-mono">{editRow ? <Upd value={d.code} onChange={(v) => setField('code', v)} /> : <span className="font-semibold">{r.code}</span>}</td>
                  <td className="px-3 py-2">{editRow ? <Upd value={d.name} onChange={(v) => setField('name', v)} /> : r.name}</td>
                  <td className="px-3 py-2 text-center font-mono">{editRow ? <Upd type="number" value={d.min_hours} onChange={(v) => setField('min_hours', v)} /> : r.min_hours || 0}</td>
                  <td className="px-3 py-2 text-right font-mono">{editRow ? <Upd type="number" step="0.01" value={d.price} onChange={(v) => setField('price', v)} /> : `¥${Number(r.price).toLocaleString()}`}</td>
                  <td className="px-3 py-2 text-center">
                    {editRow ? <Checkbox value={d.is_free} onChange={(v) => setField('is_free', v)} />
                             : Number(r.is_free) === 1 ? <span className="text-emerald-600 font-medium">免费</span> : <span className="text-gray-500">收费</span>}
                  </td>
                  <td className="px-3 py-2 text-center">{editRow ? <Upd type="number" value={d.sort_order} onChange={(v) => setField('sort_order', v)} /> : r.sort_order}</td>
                  <td className="px-3 py-2 text-center">
                    {editRow ? <Checkbox value={d.status} onChange={(v) => setField('status', v)} />
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
