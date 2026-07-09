import { useState, useMemo, useEffect } from 'react';
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown, DollarSign, Package, BarChart3, Layers, FileBarChart, Building2, Truck } from 'lucide-react';
import { format, subMonths, addMonths } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { useIngredientStore } from '@/store/ingredientStore';
import { useCategoryStore } from '@/store/categoryStore';
import { useDepartmentStore } from '@/store/departmentStore';
import { useSupplierStore } from '@/store/supplierStore';
import { usePurchaseStore, type PurchaseEntryItem } from '@/store/purchaseStore';
import type { MonthlyAnalysis, CategoryMonthlyData, PriceChangeItem, MonthlyTrendPoint } from '@/types';
import { formatCurrency, formatPercent, getPriceChangeBgColor } from '@/utils/format';
import { getPastMonths, getMonthLabel } from '@/utils/date';
import StatCard from '@/components/StatCard';

const buildMonthlyAnalysis = (
  yearMonth: string,
  monthItems: PurchaseEntryItem[],
  lastMonthItems: PurchaseEntryItem[],
  allItems: PurchaseEntryItem[],
  categories: { id: string; name: string; color: string }[]
): MonthlyAnalysis | null => {
  if (monthItems.length === 0) return null;

  const categoryMap: Record<string, { totalAmount: number; items: PurchaseEntryItem[] }> = {};
  monthItems.forEach(item => {
    const cid = item.categoryId || 'other';
    if (!categoryMap[cid]) categoryMap[cid] = { totalAmount: 0, items: [] };
    categoryMap[cid].totalAmount += item.amount;
    categoryMap[cid].items.push(item);
  });

  const lastMonthCategoryMap: Record<string, number> = {};
  lastMonthItems.forEach(item => {
    const cid = item.categoryId || 'other';
    lastMonthCategoryMap[cid] = (lastMonthCategoryMap[cid] || 0) + item.amount;
  });

  const categoryBreakdown: CategoryMonthlyData[] = categories.map(cat => {
    const data = categoryMap[cat.id];
    const totalAmount = data?.totalAmount || 0;
    const avgPrice = data?.items?.length
      ? data.items.reduce((s, i) => s + i.baseUnitPrice, 0) / data.items.length
      : 0;
    const lastMonthData = lastMonthCategoryMap[cat.id] || 0;
    const lastMonthAvgPrice = lastMonthItems.filter(i => i.categoryId === cat.id).length
      ? lastMonthItems.filter(i => i.categoryId === cat.id).reduce((s, i) => s + i.baseUnitPrice, 0) / lastMonthItems.filter(i => i.categoryId === cat.id).length
      : 0;
    const priceChangeRate = lastMonthAvgPrice > 0
      ? Math.round(((avgPrice - lastMonthAvgPrice) / lastMonthAvgPrice) * 1000) / 10
      : 0;

    return {
      categoryId: cat.id,
      categoryName: cat.name,
      color: cat.color,
      totalAmount: Math.round(totalAmount * 100) / 100,
      avgPrice: Math.round(avgPrice * 100) / 100,
      lastMonthAvgPrice: Math.round(lastMonthAvgPrice * 100) / 100,
      priceChangeRate,
      amountPercentage: 0,
    };
  }).filter(c => c.totalAmount > 0);

  const totalAmount = Math.round(monthItems.reduce((s, i) => s + i.amount, 0) * 100) / 100;
  categoryBreakdown.forEach(c => {
    c.amountPercentage = totalAmount > 0 ? Math.round((c.totalAmount / totalAmount) * 1000) / 10 : 0;
  });

  const lastMonthTotalAmount = Math.round(lastMonthItems.reduce((s, i) => s + i.amount, 0) * 100) / 100;
  const avgPrice = monthItems.length > 0
    ? Math.round(monthItems.reduce((s, i) => s + i.baseUnitPrice, 0) / monthItems.length * 100) / 100
    : 0;
  const lastMonthAvgPrice = lastMonthItems.length > 0
    ? Math.round(lastMonthItems.reduce((s, i) => s + i.baseUnitPrice, 0) / lastMonthItems.length * 100) / 100
    : 0;

  const past12Months = getPastMonths(12);
  const dateGrouped: Record<string, PurchaseEntryItem[]> = {};
  allItems.forEach(item => {
    const d = item.date || '';
    if (!d) return;
    const ym = d.substring(0, 7);
    if (!dateGrouped[ym]) dateGrouped[ym] = [];
    dateGrouped[ym].push(item);
  });

  const monthlyTrend: MonthlyTrendPoint[] = past12Months.map(m => {
    const items = dateGrouped[m] || [];
    return {
      month: getMonthLabel(m),
      totalAmount: Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100,
      avgPrice: items.length > 0
        ? Math.round(items.reduce((s, i) => s + i.baseUnitPrice, 0) / items.length * 100) / 100
        : 0,
    };
  });

  const ingredientMap: Record<string, { current: number[]; last: number[]; name: string; categoryName: string; baseUnit: string }> = {};
  monthItems.forEach(item => {
    if (!ingredientMap[item.ingredientId]) {
      ingredientMap[item.ingredientId] = {
        current: [],
        last: [],
        name: item.ingredientName,
        categoryName: item.categoryName,
        baseUnit: item.baseUnit,
      };
    }
    ingredientMap[item.ingredientId].current.push(item.baseUnitPrice);
  });
  lastMonthItems.forEach(item => {
    if (!ingredientMap[item.ingredientId]) {
      ingredientMap[item.ingredientId] = {
        current: [],
        last: [],
        name: item.ingredientName,
        categoryName: item.categoryName,
        baseUnit: item.baseUnit,
      };
    }
    ingredientMap[item.ingredientId].last.push(item.baseUnitPrice);
  });

  const priceChanges: { ingredientId: string; ingredientName: string; categoryName: string; baseUnit: string; currentPrice: number; lastPrice: number; changeRate: number }[] = [];
  Object.entries(ingredientMap).forEach(([id, data]) => {
    if (data.current.length === 0 || data.last.length === 0) return;
    const currentPrice = data.current.reduce((s, p) => s + p, 0) / data.current.length;
    const lastPrice = data.last.reduce((s, p) => s + p, 0) / data.last.length;
    const changeRate = lastPrice > 0 ? Math.round(((currentPrice - lastPrice) / lastPrice) * 1000) / 10 : 0;
    priceChanges.push({
      ingredientId: id,
      ingredientName: data.name,
      categoryName: data.categoryName,
      baseUnit: data.baseUnit,
      currentPrice: Math.round(currentPrice * 100) / 100,
      lastPrice: Math.round(lastPrice * 100) / 100,
      changeRate,
    });
  });

  const topGainers: PriceChangeItem[] = [...priceChanges]
    .filter(p => p.changeRate > 0)
    .sort((a, b) => b.changeRate - a.changeRate)
    .slice(0, 5);

  const topLosers: PriceChangeItem[] = [...priceChanges]
    .filter(p => p.changeRate < 0)
    .sort((a, b) => a.changeRate - b.changeRate)
    .slice(0, 5);

  const amountChangeRate = lastMonthTotalAmount > 0
    ? Math.round(((totalAmount - lastMonthTotalAmount) / lastMonthTotalAmount) * 1000) / 10
    : 0;
  const priceChangeRate = lastMonthAvgPrice > 0
    ? Math.round(((avgPrice - lastMonthAvgPrice) / lastMonthAvgPrice) * 1000) / 10
    : 0;

  return {
    yearMonth,
    totalAmount,
    itemCount: new Set(monthItems.map(i => i.ingredientId)).size,
    avgPrice,
    lastMonthTotalAmount,
    lastMonthAvgPrice,
    amountChangeRate,
    priceChangeRate,
    categoryBreakdown,
    topGainers,
    topLosers,
    monthlyTrend,
  };
};

