import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  RefreshCw, AlertTriangle, Loader2, Package, Warehouse as WarehouseIcon,
  ClipboardList, FileText, CheckCircle2, Clock, Eye, Edit3, Gavel,
  Bell, Plus, ArrowLeft, Save, Send, Search, Filter, X,
  TrendingUp, AlertCircle, Check, RotateCcw, Trash2,
  QrCode, FileDown, LineChart, BarChart3,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { formatCurrency } from '@/utils/format';

const MANAGER_ROLES = ['admin', 'finance', 'boss'];
const CAN_REVIEW_ROLES = ['admin', 'finance'];

// ===== 类型定义 =====
type StockTakeStatus = 'pending' | 'draft' | 'submitted' | 'reviewing' | 'returned' | 'completed';
type ViewMode = 'list' | 'edit' | 'review' | 'detail';

interface ProgressItem {
  warehouse_id: string;
  warehouse_name: string;
  warehouse_type?: string;
  department_name?: string;
  manager_userid?: string;
  confirmer_userid?: string;
  stock_take_id: string | null;
  take_no: string | null;
  status: StockTakeStatus;
  operator_name?: string | null;
  reviewed_at?: string | null;
  take_count: number;
  take_type?: 'monthly' | 'annual';
}

interface StockTakeListItem {
  id: string;
  take_no: string;
  warehouse_id: string;
  warehouse_name: string;
  period_month: string;
  status: StockTakeStatus;
  remark?: string | null;
  created_by?: string;
  created_by_name?: string;
  created_at: string;
  updated_at?: string;
  operator_name?: string | null;
  reviewed_by_name?: string | null;
  reviewed_at?: string | null;
  item_count: number;
  filled_count: number;
  diff_count: number;
  total_system_value: number;
  total_actual_value: number;
  total_diff_value: number;
  take_type?: 'monthly' | 'annual';
}

interface StockTakeItem {
  id: string;
  stock_take_id: string;
  item_id: string;
  item_name: string;
  category_name: string | null;
  spec: string | null;
  unit: string | null;
  system_quantity: number;
  actual_quantity: number | null;
  difference: number;
  unit_price: number;
  system_value: number;
  actual_value: number;
  is_sampled?: number;
  remark?: string | null;
}

interface ReviewSample {
  item_detail_id: string;
  item_id?: string;
  item_name: string;
  spec?: string;
  unit?: string;
  actual_quantity: number | null;
  verify_quantity: number | null;
  matched?: boolean | null;
}

interface CostSummaryCategory {
  items: { item_name: string; difference: number; diff_value: number }[];
  total_diff: number;
}
type CostSummary = Record<string, CostSummaryCategory>;

interface StockTakeDetail {
  id: string;
  take_no: string;
  warehouse_id: string;
  warehouse_name: string;
  department_name?: string;
  period_month: string;
  status: StockTakeStatus;
  remark?: string | null;
  total_value: number;
  created_by_name?: string;
  created_at: string;
  updated_at?: string;
  operator_name?: string | null;
  reviewed_by_name?: string | null;
  reviewed_at?: string | null;
  review_result?: string | null;
  cost_summary?: string | CostSummary | null;
  review_sample?: ReviewSample[] | null;
  items: StockTakeItem[];
  notification_sent_at?: string | null;
  notification?: { sent: boolean; recipient: string; reason: string };
  take_type?: 'monthly' | 'annual';
  operator_signature?: string | null;
  reviewer_signature?: string | null;
}

interface Warehouse {
  id: string;
  name: string;
  code?: string;
  type?: string;
  department_name?: string;
  enable_stock_take?: number;
}

