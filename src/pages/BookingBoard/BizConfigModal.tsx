import React, { useEffect, useState } from 'react';
import { X, Plus, Trash2, Save, Settings, ChevronDown, AlertCircle, CheckCircle } from 'lucide-react';
import { bookingApi, type RoomTypeRow, type MeetingHallRow, type WellnessTypeRow, type MealTypeRow } from '../../lib/api';
import { useToast } from '@/components/Toast';

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

type TabKey = 'roomTypes' | 'meetingHalls' | 'wellnessTypes' | 'mealTypes';
const TABS: { key: TabKey; label: string; color: string }[] = [
  { key: 'roomTypes',    label: '房型',     color: '#3b82f6' },
  { key: 'meetingHalls', label: '会议厅',   color: '#8b5cf6' },
  { key: 'wellnessTypes',label: '康乐项目', color: '#f59e0b' },
  { key: 'mealTypes',    label: '用餐标准', color: '#ef4444' },
];

// 新增默认值
const DEFAULT_ROOM: Partial<RoomTypeRow> = { code: '', name: '', price: 0, status: 1, sort_order: 100 };
const DEFAULT_HALL: Partial<MeetingHallRow> = { code: '', name: '', capacity: 20, half_price: 0, full_price: 0, status: 1, sort_order: 100 };
const DEFAULT_WELL: Partial<WellnessTypeRow> = { code: '', name: '', min_hours: 0, package_hours: 0, price: 0, price_guest: 0, price_external: 0, time_window: '', pricing_mode: 'per_hour', is_free: 0, status: 1, sort_order: 100 };
const DEFAULT_MEAL: Partial<MealTypeRow> = { code: '', name: '', pricing_mode: 'per_table', unit_price: 0, default_time: '12:00', default_tables: 1, default_per_table: 10, default_pax: 0, status: 1, sort_order: 100 };

// ================================================
// 编码自动生成（按类型前缀 + 3位序号）
// ================================================
const CODE_PREFIX: Record<TabKey, string> = {
  roomTypes: 'RM',
  meetingHalls: 'MH',
  wellnessTypes: 'WL',
  mealTypes: 'MTL',
};
function generateCode(tab: TabKey, existing: { code?: string }[]): string {
  const prefix = CODE_PREFIX[tab];
  let maxNum = 0;
  existing.forEach(r => {
    const m = (r.code || '').match(new RegExp(`^${prefix}(\\d+)$`));
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  });
  return `${prefix}${String(maxNum + 1).padStart(3, '0')}`;
}

// ================================================
// 会话内缓存（sessionStorage）
// ================================================
const CACHE_KEY = 'biz_config_cache_v1';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟

type CacheData = {
  roomTypes?: RoomTypeRow[];
  meetingHalls?: MeetingHallRow[];
  wellnessTypes?: WellnessTypeRow[];
  mealTypes?: MealTypeRow[];
  cachedAt: number;
};

function readCache(): Partial<CacheData> | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as CacheData;
    if (!data.cachedAt || Date.now() - data.cachedAt > CACHE_TTL_MS) return null;
    return data;
  } catch { return null; }
}
function writeCache(patch: Partial<CacheData>) {
  try {
    const cur = readCache() || {};
    const next: CacheData = { ...cur, ...patch, cachedAt: Date.now() };
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(next));
  } catch { /* 忽略 storage 失败 */ }
}
function clearCache() {
  try { sessionStorage.removeItem(CACHE_KEY); } catch {}
}

// Tab → 依赖的数据组（packages 需要 checkupItems 作为下拉选项）
const TAB_LOADERS: Record<TabKey, TabKey[]> = {
  roomTypes:    ['roomTypes'],
  meetingHalls: ['meetingHalls'],
  wellnessTypes:['wellnessTypes'],
  mealTypes:    ['mealTypes'],
};
const TAB_NAME_MAP: Record<TabKey, string> = {
  roomTypes: '房型',
  meetingHalls: '会议厅',
  wellnessTypes: '康乐项目',
  mealTypes: '用餐标准',
};

