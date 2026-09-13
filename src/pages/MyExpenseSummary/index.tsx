/**
 * 我的报销页面
 *
 * 普通用户查看自己的费用支付申请审批记录
 * 权限：menu:my-expense-summary
 *
 * 功能：
 *   1. 列表展示（只看自己提交的）：单号/金额/状态/当前节点/支付状态/已收到状态
 *   2. 月份选择器：上月/下月快速切换
 *   3. 搜索：按单号/金额搜索
 *   4. 统计卡片：本月已通过金额/已支付金额/已收到金额
 *   5. 标记已收到/撤销（用户对账）
 *   6. 详情抽屉（共用 DetailDrawer 组件）
 *   7. 不可标记支付（无 action:mark-expense-paid 权限）
 */

import { useState, useEffect, useCallback } from 'react';
import { expenseApi, type ExpenseApprovalListItem, type ExpenseApprovalDetail } from '@/lib/api';
import { DetailDrawer, StatusBadge, formatAmount, formatTime } from '@/components/ExpenseDetailDrawer';

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: '1', label: '审批中' },
  { value: '2', label: '已通过' },
  { value: '3', label: '已驳回' },
  { value: '4', label: '已撤销' },
];

export default function MyExpenseSummary() {
  // 列表
  const [list, setList] = useState<ExpenseApprovalListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const totalPages = Math.ceil(total / pageSize);

  // 筛选
  const [statusFilter, setStatusFilter] = useState('');

  // 月份选择器
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  // 搜索
  const [keyword, setKeyword] = useState('');
  const [searchInput, setSearchInput] = useState('');

  // 合计
  const [summary, setSummary] = useState({ approved_amount: 0, paid_amount: 0, received_amount: 0 });

  // 详情抽屉
  const [detailSpNo, setDetailSpNo] = useState('');
  const [detailData, setDetailData] = useState<ExpenseApprovalDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // 通知 Modal
  const [noticeModal, setNoticeModal] = useState<{ title: string; message: string; type: 'info' | 'success' | 'error' } | null>(null);
  const showNotice = (title: string, message: string, type: 'info' | 'success' | 'error' = 'info') => {
    setNoticeModal({ title, message, type });
  };

  // 加载列表
  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await expenseApi.myList({
        page,
        pageSize,
        status: statusFilter ? Number(statusFilter) : undefined,
        month: selectedMonth,
        keyword: keyword || undefined,
      });
      setList(res.list);
      setTotal(res.total);
      setSummary(res.summary);
    } catch (err: any) {
      showNotice('加载失败', err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, statusFilter, selectedMonth, keyword]);

  useEffect(() => { loadList(); }, [loadList]);

  // 月份切换
  const changeMonth = (delta: number) => {
    const [y, m] = selectedMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    setPage(1);
  };

  // 搜索
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

  // 查看详情
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

  // 标记已收到/撤销
  const handleMarkReceived = async (spNo: string, action: 'received' | 'unreceived') => {
    try {
      if (action === 'received') {
        await expenseApi.markReceived(spNo);
      } else {
        await expenseApi.markUnreceived(spNo);
      }
      loadList();
      if (detailSpNo === spNo) handleViewDetail(spNo);
      showNotice('操作成功', `已${action === 'received' ? '标记为已收到' : '撤销已收到'}`, 'success');
    } catch (err: any) {
      showNotice('操作失败', err.message, 'error');
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      {/* 页头 */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-3xl">📋</span>
          <div>
            <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">我的报销</h1>
            <p className="mt-1 text-sm text-gray-500">查看自己提交的费用支付申请审批记录</p>
          </div>
        </div>
        {/* 月份选择器 */}
        <div className="flex items-center gap-2">
          <button onClick={() => changeMonth(-1)} className="btn-secondary px-3 py-2 text-lg leading-none" title="上个月">‹</button>
          <div className="min-w-[120px] text-center">
            <span className="text-lg font-semibold text-gray-900">{selectedMonth.replace('-', '年')}月</span>
          </div>
          <button onClick={() => changeMonth(1)} className="btn-secondary px-3 py-2 text-lg leading-none" title="下个月">›</button>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-500">本月已通过金额</p>
          <p className="mt-1 text-2xl font-bold text-blue-600">¥{formatAmount(summary.approved_amount)}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-500">本月已支付金额</p>
          <p className="mt-1 text-2xl font-bold text-green-600">¥{formatAmount(summary.paid_amount)}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-500">本月已收到金额</p>
          <p className="mt-1 text-2xl font-bold text-purple-600">¥{formatAmount(summary.received_amount)}</p>
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
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="搜索单号 / 金额"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-56"
          />
          <button onClick={handleSearch} className="btn-primary px-3 py-2 text-sm">搜索</button>
          {keyword && (
            <button onClick={handleClearSearch} className="btn-secondary px-3 py-2 text-sm">清除</button>
          )}
        </div>
        <span className="text-sm text-gray-500">共 {total} 条</span>
      </div>

      {/* 列表表格 */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-3 py-3 text-left">单号</th>
              <th className="px-3 py-3 text-right">金额</th>
              <th className="px-3 py-3 text-left">审批状态</th>
              <th className="px-3 py-3 text-left">当前节点</th>
              <th className="px-3 py-3 text-left">支付状态</th>
              <th className="px-3 py-3 text-left">收到状态</th>
              <th className="px-3 py-3 text-left">申请时间</th>
              <th className="px-3 py-3 text-center">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-400">加载中...</td></tr>
            ) : list.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-400">暂无数据</td></tr>
            ) : (
              list.map((item) => (
                <tr key={item.sp_no} className="hover:bg-gray-50">
                  <td className="px-3 py-3 font-mono text-xs text-gray-700">{item.sp_no}</td>
                  <td className="px-3 py-3 text-right text-gray-900">
                    {item.amount > 0 ? `¥${formatAmount(item.amount)}` : '-'}
                  </td>
                  <td className="px-3 py-3"><StatusBadge status={item.sp_status} label={item.sp_status_name} /></td>
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
                        item.payment_status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                        {item.payment_status === 'paid' ? '✓ 已支付' : '⚠ 未支付'}
                      </span>
                    ) : '-'}
                  </td>
                  <td className="px-3 py-3">
                    {item.sp_status === 2 ? (
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${
                        item.received_status === 'received' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {item.received_status === 'received' ? '✓ 已收到' : '未收到'}
                      </span>
                    ) : '-'}
                  </td>
                  <td className="px-3 py-3 text-gray-600">{formatTime(item.apply_time)}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => handleViewDetail(item.sp_no)} className="text-xs text-blue-600 hover:text-blue-800">详情</button>
                      {item.sp_status === 2 && (
                        <>
                          <span className="text-gray-300">|</span>
                          {item.received_status === 'unreceived' ? (
                            <button onClick={() => handleMarkReceived(item.sp_no, 'received')} className="text-xs text-purple-600 hover:text-purple-800">标记已收到</button>
                          ) : (
                            <button onClick={() => handleMarkReceived(item.sp_no, 'unreceived')} className="text-xs text-gray-600 hover:text-gray-800">撤销已收到</button>
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

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="btn-secondary px-3 py-1 disabled:opacity-50">上一页</button>
          <span className="text-sm text-gray-600">{page} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="btn-secondary px-3 py-1 disabled:opacity-50">下一页</button>
        </div>
      )}

      {/* 详情抽屉 */}
      {detailSpNo && (
        <DetailDrawer
          spNo={detailSpNo}
          data={detailData}
          loading={detailLoading}
          onClose={() => { setDetailSpNo(''); setDetailData(null); }}
          canMarkReceived={true}
          receivedStatus={list.find(i => i.sp_no === detailSpNo)?.received_status}
          onMarkReceived={handleMarkReceived}
        />
      )}

      {/* 通知 Modal */}
      {noticeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setNoticeModal(null)}>
          <div className="w-full max-w-sm rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
              <div className={`h-10 w-10 rounded-full flex items-center justify-center ${
                noticeModal.type === 'success' ? 'bg-green-50' : noticeModal.type === 'error' ? 'bg-red-50' : 'bg-blue-50'
              }`}>
                <span className="text-xl">{noticeModal.type === 'success' ? '✓' : noticeModal.type === 'error' ? '✕' : 'i'}</span>
              </div>
              <h3 className="text-base font-medium text-gray-800">{noticeModal.title}</h3>
            </div>
            <div className="px-5 py-4"><p className="text-sm text-gray-600">{noticeModal.message}</p></div>
            <div className="flex justify-end p-5 border-t border-gray-100">
              <button onClick={() => setNoticeModal(null)} className="btn-primary px-4 py-2">确定</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