// ===== 状态配置 =====
const STATUS_CONFIG: Record<StockTakeStatus, { label: string; badge: string; dot: string; ring: string }> = {
  pending:   { label: '未盘点', badge: 'bg-gray-100 text-gray-700',   dot: 'bg-gray-400',   ring: 'border-gray-200' },
  draft:     { label: '草稿',   badge: 'bg-orange-100 text-orange-700', dot: 'bg-orange-500', ring: 'border-orange-200' },
  returned:  { label: '已退回', badge: 'bg-red-100 text-red-700',     dot: 'bg-red-500',     ring: 'border-red-200' },
  submitted: { label: '已提交', badge: 'bg-blue-100 text-blue-700',   dot: 'bg-blue-500',   ring: 'border-blue-200' },
  reviewing: { label: '复核中', badge: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500', ring: 'border-purple-200' },
  completed: { label: '已完成', badge: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500', ring: 'border-emerald-200' },
};

// ===== 工具函数 =====
function getDefaultMonth(): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getRecentMonths(count = 12): string[] {
  const arr: string[] = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    arr.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return arr;
}

function getRecentYears(count = 5): string[] {
  const arr: string[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    arr.push(String(now.getFullYear() - i));
  }
  return arr;
}

function formatDateTime(s?: string | null): string {
  if (!s) return '-';
  const d = new Date(s);
  if (isNaN(d.getTime())) return String(s);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function diffColor(v: number): string {
  if (v > 0) return 'text-emerald-600';
  if (v < 0) return 'text-red-600';
  return 'text-gray-400';
}

// 格式化 period_month 显示：年度类型只显示年份
function formatPeriod(periodMonth: string, takeType?: string): string {
  if (takeType === 'annual' && periodMonth && periodMonth.length >= 4) {
    return periodMonth.slice(0, 4);
  }
  return periodMonth;
}

function parseCostSummary(raw: string | CostSummary | null | undefined): CostSummary | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return raw as CostSummary;
}

// ===== 状态徽章 =====
function StatusBadge({ status, size = 'sm' }: { status: StockTakeStatus; size?: 'sm' | 'md' }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  const pad = size === 'md' ? 'px-3 py-1 text-sm' : 'px-2.5 py-0.5 text-xs';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-medium ${cfg.badge} ${pad}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

// ===== 主组件 =====
interface StockTakePanelProps {
  currentTab: 'monthly' | 'annual' | 'trend';
}

export default function StockTakePanel({ currentTab }: StockTakePanelProps) {
  const { user } = useAuthStore();
  const isManager = user ? MANAGER_ROLES.includes(user.role) : false;
  const canReview = user ? CAN_REVIEW_ROLES.includes(user.role) : false;
  const isAnnual = currentTab === 'annual';

  // 视图状态
  const [view, setView] = useState<ViewMode>('list');
  const [currentTakeId, setCurrentTakeId] = useState<string | null>(null);

  // 列表 / 看板
  const [selectedMonth, setSelectedMonth] = useState<string>(getDefaultMonth());
  const [selectedYear, setSelectedYear] = useState<string>(String(new Date().getFullYear()));
  const [progress, setProgress] = useState<ProgressItem[]>([]);
  const [list, setList] = useState<StockTakeListItem[]>([]);
  const [loadingProgress, setLoadingProgress] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [notifyLoadingId, setNotifyLoadingId] = useState<string | null>(null);

  // 仓库列表（发起盘点用）
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  // 发起盘点弹窗
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createWarehouseId, setCreateWarehouseId] = useState('');
  const [createMonth, setCreateMonth] = useState(getDefaultMonth());
  const [createYear, setCreateYear] = useState(String(new Date().getFullYear()));
  const [createRemark, setCreateRemark] = useState('');
  const [creating, setCreating] = useState(false);

  // 重新生成链接
  const [refreshUrlData, setRefreshUrlData] = useState<{
    stock_take_id?: string;
    operator_url: string; reviewer_url: string; operator_token: string; reviewer_token: string;
  } | null>(null);
  const [showUrlModal, setShowUrlModal] = useState(false);
  const [refreshingUrl, setRefreshingUrl] = useState(false);
  // 历史趋势
  const [trendData, setTrendData] = useState<any[]>([]);
  const [loadingTrend, setLoadingTrend] = useState(false);
  const [trendWarehouseId, setTrendWarehouseId] = useState('');
  const [trendPeriods, setTrendPeriods] = useState(6);

  // 详情 / 编辑 / 复核
  const [detail, setDetail] = useState<StockTakeDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  // 编辑态本地明细
  const [editItems, setEditItems] = useState<StockTakeItem[]>([]);
  const [modifiedIds, setModifiedIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // 编辑辅助
  const [catFilter, setCatFilter] = useState<string>('');
  const [keyword, setKeyword] = useState('');
  const [onlyDiff, setOnlyDiff] = useState(false);

  // 复核态
  const [reviewSamples, setReviewSamples] = useState<ReviewSample[]>([]);
  const [loadingReview, setLoadingReview] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [reviewActionLoading, setReviewActionLoading] = useState(false);

  // ---- 拉取进度看板 ----
  const fetchProgress = useCallback(async (period: string, takeType: 'monthly' | 'annual' = currentTab === 'annual' ? 'annual' : 'monthly') => {
    if (currentTab === 'trend') return;
    setLoadingProgress(true);
    try {
      const data = await api.get<ProgressItem[]>(`/stock-takes/progress/${period}?take_type=${takeType}`);
      setProgress(data || []);
    } catch (err: any) {
      setError(err.message || '获取盘点进度失败');
      setProgress([]);
    } finally {
      setLoadingProgress(false);
    }
  }, [currentTab]);

  // ---- 拉取盘点单列表 ----
  const fetchList = useCallback(async () => {
    if (currentTab === 'trend') return;
    setLoadingList(true);
    try {
      const period = isAnnual ? selectedYear : selectedMonth;
      const params: any = { period_month: period, take_type: isAnnual ? 'annual' : 'monthly' };
      const data = await api.get<StockTakeListItem[]>('/stock-takes', params);
      setList(data || []);
    } catch (err: any) {
      setError(err.message || '获取盘点单列表失败');
      setList([]);
    } finally {
      setLoadingList(false);
    }
  }, [selectedMonth, selectedYear, isAnnual, currentTab]);

  // ---- 拉取仓库列表 ----
  useEffect(() => {
    api.get<Warehouse[]>('/warehouses').then(setWarehouses).catch(() => {});
  }, []);

  // 月份/年份变化时重新加载看板+列表
  useEffect(() => {
    if (currentTab === 'trend') return;
    setError('');
    const period = isAnnual ? selectedYear : selectedMonth;
    fetchProgress(period);
    fetchList();
  }, [selectedMonth, selectedYear, isAnnual, currentTab, fetchProgress, fetchList]);

  // 切换 Tab 时刷新数据
  useEffect(() => {
    if (currentTab === 'trend') {
      fetchTrend();
    } else {
      const period = isAnnual ? selectedYear : selectedMonth;
      fetchProgress(period);
      fetchList();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTab]);

  // 成功提示3秒后清除
  useEffect(() => {
    if (successMsg) {
      const t = setTimeout(() => setSuccessMsg(''), 3000);
      return () => clearTimeout(t);
    }
  }, [successMsg]);

  const refreshAll = useCallback(() => {
    if (currentTab === 'trend') return;
    const period = isAnnual ? selectedYear : selectedMonth;
    fetchProgress(period);
    fetchList();
  }, [selectedMonth, selectedYear, isAnnual, currentTab, fetchProgress, fetchList]);

  // 可盘点仓库（仅 enable_stock_take=1）
  const stockTakeWarehouses = useMemo(
    () => warehouses.filter((w) => w.enable_stock_take === 1),
    [warehouses]
  );

  // ---- 打开发起盘点弹窗 ----
  const openCreateModal = () => {
    setCreateWarehouseId('');
    if (isAnnual) {
      setCreateYear(selectedYear);
    } else {
      setCreateMonth(selectedMonth);
    }
    setCreateRemark('');
    setShowCreateModal(true);
  };

  // ---- 提交发起盘点 ----
  const handleCreate = async () => {
    if (!createWarehouseId) { setError('请选择仓库'); return; }
    const period = isAnnual ? createYear : createMonth;
    if (!period) { setError(isAnnual ? '请选择归属年度' : '请选择归属月份'); return; }
    setCreating(true);
    setError('');
    try {
      // 年度盘点：period_month 存为 YYYY-12（canonical 月份）
      const periodMonth = isAnnual ? `${createYear}-12` : createMonth;
      const data: any = await api.post<StockTakeDetail>('/stock-takes', {
        warehouse_id: createWarehouseId,
        period_month: periodMonth,
        remark: createRemark || undefined,
        take_type: isAnnual ? 'annual' : 'monthly',
      });
      setShowCreateModal(false);

      let msg = data.message || '盘点单已创建';
      if (data.notification) {
        if (data.notification.sent) {
          msg += `，企微通知已发送给 ${data.notification.recipient || '仓库管理员'}`;
        } else if (data.notification.reason) {
          msg += `，但企微通知发送失败（${data.notification.reason}），可稍后手动催办`;
        } else {
          msg += '，未发送通知（仓库未设置管理员/确认人）';
        }
      }
      setSuccessMsg(msg);
      refreshAll();
      if (data?.id) {
        if (isAnnual) {
          openDetail(data.id, 'detail');
        } else {
          openEdit(data.id);
        }
      }
    } catch (err: any) {
      setError(err.message || '发起盘点失败');
    } finally {
      setCreating(false);
    }
  };

  // ---- 催办 / 通知 ----
  const handleNotify = async (takeId: string) => {
    setNotifyLoadingId(takeId);
    try {
      const data = await api.post<{ success: boolean; message?: string }>(`/stock-takes/${takeId}/notify`, { type: 'remind' });
      setSuccessMsg(data.message || '通知已发送');
    } catch (err: any) {
      setError(err.message || '通知发送失败');
    } finally {
      setNotifyLoadingId(null);
    }
  };

  // ---- 打开详情 ----
  const openDetail = async (id: string, targetView: ViewMode = 'detail') => {
    setCurrentTakeId(id);
    setView(targetView);
    setLoadingDetail(true);
    setDetail(null);
    setEditItems([]);
    setModifiedIds(new Set());
    setReviewSamples([]);
    setReviewError('');
    try {
      const data = await api.get<StockTakeDetail>(`/stock-takes/${id}`);
      setDetail(data);
      if (targetView === 'edit') {
        setEditItems(data.items || []);
      }
    } catch (err: any) {
      setError(err.message || '获取盘点单详情失败');
    } finally {
      setLoadingDetail(false);
    }
  };

  // ---- 打开编辑 ----
  const openEdit = (id: string) => openDetail(id, 'edit');

  // ---- 打开复核 ----
  const openReview = async (id: string) => {
    setCurrentTakeId(id);
    setView('review');
    setLoadingReview(true);
    setReviewSamples([]);
    setReviewError('');
    setDetail(null);
    try {
      // 先拉详情用于头部展示
      const d = await api.get<StockTakeDetail>(`/stock-takes/${id}`);
      setDetail(d);
      // 再拉复核抽样
      const r = await api.get<{ samples: ReviewSample[]; status: string }>(`/stock-takes/${id}/review-init`);
      setReviewSamples(r.samples || []);
    } catch (err: any) {
      setReviewError(err.message || '初始化复核失败');
    } finally {
      setLoadingReview(false);
    }
  };

  // ---- 返回列表 ----
  const backToList = () => {
    setView('list');
    setCurrentTakeId(null);
    setDetail(null);
    setEditItems([]);
    setModifiedIds(new Set());
    setReviewSamples([]);
    refreshAll();
  };

  // ===== 编辑态：计算 =====
  const categories = useMemo(() => {
    const set = new Set<string>();
    editItems.forEach((it) => { if (it.category_name) set.add(it.category_name); });
    return Array.from(set).sort();
  }, [editItems]);

  const filteredItems = useMemo(() => {
    return editItems.filter((it) => {
      if (catFilter && it.category_name !== catFilter) return false;
      if (keyword) {
        const kw = keyword.toLowerCase();
        if (!(`${it.item_name}`.toLowerCase().includes(kw)) && !(it.spec || '').toLowerCase().includes(kw)) return false;
      }
      if (onlyDiff) {
        const actual = it.actual_quantity;
        const diff = actual !== null ? actual - Number(it.system_quantity) : 0;
        if (diff === 0) return false;
      }
      return true;
    });
  }, [editItems, catFilter, keyword, onlyDiff]);

  const summary = useMemo(() => {
    let filled = 0;
    let diffCount = 0;
    let sysValue = 0;
    let actualValue = 0;
    editItems.forEach((it) => {
      sysValue += Number(it.system_value) || 0;
      if (it.actual_quantity !== null) {
        filled += 1;
        const diff = Number(it.actual_quantity) - Number(it.system_quantity);
        const av = Number(it.actual_quantity) * Number(it.unit_price);
        actualValue += av;
        if (diff !== 0) diffCount += 1;
      } else {
        actualValue += Number(it.system_value) || 0;
      }
    });
    return {
      total: editItems.length,
      filled,
      unfilled: editItems.length - filled,
      diffCount,
      sysValue,
      actualValue,
      diffValue: actualValue - sysValue,
    };
  }, [editItems]);

  // 实盘是否可编辑
  const editable = detail ? ['draft', 'returned'].includes(detail.status) : false;

  // ---- 编辑态：更新明细 ----
  const updateItem = (id: string, patch: Partial<StockTakeItem>) => {
    setEditItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        const next = { ...it, ...patch };
        // 重算 difference / actual_value
        if (patch.actual_quantity !== undefined) {
          const aq = next.actual_quantity;
          next.difference = aq !== null ? aq - Number(next.system_quantity) : 0;
          next.actual_value = aq !== null ? aq * Number(next.unit_price) : 0;
        }
        return next;
      })
    );
    setModifiedIds((prev) => new Set(prev).add(id));
  };

  // ---- 全部实盘=系统 ----
  const fillAllWithSystem = () => {
    setEditItems((prev) =>
      prev.map((it) => {
        if (it.actual_quantity !== null) return it;
        return {
          ...it,
          actual_quantity: Number(it.system_quantity),
          difference: 0,
          actual_value: Number(it.system_value),
        };
      })
    );
    // 把原本 null 的全部标记为已修改
    const newModified = new Set(modifiedIds);
    editItems.forEach((it) => { if (it.actual_quantity === null) newModified.add(it.id); });
    setModifiedIds(newModified);
    setSuccessMsg('已将未录入项填为系统数量');
  };

  // ---- 保存（仅提交修改过的 items） ----
  const handleSave = async (silent = false): Promise<boolean> => {
    if (!currentTakeId) return false;
    if (modifiedIds.size === 0) {
      if (!silent) setSuccessMsg('没有需要保存的修改');
      return true;
    }
    setSaving(true);
    setError('');
    try {
      const payload = editItems
        .filter((it) => modifiedIds.has(it.id))
        .map((it) => ({
          id: it.id,
          actual_quantity: it.actual_quantity,
          remark: it.remark || null,
          system_quantity: it.system_quantity,
          unit_price: it.unit_price,
        }));
      await api.put(`/stock-takes/${currentTakeId}`, { items: payload });
      setModifiedIds(new Set());
      if (!silent) setSuccessMsg('保存成功');
      return true;
    } catch (err: any) {
      setError(err.message || '保存失败');
      return false;
    } finally {
      setSaving(false);
    }
  };

  // ---- 提交复核（先保存再提交） ----
  const handleSubmit = async () => {
    if (!currentTakeId) return;
    if (summary.unfilled > 0) {
      setError(`还有 ${summary.unfilled} 项物资未录入实盘数量，请先录入或点击「全部实盘=系统」`);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const saved = await handleSave(true);
      if (!saved) { setSubmitting(false); return; }
      const data = await api.post<{ success: boolean; message?: string }>(`/stock-takes/${currentTakeId}/submit`);
      setSuccessMsg(data.message || '已提交，等待财务复核');
      backToList();
    } catch (err: any) {
      setError(err.message || '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  // ---- 取消盘点（仅草稿） ----
  const handleCancelTake = async (takeId: string, goBackAfter = false) => {
    if (!window.confirm('确定要取消该盘点单吗？取消后盘点单将被删除，且不可恢复。')) {
      return;
    }
    try {
      await api.delete(`/stock-takes/${takeId}`);
      setSuccessMsg('盘点单已取消');
      refreshAll();
      if (goBackAfter) backToList();
    } catch (err: any) {
      setError(err.message || '取消失败');
    }
  };
  const handleCancel = () => currentTakeId && handleCancelTake(currentTakeId, true);

  // ---- 重新生成访问链接 ----
  const handleRefreshToken = async (id: string) => {
    setRefreshingUrl(true);
    try {
      const data = await api.post<any>(`/stock-takes/${id}/refresh-token`);
      setRefreshUrlData({ ...data, stock_take_id: id });
      setShowUrlModal(true);
    } catch (err: any) {
      setError(err.message || '生成链接失败');
    } finally {
      setRefreshingUrl(false);
    }
  };

  // ---- 导出 PDF ----
  const handleExportPdf = (id: string) => {
    const base = import.meta.env.VITE_API_URL || '/api';
    window.open(`${base}/stock-takes/${id}/report-pdf`, '_blank');
  };

  // ---- 历史趋势 ----
  const fetchTrend = useCallback(async () => {
    setLoadingTrend(true);
    try {
      const params: any = { periods: trendPeriods, take_type: 'monthly' };
      if (trendWarehouseId) params.warehouse_id = trendWarehouseId;
      const data = await api.get<any[]>('/stock-takes/trends', params);
      setTrendData(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message || '获取历史趋势失败');
      setTrendData([]);
    } finally {
      setLoadingTrend(false);
    }
  }, [trendPeriods, trendWarehouseId]);

  // ---- 复核：更新抽样核验数量 ----
  const updateSample = (itemDetailId: string, verifyQty: number | null) => {
    setReviewSamples((prev) =>
      prev.map((s) => (s.item_detail_id === itemDetailId ? { ...s, verify_quantity: verifyQty, matched: null } : s))
    );
  };

  // ---- 复核：退回 ----
  const handleReturn = async () => {
    if (!currentTakeId) return;
    if (!returnReason.trim()) { setReviewError('请填写退回原因'); return; }
    setReviewActionLoading(true);
    setReviewError('');
    try {
      const data = await api.post<{ success: boolean; message?: string }>(`/stock-takes/${currentTakeId}/review`, {
        action: 'return',
        return_reason: returnReason.trim(),
      });
      setSuccessMsg(data.message || '已退回，通知盘点人修改');
      setShowReturnModal(false);
      setReturnReason('');
      backToList();
    } catch (err: any) {
      setReviewError(err.message || '退回失败');
    } finally {
      setReviewActionLoading(false);
    }
  };

  // ---- 复核：通过 ----
  const handlePass = async () => {
    if (!currentTakeId) return;
    // 校验已全部填入核验数量
    const unfilled = reviewSamples.filter((s) => s.verify_quantity === null || s.verify_quantity === undefined);
    if (unfilled.length > 0) {
      setReviewError(`还有 ${unfilled.length} 项抽样未填入核验数量`);
      return;
    }
    setReviewActionLoading(true);
    setReviewError('');
    try {
      const payload = reviewSamples.map((s) => ({
        item_detail_id: s.item_detail_id,
        verify_quantity: s.verify_quantity,
      }));
      const data = await api.post<{ success: boolean; message?: string; need_return?: boolean; samples?: ReviewSample[] }>(
        `/stock-takes/${currentTakeId}/review`,
        { action: 'pass', samples: payload }
      );
      if (data.need_return && data.samples) {
        // 有不一致，更新本地 matched 状态
        setReviewSamples(data.samples);
        const mismatched = data.samples.filter((s) => s.matched === false);
        setReviewError(`抽样核验有 ${mismatched.length} 项不一致，需退回重新盘点`);
      } else {
        setSuccessMsg(data.message || '盘点已完成');
        backToList();
      }
    } catch (err: any) {
      setReviewError(err.message || '复核失败');
    } finally {
      setReviewActionLoading(false);
    }
  };

  // ===== 渲染 =====
  return (
    <div className="space-y-6">
      {/* 顶部页头 */}
      <div className="flex items-start justify-between mb-5 gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-800 mb-2 flex items-center gap-2">
            <ClipboardList size={22} className="text-primary-600" />
            {currentTab === 'trend' ? '历史趋势' : isAnnual ? '年度固定资产盘点' : '月结原材料盘点'}
          </h1>
          <p className="text-sm text-gray-500">
            {currentTab === 'trend' ? '查看各仓库盘点盈亏趋势分析' : isAnnual ? '年度固定资产盘点管理' : '查看各仓库盘点进度、结果'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {view !== 'list' && (
            <button onClick={backToList} className="btn-secondary flex items-center gap-2">
              <ArrowLeft size={18} />
              <span>返回列表</span>
            </button>
          )}
          {currentTab !== 'trend' && view === 'list' && isManager && (
            <button onClick={openCreateModal} className="btn-primary flex items-center gap-2">
              <Plus size={18} /> <span>发起{isAnnual ? '年度固定资产' : '月末原材料'}盘点</span>
            </button>
          )}
          {view === 'list' && (
            <button onClick={refreshAll} className="btn-secondary flex items-center gap-2">
              <RefreshCw size={18} />
              <span>刷新</span>
            </button>
          )}
        </div>
      </div>

      {/* 全局提示 */}
      {error && (
        <div className="bg-danger-50 border border-danger-200 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle size={20} className="text-danger-500 mt-0.5 shrink-0" />
          <span className="text-danger-700 flex-1">{error}</span>
          <button onClick={() => setError('')} className="text-danger-400 hover:text-danger-600"><X size={16} /></button>
        </div>
      )}
      {successMsg && (
        <div className="bg-success-50 border border-success-200 rounded-lg p-4 flex items-start gap-3">
          <CheckCircle2 size={20} className="text-success-500 mt-0.5 shrink-0" />
          <span className="text-success-700 flex-1">{successMsg}</span>
          <button onClick={() => setSuccessMsg('')} className="text-success-400 hover:text-success-600"><X size={16} /></button>
        </div>
      )}

      {/* ============ 视图：列表 / 看板 ============ */}
      {view === 'list' && (
        <>
          {currentTab !== 'trend' && (
            <>
          {/* 月份/年度选择 */}
          <div className="card flex flex-wrap items-center gap-3 py-4">
            <div className="flex items-center gap-2 text-gray-600">
              <Clock size={18} />
              <span className="text-sm font-medium">{isAnnual ? '归属年度' : '归属月份'}</span>
            </div>
            {isAnnual ? (
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className="input-field w-32"
              >
                {getRecentYears(5).map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            ) : (
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="input-field w-44"
              />
            )}
            {!isAnnual && selectedMonth === getDefaultMonth() && (
              <span className="tag tag-warning">默认上月</span>
            )}
            <div className="ml-auto text-sm text-gray-500">
              共 {progress.length} 个需盘点仓库 / {list.length} 张盘点单
            </div>
          </div>

          {/* 进度看板 */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Package size={18} className="text-primary-600" />
              <h2 className="text-lg font-semibold text-gray-800">盘点进度看板</h2>
            </div>
            {loadingProgress ? (
              <div className="card text-center py-10 text-gray-500">
                <Loader2 className="animate-spin inline mr-2" size={18} />加载中...
              </div>
            ) : progress.length === 0 ? (
              <div className="card flex flex-col items-center justify-center py-12">
                <WarehouseIcon size={42} className="text-gray-300 mb-2" />
                <p className="text-gray-400">本月无需要盘点的仓库</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {progress.map((p) => {
                  const cfg = STATUS_CONFIG[p.status] || STATUS_CONFIG.pending;
                  const isDone = p.status === 'completed';
                  const canNotify = isManager && !!p.stock_take_id && !isDone;
                  return (
                    <div key={p.warehouse_id} className={`stat-card border ${cfg.ring}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-gray-800 truncate flex items-center gap-1.5">
                            <WarehouseIcon size={15} className="text-gray-400 shrink-0" />
                            {p.warehouse_name}
                          </p>
                          {p.department_name && (
                            <p className="text-xs text-gray-400 mt-0.5">{p.department_name}</p>
                          )}
                        </div>
                        <StatusBadge status={p.status} />
                      </div>

                      <div className="mt-3 space-y-1 text-xs text-gray-500">
                        {p.take_no && (
                          <div className="flex items-center gap-1.5">
                            <FileText size={12} />
                            <span className="font-mono">{p.take_no}</span>
                          </div>
                        )}
                        {p.operator_name && (
                          <div>盘点人：<span className="text-gray-700">{p.operator_name}</span></div>
                        )}
                        {p.take_count > 0 && (
                          <div>{isAnnual ? '本年' : '本月'}盘点次数：<span className="text-gray-700">{p.take_count}</span></div>
                        )}
                        {p.reviewed_at && (
                          <div>复核完成：{formatDateTime(p.reviewed_at)}</div>
                        )}
                      </div>

                      {/* 操作按钮 */}
                      <div className="mt-4 pt-3 border-t border-gray-100 flex flex-wrap items-center gap-2">
                        {p.status === 'pending' && (
                          isManager ? (
                            <button
                              onClick={() => {
                                setCreateWarehouseId(p.warehouse_id);
                                if (isAnnual) {
                                  setCreateYear(selectedYear);
                                } else {
                                  setCreateMonth(selectedMonth);
                                }
                                setCreateRemark('');
                                setShowCreateModal(true);
                              }}
                              className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1"
                            >
                              <Plus size={14} /> 发起盘点
                            </button>
                          ) : (
                            <span className="text-xs text-gray-400">等待管理员发起</span>
                          )
                        )}
                        {(p.status === 'draft' || p.status === 'returned') && p.stock_take_id && (
                          <button
                            onClick={() => openEdit(p.stock_take_id!)}
                            className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1"
                          >
                            <Edit3 size={14} /> 继续录入
                          </button>
                        )}
                        {(p.status === 'submitted' || p.status === 'reviewing') && p.stock_take_id && (
                          canReview ? (
                            <button
                              onClick={() => openReview(p.stock_take_id!)}
                              className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1"
                            >
                              <Gavel size={14} /> 复核
                            </button>
                          ) : (
                            <span className="text-xs text-gray-400">等待财务复核</span>
                          )
                        )}
                        {p.status === 'completed' && p.stock_take_id && (
                          <button
                            onClick={() => openDetail(p.stock_take_id!)}
                            className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1"
                          >
                            <Eye size={14} /> 查看
                          </button>
                        )}
                        {canNotify && p.status === 'draft' && (
                          <button
                            onClick={() => handleCancelTake(p.stock_take_id!)}
                            className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 flex items-center gap-1"
                          >
                            <Trash2 size={14} /> 取消盘点
                          </button>
                        )}
                        {canNotify && (
                          <button
                            onClick={() => handleNotify(p.stock_take_id!)}
                            disabled={notifyLoadingId === p.stock_take_id}
                            className="text-xs px-3 py-1.5 rounded-lg border border-warning-200 text-warning-700 bg-warning-50 hover:bg-warning-100 flex items-center gap-1 disabled:opacity-50"
                          >
                            {notifyLoadingId === p.stock_take_id ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Bell size={14} />
                            )}
                            催办
                          </button>
                        )}
                        {isManager && p.status !== 'pending' && p.stock_take_id && (
                          <button
                            onClick={() => handleRefreshToken(p.stock_take_id!)}
                            disabled={refreshingUrl}
                            className="text-xs px-3 py-1.5 rounded-lg border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 flex items-center gap-1 disabled:opacity-50"
                          >
                            {refreshingUrl ? <Loader2 size={14} className="animate-spin" /> : <QrCode size={14} />}
                            重新生成链接
                          </button>
                        )}
                        {p.status === 'completed' && p.stock_take_id && (
                          <button
                            onClick={() => handleExportPdf(p.stock_take_id!)}
                            className="text-xs px-3 py-1.5 rounded-lg border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 flex items-center gap-1"
                          >
                            <FileDown size={14} /> 导出PDF
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 盘点单列表 */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <ClipboardList size={18} className="text-primary-600" />
              <h2 className="text-lg font-semibold text-gray-800">盘点单列表（{isAnnual ? selectedYear : selectedMonth}）</h2>
            </div>
            <div className="card overflow-hidden p-0">
              {loadingList ? (
                <div className="text-center py-12 text-gray-500">
                  <Loader2 className="animate-spin inline mr-2" size={18} />加载中...
                </div>
              ) : list.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <ClipboardList size={42} className="text-gray-300 mb-2" />
                  <p className="text-gray-400">{isAnnual ? '本年' : '本月'}暂无盘点单</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>单号</th>
                        <th>仓库</th>
                        <th>状态</th>
                        <th className="text-right">物资数</th>
                        <th className="text-right">差异条数</th>
                        <th className="text-right">系统价值</th>
                        <th className="text-right">实盘价值</th>
                        <th className="text-right">差异金额</th>
                        <th>创建人</th>
                        <th>创建时间</th>
                        <th className="text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((r) => {
                        const dv = Number(r.total_diff_value) || 0;
                        return (
                          <tr
                            key={r.id}
                            className="cursor-pointer"
                            onClick={() => openDetail(r.id)}
                          >
                            <td className="font-mono text-xs text-gray-700 whitespace-nowrap">{r.take_no}</td>
                            <td className="font-medium text-gray-800 whitespace-nowrap">{r.warehouse_name}</td>
                            <td><StatusBadge status={r.status} /></td>
                            <td className="text-right text-gray-700 whitespace-nowrap">
                              {r.filled_count}/{r.item_count}
                            </td>
                            <td className="text-right whitespace-nowrap">
                              <span className={r.diff_count > 0 ? 'text-danger-600 font-semibold' : 'text-gray-400'}>
                                {r.diff_count}
                              </span>
                            </td>
                            <td className="text-right text-gray-700 whitespace-nowrap">{formatCurrency(r.total_system_value)}</td>
                            <td className="text-right text-gray-700 whitespace-nowrap">{formatCurrency(r.total_actual_value)}</td>
                            <td className={`text-right font-semibold whitespace-nowrap ${diffColor(dv)}`}>
                              {dv > 0 ? '+' : ''}{formatCurrency(dv)}
                            </td>
                            <td className="text-gray-600 whitespace-nowrap">{r.created_by_name || '-'}</td>
                            <td className="text-gray-500 text-xs whitespace-nowrap">{formatDateTime(r.created_at)}</td>
                            <td className="text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-2">
                                {(r.status === 'draft' || r.status === 'returned') && isManager && (
                                  <button
                                    onClick={() => handleCancelTake(r.id)}
                                    className="text-red-600 hover:text-red-700 text-sm flex items-center gap-0.5"
                                  >
                                    <Trash2 size={14} /> 取消
                                  </button>
                                )}
                                {r.status === 'completed' && (
                                  <button
                                    onClick={() => handleExportPdf(r.id)}
                                    className="text-emerald-600 hover:text-emerald-700 text-sm flex items-center gap-0.5"
                                  >
                                    <FileDown size={14} /> 导出PDF
                                  </button>
                                )}
                                {((r.status === 'submitted' || r.status === 'reviewing') && canReview)
                                  || ((r.status === 'draft' || r.status === 'returned' || r.status === 'completed') && isManager) ? (
                                  <button
                                    onClick={() => handleRefreshToken(r.id)}
                                    className="text-blue-600 hover:text-blue-700 text-sm flex items-center gap-0.5"
                                  >
                                    <QrCode size={14} /> 链接
                                  </button>
                                ) : null}
                                <button
                                  onClick={() => openDetail(r.id)}
                                  className="text-primary-600 hover:text-primary-700 text-sm flex items-center gap-0.5"
                                >
                                  <Eye size={14} /> 详情
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
            </>
          )}

          {/* 历史趋势 Tab */}
          {currentTab === 'trend' && (
            <div>
              <div className="flex items-end gap-3 mb-5 flex-wrap">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">仓库</label>
                  <select value={trendWarehouseId} onChange={e => setTrendWarehouseId(e.target.value)}
                    className="input-field w-60">
                    <option value="">全部仓库</option>
                    {stockTakeWarehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">期数（最近N月）</label>
                  <select value={trendPeriods} onChange={e => setTrendPeriods(Number(e.target.value))}
                    className="input-field w-40">
                    <option value={6}>最近 6 期</option>
                    <option value={12}>最近 12 期</option>
                    <option value={24}>最近 24 期</option>
                  </select>
                </div>
                <button onClick={fetchTrend} disabled={loadingTrend}
                  className="btn-secondary flex items-center gap-2">
                  {loadingTrend ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                  刷新
                </button>
              </div>

              {loadingTrend ? (
                <div className="bg-white rounded-xl p-10 text-center text-gray-400">
                  <Loader2 size={24} className="animate-spin mx-auto mb-2" />
                  加载中...
                </div>
              ) : trendData.length === 0 ? (
                <div className="bg-white rounded-xl p-10 text-center text-gray-400">
                  <BarChart3 size={36} className="mx-auto mb-2 text-gray-300" />
                  <p className="text-sm">暂无历史数据</p>
                  <p className="text-xs text-gray-300 mt-1">完成盘点后会在此显示盈亏趋势</p>
                </div>
              ) : (
                <>
                  <React.Suspense fallback={<div className="bg-white rounded-xl p-10 text-center text-gray-400"><Loader2 size={24} className="animate-spin mx-auto" /></div>}>
                    <TrendChart data={trendData} />
                  </React.Suspense>
                  <div className="mt-5 bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-gray-600">
                          <tr>
                            <th className="px-4 py-3 text-left font-medium">归属月份</th>
                            <th className="px-4 py-3 text-left font-medium">仓库</th>
                            <th className="px-4 py-3 text-left font-medium">盘点单号</th>
                            <th className="px-4 py-3 text-right font-medium">盈亏金额</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {trendData.map((row, idx) => (
                            <tr key={idx} className="hover:bg-gray-50/50">
                              <td className="px-4 py-3 font-medium text-gray-700">{row.period_month}</td>
                              <td className="px-4 py-3 text-gray-700">{row.warehouse_name}</td>
                              <td className="px-4 py-3 text-gray-500 font-mono text-xs">共 {row.take_count} 单</td>
                              <td className={`px-4 py-3 text-right font-semibold ${
                                Number(row.total_diff_value) > 0 ? 'text-emerald-600'
                                  : Number(row.total_diff_value) < 0 ? 'text-red-600' : 'text-gray-500'
                              }`}>
                                {Number(row.total_diff_value) > 0 ? '+' : ''}{formatCurrency(Number(row.total_diff_value))}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}

      {/* ============ 视图：编辑 / 详情（共用明细表） ============ */}
      {(view === 'edit' || view === 'detail') && (
        <EditOrDetailView
          view={view}
          loading={loadingDetail}
          detail={detail}
          editItems={editItems}
          filteredItems={filteredItems}
          categories={categories}
          catFilter={catFilter}
          setCatFilter={setCatFilter}
          keyword={keyword}
          setKeyword={setKeyword}
          onlyDiff={onlyDiff}
          setOnlyDiff={setOnlyDiff}
          editable={editable}
          summary={summary}
          modifiedCount={modifiedIds.size}
          updateItem={updateItem}
          fillAllWithSystem={fillAllWithSystem}
          saving={saving}
          submitting={submitting}
          onSave={() => handleSave(false)}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
          onOpenReview={(id) => openReview(id)}
          onOpenEdit={(id) => openEdit(id)}
          canReview={canReview}
          onRefreshToken={handleRefreshToken}
          onExportPdf={handleExportPdf}
          refreshingUrl={refreshingUrl}
          refreshUrlData={refreshUrlData}
        />
      )}

      {/* ============ 视图：复核 ============ */}
      {view === 'review' && (
        <ReviewView
          loading={loadingReview}
          detail={detail}
          samples={reviewSamples}
          error={reviewError}
          canEdit={true}
          updateSample={updateSample}
          onPass={handlePass}
          onOpenReturn={() => { setReturnReason(''); setShowReturnModal(true); setReviewError(''); }}
          actionLoading={reviewActionLoading}
        />
      )}

      {/* ===== 发起盘点弹窗 ===== */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => !creating && setShowCreateModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                <Plus size={18} className="text-primary-600" /> 发起{isAnnual ? '年度固定资产' : '月末原材料'}盘点
              </h3>
              <button onClick={() => !creating && setShowCreateModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">仓库 <span className="text-danger-500">*</span></label>
                <select
                  value={createWarehouseId}
                  onChange={(e) => setCreateWarehouseId(e.target.value)}
                  className="input-field"
                  disabled={creating}
                >
                  <option value="">请选择仓库</option>
                  {stockTakeWarehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}{w.department_name ? `（${w.department_name}）` : ''}</option>
                  ))}
                </select>
                {stockTakeWarehouses.length === 0 && (
                  <p className="text-xs text-gray-400 mt-1">暂无开启盘点的仓库</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {isAnnual ? '归属年度' : '归属月份'} <span className="text-danger-500">*</span>
                </label>
                {isAnnual ? (
                  <select
                    value={createYear}
                    onChange={(e) => setCreateYear(e.target.value)}
                    className="input-field"
                    disabled={creating}
                  >
                    {getRecentYears(5).map((y) => (
                      <option key={y} value={y}>{y} 年</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="month"
                    value={createMonth}
                    onChange={(e) => setCreateMonth(e.target.value)}
                    className="input-field"
                    disabled={creating}
                  />
                )}
              </div>
              <div className={`mb-4 p-3 rounded-lg text-xs ${
                isAnnual ? 'bg-purple-50 border border-purple-200 text-purple-700'
                  : 'bg-blue-50 border border-blue-200 text-blue-700'
              }`}>
                {isAnnual ? (
                  <>本次将只拉取【固定资产】一级分类下的库存物资生成盘点明细。<br />建议每年盘点一次，通常在年底进行。</>
                ) : (
                  <>本次将只拉取【原材料】一级分类下的库存物资生成盘点明细（排除固定资产）。<br />建议每月月初进行上月盘点。</>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
                <textarea
                  value={createRemark}
                  onChange={(e) => setCreateRemark(e.target.value)}
                  className="input-field min-h-[80px] resize-y"
                  placeholder="可选，盘点说明..."
                  disabled={creating}
                />
              </div>
              <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <AlertTriangle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 leading-relaxed">
                  盘点明细将根据当前仓库库存自动生成并<span className="font-medium">锁定</span>，发起盘点后新采购的物品不会自动加入盘点范围。请确认盘点时机。
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowCreateModal(false)} className="btn-secondary" disabled={creating}>取消</button>
              <button onClick={handleCreate} className="btn-primary flex items-center gap-2" disabled={creating || !createWarehouseId || (!isAnnual && !createMonth) || (isAnnual && !createYear)}>
                {creating ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                {creating ? '创建中...' : '确认发起'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 退回原因弹窗 ===== */}
      {showReturnModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => !reviewActionLoading && setShowReturnModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                <RotateCcw size={18} className="text-danger-500" /> 退回修改
              </h3>
              <button onClick={() => !reviewActionLoading && setShowReturnModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-2">请填写退回原因，将通知盘点人修改后重新提交：</p>
            <textarea
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
              className="input-field min-h-[100px] resize-y"
              placeholder="例如：抽样核验存在差异，请重新盘点..."
              disabled={reviewActionLoading}
              autoFocus
            />
            {reviewError && (
              <p className="text-xs text-danger-600 mt-2 flex items-center gap-1"><AlertCircle size={12} />{reviewError}</p>
            )}
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowReturnModal(false)} className="btn-secondary" disabled={reviewActionLoading}>取消</button>
              <button onClick={handleReturn} className="bg-danger-500 hover:bg-danger-600 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 disabled:opacity-50" disabled={reviewActionLoading}>
                {reviewActionLoading ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
                确认退回
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 访问链接弹窗 */}
      {showUrlModal && refreshUrlData && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setShowUrlModal(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">访问链接已生成</h3>
              <button onClick={() => setShowUrlModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-xs text-gray-500 mb-2 flex items-center gap-1">
                  <Package size={14} /> 盘点人访问链接（仓库管理员）
                </p>
                <div className="flex gap-2">
                  <input readOnly value={refreshUrlData.operator_url}
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded bg-gray-50 font-mono text-xs" />
                  <button onClick={() => {
                    navigator.clipboard?.writeText(refreshUrlData.operator_url);
                    alert('已复制');
                  }} className="btn-secondary px-3 py-1.5 text-xs">复制</button>
                </div>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-2 flex items-center gap-1">
                  <Gavel size={14} /> 财务复核访问链接（仅限财务/管理员）
                </p>
                <div className="flex gap-2">
                  <input readOnly value={refreshUrlData.reviewer_url}
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded bg-gray-50 font-mono text-xs" />
                  <button onClick={() => {
                    navigator.clipboard?.writeText(refreshUrlData.reviewer_url);
                    alert('已复制');
                  }} className="btn-secondary px-3 py-1.5 text-xs">复制</button>
                </div>
              </div>
            </div>
            <p className="text-xs text-amber-600 mt-4 bg-amber-50 border border-amber-200 rounded-lg p-2">
              ⚠️ 以上链接有效期 7 天，过期后请重新生成。请勿公开分享，避免盘点数据被篡改。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ================================================================
// 子组件：编辑 / 详情视图（含明细表）
// ================================================================
interface EditOrDetailViewProps {
  view: ViewMode;
  loading: boolean;
  detail: StockTakeDetail | null;
  editItems: StockTakeItem[];
  filteredItems: StockTakeItem[];
  categories: string[];
  catFilter: string;
  setCatFilter: (v: string) => void;
  keyword: string;
  setKeyword: (v: string) => void;
  onlyDiff: boolean;
  setOnlyDiff: (v: boolean) => void;
  editable: boolean;
  summary: { total: number; filled: number; unfilled: number; diffCount: number; sysValue: number; actualValue: number; diffValue: number };
  modifiedCount: number;
  updateItem: (id: string, patch: Partial<StockTakeItem>) => void;
  fillAllWithSystem: () => void;
  saving: boolean;
  submitting: boolean;
  onSave: () => void;
  onSubmit: () => void;
  onCancel: () => void;
  onOpenReview: (id: string) => void;
  onOpenEdit: (id: string) => void;
  canReview: boolean;
  onRefreshToken: (id: string) => void;
  onExportPdf: (id: string) => void;
  refreshingUrl: boolean;
  refreshUrlData: { stock_take_id?: string; operator_url: string; reviewer_url: string; operator_token: string; reviewer_token: string } | null;
}

function EditOrDetailView(props: EditOrDetailViewProps) {
  const {
    view, loading, detail, editItems, filteredItems, categories,
    catFilter, setCatFilter, keyword, setKeyword, onlyDiff, setOnlyDiff,
    editable, summary, modifiedCount, updateItem, fillAllWithSystem,
    saving, submitting, onSave, onSubmit, onCancel, onOpenReview, onOpenEdit, canReview,
    onRefreshToken, onExportPdf, refreshingUrl, refreshUrlData,
  } = props;

  if (loading) {
    return <div className="card text-center py-16 text-gray-500"><Loader2 className="animate-spin inline mr-2" size={18} />加载中...</div>;
  }
  if (!detail) {
    return <div className="card text-center py-16 text-gray-500">未找到盘点单</div>;
  }

  const isCompleted = detail.status === 'completed';
  const costSummary = parseCostSummary(detail.cost_summary);
  const isEditView = view === 'edit';

  // 解析退回原因（remark 中含 [退回原因] xxx）
  const returnReasonText = (() => {
    if (!detail.remark) return null;
    const m = String(detail.remark).match(/\[退回原因\]([\s\S]*)/);
    return m ? m[1].trim() : null;
  })();

  return (
    <div className="space-y-4">
      {/* 头部信息 */}
      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-xl font-semibold text-gray-800">{detail.warehouse_name}</h2>
              <StatusBadge status={detail.status} size="md" />
            </div>
            <div className="text-sm text-gray-500 flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="font-mono">{detail.take_no}</span>
              <span>{detail.take_type === 'annual' ? '归属年度' : '归属月份'}：<span className="text-gray-700 font-medium">{formatPeriod(detail.period_month, detail.take_type)}</span></span>
              {detail.department_name && <span>部门：{detail.department_name}</span>}
            </div>
            <div className="text-xs text-gray-400 flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>创建人：{detail.created_by_name || '-'}</span>
              <span>创建时间：{formatDateTime(detail.created_at)}</span>
              {detail.operator_name && <span>盘点人：{detail.operator_name}</span>}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {isEditView && !editable && (
              <span className="text-xs text-gray-400">当前状态不可编辑</span>
            )}
            {/* 详情视图下，根据状态显示操作 */}
            {view === 'detail' && (detail.status === 'draft' || detail.status === 'returned') && (
              <button onClick={() => onOpenEdit(detail.id)} className="btn-primary text-sm flex items-center gap-1.5">
                <Edit3 size={15} /> 继续录入
              </button>
            )}
            {view === 'detail' && (detail.status === 'submitted' || detail.status === 'reviewing') && canReview && (
              <button onClick={() => onOpenReview(detail.id)} className="btn-primary text-sm flex items-center gap-1.5">
                <Gavel size={15} /> 进入复核
              </button>
            )}
          </div>
        </div>

        {/* 退回提示 */}
        {detail.status === 'returned' && returnReasonText && (
          <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
            <AlertCircle size={16} className="text-red-500 mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-red-700">已被财务退回，请修改后重新提交</p>
              <p className="text-red-600 mt-0.5">退回原因：{returnReasonText}</p>
            </div>
          </div>
        )}

        {/* PC端只读提示 & H5二维码（仅详情视图） */}
        {view === 'detail' && (
          <div className="mb-5 mt-4 grid md:grid-cols-2 gap-4">
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-blue-700 mb-2 flex items-center gap-1.5">
                💡 盘点操作指引
              </h3>
              <ul className="text-xs text-blue-600 space-y-1 list-disc list-inside">
                <li>盘点录入和财务复核建议在手机端操作，方便手写签名</li>
                <li>可扫描右侧二维码在手机打开，或点击「重新生成链接」发送到企微</li>
                <li>草稿状态下PC端可直接编辑实盘数量，但签名仍需在手机端</li>
              </ul>
              <div className="mt-3 flex gap-2 flex-wrap">
                <button onClick={() => onRefreshToken(detail.id)} disabled={refreshingUrl}
                  className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1">
                  <QrCode size={14} /> 重新生成访问链接
                </button>
                {detail.status === 'completed' && (
                  <button onClick={() => onExportPdf(detail.id)}
                    className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1">
                    <FileDown size={14} /> 导出盘点报告
                  </button>
                )}
              </div>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col items-center justify-center">
              <p className="text-xs text-gray-500 mb-2">手机扫码打开 H5 页面</p>
              {refreshUrlData && refreshUrlData.stock_take_id === detail.id ? (
                <div className="text-center space-y-2">
                  <div className="grid grid-cols-2 gap-2 text-[10px] text-gray-500">
                    <div>
                      <p className="mb-1">盘点人入口</p>
                      <div className="bg-gray-50 p-2 rounded">
                        <QRCodeSVG value={refreshUrlData.operator_url} size={80} />
                      </div>
                    </div>
                    <div>
                      <p className="mb-1">财务复核入口</p>
                      <div className="bg-gray-50 p-2 rounded">
                        <QRCodeSVG value={refreshUrlData.reviewer_url} size={80} />
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-gray-400 text-xs">
                  点击左侧「重新生成访问链接」后展示
                </div>
              )}
            </div>
          </div>
        )}

        {/* 签名展示（已完成状态） */}
        {detail?.status === 'completed' && (
          <div className="mb-5 bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">双方签字确认</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center">
                <p className="text-xs text-gray-500 mb-2">盘点人：{detail.operator_name || '-'}</p>
                {detail.operator_signature ? (
                  <img src={detail.operator_signature} alt="盘点人签名"
                    className="max-h-20 mx-auto border border-gray-200 rounded p-1 bg-white" />
                ) : (
                  <div className="h-20 flex items-center justify-center text-gray-300 border border-dashed border-gray-200 rounded">未签名</div>
                )}
                <p className="text-[10px] text-gray-400 mt-1">盘点日期：{detail.updated_at?.slice(0, 10) || '-'}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500 mb-2">财务复核：{detail.reviewed_by_name || '-'}</p>
                {detail.reviewer_signature ? (
                  <img src={detail.reviewer_signature} alt="财务签名"
                    className="max-h-20 mx-auto border border-gray-200 rounded p-1 bg-white" />
                ) : (
                  <div className="h-20 flex items-center justify-center text-gray-300 border border-dashed border-gray-200 rounded">未签名</div>
                )}
                <p className="text-[10px] text-gray-400 mt-1">复核日期：{detail.reviewed_at?.slice(0, 10) || '-'}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 筛选 / 辅助工具（仅编辑态显示） */}
      {isEditView && editable && (
        <div className="card flex flex-wrap items-center gap-3 py-4">
          <div className="flex items-center gap-2">
            <Filter size={16} className="text-gray-400" />
            <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="input-field w-40">
              <option value="">全部分类</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              placeholder="搜索物资名称 / 规格..."
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="input-field pl-9"
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-sm">
            <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-primary-500" />
            <span className="text-gray-700">只看差异</span>
          </label>
          <button onClick={fillAllWithSystem} className="btn-secondary text-sm flex items-center gap-1.5">
            <Check size={15} /> 全部实盘=系统
          </button>
          <span className="text-xs text-gray-400 ml-auto">显示 {filteredItems.length} / {editItems.length} 项</span>
        </div>
      )}

      {/* 明细表格 */}
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>分类</th>
                <th>物资名称</th>
                <th>规格</th>
                <th>单位</th>
                <th className="text-right">系统数量</th>
                <th className="text-right">系统价值</th>
                <th className="text-right">实盘数量</th>
                <th className="text-right">差异</th>
                <th className="text-right">实盘价值</th>
                <th>备注</th>
              </tr>
            </thead>
            <tbody>
              {(isEditView ? filteredItems : detail.items).map((it) => {
                const actual = it.actual_quantity;
                const diff = actual !== null ? actual - Number(it.system_quantity) : 0;
                const actualValue = actual !== null ? actual * Number(it.unit_price) : 0;
                const displayQty = actual !== null ? String(actual) : String(it.system_quantity);
                const isUnconfirmed = actual === null;
                return (
                  <tr key={it.id} className={diff !== 0 ? diffColor(diff).replace('text-', 'bg-').replace('-600', '-50/40') : ''}>
                    <td className="text-gray-600 whitespace-nowrap">{it.category_name || '-'}</td>
                    <td className="font-medium text-gray-800 whitespace-nowrap">{it.item_name}</td>
                    <td className="text-gray-500 text-xs whitespace-nowrap">{it.spec || '-'}</td>
                    <td className="text-gray-500 whitespace-nowrap">{it.unit || '-'}</td>
                    <td className="text-right text-gray-700 whitespace-nowrap">{Number(it.system_quantity)}</td>
                    <td className="text-right text-gray-700 whitespace-nowrap">{formatCurrency(it.system_value)}</td>
                    <td className="text-right whitespace-nowrap">
                      {isEditView && editable ? (
                        <input
                          type="number"
                          step="any"
                          value={displayQty}
                          onChange={(e) => {
                            const v = e.target.value;
                            updateItem(it.id, { actual_quantity: v === '' ? null : Number(v) });
                          }}
                          className={`w-24 text-right px-2 py-1 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 ${
                            isUnconfirmed ? 'bg-amber-50 border-amber-300' : 'border-gray-200'
                          }`}
                          placeholder={String(it.system_quantity)}
                        />
                      ) : (
                        <span className={isUnconfirmed ? 'text-gray-400 italic' : 'text-gray-800'}>
                          {actual !== null ? actual : '未录入'}
                        </span>
                      )}
                    </td>
                    <td className={`text-right font-semibold whitespace-nowrap ${diffColor(diff)}`}>
                      {diff > 0 ? '+' : ''}{diff}
                    </td>
                    <td className="text-right text-gray-700 whitespace-nowrap">{formatCurrency(actualValue)}</td>
                    <td className="text-gray-500 text-xs">
                      {isEditView && editable ? (
                        <input
                          type="text"
                          value={it.remark || ''}
                          onChange={(e) => updateItem(it.id, { remark: e.target.value })}
                          className="w-full min-w-[100px] px-2 py-1 border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                          placeholder="备注"
                        />
                      ) : (it.remark || '-')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {(isEditView ? filteredItems : detail.items).length === 0 && (
          <div className="text-center py-10 text-gray-400 text-sm">无符合条件的明细</div>
        )}
      </div>

      {/* sticky 汇总 + 操作（编辑态） */}
      {isEditView && editable && (
        <div className="sticky bottom-0 z-10 bg-white border border-gray-200 rounded-xl shadow-lg p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <div>
                <span className="text-gray-500">物资数：</span>
                <span className="font-semibold text-gray-800">{summary.total}</span>
              </div>
              <div>
                <span className="text-gray-500">已录入：</span>
                <span className={`font-semibold ${summary.unfilled > 0 ? 'text-warning-600' : 'text-success-600'}`}>
                  {summary.filled}/{summary.total}
                </span>
              </div>
              <div>
                <span className="text-gray-500">差异条数：</span>
                <span className={`font-semibold ${summary.diffCount > 0 ? 'text-danger-600' : 'text-gray-800'}`}>{summary.diffCount}</span>
              </div>
              <div>
                <span className="text-gray-500">系统价值：</span>
                <span className="font-semibold text-gray-800">{formatCurrency(summary.sysValue)}</span>
              </div>
              <div>
                <span className="text-gray-500">实盘价值：</span>
                <span className="font-semibold text-gray-800">{formatCurrency(summary.actualValue)}</span>
              </div>
              <div>
                <span className="text-gray-500">差异金额：</span>
                <span className={`font-semibold ${diffColor(summary.diffValue)}`}>
                  {summary.diffValue > 0 ? '+' : ''}{formatCurrency(summary.diffValue)}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {detail.status === 'draft' && (
                <button onClick={onCancel} disabled={saving || submitting}
                  className="btn-secondary flex items-center gap-2 border border-red-300 text-red-600 hover:bg-red-50">
                  <Trash2 size={16} />
                  取消盘点
                </button>
              )}
              {modifiedCount > 0 && (
                <span className="text-xs text-warning-600">已修改 {modifiedCount} 项未保存</span>
              )}
              <button onClick={onSave} disabled={saving || submitting} className="btn-secondary flex items-center gap-2">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                保存
              </button>
              <button onClick={() => {
                if (window.confirm('PC端提交复核无法完成手写签名。\\n建议在手机 H5 页面提交以完成盘点人手写签名。\\n\\n是否仍要在 PC 端继续提交（签名将留空，需在手机端补签）？')) {
                  onSubmit();
                }
              }} disabled={saving || submitting} className="btn-primary flex items-center gap-2">
                {submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                提交复核
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 详情视图：成本汇总（已完成） + 复核信息 */}
      {view === 'detail' && isCompleted && (
        <>
          {/* 复核信息 */}
          <div className="card">
            <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <CheckCircle2 size={18} className="text-success-500" /> 复核信息
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-gray-500 text-xs">复核人</p>
                <p className="font-medium text-gray-800">{detail.reviewed_by_name || '-'}</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs">复核时间</p>
                <p className="font-medium text-gray-800">{formatDateTime(detail.reviewed_at)}</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs">复核结果</p>
                <p className="font-medium text-success-600">
                  {detail.review_result === 'match' ? '抽样一致，已通过' : detail.review_result || '-'}
                </p>
              </div>
              <div>
                <p className="text-gray-500 text-xs">实盘总价值</p>
                <p className="font-semibold text-gray-800">{formatCurrency(detail.total_value)}</p>
              </div>
            </div>
          </div>

          {/* 成本差异汇总 */}
          {costSummary && Object.keys(costSummary).length > 0 && (
            <div className="card">
              <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                <TrendingUp size={18} className="text-primary-600" /> 按分类差异汇总
              </h3>
              <div className="space-y-3">
                {Object.entries(costSummary).map(([cat, info]) => (
                  <div key={cat} className="border border-gray-200 rounded-lg overflow-hidden">
                    <div className="bg-gray-50 px-4 py-2 flex items-center justify-between">
                      <span className="font-medium text-gray-800">{cat}</span>
                      <span className={`font-semibold ${diffColor(info.total_diff)}`}>
                        合计：{info.total_diff > 0 ? '+' : ''}{formatCurrency(info.total_diff)}
                      </span>
                    </div>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>物资名称</th>
                          <th className="text-right">差异数量</th>
                          <th className="text-right">差异金额</th>
                        </tr>
                      </thead>
                      <tbody>
                        {info.items.map((it, idx) => (
                          <tr key={idx}>
                            <td className="text-gray-700">{it.item_name}</td>
                            <td className={`text-right font-medium ${diffColor(it.difference)}`}>
                              {it.difference > 0 ? '+' : ''}{it.difference}
                            </td>
                            <td className={`text-right font-semibold ${diffColor(it.diff_value)}`}>
                              {it.diff_value > 0 ? '+' : ''}{formatCurrency(it.diff_value)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ================================================================
// 子组件：复核视图
// ================================================================
interface ReviewViewProps {
  loading: boolean;
  detail: StockTakeDetail | null;
  samples: ReviewSample[];
  error: string;
  canEdit: boolean;
  updateSample: (id: string, qty: number | null) => void;
  onPass: () => void;
  onOpenReturn: () => void;
  actionLoading: boolean;
}

function ReviewView({ loading, detail, samples, error, canEdit, updateSample, onPass, onOpenReturn, actionLoading }: ReviewViewProps) {
  if (loading) {
    return <div className="card text-center py-16 text-gray-500"><Loader2 className="animate-spin inline mr-2" size={18} />初始化复核中...</div>;
  }

  return (
    <div className="space-y-4">
      {/* 头部 */}
      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-xl font-semibold text-gray-800 flex items-center gap-2">
                <Gavel size={20} className="text-purple-600" /> 财务复核
              </h2>
              {detail && <StatusBadge status={detail.status} size="md" />}
            </div>
            {detail && (
              <div className="text-sm text-gray-500 flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="font-medium text-gray-700">{detail.warehouse_name}</span>
                <span className="font-mono">{detail.take_no}</span>
                <span>{detail.take_type === 'annual' ? '归属年度' : '归属月份'}：<span className="text-gray-700">{formatPeriod(detail.period_month, detail.take_type)}</span></span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 说明 */}
      <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 flex items-start gap-3">
        <AlertCircle size={18} className="text-purple-500 mt-0.5 shrink-0" />
        <div className="text-sm text-purple-700">
          <p className="font-medium">抽样复核说明</p>
          <p className="mt-0.5 text-purple-600">系统已随机抽取以下 {samples.length} 项物资，请财务现场核验后填入「核验数量」。若与盘点人填报数量完全一致则复核通过；否则需退回重新盘点。</p>
        </div>
      </div>

      {error && (
        <div className="bg-danger-50 border border-danger-200 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle size={20} className="text-danger-500 mt-0.5 shrink-0" />
          <span className="text-danger-700 flex-1 text-sm">{error}</span>
        </div>
      )}

      {/* 抽样表 */}
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th className="w-12 text-center">#</th>
                <th>物资名称</th>
                <th>规格</th>
                <th>单位</th>
                <th className="text-right">盘点人填报数量</th>
                <th className="text-right">财务核验数量</th>
                <th className="text-center">一致性</th>
              </tr>
            </thead>
            <tbody>
              {samples.map((s, idx) => {
                const matched = s.matched;
                return (
                  <tr key={s.item_detail_id} className={matched === false ? 'bg-red-50' : ''}>
                    <td className="text-center text-gray-400">{idx + 1}</td>
                    <td className="font-medium text-gray-800 whitespace-nowrap">{s.item_name}</td>
                    <td className="text-gray-500 text-xs whitespace-nowrap">{s.spec || '-'}</td>
                    <td className="text-gray-500 whitespace-nowrap">{s.unit || '-'}</td>
                    <td className="text-right text-gray-800 whitespace-nowrap font-medium">
                      {s.actual_quantity !== null && s.actual_quantity !== undefined ? s.actual_quantity : '-'}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      {canEdit ? (
                        <input
                          type="number"
                          step="any"
                          value={s.verify_quantity !== null && s.verify_quantity !== undefined ? String(s.verify_quantity) : ''}
                          onChange={(e) => {
                            const v = e.target.value;
                            updateSample(s.item_detail_id, v === '' ? null : Number(v));
                          }}
                          className="w-28 text-right px-2 py-1 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                          placeholder="核验数量"
                        />
                      ) : (
                        <span className="text-gray-800">{s.verify_quantity ?? '-'}</span>
                      )}
                    </td>
                    <td className="text-center whitespace-nowrap">
                      {matched === true && (
                        <span className="inline-flex items-center gap-1 text-success-600 text-sm"><Check size={14} /> 一致</span>
                      )}
                      {matched === false && (
                        <span className="inline-flex items-center gap-1 text-danger-600 text-sm"><X size={14} /> 不一致</span>
                      )}
                      {matched === null && <span className="text-gray-300 text-sm">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {samples.length === 0 && (
          <div className="text-center py-10 text-gray-400 text-sm">暂无抽样数据</div>
        )}
      </div>

      {/* 操作按钮 */}
      {canEdit && (
        <div className="sticky bottom-0 z-10 bg-white border border-gray-200 rounded-xl shadow-lg p-4 flex items-center justify-end gap-2">
          <button
            onClick={onOpenReturn}
            disabled={actionLoading}
            className="bg-danger-500 hover:bg-danger-600 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 disabled:opacity-50"
          >
            <RotateCcw size={16} /> 退回修改
          </button>
          <button
            onClick={onPass}
            disabled={actionLoading}
            className="btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            {actionLoading ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            确认复核通过
          </button>
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`relative px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
        active
          ? 'text-primary-600 border-primary-600'
          : 'text-gray-500 border-transparent hover:text-gray-700 hover:border-gray-300'
      }`}
    >
      {children}
    </button>
  );
}

const TrendChart = React.lazy(() => import('@/components/TrendChart'));
