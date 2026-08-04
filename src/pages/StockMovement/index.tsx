import { useState, useEffect } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Search,
  X,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { formatCurrency } from '@/utils/format';
import BatchInboundModal from '@/components/BatchInboundModal';

// 仓库汇总信息（用于仓库下拉）
interface WarehouseSummary {
  warehouse_id: string;
  warehouse_name: string;
  item_count: number;
  total_value: number;
  low_stock_count: number;
}

// 库存物资（用于弹窗物资下拉）
interface InventoryItem {
  id: string;
  item_name: string;
  sku: string;
  unit: string;
  unit_price: number;
  reference_price: number;
}

// 出入库记录
interface StockMovementItem {
  id: string;
  created_at: string;
  warehouse_id: string;
  warehouse_name: string;
  item_id: string;
  item_name: string;
  movement_type: 'inbound' | 'outbound';
  quantity: number;
  unit: string;
  unit_price: number;
  total_amount: number;
  operator_name: string;
  reason: string;
}

// 列表响应
interface MovementListResponse {
  data: StockMovementItem[];
  total: number;
  page: number;
  page_size: number;
}

// 弹窗表单
interface MovementForm {
  warehouse_id: string;
  item_id: string;
  quantity: string;
  unit: string;
  unit_price: string;
  reason: string;
}

const EMPTY_FORM: MovementForm = {
  warehouse_id: '',
  item_id: '',
  quantity: '',
  unit: '',
  unit_price: '',
  reason: '',
};

const PAGE_SIZE = 20;

const MANAGER_ROLES = ['admin', 'finance', 'boss'];

