import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown, DollarSign, Package, BarChart3, Layers } from 'lucide-react';
import { format, subMonths, addMonths } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { getMonthlyAnalysis } from '@/data/monthlyData';
import { useIngredientStore } from '@/store/ingredientStore';
import { useCategoryStore } from '@/store/categoryStore';
import type { MonthlyAnalysis } from '@/types';
import { formatCurrency, formatPercent, getPriceChangeBgColor } from '@/utils/format';
import StatCard from '@/components/StatCard';

export default function MonthlyAnalysisPage() {
  const { ingredients } = useIngredientStore();
  const { categories } = useCategoryStore();
  const [currentMonth, setCurrentMonth] = useState<Date>(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });

  const yearMonth = format(currentMonth, 'yyyy-MM');
  const analysis: MonthlyAnalysis = useMemo(() => {
    return getMonthlyAnalysis(yearMonth, ingredients, categories);
  }, [yearMonth, ingredients, categories]);

  const handlePrevMonth = () => {
    setCurrentMonth(prev => subMonths(prev, 1));
  };

  const handleNextMonth = () => {
    const now = new Date();
    now.setDate(1);
    now.setHours(0, 0, 0, 0);
    const current = new Date(currentMonth);
    current.setHours(0, 0, 0, 0);
    if (current < now) {
      setCurrentMonth(prev => addMonths(prev, 1));
    }
  };

  const monthStr = format(currentMonth, 'yyyy年MM月', { locale: zhCN });

  const pieData = analysis.categoryBreakdown.map(c => ({
    name: c.categoryName,
    value: c.totalAmount,
    color: c.color,
  }));

  return (
    <div className="space-y-6">
      <div className="print-only text-center mb-6">
        <h1 className="text-xl font-serif font-bold">月度采购价格分析</h1>
        <p className="text-sm text-gray-600 mt-1">{monthStr}</p>
      </div>

      <div className="no-print flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-serif font-bold text-gray-800">月度价格分析</h1>
          <p className="text-gray-500 mt-1">月度采购数据汇总及环比分析</p>
        </div>
        <div className="flex items-center bg-white rounded-lg border border-gray-200 p-1">
          <button
            onClick={handlePrevMonth}
            className="p-2 hover:bg-gray-100 rounded-md transition-colors"
          >
            <ChevronLeft size={18} />
          </button>
          <div className="px-6 py-1.5 min-w-[140px] text-center font-medium">
            {monthStr}
          </div>
          <button
            onClick={handleNextMonth}
            className="p-2 hover:bg-gray-100 rounded-md transition-colors"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="月度采购总额"
          value={analysis.totalAmount}
          prefix="¥"
          changeRate={analysis.amountChangeRate}
          changeLabel="较上月"
          icon={<DollarSign size={24} />}
          iconBg="bg-primary-100"
        />
        <StatCard
          title="采购品类数"
          value={analysis.itemCount}
          suffix=" 种"
          icon={<Package size={24} />}
          iconBg="bg-accent-100"
          valueColor="text-accent-600"
        />
        <StatCard
          title="平均单价"
          value={analysis.avgPrice}
          prefix="¥"
          changeRate={analysis.priceChangeRate}
          changeLabel="环比"
          icon={<BarChart3 size={24} />}
          iconBg="bg-blue-100"
          valueColor="text-blue-600"
        />
        <StatCard
          title="上月总额"
          value={analysis.lastMonthTotalAmount}
          prefix="¥"
          icon={<Layers size={24} />}
          iconBg="bg-purple-100"
          valueColor="text-purple-600"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card lg:col-span-2">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">月度采购金额趋势</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={analysis.monthlyTrend} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#1a5c3a" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#1a5c3a" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="#9ca3af" />
                <YAxis tick={{ fontSize: 12 }} stroke="#9ca3af" tickFormatter={(v) => `¥${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  formatter={(value: number) => [formatCurrency(value), '采购金额']}
                  contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb' }}
                />
                <Area
                  type="monotone"
                  dataKey="totalAmount"
                  stroke="#1a5c3a"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorAmount)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">分类占比</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number) => [formatCurrency(value), '金额']}
                  contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb' }}
                />
                <Legend
                  layout="vertical"
                  verticalAlign="middle"
                  align="right"
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: '12px' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">分类明细</h2>
        <div className="overflow-x-auto -mx-6 px-6">
          <table className="data-table min-w-full">
            <thead>
              <tr>
                <th>分类</th>
                <th className="text-right">采购金额</th>
                <th className="text-right">金额占比</th>
                <th className="text-right">平均单价</th>
                <th className="text-right">上月均价</th>
                <th className="text-right">环比变动</th>
              </tr>
            </thead>
            <tbody>
              {analysis.categoryBreakdown.map(cat => (
                <tr key={cat.categoryId}>
                  <td>
                    <div className="flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: cat.color }}
                      />
                      <span className="font-medium">{cat.categoryName}</span>
                    </div>
                  </td>
                  <td className="text-right font-semibold">{formatCurrency(cat.totalAmount)}</td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-20 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${cat.amountPercentage}%`, backgroundColor: cat.color }}
                        />
                      </div>
                      <span className="text-sm text-gray-600 w-12 text-right">{cat.amountPercentage}%</span>
                    </div>
                  </td>
                  <td className="text-right">{formatCurrency(cat.avgPrice)}</td>
                  <td className="text-right text-gray-500">{formatCurrency(cat.lastMonthAvgPrice)}</td>
                  <td className="text-right">
                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium ${getPriceChangeBgColor(cat.priceChangeRate)}`}>
                      {cat.priceChangeRate >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                      {formatPercent(cat.priceChangeRate)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 bg-danger-100 rounded-lg flex items-center justify-center">
              <TrendingUp className="text-danger-500" size={18} />
            </div>
            <h2 className="text-lg font-semibold text-gray-800">价格涨幅榜 Top 5</h2>
          </div>
          <div className="space-y-3">
            {analysis.topGainers.map((item, idx) => (
              <div key={item.ingredientId} className="flex items-center justify-between p-3 bg-danger-50/50 rounded-lg">
                <div className="flex items-center gap-3">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                    idx === 0 ? 'bg-danger-500 text-white' :
                    idx === 1 ? 'bg-danger-400 text-white' :
                    idx === 2 ? 'bg-danger-300 text-white' :
                    'bg-danger-200 text-danger-700'
                  }`}>
                    {idx + 1}
                  </span>
                  <div>
                    <p className="font-medium text-gray-800 text-sm">{item.ingredientName}</p>
                    <p className="text-xs text-gray-500">{item.categoryName}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-gray-800">{formatCurrency(item.currentPrice)}/{item.baseUnit}</p>
                  <p className="text-xs text-danger-600 font-medium">+{formatPercent(item.changeRate)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 bg-success-100 rounded-lg flex items-center justify-center">
              <TrendingDown className="text-success-500" size={18} />
            </div>
            <h2 className="text-lg font-semibold text-gray-800">价格跌幅榜 Top 5</h2>
          </div>
          <div className="space-y-3">
            {analysis.topLosers.map((item, idx) => (
              <div key={item.ingredientId} className="flex items-center justify-between p-3 bg-success-50/50 rounded-lg">
                <div className="flex items-center gap-3">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                    idx === 0 ? 'bg-success-500 text-white' :
                    idx === 1 ? 'bg-success-400 text-white' :
                    idx === 2 ? 'bg-success-300 text-white' :
                    'bg-success-200 text-success-700'
                  }`}>
                    {idx + 1}
                  </span>
                  <div>
                    <p className="font-medium text-gray-800 text-sm">{item.ingredientName}</p>
                    <p className="text-xs text-gray-500">{item.categoryName}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-gray-800">{formatCurrency(item.currentPrice)}/{item.baseUnit}</p>
                  <p className="text-xs text-success-600 font-medium">{formatPercent(item.changeRate)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
