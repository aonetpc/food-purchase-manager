import { useState, useEffect } from 'react';
import {
  Scale, FileSpreadsheet, Receipt, Calendar, Plus, RefreshCw, Eye,
  Trash2, CheckCircle, Clock, CheckCircle2, XCircle, AlertTriangle,
  ChevronDown, ChevronUp, Send, DollarSign, Wallet, Calculator,
  Paperclip, Upload, FileCheck2, Loader2
} from 'lucide-react';
import { api } from '@/lib/api';
import { formatCurrency } from '@/utils/format';

interface MonthlyStatement {
  id: string;
  supplier_id: string;
  supplier_name: string;
  statement_month: string;
  total_amount: number;
  confirmed_amount: number;
  difference_amount: number;
  difference_reason?: string;
  status: 'pending' | 'confirmed' | 'approved' | 'paid';
  purchase_ids?: string[];
  payment_sp_no?: string;
  created_at: string;
  updated_at: string;
}

interface PrepayWriteoff {
  id: string;
  purchase_date: string;
  supplier_id: string;
  supplier_name: string;
  total_amount: number;
  prepay_amount: number;
  difference_amount: number;
  refund_or_tail: string;
  writeoff_status?: string;
  reimbursement_sp_no?: string;
  confirmed_at: string;
}

interface OverviewStats {
  current_month: string;
  statement_stats: {
    pending: number; confirmed: number; approved: number; paid: number; total_amount: number;
  };
  pending_monthly: { count: number; amount: number };
  pending_prepay_writeoff: { count: number; amount: number };
}

const STATEMENT_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending:   { label: '待对账',   color: 'bg-amber-100 text-amber-700' },
  confirmed: { label: '已对账',   color: 'bg-blue-100 text-blue-700' },
  approved:  { label: '付款审批中', color: 'bg-purple-100 text-purple-700' },
  paid:      { label: '已付款',   color: 'bg-emerald-100 text-emerald-700' },
};

const WRITEOFF_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  manual:   { label: '待人工核销',  color: 'bg-amber-100 text-amber-700' },
  auto:     { label: '自动核销完成', color: 'bg-emerald-100 text-emerald-700' },
  tail:     { label: '尾款待报销',   color: 'bg-blue-100 text-blue-700' },
  pending:  { label: '处理中',      color: 'bg-gray-100 text-gray-700' },
};

function StatCard({ icon: Icon, title, value, subtext, color }: {
  icon: any; title: string; value: string; subtext?: string; color: string;
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-slate-500 truncate">{title}</p>
          <p className="mt-1 text-2xl font-bold text-slate-900 break-words">{value}</p>
          {subtext && <p className="mt-1 text-xs text-slate-400">{subtext}</p>}
        </div>
        <div className={`shrink-0 rounded-xl p-3 ${color}`}>
          <Icon className="w-6 h-6" />
        </div>
      </div>
    </div>
  );
}

