import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Warehouse as WarehouseIcon,
  Plus,
  ChevronDown,
  ChevronUp,
  Pencil,
  Send,
  Trash2,
  PackageCheck,
  Bell,
  FileDown,
  Download,
  RefreshCw,
  RotateCcw,
  X,
  AlertCircle,
  CheckCircle2,
  Clock,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { api } from '@/lib/api';
import { formatCurrency } from '@/utils/format';

// ====== 类型定义 ======

// 采购单状态
type PurchaseStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'received'
  | 'confirming'
  | 'confirmed'
  | 'reimbursing'
  | 'reimbursed'
  | 'cancelled';

// 采购物资明细
interface PurchaseItem {
  id: string;
  item_id?: string;
  item_name: string;
  spec?: string;
  unit?: string;
  quantity: number;
  unit_price: number;
  amount: number;
  warehouse_id?: string;
  warehouse_name?: string;
  department_id?: string;
  department_name?: string;
  reason?: string;
  // 收货录入信息
  received_quantity?: number;
  received_unit?: string;
  received_unit_price?: number;
  received_spec?: string;
}

// 确认部门
interface ConfirmDepartment {
  id: string;
  name: string;
  confirmed: boolean;
  confirmed_by?: string;
  confirmed_at?: string;
}

// 采购单
interface WarehousePurchase {
  id: string;
  purchase_no?: string;
  status: PurchaseStatus;
  warehouse_id?: string;
  warehouse_name?: string;
  total_amount: number;
  created_at?: string;
  updated_at?: string;
  items?: PurchaseItem[];
  pdf_url?: string;
  // 报销相关
  reimbursement_no?: string;
  reimbursement_sp_no?: string;
  reimbursement_status?: string;
  rejection_reason?: string;
  // 确认进度
  confirm_total?: number;
  confirm_confirmed?: number;
  confirmation_departments?: ConfirmDepartment[];
  remark?: string;
  operator?: string;
  // 采购类型相关
  purchase_type?: 'normal' | 'prepay' | 'monthly';
  supplier_id?: string;
  supplier_name?: string;
  prepay_amount?: number;
  prepay_sp_no?: string;
  prepay_status?: string;
  writeoff_status?: string;
}

// 列表分页响应
interface ListResponse {
  data: WarehousePurchase[];
  total: number;
  page: number;
  page_size: number;
}

// 收货表单行
interface ReceiveFormRow {
  itemId: string;
  itemName: string;
  warehouseName: string;
  received_quantity: string;
  received_unit: string;
  received_unit_price: string;
  received_spec: string;
}

// ====== 状态显示配置 ======

// 状态对应的中文文本与颜色（参考状态颜色映射）
const STATUS_CONFIG: Record<PurchaseStatus, { text: string; color: string }> = {
  draft: { text: '草稿', color: 'bg-gray-100 text-gray-700' },
  pending_approval: { text: '审批中', color: 'bg-blue-50 text-blue-700' },
  approved: { text: '审批通过', color: 'bg-green-50 text-green-700' },
  rejected: { text: '审批拒绝', color: 'bg-red-50 text-red-700' },
  received: { text: '已收货', color: 'bg-cyan-50 text-cyan-700' },
  confirming: { text: '确认中', color: 'bg-yellow-50 text-yellow-700' },
  confirmed: { text: '已确认', color: 'bg-teal-50 text-teal-700' },
  reimbursing: { text: '报销中', color: 'bg-indigo-50 text-indigo-700' },
  reimbursed: { text: '已报销', color: 'bg-green-50 text-green-700' },
  cancelled: { text: '已取消', color: 'bg-gray-100 text-gray-700' },
};

// 状态筛选标签栏
const STATUS_TABS: Array<{ label: string; value: string }> = [
  { label: '全部', value: '' },
  { label: '草稿', value: 'draft' },
  { label: '审批中', value: 'pending_approval' },
  { label: '已通过', value: 'approved' },
  { label: '已收货', value: 'received' },
  { label: '确认中', value: 'confirming' },
  { label: '已确认', value: 'confirmed' },
  { label: '报销中', value: 'reimbursing' },
  { label: '已报销', value: 'reimbursed' },
];

