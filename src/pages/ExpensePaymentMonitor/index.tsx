/**
 * 费用支付监控页面
 *
 * 读取企微"费用支付申请"审批历史进行监控 + 财务支付管理
 * 数据来源：wecom_expense_approvals 表（首次全量同步脚本 + 增量同步）
 *
 * 功能：
 *   1. 列表展示（分页）：单号/申请人/金额/状态/当前节点/支付状态
 *   2. 筛选：审批状态/支付状态/时间范围
 *   3. 合计栏：已通过金额/已支付金额/未支付金额
 *   4. 同步按钮：触发增量同步（5 分钟节流）
 *   5. 刷新按钮：刷新当前页非终态审批状态
 *   6. 标记已支付/撤销：需要 action:mark-expense-paid 权限
 *   7. 详情抽屉：完整审批节点 timeline + 表单值
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/store/authStore';
import { expenseApi, type ExpenseApprovalListItem, type ExpenseApprovalDetail } from '@/lib/api';

// ============================================================
// 工具函数
// ============================================================

/** 格式化金额 */
function formatAmount(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return '-';
  const n = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(n)) return '-';
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 从 amount_value JSON 字符串解析金额 */
function parseAmount(raw: string | null | undefined): number {
  if (!raw) return 0;
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const money = obj?.new_money ?? obj?.value ?? obj;
    const n = parseFloat(String(money));
    return isNaN(n) ? 0 : n;
  } catch {
    // 纯数字字符串
    const n = parseFloat(String(raw));
    return isNaN(n) ? 0 : n;
  }
}

/** 格式化时间 */
function formatTime(val: string | null | undefined): string {
  if (!val) return '-';
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return val;
    return d.toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return val;
  }
}

// ============================================================
// 状态常量
// ============================================================

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: '1', label: '审批中' },
  { value: '2', label: '已通过' },
  { value: '3', label: '已驳回' },
  { value: '4', label: '已撤销' },
];

const PAYMENT_OPTIONS = [
  { value: '', label: '全部支付状态' },
  { value: 'unpaid', label: '未支付' },
  { value: 'paid', label: '已支付' },
];

// ============================================================
// 主组件
// ============================================================

