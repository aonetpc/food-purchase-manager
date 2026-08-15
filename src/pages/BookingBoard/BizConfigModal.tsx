import React, { useEffect, useState, useMemo } from 'react';
import { X, Plus, Trash2, Save, Settings, ChevronDown, Search, ClipboardPaste, AlertCircle, CheckCircle } from 'lucide-react';
import { bookingApi, type PackageRow, type PackageItemRow, type CheckupItemRow, type RoomTypeRow, type MeetingHallRow, type WellnessTypeRow, type MealTypeRow } from '../../lib/api';
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

type TabKey = 'packages' | 'checkupItems' | 'roomTypes' | 'meetingHalls' | 'wellnessTypes' | 'mealTypes';
const TABS: { key: TabKey; label: string; color: string }[] = [
  { key: 'packages',     label: '体检套餐', color: '#10b981' },
  { key: 'checkupItems', label: '体检项目', color: '#06b6d4' },
  { key: 'roomTypes',    label: '房型',     color: '#3b82f6' },
  { key: 'meetingHalls', label: '会议厅',   color: '#8b5cf6' },
  { key: 'wellnessTypes',label: '康乐项目', color: '#f59e0b' },
  { key: 'mealTypes',    label: '用餐标准', color: '#ef4444' },
];

// 新增默认值
const DEFAULT_PKG: Partial<PackageRow> = { code: '', name: '', price: 0, status: 1, sort_order: 100 };
const DEFAULT_ROOM: Partial<RoomTypeRow> = { code: '', name: '', price: 0, status: 1, sort_order: 100 };
const DEFAULT_HALL: Partial<MeetingHallRow> = { code: '', name: '', capacity: 20, half_price: 0, full_price: 0, status: 1, sort_order: 100 };
const DEFAULT_WELL: Partial<WellnessTypeRow> = { code: '', name: '', min_hours: 0, price: 0, is_free: 0, status: 1, sort_order: 100 };
const DEFAULT_MEAL: Partial<MealTypeRow> = { code: '', name: '', pricing_mode: 'per_table', unit_price: 0, default_time: '12:00', default_tables: 1, default_per_table: 10, default_pax: 0, status: 1, sort_order: 100 };
const CATEGORY_OPTIONS = ['化验', '专科', '功能检查', '影像'] as const;
const DEFAULT_CHECKUP: Partial<CheckupItemRow> = { code: '', name: '', item_type: 'item', category: '化验', description: '', default_price: 0, insurance_price: 0, unit: '次', status: 1, sort_order: 100, sub_item_ids: [] };

// ================================================
// 编码自动生成（按类型前缀 + 3位序号）
// ================================================
const CODE_PREFIX: Record<TabKey, string> = {
  packages: 'PKG',
  checkupItems: 'CI',
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
  packages?: PackageRow[];
  checkupItems?: CheckupItemRow[];
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
  packages:     ['packages', 'checkupItems'],
  checkupItems: ['checkupItems'],
  roomTypes:    ['roomTypes'],
  meetingHalls: ['meetingHalls'],
  wellnessTypes:['wellnessTypes'],
  mealTypes:    ['mealTypes'],
};

