/**
 * 费用支付监控页面
 *
 * 读取企微"费用支付申请"审批历史进行监控 + 财务支付管理
 * 数据来源：wecom_expense_approvals 表（首次全量同步脚本 + 增量同步）
 *
 * 功能：
 *   1. 列表展示（分页）：单号/申请人/金额/状态/当前节点/支付状态
 *   2. 月份选择器：上月/下月快速切换，列表+统计跟随月份
 *   3. 搜索：按单号/申请人/金额模糊搜索
 *   4. 筛选：审批状态/支付状态
 *   5. 合计栏：已通过金额/已支付金额/未支付金额（跟随月份）
 *   6. 同步按钮：触发增量同步（5 分钟节流）
 *   7. 刷新按钮：刷新当前页非终态审批状态
 *   8. 标记已支付/撤销：需要 action:mark-expense-paid 权限
 *   9. 详情抽屉：完整审批节点 timeline + 表单值
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/store/authStore';
import { expenseApi, type ExpenseApprovalListItem, type ExpenseApprovalDetail } from '@/lib/api';
import { DetailDrawer, StatusBadge, formatAmount, formatTime } from '@/components/ExpenseDetailDrawer';

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

  // 月份选择器（格式 YYYY-MM，默认最近月份）
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  // 搜索关键词
  const [keyword, setKeyword] = useState('');
  const [searchInput, setSearchInput] = useState('');

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

  // 通用通知 Modal（替代 alert）
  const [noticeModal, setNoticeModal] = useState<{ title: string; message: string; type: 'info' | 'success' | 'error' } | null>(null);
  const showNotice = (title: string, message: string, type: 'info' | 'success' | 'error' = 'info') => {
    setNoticeModal({ title, message, type });
  };

  // 批量标记已支付
  const [selectedSpNos, setSelectedSpNos] = useState<Set<string>>(new Set());
  const [batchModal, setBatchModal] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchRemark, setBatchRemark] = useState('');

  // 判断行是否可勾选：审批中或已通过 + 未支付
  const isCheckable = (item: ExpenseApprovalListItem) =>
    canMarkPaid && (item.sp_status === 1 || item.sp_status === 2) && item.payment_status === 'unpaid';

  // 全选/取消全选（当前页可勾选的行）
  const toggleSelectAll = () => {
    const checkable = list.filter(isCheckable);
    if (checkable.length > 0 && checkable.every(i => selectedSpNos.has(i.sp_no))) {
      // 取消全选
      setSelectedSpNos(new Set());
    } else {
      setSelectedSpNos(new Set(checkable.map(i => i.sp_no)));
    }
  };

  // 单行勾选/取消
  const toggleRow = (spNo: string) => {
    setSelectedSpNos(prev => {
      const next = new Set(prev);
      if (next.has(spNo)) next.delete(spNo);
      else next.add(spNo);
      return next;
    });
  };

  // 已选合计金额
  const selectedTotal = list
    .filter(i => selectedSpNos.has(i.sp_no))
    .reduce((sum, i) => sum + (i.amount || 0), 0);

  // 批量标记已支付
  const handleBatchMarkPaid = async () => {
    setBatchLoading(true);
    try {
      const res = await expenseApi.markPaidBatch(Array.from(selectedSpNos), batchRemark);
      showNotice('批量标记完成', `成功 ${res.success} 条，失败 ${res.failed} 条`, res.failed > 0 ? 'info' : 'success');
      setBatchModal(false);
      setBatchRemark('');
      setSelectedSpNos(new Set());
      loadList();
    } catch (err: any) {
      showNotice('批量标记失败', err.message, 'error');
    } finally {
      setBatchLoading(false);
    }
  };

  // ---- 加载列表 ----
  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await expenseApi.list({
        page,
        pageSize,
        status: statusFilter ? Number(statusFilter) : undefined,
        paymentStatus: paymentFilter || undefined,
        month: selectedMonth,
        keyword: keyword || undefined,
      });
      setList(res.list);
      setTotal(res.total);
      setSummary(res.summary);
    } catch (err: any) {
      console.error('加载列表失败:', err);
      showNotice('加载失败', err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, statusFilter, paymentFilter, selectedMonth, keyword]);

  useEffect(() => { loadList(); }, [loadList]);

  // ---- 月份切换 ----
  const changeMonth = (delta: number) => {
    const [y, m] = selectedMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    setPage(1);
  };

  // ---- 搜索 ----
  const handleSearch = () => {
    setKeyword(searchInput.trim());
    setPage(1);
  };
  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };
  const handleClearSearch = () => {
    setSearchInput('');
    setKeyword('');
    setPage(1);
  };

  // ---- 同步 ----
  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await expenseApi.sync();
      if (res.skipped) {
        showNotice('同步提示', res.message || '刚同步过，请稍后再试', 'info');
      } else {
        showNotice('同步完成', `新增 ${res.synced} 条，失败 ${res.failed} 条`, res.failed > 0 ? 'info' : 'success');
        loadList();
      }
    } catch (err: any) {
      showNotice('同步失败', err.message, 'error');
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
      showNotice('刷新完成', `成功 ${res.summary.refreshed} 条，跳过 ${res.summary.skipped} 条，失败 ${res.summary.failed} 条`, res.summary.failed > 0 ? 'info' : 'success');
      loadList();
    } catch (err: any) {
      showNotice('刷新失败', err.message, 'error');
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
      showNotice('加载详情失败', err.message, 'error');
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
      showNotice('操作失败', err.message, 'error');
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
          {/* 月份选择器：上月 / 月份 / 下月 */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => changeMonth(-1)}
              className="btn-secondary px-3 py-2 text-lg leading-none"
              title="上个月"
            >‹</button>
            <div className="min-w-[120px] text-center">
              <span className="text-lg font-semibold text-gray-900">
                {selectedMonth.replace('-', '年')}月
              </span>
            </div>
            <button
              onClick={() => changeMonth(1)}
              className="btn-secondary px-3 py-2 text-lg leading-none"
              title="下个月"
            >›</button>
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
          {/* 搜索框：单号/申请人/金额 */}
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="搜索单号 / 申请人 / 金额"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-56"
            />
            <button
              onClick={handleSearch}
              className="btn-primary px-3 py-2 text-sm"
            >搜索</button>
            {keyword && (
              <button
                onClick={handleClearSearch}
                className="btn-secondary px-3 py-2 text-sm"
              >清除</button>
            )}
          </div>
          <span className="text-sm text-gray-500">共 {total} 条</span>
        </div>

        {/* 列表表格 */}
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                {canMarkPaid && <th className="px-3 py-3 text-center w-10">
                  <input
                    type="checkbox"
                    checked={list.filter(isCheckable).length > 0 && list.filter(isCheckable).every(i => selectedSpNos.has(i.sp_no))}
                    onChange={toggleSelectAll}
                    className="h-4 w-4 cursor-pointer"
                  />
                </th>}
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
                <tr><td colSpan={9} className="px-3 py-8 text-center text-gray-400">加载中...</td></tr>
              ) : list.length === 0 ? (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-gray-400">
                  暂无数据。请先在 WecomManager 配置"费用支付申请模板ID"后运行同步脚本。
                </td></tr>
              ) : (
                /* 选中月份后列表平铺展示，不再按月分组 */
                list.map((item) => (
                  <tr key={item.sp_no} className="hover:bg-gray-50">
                    {canMarkPaid && <td className="px-3 py-3 text-center">
                      {isCheckable(item) && (
                        <input
                          type="checkbox"
                          checked={selectedSpNos.has(item.sp_no)}
                          onChange={() => toggleRow(item.sp_no)}
                          className="h-4 w-4 cursor-pointer"
                        />
                      )}
                    </td>}
                    <td className="px-3 py-3 font-mono text-xs text-gray-700">{item.sp_no}</td>
                    <td className="px-3 py-3 text-gray-900">{item.applyer_name || item.applyer_userid || '-'}</td>
                    <td className="px-3 py-3 text-right text-gray-900">
                      {item.amount > 0 ? `¥${formatAmount(item.amount)}` : '-'}
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
                      {(item.sp_status === 1 || item.sp_status === 2) ? (
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
                        {canMarkPaid && (item.sp_status === 1 || item.sp_status === 2) && (
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
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* 批量操作栏（有选中时显示） */}
        {selectedSpNos.size > 0 && (
          <div className="sticky bottom-0 mt-4 flex items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-5 py-3 shadow-lg">
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-blue-800">
                已选 {selectedSpNos.size} 条
              </span>
              <span className="text-lg font-bold text-blue-900">
                合计 ¥{formatAmount(selectedTotal)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setBatchModal(true)}
                className="btn-primary flex items-center gap-2 px-4 py-2"
              >
                批量标记已支付
              </button>
              <button
                onClick={() => setSelectedSpNos(new Set())}
                className="btn-secondary px-4 py-2"
              >
                取消
              </button>
            </div>
          </div>
        )}

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

      {/* 通用通知 Modal（替代 alert） */}
      {noticeModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setNoticeModal(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
              <div className={`h-10 w-10 rounded-full flex items-center justify-center ${
                noticeModal.type === 'success' ? 'bg-green-50' :
                noticeModal.type === 'error' ? 'bg-red-50' : 'bg-blue-50'
              }`}>
                <span className="text-xl">
                  {noticeModal.type === 'success' ? '✓' : noticeModal.type === 'error' ? '✕' : 'i'}
                </span>
              </div>
              <h3 className="text-base font-medium text-gray-800">{noticeModal.title}</h3>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-gray-600">{noticeModal.message}</p>
            </div>
            <div className="flex justify-end p-5 border-t border-gray-100">
              <button
                onClick={() => setNoticeModal(null)}
                className="btn-primary px-4 py-2"
              >确定</button>
            </div>
          </div>
        </div>
      )}

      {/* 批量标记已支付 Modal */}
      {batchModal && (
        <ConfirmModal
          title={`确认批量标记 ${selectedSpNos.size} 条为已支付`}
          message={`合计金额 ¥${formatAmount(selectedTotal)}。确认后将这些审批单标记为"已支付"。`}
          loading={batchLoading}
          showRemark={true}
          remark={batchRemark}
          onRemarkChange={setBatchRemark}
          onConfirm={handleBatchMarkPaid}
          onCancel={() => { setBatchModal(false); setBatchRemark(''); }}
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
