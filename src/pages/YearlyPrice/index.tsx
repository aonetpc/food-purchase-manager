import { useState, useMemo, useEffect } from 'react';
import { Search, TrendingUp, TrendingDown, Calendar, BarChart3, Minus, X } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useIngredientStore } from '@/store/ingredientStore';
import { useCategoryStore } from '@/store/categoryStore';
import { usePurchaseStore, type PurchaseEntryItem } from '@/store/purchaseStore';
import type { YearlyPriceData, MonthlyPrice } from '@/types';
import { formatCurrency, formatNumber, getPriceChangeColor } from '@/utils/format';
import { getPastMonths, getMonthLabel } from '@/utils/date';

const buildYearlyPriceData = (
  ingredientId: string,
  ingredientName: string,
  categoryName: string,
  baseUnit: string,
  items: PurchaseEntryItem[]
): YearlyPriceData | null => {
  const ingredientItems = items.filter(i => i.ingredientId === ingredientId);
  if (ingredientItems.length === 0) return null;

  const past12Months = getPastMonths(12);
  const byMonth: Record<string, number[]> = {};
  ingredientItems.forEach(item => {
    const d = item.date || '';
    if (!d) return;
    const ym = d.substring(0, 7);
    if (!byMonth[ym]) byMonth[ym] = [];
    byMonth[ym].push(item.baseUnitPrice);
  });

  const monthlyPrices: MonthlyPrice[] = past12Months.map(month => {
    const prices = byMonth[month] || [];
    const avgPrice = prices.length > 0
      ? Math.round(prices.reduce((s, p) => s + p, 0) / prices.length * 100) / 100
      : 0;
    const minPrice = prices.length > 0
      ? Math.round(Math.min(...prices) * 100) / 100
      : 0;
    const maxPrice = prices.length > 0
      ? Math.round(Math.max(...prices) * 100) / 100
      : 0;
    return { month, avgPrice, minPrice, maxPrice };
  });

  const validPrices = monthlyPrices.filter(m => m.avgPrice > 0);
  const yearlyAvg = validPrices.length > 0
    ? Math.round(validPrices.reduce((s, m) => s + m.avgPrice, 0) / validPrices.length * 100) / 100
    : 0;

  return {
    ingredientId,
    ingredientName,
    categoryName,
    baseUnit,
    yearlyAvg,
    monthlyPrices,
  };
};

