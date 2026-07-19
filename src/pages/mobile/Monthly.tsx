import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, TrendingUp, TrendingDown, DollarSign, Package } from 'lucide-react';
import { format, subMonths, addMonths } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { usePurchaseStore, type PurchaseEntryItem } from '@/store/purchaseStore';
import { useCategoryStore } from '@/store/categoryStore';
import { formatCurrency, formatPercent } from '@/utils/format';
import { getPastMonths, getMonthLabel } from '@/utils/date';
import type { CategoryMonthlyData, PriceChangeItem, MonthlyTrendPoint } from '@/types';

const buildMonthlyAnalysis = (
  yearMonth: string,
  monthItems: PurchaseEntryItem[],
  lastMonthItems: PurchaseEntryItem[],
  allItems: PurchaseEntryItem[],
  categories: { id: string; name: string; color: string }[]
) => {
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

  const priceChanges: PriceChangeItem[] = [];
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

  const topGainers = [...priceChanges]
    .filter(p => p.changeRate > 0)
    .sort((a, b) => b.changeRate - a.changeRate)
    .slice(0, 5);

  const topLosers = [...priceChanges]
    .filter(p => p.changeRate < 0)
    .sort((a, b) => a.changeRate - b.changeRate)
    .slice(0, 5);

  return {
    totalAmount,
    lastMonthTotalAmount,
    avgPrice,
    lastMonthAvgPrice,
    itemCount: monthItems.length,
    categoryBreakdown,
    monthlyTrend,
    topGainers,
    topLosers,
  };
};