export default function ExpensePaymentMonitor() {
  const { user, hasPermission } = useAuthStore();
  const canMarkPaid = hasPermission('action:mark-expense-paid');

  const [list, setList] = useState<ExpenseApprovalListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [loading, setLoading] = useState(false);

  // 筛选
  const [statusFilter, setStatusFilter] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('');

  // 合计
  const [summary, setSummary] = useState({ approved_amount: 0, paid_amount: 0, unpaid_amount: 0 });

  // 详情抽屉
  const [detailData, setDetailData] = useState<ExpenseApprovalDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailSpNo, setDetailSpNo] = useState('');

  // 同步/刷新 loading
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // 标记支付 Modal
  const [markPaidModal, setMarkPaidModal] = useState<{ spNo: string; action: 'paid' | 'unpaid' } | null>(null);
  const [markPaidLoading, setMarkPaidLoading] = useState(false);
  const [paymentRemark, setPaymentRemark] = useState('');

  // ---- 加载列表 ----
  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await expenseApi.list({
        page,
        pageSize,
        status: statusFilter ? Number(statusFilter) : undefined,
        paymentStatus: paymentFilter || undefined,
      });
      // amount_value 是 JSON 字符串，需要解析后重新包装便于渲染
      setList(res.list.map(item => ({
        ...item,
        // 后端返回的 amount_value 是 JSON 对象（mysql2 自动解析 JSON 列），直接用
      })) as any);
      setTotal(res.total);
      setSummary(res.summary);
    } catch (err: any) {
      console.error('加载列表失败:', err);
      alert(`加载失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, statusFilter, paymentFilter]);

  useEffect(() => { loadList(); }, [loadList]);

  // ---- 同步 ----
  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await expenseApi.sync();
      if (res.skipped) {
        alert(res.message || '刚同步过，请稍后再试');
      } else {
        alert(`同步完成：新增 ${res.synced} 条，失败 ${res.failed} 条`);
        loadList();
      }
    } catch (err: any) {
      alert(`同步失败: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  // ---- 刷新当前页非终态状态 ----
  const handleRefreshStatus = async () => {
    if (list.length === 0) return;
    setRefreshing(true);
    try {
      const ids = list.map(item => item.sp_no);
      const res = await expenseApi.refreshStatus(ids);
      alert(`刷新完成：成功 ${res.summary.refreshed} 条，跳过 ${res.summary.skipped} 条，失败 ${res.summary.failed} 条`);
      loadList();
    } catch (err: any) {
      alert(`刷新失败: ${err.message}`);
    } finally {
      setRefreshing(false);
    }
  };

  // ---- 查看详情 ----
  const handleViewDetail = async (spNo: string) => {
    setDetailSpNo(spNo);
    setDetailData(null);
    setDetailLoading(true);
    try {
      const data = await expenseApi.detail(spNo);
      setDetailData(data);
    } catch (err: any) {
      alert(`加载详情失败: ${err.message}`);
    } finally {
      setDetailLoading(false);
    }
  };

  // ---- 标记已支付/撤销 ----
  const handleConfirmMarkPaid = async () => {
    if (!markPaidModal) return;
    setMarkPaidLoading(true);
    try {
      if (markPaidModal.action === 'paid') {
        await expenseApi.markPaid(markPaidModal.spNo, paymentRemark);
      } else {
        await expenseApi.markUnpaid(markPaidModal.spNo);
      }
      setMarkPaidModal(null);
      setPaymentRemark('');
      loadList();
      if (detailSpNo === markPaidModal.spNo) handleViewDetail(markPaidModal.spNo);
    } catch (err: any) {
      alert(`操作失败: ${err.message}`);
    } finally {
      setMarkPaidLoading(false);
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className="mx-auto max-w-7xl">
        {/* 页头 */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-3xl">👁️</span>
            <div>
              <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">费用支付监控</h1>
              <p className="mt-1 text-sm text-gray-500">
                读取企业微信"费用支付申请"审批历史进行监控
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="btn-secondary flex items-center gap-2 disabled:opacity-50"
            >
              {syncing ? '同步中...' : '增量同步'}
            </button>
            <button
              onClick={handleRefreshStatus}
              disabled={refreshing || list.length === 0}
              className="btn-secondary flex items-center gap-2 disabled:opacity-50"
            >
              {refreshing ? '刷新中...' : '刷新当前页'}
            </button>
          </div>
        </div>

        {/* 合计栏 */}
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
            <p className="text-sm text-blue-600">已通过金额</p>
            <p className="mt-1 text-xl font-semibold text-blue-900">¥{formatAmount(summary.approved_amount)}</p>
          </div>
          <div className="rounded-lg border border-green-200 bg-green-50 p-4">
            <p className="text-sm text-green-600">已支付金额</p>
            <p className="mt-1 text-xl font-semibold text-green-900">¥{formatAmount(summary.paid_amount)}</p>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm text-amber-600">未支付金额</p>
            <p className="mt-1 text-xl font-semibold text-amber-900">¥{formatAmount(summary.unpaid_amount)}</p>
          </div>
        </div>

        {/* 筛选栏 */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          >
            {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select
            value={paymentFilter}
            onChange={(e) => { setPaymentFilter(e.target.value); setPage(1); }}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          >
            {PAYMENT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <span className="text-sm text-gray-500">共 {total} 条</span>
        </div>

        {/* 列表表格 */}
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-3 py-3 text-left">单号</th>
                <th className="px-3 py-3 text-left">申请人</th>
                <th className="px-3 py-3 text-right">金额</th>
                <th className="px-3 py-3 text-left">审批状态</th>
                <th className="px-3 py-3 text-left">当前节点</th>
                <th className="px-3 py-3 text-left">支付状态</th>
                <th className="px-3 py-3 text-left">申请时间</th>
                <th className="px-3 py-3 text-center">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-400">加载中...</td></tr>
              ) : list.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-400">
                  暂无数据。请先在 WecomManager 配置"费用支付申请模板ID"后运行同步脚本。
                </td></tr>
              ) : list.map((item) => (
                <tr key={item.sp_no} className="hover:bg-gray-50">
                  <td className="px-3 py-3 font-mono text-xs text-gray-700">{item.sp_no}</td>
                  <td className="px-3 py-3 text-gray-900">{item.applyer_name || item.applyer_userid || '-'}</td>
                  <td className="px-3 py-3 text-right text-gray-900">
                    {item.sp_status === 2 ? `¥${formatAmount(parseAmount(item.amount_value as any))}` : '-'}
                  </td>
                  <td className="px-3 py-3">
                    <StatusBadge status={item.sp_status} label={item.sp_status_name} />
                  </td>
                  <td className="px-3 py-3 text-gray-700">
                    {item.current_node_name ? (
                      <div>
                        <div>{item.current_node_name}</div>
                        {item.current_approver_name && (
                          <div className="text-xs text-gray-400">待审: {item.current_approver_name}</div>
                        )}
                      </div>
                    ) : '-'}
                  </td>
                  <td className="px-3 py-3">
                    {item.sp_status === 2 ? (
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${
                        item.payment_status === 'paid'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}>
                        {item.payment_status === 'paid' ? '✓ 已支付' : '⚠ 未支付'}
                      </span>
                    ) : '-'}
                  </td>
                  <td className="px-3 py-3 text-gray-600">{formatTime(item.apply_time)}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => handleViewDetail(item.sp_no)}
                        className="text-xs text-blue-600 hover:text-blue-800"
                      >详情</button>
                      {canMarkPaid && item.sp_status === 2 && (
                        <>
                          <span className="text-gray-300">|</span>
                          {item.payment_status === 'unpaid' ? (
                            <button
                              onClick={() => { setMarkPaidModal({ spNo: item.sp_no, action: 'paid' }); setPaymentRemark(''); }}
                              className="text-xs text-green-600 hover:text-green-800"
                            >标记已付</button>
                          ) : (
                            <button
                              onClick={() => setMarkPaidModal({ spNo: item.sp_no, action: 'unpaid' })}
                              className="text-xs text-amber-600 hover:text-amber-800"
                            >撤销已付</button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 分页 */}
        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="btn-secondary px-3 py-1 disabled:opacity-50"
            >上一页</button>
            <span className="text-sm text-gray-600">{page} / {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="btn-secondary px-3 py-1 disabled:opacity-50"
            >下一页</button>
          </div>
        )}
      </div>

      {/* 详情抽屉 */}
      {detailSpNo && (
        <DetailDrawer
          spNo={detailSpNo}
          data={detailData}
          loading={detailLoading}
          onClose={() => { setDetailSpNo(''); setDetailData(null); }}
          canMarkPaid={canMarkPaid}
          onMarkPaid={(spNo, action) => { setMarkPaidModal({ spNo, action }); setPaymentRemark(''); }}
        />
      )}

      {/* 标记支付确认 Modal */}
      {markPaidModal && (
        <ConfirmModal
          title={markPaidModal.action === 'paid' ? '确认标记为已支付' : '确认撤销已支付标记'}
          message={markPaidModal.action === 'paid'
            ? `审批单 ${markPaidModal.spNo} 将被标记为"已支付"`
            : `审批单 ${markPaidModal.spNo} 的已支付标记将被撤销`}
          loading={markPaidLoading}
          showRemark={markPaidModal.action === 'paid'}
          remark={paymentRemark}
          onRemarkChange={setPaymentRemark}
          onConfirm={handleConfirmMarkPaid}
          onCancel={() => { setMarkPaidModal(null); setPaymentRemark(''); }}
        />
      )}
    </div>
  );
}

// ============================================================
// 子组件：状态徽章
// ============================================================

function StatusBadge({ status, label }: { status: number; label: string }) {
  const colorMap: Record<number, string> = {
    1: 'bg-blue-100 text-blue-700',
    2: 'bg-green-100 text-green-700',
    3: 'bg-red-100 text-red-700',
    4: 'bg-gray-100 text-gray-700',
  };
  const color = colorMap[status] || 'bg-gray-100 text-gray-700';
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${color}`}>{label}</span>;
}

// ============================================================
// 子组件：详情抽屉
// ============================================================

function DetailDrawer({
  spNo, data, loading, onClose, canMarkPaid, onMarkPaid,
}: {
  spNo: string;
  data: ExpenseApprovalDetail | null;
  loading: boolean;
  onClose: () => void;
  canMarkPaid: boolean;
  onMarkPaid: (spNo: string, action: 'paid' | 'unpaid') => void;
}) {
  const nodes = data?.nodes || [];
  const forms = data?.forms || [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-2xl flex-col bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 抽屉头部 */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">审批单详情</h2>
            <p className="text-sm text-gray-500 font-mono">{spNo}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
        </div>

        {/* 抽屉内容 */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex h-full items-center justify-center text-gray-400">加载中...</div>
          ) : data ? (
            <div className="space-y-6">
              {/* 基本信息 */}
              <Section title="基本信息">
                <DetailRow label="审批名称" value={data.sp_name || '-'} />
                <DetailRow label="申请人" value={data.applyer_name || data.applyer_userid || '-'} />
                <DetailRow label="申请时间" value={formatTime(data.apply_time)} />
                <DetailRow label="审批状态" value={data.sp_status_name || '-'} />
                <DetailRow label="当前节点" value={data.current_node_name || '-'} />
                <DetailRow label="当前待审人" value={data.current_approver_name || '-'} />
                <DetailRow label="支付状态" value={data.payment?.payment_status === 'paid' ? '✓ 已支付' : '未支付'} />
                {data.payment?.paid_time && (
                  <DetailRow label="支付时间" value={formatTime(data.payment.paid_time)} />
                )}
                {data.payment?.paid_by_name && (
                  <DetailRow label="支付操作人" value={data.payment.paid_by_name} />
                )}
                {data.payment?.payment_remark && (
                  <DetailRow label="支付备注" value={data.payment.payment_remark} />
                )}
              </Section>

              {/* 表单值 */}
              {forms.length > 0 && (
                <Section title="申请表单">
                  {forms.map((f: any, i: number) => (
                    <DetailRow
                      key={i}
                      label={f.control_title || f.control_type || `字段${i + 1}`}
                      value={formatControlValue(f.control_type, f.control_value)}
                    />
                  ))}
                </Section>
              )}

              {/* 审批节点 timeline */}
              {nodes.length > 0 && (
                <Section title="审批流程">
                  <div className="space-y-3">
                    {nodes.map((node: any, i: number) => (
                      <div key={i} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div className={`h-3 w-3 rounded-full ${
                            node.is_current ? 'bg-blue-500 ring-4 ring-blue-100' :
                            node.sp_status === 2 ? 'bg-green-500' :
                            node.sp_status === 3 ? 'bg-red-500' : 'bg-gray-300'
                          }`} />
                          {i < nodes.length - 1 && <div className="h-8 w-px bg-gray-200" />}
                        </div>
                        <div className="pb-4">
                          <p className="text-sm font-medium text-gray-900">
                            {node.node_name || `节点${node.node_index + 1}`}
                            {node.is_current === 1 && (
                              <span className="ml-2 text-xs text-blue-600">（当前）</span>
                            )}
                          </p>
                          {node.approver_name && (
                            <p className="text-xs text-gray-500">
                              {node.approver_name}
                              {node.speech && `: ${node.speech}`}
                            </p>
                          )}
                          {node.approve_time && (
                            <p className="text-xs text-gray-400">{formatTime(node.approve_time)}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-gray-400">加载失败</div>
          )}
        </div>

        {/* 抽屉底部操作 */}
        {canMarkPaid && data && data.sp_status === 2 && (
          <div className="border-t border-gray-200 p-4">
            {data.payment?.payment_status === 'unpaid' ? (
              <button
                onClick={() => onMarkPaid(spNo, 'paid')}
                className="btn-primary w-full"
              >标记为已支付</button>
            ) : (
              <button
                onClick={() => onMarkPaid(spNo, 'unpaid')}
                className="btn-secondary w-full"
              >撤销已支付标记</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// 子组件：确认 Modal（仿 SendConfirmModal 模式）
// ============================================================

function ConfirmModal({
  title, message, loading, showRemark, remark, onRemarkChange, onConfirm, onCancel,
}: {
  title: string;
  message: string;
  loading: boolean;
  showRemark: boolean;
  remark: string;
  onRemarkChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h3 className="mb-2 text-lg font-semibold text-gray-900">{title}</h3>
        <p className="mb-4 text-sm text-gray-600">{message}</p>
        {showRemark && (
          <div className="mb-4">
            <label className="mb-1 block text-sm text-gray-600">支付备注（可选）</label>
            <input
              type="text"
              value={remark}
              onChange={(e) => onRemarkChange(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              placeholder="如：银行流水号"
              disabled={loading}
            />
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={loading}
            className="btn-secondary px-4 py-2 disabled:opacity-50"
          >取消</button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="btn-primary px-4 py-2 disabled:opacity-50"
          >
            {loading ? '处理中...' : '确认'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 子组件：辅助
// ============================================================

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold text-gray-900 border-b border-gray-100 pb-2">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-4 text-sm">
      <span className="w-28 flex-shrink-0 text-gray-500">{label}</span>
      <span className="flex-1 text-gray-900">{value}</span>
    </div>
  );
}

function formatControlValue(controlType: string | undefined, rawValue: any): string {
  if (!rawValue) return '-';
  try {
    const val = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
    if (controlType === 'Money') {
      const money = val?.new_money ?? val?.value ?? val;
      return `¥${formatAmount(money)}`;
    }
    if (controlType === 'Selector') {
      return val?.value || val?.text || JSON.stringify(val);
    }
    if (controlType === 'BankAccount') {
      const parts = [val?.account_name, val?.account_number, val?.bank_name, val?.subbranch].filter(Boolean);
      return parts.join(' / ') || JSON.stringify(val);
    }
    // Text / Textarea / Date 等
    if (typeof val === 'object') {
      return val?.text || val?.value || JSON.stringify(val);
    }
    return String(val);
  } catch {
    return String(rawValue);
  }
}
