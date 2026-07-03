import { useState, useMemo, useEffect } from 'react';
import { Search, Info, Scale } from 'lucide-react';
import { useIngredientStore } from '@/store/ingredientStore';
import { useCategoryStore } from '@/store/categoryStore';
import { usePurchaseStore, type PurchaseEntryItem } from '@/store/purchaseStore';
import type { Ingredient, YearlyPriceData } from '@/types';
import { formatCurrency, formatPercent, getPriceChangeColor } from '@/utils/format';
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

export default function IngredientQuery() {
  const { ingredients } = useIngredientStore();
  const { categories } = useCategoryStore();
  const { fetchYearRecords } = usePurchaseStore();
  const [yearItems, setYearItems] = useState<PurchaseEntryItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedIngredient, setSelectedIngredient] = useState<Ingredient | null>(null);

  useEffect(() => {
    const load = async () => {
      const year = new Date().getFullYear().toString();
      const data = await fetchYearRecords(year);
      setYearItems(data);
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
    return Math.round(((last - first) / first) * 1000) / 10;
  };

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    ingredients.forEach(ing => {
      counts[ing.categoryId] = (counts[ing.categoryId] || 0) + 1;
    });
    return counts;
  }, [ingredients]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-serif font-bold text-gray-800">食材价格查询</h1>
        <p className="text-gray-500 mt-1">按分类浏览食材，查看价格详情和单位换算</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="lg:w-64 shrink-0">
          <div className="card p-4 space-y-1">
            <button
              onClick={() => setSelectedCategory(null)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg transition-all ${
                !selectedCategory
                  ? 'bg-primary-50 text-primary-600 font-medium'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <span className="flex items-center gap-2">
                <span>📋</span>
                <span>全部分类</span>
              </span>
              <span className="text-sm text-gray-400">{ingredients.length}</span>
            </button>
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(selectedCategory === cat.id ? null : cat.id)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg transition-all ${
                  selectedCategory === cat.id
                    ? 'bg-primary-50 text-primary-600 font-medium'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <span className="flex items-center gap-2">
                  <span>{cat.icon}</span>
                  <span>{cat.name}</span>
                </span>
                <span className="text-sm text-gray-400">{categoryCounts[cat.id] || 0}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 space-y-6">
          <div className="card">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
              <input
                type="text"
                placeholder="搜索食材名称..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="input-field pl-12"
              />
            </div>
          </div>

          {selectedIngredient ? (
            <div className="card">
              <div className="flex items-start justify-between mb-6">
                <div className="flex items-start gap-4">
                  <div className="w-20 h-20 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
                    <img
                      src={selectedIngredient.image}
                      alt={selectedIngredient.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div>
                    <h2 className="text-xl font-serif font-bold text-gray-800">
                      {selectedIngredient.name}
                    </h2>
                    <p className="text-gray-500 mt-1">
                      {categories.find(c => c.id === selectedIngredient.categoryId)?.name}
                    </p>
                    <div className="flex items-center gap-4 mt-3">
                      <div>
                        <p className="text-sm text-gray-500">基准单位</p>
                        <p className="font-semibold text-gray-800">{selectedIngredient.baseUnit}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500">基准价</p>
                        <p className="font-semibold text-primary-600">
                          {formatCurrency(selectedIngredient.basePrice)}
                        </p>
                      </div>
                      {getIngredientChange(selectedIngredient.id) !== null && (
                        <div>
                          <p className="text-sm text-gray-500">年度涨跌</p>
                          <p className={`font-semibold flex items-center gap-1 ${getPriceChangeColor(getIngredientChange(selectedIngredient.id)!)}`}>
                            {getIngredientChange(selectedIngredient.id)! >= 0 ? '↑' : '↓'}
                            {formatPercent(getIngredientChange(selectedIngredient.id)!)}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedIngredient(null)}
                  className="text-gray-400 hover:text-gray-600 p-1"
                >
                  ✕
                </button>
              </div>

              <div className="border-t border-gray-100 pt-6">
                <div className="flex items-center gap-2 mb-4">
                  <Scale className="text-primary-500" size={20} />
                  <h3 className="font-semibold text-gray-800">单位换算</h3>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {selectedIngredient.units.map(unit => (
                    <div
                      key={unit.unit}
                      className={`p-4 rounded-xl border transition-all ${
                        unit.unit === selectedIngredient.baseUnit
                          ? 'border-primary-300 bg-primary-50'
                          : 'border-gray-100 bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-gray-800">{unit.unit}</span>
                        {unit.isCommon && (
                          <span className="text-xs bg-primary-100 text-primary-600 px-2 py-0.5 rounded-full">
                            常用
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600">
                        1 {unit.unit} = {(1 / unit.factor).toFixed(2)} {selectedIngredient.baseUnit}
                      </p>
                      <p className="text-sm text-primary-600 font-medium mt-1">
                        ≈ {formatCurrency(selectedIngredient.basePrice * unit.factor)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {yearlyData && yearlyData.monthlyPrices.length > 0 && (
                <div className="border-t border-gray-100 pt-6 mt-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Info className="text-primary-500" size={20} />
                    <h3 className="font-semibold text-gray-800">近期价格走势</h3>
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                    {yearlyData.monthlyPrices.slice(-6).map(m => (
                      <div key={m.month} className="p-3 bg-gray-50 rounded-xl text-center">
                        <p className="text-xs text-gray-500">{getMonthLabel(m.month)}</p>
                        <p className="font-semibold text-gray-800 mt-1">{formatCurrency(m.avgPrice)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}

          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-800">
                {selectedCategory
                  ? categories.find(c => c.id === selectedCategory)?.name
                  : '全部食材'}
                <span className="text-gray-400 font-normal ml-2">({filteredIngredients.length})</span>
              </h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredIngredients.map(ing => {
                const change = getIngredientChange(ing.id);
                return (
                  <div
                    key={ing.id}
                    onClick={() => setSelectedIngredient(ing)}
                    className="card p-4 cursor-pointer hover:shadow-lg hover:-translate-y-0.5 transition-all"
                  >
                    <div className="w-full h-24 rounded-lg overflow-hidden bg-gray-100 mb-3">
                      <img
                        src={ing.image}
                        alt={ing.name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-medium text-gray-800">{ing.name}</h4>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {categories.find(c => c.id === ing.categoryId)?.name}
                        </p>
                      </div>
                      {change !== null && (
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            change >= 0 ? 'bg-danger-50 text-danger-600' : 'bg-success-50 text-success-600'
                          }`}
                        >
                          {formatPercent(change)}
                        </span>
                      )}
                    </div>
                    <div className="mt-3 pt-3 border-t border-gray-100 flex items-end justify-between">
                      <div>
                        <p className="text-xs text-gray-500">基准价</p>
                        <p className="text-lg font-bold text-primary-600">
                          {formatCurrency(ing.basePrice)}
                          <span className="text-xs font-normal text-gray-500 ml-1">/{ing.baseUnit}</span>
                        </p>
                      </div>
                      <p className="text-xs text-gray-400">
                        {ing.units.length} 种单位
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
            {filteredIngredients.length === 0 && (
              <div className="card flex items-center justify-center h-48">
                <div className="text-center text-gray-400">
                  <Search size={36} className="mx-auto mb-2 opacity-50" />
                  <p>未找到匹配的食材</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
