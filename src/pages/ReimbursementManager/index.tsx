import { useState, useEffect } from 'react';
import { Receipt, CheckCircle2, Clock, XCircle, ExternalLink, RefreshCw, X, Trash2, Download, FileDown, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '@/lib/api';
import { formatCurrency } from '@/utils/format';

interface ConfirmationDepartment {
  id: string;
  name: string;
  confirmed: boolean;
  confirmed_by?: string;
  confirmed_at?: string;
}

interface ConfirmationItem {
  ingredient_name: string;
  purchase_unit: string;
  purchase_quantity: number;
  purchase_unit_price: number;
  amount: number;
  department_name: string;
}

interface PurchaseConfirmation {
  id: string;
  purchase_date: string;
  total_amount: number;
  departments: ConfirmationDepartment[];
  purchase_items: ConfirmationItem[];
  status: string;
  reimbursement_no?: string;
  reimbursement_sp_no?: string;
  reimbursement_status: string;
  rejection_reason?: string;
  pdf_url?: string;
  created_at: string;
  user_confirmations?: Record<string, { confirmed: boolean; confirmed_at?: string; confirmed_by?: string }>;
  user_departments?: Record<string, { departments: string[] } | string[]>;
}

export default function ReimbursementManager() {
  const [confirmations, setConfirmations] = useState<PurchaseConfirmation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<PurchaseConfirmation | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetchConfirmations();
  }, [selectedMonth]);

  const fetchConfirmations = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.get<PurchaseConfirmation[]>(`/purchase-confirmations?month=${selectedMonth}`);
      setConfirmations(data);
    } catch (err: any) {
      setError(err.message || '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  const showDetail = async (id: string) => {
    setDetailId(id);
    try {
      const data = await api.get<PurchaseConfirmation>(`/purchase-confirmations/${id}`);
      setDetailData(data);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleResubmit = async (id: string) => {
    if (!window.confirm('确定重新发起报销吗？')) return;
    try {
      await api.post(`/purchase-confirmations/${id}/resubmit`);
      showDetail(id);
      fetchConfirmations();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleInitiateReimbursement = async (id: string) => {
    if (!window.confirm('确定发起费用报销申请吗？')) return;
    try {
      await api.post(`/purchase-confirmations/${id}/resubmit`);
      showDetail(id);
      fetchConfirmations();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleRefreshStatus = async (id: string) => {
    try {
      const data = await api.post<PurchaseConfirmation>(`/purchase-confirmations/${id}/refresh-status`);
      setConfirmations(prev => prev.map(c => c.id === id ? data : c));
      if (detailId === id) {
        setDetailData(data);
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleGeneratePDF = async (id: string) => {
    try {
      await api.post(`/purchase-confirmations/${id}/generate-pdf`);
      fetchConfirmations();
    } catch (err: any) {
      setError(err.message || 'PDF生成失败');
    }
  };

  const handleResetConfirmations = async (id: string) => {
    if (!window.confirm('确定重置所有部门的确认状态吗？所有部门将需要重新签字确认。')) return;
    try {
      await api.post(`/purchase-confirmations/${id}/reset-confirmations`);
      showDetail(id);
      fetchConfirmations();
    } catch (err: any) {
      setError(err.message || '重置失败');
    }
  };

  const handleDownloadPDF = async (id: string) => {
    try {
      const token = localStorage.getItem('auth-session');
      let authToken = '';
      if (token) {
        const data = JSON.parse(token);
        authToken = data?.state?.user?.token || '';
      }
      
      const response = await fetch(`${api.getBaseUrl()}/purchase-confirmations/${id}/pdf`, {
        headers: {
          'Authorization': authToken ? `Bearer ${authToken}` : '',
        },
      });
      
      if (!response.ok) {
        throw new Error('下载失败');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `采购确认单_${id}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message || '下载失败');
    }
  };

  // 统计数据
  const safeParseFloat = (val: any): number => {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    if (typeof val === 'object' && val !== null) {
      // mysql2 有时返回 { String: '2239.08' } 对象
      val = val.String || val.string || JSON.stringify(val);
    }
    const n = parseFloat(String(val));
    return isNaN(n) ? 0 : n;
  };

  const stats = {
    total: confirmations.length,
    totalAmount: confirmations.reduce((sum, c) => sum + safeParseFloat(c.total_amount), 0),
    approved: confirmations.filter(c => c.reimbursement_status === 'approved'),
    pending: confirmations.filter(c => c.reimbursement_status === 'pending'),
    rejected: confirmations.filter(c => c.reimbursement_status === 'rejected'),
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'approved': return <CheckCircle2 size={16} className="text-green-500" />;
      case 'pending': return <Clock size={16} className="text-yellow-500" />;
      case 'rejected': return <XCircle size={16} className="text-red-500" />;
      default: return null;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'approved': return '已通过';
      case 'pending': return '审批中';
      case 'rejected': return '已拒绝';
      default: return status;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved': return 'text-green-600 bg-green-50';
      case 'pending': return 'text-yellow-600 bg-yellow-50';
      case 'rejected': return 'text-red-600 bg-red-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr.substring(0, 10);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('确定删除该确认单吗？删除后不可恢复。')) return;
    try {
      await api.delete(`/purchase-confirmations/${id}`);
      setConfirmations(prev => prev.filter(c => c.id !== id));
      if (detailId === id) {
        setDetailId(null);
        setDetailData(null);
      }
    } catch (err: any) {
      setError(err.message || '删除失败');
    }
  };

  // 月份选择
  const months: string[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  const detailConfirmation = detailId ? confirmations.find(c => c.id === detailId) || detailData : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold text-gray-800">报销管理</h1>
          <p className="text-gray-500 mt-1">查看采购报销审批情况</p>
        </div>
        <select
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          className="border border-gray-200 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
        >
          {months.map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      {error && (
        <div className="bg-danger-50 border border-danger-200 rounded-lg p-4 flex items-center gap-3">
          <XCircle size={20} className="text-danger-500" />
          <span className="text-danger-700">{error}</span>
        </div>
      )}

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="card p-4">
          <p className="text-sm text-gray-500 mb-1">总单数</p>
          <p className="text-2xl font-bold text-gray-800">{stats.total}</p>
          <p className="text-xs text-gray-400 mt-1">总金额：{formatCurrency(stats.totalAmount)}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 size={16} className="text-green-500" />
            <p className="text-sm text-gray-500">已通过</p>
          </div>
          <p className="text-2xl font-bold text-green-600">{stats.approved.length}</p>
          <p className="text-xs text-gray-400 mt-1">{formatCurrency(stats.approved.reduce((s, c) => s + safeParseFloat(c.total_amount), 0))}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-1">
            <Clock size={16} className="text-yellow-500" />
            <p className="text-sm text-gray-500">待审批</p>
          </div>
          <p className="text-2xl font-bold text-yellow-600">{stats.pending.length}</p>
          <p className="text-xs text-gray-400 mt-1">{formatCurrency(stats.pending.reduce((s, c) => s + safeParseFloat(c.total_amount), 0))}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-1">
            <XCircle size={16} className="text-red-500" />
            <p className="text-sm text-gray-500">已拒绝</p>
          </div>
          <p className="text-2xl font-bold text-red-600">{stats.rejected.length}</p>
          <p className="text-xs text-gray-400 mt-1">{formatCurrency(stats.rejected.reduce((s, c) => s + safeParseFloat(c.total_amount), 0))}</p>
        </div>
      </div>

      {/* 列表 */}
      {loading ? (
        <div className="text-center py-10 text-gray-500">加载中...</div>
      ) : confirmations.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-20">
          <Receipt size={64} className="text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-600 mb-2">暂无报销记录</h3>
          <p className="text-gray-400 text-sm">当月没有采购确认记录</p>
        </div>
      ) : (
        <div className="space-y-2">
          {confirmations.map(c => {
            const confirmedDepts = c.departments?.filter(d => d.confirmed).length || 0;
            const totalDepts = c.departments?.length || 0;
            const totalUsers = c.user_departments ? Object.keys(c.user_departments).length : totalDepts;
            const confirmedUsers = c.user_confirmations ? Object.values(c.user_confirmations).filter(uc => uc.confirmed).length : confirmedDepts;
            return (
              <div key={c.id} className="border border-gray-200 rounded-lg overflow-hidden">
                {/* 卡片头部 - 点击展开 */}
                <div
                  className="flex items-center justify-between px-4 py-3 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors"
                  onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                >
                  <div className="flex items-center gap-3">
                    {expandedId === c.id ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-800">{formatDate(c.purchase_date)}</span>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${getStatusColor(c.reimbursement_status)}`}>
                          {getStatusIcon(c.reimbursement_status)}
                          {getStatusText(c.reimbursement_status)}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {formatCurrency(safeParseFloat(c.total_amount))} · {totalDepts}个部门 · {c.purchase_items?.length || 0}项
                        {totalUsers > 0 && (
                          <span className="ml-2 text-primary-600">
                            · {confirmedUsers}/{totalUsers} 已确认
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {c.pdf_url ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDownloadPDF(c.id); }}
                        className="text-xs text-green-600 hover:text-green-700 flex items-center gap-1"
                      >
                        <Download size={14} />
                        下载PDF
                      </button>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleGeneratePDF(c.id); }}
                        className="text-xs text-gray-500 hover:text-green-600 flex items-center gap-1"
                      >
                        <FileDown size={14} />
                        生成PDF
                      </button>
                    )}
                    <span className="text-xs text-gray-400">{c.created_at?.substring(5, 16)}</span>
                  </div>
                </div>

                {/* 展开详情 */}
                {expandedId === c.id && (
                  <div className="px-4 py-3 border-t border-gray-200 space-y-3">
                    {/* 基本信息 */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                      <div className="bg-gray-50 rounded-lg p-2">
                        <p className="text-gray-500">状态</p>
                        <p className="font-medium text-gray-800 mt-0.5">{getStatusText(c.reimbursement_status)}</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-2">
                        <p className="text-gray-500">报销单号</p>
                        <p className="font-medium text-gray-800 mt-0.5 text-xs">{c.reimbursement_sp_no || c.reimbursement_no || '未生成'}</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-2">
                        <p className="text-gray-500">确认进度</p>
                        <p className="font-medium text-gray-800 mt-0.5">{confirmedUsers}/{totalUsers} 已确认</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-2">
                        <p className="text-gray-500">金额</p>
                        <p className="font-medium text-primary-600 mt-0.5">{formatCurrency(safeParseFloat(c.total_amount))}</p>
                      </div>
                    </div>

                    {c.rejection_reason && (
                      <div className="bg-red-50 border border-red-100 rounded-lg p-2 text-xs text-red-700">
                        <span className="font-medium">拒绝原因：</span>{c.rejection_reason}
                      </div>
                    )}

                    {/* 确认进度（新流程） */}
                    {c.user_departments && Object.keys(c.user_departments).length > 0 && (
                      <div className="bg-primary-50 border border-primary-100 rounded-lg p-2">
                        <p className="text-xs text-primary-700 font-medium mb-1">确认进度</p>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(c.user_departments).map(([userid, deptData]) => {
                            const deptNames = Array.isArray(deptData) ? deptData : (deptData as any).departments || [];
                            const conf = (c.user_confirmations || {})[userid];
                            return (
                              <div key={userid} className="flex items-center gap-1 text-xs">
                                {conf?.confirmed ? (
                                  <CheckCircle2 size={12} className="text-green-500" />
                                ) : (
                                  <Clock size={12} className="text-gray-400" />
                                )}
                                <span className={conf?.confirmed ? 'text-green-700' : 'text-gray-600'}>{userid}</span>
                                <span className="text-gray-400">({deptNames.join('、')})</span>
                                {conf?.confirmed && conf.confirmed_at && (
                                  <span className="text-gray-400">{conf.confirmed_at.substring(5, 16)}</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* 部门确认记录（旧流程兼容） */}
                    {!c.user_departments && c.departments && c.departments.length > 0 && (
                      <div>
                        <p className="text-xs text-gray-500 mb-1">部门确认记录</p>
                        <div className="space-y-1">
                          {c.departments.map(dept => (
                            <div key={dept.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-1.5 text-xs">
                              <div className="flex items-center gap-2">
                                {dept.confirmed ? (
                                  <CheckCircle2 size={14} className="text-green-500" />
                                ) : (
                                  <Clock size={14} className="text-gray-400" />
                                )}
                                <span className="text-gray-700">{dept.name}</span>
                              </div>
                              <span className="text-gray-500">
                                {dept.confirmed ? `${dept.confirmed_by} ${dept.confirmed_at}` : '待确认'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 涉及部门 */}
                    <div>
                      <p className="text-xs text-gray-500 mb-1">涉及部门</p>
                      <div className="flex flex-wrap gap-1">
                        {c.departments?.map((d: any) => (
                          <span key={d.id} className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded">
                            {d.name}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* 采购明细 */}
                    {c.purchase_items && c.purchase_items.length > 0 && (
                      <div>
                        <p className="text-xs text-gray-500 mb-1">采购明细</p>
                        <div className="bg-gray-50 rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                          <table className="w-full text-xs">
                            <thead className="bg-gray-100 text-gray-600 sticky top-0">
                              <tr>
                                <th className="px-3 py-2 text-left">食材</th>
                                <th className="px-3 py-2 text-left">部门</th>
                                <th className="px-3 py-2 text-right">单价</th>
                                <th className="px-3 py-2 text-right">数量</th>
                                <th className="px-3 py-2 text-right">金额</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                              {c.purchase_items.map((item, idx) => (
                                <tr key={idx}>
                                  <td className="px-3 py-2 text-gray-700">{item.ingredient_name}</td>
                                  <td className="px-3 py-2 text-gray-500">{item.department_name}</td>
                                  <td className="px-3 py-2 text-right text-gray-700">{safeParseFloat(item.purchase_unit_price).toFixed(2)}</td>
                                  <td className="px-3 py-2 text-right text-gray-700">{item.purchase_quantity}</td>
                                  <td className="px-3 py-2 text-right font-medium text-gray-800">{safeParseFloat(item.amount).toFixed(2)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* 操作按钮 */}
                    <div className="flex gap-2 flex-wrap">
                      {c.pdf_url ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDownloadPDF(c.id); }}
                          className="btn-primary text-xs flex items-center gap-1 bg-green-500 hover:bg-green-600"
                        >
                          <Download size={14} />
                          下载PDF
                        </button>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleGeneratePDF(c.id); }}
                          className="btn-secondary text-xs flex items-center gap-1"
                        >
                          <FileDown size={14} />
                          生成PDF
                        </button>
                      )}
                      {c.reimbursement_sp_no && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRefreshStatus(c.id); }}
                          className="btn-secondary text-xs flex items-center gap-1"
                        >
                          <RefreshCw size={14} />
                          刷新状态
                        </button>
                      )}
                      {c.reimbursement_status === 'rejected' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleResubmit(c.id); }}
                          className="btn-primary text-xs flex items-center gap-1"
                        >
                          <RefreshCw size={14} />
                          重新发起
                        </button>
                      )}
                      {!c.reimbursement_sp_no && c.status === 'confirmed' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleInitiateReimbursement(c.id); }}
                          className="btn-primary text-xs flex items-center gap-1"
                        >
                          <ExternalLink size={14} />
                          发起报销
                        </button>
                      )}
                      {(c.status === 'pending' || c.status === 'confirmed') && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleResetConfirmations(c.id); }}
                          className="btn-secondary text-xs flex items-center gap-1 text-orange-500 hover:bg-orange-50"
                        >
                          <RefreshCw size={14} />
                          重置确认
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(c.id); }}
                        className="btn-secondary text-xs flex items-center gap-1 text-red-500 hover:bg-red-50 ml-auto"
                      >
                        <Trash2 size={14} />
                        删除
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 详情弹窗 */}
      {detailConfirmation && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => { setDetailId(null); setDetailData(null); }}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-800">报销单详情</h3>
              <button onClick={() => { setDetailId(null); setDetailData(null); }} className="p-1 hover:bg-gray-100 rounded-md">
                <X size={20} className="text-gray-500" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500">日期</p>
                  <p className="font-medium text-gray-800">{formatDate(detailConfirmation.purchase_date)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">付款金额</p>
                  <p className="font-medium text-primary-600">{formatCurrency(safeParseFloat(detailConfirmation.total_amount))}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">状态</p>
                  <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(detailConfirmation.reimbursement_status)}`}>
                    {getStatusIcon(detailConfirmation.reimbursement_status)}
                    {getStatusText(detailConfirmation.reimbursement_status)}
                  </span>
                </div>
                <div>
                  <p className="text-sm text-gray-500">报销单号</p>
                  <p className="font-medium text-gray-800 text-sm">{detailConfirmation.reimbursement_sp_no || detailConfirmation.reimbursement_no || '未生成'}</p>
                </div>
              </div>

              {detailConfirmation.rejection_reason && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-sm text-red-700"><strong>拒绝原因：</strong>{detailConfirmation.rejection_reason}</p>
                </div>
              )}

              {/* 部门确认记录 */}
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">部门确认记录</p>
                <div className="space-y-2">
                  {detailConfirmation.departments?.map(dept => (
                    <div key={dept.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                      <div className="flex items-center gap-2">
                        {dept.confirmed ? (
                          <CheckCircle2 size={16} className="text-green-500" />
                        ) : (
                          <Clock size={16} className="text-gray-400" />
                        )}
                        <span className="text-sm text-gray-700">{dept.name}</span>
                      </div>
                      <div className="text-xs text-gray-500">
                        {dept.confirmed ? `${dept.confirmed_by} ${dept.confirmed_at}` : '待确认'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 采购明细 */}
              {detailConfirmation.purchase_items && detailConfirmation.purchase_items.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-2">采购明细</p>
                  <div className="bg-gray-50 rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-100 text-gray-600">
                        <tr>
                          <th className="px-3 py-2 text-left">食材</th>
                          <th className="px-3 py-2 text-left">部门</th>
                          <th className="px-3 py-2 text-right">单价</th>
                          <th className="px-3 py-2 text-right">数量</th>
                          <th className="px-3 py-2 text-right">金额</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {detailConfirmation.purchase_items.map((item, idx) => (
                          <tr key={idx}>
                            <td className="px-3 py-2 text-gray-700">{item.ingredient_name}</td>
                            <td className="px-3 py-2 text-gray-500">{item.department_name}</td>
                            <td className="px-3 py-2 text-right text-gray-700">{safeParseFloat(item.purchase_unit_price).toFixed(2)}</td>
                            <td className="px-3 py-2 text-right text-gray-700">{item.purchase_quantity}</td>
                            <td className="px-3 py-2 text-right font-medium text-gray-800">{safeParseFloat(item.amount).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* 操作按钮 */}
              <div className="flex gap-3 pt-2 justify-between">
                <div className="flex gap-3 flex-wrap">
                  {detailConfirmation.pdf_url && (
                    <button
                      onClick={() => handleDownloadPDF(detailConfirmation.id)}
                      className="btn-primary flex items-center gap-2 bg-green-500 hover:bg-green-600"
                    >
                      <Download size={16} />
                      下载PDF
                    </button>
                  )}
                  <button
                    onClick={() => handleGeneratePDF(detailConfirmation.id)}
                    className="btn-secondary flex items-center gap-2"
                  >
                    <FileDown size={16} />
                    {detailConfirmation.pdf_url ? '重新生成PDF' : '生成PDF'}
                  </button>
                  {detailConfirmation.reimbursement_sp_no && (
                    <button
                      onClick={() => handleRefreshStatus(detailConfirmation.id)}
                      className="btn-secondary flex items-center gap-2"
                    >
                      <RefreshCw size={16} />
                      刷新状态
                    </button>
                  )}
                  {detailConfirmation.reimbursement_status === 'rejected' && (
                    <button
                      onClick={() => handleResubmit(detailConfirmation.id)}
                      className="btn-primary flex items-center gap-2"
                    >
                      <RefreshCw size={16} />
                      重新发起
                    </button>
                  )}
                  {!detailConfirmation.reimbursement_sp_no && detailConfirmation.status === 'confirmed' && (
                    <button
                      onClick={() => handleInitiateReimbursement(detailConfirmation.id)}
                      className="btn-primary flex items-center gap-2"
                    >
                      <ExternalLink size={16} />
                      发起报销
                    </button>
                  )}
                  {(detailConfirmation.status === 'pending' || detailConfirmation.status === 'confirmed') && (
                    <button
                      onClick={() => handleResetConfirmations(detailConfirmation.id)}
                      className="btn-secondary flex items-center gap-2 text-orange-500 hover:bg-orange-50"
                    >
                      <RefreshCw size={16} />
                      重置确认
                    </button>
                  )}
                </div>
                <button
                  onClick={() => handleDelete(detailConfirmation.id)}
                  className="btn-secondary flex items-center gap-2 text-red-500 hover:bg-red-50"
                >
                  <Trash2 size={16} />
                  删除
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
