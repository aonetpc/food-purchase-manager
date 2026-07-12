import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, Clock, Package, ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { formatCurrency } from '@/utils/format';

interface Department {
  id: string;
  name: string;
  confirmed: boolean;
  confirmed_by?: string;
  confirmed_at?: string;
}

interface PurchaseItem {
  ingredient_name: string;
  purchase_unit: string;
  purchase_quantity: number;
  purchase_unit_price: number;
  amount: number;
  department_name: string;
}

interface Confirmation {
  id: string;
  purchase_date: string;
  total_amount: number;
  departments: Department[];
  purchase_items: PurchaseItem[];
  status: string;
}

export default function PurchaseConfirmPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Confirmation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [userName, setUserName] = useState('');

  useEffect(() => {
    if (id) fetchData(id);
  }, [id]);

  const fetchData = async (confirmId: string) => {
    setLoading(true);
    try {
      const result = await api.get<Confirmation>(`/purchase-confirmations/${confirmId}`);
      setData(result);
    } catch (err: any) {
      setError(err.message || '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async (deptId: string) => {
    if (!userName.trim()) {
      setError('请输入您的姓名');
      return;
    }
    setConfirming(true);
    setError('');
    try {
      await api.post(`/purchase-confirmations/${id}/confirm`, {
        department_id: deptId,
        confirmed_by: userName.trim(),
      });
      if (id) fetchData(id);
    } catch (err: any) {
      setError(err.message || '确认失败');
    } finally {
      setConfirming(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-red-500 mb-4">{error}</p>
          <button onClick={() => window.history.back()} className="text-primary-500">
            返回
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const allConfirmed = data.departments.every(d => d.confirmed);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr.substring(0, 10);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const groupedItems: Record<string, PurchaseItem[]> = {};
  for (const item of data.purchase_items) {
    const deptName = item.department_name || '未分类';
    if (!groupedItems[deptName]) groupedItems[deptName] = [];
    groupedItems[deptName].push(item);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 顶部标题 */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-md mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => window.history.back()} className="p-1">
            <ArrowLeft size={20} className="text-gray-600" />
          </button>
          <h1 className="text-lg font-semibold text-gray-800">采购确认单</h1>
        </div>
      </div>

      <div className="max-w-md mx-auto p-4 space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {/* 基本信息 */}
        <div className="bg-white rounded-xl shadow-sm p-4">
          <div className="flex justify-between items-start mb-3">
            <div>
              <p className="text-sm text-gray-500">采购日期</p>
              <p className="font-medium text-gray-800">{formatDate(data.purchase_date)}</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-500">总金额</p>
              <p className="font-bold text-primary-600 text-lg">{formatCurrency(parseFloat(data.total_amount))}</p>
            </div>
          </div>
          {allConfirmed && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2">
              <CheckCircle2 size={18} className="text-green-500" />
              <span className="text-sm text-green-700">全部部门已确认，正在自动发起报销...</span>
            </div>
          )}
        </div>

        {/* 确认人姓名输入 */}
        {!allConfirmed && (
          <div className="bg-white rounded-xl shadow-sm p-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">您的姓名</label>
            <input
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
              placeholder="请输入您的姓名"
            />
          </div>
        )}

        {/* 部门确认状态 */}
        <div className="bg-white rounded-xl shadow-sm p-4">
          <h2 className="font-medium text-gray-800 mb-3">部门确认</h2>
          <div className="space-y-2">
            {data.departments.map(dept => (
              <div key={dept.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2.5">
                <div className="flex items-center gap-2">
                  {dept.confirmed ? (
                    <CheckCircle2 size={18} className="text-green-500" />
                  ) : (
                    <Clock size={18} className="text-gray-400" />
                  )}
                  <span className="text-sm font-medium text-gray-700">{dept.name}</span>
                </div>
                <div className="text-right">
                  {dept.confirmed ? (
                    <div className="text-xs text-gray-500">
                      <p>{dept.confirmed_by}</p>
                      <p>{dept.confirmed_at}</p>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleConfirm(dept.id)}
                      disabled={confirming || !userName.trim()}
                      className="px-3 py-1.5 bg-primary-500 text-white text-xs rounded-lg hover:bg-primary-600 disabled:opacity-50 transition-colors"
                    >
                      {confirming ? '确认中...' : '确认采购入库'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 采购明细 */}
        <div className="bg-white rounded-xl shadow-sm p-4">
          <h2 className="font-medium text-gray-800 mb-3">采购明细</h2>
          <div className="space-y-4">
            {Object.entries(groupedItems).map(([deptName, items]) => (
              <div key={deptName}>
                <div className="flex items-center gap-2 mb-2">
                  <Package size={14} className="text-primary-500" />
                  <span className="text-sm font-medium text-gray-700">{deptName}</span>
                  <span className="text-xs text-gray-400">
                    小计：¥{items.reduce((s, i) => s + i.amount, 0).toFixed(2)}
                  </span>
                </div>
                <div className="space-y-1 pl-6">
                  {items.map((item, idx) => (
                    <div key={idx} className="flex justify-between text-sm">
                      <span className="text-gray-600">
                        {item.ingredient_name}
                        <span className="text-gray-400 ml-1">
                          {item.purchase_unit_price.toFixed(2)}/{item.purchase_unit} ×{item.purchase_quantity}{item.purchase_unit}
                        </span>
                      </span>
                      <span className="font-medium text-gray-800">¥{item.amount.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
