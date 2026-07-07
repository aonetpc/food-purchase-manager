import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Printer, TrendingUp, TrendingDown, Package, DollarSign, FileText, ClipboardList, Pencil, ClipboardCheck, Building2, X } from 'lucide-react';
import { format, addDays, subDays } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import type { DailyPurchaseRecord, CategorySummary } from '@/types';
import { formatCurrency, formatPercent, formatNumber, getPriceChangeColor, getPriceChangeBgColor } from '@/utils/format';
import { formatDate } from '@/utils/date';
import { usePurchaseStore, buildDailyRecordFromEntry, type PurchaseEntryItem } from '@/store/purchaseStore';
import { useIngredientStore } from '@/store/ingredientStore';
import { useCategoryStore } from '@/store/categoryStore';
import { useDepartmentStore } from '@/store/departmentStore';
import { useAuthStore } from '@/store/authStore';
import StatCard from '@/components/StatCard';
import PurchaseInvoicePrint from '@/components/PurchaseInvoicePrint';

const buildDailyRecord = (date: string, items: PurchaseEntryItem[], categories: { id: string; name: string; color: string }[]): DailyPurchaseRecord | null => {
  if (items.length === 0) return null;

  const categoryMap: Record<string, { amount: number; count: number; color: string }> = {};
  items.forEach(item => {
    const cid = item.categoryId || 'other';
    if (!categoryMap[cid]) {
      const cat = categories.find(c => c.id === cid);
      categoryMap[cid] = { amount: 0, count: 0, color: cat?.color || '#999' };
    }
    categoryMap[cid].amount += item.amount;
    categoryMap[cid].count += 1;
  });

  const totalAmount = items.reduce((s, i) => s + i.amount, 0);
  const categorySummary: CategorySummary[] = Object.entries(categoryMap).map(([cid, data]) => ({
    categoryId: cid,
    categoryName: categories.find(c => c.id === cid)?.name || '其他',
    color: data.color,
    amount: Math.round(data.amount * 100) / 100,
    itemCount: data.count,
    percentage: totalAmount > 0 ? Math.round((data.amount / totalAmount) * 1000) / 10 : 0,
  })).sort((a, b) => b.amount - a.amount);

  const record = buildDailyRecordFromEntry(date, items);
  record.categorySummary = categorySummary;
  return record;
};