export default function MonthlyAnalysisPage() {
  const { ingredients } = useIngredientStore();
  const { categories } = useCategoryStore();
  const { departments, fetchDepartments } = useDepartmentStore();
  const { fetchMonthRecords, fetchYearRecords } = usePurchaseStore();
  const [currentMonth, setCurrentMonth] = useState<Date>(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });
  const [monthItems, setMonthItems] = useState<PurchaseEntryItem[]>([]);
  const [lastMonthItems, setLastMonthItems] = useState<PurchaseEntryItem[]>([]);
  const [yearItems, setYearItems] = useState<PurchaseEntryItem[]>([]);
  const [loading, setLoading] = useState(false);

  const yearMonth = format(currentMonth, 'yyyy-MM');
  const lastYearMonth = format(subMonths(currentMonth, 1), 'yyyy-MM');
  const yearStr = format(currentMonth, 'yyyy');

  useEffect(() => {
    fetchDepartments();
    fetchSuppliers();
  }, [fetchDepartments, fetchSuppliers]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const [monthData, lastMonthData, yearData] = await Promise.all([
        fetchMonthRecords(yearMonth),
        fetchMonthRecords(lastYearMonth),
        fetchYearRecords(yearStr),
      ]);
      if (!cancelled) {
        setMonthItems(monthData);
        setLastMonthItems(lastMonthData);
        setYearItems(yearData);
        setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [yearMonth, lastYearMonth, yearStr, fetchMonthRecords, fetchYearRecords]);

  const analysis: MonthlyAnalysis | null = useMemo(() => {
    return buildMonthlyAnalysis(yearMonth, monthItems, lastMonthItems, yearItems, categories);
  }, [yearMonth, monthItems, lastMonthItems, yearItems, categories]);

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

  const pieData = analysis
    ? analysis.categoryBreakdown.map(c => ({ name: c.categoryName, value: c.totalAmount, color: c.color }))
    : [];

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

      {loading && (
        <div className="card flex items-center justify-center py-16">
          <p className="text-gray-500">加载中...</p>
        </div>
      )}

      {!loading && !analysis && (
        <div className="card flex flex-col items-center justify-center py-20">
          <FileBarChart size={64} className="text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-600 mb-2">暂无月度数据</h3>
          <p className="text-gray-400 text-sm">本月没有采购录入数据，请先在「采买清单录入」中录入数据</p>
        </div>
      )}

      {!loading && analysis && (
        <>
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

          {/* 部门采购拆分 */}
          {(() => {
            const deptMap: Record<string, { name: string; amount: number; count: number }> = {};
            monthItems.forEach(item => {
              const deptId = (item as any).departmentId || '';
              const deptName = (item as any).departmentName || '未分配';
              if (!deptMap[deptId]) deptMap[deptId] = { name: deptName, amount: 0, count: 0 };
              deptMap[deptId].amount += item.amount;
              deptMap[deptId].count += 1;
            });

            const totalAmount = monthItems.reduce((s, i) => s + i.amount, 0);
            const sortedDepts = departments
              .filter(d => deptMap[d.id])
              .map(d => ({ id: d.id, ...deptMap[d.id] }));

            if (sortedDepts.length <= 1) return null;

            return (
              <div className="card">
                <h2 className="text-lg font-semibold text-gray-800 mb-4">部门采购拆分</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {sortedDepts.map(dept => {
                    const pct = totalAmount > 0 ? Math.round((dept.amount / totalAmount) * 1000) / 10 : 0;
                    return (
                      <div key={dept.id} className="p-3 rounded-xl border border-gray-100 hover:border-gray-200 transition-all hover:shadow-sm">
                        <div className="flex items-center gap-2 mb-2">
                          <Building2 size={14} className="text-primary-500" />
                          <span className="text-sm font-medium text-gray-700">{dept.name}</span>
                        </div>
                        <p className="text-lg font-bold text-gray-800">{formatCurrency(dept.amount)}</p>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-xs text-gray-500">{dept.count} 项</span>
                          <span className="text-xs text-gray-500">{pct}%</span>
                        </div>
                        <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-primary-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* 供应商采购统计 */}
          {(() => {
            const supplierMap: Record<string, { name: string; amount: number; count: number; itemCount: number }> = {};
            monthItems.forEach(item => {
              const supplierId = (item as any).supplierId || '';
              const supplierName = (item as any).supplierName || '未指定';
              if (!supplierMap[supplierId]) {
                supplierMap[supplierId] = { name: supplierName, amount: 0, count: 0, itemCount: 0 };
              }
              supplierMap[supplierId].amount += item.amount;
              supplierMap[supplierId].count += 1;
              supplierMap[supplierId].itemCount += 1;
            });

            const totalAmount = monthItems.reduce((s, i) => s + i.amount, 0);
            const sortedSuppliers = Object.entries(supplierMap)
              .map(([id, data]) => ({ id, ...data }))
              .sort((a, b) => b.amount - a.amount);

            if (sortedSuppliers.length === 0) return null;

            return (
              <div className="card">
                <h2 className="text-lg font-semibold text-gray-800 mb-4">供应商采购统计</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {sortedSuppliers.map(supplier => {
                    const pct = totalAmount > 0 ? Math.round((supplier.amount / totalAmount) * 1000) / 10 : 0;
                    return (
                      <div key={supplier.id || 'none'} className="p-3 rounded-xl border border-gray-100 hover:border-gray-200 transition-all hover:shadow-sm">
                        <div className="flex items-center gap-2 mb-2">
                          <Truck size={14} className="text-blue-500" />
                          <span className="text-sm font-medium text-gray-700">{supplier.name}</span>
                        </div>
                        <p className="text-lg font-bold text-gray-800">{formatCurrency(supplier.amount)}</p>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-xs text-gray-500">{supplier.itemCount} 项</span>
                          <span className="text-xs text-gray-500">{pct}%</span>
                        </div>
                        <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

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
              {analysis.topGainers.length === 0 ? (
                <p className="text-gray-400 text-sm py-8 text-center">本月无上涨食材</p>
              ) : (
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
              )}
            </div>

            <div className="card">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 bg-success-100 rounded-lg flex items-center justify-center">
                  <TrendingDown className="text-success-500" size={18} />
                </div>
                <h2 className="text-lg font-semibold text-gray-800">价格跌幅榜 Top 5</h2>
              </div>
              {analysis.topLosers.length === 0 ? (
                <p className="text-gray-400 text-sm py-8 text-center">本月无下跌食材</p>
              ) : (
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
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