export default function StockMovement() {
  const { user } = useAuthStore();
  const isManager = user ? MANAGER_ROLES.includes(user.role) : false;

  const [warehouses, setWarehouses] = useState<WarehouseSummary[]>([]);
  const [movements, setMovements] = useState<StockMovementItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 筛选条件
  const [warehouseId, setWarehouseId] = useState<string>('');
  const [movementType, setMovementType] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // 弹窗状态
  const [modalType, setModalType] = useState<'inbound' | 'outbound' | null>(null);
  const [form, setForm] = useState<MovementForm>(EMPTY_FORM);
  const [materialOptions, setMaterialOptions] = useState<InventoryItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // 批量入库弹窗
  const [batchInboundOpen, setBatchInboundOpen] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // 获取仓库列表（复用库存汇总接口）
  const fetchWarehouses = async () => {
    try {
      const data = await api.get<WarehouseSummary[]>('/inventory/summary');
      setWarehouses(data || []);
    } catch (err: any) {
      console.error('获取仓库列表失败', err);
    }
  };

  // 获取出入库流水
  const fetchMovements = async (targetPage = page) => {
    setLoading(true);
    setError('');
    try {
      const data = await api.get<MovementListResponse>('/stock-movements', {
        params: {
          warehouse_id: warehouseId || undefined,
          movement_type: movementType || undefined,
          start_date: startDate || undefined,
          end_date: endDate || undefined,
          page: targetPage,
          page_size: PAGE_SIZE,
        },
      });
      setMovements(data.data || []);
      setTotal(data.total || 0);
      setPage(data.page || targetPage);
    } catch (err: any) {
      setError(err.message || '获取出入库记录失败');
      setMovements([]);
    } finally {
      setLoading(false);
    }
  };

  // 初始化
  useEffect(() => {
    fetchWarehouses();
    fetchMovements(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 筛选条件变化时回到第一页重新拉取
  useEffect(() => {
    fetchMovements(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouseId, movementType, startDate, endDate]);

  // 打开弹窗时加载所选仓库的物资
  const openModal = async (type: 'inbound' | 'outbound') => {
    setModalType(type);
    setForm(EMPTY_FORM);
    setFormError('');
    setMaterialOptions([]);
  };

  // 弹窗内选择仓库后加载该仓库物资
  const handleWarehouseChange = async (wid: string) => {
    setForm((prev) => ({ ...prev, warehouse_id: wid, item_id: '', unit: '', unit_price: '' }));
    if (!wid) {
      setMaterialOptions([]);
      return;
    }
    try {
      const data = await api.get<InventoryItem[]>('/inventory', {
        params: { warehouse_id: wid },
      });
      setMaterialOptions(data || []);
    } catch (err: any) {
      setMaterialOptions([]);
    }
  };

  // 选择物资时自动填充单位与参考单价
  const handleMaterialChange = (itemId: string) => {
    const target = materialOptions.find((m) => m.id === itemId);
    setForm((prev) => ({
      ...prev,
      item_id: itemId,
      unit: target?.unit || '',
      unit_price: target?.reference_price ? String(target.reference_price) : '',
    }));
  };

  // 提交入库/出库
  const handleSubmit = async () => {
    if (!modalType) return;
    setFormError('');
    if (!form.warehouse_id) {
      setFormError('请选择仓库');
      return;
    }
    if (!form.item_id) {
      setFormError('请选择物资');
      return;
    }
    const qty = Number(form.quantity);
    if (!form.quantity || isNaN(qty) || qty <= 0) {
      setFormError('请输入有效数量');
      return;
    }
    const price = Number(form.unit_price);
    if (isNaN(price) || price < 0) {
      setFormError('请输入有效单价');
      return;
    }

    setSubmitting(true);
    try {
      await api.post(`/stock-movements/${modalType}`, {
        warehouse_id: form.warehouse_id,
        item_id: form.item_id,
        quantity: qty,
        unit: form.unit,
        unit_price: price,
        reason: form.reason,
      });
      setModalType(null);
      fetchMovements(1);
    } catch (err: any) {
      setFormError(err.message || '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  // 翻页
  const goPrev = () => {
    if (page > 1) fetchMovements(page - 1);
  };
  const goNext = () => {
    if (page < totalPages) fetchMovements(page + 1);
  };

  // 类型展示
  const getTypeBadge = (type: string) => {
    if (type === 'inbound') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-success-100 text-success-700">
          <ArrowDownToLine size={12} />
          入库
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-danger-100 text-danger-700">
        <ArrowUpFromLine size={12} />
        出库
      </span>
    );
  };

  // 时间格式化
  const formatTime = (t: string) => {
    if (!t) return '-';
    const d = new Date(t);
    if (isNaN(d.getTime())) return t;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  return (
    <div className="space-y-6">
      {/* 页头 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-serif font-bold text-gray-800">出入库记录</h1>
          <p className="text-gray-500 mt-1">查询物资出入库流水，支持手动入库 / 出库</p>
        </div>
        {isManager && (
          <div className="flex gap-3">
            <button
              onClick={() => setBatchInboundOpen(true)}
              className="btn-primary flex items-center gap-2 bg-success-500 hover:bg-success-600"
            >
              <ClipboardList size={18} />
              <span>批量入库</span>
            </button>
            <button
              onClick={() => openModal('inbound')}
              className="btn-primary flex items-center gap-2 bg-success-500 hover:bg-success-600"
            >
              <ArrowDownToLine size={18} />
              <span>手动入库</span>
            </button>
            <button
              onClick={() => openModal('outbound')}
              className="btn-primary flex items-center gap-2 bg-danger-500 hover:bg-danger-600"
            >
              <ArrowUpFromLine size={18} />
              <span>手动出库</span>
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-danger-50 border border-danger-200 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle size={20} className="text-danger-500" />
          <span className="text-danger-700">{error}</span>
        </div>
      )}

      {/* 筛选栏 */}
      <div className="card">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          {/* 仓库下拉 */}
          <select
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            className="input-field md:w-48"
          >
            <option value="">全部仓库</option>
            {warehouses.map((w) => (
              <option key={w.warehouse_id} value={w.warehouse_id}>
                {w.warehouse_name}
              </option>
            ))}
          </select>

          {/* 类型下拉 */}
          <select
            value={movementType}
            onChange={(e) => setMovementType(e.target.value)}
            className="input-field md:w-40"
          >
            <option value="">全部类型</option>
            <option value="inbound">入库</option>
            <option value="outbound">出库</option>
          </select>

          {/* 日期范围 */}
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="input-field md:w-44"
            />
            <span className="text-gray-400">至</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="input-field md:w-44"
            />
          </div>

          {/* 查询按钮 */}
          <button
            onClick={() => fetchMovements(1)}
            className="btn-primary flex items-center gap-2 shrink-0"
          >
            <Search size={18} />
            <span>查询</span>
          </button>
        </div>
      </div>

      {/* 流水表格 */}
      <div className="card overflow-hidden p-0">
        {loading ? (
          <div className="text-center py-16 text-gray-500">加载中...</div>
        ) : movements.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <ArrowDownToLine size={48} className="text-gray-300 mb-3" />
            <p className="text-gray-400">暂无出入库记录</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>仓库</th>
                  <th>物资</th>
                  <th>类型</th>
                  <th className="text-right">数量</th>
                  <th>单位</th>
                  <th className="text-right">单价</th>
                  <th className="text-right">金额</th>
                  <th>操作人</th>
                  <th>原因</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td className="text-gray-600 whitespace-nowrap">{formatTime(m.created_at)}</td>
                    <td className="text-gray-700 whitespace-nowrap">{m.warehouse_name}</td>
                    <td className="font-medium text-gray-800 whitespace-nowrap">{m.item_name}</td>
                    <td>{getTypeBadge(m.movement_type)}</td>
                    <td className="text-right font-semibold whitespace-nowrap">{m.quantity}</td>
                    <td className="text-gray-500 whitespace-nowrap">{m.unit}</td>
                    <td className="text-right text-gray-700 whitespace-nowrap">{m.unit_price ? formatCurrency(m.unit_price) : '-'}</td>
                    <td className="text-right font-semibold text-gray-800 whitespace-nowrap">{m.total_amount ? formatCurrency(m.total_amount) : '-'}</td>
                    <td className="text-gray-600 whitespace-nowrap">{m.operator_name || '-'}</td>
                    <td className="text-gray-500 max-w-xs truncate" title={m.reason}>{m.reason || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 分页 */}
        {total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <span className="text-sm text-gray-500">
              共 {total} 条，第 {page} / {totalPages} 页
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={goPrev}
                disabled={page <= 1}
                className="p-1.5 border border-gray-200 rounded-md text-gray-500 hover:text-primary-600 hover:border-primary-300 hover:bg-primary-50 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-white"
                title="上一页"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                onClick={goNext}
                disabled={page >= totalPages}
                className="p-1.5 border border-gray-200 rounded-md text-gray-500 hover:text-primary-600 hover:border-primary-300 hover:bg-primary-50 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-white"
                title="下一页"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 入库 / 出库 弹窗 */}
      {modalType && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => !submitting && setModalType(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-md animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 弹窗头部 */}
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                {modalType === 'inbound' ? (
                  <ArrowDownToLine size={20} className="text-success-500" />
                ) : (
                  <ArrowUpFromLine size={20} className="text-danger-500" />
                )}
                {modalType === 'inbound' ? '手动入库' : '手动出库'}
              </h3>
              <button
                onClick={() => setModalType(null)}
                disabled={submitting}
                className="p-1 hover:bg-gray-100 rounded-md disabled:opacity-50"
              >
                <X size={20} className="text-gray-500" />
              </button>
            </div>

            {/* 弹窗表单 */}
            <div className="p-5 space-y-4">
              {/* 仓库 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">仓库</label>
                <select
                  value={form.warehouse_id}
                  onChange={(e) => handleWarehouseChange(e.target.value)}
                  className="input-field"
                >
                  <option value="">请选择仓库</option>
                  {warehouses.map((w) => (
                    <option key={w.warehouse_id} value={w.warehouse_id}>
                      {w.warehouse_name}
                    </option>
                  ))}
                </select>
              </div>

              {/* 物资 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">物资</label>
                <select
                  value={form.item_id}
                  onChange={(e) => handleMaterialChange(e.target.value)}
                  disabled={!form.warehouse_id}
                  className="input-field disabled:bg-gray-50 disabled:cursor-not-allowed"
                >
                  <option value="">
                    {form.warehouse_id ? '请选择物资' : '请先选择仓库'}
                  </option>
                  {materialOptions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.item_name}{m.sku ? ` (${m.sku})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* 数量 & 单位 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">数量</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={form.quantity}
                    onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                    placeholder="请输入数量"
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">单位</label>
                  <input
                    type="text"
                    value={form.unit}
                    onChange={(e) => setForm({ ...form, unit: e.target.value })}
                    placeholder="如：kg"
                    className="input-field"
                  />
                </div>
              </div>

              {/* 单价 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">单价</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={form.unit_price}
                  onChange={(e) => setForm({ ...form, unit_price: e.target.value })}
                  placeholder="请输入单价"
                  className="input-field"
                />
              </div>

              {/* 原因 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">原因</label>
                <textarea
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  placeholder="请输入出入库原因"
                  rows={3}
                  className="input-field resize-none"
                />
              </div>

              {formError && (
                <div className="flex items-center gap-2 text-danger-600 bg-danger-50 p-3 rounded-lg text-sm">
                  <AlertCircle size={16} />
                  <span>{formError}</span>
                </div>
              )}
            </div>

            {/* 弹窗底部操作 */}
            <div className="flex justify-end gap-3 p-5 border-t border-gray-100">
              <button
                onClick={() => setModalType(null)}
                disabled={submitting}
                className="btn-secondary disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className={`btn-primary flex items-center gap-2 disabled:opacity-50 ${
                  modalType === 'inbound' ? 'bg-success-500 hover:bg-success-600' : 'bg-danger-500 hover:bg-danger-600'
                }`}
              >
                {modalType === 'inbound' ? <ArrowDownToLine size={18} /> : <ArrowUpFromLine size={18} />}
                <span>{submitting ? '提交中...' : '确认'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 批量入库弹窗 */}
      <BatchInboundModal
        open={batchInboundOpen}
        onClose={() => setBatchInboundOpen(false)}
        onSuccess={() => fetchMovements(1)}
        warehouses={warehouses}
      />
    </div>
  );
}