export default function BizConfigModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<TabKey>('roomTypes');
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState<Record<TabKey, boolean>>({
    roomTypes: false, meetingHalls: false, wellnessTypes: false, mealTypes: false,
  });

  // 4 类数据
  const [roomTypes, setRoomTypes] = useState<RoomTypeRow[]>([]);
  const [meetingHalls, setMeetingHalls] = useState<MeetingHallRow[]>([]);
  const [wellnessTypes, setWellnessTypes] = useState<WellnessTypeRow[]>([]);
  const [mealTypes, setMealTypes] = useState<MealTypeRow[]>([]);

  // 编辑/新增表单
  const [editing, setEditing] = useState<
    | { mode: 'create' | 'update'; data: any }
    | null
  >(null);

  // 自定义确认弹窗
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    confirmColor?: string;
    onConfirm: () => void | Promise<void>;
  } | null>(null);

  const bumpEditing = () => {
    setEditing(prev => prev ? { ...prev } : null);
  };

  // 根据 key 写本地 state + cache
  function setStateAndCache<K extends TabKey>(key: K, data: any[]) {
    switch (key) {
      case 'roomTypes':    setRoomTypes(data as RoomTypeRow[]);    writeCache({ roomTypes: data as RoomTypeRow[] }); break;
      case 'meetingHalls': setMeetingHalls(data as MeetingHallRow[]); writeCache({ meetingHalls: data as MeetingHallRow[] }); break;
      case 'wellnessTypes':setWellnessTypes(data as WellnessTypeRow[]); writeCache({ wellnessTypes: data as WellnessTypeRow[] }); break;
      case 'mealTypes':    setMealTypes(data as MealTypeRow[]); writeCache({ mealTypes: data as MealTypeRow[] }); break;
    }
  }

  async function loadTabGroup(targetKeys: TabKey[], force = false) {
    const cache = readCache();
    const needLoad: TabKey[] = [];
    targetKeys.forEach(k => {
      // 如果缓存有数据 & 非强制，用缓存
      const cached = cache?.[k];
      if (!force && cached && Array.isArray(cached) && cached.length >= 0) {
        setStateAndCache(k, cached);
      } else {
        needLoad.push(k);
      }
    });
    if (!needLoad.length) return;

    // 设置 loading
    setLoading(prev => {
      const next = { ...prev };
      needLoad.forEach(k => { next[k] = true; });
      return next;
    });
    try {
      // 并行加载需要的 keys（allSettled：单路失败不影响其他）
      const promises = needLoad.map(async k => {
        let data: any[];
        switch (k) {
          case 'roomTypes':    data = await bookingApi.listRoomTypes(); break;
          case 'meetingHalls': data = await bookingApi.listMeetingHalls(); break;
          case 'wellnessTypes':data = await bookingApi.listWellnessTypes(); break;
          case 'mealTypes':    data = await bookingApi.listMealTypes(); break;
        }
        return { k, data };
      });
      const results = await Promise.allSettled(promises);
      const failed: string[] = [];
      results.forEach((res, i) => {
        if (res.status === 'fulfilled') {
          const { k, data } = res.value;
          // 仅 data 为数组时写入，防止异常响应覆盖 state
          if (Array.isArray(data)) {
            setStateAndCache(k, data);
          } else {
            failed.push(`${TAB_NAME_MAP[k]}（响应格式异常）`);
          }
        } else {
          failed.push(TAB_NAME_MAP[needLoad[i]] + '（' + (res.reason?.message || '请求失败') + '）');
        }
      });
      if (failed.length > 0) {
        toast.error('部分配置加载失败：' + failed.join('；'));
      }
    } catch (e) {
      toast.error('加载业务常量失败：' + (e as Error).message);
    } finally {
      setLoading(prev => {
        const next = { ...prev };
        needLoad.forEach(k => { next[k] = false; });
        return next;
      });
    }
  }

  // 弹窗打开：初始化缓存（会话级第一次打开时用缓存，否则按当前 tab 懒加载）
  useEffect(() => {
    if (open) {
      // 从缓存恢复已有的数据，避免闪烁
      const cache = readCache();
      if (cache?.roomTypes) setRoomTypes(cache.roomTypes);
      if (cache?.meetingHalls) setMeetingHalls(cache.meetingHalls);
      if (cache?.wellnessTypes) setWellnessTypes(cache.wellnessTypes);
      if (cache?.mealTypes) setMealTypes(cache.mealTypes);
      setEditing(null);
      // 再触发当前 tab 对应 group 的加载（有缓存则直接 return，否则网络拉取）
      loadTabGroup(TAB_LOADERS[tab], false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Tab 切换：加载对应 group
  useEffect(() => {
    if (!open) return;
    loadTabGroup(TAB_LOADERS[tab], false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, open]);

  // ========== 通用增删改 ==========
  // 编码唯一性校验
  function checkCodeUnique(tabKey: TabKey, code: string, excludeId?: string | number): boolean {
    if (!code) return true;
    const list = tabKey === 'roomTypes' ? roomTypes
      : tabKey === 'meetingHalls' ? meetingHalls
      : tabKey === 'wellnessTypes' ? wellnessTypes
      : mealTypes;
    return !list.some(r => r.code === code && String(r.id) !== String(excludeId));
  }

  async function handleSave(
    apiFn: () => Promise<any>,
    onSuccess: () => void = () => {},
    affectedTabs: TabKey[] = [tab],
  ) {
    setSaving(true);
    try {
      await apiFn();
      // 先 reload 强制从服务器拉；loadTabGroup 内部已会 setStateAndCache
      await loadTabGroup(Array.from(new Set([...affectedTabs, ...TAB_LOADERS[tab]])), true);
      // reload 成功后再清全局缓存，避免中途失败导致缓存/state 双空白
      clearCache();
      setEditing(null);
      onSuccess();
    } catch (e) {
      toast.error('保存失败：' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(
    apiFn: () => Promise<any>,
    confirmMsg: string,
    affectedTabs: TabKey[] = [tab],
  ) {
    setConfirmDialog({
      open: true,
      title: '确认操作',
      message: confirmMsg,
      confirmText: '确定',
      cancelText: '取消',
      confirmColor: 'red',
      onConfirm: async () => {
        try {
          await apiFn();
          // 先 reload 成功再清缓存，避免中途失败导致缓存/state 双空白
          await loadTabGroup(Array.from(new Set([...affectedTabs, ...TAB_LOADERS[tab]])), true);
          clearCache();
        } catch (e) {
          toast.error('删除失败：' + (e as Error).message);
        }
      },
    });
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
          {TABS.map(t => {
            const isLoading = loading[t.key];
            return (
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
                <span className="inline-flex items-center gap-1.5">
                  {isLoading && (
                    <span className="inline-block w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                  )}
                  {t.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {(tab === 'roomTypes' || tab === 'meetingHalls' || tab === 'wellnessTypes' || tab === 'mealTypes') && loading[tab] && (
            <div className="text-center py-10 text-gray-500 text-sm bg-white rounded-lg border border-dashed border-gray-200">
              <span className="inline-block w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin mr-2 align-middle" />
              加载中...
            </div>
          )}

          {tab === 'roomTypes' && !loading.roomTypes && (
            <RoomTypesTable
              rows={roomTypes}
              editing={editing?.mode ? editing : null}
              bumpEditing={bumpEditing}
              onNew={() => setEditing({ mode: 'create', data: { ...DEFAULT_ROOM, code: generateCode('roomTypes', roomTypes) } })}
              onEdit={(r) => setEditing({ mode: 'update', data: { ...r } })}
              onCancel={() => setEditing(null)}
              onSave={(d) => {
                const data = d as Partial<RoomTypeRow>;
                if (data.code && !checkCodeUnique('roomTypes', data.code, data.id)) {
                  toast.error(`编码「${data.code}」已存在，请使用其他编码`);
                  return;
                }
                if ((editing as any)?.mode === 'update' && data.id) {
                  handleSave(() => bookingApi.updateRoomType(data.id!, data), () => {}, ['roomTypes']);
                } else {
                  handleSave(() => bookingApi.createRoomType(data), () => {}, ['roomTypes']);
                }
              }}
              onDel={(r) => handleDelete(
                () => bookingApi.deleteRoomType(r.id),
                `确定禁用房型「${r.name}」吗？`,
                ['roomTypes'],
              )}
              saving={saving}
            />
          )}

          {tab === 'meetingHalls' && !loading.meetingHalls && (
            <MeetingHallsTable
              rows={meetingHalls}
              editing={editing?.mode ? editing : null}
              bumpEditing={bumpEditing}
              onNew={() => setEditing({ mode: 'create', data: { ...DEFAULT_HALL, code: generateCode('meetingHalls', meetingHalls) } })}
              onEdit={(r) => setEditing({ mode: 'update', data: { ...r } })}
              onCancel={() => setEditing(null)}
              onSave={(d) => {
                const data = d as Partial<MeetingHallRow>;
                if (data.code && !checkCodeUnique('meetingHalls', data.code, data.id)) {
                  toast.error(`编码「${data.code}」已存在，请使用其他编码`);
                  return;
                }
                if ((editing as any)?.mode === 'update' && data.id) {
                  handleSave(() => bookingApi.updateMeetingHall(data.id!, data), () => {}, ['meetingHalls']);
                } else {
                  handleSave(() => bookingApi.createMeetingHall(data), () => {}, ['meetingHalls']);
                }
              }}
              onDel={(r) => handleDelete(
                () => bookingApi.deleteMeetingHall(r.id),
                `确定禁用会议厅「${r.name}」吗？`,
                ['meetingHalls'],
              )}
              saving={saving}
            />
          )}

          {tab === 'wellnessTypes' && !loading.wellnessTypes && (
            <WellnessTypesTable
              rows={wellnessTypes}
              editing={editing?.mode ? editing : null}
              bumpEditing={bumpEditing}
              onNew={() => setEditing({ mode: 'create', data: { ...DEFAULT_WELL, code: generateCode('wellnessTypes', wellnessTypes) } })}
              onEdit={(r) => setEditing({ mode: 'update', data: { ...r } })}
              onCancel={() => setEditing(null)}
              onSave={(d) => {
                const data = d as Partial<WellnessTypeRow>;
                if (data.code && !checkCodeUnique('wellnessTypes', data.code, data.id)) {
                  toast.error(`编码「${data.code}」已存在，请使用其他编码`);
                  return;
                }
                if ((editing as any)?.mode === 'update' && data.id) {
                  handleSave(() => bookingApi.updateWellnessType(data.id!, data), () => {}, ['wellnessTypes']);
                } else {
                  handleSave(() => bookingApi.createWellnessType(data), () => {}, ['wellnessTypes']);
                }
              }}
              onDel={(r) => handleDelete(
                () => bookingApi.deleteWellnessType(r.id),
                `确定禁用康乐项目「${r.name}」吗？`,
                ['wellnessTypes'],
              )}
              saving={saving}
            />
          )}

          {tab === 'mealTypes' && !loading.mealTypes && (
            <MealTypesTable
              rows={mealTypes}
              editing={editing?.mode ? editing : null}
              bumpEditing={bumpEditing}
              onNew={() => setEditing({ mode: 'create', data: { ...DEFAULT_MEAL, code: generateCode('mealTypes', mealTypes) } })}
              onEdit={(r) => setEditing({ mode: 'update', data: { ...r } })}
              onCancel={() => setEditing(null)}
              onSave={(d) => {
                const data = d as Partial<MealTypeRow>;
                if (data.code && !checkCodeUnique('mealTypes', data.code, data.id)) {
                  toast.error(`编码「${data.code}」已存在，请使用其他编码`);
                  return;
                }
                if ((editing as any)?.mode === 'update' && data.id) {
                  handleSave(() => bookingApi.updateMealType(data.id!, data), () => {}, ['mealTypes']);
                } else {
                  handleSave(() => bookingApi.createMealType(data), () => {}, ['mealTypes']);
                }
              }}
              onDel={(r) => handleDelete(
                () => bookingApi.deleteMealType(r.id),
                `确定禁用用餐标准「${r.name}」吗？`,
                ['mealTypes'],
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

      {/* 自定义确认弹窗 */}
      {confirmDialog && confirmDialog.open && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center" onClick={() => setConfirmDialog(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-900">
                {confirmDialog.title}
              </h3>
            </div>
            <div className="px-5 py-4">
              <div className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">
                {confirmDialog.message}
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex justify-end gap-2">
              <button
                onClick={() => setConfirmDialog(null)}
                className="px-4 py-1.5 text-sm rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
              >
                {confirmDialog.cancelText || '取消'}
              </button>
              <button
                onClick={async () => {
                  const fn = confirmDialog.onConfirm;
                  setConfirmDialog(null);
                  try {
                    await fn();
                  } catch (e) {
                    // 错误由 onConfirm 内部处理
                  }
                }}
                className={`px-4 py-1.5 text-sm rounded-lg text-white font-medium ${
                  confirmDialog.confirmColor === 'red'
                    ? 'bg-red-500 hover:bg-red-600'
                    : confirmDialog.confirmColor === 'yellow'
                      ? 'bg-yellow-500 hover:bg-yellow-600'
                      : 'bg-green-500 hover:bg-green-600'
                }`}
              >
                {confirmDialog.confirmText || '确定'}
              </button>
            </div>
          </div>
        </div>
      )}
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
  bumpEditing: () => void;
}

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

// 体检套餐与体检项目相关表格组件已从 BizConfigModal 移除，
// 统一迁移至 /pages/CheckupCenter 独立页面管理。

// ============================================================
// 房型表
// ============================================================
function RoomTypesTable(props: TableProps<RoomTypeRow>) {
  const { rows, editing, onNew, onEdit, onCancel, onSave, onDel, saving, bumpEditing } = props;
  const isCreating = editing?.mode === 'create';
  const isEditingThis = (r: RoomTypeRow) => editing?.mode === 'update' && editing.data.id === r.id;
  const setField = (k: string, v: any) => {
    if (editing) {
      editing.data[k] = v;
      bumpEditing();
    }
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
  const { rows, editing, onNew, onEdit, onCancel, onSave, onDel, saving, bumpEditing } = props;
  const isCreating = editing?.mode === 'create';
  const isEditingThis = (r: MeetingHallRow) => editing?.mode === 'update' && editing.data.id === r.id;
  const setField = (k: string, v: any) => {
    if (editing) {
      editing.data[k] = v;
      bumpEditing();
    }
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
  const { rows, editing, onNew, onEdit, onCancel, onSave, onDel, saving, bumpEditing } = props;
  const isCreating = editing?.mode === 'create';
  const isEditingThis = (r: WellnessTypeRow) => editing?.mode === 'update' && editing.data.id === r.id;
  const setField = (k: string, v: any) => {
    if (editing) {
      editing.data[k] = v;
      bumpEditing();
    }
  };

  const PricingModeSelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <select
      value={value || 'per_hour'}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-white border border-gray-300 rounded px-1.5 py-1 text-gray-900 text-xs focus:outline-none focus:border-green-500"
    >
      <option value="per_hour">按小时</option>
      <option value="package">套餐一口价</option>
    </select>
  );

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
              <th className="px-2 py-2 text-left font-medium w-24">编码</th>
              <th className="px-2 py-2 text-left font-medium">名称</th>
              <th className="px-2 py-2 text-center font-medium w-20">计费模式</th>
              <th className="px-2 py-2 text-center font-medium w-16">时长</th>
              <th className="px-2 py-2 text-center font-medium w-20">最少h</th>
              <th className="px-2 py-2 text-right font-medium w-20">入住价¥</th>
              <th className="px-2 py-2 text-right font-medium w-20">不住宿¥</th>
              <th className="px-2 py-2 text-center font-medium w-24">时段</th>
              <th className="px-2 py-2 text-center font-medium w-14">免费</th>
              <th className="px-2 py-2 text-center font-medium w-14">排序</th>
              <th className="px-2 py-2 text-center font-medium w-14">状态</th>
              <th className="px-2 py-2 text-center font-medium w-32">操作</th>
            </tr>
          </thead>
          <tbody>
            {isCreating && (
              <tr className="bg-amber-50/50 border-b border-gray-100">
                <td className="px-2 py-1.5"><Upd value={editing!.data.code} onChange={(v) => setField('code', v)} /></td>
                <td className="px-2 py-1.5"><Upd value={editing!.data.name} onChange={(v) => setField('name', v)} /></td>
                <td className="px-2 py-1.5"><PricingModeSelect value={editing!.data.pricing_mode || 'per_hour'} onChange={(v) => setField('pricing_mode', v)} /></td>
                <td className="px-2 py-1.5 text-center"><Upd type="number" placeholder="套餐h" value={editing!.data.package_hours} onChange={(v) => setField('package_hours', v)} /></td>
                <td className="px-2 py-1.5 text-center"><Upd type="number" value={editing!.data.min_hours} onChange={(v) => setField('min_hours', v)} /></td>
                <td className="px-2 py-1.5"><Upd type="number" step="0.01" value={editing!.data.price_guest} onChange={(v) => setField('price_guest', v)} /></td>
                <td className="px-2 py-1.5"><Upd type="number" step="0.01" value={editing!.data.price_external} onChange={(v) => setField('price_external', v)} /></td>
                <td className="px-2 py-1.5"><Upd placeholder="如06:00-18:00" value={editing!.data.time_window || ''} onChange={(v) => setField('time_window', v)} /></td>
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
              const isPkg = (r.pricing_mode || 'per_hour') === 'package';
              return (
                <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50/50">
                  <td className="px-2 py-2 font-mono">{editRow ? <Upd value={editing!.data.code} onChange={(v) => setField('code', v)} /> : <span className="font-semibold">{r.code}</span>}</td>
                  <td className="px-2 py-2">{editRow ? <Upd value={editing!.data.name} onChange={(v) => setField('name', v)} /> : r.name}</td>
                  <td className="px-2 py-2 text-center">{editRow
                    ? <PricingModeSelect value={editing!.data.pricing_mode || 'per_hour'} onChange={(v) => setField('pricing_mode', v)} />
                    : isPkg ? <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-100 text-amber-600 font-medium">套餐</span> : <span className="px-1.5 py-0.5 rounded text-[10px] bg-sky-100 text-sky-600 font-medium">按小时</span>}
                  </td>
                  <td className="px-2 py-2 text-center font-mono">{editRow
                    ? <Upd type="number" value={editing!.data.package_hours} onChange={(v) => setField('package_hours', v)} />
                    : (isPkg && r.package_hours) ? `${r.package_hours}h` : '—'}</td>
                  <td className="px-2 py-2 text-center font-mono">{editRow
                    ? <Upd type="number" value={editing!.data.min_hours} onChange={(v) => setField('min_hours', v)} />
                    : r.min_hours || 0}</td>
                  <td className="px-2 py-2 text-right font-mono">{editRow
                    ? <Upd type="number" step="0.01" value={editing!.data.price_guest} onChange={(v) => setField('price_guest', v)} />
                    : `¥${Number(r.price_guest ?? r.price).toLocaleString()}`}</td>
                  <td className="px-2 py-2 text-right font-mono">{editRow
                    ? <Upd type="number" step="0.01" value={editing!.data.price_external} onChange={(v) => setField('price_external', v)} />
                    : `¥${Number(r.price_external ?? r.price).toLocaleString()}`}</td>
                  <td className="px-2 py-2 text-center font-mono text-gray-500">{editRow
                    ? <Upd placeholder="如06:00-18:00" value={editing!.data.time_window || ''} onChange={(v) => setField('time_window', v)} />
                    : r.time_window || '—'}</td>
                  <td className="px-2 py-2 text-center">
                    {editRow ? <Checkbox value={editing!.data.is_free} onChange={(v) => setField('is_free', v)} />
                             : Number(r.is_free) === 1 ? <span className="text-emerald-600 font-medium">免费</span> : <span className="text-gray-500">收费</span>}
                  </td>
                  <td className="px-2 py-2 text-center">{editRow ? <Upd type="number" value={editing!.data.sort_order} onChange={(v) => setField('sort_order', v)} /> : r.sort_order}</td>
                  <td className="px-2 py-2 text-center">
                    {editRow ? <Checkbox value={editing!.data.status} onChange={(v) => setField('status', v)} />
                             : r.status === 1 ? <span className="text-green-600">● 启用</span> : <span className="text-gray-400">● 禁用</span>}
                  </td>
                  <td className="px-2 py-2 text-center space-x-1">
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

function MealTypesTable(props: TableProps<MealTypeRow>) {
  const { rows, editing, onNew, onEdit, onCancel, onSave, onDel, saving, bumpEditing } = props;
  const isCreating = editing?.mode === 'create';
  const isEditingThis = (r: MealTypeRow) => editing?.mode === 'update' && editing.data.id === r.id;
  const setField = (k: string, v: any) => {
    if (editing) {
      editing.data[k] = v;
      bumpEditing();
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600">共 {rows.length} 条配置，其中 <span className="text-red-600 font-medium">{rows.filter(r => r.status === 1).length}</span> 条启用</div>
        {!editing && <button onClick={onNew} className={btnGold}><Plus size={12}/> 新增用餐标准</button>}
      </div>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium w-24">编码</th>
              <th className="px-3 py-2 text-left font-medium">名称</th>
              <th className="px-3 py-2 text-center font-medium w-20">计价模式</th>
              <th className="px-3 py-2 text-right font-medium w-24">单价</th>
              <th className="px-3 py-2 text-center font-medium w-20">默认时间</th>
              <th className="px-3 py-2 text-center font-medium w-16">默认桌数</th>
              <th className="px-3 py-2 text-center font-medium w-16">每桌人数</th>
              <th className="px-3 py-2 text-center font-medium w-16">默认人数</th>
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
                <td className="px-2 py-1.5 text-center">
                  <select value={editing!.data.pricing_mode} onChange={(e) => setField('pricing_mode', e.target.value)} className="w-full border border-gray-300 rounded px-1 py-1 text-xs">
                    <option value="per_table">按桌</option>
                    <option value="per_person">按人</option>
                  </select>
                </td>
                <td className="px-2 py-1.5"><Upd type="number" step="0.01" value={editing!.data.unit_price} onChange={(v) => setField('unit_price', v)} /></td>
                <td className="px-2 py-1.5"><Upd value={editing!.data.default_time} onChange={(v) => setField('default_time', v)} /></td>
                <td className="px-2 py-1.5 text-center"><Upd type="number" value={editing!.data.default_tables} onChange={(v) => setField('default_tables', v)} /></td>
                <td className="px-2 py-1.5 text-center"><Upd type="number" value={editing!.data.default_per_table} onChange={(v) => setField('default_per_table', v)} /></td>
                <td className="px-2 py-1.5 text-center"><Upd type="number" value={editing!.data.default_pax} onChange={(v) => setField('default_pax', v)} /></td>
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
                  <td className="px-3 py-2 text-center">
                    {editRow ? (
                      <select value={editing!.data.pricing_mode} onChange={(e) => setField('pricing_mode', e.target.value)} className="w-full border border-gray-300 rounded px-1 py-1 text-xs">
                        <option value="per_table">按桌</option>
                        <option value="per_person">按人</option>
                      </select>
                    ) : (
                      <span className={r.pricing_mode === 'per_person' ? 'text-blue-600' : 'text-purple-600'}>
                        {r.pricing_mode === 'per_person' ? '按人' : '按桌'}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {editRow ? <Upd type="number" step="0.01" value={editing!.data.unit_price} onChange={(v) => setField('unit_price', v)} />
                             : `¥${Number(r.unit_price).toLocaleString()}/${r.pricing_mode === 'per_person' ? '人' : '桌'}`}
                  </td>
                  <td className="px-3 py-2 text-center font-mono">{editRow ? <Upd value={editing!.data.default_time} onChange={(v) => setField('default_time', v)} /> : r.default_time}</td>
                  <td className="px-3 py-2 text-center font-mono">{editRow ? <Upd type="number" value={editing!.data.default_tables} onChange={(v) => setField('default_tables', v)} /> : r.default_tables}</td>
                  <td className="px-3 py-2 text-center font-mono">{editRow ? <Upd type="number" value={editing!.data.default_per_table} onChange={(v) => setField('default_per_table', v)} /> : r.default_per_table}</td>
                  <td className="px-3 py-2 text-center font-mono">{editRow ? <Upd type="number" value={editing!.data.default_pax} onChange={(v) => setField('default_pax', v)} /> : r.default_pax}</td>
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