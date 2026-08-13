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

// ================================================
// 编码自动生成（按类型前缀 + 3位序号）
// ================================================
const CODE_PREFIX: Record<TabKey, string> = {
  packages: 'PKG',
  checkupItems: 'CI',
  roomTypes: 'RM',
  meetingHalls: 'MH',
  wellnessTypes: 'WL',
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
  packages?: PackageRow[];
  checkupItems?: CheckupItemRow[];
  roomTypes?: RoomTypeRow[];
  meetingHalls?: MeetingHallRow[];
  wellnessTypes?: WellnessTypeRow[];
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
  packages:     ['packages', 'checkupItems'],
  checkupItems: ['checkupItems'],
  roomTypes:    ['roomTypes'],
  meetingHalls: ['meetingHalls'],
  wellnessTypes:['wellnessTypes'],
};

export default function BizConfigModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<TabKey>('packages');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState<Record<TabKey, boolean>>({
    packages: false, checkupItems: false, roomTypes: false, meetingHalls: false, wellnessTypes: false,
  });

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
      case 'packages':     setPackages(data as PackageRow[]);     writeCache({ packages: data as PackageRow[] }); break;
      case 'checkupItems': setCheckupItems(data as CheckupItemRow[]); writeCache({ checkupItems: data as CheckupItemRow[] }); break;
      case 'roomTypes':    setRoomTypes(data as RoomTypeRow[]);    writeCache({ roomTypes: data as RoomTypeRow[] }); break;
      case 'meetingHalls': setMeetingHalls(data as MeetingHallRow[]); writeCache({ meetingHalls: data as MeetingHallRow[] }); break;
      case 'wellnessTypes':setWellnessTypes(data as WellnessTypeRow[]); writeCache({ wellnessTypes: data as WellnessTypeRow[] }); break;
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
      // 并行加载需要的 keys
      const promises = needLoad.map(async k => {
        let data: any[];
        switch (k) {
          case 'packages':     data = await bookingApi.listPackages(); break;
          case 'checkupItems': data = await bookingApi.listCheckupItems(); break;
          case 'roomTypes':    data = await bookingApi.listRoomTypes(); break;
          case 'meetingHalls': data = await bookingApi.listMeetingHalls(); break;
          case 'wellnessTypes':data = await bookingApi.listWellnessTypes(); break;
        }
        return { k, data };
      });
      const results = await Promise.all(promises);
      results.forEach(({ k, data }) => setStateAndCache(k, data || []));
    } catch (e) {
      alert('加载业务常量失败：' + (e as Error).message);
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
      if (cache?.packages) setPackages(cache.packages);
      if (cache?.checkupItems) setCheckupItems(cache.checkupItems);
      if (cache?.roomTypes) setRoomTypes(cache.roomTypes);
      if (cache?.meetingHalls) setMeetingHalls(cache.meetingHalls);
      if (cache?.wellnessTypes) setWellnessTypes(cache.wellnessTypes);
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
  function checkCodeUnique(tabKey: TabKey, code: string, excludeId?: number): boolean {
    if (!code) return true;
    const list = tabKey === 'packages' ? packages
      : tabKey === 'checkupItems' ? checkupItems
      : tabKey === 'roomTypes' ? roomTypes
      : tabKey === 'meetingHalls' ? meetingHalls
      : wellnessTypes;
    return !list.some(r => r.code === code && r.id !== excludeId);
  }

  async function handleSave(
    apiFn: () => Promise<any>,
    onSuccess: () => void = () => {},
    affectedTabs: TabKey[] = [tab],
  ) {
    setSaving(true);
    try {
      await apiFn();
      clearCache(); // 保存后清除缓存，强制下次从服务器拉取
      await loadTabGroup(Array.from(new Set([...affectedTabs, ...TAB_LOADERS[tab]])), true);
      setEditing(null);
      onSuccess();
    } catch (e) {
      alert('保存失败：' + (e as Error).message);
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
          clearCache();
          await loadTabGroup(Array.from(new Set([...affectedTabs, ...TAB_LOADERS[tab]])), true);
        } catch (e) {
          alert('删除失败：' + (e as Error).message);
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
          {(tab === 'packages' || tab === 'checkupItems' || tab === 'roomTypes' || tab === 'meetingHalls' || tab === 'wellnessTypes') && loading[tab] && (
            <div className="text-center py-10 text-gray-500 text-sm bg-white rounded-lg border border-dashed border-gray-200">
              <span className="inline-block w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin mr-2 align-middle" />
              加载中...
            </div>
          )}
          {tab === 'packages' && !loading.packages && !loading.checkupItems && (
            <PackagesTable
              rows={packages}
              checkupItems={checkupItems}
              editing={editing?.mode ? editing : null}
              bumpEditing={bumpEditing}
              onNew={() => setEditing({ mode: 'create', data: { ...DEFAULT_PKG, code: generateCode('packages', packages), items: [] } })}
              onEdit={(r) => setEditing({ mode: 'update', data: { ...r, items: (r as any).items || [] } })}
              onCancel={() => setEditing(null)}
              onSave={(d) => {
                const data = d as any;
                if (data.code && !checkCodeUnique('packages', data.code, data.id)) {
                  alert(`编码「${data.code}」已存在，请使用其他编码`);
                  return;
                }
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
                    ['packages', 'checkupItems'],
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
                    ['packages'],
                  );
                }
              }}
              onDel={(r) => handleDelete(
                () => bookingApi.deletePackage(r.id),
                `确定禁用套餐「${r.name}」吗？禁用后订单下拉不会再显示它，已有订单不受影响。`,
                ['packages'],
              )}
              saving={saving}
            />
          )}

          {tab === 'checkupItems' && !loading.checkupItems && (
            <CheckupItemsTable
              rows={checkupItems}
              editing={editing?.mode ? editing : null}
              bumpEditing={bumpEditing}
              onNew={() => setEditing({ mode: 'create', data: { ...DEFAULT_CHECKUP, code: generateCode('checkupItems', checkupItems) } })}
              onEdit={(r) => setEditing({ mode: 'update', data: { ...r } })}
              onCancel={() => setEditing(null)}
              onSave={(d) => {
                const data = d as Partial<CheckupItemRow>;
                if (data.code && !checkCodeUnique('checkupItems', data.code, data.id)) {
                  alert(`编码「${data.code}」已存在，请使用其他编码`);
                  return;
                }
                if ((editing as any)?.mode === 'update' && data.id) {
                  handleSave(() => bookingApi.updateCheckupItem(data.id!, data), () => {}, ['checkupItems', 'packages']);
                } else {
                  handleSave(() => bookingApi.createCheckupItem(data), () => {}, ['checkupItems', 'packages']);
                }
              }}
              onDel={(r) => handleDelete(
                () => bookingApi.deleteCheckupItem(r.id),
                `确定禁用体检项目「${r.name}」吗？`,
                ['checkupItems', 'packages'],
              )}
              saving={saving}
            />
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
                  alert(`编码「${data.code}」已存在，请使用其他编码`);
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
                  alert(`编码「${data.code}」已存在，请使用其他编码`);
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
                  alert(`编码「${data.code}」已存在，请使用其他编码`);
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
      remark: '',
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
                    <th className="text-left font-medium py-1 px-2 w-32">备注</th>
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
                        <td className="py-1 px-2">
                          <Upd value={item.remark || ''} onChange={(v) => updateItemField(idx, 'remark', v)} placeholder="如：需空腹" />
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
                    <td colSpan={4} className="py-1.5 text-right font-medium text-gray-500">合计：</td>
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
  const { rows, editing, onNew, onEdit, onCancel, onSave, onDel, saving, bumpEditing } = props;
  const isCreating = editing?.mode === 'create';
  const isEditingThis = (r: CheckupItemRow) => editing?.mode === 'update' && editing.data.id === r.id;
  const setField = (k: string, v: any) => {
    if (editing) {
      editing.data[k] = v;
      bumpEditing();
    }
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