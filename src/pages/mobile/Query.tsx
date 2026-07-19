import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Search, TrendingUp, TrendingDown, Info } from 'lucide-react';
import { useIngredientStore } from '@/store/ingredientStore';
import { useCategoryStore } from '@/store/categoryStore';
import { usePurchaseStore, type PurchaseEntryItem } from '@/store/purchaseStore';
import type { Ingredient, YearlyPriceData } from '@/types';
import { formatCurrency, formatPercent } from '@/utils/format';
import { getPastMonths, getMonthLabel } from '@/utils/date';

const buildYearlyPriceData = (
  ingredientId: string,
  items: PurchaseEntryItem[]
): YearlyPriceData | null => {
  const ingredientItems = items.filter(i => i.ingredientId === ingredientId);
  if (ingredientItems.length === 0) return null;

  const past6Months = getPastMonths(6);
  const byMonth: Record<string, number[]> = {};
  ingredientItems.forEach(item => {
    const d = item.date || '';
    if (!d) return;
    const ym = d.substring(0, 7);
    if (!byMonth[ym]) byMonth[ym] = [];
    byMonth[ym].push(item.baseUnitPrice);
  });

  const monthlyPrices = past6Months.map(month => {
    const prices = byMonth[month] || [];
    const avgPrice = prices.length > 0
      ? Math.round(prices.reduce((s, p) => s + p, 0) / prices.length * 100) / 100
      : 0;
    return { month, avgPrice, minPrice: 0, maxPrice: 0 };
  }).filter(m => m.avgPrice > 0);

  const yearlyAvg = monthlyPrices.length > 0
    ? Math.round(monthlyPrices.reduce((s, m) => s + m.avgPrice, 0) / monthlyPrices.length * 100) / 100
    : 0;

  return {
    ingredientId,
    ingredientName: '',
    categoryName: '',
    baseUnit: '',
    yearlyAvg,
    monthlyPrices,
  };
};

export default function MobileQuery() {
  const navigate = useNavigate();
  const { ingredients, fetchIngredients } = useIngredientStore();
  const { categories, fetchCategories } = useCategoryStore();
  const { fetchYearRecords } = usePurchaseStore();
  const [yearItems, setYearItems] = useState<PurchaseEntryItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedIngredient, setSelectedIngredient] = useState<Ingredient | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchIngredients();
    fetchCategories();
  }, [fetchIngredients, fetchCategories]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const year = new Date().getFullYear().toString();
      const data = await fetchYearRecords(year);
      setYearItems(data);
      setLoading(false);
    };
    load();
  }, [fetchYearRecords]);

  const filteredIngredients = useMemo(() => {
    return ingredients.filter(ing => {
      const matchSearch = ing.name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchCategory = !selectedCategory || ing.categoryId === selectedCategory;
      return matchSearch && matchCategory;
    });
  }, [ingredients, searchTerm, selectedCategory]);

  const yearlyData: YearlyPriceData | null = useMemo(() => {
    if (!selectedIngredient) return null;
    return buildYearlyPriceData(selectedIngredient.id, yearItems);
  }, [selectedIngredient, yearItems]);

  const getIngredientChange = (ingredientId: string): number | null => {
    const data = buildYearlyPriceData(ingredientId, yearItems);
    if (!data || data.monthlyPrices.length < 2) return null;
    const first = data.monthlyPrices[0].avgPrice;
    const last = data.monthlyPrices[data.monthlyPrices.length - 1].avgPrice;
    if (first === 0) return null;
    return ((last - first) / first) * 100;
  };

  const validMonths = yearlyData?.monthlyPrices.filter(m => m.avgPrice > 0) || [];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-orange-500 to-orange-600 text-white px-4 pt-12 pb-6">
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => navigate('/m')}
            className="p-2 -ml-2 hover:bg-white/10 rounded-lg"
          >
            <ArrowLeft size={22} />
          </button>
          <h1 className="text-xl font-bold">食材查询</h1>
        </div>

        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-white/70" size={20} />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="搜索食材名称..."
            className="w-full pl-12 pr-4 py-3 bg-white/10 border border-white/20 rounded-2xl text-white placeholder-white/50 outline-none focus:bg-white/20 transition-colors"
          />
        </div>

        <p className="text-white/70 text-sm mt-3">
          共 {filteredIngredients.length} 种食材
        </p>
      </div>

      {selectedIngredient ? (
        <div className="px-4 -mt-2 pb-8">
          <div className="bg-white rounded-2xl shadow-sm p-4 mb-4">
            <button
              onClick={() => setSelectedIngredient(null)}
              className="text-orange-600 text-sm mb-3"
            >
              ← 返回列表
            </button>
            <h2 className="text-lg font-bold text-gray-800">{selectedIngredient.name}</h2>
            <p className="text-sm text-gray-500 mt-1">
              {categories.find(c => c.id === selectedIngredient.categoryId)?.name || '未分类'} · {selectedIngredient.baseUnit}
            </p>
            
            {yearlyData && (
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="bg-orange-50 rounded-xl p-3">
                  <p className="text-xs text-orange-600">近6月均价</p>
                  <p className="text-xl font-bold text-orange-700 mt-1">
                    {formatCurrency(yearlyData.yearlyAvg)}
                  </p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-xs text-gray-500">有数据月份</p>
                  <p className="text-xl font-bold text-gray-700 mt-1">
                    {validMonths.length} 个月
                  </p>
                </div>
              </div>
            )}
          </div>

          {yearlyData && validMonths.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm p-4">
              <h3 className="font-medium text-gray-800 mb-3">近6月价格走势</h3>
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
          )}

          {(!yearlyData || validMonths.length === 0) && (
            <div className="bg-white rounded-2xl shadow-sm p-8 text-center">
              <div className="text-4xl mb-3">📊</div>
              <p className="text-gray-500 text-sm">暂无价格数据</p>
            </div>
          )}
        </div>
      ) : (
        <div className="px-4 -mt-2 pb-8">
          <div className="bg-white rounded-2xl shadow-sm p-3 mb-4">
            <div className="flex gap-2 overflow-x-auto pb-1">
              <button
                onClick={() => setSelectedCategory(null)}
                className={`px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-colors ${
                  !selectedCategory
                    ? 'bg-orange-500 text-white'
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
                      ? 'bg-orange-500 text-white'
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
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600"></div>
              <p className="mt-3 text-gray-500 text-sm">加载中...</p>
            </div>
          ) : filteredIngredients.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-6xl mb-4">🔍</div>
              <p className="text-gray-500">未找到相关食材</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredIngredients.map(ing => {
                const change = getIngredientChange(ing.id);
                return (
                  <button
                    key={ing.id}
                    onClick={() => setSelectedIngredient(ing)}
                    className="w-full bg-white rounded-2xl shadow-sm p-4 flex items-center justify-between text-left active:scale-[0.98] transition-transform"
                  >
                    <div>
                      <p className="font-medium text-gray-800">{ing.name}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        {categories.find(c => c.id === ing.categoryId)?.name || '未分类'} · {ing.baseUnit}
                      </p>
                    </div>
                    {change !== null && (
                      <div className={`flex items-center gap-1 text-sm font-medium ${
                        change > 0 ? 'text-red-500' : change < 0 ? 'text-green-500' : 'text-gray-400'
                      }`}>
                        {change > 0 ? <TrendingUp size={16} /> : change < 0 ? <TrendingDown size={16} /> : null}
                        <span>{change > 0 ? '+' : ''}{formatPercent(change)}</span>
                      </div>
                    )}
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
