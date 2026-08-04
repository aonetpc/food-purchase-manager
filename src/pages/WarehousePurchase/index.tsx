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
  Download,
  RefreshCw,
  RotateCcw,
  X,
  AlertCircle,
  CheckCircle2,
  Clock,
  ChevronLeft,
  ChevronRight,
  FileText,
  ClipboardCheck,
  Paperclip,
  Upload,
  User,
} from 'lucide-react';
import { api } from '@/lib/api';
import { formatCurrency } from '@/utils/format';
import WarehousePurchaseProgress from '@/components/WarehousePurchaseProgress';
import { useAuthStore } from '@/store/authStore';

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
  not_arrived?: boolean;
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
  apply_pdf_path?: string;
  apply_pdf_url?: string;
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
  prepay_attachments?: Array<{ filename: string; path: string; mime: string; size: number }> | null;
  created_by_name?: string;
  created_by?: string;
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
  not_arrived: boolean;
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
  const { isAdmin, user } = useAuthStore();

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
  const [receiveLoading, setReceiveLoading] = useState(false);
  const [receiveSubmitting, setReceiveSubmitting] = useState(false);

  // 操作中的采购单ID（按钮 loading）
  const [actioningId, setActioningId] = useState<string | null>(null);

  // 预付款审批弹窗
  const [showPrepayModal, setShowPrepayModal] = useState(false);
  const [prepayTarget, setPrepayTarget] = useState<WarehousePurchase | null>(null);
  const [prepayAttachments, setPrepayAttachments] = useState<Array<{ filename: string; base64: string; mimeType: string }>>([]);
  const [prepaySubmitting, setPrepaySubmitting] = useState(false);

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
    setError('');
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
  const openReceiveModal = async (p: WarehousePurchase) => {
    setReceiveTarget(p);
    setShowReceiveModal(true);
    // 如果列表数据没有 items（未展开过），先加载详情
    let items = p.items;
    if (!items || items.length === 0) {
      setReceiveLoading(true);
      try {
        const detail = await api.get<WarehousePurchase>(`/warehouse-purchases/${p.id}`);
        items = detail.items || [];
        // 同步更新 purchases 中的数据
        setPurchases((prev) => prev.map((it) => (it.id === p.id ? { ...it, ...detail } : it)));
      } catch (err: any) {
        setError(err.message || '获取明细失败');
        setShowReceiveModal(false);
        setReceiveTarget(null);
        setReceiveLoading(false);
        return;
      } finally {
        setReceiveLoading(false);
      }
    }
    // 用明细初始化收货表单，默认实收数量=采购数量
    const rows: ReceiveFormRow[] = (items || []).map((it) => ({
      itemId: it.id,
      itemName: it.item_name,
      warehouseName: it.warehouse_name || '',
      received_quantity: String(safeNum(it.received_quantity) || safeNum(it.quantity)),
      received_unit: it.received_unit || it.unit || '',
      received_unit_price: String(
        safeNum(it.received_unit_price) || safeNum(it.unit_price),
      ),
      received_spec: it.received_spec || it.spec || '',
      not_arrived: false,
    }));
    setReceiveRows(rows);
  };

  // ===== 提交收货 =====
  const handleReceiveSubmit = async () => {
    if (!receiveTarget) return;
    // 校验：实收数量不能为空或负数（未到货的行无需校验数量）
    for (const row of receiveRows) {
      if (row.not_arrived) continue;
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
          received_quantity: r.not_arrived ? 0 : (parseFloat(r.received_quantity) || 0),
          received_unit: r.received_unit.trim(),
          received_unit_price: parseFloat(r.received_unit_price) || 0,
          received_spec: r.received_spec.trim(),
          not_arrived: r.not_arrived,
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

  // ===== 生成 PDF（支持 type=apply|confirm 指定类型） =====
  const handleGeneratePDF = async (id: string, type?: 'apply' | 'confirm') => {
    setActioningId(id);
    try {
      const query = type ? `?type=${type}` : '';
      await api.post(`/warehouse-purchases/${id}/generate-pdf${query}`);
      await fetchList();
    } catch (err: any) {
      setError(err.message || 'PDF 生成失败');
    } finally {
      setActioningId(null);
    }
  };

  // ===== 下载 PDF（支持 type=apply|confirm 指定类型） =====
  const handleDownloadPDF = async (id: string, type?: 'apply' | 'confirm') => {
    try {
      const token = api.getToken();
      const query = type ? `?type=${type}` : '';
      const response = await fetch(
        `${api.getBaseUrl()}/warehouse-purchases/${id}/pdf${query}`,
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
      const prefix = type === 'apply' ? '仓库采购申请单' : type === 'confirm' ? '仓库采购确认单' : 'warehouse_purchase';
      a.download = `${prefix}_${id}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message || '下载失败');
    }
  };

  // ===== 刷新审批状态（确认/报销/预付款） =====
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

  // ===== 刷新采购审批状态 =====
  const handleRefreshApproval = async (id: string) => {
    setActioningId(id);
    try {
      const data = await api.post<WarehousePurchase>(
        `/warehouse-purchases/${id}/refresh-approval`,
      );
      // 刷新成功后重新拉取列表，确保状态和所有字段正确更新
      await fetchList();
      console.log(`[刷新审批] ${id} 成功，当前状态: ${data.status}`);
    } catch (err: any) {
      setError(err.message || '刷新审批状态失败');
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
  const openPrepayModal = (p: WarehousePurchase) => {
    setPrepayTarget(p);
    setPrepayAttachments([]);
    setShowPrepayModal(true);
  };

  const handlePrepayFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        setPrepayAttachments((prev) => [
          ...prev,
          { filename: file.name, base64, mimeType: file.type || 'application/octet-stream' },
        ]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const removePrepayAttachment = (index: number) => {
    setPrepayAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmitPrepay = async () => {
    if (!prepayTarget) return;
    setPrepaySubmitting(true);
    setActioningId(prepayTarget.id);
    try {
      await api.post(`/warehouse-purchases/${prepayTarget.id}/submit-prepay`, {
        attachments: prepayAttachments,
      }, { timeout: 60000 });
      setShowPrepayModal(false);
      setPrepayTarget(null);
      setPrepayAttachments([]);
      await fetchList();
    } catch (err: any) {
      const errMsg = err?.message || err?.error || '发起预付款审批失败';
      setError(errMsg);
    } finally {
      setPrepaySubmitting(false);
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
  // 权限：管理员可删除任意状态；非管理员只能删除自己创建的草稿单
  const handleDelete = async (id: string) => {
    const target = purchases.find((p) => p.id === id);
    const isDraft = target?.status === 'draft';
    const confirmMsg = isDraft
      ? '确定删除该采购单吗？删除后不可恢复。'
      : '该采购单非草稿状态，删除后不可恢复且关联数据将一并清除，确定继续吗？';
    if (!window.confirm(confirmMsg)) return;
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

  // 是否有 PDF 可下载（确认单PDF或申请单PDF）
  const hasPdf = (p: WarehousePurchase) => !!(p.pdf_url || p.apply_pdf_url);
  // 是否有申请单 PDF
  const hasApplyPdf = (p: WarehousePurchase) => !!p.apply_pdf_url;
  // 是否有确认单 PDF
  const hasConfirmPdf = (p: WarehousePurchase) => !!p.pdf_url;
  // 申请单可操作的状态（草稿/审批中/已通过/已驳回）
  const APPLY_PDF_STATUSES: PurchaseStatus[] = ['draft', 'pending_approval', 'approved', 'rejected'];
  // 确认单可操作的状态（已收货/确认中/已确认/报销中/已报销）
  const CONFIRM_PDF_STATUSES: PurchaseStatus[] = ['received', 'confirming', 'confirmed', 'reimbursing', 'reimbursed'];

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

      {/* 加载中提示 */}
      {actioningId && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center gap-3">
          <RefreshCw size={20} className="text-blue-500 animate-spin" />
          <span className="text-blue-700">正在处理中，请稍候...</span>
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
                        {p.prepay_attachments && p.prepay_attachments.length > 0 && (
                          <>
                            <span>·</span>
                            <span className="text-gray-500 flex items-center gap-0.5">
                              <Paperclip size={12} />
                              {p.prepay_attachments.length}个附件
                            </span>
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
                        {p.created_by_name && (
                          <>
                            <span>·</span>
                            <span className="flex items-center gap-1 text-gray-600">
                              <User size={12} />
                              {p.created_by_name}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* 流程进度条 */}
                  <WarehousePurchaseProgress
                    status={p.status}
                    purchaseType={p.purchase_type}
                    prepayStatus={p.prepay_status}
                    writeoffStatus={p.writeoff_status}
                  />
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {/* 快捷下载：申请单 PDF */}
                    {hasApplyPdf(p) && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownloadPDF(p.id, 'apply');
                        }}
                        title="下载采购申请单PDF"
                        className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
                      >
                        <FileText size={14} />
                        申请单
                      </button>
                    )}
                    {/* 快捷下载：确认单 PDF */}
                    {hasConfirmPdf(p) && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownloadPDF(p.id, 'confirm');
                        }}
                        title="下载入库确认单PDF"
                        className="text-xs text-teal-600 hover:text-teal-700 flex items-center gap-1"
                      >
                        <ClipboardCheck size={14} />
                        确认单
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
                                    <th className="px-3 py-2 text-left">单位</th>
                                    <th className="px-3 py-2 text-right">数量</th>
                                    <th className="px-3 py-2 text-right">单价</th>
                                    <th className="px-3 py-2 text-right">金额</th>
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
                                        {it.reason || '-'}
                                      </td>
                                      <td className="px-3 py-2 text-right text-cyan-700">
                                        {it.not_arrived
                                          ? <span className="text-red-500 text-xs">未到货</span>
                                          : it.received_quantity != null
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
                          {/* draft: 编辑、提交审批 */}
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
                                {actioningId === p.id ? (
                                  <>
                                    <RefreshCw size={14} className="animate-spin" />
                                    提交中...
                                  </>
                                ) : (
                                  <>
                                    <Send size={14} />
                                    提交审批
                                  </>
                                )}
                              </button>
                              {(isAdmin || p.created_by === user?.id) && (
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
                              )}
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

                          {/* pending_approval: 审批中，刷新审批状态 */}
                          {p.status === 'pending_approval' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRefreshApproval(p.id);
                              }}
                              disabled={actioningId === p.id}
                              className="btn-secondary text-xs flex items-center gap-1 disabled:opacity-50"
                            >
                              <RefreshCw size={14} />
                              刷新审批
                            </button>
                          )}

                          {/* rejected: 驳回，可编辑和重新提交 */}
                          {p.status === 'rejected' && (
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
                                {actioningId === p.id ? (
                                  <>
                                    <RefreshCw size={14} className="animate-spin" />
                                    提交中...
                                  </>
                                ) : (
                                  <>
                                    <RotateCcw size={14} />
                                    重新提交
                                  </>
                                )}
                              </button>
                            </>
                          )}

                          {/* 预付款：发起预付款审批（未发起过或已结束的审批） */}
                          {p.purchase_type === 'prepay' && (p.status === 'pending_approval' || p.status === 'confirmed') && (!p.prepay_sp_no || (p.prepay_sp_no && p.prepay_status !== 'pending' && p.prepay_status !== 'approving')) && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openPrepayModal(p);
                              }}
                              disabled={actioningId === p.id}
                              className="btn-primary text-xs flex items-center gap-1 bg-orange-600 hover:bg-orange-700 disabled:opacity-50"
                            >
                              <Send size={14} />
                              发起预付审批{p.prepay_sp_no ? '(重新)' : ''}
                            </button>
                          )}

                          {/* 预付款审批中：刷新状态 */}
                          {p.purchase_type === 'prepay' && p.prepay_sp_no && (p.prepay_status === 'pending' || p.prepay_status === 'approving') && (
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

                          {/* 预付款已确认且有收货数据：手动核销 */}
                          {p.purchase_type === 'prepay' && p.status === 'confirmed' && !p.writeoff_status && safeNum(p.actual_amount) > 0 && (
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

                          {/* 预付款少付待尾款报销 */}
                          {p.purchase_type === 'prepay' && p.writeoff_status === 'manual' && safeNum(p.actual_amount) > 0 && p.status !== 'reimbursing' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleResubmit(p.id);
                              }}
                              disabled={actioningId === p.id}
                              className="btn-primary text-xs flex items-center gap-1 bg-orange-600 hover:bg-orange-700 disabled:opacity-50"
                            >
                              <RotateCcw size={14} />
                              发起尾款报销
                            </button>
                          )}

                          {/* 预付订单状态异常（confirmed但无收货数据）：允许重新录入收货 */}
                          {p.purchase_type === 'prepay' && p.status === 'confirmed' && safeNum(p.actual_amount) <= 0 && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openReceiveModal(p);
                              }}
                              disabled={actioningId === p.id}
                              className="btn-primary text-xs flex items-center gap-1 bg-green-600 hover:bg-green-700 disabled:opacity-50"
                            >
                              <PackageCheck size={14} />
                              重新录入收货
                            </button>
                          )}

                          {/* confirmed: 发起报销（预付款/月结不显示） */}
                          {p.status === 'confirmed' && p.purchase_type !== 'prepay' && p.purchase_type !== 'monthly' && (
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

                          {/* 采购申请单 PDF：生成/下载（与操作按钮同一行） */}
                          {APPLY_PDF_STATUSES.includes(p.status) && (
                            <>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleGeneratePDF(p.id, 'apply');
                                }}
                                disabled={actioningId === p.id}
                                title="生成采购申请单PDF"
                                className="btn-secondary text-xs flex items-center gap-1 disabled:opacity-50 text-blue-600"
                              >
                                <FileText size={14} />
                                生成申请单
                              </button>
                              {hasApplyPdf(p) && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDownloadPDF(p.id, 'apply');
                                  }}
                                  title="下载采购申请单PDF"
                                  className="btn-secondary text-xs flex items-center gap-1 text-blue-600 hover:bg-blue-50"
                                >
                                  <Download size={14} />
                                  申请单PDF
                                </button>
                              )}
                            </>
                          )}

                          {/* 入库确认单 PDF：生成/下载（与操作按钮同一行） */}
                          {CONFIRM_PDF_STATUSES.includes(p.status) && (
                            <>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleGeneratePDF(p.id, 'confirm');
                                }}
                                disabled={actioningId === p.id}
                                title="生成入库确认单PDF"
                                className="btn-secondary text-xs flex items-center gap-1 disabled:opacity-50 text-teal-600"
                              >
                                <ClipboardCheck size={14} />
                                生成确认单
                              </button>
                              {hasConfirmPdf(p) && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDownloadPDF(p.id, 'confirm');
                                  }}
                                  title="下载入库确认单PDF"
                                  className="btn-secondary text-xs flex items-center gap-1 text-teal-600 hover:bg-teal-50"
                                >
                                  <Download size={14} />
                                  确认单PDF
                                </button>
                              )}
                            </>
                          )}

                          {/* 管理员：删除非草稿状态采购单（草稿状态已在上方块内显示删除按钮） */}
                          {isAdmin && p.status !== 'draft' && (
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
              {receiveLoading ? (
                <div className="text-center py-10 text-gray-400 flex items-center justify-center gap-2">
                  <RefreshCw size={16} className="animate-spin" />
                  加载明细中...
                </div>
              ) : receiveRows.length === 0 ? (
                <div className="text-center py-10 text-gray-400">暂无物资明细</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600">
                      <tr>
                        <th className="px-3 py-2 text-left">仓库</th>
                        <th className="px-3 py-2 text-left">物资名称</th>
                        <th className="px-3 py-2 text-right">实收数量</th>
                        <th className="px-3 py-2 text-right">单价</th>
                        <th className="px-3 py-2 text-right">金额</th>
                        <th className="px-3 py-2 text-center">未到货</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {receiveRows.map((row, idx) => {
                        const qty = row.not_arrived ? 0 : (parseFloat(row.received_quantity) || 0);
                        const price = parseFloat(row.received_unit_price) || 0;
                        const disabled = row.not_arrived;
                        return (
                          <tr key={row.itemId || idx} className={row.not_arrived ? 'bg-gray-50 opacity-60' : ''}>
                            <td className="px-3 py-2 text-gray-600 whitespace-nowrap text-xs">
                              {row.warehouseName || '-'}
                            </td>
                            <td className="px-3 py-2 text-gray-800 font-medium">
                              {row.itemName}
                              {!row.not_arrived && (
                                <div className="mt-1">
                                  <input
                                    type="text"
                                    value={row.received_spec || ''}
                                    onChange={(e) =>
                                      setReceiveRows((prev) =>
                                        prev.map((r, i) =>
                                          i === idx ? { ...r, received_spec: e.target.value } : r,
                                        ),
                                      )
                                    }
                                    placeholder="实收规格（可选）"
                                    disabled={disabled}
                                    className="w-full text-xs border border-gray-200 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 disabled:bg-gray-100 disabled:text-gray-400"
                                  />
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={row.not_arrived ? '0' : row.received_quantity}
                                onChange={(e) =>
                                  setReceiveRows((prev) =>
                                    prev.map((r, i) =>
                                      i === idx ? { ...r, received_quantity: e.target.value } : r,
                                    ),
                                  )
                                }
                                disabled={disabled}
                                className="w-24 text-right border border-gray-200 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 disabled:bg-gray-100 disabled:text-gray-400"
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
                                disabled={disabled}
                                className="w-24 text-right border border-gray-200 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 disabled:bg-gray-100 disabled:text-gray-400"
                              />
                            </td>
                            <td className="px-3 py-2 text-right font-medium text-gray-800">
                              {row.not_arrived ? (
                                <span className="text-red-500 text-xs">未到货</span>
                              ) : (
                                formatCurrency(qty * price)
                              )}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <label className="inline-flex items-center cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={row.not_arrived}
                                  onChange={(e) =>
                                    setReceiveRows((prev) =>
                                      prev.map((r, i) =>
                                        i === idx
                                          ? { ...r, not_arrived: e.target.checked }
                                          : r,
                                      ),
                                    )
                                  }
                                  className="w-4 h-4 text-red-500 border-gray-300 rounded focus:ring-red-500/20"
                                />
                              </label>
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

      {/* ===== 预付款审批弹窗 ===== */}
      {showPrepayModal && prepayTarget && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => !prepaySubmitting && setShowPrepayModal(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div>
                <h3 className="text-lg font-semibold text-gray-800">发起预付款审批</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  采购单：{prepayTarget.purchase_no || prepayTarget.id}
                </p>
              </div>
              <button
                onClick={() => !prepaySubmitting && setShowPrepayModal(false)}
                className="p-1 hover:bg-gray-100 rounded-md"
                disabled={prepaySubmitting}
              >
                <X size={20} className="text-gray-500" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* 金额和供应商信息 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">预付款金额</label>
                  <div className="px-3 py-2 bg-gray-50 rounded-lg text-gray-800">
                    {formatCurrency(safeNum(prepayTarget.prepay_amount))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">收款人（供应商）</label>
                  <div className="px-3 py-2 bg-gray-50 rounded-lg text-gray-800">
                    {prepayTarget.supplier_name || '未指定'}
                  </div>
                </div>
              </div>

              {/* 附件上传区 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  附件上传（可选，图片或文件）
                </label>
                <label className="flex items-center justify-center gap-2 px-4 py-6 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-orange-400 hover:bg-orange-50/50 transition-colors">
                  <Upload size={20} className="text-gray-400" />
                  <span className="text-sm text-gray-500">点击选择文件（支持多选）</span>
                  <input
                    type="file"
                    multiple
                    onChange={handlePrepayFileChange}
                    className="hidden"
                    disabled={prepaySubmitting}
                  />
                </label>

                {/* 已选附件列表 */}
                {prepayAttachments.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {prepayAttachments.map((att, i) => (
                      <div key={i} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg">
                        <div className="flex items-center gap-2 min-w-0">
                          <Paperclip size={14} className="text-gray-400 flex-shrink-0" />
                          <span className="text-sm text-gray-700 truncate">{att.filename}</span>
                        </div>
                        <button
                          onClick={() => removePrepayAttachment(i)}
                          disabled={prepaySubmitting}
                          className="p-1 hover:bg-red-100 rounded text-red-500 disabled:opacity-50"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="text-xs text-gray-400">
                提示：预付款审批将使用费用报销模板发起，收款人自动填写为供应商名称。
                入库确认单PDF将在收货确认完成后自动生成，可后续手动打印。
              </div>
            </div>

            <div className="flex justify-end gap-3 p-5 border-t border-gray-100">
              <button
                onClick={() => setShowPrepayModal(false)}
                className="btn-secondary"
                disabled={prepaySubmitting}
              >
                取消
              </button>
              <button
                onClick={handleSubmitPrepay}
                disabled={prepaySubmitting}
                className="btn-primary flex items-center gap-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50"
              >
                <Send size={16} />
                {prepaySubmitting ? '提交中...' : '发起审批'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