export default function MobileMonthly() {
  const navigate = useNavigate();
  const { fetchMonthRecords, fetchYearRecords } = usePurchaseStore();
  const { categories, fetchCategories } = useCategoryStore();
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [monthItems, setMonthItems] = useState<PurchaseEntryItem[]>([]);
  const [lastMonthItems, setLastMonthItems] = useState<PurchaseEntryItem[]>([]);
  const [yearItems, setYearItems] = useState<PurchaseEntryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'gainers' | 'losers'>('overview');

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const [current, last, year] = await Promise.all([
        fetchMonthRecords(selectedMonth),
        fetchMonthRecords(subMonths(new Date(selectedMonth + '-01'), 1).toISOString().substring(0, 7)),
        fetchYearRecords(selectedMonth.substring(0, 4)),
      ]);
      if (!cancelled) {
        setMonthItems(current);
        setLastMonthItems(last);
        setYearItems(year);
        setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [selectedMonth, fetchMonthRecords, fetchYearRecords]);

  const analysis = useMemo(() => {
    return buildMonthlyAnalysis(selectedMonth, monthItems, lastMonthItems, yearItems, categories);
  }, [selectedMonth, monthItems, lastMonthItems, yearItems, categories]);

  const prevMonth = () => {
    const d = subMonths(new Date(selectedMonth + '-01'), 1);
    setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const nextMonth = () => {
    const d = addMonths(new Date(selectedMonth + '-01'), 1);
    setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const monthAmountChange = analysis && analysis.lastMonthTotalAmount > 0
    ? ((analysis.totalAmount - analysis.lastMonthTotalAmount) / analysis.lastMonthTotalAmount) * 100
    : 0;

  const avgPriceChange = analysis && analysis.lastMonthAvgPrice > 0
    ? ((analysis.avgPrice - analysis.lastMonthAvgPrice) / analysis.lastMonthAvgPrice) * 100
    : 0;

  const validTrend = analysis?.monthlyTrend.filter(m => m.totalAmount > 0) || [];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-green-600 to-green-700 text-white px-4 pt-12 pb-6">
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => navigate('/m')}
            className="p-2 -ml-2 hover:bg-white/10 rounded-lg"
          >
            <ArrowLeft size={22} />
          </button>
          <h1 className="text-xl font-bold">月度分析</h1>
        </div>

        <div className="flex items-center justify-between bg-white/10 rounded-xl px-4 py-3">
          <button onClick={prevMonth} className="p-1">
            <ChevronLeft size={22} />
          </button>
          <div className="text-center">
            <p className="text-lg font-semibold">
              {format(new Date(selectedMonth + '-01'), 'yyyy年M月', { locale: zhCN })}
            </p>
          </div>
          <button onClick={nextMonth} className="p-1">
            <ChevronRight size={22} />
          </button>
        </div>
      </div>

      <div className="px-4 -mt-2 pb-8">
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
            <p className="mt-3 text-gray-500 text-sm">加载中...</p>
          </div>
        ) : !analysis ? (
          <div className="text-center py-16">
            <div className="text-6xl mb-4">📊</div>
            <p className="text-gray-500">当月暂无采购数据</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-white rounded-2xl shadow-sm p-4">
                <div className="flex items-center gap-2 text-gray-500 text-xs mb-2">
                  <DollarSign size={14} />
                  <span>采购总额</span>
                </div>
                <p className="text-xl font-bold text-gray-800">{formatCurrency(analysis.totalAmount)}</p>
                <p className={`text-xs mt-1 ${monthAmountChange >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                  {monthAmountChange >= 0 ? '↑' : '↓'} 较上月 {formatPercent(Math.abs(monthAmountChange))}
                </p>
              </div>
              <div className="bg-white rounded-2xl shadow-sm p-4">
                <div className="flex items-center gap-2 text-gray-500 text-xs mb-2">
                  <Package size={14} />
                  <span>平均单价</span>
                </div>
                <p className="text-xl font-bold text-gray-800">{formatCurrency(analysis.avgPrice)}</p>
                <p className={`text-xs mt-1 ${avgPriceChange >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                  {avgPriceChange >= 0 ? '↑' : '↓'} 较上月 {formatPercent(Math.abs(avgPriceChange))}
                </p>
              </div>
            </div>

            <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-4">
              <button
                onClick={() => setActiveTab('overview')}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === 'overview' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'
                }`}
              >
                分类概览
              </button>
              <button
                onClick={() => setActiveTab('gainers')}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === 'gainers' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'
                }`}
              >
                涨幅榜
              </button>
              <button
                onClick={() => setActiveTab('losers')}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === 'losers' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'
                }`}
              >
                降幅榜
              </button>
            </div>

            {activeTab === 'overview' && (
              <div className="space-y-3">
                <div className="bg-white rounded-2xl shadow-sm p-4">
                  <h3 className="font-medium text-gray-800 mb-3">分类占比</h3>
                  <div className="space-y-3">
                    {analysis.categoryBreakdown.map(cat => (
                      <div key={cat.categoryId}>
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span className="text-gray-700">{cat.categoryName}</span>
                          <span className="text-gray-500">
                            {formatCurrency(cat.totalAmount)} · {cat.amountPercentage}%
                          </span>
                        </div>
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${cat.amountPercentage}%`, backgroundColor: cat.color }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {validTrend.length > 0 && (
                  <div className="bg-white rounded-2xl shadow-sm p-4">
                    <h3 className="font-medium text-gray-800 mb-3">近12月走势</h3>
                    <div className="space-y-2">
                      {validTrend.map((m, idx) => (
                        <div key={idx} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                          <span className="text-sm text-gray-600">{m.month}</span>
                          <div className="text-right">
                            <p className="font-medium text-gray-800 text-sm">{formatCurrency(m.totalAmount)}</p>
                            <p className="text-xs text-gray-400">均价 {formatCurrency(m.avgPrice)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'gainers' && (
              <div className="bg-white rounded-2xl shadow-sm p-4">
                <h3 className="font-medium text-gray-800 mb-3 flex items-center gap-2">
                  <TrendingUp className="text-red-500" size={18} />
                  价格涨幅 TOP5
                </h3>
                {analysis.topGainers.length === 0 ? (
                  <p className="text-center text-gray-400 py-8 text-sm">暂无上涨食材</p>
                ) : (
                  <div className="space-y-2">
                    {analysis.topGainers.map((item, idx) => (
                      <div key={item.ingredientId} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                        <div className="flex items-center gap-3">
                          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                            idx === 0 ? 'bg-red-100 text-red-600' :
                            idx === 1 ? 'bg-orange-100 text-orange-600' :
                            idx === 2 ? 'bg-yellow-100 text-yellow-600' :
                            'bg-gray-100 text-gray-500'
                          }`}>
                            {idx + 1}
                          </span>
                          <div>
                            <p className="text-sm font-medium text-gray-800">{item.ingredientName}</p>
                            <p className="text-xs text-gray-400">{item.categoryName}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium text-red-500">+{formatPercent(item.changeRate)}</p>
                          <p className="text-xs text-gray-400">
                            {formatCurrency(item.lastPrice)} → {formatCurrency(item.currentPrice)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'losers' && (
              <div className="bg-white rounded-2xl shadow-sm p-4">
                <h3 className="font-medium text-gray-800 mb-3 flex items-center gap-2">
                  <TrendingDown className="text-green-500" size={18} />
                  价格降幅 TOP5
                </h3>
                {analysis.topLosers.length === 0 ? (
                  <p className="text-center text-gray-400 py-8 text-sm">暂无下降食材</p>
                ) : (
                  <div className="space-y-2">
                    {analysis.topLosers.map((item, idx) => (
                      <div key={item.ingredientId} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                        <div className="flex items-center gap-3">
                          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                            idx === 0 ? 'bg-green-100 text-green-600' :
                            idx === 1 ? 'bg-emerald-100 text-emerald-600' :
                            idx === 2 ? 'bg-teal-100 text-teal-600' :
                            'bg-gray-100 text-gray-500'
                          }`}>
                            {idx + 1}
                          </span>
                          <div>
                            <p className="text-sm font-medium text-gray-800">{item.ingredientName}</p>
                            <p className="text-xs text-gray-400">{item.categoryName}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium text-green-500">{formatPercent(item.changeRate)}</p>
                          <p className="text-xs text-gray-400">
                            {formatCurrency(item.lastPrice)} → {formatCurrency(item.currentPrice)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
