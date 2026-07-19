import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Search, TrendingUp, TrendingDown } from 'lucide-react';
import { useIngredientStore } from '@/store/ingredientStore';
import { useCategoryStore } from '@/store/categoryStore';
import { usePurchaseStore, type PurchaseEntryItem } from '@/store/purchaseStore';
import type { YearlyPriceData } from '@/types';
import { formatCurrency } from '@/utils/format';
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

  const monthlyPrices = past12Months.map(month => {
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

export default function MobileYearly() {
  const navigate = useNavigate();
  const { ingredients, fetchIngredients } = useIngredientStore();
  const { categories, fetchCategories } = useCategoryStore();
  const { fetchYearRecords } = usePurchaseStore();
  const [yearItems, setYearItems] = useState<PurchaseEntryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedIngredient, setSelectedIngredient] = useState<YearlyPriceData | null>(null);
  const [selectedYear, setSelectedYear] = useState<string>(() => new Date().getFullYear().toString());

  useEffect(() => {
    fetchIngredients();
    fetchCategories();
  }, [fetchIngredients, fetchCategories]);

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

  const filteredIngredients = useMemo(() => {
    return ingredients.filter(ing => {
      const matchSearch = ing.name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchCategory = !selectedCategory || ing.categoryId === selectedCategory;
      return matchSearch && matchCategory;
    });
  }, [ingredients, searchTerm, selectedCategory]);

  const yearlyDataList = useMemo(() => {
    return filteredIngredients
      .map(ing => buildYearlyPriceData(ing.id, ing.name, ing.categoryName || '', ing.baseUnit, yearItems))
      .filter((d): d is YearlyPriceData => d !== null);
  }, [filteredIngredients, yearItems]);

  const getChangeRate = (data: YearlyPriceData): number => {
    const valid = data.monthlyPrices.filter(m => m.avgPrice > 0);
    if (valid.length < 2) return 0;
    const first = valid[0].avgPrice;
    const last = valid[valid.length - 1].avgPrice;
    if (first === 0) return 0;
    return ((last - first) / first) * 100;
  };

  const validMonths = selectedIngredient
    ? selectedIngredient.monthlyPrices.filter(m => m.avgPrice > 0)
    : [];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-purple-500 to-purple-600 text-white px-4 pt-12 pb-6">
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => navigate('/m')}
            className="p-2 -ml-2 hover:bg-white/10 rounded-lg"
          >
            <ArrowLeft size={22} />
          </button>
          <h1 className="text-xl font-bold">年度均价</h1>
        </div>

        <div className="flex gap-2">
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(e.target.value)}
            className="flex-1 bg-white/10 border border-white/20 rounded-xl px-4 py-2.5 text-white outline-none"
          >
            {[2024, 2025, 2026].map(y => (
              <option key={y} value={y.toString()} className="text-gray-800">{y}年</option>
            ))}
          </select>
        </div>

        <p className="text-white/70 text-sm mt-3">
          共 {yearlyDataList.length} 种食材年度均价
        </p>
      </div>

      {selectedIngredient ? (
        <div className="px-4 -mt-2 pb-8">
          <div className="bg-white rounded-2xl shadow-sm p-4 mb-4">
            <button
              onClick={() => setSelectedIngredient(null)}
              className="text-purple-600 text-sm mb-3"
            >
              ← 返回列表
            </button>
            <h2 className="text-lg font-bold text-gray-800">{selectedIngredient.ingredientName}</h2>
            <p className="text-sm text-gray-500 mt-1">{selectedIngredient.categoryName} · {selectedIngredient.baseUnit}</p>
            
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="bg-purple-50 rounded-xl p-3">
                <p className="text-xs text-purple-600">年度均价</p>
                <p className="text-xl font-bold text-purple-700 mt-1">
                  {formatCurrency(selectedIngredient.yearlyAvg)}
                </p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-500">有数据月份</p>
                <p className="text-xl font-bold text-gray-700 mt-1">
                  {validMonths.length} 个月
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm p-4">
            <h3 className="font-medium text-gray-800 mb-3">月度价格走势</h3>
            <div className="space-y-2">
              {validMonths.map((m, idx) => {
                const prev = idx > 0 ? validMonths[idx - 1].avgPrice : m.avgPrice;
                const change = prev !== 0 ? ((m.avgPrice - prev) / prev) * 100 : 0;
                return (
                  <div key={m.month} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                    <span className="text-sm text-gray-600">{getMonthLabel(m.month)}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-800">{formatCurrency(m.avgPrice)}</span>
                      {idx > 0 && change !== 0 && (
                        <span className={`text-xs ${change > 0 ? 'text-red-500' : 'text-green-500'}`}>
                          {change > 0 ? '↑' : '↓'}{Math.abs(change).toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="px-4 -mt-2 pb-8">
          <div className="bg-white rounded-2xl shadow-sm p-3 mb-4">
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="搜索食材..."
                  className="w-full pl-10 pr-4 py-2.5 bg-gray-50 rounded-xl outline-none focus:ring-2 focus:ring-purple-500/20 text-sm"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
              <button
                onClick={() => setSelectedCategory(null)}
                className={`px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-colors ${
                  !selectedCategory
                    ? 'bg-purple-500 text-white'
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                全部
              </button>
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-colors ${
                    selectedCategory === cat.id
                      ? 'bg-purple-500 text-white'
                      : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
              <p className="mt-3 text-gray-500 text-sm">加载中...</p>
            </div>
          ) : yearlyDataList.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-6xl mb-4">📈</div>
              <p className="text-gray-500">暂无数据</p>
            </div>
          ) : (
            <div className="space-y-2">
              {yearlyDataList.map(data => {
                const rate = getChangeRate(data);
                return (
                  <button
                    key={data.ingredientId}
                    onClick={() => setSelectedIngredient(data)}
                    className="w-full bg-white rounded-2xl shadow-sm p-4 flex items-center justify-between text-left active:scale-[0.98] transition-transform"
                  >
                    <div>
                      <p className="font-medium text-gray-800">{data.ingredientName}</p>
                      <p className="text-xs text-gray-500 mt-1">{data.categoryName}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-gray-800">{formatCurrency(data.yearlyAvg)}</p>
                      {rate !== 0 && (
                        <p className={`text-xs mt-1 flex items-center justify-end gap-0.5 ${
                          rate > 0 ? 'text-red-500' : 'text-green-500'
                        }`}>
                          {rate > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                          {Math.abs(rate).toFixed(1)}%
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
