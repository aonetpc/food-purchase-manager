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
  const [printData, setPrintData] = useState<{ type: 'single'; name: string; items: PurchaseEntryItem[] } | { type: 'multiple'; departments: { name: string; items: PurchaseEntryItem[] }[] } | null>(null);
  const [printOffset, setPrintOffset] = useState(() => {
    const saved = localStorage.getItem('printOffset');
    return saved ? JSON.parse(saved) : { top: 0, left: 0, bottom: 0, right: 0 };
  });

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
    setPrintData({ type: 'single', name: deptName, items: deptItems });
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

    const sortedGroups = departments
      .filter(d => deptGroups[d.id])
      .map(d => ({ name: d.name, items: deptGroups[d.id].items }));

    const noDept = deptGroups[''];
    if (noDept) {
      sortedGroups.push({ name: noDept.name, items: noDept.items });
    }

    setPrintData({ type: 'multiple', departments: sortedGroups });
    setShowInvoicePrint(true);
  };

  const handleDoPrint = () => {
    const printContent = document.querySelector('.invoice-print-area') as HTMLElement;
    if (!printContent) return;

    // 去掉组件自带的 <style> 标签，避免冲突
    let cleanHTML = printContent.innerHTML.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

    // 创建临时打印容器
    const printContainer = document.createElement('div');
    printContainer.id = 'temp-print-container';
    printContainer.innerHTML = cleanHTML;
    document.body.appendChild(printContainer);

    // 添加打印样式到主文档（确保 @page size 生效）
    const styleEl = document.createElement('style');
    styleEl.id = 'temp-print-style';
    styleEl.textContent = `
      @page {
        size: 241mm 140mm !important;
        margin: 0 !important;
      }

      body.printing-invoice-mode > *:not(#temp-print-container) {
        display: none !important;
      }

      body.printing-invoice-mode {
        margin: 0 !important;
        padding: 0 !important;
        background: white !important;
      }

      #temp-print-container {
        display: block !important;
      }

      #temp-print-container .print-invoice-container {
        width: 241mm !important;
        font-family: 'SimSun', '宋体', serif !important;
        margin: 0 !important;
        padding: 0 !important;
      }

      #temp-print-container .print-page {
        width: 241mm !important;
        height: ${130 - printOffset.bottom}mm !important;
        padding-top: ${3 + printOffset.top}mm !important;
        padding-bottom: ${3 + printOffset.bottom}mm !important;
        padding-left: ${15 + printOffset.left}mm !important;
        padding-right: ${15 - printOffset.right}mm !important;
        box-sizing: border-box !important;
        overflow: hidden !important;
        position: relative !important;
        margin: 0 !important;
        border: none !important;
      }

      #temp-print-container .print-page + .print-page {
        page-break-before: always !important;
      }

      #temp-print-container .invoice-header {
        text-align: center !important;
        margin-bottom: 3mm !important;
      }

      #temp-print-container .invoice-title {
        font-size: 16px !important;
        font-weight: bold !important;
        margin: 0 0 2mm 0 !important;
        color: #333 !important;
      }

      #temp-print-container .invoice-info {
        display: flex !important;
        justify-content: space-between !important;
        margin-bottom: 1mm !important;
        font-size: 10px !important;
      }

      #temp-print-container .invoice-info .label {
        color: #666 !important;
      }

      #temp-print-container .invoice-info .value {
        color: #333 !important;
        margin-left: 2mm !important;
      }

      #temp-print-container .invoice-table {
        width: 210mm !important;
        border-collapse: collapse !important;
        font-size: 10px !important;
        margin-bottom: 2mm !important;
        table-layout: fixed !important;
        margin-left: auto !important;
        margin-right: auto !important;
      }

      #temp-print-container .invoice-table th,
      #temp-print-container .invoice-table td {
        border: 1px solid #999 !important;
        padding: 0.8mm 1.5mm !important;
        text-align: center !important;
        vertical-align: middle !important;
        height: 4.5mm !important;
        line-height: 1.2 !important;
      }

      #temp-print-container .invoice-table th {
        background-color: #f5f5f5 !important;
        font-weight: bold !important;
      }

      #temp-print-container .invoice-table td:first-child { width: 8% !important; }
      #temp-print-container .invoice-table td:nth-child(2) { width: 30% !important; text-align: left !important; }
      #temp-print-container .invoice-table td:nth-child(3) { width: 14% !important; text-align: left !important; }
      #temp-print-container .invoice-table td:nth-child(4) { width: 10% !important; }
      #temp-print-container .invoice-table td:nth-child(5) { width: 16% !important; }
      #temp-print-container .invoice-table td:nth-child(6) { width: 22% !important; }

      #temp-print-container .empty-row td {
        border-top: 1px solid #999 !important;
        border-bottom: 1px solid #999 !important;
      }

      #temp-print-container .invoice-total {
        width: 210mm !important;
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        margin-bottom: 2mm !important;
        font-size: 11px !important;
        margin-left: auto !important;
        margin-right: auto !important;
      }

      #temp-print-container .invoice-total .label { color: #666 !important; }
      #temp-print-container .invoice-total .value {
        font-weight: bold !important;
        color: #333 !important;
        margin: 0 2mm !important;
      }

      #temp-print-container .invoice-uppercase {
        width: 210mm !important;
        margin-bottom: 3mm !important;
        font-size: 11px !important;
        margin-left: auto !important;
        margin-right: auto !important;
      }

      #temp-print-container .invoice-uppercase .label { color: #666 !important; }
      #temp-print-container .invoice-uppercase .value {
        font-weight: bold !important;
        color: #333 !important;
        margin-left: 2mm !important;
      }

      #temp-print-container .invoice-signature {
        width: 210mm !important;
        display: flex !important;
        justify-content: space-between !important;
        margin-bottom: 2mm !important;
        font-size: 10px !important;
        margin-left: auto !important;
        margin-right: auto !important;
      }

      #temp-print-container .signature-item {
        flex: 1 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
      }

      #temp-print-container .signature-item .label {
        color: #666 !important;
        white-space: nowrap !important;
      }

      #temp-print-container .signature-item .line {
        flex: 1 !important;
        border-bottom: 1px solid #333 !important;
        margin-left: 3mm !important;
        max-width: 35mm !important;
      }

      #temp-print-container .invoice-page {
        width: 210mm !important;
        text-align: center !important;
        font-size: 10px !important;
        color: #666 !important;
        margin-top: 2mm !important;
        margin-left: auto !important;
        margin-right: auto !important;
      }
    `;
    document.head.appendChild(styleEl);

    // 临时禁用其他所有 style 和 link[rel="stylesheet"] 标签，避免冲突
    const allStyles = document.querySelectorAll('style:not(#temp-print-style), link[rel="stylesheet"]');
    const disabledStyles: (HTMLStyleElement | HTMLLinkElement)[] = [];
    allStyles.forEach((s) => {
      const el = s as HTMLStyleElement | HTMLLinkElement;
      disabledStyles.push(el);
      el.disabled = true;
    });
    // 重新启用我们的打印样式
    styleEl.disabled = false;

    // 触发打印
    document.body.classList.add('printing-invoice-mode');
    setTimeout(() => {
      window.print();
      // 清理
      setTimeout(() => {
        document.body.classList.remove('printing-invoice-mode');
        document.body.removeChild(printContainer);
        document.head.removeChild(styleEl);
        // 恢复被禁用的 style 和 link 标签
        disabledStyles.forEach((el) => {
          el.disabled = false;
        });
      }, 100);
    }, 200);
  };

  const dateStr = format(selectedDate, 'yyyy年MM月dd日 EEEE', { locale: zhCN });
  const lastMonthDateStr = format(
    new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 1, selectedDate.getDate()),
    'MM月dd日',
    { locale: zhCN }
  );

  return (
    <div className="space-y-6">
      <div className="page-content">
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
      </div>

      {showInvoicePrint && (
        <div className="invoice-modal fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="invoice-modal-content bg-white rounded-lg shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col">
            <div className="no-print flex items-center justify-between p-4 border-b shrink-0">
              <h2 className="text-lg font-semibold">入库单打印预览</h2>
              <button onClick={() => setShowInvoicePrint(false)} className="p-2 hover:bg-gray-100 rounded-lg">
                <X size={20} />
              </button>
            </div>
            <div className="no-print px-4 py-2 border-b bg-gray-50 shrink-0">
              <div className="flex items-center gap-2 text-sm text-gray-600 flex-wrap">
                <span className="whitespace-nowrap font-medium">打印偏移(mm):</span>
                <div className="flex items-center gap-1">
                  <span className="whitespace-nowrap text-xs">上</span>
                  <input
                    type="number"
                    value={printOffset.top}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      const newOffset = { ...printOffset, top: val };
                      setPrintOffset(newOffset);
                      localStorage.setItem('printOffset', JSON.stringify(newOffset));
                    }}
                    className="w-14 px-1 py-0.5 border rounded text-center text-xs"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="whitespace-nowrap text-xs">下</span>
                  <input
                    type="number"
                    value={printOffset.bottom}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      const newOffset = { ...printOffset, bottom: val };
                      setPrintOffset(newOffset);
                      localStorage.setItem('printOffset', JSON.stringify(newOffset));
                    }}
                    className="w-14 px-1 py-0.5 border rounded text-center text-xs"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="whitespace-nowrap text-xs">左</span>
                  <input
                    type="number"
                    value={printOffset.left}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      const newOffset = { ...printOffset, left: val };
                      setPrintOffset(newOffset);
                      localStorage.setItem('printOffset', JSON.stringify(newOffset));
                    }}
                    className="w-14 px-1 py-0.5 border rounded text-center text-xs"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="whitespace-nowrap text-xs">右</span>
                  <input
                    type="number"
                    value={printOffset.right}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      const newOffset = { ...printOffset, right: val };
                      setPrintOffset(newOffset);
                      localStorage.setItem('printOffset', JSON.stringify(newOffset));
                    }}
                    className="w-14 px-1 py-0.5 border rounded text-center text-xs"
                  />
                </div>
                <span className="text-xs text-gray-400 ml-1">正值增大边距，负值减小边距</span>
              </div>
            </div>
            <div className="invoice-print-area p-6 overflow-y-auto flex-1">
              {printData?.type === 'single' ? (
                <PurchaseInvoicePrint
                  date={dateKey}
                  departmentName={printData.name}
                  items={printData.items as any}
                  showPrintButton={false}
                />
              ) : printData?.type === 'multiple' ? (
                <PurchaseInvoicePrint
                  date={dateKey}
                  departments={printData.departments as any}
                  showPrintButton={false}
                />
              ) : null}
            </div>
            <div className="no-print p-4 border-t flex justify-center gap-3 shrink-0">
              <button onClick={handleDoPrint} className="btn-primary flex items-center gap-2">
                <Printer size={18} />
                <span>打印入库单</span>
              </button>
              <button onClick={() => setShowInvoicePrint(false)} className="btn-secondary">
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @media print {
          body.printing-invoice .page-content {
            display: none !important;
          }
          body.printing-invoice .invoice-modal {
            position: static !important;
            background: none !important;
            padding: 0 !important;
            display: block !important;
          }
          body.printing-invoice .invoice-modal-content {
            max-width: none !important;
            max-height: none !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            overflow: visible !important;
            width: auto !important;
            background: none !important;
            border: none !important;
          }
          body.printing-invoice .invoice-print-area {
            padding: 0 !important;
          }
          body.printing-invoice .no-print {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}
