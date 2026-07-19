import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, ArrowLeft } from 'lucide-react';
import { format, addDays, subDays } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { usePurchaseStore, type PurchaseEntryItem } from '@/store/purchaseStore';
import { useCategoryStore } from '@/store/categoryStore';
import { formatCurrency } from '@/utils/format';
import { formatDate } from '@/utils/date';

export default function MobileDaily() {
  const navigate = useNavigate();
  const { fetchRecords, getItems, fetchLastMonthAveragePrices, getComparePrice } = usePurchaseStore();
  const { categories, fetchCategories } = useCategoryStore();
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [items, setItems] = useState<PurchaseEntryItem[]>([]);
  const [loading, setLoading] = useState(false);

  const dateKey = formatDate(selectedDate);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      await Promise.all([
        fetchRecords(dateKey),
        fetchLastMonthAveragePrices(dateKey),
      ]);
      if (!cancelled) {
        setItems(getItems(dateKey));
        setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [dateKey, fetchRecords, getItems, fetchLastMonthAveragePrices]);

  const groupedByCategory = useMemo(() => {
    const groups: Record<string, PurchaseEntryItem[]> = {};
    items.forEach(item => {
      const cid = item.categoryId || 'other';
      if (!groups[cid]) groups[cid] = [];
      groups[cid].push(item);
    });
    return groups;
  }, [items]);

  const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);

  const prevDay = () => setSelectedDate(d => subDays(d, 1));
  const nextDay = () => setSelectedDate(d => addDays(d, 1));

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-green-500 to-green-600 text-white px-4 pt-12 pb-6">
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => navigate('/m')}
            className="p-2 -ml-2 hover:bg-white/10 rounded-lg"
          >
            <ArrowLeft size={22} />
          </button>
          <h1 className="text-xl font-bold">今日采购</h1>
        </div>

        <div className="flex items-center justify-between bg-white/10 rounded-xl px-4 py-3">
          <button onClick={prevDay} className="p-1">
            <ChevronLeft size={22} />
          </button>
          <div className="text-center">
            <p className="text-lg font-semibold">
              {format(selectedDate, 'M月d日', { locale: zhCN })}
            </p>
            <p className="text-xs text-white/70">
              {format(selectedDate, 'EEEE', { locale: zhCN })}
            </p>
          </div>
          <button onClick={nextDay} className="p-1">
            <ChevronRight size={22} />
          </button>
        </div>

        <div className="mt-4 text-center">
          <p className="text-white/70 text-sm">今日采购金额</p>
          <p className="text-3xl font-bold mt-1">{formatCurrency(totalAmount)}</p>
          <p className="text-white/70 text-xs mt-1">共 {items.length} 种食材</p>
        </div>
      </div>

      <div className="px-4 -mt-2 pb-8">
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
            <p className="mt-3 text-gray-500 text-sm">加载中...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-6xl mb-4">📋</div>
            <p className="text-gray-500">当日暂无采购数据</p>
          </div>
        ) : (
          <div className="space-y-4">
            {Object.entries(groupedByCategory).map(([catId, catItems]) => {
              const cat = categories.find(c => c.id === catId);
              const catTotal = catItems.reduce((s, i) => s + i.amount, 0);
              return (
                <div key={catId} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                  <div className="px-4 py-3 bg-gray-50 flex items-center justify-between">
                    <span className="font-medium text-gray-800">
                      {cat?.name || '其他'}
                    </span>
                    <span className="text-sm text-gray-500">
                      {catItems.length} 项 · {formatCurrency(catTotal)}
                    </span>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {catItems.map(item => {
                      const compare = getComparePrice(item);
                      const rate = compare
                        ? ((item.purchaseUnitPrice - compare.price) / compare.price * 100)
                        : 0;
                      return (
                        <div key={item.id} className="px-4 py-3">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <p className="font-medium text-gray-800 text-sm">
                                {item.ingredientName}
                              </p>
                              <p className="text-xs text-gray-500 mt-1">
                                {item.departmentName} · {item.purchaseQuantity}{item.purchaseUnit} × {formatCurrency(item.purchaseUnitPrice)}/{item.purchaseUnit}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="font-semibold text-gray-800">
                                {formatCurrency(item.amount)}
                              </p>
                              {compare && rate !== 0 && (
                                <p className={`text-xs mt-1 ${rate > 0 ? 'text-red-500' : 'text-green-500'}`}>
                                  {rate > 0 ? '↑' : '↓'} {Math.abs(rate).toFixed(1)}%
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