export default function SupplierReconciliation() {
  const [activeTab, setActiveTab] = useState<'monthly' | 'prepay'>('monthly');
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  // ====== 月结对账 state ======
  const [statements, setStatements] = useState<MonthlyStatement[]>([]);
  const [loadingStmts, setLoadingStmts] = useState(true);
  const [stmtStatusFilter, setStmtStatusFilter] = useState<string>('all');
  const [stmtMonthFilter, setStmtMonthFilter] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [expandedStmtId, setExpandedStmtId] = useState<string | null>(null);
  const [genMonth, setGenMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [genSupplierId, setGenSupplierId] = useState<string>('');
  const [showGenModal, setShowGenModal] = useState(false);
  const [showReconcileModal, setShowReconcileModal] = useState<MonthlyStatement | null>(null);
  const [reconcileAmount, setReconcileAmount] = useState<string>('');
  const [reconcileReason, setReconcileReason] = useState<string>('');
  const [showDetailModal, setShowDetailModal] = useState<MonthlyStatement | null>(null);
  const [detailPurchases, setDetailPurchases] = useState<any[]>([]);

  // ====== 预付核销 state ======
  const [writeoffs, setWriteoffs] = useState<PrepayWriteoff[]>([]);
  const [loadingWriteoffs, setLoadingWriteoffs] = useState(true);
  const [writeoffStatusFilter, setWriteoffStatusFilter] = useState<string>('pending');

  // ====== 待月结采购单 state ======
  const [pendingSuppliers, setPendingSuppliers] = useState<any[]>([]);
  const [loadingPending, setLoadingPending] = useState(true);
  const [expandedSupplierId, setExpandedSupplierId] = useState<string | null>(null);
  const [supplierPurchases, setSupplierPurchases] = useState<Record<string, any[]>>({});
  const [selectedPurchases, setSelectedPurchases] = useState<Set<string>>(new Set());
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentReason, setPaymentReason] = useState('');
  const [paymentRemark, setPaymentRemark] = useState('');
  const [paymentAttachments, setPaymentAttachments] = useState<Array<{ filename: string; base64: string; mimeType: string }>>([]);
  const [submittingPayment, setSubmittingPayment] = useState(false);

  // ====== 月结付款审批中 state ======
  const [paymentPendingList, setPaymentPendingList] = useState<any[]>([]);
  const [loadingPaymentPending, setLoadingPaymentPending] = useState(true);
  const [refreshingPaymentSpNo, setRefreshingPaymentSpNo] = useState<string | null>(null);

  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  useEffect(() => { fetchStats(); fetchPendingSuppliers(); fetchPaymentPending(); }, []);
  useEffect(() => { fetchStatements(); }, [stmtStatusFilter, stmtMonthFilter]);
  useEffect(() => { fetchWriteoffs(); }, [writeoffStatusFilter]);

  async function fetchStats() {
    try {
      const data = await api.get<OverviewStats>('/reconciliation/stats/overview');
      setStats(data);
    } catch (e: any) { setError(e.message || '加载概览失败'); }
    finally { setLoadingStats(false); }
  }

  async function fetchStatements() {
    setLoadingStmts(true); setError('');
    try {
      const params: Record<string, any> = { statement_month: stmtMonthFilter };
      if (stmtStatusFilter !== 'all') params.status = stmtStatusFilter;
      const data = await api.get<MonthlyStatement[]>('/reconciliation', { params });
      setStatements(data);
    } catch (e: any) { setError(e.message); }
    finally { setLoadingStmts(false); }
  }

  async function fetchWriteoffs() {
    setLoadingWriteoffs(true); setError('');
    try {
      const data = await api.get<PrepayWriteoff[]>('/reconciliation/prepay-writeoff/list',
        { params: { status: writeoffStatusFilter } });
      setWriteoffs(data);
    } catch (e: any) { setError(e.message); }
    finally { setLoadingWriteoffs(false); }
  }

  async function handleGenerate() {
    setError('');
    try {
      const body: any = { statement_month: genMonth };
      if (genSupplierId) body.supplier_id = genSupplierId;
      const data = await api.post<any>('/reconciliation/generate', body);
      showToast(`成功生成 ${data.statements.length} 张月结账单`);
      setShowGenModal(false);
      fetchStats(); fetchStatements();
    } catch (e: any) { setError(e.message); }
  }

  async function handleReconcileSubmit() {
    if (!showReconcileModal || !reconcileAmount) return;
    setError('');
    try {
      const num = parseFloat(reconcileAmount);
      if (isNaN(num)) throw new Error('金额格式错误');
      await api.post(`/reconciliation/${showReconcileModal.id}/reconcile`, {
        confirmed_amount: num, difference_reason: reconcileReason || undefined,
      });
      showToast('对账完成');
      setShowReconcileModal(null); setReconcileAmount(''); setReconcileReason('');
      fetchStats(); fetchStatements();
    } catch (e: any) { setError(e.message); }
  }

  async function handleSubmitPayment(stmt: MonthlyStatement) {
    setError('');
    try {
      await api.post(`/reconciliation/${stmt.id}/submit-payment`);
      showToast('已发起月结付款审批');
      fetchStats(); fetchStatements();
    } catch (e: any) { setError(e.message); }
  }

  async function handleRefreshPayment(stmt: MonthlyStatement) {
    setError('');
    try {
      const data = await api.post<any>(`/reconciliation/${stmt.id}/refresh-payment`);
      showToast(`审批状态：${STATEMENT_STATUS_LABELS[data.status]?.label || data.status}`);
      fetchStats(); fetchStatements();
    } catch (e: any) { setError(e.message); }
  }

  async function handleDeleteStmt(stmt: MonthlyStatement) {
    if (!confirm(`确认删除${stmt.statement_month}月${stmt.supplier_name}的月结账单？\n（仅待对账状态可删，删除后采购单会重新归入待月结池）`)) return;
    setError('');
    try {
      await api.delete(`/reconciliation/${stmt.id}`);
      showToast('已删除');
      fetchStats(); fetchStatements();
    } catch (e: any) { setError(e.message); }
  }

  async function handleShowDetail(stmt: MonthlyStatement) {
    setShowDetailModal(stmt); setDetailPurchases([]);
    try {
      const data = await api.get<any>(`/reconciliation/${stmt.id}`);
      setDetailPurchases(data.purchases || []);
    } catch (e: any) { setError(e.message); }
  }

  async function handleSubmitTail(wo: PrepayWriteoff) {
    if (!confirm(`确认对单号 ${wo.id.substring(0,8)} 发起尾款报销？（实际金额${formatCurrency(wo.total_amount)}，已预付${formatCurrency(wo.prepay_amount)}，差额：${formatCurrency(wo.difference_amount)}）`)) return;
    setError('');
    try {
      const res = await api.post<any>(`/reconciliation/prepay-writeoff/${wo.id}/submit-tail`);
      showToast('尾款报销已发起');
      fetchWriteoffs();
    } catch (e: any) { setError(e.message); }
  }

  // ====== 待月结采购单 ======
  async function fetchPendingSuppliers() {
    setLoadingPending(true); setError('');
    try {
      const data = await api.get<any[]>('/reconciliation/monthly/pending-suppliers');
      setPendingSuppliers(data);
    } catch (e: any) { setError(e.message); }
    finally { setLoadingPending(false); }
  }

  async function fetchSupplierPending(supplierId: string) {
    setError('');
    try {
      const data = await api.get<any[]>(`/reconciliation/monthly/supplier/${supplierId}/pending`);
      setSupplierPurchases(prev => ({ ...prev, [supplierId]: data }));
    } catch (e: any) { setError(e.message); }
  }

  function togglePurchaseSelection(purchaseId: string) {
    setSelectedPurchases(prev => {
      const next = new Set(prev);
      if (next.has(purchaseId)) next.delete(purchaseId);
      else next.add(purchaseId);
      return next;
    });
  }

  function toggleSupplierAll(supplierId: string, purchases: any[]) {
    setSelectedPurchases(prev => {
      const next = new Set(prev);
      const allSelected = purchases.length > 0 && purchases.every(p => next.has(p.id));
      if (allSelected) {
        purchases.forEach(p => next.delete(p.id));
      } else {
        purchases.forEach(p => next.add(p.id));
      }
      return next;
    });
  }

  function getSelectedPurchasesDetail(): any[] {
    const result: any[] = [];
    Object.values(supplierPurchases).forEach(purchases => {
      purchases.forEach(p => {
        if (selectedPurchases.has(p.id)) result.push(p);
      });
    });
    return result;
  }

  function getSelectedSupplierNames(): string {
    const selected = getSelectedPurchasesDetail();
    const names = new Set<string>();
    selected.forEach(p => { if (p.supplier_name) names.add(p.supplier_name); });
    return Array.from(names).join('、');
  }

  function getSelectedTotal(): number {
    return getSelectedPurchasesDetail().reduce((sum, p) => sum + (p.total_amount || 0), 0);
  }

  function generatePaymentReason(): string {
    const selected = getSelectedPurchasesDetail();
    if (selected.length === 0) return '';
    const supplierName = getSelectedSupplierNames();
    const total = getSelectedTotal();
    return `月结采购付款-${supplierName}（${selected.length}张，合计¥${formatCurrency(total)}）`;
  }

  function generatePaymentRemark(): string {
    const selected = getSelectedPurchasesDetail();
    if (selected.length === 0) return '';
    const supplierName = getSelectedSupplierNames();
    const purchaseNos = selected.map(p => p.id).join('、');
    const total = getSelectedTotal();
    return `供应商：${supplierName}\n采购单号：${purchaseNos}\n本月结账共${selected.length}张，合计¥${formatCurrency(total)}`;
  }

  function openPaymentModal() {
    if (selectedPurchases.size === 0) return;
    setPaymentReason(generatePaymentReason());
    setPaymentRemark(generatePaymentRemark());
    setPaymentAttachments([]);
    setShowPaymentModal(true);
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const newAttachments: Array<{ filename: string; base64: string; mimeType: string }> = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1] || '');
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      newAttachments.push({ filename: file.name, base64, mimeType: file.type });
    }
    setPaymentAttachments(prev => [...prev, ...newAttachments]);
    e.target.value = '';
  }

  function removeAttachment(idx: number) {
    setPaymentAttachments(prev => prev.filter((_, i) => i !== idx));
  }

  async function fetchPaymentPending() {
    setLoadingPaymentPending(true); setError('');
    try {
      const data = await api.get<any[]>('/reconciliation/monthly/payment/pending-approval');
      setPaymentPendingList(data);
    } catch (e: any) { setError(e.message); }
    finally { setLoadingPaymentPending(false); }
  }

  async function handleRefreshPaymentStatus(spNo: string) {
    setRefreshingPaymentSpNo(spNo);
    try {
      const r = await api.post<any>('/reconciliation/monthly/payment/refresh', { sp_no: spNo });
      if (r?.sp_status === 2) showToast(`审批已通过，已标记付款完成`);
      else if (r?.sp_status === 3) showToast(`审批已驳回`);
      else showToast(`状态已更新`);
      fetchPaymentPending();
      fetchStats();
    } catch (e: any) { setError(e.message); }
    finally { setRefreshingPaymentSpNo(null); }
  }

  async function handleMonthlyPaymentSubmit() {
    if (selectedPurchases.size === 0) return;
    setSubmittingPayment(true); setError('');
    try {
      await api.post('/reconciliation/monthly/payment/submit', {
        purchase_ids: Array.from(selectedPurchases),
        reason: paymentReason,
        remark: paymentRemark,
        attachments: paymentAttachments,
      });
      showToast('付款申请已提交');
      setShowPaymentModal(false);
      setSelectedPurchases(new Set<string>());
      setPaymentReason('');
      setPaymentRemark('');
      setPaymentAttachments([]);
      fetchPendingSuppliers();
      fetchPaymentPending();
      fetchStats();
    } catch (e: any) { setError(e.message); }
    finally { setSubmittingPayment(false); }
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* 标题 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Scale className="w-7 h-7 text-indigo-600" /> 供应商对账中心
          </h1>
          <p className="text-sm text-slate-500 mt-1">月结采购对账 · 预付款差异核销 · 采购付款闭环</p>
        </div>
        {(error || toast) && (
          <div className={`text-sm rounded-lg px-3 py-2 ${toast ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
            {toast || error}
          </div>
        )}
      </div>

      {/* 概览统计 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={Wallet} title="待月结池" color="bg-amber-100 text-amber-700"
          value={stats?.pending_monthly?.count?.toString() || '0'}
          subtext={`合计金额 ${formatCurrency(stats?.pending_monthly?.amount || 0)}`} />
        <StatCard icon={FileSpreadsheet} title="月结账单待对账" color="bg-blue-100 text-blue-700"
          value={stats?.statement_stats?.pending?.toString() || '0'}
          subtext={`累计账单金额 ${formatCurrency(stats?.statement_stats?.total_amount || 0)}`} />
        <StatCard icon={DollarSign} title="月结账单已付款" color="bg-emerald-100 text-emerald-700"
          value={stats?.statement_stats?.paid?.toString() || '0'}
          subtext={`对账中 ${stats?.statement_stats?.confirmed || 0}，审批中 ${stats?.statement_stats?.approved || 0}`} />
        <StatCard icon={Calculator} title="预付待人工核销" color="bg-purple-100 text-purple-700"
          value={stats?.pending_prepay_writeoff?.count?.toString() || '0'}
          subtext={`合计金额 ${formatCurrency(stats?.pending_prepay_writeoff?.amount || 0)}`} />
      </div>

      {/* Tab 切换 */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="flex border-b border-slate-200">
          <button
            onClick={() => setActiveTab('monthly')}
            className={`px-6 py-3 text-sm font-medium transition-colors border-b-2 ${
              activeTab === 'monthly'
                ? 'border-indigo-600 text-indigo-700 bg-indigo-50/50'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
            }`}
          >
            <FileSpreadsheet className="inline w-4 h-4 mr-1.5" /> 月结采购对账
          </button>
          <button
            onClick={() => setActiveTab('prepay')}
            className={`px-6 py-3 text-sm font-medium transition-colors border-b-2 ${
              activeTab === 'prepay'
                ? 'border-indigo-600 text-indigo-700 bg-indigo-50/50'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Receipt className="inline w-4 h-4 mr-1.5" /> 预付款差异核销
          </button>
        </div>

        {/* ====================== 月结对账 Tab ====================== */}
        {activeTab === 'monthly' && (
          <div>
            {/* 筛选栏 */}
            <div className="p-4 flex flex-wrap items-center gap-3 border-b border-slate-100 bg-slate-50/30">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-slate-400" />
                <input type="month" value={stmtMonthFilter}
                  onChange={e => setStmtMonthFilter(e.target.value)}
                  className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" />
              </div>
              <select value={stmtStatusFilter} onChange={e => setStmtStatusFilter(e.target.value)}
                className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
                <option value="all">全部状态</option>
                {Object.entries(STATEMENT_STATUS_LABELS).map(([k, v]) =>
                  <option key={k} value={k}>{v.label}</option>)}
              </select>
              <button onClick={fetchStatements}
                className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-slate-300 rounded-lg hover:bg-slate-100">
                <RefreshCw className="w-4 h-4" /> 刷新
              </button>
              <button onClick={() => setShowGenModal(true)}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-sm">
                <Plus className="w-4 h-4" /> 生成月结账单
              </button>
            </div>

            {/* ====== 待月结采购单区域 ====== */}
            <div className="border-b border-slate-200">
              {/* 标题栏 */}
              <div className="px-4 py-3 flex items-center justify-between bg-amber-50/50 border-b border-amber-100">
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-amber-600" />
                  <h3 className="text-sm font-semibold text-slate-800">待月结采购单</h3>
                  <span className="text-xs text-slate-500">（{pendingSuppliers.length} 个供应商）</span>
                </div>
                <button onClick={fetchPendingSuppliers}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-slate-300 rounded-lg hover:bg-slate-100">
                  <RefreshCw className="w-4 h-4" /> 刷新
                </button>
              </div>

              {/* 供应商卡片列表 */}
              <div className="divide-y divide-slate-100">
                {loadingPending && (
                  <div className="px-4 py-10 text-center text-slate-400">加载中...</div>
                )}
                {!loadingPending && pendingSuppliers.length === 0 && (
                  <div className="px-4 py-10 text-center text-slate-400">
                    <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                    暂无待月结采购单
                  </div>
                )}
                {pendingSuppliers.map(supplier => {
                  const sid = supplier.id;
                  const expanded = expandedSupplierId === sid;
                  const purchases = supplierPurchases[sid] || [];
                  const selectedInSupplier = purchases.filter(p => selectedPurchases.has(p.id));
                  const allSelected = purchases.length > 0 && selectedInSupplier.length === purchases.length;
                  const supplierName = supplier.name || supplier.supplier_name || '-';
                  return (
                    <div key={sid}>
                      {/* 供应商行 */}
                      <button
                        onClick={() => {
                          const newId = expanded ? null : sid;
                          setExpandedSupplierId(newId);
                          if (newId && !supplierPurchases[newId]) fetchSupplierPending(newId);
                        }}
                        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-slate-50/60 text-left"
                      >
                        {expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                        <span className="font-medium text-slate-800">{supplierName}</span>
                        <span className="text-xs text-slate-500">
                          {supplier.pending_count ?? purchases.length ?? 0} 张待月结
                        </span>
                        <span className="ml-auto text-sm font-semibold text-slate-700">
                          {formatCurrency(supplier.pending_amount ?? 0)}
                        </span>
                        {selectedInSupplier.length > 0 && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                            已选 {selectedInSupplier.length}
                          </span>
                        )}
                      </button>
                      {/* 展开的采购单列表 */}
                      {expanded && (
                        <div className="bg-slate-50/40 px-4 pb-3">
                          {purchases.length === 0 && !supplierPurchases[sid] && (
                            <div className="py-4 text-center text-sm text-slate-400">加载中...</div>
                          )}
                          {purchases.length === 0 && supplierPurchases[sid] && (
                            <div className="py-4 text-center text-sm text-slate-400">该供应商暂无待月结采购单</div>
                          )}
                          {purchases.length > 0 && (
                            <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
                              <table className="w-full text-xs">
                                <thead className="bg-slate-50 text-slate-600">
                                  <tr>
                                    <th className="px-3 py-2 text-left w-8">
                                      <input type="checkbox" checked={allSelected}
                                        onChange={() => toggleSupplierAll(sid, purchases)} />
                                    </th>
                                    <th className="px-3 py-2 text-left">单号</th>
                                    <th className="px-3 py-2 text-left">日期</th>
                                    <th className="px-3 py-2 text-right">金额</th>
                                    <th className="px-3 py-2 text-left">状态</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {purchases.map(p => (
                                    <tr key={p.id} className="hover:bg-slate-50/60">
                                      <td className="px-3 py-2">
                                        <input type="checkbox" checked={selectedPurchases.has(p.id)}
                                          onChange={() => togglePurchaseSelection(p.id)} />
                                      </td>
                                      <td className="px-3 py-2 font-mono">{p.id.substring(0, 12)}</td>
                                      <td className="px-3 py-2">{p.purchase_date}</td>
                                      <td className="px-3 py-2 text-right text-slate-700">{formatCurrency(p.total_amount || 0)}</td>
                                      <td className="px-3 py-2">
                                        <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{p.status}</span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* 底部操作栏 */}
              {selectedPurchases.size > 0 && (
                <div className="px-4 py-3 bg-indigo-50/60 border-t border-indigo-100 flex items-center justify-between">
                  <div className="text-sm text-slate-700">
                    已选 <span className="font-semibold text-indigo-700">{selectedPurchases.size}</span> 张采购单，
                    合计 <span className="font-semibold text-indigo-700">{formatCurrency(getSelectedTotal())}</span>
                  </div>
                  <button onClick={openPaymentModal}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-sm">
                    <Send className="w-4 h-4" /> 发起付款申请
                  </button>
                </div>
              )}
            </div>

            {/* ====== 月结付款审批中 ====== */}
            <div className="border-b border-slate-200">
              <div className="px-4 py-3 flex items-center justify-between bg-purple-50/50 border-b border-purple-100">
                <div className="flex items-center gap-2">
                  <FileCheck2 className="w-5 h-5 text-purple-600" />
                  <h3 className="text-sm font-semibold text-slate-800">月结付款审批中</h3>
                  <span className="text-xs text-slate-500">（{paymentPendingList.length} 笔待审批）</span>
                </div>
                <button onClick={fetchPaymentPending}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-slate-300 rounded-lg hover:bg-slate-100">
                  <RefreshCw className="w-4 h-4" /> 刷新
                </button>
              </div>
              <div className="divide-y divide-slate-100">
                {loadingPaymentPending && (
                  <div className="px-4 py-10 text-center text-slate-400">加载中...</div>
                )}
                {!loadingPaymentPending && paymentPendingList.length === 0 && (
                  <div className="px-4 py-10 text-center text-slate-400">
                    <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                    暂无付款审批中的采购单
                  </div>
                )}
                {paymentPendingList.map(item => (
                  <div key={item.sp_no}
                    className="px-4 py-3 grid grid-cols-1 md:grid-cols-5 gap-3 items-center">
                    <div>
                      <div className="text-xs text-slate-500">审批单号</div>
                      <div className="text-sm font-mono text-slate-700">{item.sp_no}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">供应商</div>
                      <div className="text-sm text-slate-700 font-medium">{item.supplier_name}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">关联采购单</div>
                      <div className="text-sm text-slate-700">{item.purchase_count} 张</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">合计金额</div>
                      <div className="text-sm text-slate-800 font-semibold">¥{formatCurrency(item.total_amount)}</div>
                    </div>
                    <div className="md:text-right">
                      <button
                        onClick={() => handleRefreshPaymentStatus(item.sp_no)}
                        disabled={refreshingPaymentSpNo === item.sp_no}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-purple-300 text-purple-700 rounded-lg hover:bg-purple-50 disabled:opacity-60 disabled:cursor-not-allowed">
                        {refreshingPaymentSpNo === item.sp_no ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <RefreshCw className="w-4 h-4" />
                        )}
                        刷新审批状态
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 列表 */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">账单月份</th>
                    <th className="px-4 py-3 text-left font-medium">供应商</th>
                    <th className="px-4 py-3 text-right font-medium">系统金额</th>
                    <th className="px-4 py-3 text-right font-medium">对账金额</th>
                    <th className="px-4 py-3 text-right font-medium">差异</th>
                    <th className="px-4 py-3 text-left font-medium">关联单数</th>
                    <th className="px-4 py-3 text-left font-medium">状态</th>
                    <th className="px-4 py-3 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loadingStmts && (
                    <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">加载中...</td></tr>
                  )}
                  {!loadingStmts && statements.length === 0 && (
                    <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">
                      <FileSpreadsheet className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                      当前条件下暂无月结账单
                    </td></tr>
                  )}
                  {statements.map(s => {
                    const st = STATEMENT_STATUS_LABELS[s.status] || { label: s.status, color: 'bg-slate-100 text-slate-700' };
                    const expanded = expandedStmtId === s.id;
                    return (
                      <>
                        <tr key={s.id} className="hover:bg-slate-50/60">
                          <td className="px-4 py-3 font-medium text-slate-700">
                            <button onClick={() => setExpandedStmtId(expanded ? null : s.id)}
                              className="inline-flex items-center gap-1 hover:text-indigo-600">
                              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                              {s.statement_month}
                            </button>
                          </td>
                          <td className="px-4 py-3">{s.supplier_name || '-'}</td>
                          <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(s.total_amount)}</td>
                          <td className="px-4 py-3 text-right text-slate-700">
                            {s.status === 'pending' ? <span className="text-slate-400">—</span> : formatCurrency(s.confirmed_amount)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {s.status === 'pending' ? <span className="text-slate-400">—</span> : (
                              <span className={s.difference_amount === 0 ? 'text-slate-400' :
                                s.difference_amount > 0 ? 'text-emerald-600' : 'text-red-600'}>
                                {s.difference_amount > 0 ? '+' : ''}{s.difference_amount.toFixed(2)}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">{(s.purchase_ids || []).length}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${st.color}`}>{st.label}</span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1.5">
                              <button onClick={() => handleShowDetail(s)}
                                className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg" title="查看详情">
                                <Eye className="w-4 h-4" /></button>
                              {s.status === 'pending' && (
                                <>
                                  <button onClick={() => { setShowReconcileModal(s); setReconcileAmount(s.total_amount.toFixed(2)); setReconcileReason(s.difference_reason || ''); }}
                                    className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg" title="对账">
                                    <Calculator className="w-4 h-4" /></button>
                                  <button onClick={() => handleDeleteStmt(s)}
                                    className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg" title="删除">
                                    <Trash2 className="w-4 h-4" /></button>
                                </>
                              )}
                              {s.status === 'confirmed' && (
                                <button onClick={() => handleSubmitPayment(s)}
                                  className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
                                  <Send className="w-3.5 h-3.5" /> 发起付款
                                </button>
                              )}
                              {s.status === 'approved' && s.payment_sp_no && (
                                <button onClick={() => handleRefreshPayment(s)}
                                  className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-purple-300 text-purple-700 rounded-lg hover:bg-purple-50">
                                  <RefreshCw className="w-3.5 h-3.5" /> 刷新审批
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {expanded && s.difference_reason && (
                          <tr className="bg-amber-50/40">
                            <td colSpan={8} className="px-4 py-2 text-sm text-amber-800">
                              <AlertTriangle className="inline w-4 h-4 mr-1.5 -mt-0.5" />
                              差异原因：{s.difference_reason}
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ====================== 预付核销 Tab ====================== */}
        {activeTab === 'prepay' && (
          <div>
            <div className="p-4 flex flex-wrap items-center gap-3 border-b border-slate-100 bg-slate-50/30">
              <select value={writeoffStatusFilter} onChange={e => setWriteoffStatusFilter(e.target.value)}
                className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
                <option value="pending">待人工核销</option>
                <option value="auto">自动核销完成</option>
                <option value="tail">尾款待报销</option>
                <option value="">全部</option>
              </select>
              <button onClick={fetchWriteoffs}
                className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-slate-300 rounded-lg hover:bg-slate-100">
                <RefreshCw className="w-4 h-4" /> 刷新
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">单号</th>
                    <th className="px-4 py-3 text-left font-medium">采购日期</th>
                    <th className="px-4 py-3 text-left font-medium">供应商</th>
                    <th className="px-4 py-3 text-right font-medium">实际金额</th>
                    <th className="px-4 py-3 text-right font-medium">预付金额</th>
                    <th className="px-4 py-3 text-right font-medium">差异</th>
                    <th className="px-4 py-3 text-left font-medium">处理说明</th>
                    <th className="px-4 py-3 text-left font-medium">核销状态</th>
                    <th className="px-4 py-3 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loadingWriteoffs && (
                    <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400">加载中...</td></tr>
                  )}
                  {!loadingWriteoffs && writeoffs.length === 0 && (
                    <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400">
                      <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                      当前条件下暂无待核销记录
                    </td></tr>
                  )}
                  {writeoffs.map(w => {
                    const ws = w.writeoff_status || 'pending';
                    const st = WRITEOFF_STATUS_LABELS[ws] || WRITEOFF_STATUS_LABELS.pending;
                    const isTail = w.difference_amount > 0;
                    return (
                      <tr key={w.id} className="hover:bg-slate-50/60">
                        <td className="px-4 py-3 font-mono text-xs text-slate-600">{w.id.substring(0, 12)}</td>
                        <td className="px-4 py-3">{w.purchase_date}</td>
                        <td className="px-4 py-3">{w.supplier_name || '-'}</td>
                        <td className="px-4 py-3 text-right font-medium">{formatCurrency(w.total_amount)}</td>
                        <td className="px-4 py-3 text-right text-slate-600">{formatCurrency(w.prepay_amount)}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={w.difference_amount === 0 ? 'text-slate-400' :
                            w.difference_amount > 0 ? 'text-blue-600' : 'text-emerald-600'}>
                            {w.difference_amount > 0 ? '+' : ''}{w.difference_amount.toFixed(2)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600 text-xs">{w.refund_or_tail}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${st.color}`}>{st.label}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            {ws === 'manual' && isTail && (
                              <button onClick={() => handleSubmitTail(w)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
                                <Send className="w-3.5 h-3.5" /> 发起尾款报销
                              </button>
                            )}
                            {ws === 'manual' && !isTail && (
                              <span className="inline-flex items-center gap-1 px-2 py-1 text-xs text-slate-500">
                                <CheckCircle2 className="w-3.5 h-3.5" /> 已自动入账余额
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ============== 生成月结账单 Modal ============== */}
      {showGenModal && (
        <Modal onClose={() => setShowGenModal(false)} title="生成月结账单">
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              系统会自动汇总「已确认且未关联网结账单」的月结类型采购单，按供应商分组生成多张账单。<br/>
              跨月入库时以「入库日期（即确认时间）」为准，用户决策第2条已落实。
            </p>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">账单月份（按入库确认月汇总）</label>
              <input type="month" value={genMonth} onChange={e => setGenMonth(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">指定供应商（可选，不填则对所有供应商分别生成）</label>
              <input type="text" placeholder="供应商 ID（留空=全部）" value={genSupplierId}
                onChange={e => setGenSupplierId(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowGenModal(false)}
                className="px-4 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50">取消</button>
              <button onClick={handleGenerate}
                className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">生成</button>
            </div>
          </div>
        </Modal>
      )}

      {/* ============== 对账 Modal ============== */}
      {showReconcileModal && (
        <Modal onClose={() => setShowReconcileModal(null)} title={`${showReconcileModal.statement_month}月 · ${showReconcileModal.supplier_name} 对账`}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-500">系统汇总金额</p>
                <p className="mt-1 text-xl font-bold text-slate-800">{formatCurrency(showReconcileModal.total_amount)}</p>
              </div>
              <div className="bg-amber-50 rounded-lg p-3">
                <p className="text-xs text-amber-600">对账单金额（来自供应商）</p>
                <input type="number" step="0.01" value={reconcileAmount} onChange={e => setReconcileAmount(e.target.value)}
                  className="mt-1 w-full text-xl font-bold text-amber-800 bg-transparent outline-none border-b-2 border-amber-300 focus:border-amber-500" />
              </div>
            </div>
            {reconcileAmount !== '' && (parseFloat(reconcileAmount) !== showReconcileModal.total_amount) && (
              <div className={`rounded-lg p-3 text-sm ${
                (parseFloat(reconcileAmount) - showReconcileModal.total_amount) === 0
                  ? 'bg-slate-50 text-slate-600'
                  : (parseFloat(reconcileAmount) - showReconcileModal.total_amount) > 0
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-red-50 text-red-700'
              }`}>
                <Calculator className="inline w-4 h-4 mr-1.5 -mt-0.5" />
                差异金额：{(parseFloat(reconcileAmount) - showReconcileModal.total_amount).toFixed(2)} 元
                （{parseFloat(reconcileAmount) > showReconcileModal.total_amount
                  ? '对账单金额高于系统（多付款，计入供应商余额）'
                  : '对账单金额低于系统（少付款，可冲销）'}）
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">差异原因（有差异时必填，无差异可留空）</label>
              <textarea rows={3} value={reconcileReason} onChange={e => setReconcileReason(e.target.value)}
                placeholder="例：7月18日送货数量差异；供应商优惠抹零；退货扣款等"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowReconcileModal(null)}
                className="px-4 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50">取消</button>
              <button onClick={handleReconcileSubmit}
                className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 inline-flex items-center gap-1.5">
                <CheckCircle className="w-4 h-4" /> 确认对账
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ============== 月结账单详情 Modal ============== */}
      {showDetailModal && (
        <Modal onClose={() => setShowDetailModal(null)} title={`月结账单详情 · ${showDetailModal.statement_month}`} size="lg">
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3">
              <InfoBox label="供应商" value={showDetailModal.supplier_name || '-'} />
              <InfoBox label="状态" value={(STATEMENT_STATUS_LABELS[showDetailModal.status] || {}).label || showDetailModal.status} />
              <InfoBox label="系统金额" value={formatCurrency(showDetailModal.total_amount)} />
              <InfoBox label="对账金额" value={formatCurrency(showDetailModal.confirmed_amount)} />
            </div>
            {showDetailModal.difference_reason && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                <AlertTriangle className="inline w-4 h-4 mr-1.5 -mt-0.5" />
                差异原因：{showDetailModal.difference_reason}
              </div>
            )}
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-2">关联采购单（{(showDetailModal.purchase_ids || []).length} 张）</h3>
              <div className="max-h-80 overflow-auto border border-slate-200 rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 sticky top-0 text-slate-600">
                    <tr>
                      <th className="px-3 py-2 text-left">单号</th>
                      <th className="px-3 py-2 text-left">日期</th>
                      <th className="px-3 py-2 text-right">金额</th>
                      <th className="px-3 py-2 text-left">状态</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {detailPurchases.length === 0 && (
                      <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-400">加载中...</td></tr>
                    )}
                    {detailPurchases.map((p: any) => (
                      <tr key={p.id}>
                        <td className="px-3 py-2 font-mono">{p.id.substring(0, 12)}</td>
                        <td className="px-3 py-2">{p.purchase_date}</td>
                        <td className="px-3 py-2 text-right text-slate-700">{formatCurrency(p.total_amount || 0)}</td>
                        <td className="px-3 py-2">
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{p.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="flex justify-end">
              <button onClick={() => setShowDetailModal(null)}
                className="px-4 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50">关闭</button>
            </div>
          </div>
        </Modal>
      )}

      {/* ============== 付款申请 Modal ============== */}
      {showPaymentModal && (
        <Modal onClose={() => setShowPaymentModal(false)} title="发起月结付款申请" size="lg">
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <InfoBox label="收款人" value={getSelectedSupplierNames() || '-'} />
              <InfoBox label="付款金额" value={formatCurrency(getSelectedTotal())} />
              <InfoBox label="关联采购单数" value={`${selectedPurchases.size} 张`} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">付款事由</label>
              <input type="text" value={paymentReason} onChange={e => setPaymentReason(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">备注说明</label>
              <textarea rows={4} value={paymentRemark} onChange={e => setPaymentRemark(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">附件</label>
              <div className="border border-dashed border-slate-300 rounded-lg p-4">
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer">
                  <Upload className="w-4 h-4" /> 选择文件
                  <input type="file" multiple className="hidden" onChange={handleFileUpload} />
                </label>
                {paymentAttachments.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {paymentAttachments.map((att, idx) => (
                      <div key={idx} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2 text-sm">
                        <span className="inline-flex items-center gap-1.5 text-slate-700 truncate">
                          <Paperclip className="w-4 h-4 text-slate-400 shrink-0" />
                          <span className="truncate">{att.filename}</span>
                        </span>
                        <button onClick={() => removeAttachment(idx)}
                          className="text-slate-400 hover:text-red-600 ml-2 shrink-0">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowPaymentModal(false)}
                className="px-4 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50">取消</button>
              <button onClick={handleMonthlyPaymentSubmit} disabled={submittingPayment}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                <Send className="w-4 h-4" /> {submittingPayment ? '提交中...' : '提交付款申请'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-50 rounded-lg p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-base font-semibold text-slate-800 break-words">{value}</p>
    </div>
  );
}

function Modal({ children, onClose, title, size = 'md' }: { children: React.ReactNode; onClose: () => void; title: string; size?: 'md' | 'lg' }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className={`bg-white rounded-2xl shadow-2xl w-full ${size === 'lg' ? 'max-w-4xl' : 'max-w-lg'} max-h-[90vh] overflow-auto`}
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
            <XCircle className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
