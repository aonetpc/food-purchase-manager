import { useEffect, useState } from 'react';
import { Plus, Copy, Trash2, Users, Search, Download, Shield, Eye } from 'lucide-react';
import { checkupApi, ROLES, ROLE_LABEL, ROLE_EMOJI, type CheckupTemplate } from './api';
import { useToast } from '@/components/Toast';
import { useAuthStore } from '@/store/authStore';
import { api } from '@/lib/api';
import PackageDrawer from './PackageDrawer';

type ScopeTab = 'all' | 'public';

const btnPrimary =
  'inline-flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg bg-gradient-to-r from-emerald-700 to-emerald-800 hover:from-emerald-800 hover:to-emerald-900 text-white font-medium shadow-sm transition-colors disabled:opacity-50';
const btnGhost =
  'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 transition-colors';
const btnDanger =
  'inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] rounded-lg bg-white hover:bg-red-50 text-red-500 border border-red-200 transition-colors';

interface SalesUser { id: string; name: string; username?: string; }

export default function PackagesTab() {
  const toast = useToast();
  const isAdmin = useAuthStore(s => s.isAdmin());
  const user = useAuthStore(s => s.user);
  const [scope, setScope] = useState<ScopeTab>(isAdmin ? 'public' : 'all');
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<CheckupTemplate[]>([]);
  const [salesUsers, setSalesUsers] = useState<SalesUser[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState<{ pkg: CheckupTemplate; selected: string[] } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await checkupApi.list({
        scope: scope === 'public' ? 'public' : undefined,
        keyword: keyword || undefined,
      });
      if (res?.ok) setList(res.data || []);
      else toast.error(res?.error || '加载失败');
    } catch (e: any) {
      toast.error(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const loadSalesUsers = async () => {
    try {
      const cfg: any = await api.get('/booking/config');
      setSalesUsers(cfg?.data?.salesUsers || []);
    } catch (_) { /* 忽略 */ }
  };

  useEffect(() => { load(); }, [scope]);
  useEffect(() => { if (isAdmin) loadSalesUsers(); }, [isAdmin]);

  const onSearch = () => { load(); };

  const onCreate = () => {
    setEditingId(null);
    setDrawerOpen(true);
  };

  const onEdit = (pkg: CheckupTemplate) => {
    setEditingId(pkg.id);
    setDrawerOpen(true);
  };

  const onClone = async (pkg: CheckupTemplate) => {
    const name = window.prompt('克隆为新套餐，请输入名称：', `${pkg.name} - 副本`);
    if (!name) return;
    try {
      const res = await checkupApi.clone(pkg.id, { name });
      if (res?.ok) {
        toast.success('克隆成功');
        await load();
        // 克隆后直接打开克隆出的新套餐进入编辑
        setEditingId(res.data?.id);
        setDrawerOpen(true);
      } else {
        toast.error(res?.error || '克隆失败');
      }
    } catch (e: any) {
      toast.error(e.message || '克隆失败');
    }
  };

  const onDelete = async (pkg: CheckupTemplate) => {
    if (!window.confirm(`确定要删除套餐「${pkg.name}」吗？此操作会清空该套餐的所有项目和价格方案。`)) return;
    try {
      const res: any = await api.delete(`/booking/checkup-templates/${pkg.id}`);
      if (res?.ok) {
        toast.success('已删除');
        await load();
      } else {
        toast.error(res?.error || '删除失败');
      }
    } catch (e: any) {
      toast.error(e.message || '删除失败');
    }
  };

  const onDownloadPdf = (pkg: CheckupTemplate) => {
    window.open(checkupApi.pdfUrl(pkg.id), '_blank');
  };

  // 打开分配给销售员弹窗
  const openAssign = (pkg: CheckupTemplate) => {
    const selected: string[] = Array.isArray((pkg as any).cover_sales_ids) ? (pkg as any).cover_sales_ids : [];
    setAssignOpen({ pkg, selected });
  };

  const handleAssignSave = async () => {
    if (!assignOpen) return;
    try {
      const res: any = await api.put(
        `/booking/checkup-templates/${assignOpen.pkg.id}/cover-sales`,
        { sales_ids: assignOpen.selected },
      );
      if (res?.ok) {
        toast.success('分配成功');
        setAssignOpen(null);
        await load();
      } else {
        toast.error(res?.error || '分配失败');
      }
    } catch (e: any) {
      toast.error(e.message || '分配失败');
    }
  };

  const tabs: { key: ScopeTab; name: string; desc: string }[] = isAdmin
    ? [
        { key: 'public', name: '🏛️ 基础套餐', desc: '公共模板（管理员可见）' },
        { key: 'all', name: '📦 全部套餐', desc: '包含所有角色可见的套餐' },
      ]
    : [
        { key: 'all', name: '📦 我的套餐', desc: '我能看到的所有套餐' },
      ];

  return (
    <div className="space-y-4">
      {/* 顶部操作栏 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onSearch(); }}
            placeholder="搜索套餐名/编号..."
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 !pl-8 text-sm focus:outline-none focus:border-green-500 transition-colors"
          />
          <button onClick={onSearch} className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-emerald-800 px-2 py-0.5 rounded-md hover:bg-emerald-50">
            搜索
          </button>
        </div>
        {isAdmin && (
          <button onClick={onCreate} className={btnPrimary}>
            <Plus size={14} /> 新建基础套餐
          </button>
        )}
        {!isAdmin && (
          <button onClick={onCreate} className={btnPrimary}>
            <Plus size={14} /> 新建我的套餐
          </button>
        )}
      </div>

      {/* Scope Tabs */}
      <div className="flex gap-2 border-b border-gray-200">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setScope(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              scope === t.key
                ? 'border-emerald-700 text-emerald-800'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.name}
          </button>
        ))}
        <div className="ml-auto flex items-center text-xs text-gray-400">
          共 {list.length} 条
        </div>
      </div>

      {/* 套餐卡片网格 */}
      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">
          <span className="inline-block w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin mr-2 align-middle" />
          加载中...
        </div>
      ) : list.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-xl border border-dashed border-gray-200">
          <div className="text-5xl mb-3">📋</div>
          <div className="text-sm text-gray-500 mb-4">
            {scope === 'public' ? '暂无基础套餐，点击右上角新建第一个基础套餐吧' : '暂无套餐，点击右上角新建吧'}
          </div>
          <button onClick={onCreate} className={btnPrimary}>
            <Plus size={14} /> 立即新建
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {list.map(pkg => (
            <PackageCard
              key={pkg.id}
              pkg={pkg}
              isAdmin={isAdmin}
              currentUserId={user?.id}
              salesUsers={salesUsers}
              onEdit={() => onEdit(pkg)}
              onClone={() => onClone(pkg)}
              onDelete={() => onDelete(pkg)}
              onDownloadPdf={() => onDownloadPdf(pkg)}
              onAssign={() => openAssign(pkg)}
            />
          ))}
        </div>
      )}

      {/* 套餐编辑抽屉 */}
      {drawerOpen && (
        <PackageDrawer
          open={drawerOpen}
          templateId={editingId}
          onClose={() => setDrawerOpen(false)}
          onSaved={() => { setDrawerOpen(false); load(); }}
        />
      )}

      {/* 分配给销售员弹窗 */}
      {assignOpen && (
        <AssignSalesModal
          pkg={assignOpen.pkg}
          salesUsers={salesUsers}
          selected={assignOpen.selected}
          onToggle={(uid) => {
            setAssignOpen(prev => {
              if (!prev) return prev;
              const next = prev.selected.includes(uid)
                ? prev.selected.filter(x => x !== uid)
                : [...prev.selected, uid];
              return { ...prev, selected: next };
            });
          }}
          onSelectAll={() => {
            setAssignOpen(prev => prev ? { ...prev, selected: salesUsers.map(s => s.id) } : prev);
          }}
          onClearAll={() => {
            setAssignOpen(prev => prev ? { ...prev, selected: [] } : prev);
          }}
          onCancel={() => setAssignOpen(null)}
          onSave={handleAssignSave}
        />
      )}
    </div>
  );
}