export default function BizConfigModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<TabKey>('packages');
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState<Record<TabKey, boolean>>({
    packages: false, checkupItems: false, roomTypes: false, meetingHalls: false, wellnessTypes: false, mealTypes: false,
  });

  // 6 类数据
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [checkupItems, setCheckupItems] = useState<CheckupItemRow[]>([]);
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
      case 'packages':     setPackages(data as PackageRow[]);     writeCache({ packages: data as PackageRow[] }); break;
      case 'checkupItems': setCheckupItems(data as CheckupItemRow[]); writeCache({ checkupItems: data as CheckupItemRow[] }); break;
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
      // 并行加载需要的 keys
      const promises = needLoad.map(async k => {
        let data: any[];
        switch (k) {
          case 'packages':     data = await bookingApi.listPackages(); break;
          case 'checkupItems': data = await bookingApi.listCheckupItems(); break;
          case 'roomTypes':    data = await bookingApi.listRoomTypes(); break;
          case 'meetingHalls': data = await bookingApi.listMeetingHalls(); break;
          case 'wellnessTypes':data = await bookingApi.listWellnessTypes(); break;
          case 'mealTypes':    data = await bookingApi.listMealTypes(); break;
        }
        return { k, data };
      });
      const results = await Promise.all(promises);
      results.forEach(({ k, data }) => setStateAndCache(k, data || []));
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
      if (cache?.packages) setPackages(cache.packages);
      if (cache?.checkupItems) setCheckupItems(cache.checkupItems);
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
  function checkCodeUnique(tabKey: TabKey, code: string, excludeId?: number): boolean {
    if (!code) return true;
    const list = tabKey === 'packages' ? packages
      : tabKey === 'checkupItems' ? checkupItems
      : tabKey === 'roomTypes' ? roomTypes
      : tabKey === 'meetingHalls' ? meetingHalls
      : tabKey === 'wellnessTypes' ? wellnessTypes
      : mealTypes;
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
          clearCache();
          await loadTabGroup(Array.from(new Set([...affectedTabs, ...TAB_LOADERS[tab]])), true);
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
          {(tab === 'packages' || tab === 'checkupItems' || tab === 'roomTypes' || tab === 'meetingHalls' || tab === 'wellnessTypes' || tab === 'mealTypes') && loading[tab] && (
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
                  toast.error(`编码「${data.code}」已存在，请使用其他编码`);
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
              onEdit={(r) => setEditing({ mode: 'update', data: { ...r, sub_item_ids: (r.sub_items || []).map(si => si.sub_item_id) } })}
              onCancel={() => setEditing(null)}
              onSave={(d) => {
                const data = d as Partial<CheckupItemRow>;
                if (data.code && !checkCodeUnique('checkupItems', data.code, data.id)) {
                  toast.error(`编码「${data.code}」已存在，请使用其他编码`);
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

// ============================================================
// 体检套餐表（含 items 子表）
// ============================================================
function PackagesTable(props: TableProps<PackageRow> & { checkupItems: CheckupItemRow[]; bumpEditing: () => void }) {
  const { rows, checkupItems, editing, onNew, onEdit, onCancel, onSave, onDel, saving } = props;

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
            {rows.map(r => {
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
          </tbody>
        </table>
      </div>

      {/* 套餐编辑弹窗 */}
      {editing && (
        <PackageEditorModal
          editing={editing}
          checkupItems={checkupItems}
          saving={saving}
          onSave={onSave}
          onCancel={onCancel}
        />
      )}
    </div>
  );
}

// ============================================================
// 批量粘贴解析弹窗（三段式匹配：精确 → 模糊 → 新建）
// ============================================================
type ParsedLine = {
  raw: string;
  name: string;
  remark: string;
  matchType: 'exact' | 'fuzzy' | 'none';
  matchedItem: CheckupItemRow | null;
  fuzzyCandidates: CheckupItemRow[];
  selectedItemId: string | null; // 用户在模糊匹配中手动选择的 item_id
  action: 'link' | 'create' | 'skip'; // link=引用已有, create=新建到项目库, skip=跳过
};

function PackageBatchPasteModal({
  checkupItems,
  existingItemIds,
  onClose,
  onConfirm,
}: {
  checkupItems: CheckupItemRow[];
  existingItemIds: string[]; // 套餐中已有的 item_id，避免重复添加
  onClose: () => void;
  onConfirm: (resolved: { item: CheckupItemRow; remark: string; isNew?: boolean }[]) => void;
}) {
  const [rawText, setRawText] = useState('');
  const [parsed, setParsed] = useState<ParsedLine[] | null>(null);
  const [parsing, setParsing] = useState(false);

  // 三段式匹配核心逻辑
  function doParse() {
    setParsing(true);
    const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
    const results: ParsedLine[] = lines.map(line => {
      // 解析格式：项目名 | 备注（支持 | 或 ｜ 全角）
      const parts = line.split(/\||｜/).map(s => s.trim());
      const name = parts[0] || '';
      const remark = parts[1] || '';

      if (!name) {
        return { raw: line, name: '', remark, matchType: 'none', matchedItem: null, fuzzyCandidates: [], selectedItemId: null, action: 'skip' };
      }

      // 阶段 1：精确匹配
      const exact = checkupItems.find(ci => ci.name === name && !existingItemIds.includes(ci.id));
      if (exact) {
        return { raw: line, name, remark, matchType: 'exact', matchedItem: exact, fuzzyCandidates: [], selectedItemId: exact.id, action: 'link' };
      }

      // 阶段 2：模糊匹配（名称包含关系）
      const fuzzy = checkupItems.filter(ci =>
        !existingItemIds.includes(ci.id) &&
        (ci.name.includes(name) || name.includes(ci.name))
      );

      if (fuzzy.length === 1) {
        // 只有一个模糊结果，自动选中
        return { raw: line, name, remark, matchType: 'fuzzy', matchedItem: fuzzy[0], fuzzyCandidates: fuzzy, selectedItemId: fuzzy[0].id, action: 'link' };
      }

      // 多个或零个模糊结果
      return {
        raw: line, name, remark,
        matchType: fuzzy.length > 0 ? 'fuzzy' : 'none',
        matchedItem: null,
        fuzzyCandidates: fuzzy,
        selectedItemId: null,
        action: fuzzy.length > 0 ? 'link' : 'create',
      };
    });
    setParsed(results);
    setParsing(false);
  }

  // 用户手动选择模糊匹配项
  function selectFuzzy(idx: number, itemId: string) {
    if (!parsed) return;
    const next = [...parsed];
    const item = checkupItems.find(ci => ci.id === itemId);
    next[idx] = { ...next[idx], selectedItemId: itemId, matchedItem: item || null, action: 'link' };
    setParsed(next);
  }

  // 用户切换操作类型（link/create/skip）
  function setAction(idx: number, action: 'link' | 'create' | 'skip') {
    if (!parsed) return;
    const next = [...parsed];
    next[idx] = { ...next[idx], action };
    setParsed(next);
  }

  // 统计
  const stats = useMemo(() => {
    if (!parsed) return { exact: 0, fuzzy: 0, create: 0, skip: 0, ready: 0 };
    return {
      exact: parsed.filter(p => p.matchType === 'exact').length,
      fuzzy: parsed.filter(p => p.matchType === 'fuzzy').length,
      create: parsed.filter(p => p.action === 'create').length,
      skip: parsed.filter(p => p.action === 'skip').length,
      ready: parsed.filter(p => p.action === 'link' && p.selectedItemId || p.action === 'create').length,
    };
  }, [parsed]);

  function handleConfirm() {
    if (!parsed) return;
    const resolved: { item: CheckupItemRow; remark: string; isNew?: boolean }[] = [];
    for (const p of parsed) {
      if (p.action === 'link' && p.selectedItemId) {
        const item = checkupItems.find(ci => ci.id === p.selectedItemId);
        if (item) resolved.push({ item, remark: p.remark });
      } else if (p.action === 'create' && p.name) {
        // 新建项目（临时对象，保存时后端会创建）
        resolved.push({
          item: {
            id: '',
            code: '',
            name: p.name,
            category: '化验',
            description: '',
            default_price: 0,
            unit: '次',
            status: 1,
            sort_order: 999,
          } as CheckupItemRow,
          remark: p.remark,
          isNew: true,
        });
      }
    }
    onConfirm(resolved);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-[800px] max-w-[95vw] max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <ClipboardPaste size={16} className="text-green-600" />
            <span className="text-sm font-medium text-gray-800">批量粘贴体检项目</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!parsed ? (
            /* 输入区 */
            <div className="space-y-3">
              <div className="text-xs text-gray-500 leading-relaxed">
                每行一个项目，格式：<span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded">项目名称</span>
                {' '}或<span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded">项目名称 | 备注</span>
                <br/>
                <span className="text-gray-400">分隔符支持 | 或 ｜（全角），示例：</span>
              </div>
              <pre className="text-[11px] text-gray-400 bg-gray-50 rounded-lg p-2 border border-gray-100">血常规
心电图 | 需空腹
腹部B超 | 女性专项
肿瘤标志物筛查</pre>
              <textarea
                value={rawText}
                onChange={e => setRawText(e.target.value)}
                placeholder="在此粘贴项目列表..."
                className={`${inputCls} font-mono text-xs h-48 resize-y`}
                autoFocus
              />
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-gray-400">{rawText.split('\n').filter(s => s.trim()).length} 行</span>
                <button
                  onClick={doParse}
                  disabled={!rawText.trim() || parsing}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs rounded-lg bg-green-500 text-white hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Search size={12}/> 解析并匹配
                </button>
              </div>
            </div>
          ) : (
            /* 解析结果区 */
            <div className="space-y-3">
              {/* 统计栏 */}
              <div className="flex items-center gap-4 text-xs">
                <span className="text-green-600 flex items-center gap-1"><CheckCircle size={12}/> 精确匹配 {stats.exact}</span>
                <span className="text-amber-600 flex items-center gap-1"><AlertCircle size={12}/> 模糊匹配 {stats.fuzzy}</span>
                <span className="text-cyan-600">将新建 {stats.create}</span>
                {stats.skip > 0 && <span className="text-gray-400">跳过 {stats.skip}</span>}
                <span className="ml-auto text-gray-500">共 {parsed.length} 项，{stats.ready} 项就绪</span>
              </div>

              {/* 结果表格 */}
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-gray-500">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium w-44">解析项目名</th>
                      <th className="px-3 py-2 text-left font-medium w-28">备注</th>
                      <th className="px-3 py-2 text-left font-medium">匹配结果</th>
                      <th className="px-3 py-2 text-center font-medium w-28">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.map((p, idx) => (
                      <tr key={idx} className="border-t border-gray-100">
                        <td className="px-3 py-2 font-medium text-gray-800">{p.name || <span className="text-red-400">（空行已跳过）</span>}</td>
                        <td className="px-3 py-2 text-gray-500">{p.remark || '-'}</td>
                        <td className="px-3 py-2">
                          {p.matchType === 'exact' && p.matchedItem && (
                            <span className="text-green-600 flex items-center gap-1">
                              <CheckCircle size={12}/> {p.matchedItem.name}（{p.matchedItem.code}）¥{p.matchedItem.default_price}
                            </span>
                          )}
                          {p.matchType === 'fuzzy' && (
                            <select
                              value={p.selectedItemId || ''}
                              onChange={e => selectFuzzy(idx, e.target.value)}
                              className={`${inputCls} text-xs !py-1`}
                            >
                              <option value="">— 请选择匹配项 —</option>
                              {p.fuzzyCandidates.map(ci => (
                                <option key={ci.id} value={ci.id}>{ci.name}（{ci.code}）¥{ci.default_price}</option>
                              ))}
                            </select>
                          )}
                          {p.matchType === 'none' && p.action === 'create' && (
                            <span className="text-cyan-600">将新建项目「{p.name}」</span>
                          )}
                          {p.matchType === 'none' && p.action !== 'create' && (
                            <span className="text-gray-400">无匹配</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <div className="inline-flex gap-1">
                            <button
                              onClick={() => setAction(idx, 'link')}
                              className={`px-2 py-0.5 rounded text-[10px] ${p.action === 'link' ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                            >引用</button>
                            <button
                              onClick={() => setAction(idx, 'create')}
                              className={`px-2 py-0.5 rounded text-[10px] ${p.action === 'create' ? 'bg-cyan-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                            >新建</button>
                            <button
                              onClick={() => setAction(idx, 'skip')}
                              className={`px-2 py-0.5 rounded text-[10px] ${p.action === 'skip' ? 'bg-gray-400 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                            >跳过</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 重新解析按钮 */}
              <button
                onClick={() => { setParsed(null); }}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                ← 返回重新粘贴
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        {parsed && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-200">
            <span className="text-xs text-gray-400">
              {stats.ready > 0 ? `${stats.ready} 项就绪待添加` : '没有可添加的项目'}
            </span>
            <div className="flex gap-2">
              <button onClick={onClose} className="px-4 py-1.5 text-xs rounded-lg bg-white hover:bg-gray-100 text-gray-700 border border-gray-200">取消</button>
              <button
                onClick={handleConfirm}
                disabled={stats.ready === 0}
                className="px-4 py-1.5 text-xs rounded-lg bg-green-500 text-white hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                确认添加 {stats.ready} 项
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// -------- 套餐编辑弹窗（双栏布局：左侧项目库胶囊块 + 右侧套餐明细） --------
function PackageEditorModal({
  editing,
  checkupItems,
  saving,
  onSave,
  onCancel,
}: {
  editing: { mode: 'create' | 'update'; data: any };
  checkupItems: CheckupItemRow[];
  saving: boolean;
  onSave: (d: any) => void;
  onCancel: () => void;
}) {
  const [data, setData] = useState<any>({ ...editing.data, items: [...(editing.data.items || [])] });
  const [pickerFilter, setPickerFilter] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);

  const items: PackageItemRow[] = data.items || [];
  const selectedItemIds = new Set(items.map(it => it.item_id));

  // 按分类分组的体检项目库
  const groupedItems = useMemo(() => {
    const active = checkupItems.filter(ci => ci.status === 1);
    const filtered = pickerFilter
      ? active.filter(ci => ci.name.includes(pickerFilter) || ci.code.includes(pickerFilter))
      : active;
    const groups: Record<string, CheckupItemRow[]> = {};
    filtered.forEach(ci => {
      const cat = ci.category || '其他';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(ci);
    });
    return groups;
  }, [checkupItems, pickerFilter]);

  function toggleItem(ci: CheckupItemRow) {
    if (selectedItemIds.has(ci.id)) {
      // 已选中 → 移除
      setData(prev => ({
        ...prev,
        items: (prev.items || []).filter((it: PackageItemRow) => it.item_id !== ci.id),
      }));
    } else {
      // 未选中 → 添加
      const newItem: PackageItemRow = {
        id: '',
        package_id: data.id || '',
        item_id: ci.id,
        item_name_snapshot: ci.name,
        item_price: ci.default_price || 0,
        quantity: 1,
        remark: '',
        sort_order: items.length * 10 + 10,
      };
      setData(prev => ({ ...prev, items: [...(prev.items || []), newItem] }));
    }
  }

  function removeItem(idx: number) {
    setData(prev => ({ ...prev, items: (prev.items || []).filter((_: any, i: number) => i !== idx) }));
  }

  function updateItemField(idx: number, field: string, value: any) {
    setData(prev => {
      const arr = [...(prev.items || [])];
      (arr[idx] as any)[field] = value;
      return { ...prev, items: arr };
    });
  }

  function setField(k: string, v: any) {
    setData(prev => ({ ...prev, [k]: v }));
  }

  // 批量粘贴确认回调
  function handlePasteConfirm(resolved: { item: CheckupItemRow; remark: string; isNew?: boolean }[]) {
    const baseSort = items.length * 10 + 10;
    const newItems: PackageItemRow[] = resolved.map((r, i) => ({
      id: '',
      package_id: data.id || '',
      item_id: r.item.id,
      item_name_snapshot: r.item.name,
      item_price: r.item.default_price || 0,
      quantity: 1,
      remark: r.remark,
      sort_order: baseSort + i * 10,
    }));
    setData(prev => ({ ...prev, items: [...(prev.items || []), ...newItems] }));
    setPasteOpen(false);
  }

  const autoTotal = items.reduce((s, i) => s + Number(i.item_price || 0) * Number(i.quantity || 1), 0);
  const itemCount = items.length;
  const categoryNames = Object.keys(groupedItems);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative bg-white rounded-xl border border-gray-200 shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* 头部：基本信息 */}
        <div className="px-5 py-3 border-b border-gray-200 shrink-0">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-base font-semibold text-gray-900">
              {editing.mode === 'create' ? '新增体检套餐' : '编辑体检套餐'}
            </h3>
            <button onClick={onCancel} className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-800">
              <X size={18} />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-1.5">
              <span className="text-gray-500">编码</span>
              <input value={data.code || ''} onChange={e => setField('code', e.target.value)} className={`${inputCls} !py-1 w-28`} />
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-gray-500">名称</span>
              <input value={data.name || ''} onChange={e => setField('name', e.target.value)} className={`${inputCls} !py-1 w-44`} />
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-gray-500">单价(¥)</span>
              <input type="number" step="0.01" value={data.price ?? 0} onChange={e => setField('price', e.target.value === '' ? '' : Number(e.target.value))} className={`${inputCls} !py-1 w-24`} />
              {autoTotal > 0 && Number(data.price || 0) === 0 && (
                <span className="text-[10px] text-cyan-500 whitespace-nowrap">自动 ¥{autoTotal.toLocaleString()}</span>
              )}
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-gray-500">排序</span>
              <input type="number" value={data.sort_order ?? 100} onChange={e => setField('sort_order', e.target.value === '' ? '' : Number(e.target.value))} className={`${inputCls} !py-1 w-16`} />
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={Number(data.status) === 1} onChange={e => setField('status', e.target.checked ? 1 : 0)} className="accent-green-500 w-4 h-4" />
              <span className="text-gray-500">启用</span>
            </label>
          </div>
        </div>

        {/* 双栏内容区 */}
        <div className="flex-1 overflow-hidden flex">
          {/* 左栏：体检项目库（胶囊块） */}
          <div className="w-3/5 border-r border-gray-200 flex flex-col">
            <div className="px-4 py-2 border-b border-gray-100 shrink-0">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-gray-700">📋 体检项目库</span>
                <span className="text-[11px] text-gray-400">点击胶囊添加 / 再次点击移除</span>
              </div>
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={pickerFilter}
                  onChange={e => setPickerFilter(e.target.value)}
                  placeholder="搜索项目名称或编码..."
                  className={`${inputCls} !py-1.5 !pl-8`}
                  autoFocus
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-2">
              {checkupItems.filter(ci => ci.status === 1).length === 0 ? (
                <div className="text-center py-8 text-xs text-gray-400">
                  暂无可用体检项目，请先到「体检项目」Tab 添加
                </div>
              ) : categoryNames.length === 0 ? (
                <div className="text-center py-8 text-xs text-gray-400">未找到匹配的项目</div>
              ) : (
                <div className="space-y-3">
                  {categoryNames.map(cat => (
                    <div key={cat}>
                      <div className="text-[11px] font-medium text-gray-400 mb-1.5 flex items-center gap-1">
                        <span className="inline-block w-1 h-3 rounded bg-green-400" />
                        {cat}
                        <span className="text-gray-300">({groupedItems[cat].length})</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {groupedItems[cat].map(ci => {
                          const selected = selectedItemIds.has(ci.id);
                          return (
                            <button
                              key={ci.id}
                              onClick={() => toggleItem(ci)}
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border transition-all ${
                                selected
                                  ? 'bg-green-500 text-white border-green-500 shadow-sm'
                                  : 'bg-white text-gray-700 border-gray-200 hover:border-green-300 hover:bg-green-50'
                              }`}
                              title={selected ? '点击移除' : '点击添加'}
                            >
                              <span className="font-medium">{ci.name}</span>
                              <span className={`text-[10px] font-mono ${selected ? 'text-green-100' : 'text-gray-400'}`}>¥{ci.default_price || 0}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 右栏：套餐明细 */}
          <div className="w-2/5 flex flex-col">
            <div className="px-4 py-2 border-b border-gray-100 shrink-0 flex items-center justify-between">
              <span className="text-xs font-medium text-gray-700">
                📦 套餐明细
                <span className="text-gray-400 ml-1">({itemCount} 项, ¥{autoTotal.toLocaleString()})</span>
              </span>
              <button
                onClick={() => setPasteOpen(true)}
                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-lg bg-white hover:bg-gray-100 text-gray-600 border border-gray-200 transition-colors"
              >
                <ClipboardPaste size={11} /> 批量粘贴
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-2">
              {itemCount === 0 ? (
                <div className="text-center py-12 text-xs text-gray-400">
                  <Plus size={28} className="mx-auto mb-2 text-gray-300" />
                  点击左侧项目添加到套餐
                </div>
              ) : (
                <table className="w-full text-[11px]">
                  <thead className="text-gray-400 sticky top-0 bg-white">
                    <tr>
                      <th className="text-left font-medium py-1 pr-1">项目名称</th>
                      <th className="text-right font-medium py-1 px-1 w-16">单价</th>
                      <th className="text-center font-medium py-1 px-1 w-12">数量</th>
                      <th className="text-left font-medium py-1 px-1 w-20">备注</th>
                      <th className="text-right font-medium py-1 px-1 w-14">小计</th>
                      <th className="w-6"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, idx) => {
                      const subtotal = Number(item.item_price || 0) * Number(item.quantity || 1);
                      return (
                        <tr key={idx} className="border-t border-gray-100">
                          <td className="py-1 pr-1 text-gray-700 font-medium">{item.item_name_snapshot}</td>
                          <td className="py-1 px-1">
                            <input
                              type="number"
                              step="0.01"
                              value={item.item_price ?? 0}
                              onChange={e => updateItemField(idx, 'item_price', e.target.value === '' ? '' : Number(e.target.value))}
                              className={`${inputCls} !py-0.5 !px-1 text-right w-14`}
                            />
                          </td>
                          <td className="py-1 px-1">
                            <input
                              type="number"
                              value={item.quantity ?? 1}
                              onChange={e => updateItemField(idx, 'quantity', e.target.value === '' ? '' : Number(e.target.value))}
                              className={`${inputCls} !py-0.5 !px-1 text-center w-12`}
                            />
                          </td>
                          <td className="py-1 px-1">
                            <input
                              value={item.remark || ''}
                              onChange={e => updateItemField(idx, 'remark', e.target.value)}
                              placeholder="如：需空腹"
                              className={`${inputCls} !py-0.5 !px-1 w-full`}
                            />
                          </td>
                          <td className="py-1 px-1 text-right font-mono text-gray-600">¥{subtotal.toLocaleString()}</td>
                          <td className="py-1 text-center">
                            <button
                              onClick={() => removeItem(idx)}
                              className="text-red-400 hover:text-red-600"
                              title="移除"
                            >
                              <Trash2 size={11} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-200">
                      <td colSpan={4} className="py-1.5 text-right font-medium text-gray-500">合计：</td>
                      <td className="py-1.5 text-right font-mono font-semibold text-green-600">¥{autoTotal.toLocaleString()}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* 底部操作栏 */}
        <div className="px-5 py-3 border-t border-gray-200 shrink-0 flex items-center justify-end gap-2">
          <button onClick={onCancel} className={btnGhost}>取消</button>
          <button
            onClick={() => onSave(data)}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs rounded-lg bg-green-500 hover:bg-green-600 text-white font-medium transition-colors disabled:opacity-50"
          >
            {saving ? '保存中...' : <><Save size={12} /> 保存套餐</>}
          </button>
        </div>

        {/* 批量粘贴弹窗 */}
        {pasteOpen && (
          <PackageBatchPasteModal
            checkupItems={checkupItems}
            existingItemIds={items.map(it => it.item_id)}
            onClose={() => setPasteOpen(false)}
            onConfirm={handlePasteConfirm}
          />
        )}
      </div>
    </div>
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

  // 可选的子项目列表（普通项目，排除自身）
  const availableSubItems = rows.filter(r => r.item_type !== 'combo' && r.status === 1);
  const currentEditingId = editing?.data?.id;

  // 切换子项目选中
  const toggleSubItem = (subId: string) => {
    if (!editing) return;
    const current = editing.data.sub_item_ids || [];
    if (current.includes(subId)) {
      setField('sub_item_ids', current.filter((id: string) => id !== subId));
    } else {
      setField('sub_item_ids', [...current, subId]);
    }
  };

  // 渲染子项目选择器（组合项目编辑时）
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
                className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${
                  checked
                    ? 'bg-cyan-500 text-white border-cyan-500'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-cyan-300'
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

  // 渲染类型标签
  function typeLabel(r: CheckupItemRow) {
    if (r.item_type === 'combo') {
      return <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded ml-1">组合</span>;
    }
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600">
          共 {rows.length} 条配置，其中 <span className="text-cyan-600 font-medium">{rows.filter(r => r.status === 1).length}</span> 条启用
          {rows.some(r => r.item_type === 'combo') && (
            <span className="ml-2 text-amber-600">（含 {rows.filter(r => r.item_type === 'combo').length} 个组合项目）</span>
          )}
        </div>
        {!editing && <button onClick={onNew} className={btnGold}><Plus size={12}/> 新增体检项目</button>}
      </div>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium w-20">编码</th>
              <th className="px-3 py-2 text-left font-medium">名称</th>
              <th className="px-3 py-2 text-left font-medium w-20">类型</th>
              <th className="px-3 py-2 text-left font-medium w-20">分类</th>
              <th className="px-3 py-2 text-right font-medium w-24">默认定价(¥)</th>
              <th className="px-3 py-2 text-right font-medium w-24">医保价格(¥)</th>
              <th className="px-3 py-2 text-center font-medium w-16">单位</th>
              <th className="px-3 py-2 text-center font-medium w-16">排序</th>
              <th className="px-3 py-2 text-center font-medium w-16">状态</th>
              <th className="px-3 py-2 text-center font-medium w-36">操作</th>
            </tr>
          </thead>
          <tbody>
            {isCreating && (
              <>
                <tr className="bg-cyan-50/50 border-b border-gray-100">
                  <td className="px-2 py-1.5"><Upd value={editing.data.code} onChange={(v) => setField('code', v)} /></td>
                  <td className="px-2 py-1.5"><Upd value={editing.data.name} onChange={(v) => setField('name', v)} /></td>
                  <td className="px-2 py-1.5">
                    <select
                      value={editing.data.item_type || 'item'}
                      onChange={(e) => setField('item_type', e.target.value)}
                      className={inputCls}
                    >
                      <option value="item">普通项目</option>
                      <option value="combo">组合项目</option>
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <select
                      value={editing.data.category || '其他'}
                      onChange={(e) => setField('category', e.target.value)}
                      className={inputCls}
                    >
                      {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1.5"><Upd type="number" step="0.01" value={editing.data.default_price} onChange={(v) => setField('default_price', v)} /></td>
                  <td className="px-2 py-1.5"><Upd type="number" step="0.01" value={editing.data.insurance_price ?? 0} onChange={(v) => setField('insurance_price', v)} /></td>
                  <td className="px-2 py-1.5"><Upd value={editing.data.unit} onChange={(v) => setField('unit', v)} /></td>
                  <td className="px-2 py-1.5"><Upd type="number" value={editing.data.sort_order} onChange={(v) => setField('sort_order', v)} /></td>
                  <td className="px-2 py-1.5 text-center"><Checkbox value={editing.data.status} onChange={(v) => setField('status', v)} /></td>
                  <td className="px-2 py-1.5 text-center space-x-1">
                    <RowBtn cls="!bg-green-500 !text-white !border-green-500 hover:!bg-green-600" onClick={() => onSave(editing.data)}>{saving ? '保存中' : <><Save size={10}/> 保存</>}</RowBtn>
                    <RowBtn onClick={onCancel}>取消</RowBtn>
                  </td>
                </tr>
                {renderSubItemPicker()}
              </>
            )}
            {rows.map(r => {
              const editRow = isEditingThis(r);
              return (
                <React.Fragment key={r.id}>
                  <tr className="border-t border-gray-100 hover:bg-gray-50/50">
                    <td className="px-3 py-2 font-mono">{editRow ? <Upd value={editing!.data.code} onChange={(v) => setField('code', v)} /> : <span className="font-semibold">{r.code}</span>}</td>
                    <td className="px-3 py-2">
                      {editRow ? <Upd value={editing!.data.name} onChange={(v) => setField('name', v)} /> : (
                        <span>
                          {r.name}
                          {typeLabel(r)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {editRow ? (
                        <select
                          value={editing!.data.item_type || 'item'}
                          onChange={(e) => setField('item_type', e.target.value)}
                          className={inputCls}
                        >
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
                        <select
                          value={editing!.data.category || '化验'}
                          onChange={(e) => setField('category', e.target.value)}
                          className={inputCls}
                        >
                          {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      ) : r.category}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{editRow ? <Upd type="number" step="0.01" value={editing!.data.default_price} onChange={(v) => setField('default_price', v)} /> : `¥${Number(r.default_price || 0).toLocaleString()}`}</td>
                    <td className="px-3 py-2 text-right font-mono text-indigo-600">{editRow ? <Upd type="number" step="0.01" value={editing!.data.insurance_price ?? 0} onChange={(v) => setField('insurance_price', v)} /> : `¥${Number(r.insurance_price || 0).toLocaleString()}`}</td>
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
                  {/* 编辑模式下的子项目选择器 */}
                  {editRow && renderSubItemPicker()}
                  {/* 非编辑模式：组合项目展示子项目列表 */}
                  {!editRow && r.item_type === 'combo' && r.sub_items && r.sub_items.length > 0 && (
                    <tr className="bg-amber-50/30 border-t-0">
                      <td colSpan={9} className="px-3 py-1.5">
                        <div className="flex flex-wrap gap-1">
                          <span className="text-[10px] text-gray-400">包含：</span>
                          {r.sub_items.map((si, i) => (
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