// 分页大小
const PAGE_SIZE = 20;

// ====== 工具函数 ======

// 安全数值解析（兼容后端 Decimal 对象 { String: '...' }）
const safeNum = (val: any): number => {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (typeof val === 'object') {
    val = val.String || val.string || JSON.stringify(val);
  }
  const n = parseFloat(String(val));
  return isNaN(n) ? 0 : n;
};

// 格式化日期时间
const formatDateTime = (dateStr?: string): string => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// 获取确认进度（已确认/总数）
const getConfirmProgress = (p: WarehousePurchase): { confirmed: number; total: number } => {
  if (p.confirmation_departments && p.confirmation_departments.length > 0) {
    return {
      confirmed: p.confirmation_departments.filter((d) => d.confirmed).length,
      total: p.confirmation_departments.length,
    };
  }
  return {
    confirmed: safeNum(p.confirm_confirmed),
    total: safeNum(p.confirm_total),
  };
};

export default function WarehousePurchaseList() {
  const navigate = useNavigate();

  // 列表数据
  const [purchases, setPurchases] = useState<WarehousePurchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 筛选与分页
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  // 展开的卡片ID
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // 展开详情的加载状态
  const [detailLoading, setDetailLoading] = useState(false);

  // 收货弹窗
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [receiveTarget, setReceiveTarget] = useState<WarehousePurchase | null>(null);
  const [receiveRows, setReceiveRows] = useState<ReceiveFormRow[]>([]);
  const [receiveSubmitting, setReceiveSubmitting] = useState(false);

  // 操作中的采购单ID（按钮 loading）
  const [actioningId, setActioningId] = useState<string | null>(null);

  // ===== 加载列表 =====
  const fetchList = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params: Record<string, any> = { page, page_size: PAGE_SIZE };
      if (statusFilter) params.status = statusFilter;
      const res = await api.get<ListResponse>('/warehouse-purchases', { params });
      setPurchases(res.data || []);
      setTotal(res.total || 0);
    } catch (err: any) {
      setError(err.message || '获取采购单列表失败');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  // 切换状态筛选时回到第一页
  const handleTabChange = (value: string) => {
    setStatusFilter(value);
    setPage(1);
    setExpandedId(null);
  };

  // ===== 展开/折叠卡片，并拉取详情 =====
  const handleToggleExpand = async (p: WarehousePurchase) => {
    if (expandedId === p.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(p.id);
    // 拉取详情（含 items）
    setDetailLoading(true);
    try {
      const detail = await api.get<WarehousePurchase>(`/warehouse-purchases/${p.id}`);
      setPurchases((prev) => prev.map((it) => (it.id === p.id ? { ...it, ...detail } : it)));
    } catch (err: any) {
      setError(err.message || '获取详情失败');
    } finally {
      setDetailLoading(false);
    }
  };

  // ===== 提交审批 =====
  const handleSubmit = async (id: string) => {
    if (!window.confirm('确定提交审批吗？提交后将无法编辑。')) return;
    setActioningId(id);
    try {
      await api.post(`/warehouse-purchases/${id}/submit`);
      await fetchList();
    } catch (err: any) {
      setError(err.message || '提交审批失败');
    } finally {
      setActioningId(null);
    }
  };

  // ===== 打开收货弹窗 =====
  const openReceiveModal = (p: WarehousePurchase) => {
    setReceiveTarget(p);
    // 用明细初始化收货表单，默认实收数量=采购数量
    const rows: ReceiveFormRow[] = (p.items || []).map((it) => ({
      itemId: it.id,
      itemName: it.item_name,
      warehouseName: it.warehouse_name || '',
      received_quantity: String(safeNum(it.received_quantity) || safeNum(it.quantity)),
      received_unit: it.received_unit || it.unit || '',
      received_unit_price: String(
        safeNum(it.received_unit_price) || safeNum(it.unit_price),
      ),
      received_spec: it.received_spec || it.spec || '',
    }));
    setReceiveRows(rows);
    setShowReceiveModal(true);
  };

  // ===== 提交收货 =====
  const handleReceiveSubmit = async () => {
    if (!receiveTarget) return;
    // 校验：实收数量不能为空或负数
    for (const row of receiveRows) {
      const qty = parseFloat(row.received_quantity);
      if (isNaN(qty) || qty < 0) {
        setError(`物资「${row.itemName}」的实收数量无效`);
        return;
      }
      if (!row.received_unit.trim()) {
        setError(`物资「${row.itemName}」的单位不能为空`);
        return;
      }
    }
    setReceiveSubmitting(true);
    setError('');
    try {
      const payload = {
        items: receiveRows.map((r) => ({
          id: r.itemId,
          received_quantity: parseFloat(r.received_quantity) || 0,
          received_unit: r.received_unit.trim(),
          received_unit_price: parseFloat(r.received_unit_price) || 0,
          received_spec: r.received_spec.trim(),
        })),
      };
      await api.post(`/warehouse-purchases/${receiveTarget.id}/receive`, payload);
      setShowReceiveModal(false);
      setReceiveTarget(null);
      await fetchList();
    } catch (err: any) {
      setError(err.message || '收货录入失败');
    } finally {
      setReceiveSubmitting(false);
    }
  };

  // ===== 发送确认通知 =====
  const handleSendConfirm = async (id: string) => {
    if (!window.confirm('确定发送确认通知吗？')) return;
    setActioningId(id);
    try {
      await api.post(`/warehouse-purchases/${id}/send-confirm`);
      await fetchList();
    } catch (err: any) {
      setError(err.message || '发送确认通知失败');
    } finally {
      setActioningId(null);
    }
  };

  // ===== 生成 PDF =====
  const handleGeneratePDF = async (id: string) => {
    setActioningId(id);
    try {
      await api.post(`/warehouse-purchases/${id}/generate-pdf`);
      await fetchList();
    } catch (err: any) {
      setError(err.message || 'PDF 生成失败');
    } finally {
      setActioningId(null);
    }
  };

  // ===== 下载 PDF（需用 fetch + token，不能用 api.get） =====
  const handleDownloadPDF = async (id: string) => {
    try {
      const token = api.getToken();
      const response = await fetch(
        `${api.getBaseUrl()}/warehouse-purchases/${id}/pdf`,
        {
          headers: { Authorization: token ? `Bearer ${token}` : '' },
        },
      );
      if (!response.ok) {
        throw new Error('下载失败');
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `warehouse_purchase_${id}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message || '下载失败');
    }
  };

  // ===== 刷新审批状态 =====
  const handleRefreshStatus = async (id: string) => {
    setActioningId(id);
    try {
      const data = await api.post<WarehousePurchase>(
        `/warehouse-purchases/${id}/refresh-status`,
      );
      setPurchases((prev) => prev.map((it) => (it.id === id ? { ...it, ...data } : it)));
    } catch (err: any) {
      setError(err.message || '刷新状态失败');
    } finally {
      setActioningId(null);
    }
  };

  // ===== 重新发起报销 / 发起报销 =====
  const handleResubmit = async (id: string) => {
    if (!window.confirm('确定发起/重新发起报销吗？')) return;
    setActioningId(id);
    try {
      await api.post(`/warehouse-purchases/${id}/resubmit`);
      await fetchList();
    } catch (err: any) {
      setError(err.message || '发起报销失败');
    } finally {
      setActioningId(null);
    }
  };

  // ===== 预付款相关操作 =====
  const handleSubmitPrepay = async (id: string) => {
    if (!window.confirm('确定发起预付款审批吗？')) return;
    setActioningId(id);
    try {
      await api.post(`/warehouse-purchases/${id}/submit-prepay`);
      await fetchList();
    } catch (err: any) {
      setError(err.message || '发起预付款审批失败');
    } finally {
      setActioningId(null);
    }
  };

  const handleRefreshPrepay = async (id: string) => {
    setActioningId(id);
    try {
      await api.post(`/warehouse-purchases/${id}/refresh-prepay`);
      await fetchList();
    } catch (err: any) {
      setError(err.message || '刷新预付款审批状态失败');
    } finally {
      setActioningId(null);
    }
  };

  const handlePrepayVoucher = async (id: string) => {
    const voucherNo = window.prompt('请输入付款凭证号/银行流水号：');
    if (voucherNo === null) return;
    setActioningId(id);
    try {
      await api.post(`/warehouse-purchases/${id}/prepay-voucher`, {
        payment_voucher_no: voucherNo || '',
        payment_voucher_at: new Date().toISOString(),
      });
      await fetchList();
    } catch (err: any) {
      setError(err.message || '回填付款凭证失败');
    } finally {
      setActioningId(null);
    }
  };

  const handleWriteoffPrepay = async (id: string) => {
    if (!window.confirm('确定手动核销预付款吗？')) return;
    setActioningId(id);
    try {
      const result = await api.post<{ message: string }>(`/warehouse-purchases/${id}/writeoff-prepay`);
      alert(result.message || '核销完成');
      await fetchList();
    } catch (err: any) {
      setError(err.message || '核销失败');
    } finally {
      setActioningId(null);
    }
  };

  // ===== 删除 =====
  const handleDelete = async (id: string) => {
    if (!window.confirm('确定删除该采购单吗？删除后不可恢复。')) return;
    setActioningId(id);
    try {
      await api.delete(`/warehouse-purchases/${id}`);
      setPurchases((prev) => prev.filter((it) => it.id !== id));
      if (expandedId === id) setExpandedId(null);
    } catch (err: any) {
      setError(err.message || '删除失败');
    } finally {
      setActioningId(null);
    }
  };

  // ===== 分页计算 =====
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // 是否有 PDF 可下载
  const hasPdf = (p: WarehousePurchase) => !!p.pdf_url;

  return (
    <div className="space-y-6">
      {/* 页头 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold text-gray-800">仓库采购</h1>
          <p className="text-gray-500 mt-1">管理仓库采购单的创建、审批、收货与报销</p>
        </div>
        <button
          onClick={() => navigate('/warehouse-purchase/create')}
          className="btn-primary flex items-center gap-2"
        >
          <Plus size={18} />
          <span>新建采购</span>
        </button>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="bg-danger-50 border border-danger-200 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle size={20} className="text-danger-500" />
          <span className="text-danger-700 flex-1">{error}</span>
          <button onClick={() => setError('')} className="p-1 hover:bg-danger-100 rounded-md">
            <X size={16} className="text-danger-500" />
          </button>
        </div>
      )}

      {/* 状态筛选标签栏 */}
      <div className="flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value || 'all'}
            onClick={() => handleTabChange(tab.value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              statusFilter === tab.value
                ? 'bg-primary-500 text-white shadow-sm'
                : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 列表 */}
      {loading ? (
        <div className="text-center py-10 text-gray-500">加载中...</div>
      ) : purchases.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-20">
          <WarehouseIcon size={64} className="text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-600 mb-2">暂无采购单</h3>
          <p className="text-gray-400 text-sm">点击"新建采购"开始创建</p>
        </div>
      ) : (
        <div className="space-y-2">
          {purchases.map((p) => {
            const statusConf = STATUS_CONFIG[p.status] || {
              text: p.status,
              color: 'bg-gray-100 text-gray-700',
            };
            const progress = getConfirmProgress(p);
            const expanded = expandedId === p.id;
            const items = p.items || [];
            // 汇总涉及仓库
            const warehouseNames = items.length > 0
              ? Array.from(new Set(items.map(i => i.warehouse_name).filter(Boolean)))
              : (p.warehouse_name ? [p.warehouse_name] : []);
            return (
              <div key={p.id} className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                {/* 卡片头部 - 点击展开 */}
                <div
                  className="flex items-center justify-between px-4 py-3 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors"
                  onClick={() => handleToggleExpand(p)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {expanded ? (
                      <ChevronUp size={16} className="text-gray-400 flex-shrink-0" />
                    ) : (
                      <ChevronDown size={16} className="text-gray-400 flex-shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-gray-800">
                          {p.purchase_no || `采购单 ${p.id.substring(0, 8)}`}
                        </span>
                        {/* 采购类型标签 */}
                        {p.purchase_type === 'prepay' && (
                          <span className="px-1.5 py-0.5 rounded text-xs bg-orange-100 text-orange-700 font-medium">预付款</span>
                        )}
                        {p.purchase_type === 'monthly' && (
                          <span className="px-1.5 py-0.5 rounded text-xs bg-purple-100 text-purple-700 font-medium">月结</span>
                        )}
                        {(!p.purchase_type || p.purchase_type === 'normal') && (
                          <span className="px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-700 font-medium">现购</span>
                        )}
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusConf.color}`}
                        >
                          {statusConf.text}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
                        <span className="flex items-center gap-1">
                          <WarehouseIcon size={12} />
                          {warehouseNames.length > 0 ? warehouseNames.join(' + ') : '未指定仓库'}
                          {warehouseNames.length > 1 && (
                            <span className="text-primary-500">({warehouseNames.length}个)</span>
                          )}
                        </span>
                        <span>·</span>
                        <span className="text-gray-700 font-medium">
                          {formatCurrency(safeNum(p.total_amount))}
                        </span>
                        {/* 供应商和预付款信息 */}
                        {p.supplier_name && (
                          <>
                            <span>·</span>
                            <span className="text-gray-600">{p.supplier_name}</span>
                          </>
                        )}
                        {p.purchase_type === 'prepay' && p.prepay_amount && (
                          <>
                            <span>·</span>
                            <span className="text-orange-600">预付{formatCurrency(safeNum(p.prepay_amount))}</span>
                          </>
                        )}
                        {p.writeoff_status === 'auto' && (
                          <>
                            <span>·</span>
                            <span className="text-green-600">已核销</span>
                          </>
                        )}
                        {p.writeoff_status === 'manual' && (
                          <>
                            <span>·</span>
                            <span className="text-orange-600">待核销</span>
                          </>
                        )}
                        {progress.total > 0 && (
                          <>
                            <span>·</span>
                            <span className="text-primary-600">
                              确认进度 {progress.confirmed}/{progress.total}
                            </span>
                          </>
                        )}
                        <span>·</span>
                        <span>{formatDateTime(p.created_at)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {/* 非 draft 状态且已有 PDF：快捷下载 */}
                    {p.status !== 'draft' && hasPdf(p) && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownloadPDF(p.id);
                        }}
                        className="text-xs text-green-600 hover:text-green-700 flex items-center gap-1"
                      >
                        <Download size={14} />
                        PDF
                      </button>
                    )}
                  </div>
                </div>

                {/* 展开详情 */}
                {expanded && (
                  <div className="px-4 py-3 border-t border-gray-200 space-y-3">
                    {detailLoading ? (
                      <div className="text-center py-6 text-gray-400 text-sm">加载详情中...</div>
                    ) : (
                      <>
                        {/* 基本信息 */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                          <div className="bg-gray-50 rounded-lg p-2">
                            <p className="text-gray-500">采购单号</p>
                            <p className="font-medium text-gray-800 mt-0.5">
                              {p.purchase_no || '未生成'}
                            </p>
                          </div>
                          <div className="bg-gray-50 rounded-lg p-2">
                            <p className="text-gray-500">入库仓库</p>
                            <p className="font-medium text-gray-800 mt-0.5">
                              {warehouseNames.length > 0 ? warehouseNames.join('、') : '-'}
                            </p>
                          </div>
                          <div className="bg-gray-50 rounded-lg p-2">
                            <p className="text-gray-500">总金额</p>
                            <p className="font-medium text-primary-600 mt-0.5">
                              {formatCurrency(safeNum(p.total_amount))}
                            </p>
                          </div>
                          <div className="bg-gray-50 rounded-lg p-2">
                            <p className="text-gray-500">创建时间</p>
                            <p className="font-medium text-gray-800 mt-0.5">
                              {formatDateTime(p.created_at)}
                            </p>
                          </div>
                        </div>

                        {/* 报销单号信息 */}
                        {(p.reimbursement_sp_no || p.reimbursement_no) && (
                          <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-2 text-xs text-indigo-700">
                            <span className="font-medium">报销单号：</span>
                            {p.reimbursement_sp_no || p.reimbursement_no}
                          </div>
                        )}

                        {/* 拒绝原因 */}
                        {p.rejection_reason && (
                          <div className="bg-red-50 border border-red-100 rounded-lg p-2 text-xs text-red-700">
                            <span className="font-medium">拒绝原因：</span>
                            {p.rejection_reason}
                          </div>
                        )}

                        {/* 确认进度明细 */}
                        {p.confirmation_departments && p.confirmation_departments.length > 0 && (
                          <div className="bg-primary-50 border border-primary-100 rounded-lg p-2">
                            <p className="text-xs text-primary-700 font-medium mb-1">
                              确认进度 {progress.confirmed}/{progress.total}
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {p.confirmation_departments.map((d) => (
                                <div key={d.id} className="flex items-center gap-1 text-xs">
                                  {d.confirmed ? (
                                    <CheckCircle2 size={12} className="text-green-500" />
                                  ) : (
                                    <Clock size={12} className="text-gray-400" />
                                  )}
                                  <span className={d.confirmed ? 'text-green-700' : 'text-gray-600'}>
                                    {d.name}
                                  </span>
                                  {d.confirmed && d.confirmed_at && (
                                    <span className="text-gray-400">
                                      {formatDateTime(d.confirmed_at)}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* 物资明细表格 */}
                        {items.length > 0 && (
                          <div>
                            <p className="text-xs text-gray-500 mb-1">物资明细</p>
                            <div className="bg-gray-50 rounded-lg overflow-hidden max-h-64 overflow-y-auto">
                              <table className="w-full text-xs">
                                <thead className="bg-gray-100 text-gray-600 sticky top-0">
                                  <tr>
                                    <th className="px-3 py-2 text-left">仓库</th>
                                    <th className="px-3 py-2 text-left">物资名称</th>
                                    <th className="px-3 py-2 text-left">规格</th>
                                    <th className="px-3 py-2 text-left">单位</th>
                                    <th className="px-3 py-2 text-right">数量</th>
                                    <th className="px-3 py-2 text-right">单价</th>
                                    <th className="px-3 py-2 text-right">金额</th>
                                    <th className="px-3 py-2 text-left">使用部门</th>
                                    <th className="px-3 py-2 text-left">采购理由</th>
                                    <th className="px-3 py-2 text-right">实收数量</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                  {items.map((it, idx) => (
                                    <tr key={it.id || idx}>
                                      <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                                        {it.warehouse_name || '-'}
                                      </td>
                                      <td className="px-3 py-2 text-gray-700">{it.item_name}</td>
                                      <td className="px-3 py-2 text-gray-500">{it.spec || '-'}</td>
                                      <td className="px-3 py-2 text-gray-500">{it.unit || '-'}</td>
                                      <td className="px-3 py-2 text-right text-gray-700">
                                        {safeNum(it.quantity)}
                                      </td>
                                      <td className="px-3 py-2 text-right text-gray-700">
                                        {safeNum(it.unit_price).toFixed(2)}
                                      </td>
                                      <td className="px-3 py-2 text-right font-medium text-gray-800">
                                        {safeNum(it.amount).toFixed(2)}
                                      </td>
                                      <td className="px-3 py-2 text-gray-500">
                                        {it.department_name || '-'}
                                      </td>
                                      <td className="px-3 py-2 text-gray-500">
                                        {it.reason || '-'}
                                      </td>
                                      <td className="px-3 py-2 text-right text-cyan-700">
                                        {it.received_quantity != null
                                          ? safeNum(it.received_quantity)
                                          : '-'}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}

                        {/* 操作按钮区（根据状态显示不同按钮） */}
                        <div className="flex gap-2 flex-wrap pt-1">
                          {/* draft: 编辑、提交审批、删除 */}
                          {p.status === 'draft' && (
                            <>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(`/warehouse-purchase/edit/${p.id}`);
                                }}
                                className="btn-secondary text-xs flex items-center gap-1"
                              >
                                <Pencil size={14} />
                                编辑
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSubmit(p.id);
                                }}
                                disabled={actioningId === p.id}
                                className="btn-primary text-xs flex items-center gap-1 disabled:opacity-50"
                              >
                                <Send size={14} />
                                提交审批
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDelete(p.id);
                                }}
                                disabled={actioningId === p.id}
                                className="btn-secondary text-xs flex items-center gap-1 text-red-500 hover:bg-red-50 ml-auto disabled:opacity-50"
                              >
                                <Trash2 size={14} />
                                删除
                              </button>
                            </>
                          )}

                          {/* approved: 录入收货 */}
                          {p.status === 'approved' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openReceiveModal(p);
                              }}
                              className="btn-primary text-xs flex items-center gap-1"
                            >
                              <PackageCheck size={14} />
                              录入收货
                            </button>
                          )}

                          {/* received: 发送确认通知 */}
                          {p.status === 'received' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSendConfirm(p.id);
                              }}
                              disabled={actioningId === p.id}
                              className="btn-primary text-xs flex items-center gap-1 disabled:opacity-50"
                            >
                              <Bell size={14} />
                              发送确认通知
                            </button>
                          )}

                          {/* confirming: 查看确认进度（展开即查看，提供刷新） */}
                          {p.status === 'confirming' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRefreshStatus(p.id);
                              }}
                              disabled={actioningId === p.id}
                              className="btn-secondary text-xs flex items-center gap-1 disabled:opacity-50"
                            >
                              <RefreshCw size={14} />
                              刷新进度
                            </button>
                          )}

                          {/* 预付款：发起预付款审批 */}
                          {p.purchase_type === 'prepay' && !p.prepay_sp_no && p.status !== 'draft' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSubmitPrepay(p.id);
                              }}
                              disabled={actioningId === p.id}
                              className="btn-primary text-xs flex items-center gap-1 bg-orange-600 hover:bg-orange-700 disabled:opacity-50"
                            >
                              <Send size={14} />
                              发起预付审批
                            </button>
                          )}

                          {/* 预付款审批中：刷新状态 */}
                          {p.purchase_type === 'prepay' && p.prepay_sp_no && p.prepay_status === 'pending' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRefreshPrepay(p.id);
                              }}
                              disabled={actioningId === p.id}
                              className="btn-secondary text-xs flex items-center gap-1 disabled:opacity-50"
                            >
                              <RefreshCw size={14} />
                              刷新预付审批
                            </button>
                          )}

                          {/* 预付款已通过：回填凭证 */}
                          {p.purchase_type === 'prepay' && p.prepay_status === 'approved' && !p.prepay_voucher_no && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handlePrepayVoucher(p.id);
                              }}
                              disabled={actioningId === p.id}
                              className="btn-primary text-xs flex items-center gap-1 bg-teal-600 hover:bg-teal-700 disabled:opacity-50"
                            >
                              <CheckCircle2 size={14} />
                              回填付款凭证
                            </button>
                          )}

                          {/* 预付款待核销：手动核销 */}
                          {p.purchase_type === 'prepay' && p.writeoff_status === 'manual' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleWriteoffPrepay(p.id);
                              }}
                              disabled={actioningId === p.id}
                              className="btn-secondary text-xs flex items-center gap-1 text-orange-600 disabled:opacity-50"
                            >
                              <RefreshCw size={14} />
                              手动核销
                            </button>
                          )}

                          {/* confirmed: 生成PDF、发起报销（预付款/月结不显示） */}
                          {p.status === 'confirmed' && p.purchase_type !== 'prepay' && p.purchase_type !== 'monthly' && (
                            <>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleGeneratePDF(p.id);
                                }}
                                disabled={actioningId === p.id}
                                className="btn-secondary text-xs flex items-center gap-1 disabled:opacity-50"
                              >
                                <FileDown size={14} />
                                生成PDF
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleResubmit(p.id);
                                }}
                                disabled={actioningId === p.id}
                                className="btn-primary text-xs flex items-center gap-1 disabled:opacity-50"
                              >
                                <RotateCcw size={14} />
                                发起报销
                              </button>
                            </>
                          )}

                          {/* reimbursing: 刷新状态 */}
                          {p.status === 'reimbursing' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRefreshStatus(p.id);
                              }}
                              disabled={actioningId === p.id}
                              className="btn-secondary text-xs flex items-center gap-1 disabled:opacity-50"
                            >
                              <RefreshCw size={14} />
                              刷新状态
                            </button>
                          )}

                          {/* 报销被拒绝：重新发起 */}
                          {p.reimbursement_status === 'rejected' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleResubmit(p.id);
                              }}
                              disabled={actioningId === p.id}
                              className="btn-primary text-xs flex items-center gap-1 disabled:opacity-50"
                            >
                              <RotateCcw size={14} />
                              重新发起
                            </button>
                          )}

                          {/* 所有状态(除draft)：下载PDF（如有） */}
                          {p.status !== 'draft' && hasPdf(p) && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDownloadPDF(p.id);
                              }}
                              className="btn-secondary text-xs flex items-center gap-1 text-green-600 hover:bg-green-50"
                            >
                              <Download size={14} />
                              下载PDF
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 分页 */}
      {!loading && total > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            共 {total} 条，第 {page}/{totalPages} 页
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="btn-secondary px-3 py-1.5 text-sm flex items-center gap-1 disabled:opacity-50"
            >
              <ChevronLeft size={14} />
              上一页
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="btn-secondary px-3 py-1.5 text-sm flex items-center gap-1 disabled:opacity-50"
            >
              下一页
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ===== 收货弹窗 ===== */}
      {showReceiveModal && receiveTarget && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => !receiveSubmitting && setShowReceiveModal(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div>
                <h3 className="text-lg font-semibold text-gray-800">录入收货</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  采购单：{receiveTarget.purchase_no || receiveTarget.id}
                </p>
              </div>
              <button
                onClick={() => !receiveSubmitting && setShowReceiveModal(false)}
                className="p-1 hover:bg-gray-100 rounded-md"
                disabled={receiveSubmitting}
              >
                <X size={20} className="text-gray-500" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {receiveRows.length === 0 ? (
                <div className="text-center py-10 text-gray-400">暂无物资明细</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600">
                      <tr>
                        <th className="px-3 py-2 text-left">仓库</th>
                        <th className="px-3 py-2 text-left">物资名称</th>
                        <th className="px-3 py-2 text-left">规格</th>
                        <th className="px-3 py-2 text-left">单位</th>
                        <th className="px-3 py-2 text-right">实收数量</th>
                        <th className="px-3 py-2 text-right">单价</th>
                        <th className="px-3 py-2 text-right">金额</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {receiveRows.map((row, idx) => {
                        const qty = parseFloat(row.received_quantity) || 0;
                        const price = parseFloat(row.received_unit_price) || 0;
                        return (
                          <tr key={row.itemId || idx}>
                            <td className="px-3 py-2 text-gray-600 whitespace-nowrap text-xs">
                              {row.warehouseName || '-'}
                            </td>
                            <td className="px-3 py-2 text-gray-800 font-medium">
                              {row.itemName}
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                value={row.received_spec}
                                onChange={(e) =>
                                  setReceiveRows((prev) =>
                                    prev.map((r, i) =>
                                      i === idx ? { ...r, received_spec: e.target.value } : r,
                                    ),
                                  )
                                }
                                className="w-28 border border-gray-200 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                value={row.received_unit}
                                onChange={(e) =>
                                  setReceiveRows((prev) =>
                                    prev.map((r, i) =>
                                      i === idx ? { ...r, received_unit: e.target.value } : r,
                                    ),
                                  )
                                }
                                className="w-20 border border-gray-200 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={row.received_quantity}
                                onChange={(e) =>
                                  setReceiveRows((prev) =>
                                    prev.map((r, i) =>
                                      i === idx ? { ...r, received_quantity: e.target.value } : r,
                                    ),
                                  )
                                }
                                className="w-24 text-right border border-gray-200 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={row.received_unit_price}
                                onChange={(e) =>
                                  setReceiveRows((prev) =>
                                    prev.map((r, i) =>
                                      i === idx ? { ...r, received_unit_price: e.target.value } : r,
                                    ),
                                  )
                                }
                                className="w-24 text-right border border-gray-200 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                              />
                            </td>
                            <td className="px-3 py-2 text-right font-medium text-gray-800">
                              {formatCurrency(qty * price)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 p-5 border-t border-gray-100">
              <button
                onClick={() => setShowReceiveModal(false)}
                className="btn-secondary"
                disabled={receiveSubmitting}
              >
                取消
              </button>
              <button
                onClick={handleReceiveSubmit}
                disabled={receiveSubmitting}
                className="btn-primary flex items-center gap-2 disabled:opacity-50"
              >
                <PackageCheck size={16} />
                {receiveSubmitting ? '提交中...' : '确认收货'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