// --------- 套餐卡片组件 ---------
function PackageCard({
  pkg, isAdmin, currentUserId, salesUsers,
  onEdit, onClone, onDelete, onDownloadPdf, onAssign,
}: {
  pkg: CheckupTemplate;
  isAdmin: boolean;
  currentUserId?: string;
  salesUsers: SalesUser[];
  onEdit: () => void;
  onClone: () => void;
  onDelete: () => void;
  onDownloadPdf: () => void;
  onAssign: () => void;
}) {
  const applicable: any[] = (pkg as any).applicable_roles || ROLES;
  const isPublic = !!(pkg as any).is_public;
  const isOwner = !!(currentUserId && (pkg as any).owner_sales_id === currentUserId);
  const canEdit = isAdmin || isOwner;
  const covers: string[] = Array.isArray((pkg as any).cover_sales_ids) ? (pkg as any).cover_sales_ids : [];

  // 销售员名字映射
  const ownerName = (pkg as any).owner_sales_id
    ? salesUsers.find(s => s.id === (pkg as any).owner_sales_id)?.name || '销售员'
    : null;
  const coverNames = covers.map(cid => salesUsers.find(s => s.id === cid)?.name).filter(Boolean) as string[];

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-all overflow-hidden flex flex-col">
      {/* 卡片头：标签 + 标题 */}
      <div className="px-4 pt-4 pb-3 border-b border-gray-100">
        <div className="flex items-start gap-2 mb-2 flex-wrap">
          {isPublic && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-[11px] font-medium">
              <Shield size={11} /> 基础套餐
            </span>
          )}
          {!isPublic && ownerName && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200 text-[11px]">
              👤 {ownerName}
            </span>
          )}
          {(pkg as any).base_template_id && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-[11px]">
              <Copy size={11} /> 衍生
            </span>
          )}
          {covers.length > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200 text-[11px]"
                  title={`已分配给：${coverNames.join('、')}`}>
              <Users size={11} /> {coverNames.length}人
            </span>
          )}
        </div>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-gray-900 truncate">{pkg.name}</h3>
            <p className="text-xs text-gray-400 mt-0.5">#{pkg.code || pkg.id.slice(0, 8)}</p>
          </div>
        </div>
      </div>

      {/* 卡片中：三角色价格胶囊 */}
      <div className="px-4 py-3 bg-gradient-to-b from-gray-50/50 to-white space-y-1.5">
        {applicable.map((r: any) => {
          const plan: any = ((pkg as any).role_price_capsule || {})[r] || {};
          const orig = Number(plan.original_total || 0);
          const disc = Number(plan.discount_price || 0);
          const rate = Number(plan.discount_rate || 100);
          return (
            <div key={r} className={`flex items-center justify-between px-3 py-2 rounded-lg ${
              r === 'male' ? 'bg-blue-50/50' : r === 'female_married' ? 'bg-pink-50/50' : 'bg-purple-50/50'
            }`}>
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xl">{ROLE_EMOJI[r as any] || '👤'}</span>
                <div className="min-w-0">
                  <div className="text-[12px] font-medium text-gray-800">{ROLE_LABEL[r as any] || r}</div>
                  <div className="text-[10px] text-gray-400 line-through">原价 ¥{orig.toFixed(0)}</div>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-base font-bold text-emerald-800 leading-tight">¥{disc.toFixed(0)}</div>
                {rate < 100 && orig > 0 && (
                  <div className="text-[10px] text-amber-600 font-medium">{rate.toFixed(0)}折</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 卡片底：操作按钮 */}
      <div className="px-3 py-2.5 border-t border-gray-100 bg-gray-50/30 flex items-center flex-wrap gap-1.5">
        <button onClick={onEdit} className={btnGhost + ' !px-2.5 !py-1.5'}>
          ✏️ 编辑
        </button>
        <button onClick={onClone} className={btnGhost + ' !px-2.5 !py-1.5'}>
          <Copy size={12} /> 克隆
        </button>
        <button onClick={onDownloadPdf} className={btnGhost + ' !px-2.5 !py-1.5'}>
          <Download size={12} /> PDF
        </button>
        {isAdmin && (
          <button onClick={onAssign} className={btnGhost + ' !px-2.5 !py-1.5'}>
            <Users size={12} /> 分配
          </button>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {!canEdit && <Eye size={12} className="text-gray-300" />}
          {canEdit && (
            <button onClick={onDelete} className={btnDanger}>
              <Trash2 size={11} /> 删除
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// --------- 分配给销售员弹窗 ---------
function AssignSalesModal({
  pkg, salesUsers, selected, onToggle, onSelectAll, onClearAll, onCancel, onSave,
}: {
  pkg: CheckupTemplate;
  salesUsers: SalesUser[];
  selected: string[];
  onToggle: (uid: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative bg-white rounded-xl border border-gray-200 shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 shrink-0">
          <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Users size={16} className="text-violet-600" />
            分配给销售员
          </h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <div className="px-5 py-3 border-b border-gray-100 text-xs text-gray-500 shrink-0">
          套餐：<span className="font-medium text-gray-800">{pkg.name}</span>
          <span className="mx-2 text-gray-300">|</span>
          已选 <span className="font-semibold text-violet-700">{selected.length}</span> / {salesUsers.length} 人
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex gap-2">
              <button onClick={onSelectAll} className="text-xs text-emerald-700 hover:underline">全选</button>
              <span className="text-gray-300">|</span>
              <button onClick={onClearAll} className="text-xs text-gray-500 hover:underline">清空</button>
            </div>
          </div>
          {salesUsers.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-xs">暂无销售员数据</div>
          ) : (
            <div className="space-y-1.5">
              {salesUsers.map(u => {
                const checked = selected.includes(u.id);
                return (
                  <label key={u.id}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                      checked
                        ? 'bg-violet-50 border-violet-300 text-violet-900'
                        : 'bg-white border-gray-200 hover:bg-gray-50 text-gray-700'
                    }`}>
                    <input type="checkbox" checked={checked} onChange={() => onToggle(u.id)}
                      className="accent-violet-600 w-4 h-4" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{u.name}</div>
                      {u.username && <div className="text-[11px] text-gray-400 truncate">@{u.username}</div>}
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-gray-200 shrink-0 flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm rounded-lg bg-white hover:bg-gray-100 text-gray-700 border border-gray-200">取消</button>
          <button onClick={onSave} className="px-4 py-2 text-sm rounded-lg bg-violet-600 hover:bg-violet-700 text-white font-medium">
            确认分配
          </button>
        </div>
      </div>
    </div>
  );
}