export default function YearlyPrice() {
  const { ingredients } = useIngredientStore();
  const { categories } = useCategoryStore();
  const { fetchYearRecords } = usePurchaseStore();
  const [yearItems, setYearItems] = useState<PurchaseEntryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedIngredient, setSelectedIngredient] = useState<YearlyPriceData | null>(null);
  const [selectedYear, setSelectedYear] = useState<string>(() => new Date().getFullYear().toString());

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const data = await fetchYearRecords(selectedYear);
      if (!cancelled) {
        setYearItems(data);
        setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [selectedYear, fetchYearRecords]);

  const allData = useMemo(() => {
    const result: YearlyPriceData[] = [];
    ingredients.forEach(ing => {
      const cat = categories.find(c => c.id === ing.categoryId);
      const data = buildYearlyPriceData(
        ing.id,
        ing.name,
        cat?.name || '',
        ing.baseUnit,
        yearItems
      );
      if (data) result.push(data);
    });
    return result;
  }, [ingredients, categories, yearItems]);

  const filteredData = useMemo(() => {
    return allData.filter(item => {
      const matchSearch = item.ingredientName.toLowerCase().includes(searchTerm.toLowerCase());
      const matchCategory = !selectedCategory || categories.find(c => c.name === item.categoryName)?.id === selectedCategory;
      return matchSearch && matchCategory;
    });
  }, [allData, searchTerm, selectedCategory, categories]);

  const handleSelectIngredient = (item: YearlyPriceData) => {
    setSelectedIngredient(item);
  };

  const chartData = useMemo(() => {
    if (!selectedIngredient) return [];
    return selectedIngredient.monthlyPrices
      .filter(m => m.avgPrice > 0)
      .map(m => ({
        month: getMonthLabel(m.month),
        均价: m.avgPrice,
        最低: m.minPrice,
        最高: m.maxPrice,
      }));
  }, [selectedIngredient]);

  const twelveMonthChange = useMemo(() => {
    if (!selectedIngredient) return 0;
    const validPrices = selectedIngredient.monthlyPrices.filter(m => m.avgPrice > 0);
    if (validPrices.length < 2) return 0;
    const first = validPrices[0].avgPrice;
    const last = validPrices[validPrices.length - 1].avgPrice;
    return Math.round(((last - first) / first) * 1000) / 10;
  }, [selectedIngredient]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-serif font-bold text-gray-800">年度平均价查询</h1>
        <p className="text-gray-500 mt-1">查询食材各月的平均价格及趋势</p>
      </div>

      <div className="card">
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="搜索食材名称..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-11 pr-10 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 focus:bg-white transition-all"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 rounded-md hover:bg-gray-100"
                title="清除"
              >
                <X size={16} />
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedCategory(null)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                !selectedCategory
                  ? 'bg-primary-500 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              全部
            </button>
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(selectedCategory === cat.id ? null : cat.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 ${
                  selectedCategory === cat.id
                    ? 'bg-primary-500 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <span>{cat.icon}</span>
                <span>{cat.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && (
        <div className="card flex items-center justify-center py-16">
          <p className="text-gray-500">加载中...</p>
        </div>
      )}

      {!loading && allData.length === 0 && (
        <div className="card flex flex-col items-center justify-center py-20">
          <BarChart3 size={64} className="text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-600 mb-2">暂无年度价格数据</h3>
          <p className="text-gray-400 text-sm">本年度没有采购录入数据，无法统计价格趋势</p>
        </div>
      )}

      {!loading && allData.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="card lg:col-span-1 max-h-[600px] overflow-y-auto -mr-2 pr-2">
            <div className="flex items-center justify-between mb-4 sticky top-0 bg-white py-1 z-10">
              <h2 className="text-lg font-semibold text-gray-800">食材列表</h2>
              <span className="text-sm text-gray-500">{filteredData.length} 项</span>
            </div>
            <div className="space-y-2">
              {filteredData.map(item => (
                <div
                  key={item.ingredientId}
                  onClick={() => handleSelectIngredient(item)}
                  className={`p-3 rounded-xl cursor-pointer transition-all border ${
                    selectedIngredient?.ingredientId === item.ingredientId
                      ? 'bg-primary-50 border-primary-300'
                      : 'bg-white border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-800">{item.ingredientName}</p>
                      <p className="text-xs text-gray-500">{item.categoryName}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-gray-800">{formatCurrency(item.yearlyAvg)}</p>
                      <p className="text-xs text-gray-500">年均价/{item.baseUnit}</p>
                    </div>
                  </div>
                </div>
              ))}
              {filteredData.length === 0 && (
                <div className="text-center py-12 text-gray-400">
                  <Search size={40} className="mx-auto mb-3 opacity-50" />
                  <p>未找到匹配的食材</p>
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-2 space-y-6">
            {selectedIngredient ? (
              <>
                <div className="card">
                  <div className="flex items-start justify-between">
                    <div>
                      <h2 className="text-xl font-serif font-bold text-gray-800">
                        {selectedIngredient.ingredientName}
                      </h2>
                      <p className="text-gray-500 mt-1">{selectedIngredient.categoryName} · 基准单位: {selectedIngredient.baseUnit}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-3xl font-bold text-primary-600">{formatCurrency(selectedIngredient.yearlyAvg)}</p>
                      <p className="text-sm text-gray-500">年平均价</p>
                      <div className={`flex items-center justify-end gap-1 mt-1 ${getPriceChangeColor(twelveMonthChange)}`}>
                        {twelveMonthChange > 0 ? <TrendingUp size={16} /> : twelveMonthChange < 0 ? <TrendingDown size={16} /> : <Minus size={16} />}
                        <span className="text-sm font-medium">
                          {twelveMonthChange > 0 ? '+' : ''}{twelveMonthChange.toFixed(1)}%
                        </span>
                        <span className="text-xs text-gray-400">年度涨跌</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="card">
                  <div className="flex items-center gap-2 mb-4">
                    <BarChart3 className="text-primary-500" size={20} />
                    <h3 className="font-semibold text-gray-800">价格趋势图</h3>
                  </div>
                  {chartData.length === 0 ? (
                    <div className="h-64 flex items-center justify-center text-gray-400">
                      <p>暂无价格数据</p>
                    </div>
                  ) : (
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="#9ca3af" />
                          <YAxis tick={{ fontSize: 12 }} stroke="#9ca3af" tickFormatter={(v) => `¥${v}`} />
                          <Tooltip
                            formatter={(value: number) => [formatCurrency(value), '']}
                            contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb' }}
                          />
                          <Legend wrapperStyle={{ fontSize: '12px' }} />
                          <Line
                            type="monotone"
                            dataKey="均价"
                            stroke="#1a5c3a"
                            strokeWidth={2}
                            dot={{ r: 4, fill: '#1a5c3a' }}
                            activeDot={{ r: 6 }}
                          />
                          <Line
                            type="monotone"
                            dataKey="最高"
                            stroke="#f59e0b"
                            strokeWidth={1.5}
                            strokeDasharray="5 5"
                            dot={false}
                          />
                          <Line
                            type="monotone"
                            dataKey="最低"
                            stroke="#10b981"
                            strokeWidth={1.5}
                            strokeDasharray="5 5"
                            dot={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>

                <div className="card">
                  <div className="flex items-center gap-2 mb-4">
                    <Calendar className="text-primary-500" size={20} />
                    <h3 className="font-semibold text-gray-800">各月均价明细</h3>
                  </div>
                  <div className="overflow-x-auto -mx-6 px-6">
                    <table className="data-table min-w-full">
                      <thead>
                        <tr>
                          <th>月份</th>
                          {selectedIngredient.monthlyPrices.filter(m => m.avgPrice > 0).map(m => (
                            <th key={m.month} className="text-center whitespace-nowrap">
                              {getMonthLabel(m.month)}
                            </th>
                          ))}
                          <th className="text-center bg-primary-50">年度平均</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="font-medium">平均价</td>
                          {selectedIngredient.monthlyPrices.filter(m => m.avgPrice > 0).map(m => (
                            <td key={m.month} className="text-center">
                              {formatCurrency(m.avgPrice)}
                            </td>
                          ))}
                          <td className="text-center font-bold text-primary-600 bg-primary-50">
                            {formatCurrency(selectedIngredient.yearlyAvg)}
                          </td>
                        </tr>
                        <tr>
                          <td className="font-medium text-gray-500">最高价</td>
                          {selectedIngredient.monthlyPrices.filter(m => m.maxPrice > 0).map(m => (
                            <td key={m.month} className="text-center text-warning-600">
                              {formatCurrency(m.maxPrice)}
                            </td>
                          ))}
                          <td className="text-center text-gray-400 bg-primary-50">-</td>
                        </tr>
                        <tr>
                          <td className="font-medium text-gray-500">最低价</td>
                          {selectedIngredient.monthlyPrices.filter(m => m.minPrice > 0).map(m => (
                            <td key={m.month} className="text-center text-success-600">
                              {formatCurrency(m.minPrice)}
                            </td>
                          ))}
                          <td className="text-center text-gray-400 bg-primary-50">-</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <div className="card flex items-center justify-center h-96">
                <div className="text-center text-gray-400">
                  <BarChart3 size={48} className="mx-auto mb-3 opacity-50" />
                  <p className="text-lg">请选择食材查看价格趋势</p>
                  <p className="text-sm mt-1">从左侧列表中选择一种食材</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