export default function DailyPurchase() {
  const navigate = useNavigate();
  const { fetchRecords, getItems } = usePurchaseStore();
  const { ingredients } = useIngredientStore();
  const { categories } = useCategoryStore();
  const { departments, fetchDepartments } = useDepartmentStore();
  const { isAdmin } = useAuthStore();
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [items, setItems] = useState<PurchaseEntryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [showInvoicePrint, setShowInvoicePrint] = useState(false);
  const [printDepartmentName, setPrintDepartmentName] = useState('');
  const [printDepartmentItems, setPrintDepartmentItems] = useState<PurchaseEntryItem[]>([]);

  const dateKey = formatDate(selectedDate);

  useEffect(() => {
    fetchDepartments();
  }, [fetchDepartments]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      await fetchRecords(dateKey);
      if (!cancelled) {
        setItems(getItems(dateKey));
        setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [dateKey, fetchRecords, getItems]);

  const record: DailyPurchaseRecord | null = useMemo(() => {
    return buildDailyRecord(dateKey, items, categories);
  }, [dateKey, items, categories]);

  const amountChangeRate = 0;

  const handlePrevDay = () => {
    setSelectedDate(prev => subDays(prev, 1));
  };

  const handleNextDay = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (selectedDate < today) {
      setSelectedDate(prev => addDays(prev, 1));
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handlePrintInvoice = (deptName: string, deptItems: PurchaseEntryItem[]) => {
    setPrintDepartmentName(deptName);
    setPrintDepartmentItems(deptItems);
    setShowInvoicePrint(true);
  };

  const handlePrintAllInvoices = () => {
    const deptGroups: Record<string, { name: string; items: PurchaseEntryItem[] }> = {};
    record?.items.forEach(item => {
      const deptId = (item as any).departmentId || '';
      const deptName = (item as any).departmentName || '未分配';
      if (!deptGroups[deptId]) {
        deptGroups[deptId] = { name: deptName, items: [] };
      }
      deptGroups[deptId].items.push(item);
    });

    const allItems = Object.values(deptGroups).flatMap(g => g.items);
    setPrintDepartmentName('全部部门');
    setPrintDepartmentItems(allItems);
    setShowInvoicePrint(true);
  };

  const dateStr = format(selectedDate, 'yyyy年MM月dd日 EEEE', { locale: zhCN });
  const lastMonthDateStr = format(
    new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 1, selectedDate.getDate()),
    'MM月dd日',
    { locale: zhCN }
  );

  return (
    <div className="space-y-6">
      <div className="print-only text-center mb-6">
        <h1 className="text-xl font-serif font-bold">每日采购清单</h1>
        <p className="text-sm text-gray-600 mt-1">{dateStr}</p>
      </div>

      <div className="no-print flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-serif font-bold text-gray-800">每日采购清单</h1>
            {record && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-success-100 text-success-700">
                <ClipboardList size={12} />
                实际录入
              </span>
            )}
          </div>
          <p className="text-gray-500 mt-1">查看每日采购明细及与上月同期价格对比</p>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin() && (
            <button
              onClick={() => navigate(`/purchase-entry?date=${dateKey}`)}
              className="btn-secondary flex items-center gap-2"
            >
              {record ? <Pencil size={18} /> : <ClipboardList size={18} />}
              <span>{record ? '编辑录入' : '录入数据'}</span>
            </button>
          )}
          <div className="flex items-center bg-white rounded-lg border border-gray-200 p-1">
            <button
              onClick={handlePrevDay}
              className="p-2 hover:bg-gray-100 rounded-md transition-colors"
            >
              <ChevronLeft size={18} />
            </button>
            <div className="px-4 py-1.5 min-w-[180px] text-center font-medium">
              {dateStr}
            </div>
            <button
              onClick={handleNextDay}
              className="p-2 hover:bg-gray-100 rounded-md transition-colors"
            >
              <ChevronRight size={18} />
            </button>
          </div>
          {record && (
            <button onClick={handlePrint} className="btn-secondary flex items-center gap-2">
              <Printer size={18} />
              <span>打印清单</span>
            </button>
          )}
          {record && (
            <button onClick={handlePrintAllInvoices} className="btn-primary flex items-center gap-2">
              <FileText size={18} />
              <span>打印全部入库单</span>
            </button>
          )}
        </div>
      </div>

      {loading && (
        <div className="card flex items-center justify-center py-16">
          <p className="text-gray-500">加载中...</p>
        </div>
      )}

      {!loading && !record && (
        <div className="card flex flex-col items-center justify-center py-20">
          <ClipboardCheck size={64} className="text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-600 mb-2">当日暂无采购数据</h3>
          <p className="text-gray-400 text-sm mb-6">该日期还没有录入采购清单</p>
          {isAdmin() && (
            <button
              onClick={() => navigate(`/purchase-entry?date=${dateKey}`)}
              className="btn-primary flex items-center gap-2"
            >
              <ClipboardList size={18} />
              <span>去录入</span>
            </button>
          )}
        </div>
      )}

      {!loading && record && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title="采购总金额"
              value={record.totalAmount}
              prefix="¥"
              changeRate={amountChangeRate}
              changeLabel={`较上月${lastMonthDateStr}`}
              icon={<DollarSign size={24} />}
              iconBg="bg-primary-100"
            />
            <StatCard
              title="采购品类数"
              value={record.items.length}
              suffix=" 种"
              icon={<Package size={24} />}
              iconBg="bg-accent-100"
              valueColor="text-accent-600"
            />
            <StatCard
              title="分类数量"
              value={record.categorySummary.length}
              suffix=" 类"
              icon={<FileText size={24} />}
              iconBg="bg-blue-100"
              valueColor="text-blue-600"
            />
            <StatCard
              title="上月同期金额"
              value={0}
              prefix="¥"
              icon={<TrendingUp size={24} />}
              iconBg="bg-purple-100"
              valueColor="text-purple-600"
            />
          </div>

          <div className="card">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">分类汇总</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {record.categorySummary.map(cat => (
                <div
                  key={cat.categoryId}
                  className="p-3 rounded-xl border border-gray-100 hover:border-gray-200 transition-all hover:shadow-sm"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: cat.color }}
                    />
                    <span className="text-sm font-medium text-gray-700">{cat.categoryName}</span>
                  </div>
                  <p className="text-lg font-bold text-gray-800">{formatCurrency(cat.amount)}</p>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-gray-500">{cat.itemCount} 项</span>
                    <span className="text-xs text-gray-500">{cat.percentage}%</span>
                  </div>
                  <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${cat.percentage}%`, backgroundColor: cat.color }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-800">采购明细</h2>
              <span className="text-sm text-gray-500">共 {record.items.length} 项</span>
            </div>
            {(() => {
              const deptGroups: Record<string, { name: string; items: PurchaseEntryItem[] }> = {};
              record.items.forEach(item => {
                const deptId = (item as any).departmentId || '';
                const deptName = (item as any).departmentName || '未分配';
                if (!deptGroups[deptId]) {
                  deptGroups[deptId] = { name: deptName, items: [] };
                }
                deptGroups[deptId].items.push(item);
              });

              const sortedGroups = departments
                .filter(d => deptGroups[d.id])
                .map(d => ({ id: d.id, ...deptGroups[d.id] }));

              const noDept = deptGroups[''];
              if (noDept) {
                sortedGroups.push({ id: '', name: noDept.name, items: noDept.items });
              }

              return sortedGroups.map(group => {
                const groupTotal = group.items.reduce((s, i) => s + i.amount, 0);
                return (
                  <div key={group.id || 'none'} className="mb-6 last:mb-0">
                    <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-100">
                      <div className="flex items-center gap-2">
                        <Building2 size={16} className="text-primary-500" />
                        <span className="font-semibold text-gray-800">{group.name}</span>
                        <span className="text-xs text-gray-400">{group.items.length} 项</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => handlePrintInvoice(group.name, group.items)}
                          className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1"
                        >
                          <FileText size={14} />
                          <span>打印入库单</span>
                        </button>
                        <span className="font-semibold text-primary-600">{formatCurrency(groupTotal)}</span>
                      </div>
                    </div>
                    <div className="overflow-x-auto -mx-6 px-6">
                      <table className="data-table min-w-full">
                        <thead>
                          <tr>
                            <th className="whitespace-nowrap">食材名称</th>
                            <th className="whitespace-nowrap">分类</th>
                            <th className="whitespace-nowrap text-right">采购单位</th>
                            <th className="whitespace-nowrap text-right">数量</th>
                            <th className="whitespace-nowrap text-right">采购单价</th>
                            <th className="whitespace-nowrap text-right">金额</th>
                            <th className="whitespace-nowrap text-right">基准单价</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.items.map((item, idx) => (
                            <tr key={item.id}>
                              <td className="font-medium text-gray-800 whitespace-nowrap">{item.ingredientName}</td>
                              <td>
                                <span className="inline-flex items-center gap-1 text-xs text-gray-600">
                                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: record.categorySummary.find(c => c.categoryId === item.categoryId)?.color || '#999' }} />
                                  {item.categoryName}
                                </span>
                              </td>
                              <td className="text-right text-gray-600">{item.purchaseUnit}</td>
                              <td className="text-right font-medium">{formatNumber(item.purchaseQuantity, 1)}</td>
                              <td className="text-right text-gray-600">{formatCurrency(item.purchaseUnitPrice)}</td>
                              <td className="text-right font-semibold text-gray-800">{formatCurrency(item.amount)}</td>
                              <td className="text-right text-gray-700">{formatCurrency(item.baseUnitPrice)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="bg-gray-50 font-semibold">
                            <td colSpan={5} className="text-right text-gray-600">{group.name} 小计</td>
                            <td className="text-right text-primary-600">{formatCurrency(groupTotal)}</td>
                            <td></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                );
              });
            })()}
            <div className="border-t-2 border-primary-200 pt-3 mt-4">
              <div className="flex justify-end">
                <span className="text-gray-600 mr-4">总计</span>
                <span className="text-xl font-bold text-primary-600">{formatCurrency(record.totalAmount)}</span>
              </div>
            </div>
          </div>
        </>
      )}

      {showInvoicePrint && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-semibold">入库单打印预览</h2>
              <button onClick={() => setShowInvoicePrint(false)} className="p-2 hover:bg-gray-100 rounded-lg">
                <X size={20} />
              </button>
            </div>
            <div className="p-6">
              <PurchaseInvoicePrint
                date={dateKey}
                departmentName={printDepartmentName}
                items={printDepartmentItems as any}
                showPrintButton={true}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
