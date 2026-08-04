import { useState, useEffect } from 'react';
import { Check, X, Clock, Package, User, Phone, Calendar, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';

interface RequisitionItem {
  item_id: string;
  item_name: string;
  quantity: number;
  unit: string;
  unit_price: number;
}

interface Requisition {
  id: string;
  requisition_no: string;
  temp_user_id: string;
  user_name: string;
  user_phone: string;
  warehouse_id: string;
  warehouse_name: string;
  items: RequisitionItem[];
  status: 'pending' | 'approved' | 'rejected' | 'auto';
  auditor_name: string | null;
  approved_at: string | null;
  reject_reason: string | null;
  created_at: string;
}

interface Warehouse {
  id: string;
  name: string;
  department_name?: string;
}

const statusConfig = {
  pending: { label: '待审核', color: 'bg-amber-100 text-amber-700', icon: Clock },
  approved: { label: '已通过', color: 'bg-green-100 text-green-700', icon: Check },
  rejected: { label: '已驳回', color: 'bg-red-100 text-red-700', icon: X },
  auto: { label: '自动出库', color: 'bg-blue-100 text-blue-700', icon: Package },
};

export default function ScanAudit() {
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('pending');
  const [selected, setSelected] = useState<Requisition | null>(null);
  const [approveWarehouse, setApproveWarehouse] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [actioning, setActioning] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchList();
    fetchWarehouses();
  }, [filterStatus]);

  const fetchList = async () => {
    setLoading(true);
    try {
      const res = await api.get<{ data: Requisition[]; total: number }>('/scan-requisition/pending', {
        params: { status: filterStatus, pageSize: 100 },
      });
      setRequisitions(res.data || []);
    } catch (err: any) {
      setError(err.message || '获取列表失败');
    } finally {
      setLoading(false);
    }
  };

  const fetchWarehouses = async () => {
    try {
      const res = await api.get<Warehouse[]>('/warehouses');
      setWarehouses(res.filter((w: any) => w.type !== 'main' && w.status === 1));
    } catch {}
  };

  const handleApprove = async () => {
    if (!selected) return;
    if (!approveWarehouse) { setError('请选择出库仓库'); return; }
    setActioning(true);
    setError('');
    try {
      await api.post(`/scan-requisition/${selected.id}/approve`, { warehouse_id: approveWarehouse });
      setSelected(null);
      setApproveWarehouse('');
      await fetchList();
    } catch (err: any) {
      setError(err.message || '审核失败');
    } finally {
      setActioning(false);
    }
  };

  const handleReject = async () => {
    if (!selected) return;
    setActioning(true);
    setError('');
    try {
      await api.post(`/scan-requisition/${selected.id}/reject`, { reason: rejectReason });
      setSelected(null);
      setRejectReason('');
      await fetchList();
    } catch (err: any) {
      setError(err.message || '驳回失败');
    } finally {
      setActioning(false);
    }
  };

  const formatTime = (str: string) => {
    if (!str) return '-';
    const d = new Date(str);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  const calcTotal = (items: RequisitionItem[]) =>
    items.reduce((sum, i) => sum + i.quantity * (i.unit_price || 0), 0);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">领料审核</h1>
        <div className="flex gap-2">
          {(['pending', 'approved', 'rejected', 'auto', 'all'] as const).map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filterStatus === s ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>
              {s === 'all' ? '全部' : statusConfig[s].label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

      {/* 列表 */}
      <div className="grid gap-3">
        {loading ? (
          <div className="text-center py-16 text-gray-400">加载中...</div>
        ) : requisitions.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Package className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p>暂无领料记录</p>
          </div>
        ) : (
          requisitions.map(req => {
            const sc = statusConfig[req.status];
            const Icon = sc.icon;
            const total = calcTotal(req.items);
            return (
              <div key={req.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="font-mono text-sm text-gray-500">{req.requisition_no}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${sc.color}`}>
                        <Icon className="w-3 h-3 inline mr-1" />{sc.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-gray-600">
                      <span className="flex items-center gap-1"><User className="w-3.5 h-3.5" />{req.user_name}</span>
                      {req.user_phone && <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" />{req.user_phone}</span>}
                      <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{formatTime(req.created_at)}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {req.items.map((item, idx) => (
                        <span key={idx} className="inline-flex items-center gap-1 px-2 py-1 bg-gray-50 rounded text-xs text-gray-600">
                          {item.item_name} ×{item.quantity}{item.unit}
                        </span>
                      ))}
                    </div>
                    <div className="mt-2 text-sm">
                      <span className="text-gray-400">合计：</span>
                      <span className="font-semibold text-gray-800">¥{total.toFixed(2)}</span>
                      {req.warehouse_name && <span className="ml-3 text-gray-400">仓库：{req.warehouse_name}</span>}
                    </div>
                    {req.status === 'approved' && req.auditor_name && (
                      <div className="mt-1 text-xs text-gray-400">审核人：{req.auditor_name} · {formatTime(req.approved_at || '')}</div>
                    )}
                    {req.status === 'rejected' && req.reject_reason && (
                      <div className="mt-1 text-xs text-red-400">驳回原因：{req.reject_reason}</div>
                    )}
                  </div>
                  {req.status === 'pending' && (
                    <button onClick={() => { setSelected(req); setApproveWarehouse(req.warehouse_id || ''); }}
                      className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 active:scale-95 transition-all flex items-center gap-1">
                      审核 <ChevronRight className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 审核弹窗 */}
      {selected && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-800">领料审核</h2>
                <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
              </div>

              {/* 领料人信息 */}
              <div className="bg-gray-50 rounded-lg p-3 mb-4">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-gray-400">领料人：</span><span className="font-medium">{selected.user_name}</span></div>
                  <div><span className="text-gray-400">手机号：</span>{selected.user_phone || '-'}</div>
                  <div><span className="text-gray-400">编号：</span>{selected.requisition_no}</div>
                  <div><span className="text-gray-400">时间：</span>{formatTime(selected.created_at)}</div>
                </div>
              </div>

              {/* 物资清单 */}
              <div className="mb-4">
                <p className="text-sm font-medium text-gray-700 mb-2">物资清单</p>
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500">
                      <tr>
                        <th className="px-3 py-2 text-left">物资名称</th>
                        <th className="px-3 py-2 text-right">数量</th>
                        <th className="px-3 py-2 text-right">单价</th>
                        <th className="px-3 py-2 text-right">金额</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {selected.items.map((item, idx) => (
                        <tr key={idx}>
                          <td className="px-3 py-2 text-gray-700">{item.item_name}</td>
                          <td className="px-3 py-2 text-right">{item.quantity} {item.unit}</td>
                          <td className="px-3 py-2 text-right">¥{(item.unit_price || 0).toFixed(2)}</td>
                          <td className="px-3 py-2 text-right font-medium">¥{(item.quantity * (item.unit_price || 0)).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-50">
                      <tr>
                        <td colSpan={3} className="px-3 py-2 text-right text-gray-500">合计</td>
                        <td className="px-3 py-2 text-right font-bold">¥{calcTotal(selected.items).toFixed(2)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* 出库仓库选择 */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">出库仓库</label>
                <select value={approveWarehouse} onChange={e => setApproveWarehouse(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20">
                  <option value="">请选择仓库...</option>
                  {warehouses.map(w => (
                    <option key={w.id} value={w.id}>{w.name}{w.department_name ? `（${w.department_name}）` : ''}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 mt-1">审核通过后将自动扣减该仓库库存，并绑定领料人（后续免审核）</p>
              </div>

              {/* 驳回原因 */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">驳回原因（选填）</label>
                <input type="text" value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                  placeholder="如需驳回，请填写原因"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500/20" />
              </div>

              {error && <div className="mb-3 p-2 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

              {/* 操作按钮 */}
              <div className="flex gap-3">
                <button onClick={handleApprove} disabled={actioning || !approveWarehouse}
                  className="flex-1 py-2.5 bg-green-500 text-white rounded-lg font-medium hover:bg-green-600 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-1">
                  <Check className="w-4 h-4" /> 审核通过
                </button>
                <button onClick={handleReject} disabled={actioning}
                  className="flex-1 py-2.5 bg-red-50 text-red-600 rounded-lg font-medium hover:bg-red-100 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-1">
                  <X className="w-4 h-4" /> 驳回
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
