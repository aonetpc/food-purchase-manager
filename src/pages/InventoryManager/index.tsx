import { useState, useEffect } from 'react';
import { Search, RefreshCw, AlertTriangle, Package, Warehouse as WarehouseIcon, Boxes, ClipboardCheck, Calendar, TrendingUp } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { formatCurrency } from '@/utils/format';
import StockTakePanel from './StockTakePanel';

const MANAGER_ROLES = ['admin', 'finance', 'boss'];

// 仓库汇总信息
interface WarehouseSummary {
  warehouse_id: string;
  warehouse_name: string;
  item_count: number;
  total_value: number;
  low_stock_count: number;
}

// 库存明细
interface InventoryItem {
  id: string;
  warehouse_id: string;
  warehouse_name: string;
  item_name: string;
  sku: string;
  category_name: string;
  quantity: number;
  unit: string;
  min_stock: number;
  reference_price: number;
}

export default function InventoryManager() {
  const { user } = useAuthStore();
  const isManager = user ? MANAGER_ROLES.includes(user.role) : false;
  const [activeTab, setActiveTab] = useState<'inventory' | 'stock-take' | 'annual-take' | 'trend'>('inventory');
  const [summary, setSummary] = useState<WarehouseSummary[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [warehouseId, setWarehouseId] = useState<string>('');
  const [keyword, setKeyword] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);

  // 获取各仓库汇总
  const fetchSummary = async () => {
    try {
      const data = await api.get<WarehouseSummary[]>('/inventory/summary');
      setSummary(data || []);
    } catch (err: any) {
      console.error('获取汇总失败', err);
    }
  };

  // 获取库存明细列表
  const fetchItems = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.get<InventoryItem[]>('/inventory', {
        params: {
          warehouse_id: warehouseId || undefined,
          keyword: keyword || undefined,
          low_stock_only: lowStockOnly ? 'true' : undefined,
        },
      });
      setItems(data || []);
    } catch (err: any) {
      setError(err.message || '获取库存失败');
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  // 初始化加载
  useEffect(() => {
    fetchSummary();
    fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 仓库 / 预警筛选变化时重新拉取
  useEffect(() => {
    fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouseId, lowStockOnly]);

  // 全部仓库合计
  const totals = summary.reduce(
    (acc, w) => ({
      item_count: acc.item_count + w.item_count,
      total_value: acc.total_value + w.total_value,
      low_stock_count: acc.low_stock_count + w.low_stock_count,
    }),
    { item_count: 0, total_value: 0, low_stock_count: 0 }
  );

  // 判断是否低于最低库存
  const isLowStock = (item: InventoryItem) => item.quantity <= item.min_stock && item.min_stock > 0;

  // 关键词搜索：回车触发
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') fetchItems();
  };

  // 刷新全部
  const handleRefresh = () => {
    fetchSummary();
    fetchItems();
  };

  return (
    <div className="space-y-6">
      {/* 页头 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold text-gray-800">库存管理</h1>
          <p className="text-gray-500 mt-1">
            {isManager ? '查看各仓库物资库存及预警情况' : '查看本部门仓库及总仓物资库存'}
          </p>
        </div>
        <button onClick={handleRefresh} className="btn-secondary flex items-center gap-2">
          <RefreshCw size={18} />
          <span>刷新</span>
        </button>
      </div>

      {error && (
        <div className="bg-danger-50 border border-danger-200 rounded-lg p-4 flex items-center gap-3">
          <AlertTriangle size={20} className="text-danger-500" />
          <span className="text-danger-700">{error}</span>
        </div>
      )}

      {/* Tab 切换 */}
      <div className="flex gap-1 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('inventory')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'inventory'
              ? 'border-primary-600 text-primary-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Boxes size={16} />
          库存明细
        </button>
        {isManager && (
          <>
            <button
              onClick={() => setActiveTab('stock-take')}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'stock-take'
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <ClipboardCheck size={16} />
              月结盘点
            </button>
            <button
              onClick={() => setActiveTab('annual-take')}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'annual-take'
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Calendar size={16} />
              年度盘点
            </button>
            <button
              onClick={() => setActiveTab('trend')}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'trend'
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <TrendingUp size={16} />
              历史趋势
            </button>
          </>
        )}
      </div>

      {/* 盘点相关 Tab */}
      {isManager && (activeTab === 'stock-take' || activeTab === 'annual-take' || activeTab === 'trend') ? (
        <StockTakePanel currentTab={activeTab === 'stock-take' ? 'monthly' : activeTab === 'annual-take' ? 'annual' : 'trend'} />
      ) : (
      <>
      {/* 顶部汇总卡片：全部 + 各仓库 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {/* 全部仓库合计 */}
        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <p className="text-sm text-gray-500 font-medium">全部仓库合计</p>
              <p className="text-2xl font-bold mt-2 text-gray-800">{totals.item_count}</p>
              <p className="text-xs text-gray-400 mt-1">物资种类</p>
            </div>
            <div className="w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center text-primary-600">
              <Boxes size={22} />
            </div>
          </div>
          <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
            <div>
              <p className="text-xs text-gray-500">总价值</p>
              <p className="font-semibold text-gray-800">{formatCurrency(totals.total_value)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">预警数</p>
              <p className={`font-semibold ${totals.low_stock_count > 0 ? 'text-danger-600' : 'text-gray-800'}`}>
                {totals.low_stock_count}
              </p>
            </div>
          </div>
        </div>

        {/* 各仓库汇总 */}
        {summary.map((w) => (
          <div key={w.warehouse_id} className="stat-card">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <p className="text-sm text-gray-500 font-medium truncate">{w.warehouse_name}</p>
                <p className="text-2xl font-bold mt-2 text-gray-800">{w.item_count}</p>
                <p className="text-xs text-gray-400 mt-1">物资种类</p>
              </div>
              <div className="w-12 h-12 bg-primary-50 rounded-xl flex items-center justify-center text-primary-500">
                <WarehouseIcon size={22} />
              </div>
            </div>
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
              <div>
                <p className="text-xs text-gray-500">总价值</p>
                <p className="font-semibold text-gray-800">{formatCurrency(w.total_value)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500">预警数</p>
                <p className={`font-semibold flex items-center gap-1 justify-end ${w.low_stock_count > 0 ? 'text-danger-600' : 'text-gray-800'}`}>
                  {w.low_stock_count > 0 && <AlertTriangle size={14} />}
                  {w.low_stock_count}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 筛选栏 */}
      <div className="card">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          {/* 仓库下拉 */}
          <div className="flex items-center gap-2">
            <Package size={18} className="text-gray-400 shrink-0" />
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="input-field md:w-48"
            >
              <option value="">全部仓库</option>
              {summary.map((w) => (
                <option key={w.warehouse_id} value={w.warehouse_id}>
                  {w.warehouse_name}
                </option>
              ))}
            </select>
          </div>

          {/* 关键词搜索 */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="搜索物资名称 / SKU..."
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={handleKeyDown}
              className="input-field pl-10"
            />
          </div>

          {/* 仅看预警 */}
          <label className="flex items-center gap-2 cursor-pointer select-none px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
            <input
              type="checkbox"
              checked={lowStockOnly}
              onChange={(e) => setLowStockOnly(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-danger-500 focus:ring-danger-500"
            />
            <span className="text-sm text-gray-700 flex items-center gap-1">
              <AlertTriangle size={15} className="text-danger-500" />
              仅看预警
            </span>
          </label>

          {/* 搜索按钮 */}
          <button onClick={fetchItems} className="btn-primary flex items-center gap-2 shrink-0">
            <Search size={18} />
            <span>查询</span>
          </button>
        </div>
      </div>

      {/* 库存明细表格 */}
      <div className="card overflow-hidden p-0">
        {loading ? (
          <div className="text-center py-16 text-gray-500">加载中...</div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Package size={48} className="text-gray-300 mb-3" />
            <p className="text-gray-400">暂无库存数据</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>仓库</th>
                  <th>物资名称</th>
                  <th>SKU</th>
                  <th>分类</th>
                  <th className="text-right">当前库存</th>
                  <th>单位</th>
                  <th className="text-right">最低库存</th>
                  <th className="text-right">参考单价</th>
                  <th className="text-right">库存价值</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const low = isLowStock(item);
                  return (
                    <tr key={item.id} className={low ? 'bg-danger-50/60' : ''}>
                      <td className="text-gray-700 whitespace-nowrap">{item.warehouse_name}</td>
                      <td className="font-medium text-gray-800 whitespace-nowrap">{item.item_name}</td>
                      <td className="text-gray-500 font-mono text-xs whitespace-nowrap">{item.sku}</td>
                      <td className="text-gray-600 whitespace-nowrap">{item.category_name}</td>
                      <td className={`text-right font-semibold whitespace-nowrap ${low ? 'text-danger-600' : 'text-gray-800'}`}>
                        {item.quantity}
                      </td>
                      <td className="text-gray-500 whitespace-nowrap">{item.unit}</td>
                      <td className={`text-right whitespace-nowrap ${low ? 'text-danger-600 font-semibold' : 'text-gray-500'}`}>
                        {item.min_stock}
                      </td>
                      <td className="text-right text-gray-700 whitespace-nowrap">{formatCurrency(item.reference_price)}</td>
                      <td className="text-right font-semibold text-gray-800 whitespace-nowrap">{formatCurrency(item.quantity * item.reference_price)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </>
      )}
    </div>
  );
}
