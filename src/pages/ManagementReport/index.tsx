import { Fragment, useState, useEffect, useMemo, useCallback } from 'react';
import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, FileDown, X, AlertCircle, ClipboardCheck, Search, Filter } from 'lucide-react';
import { format, subMonths, addMonths } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { api } from '@/lib/api';
import { formatCurrency } from '@/utils/format';
import { useDepartmentStore } from '@/store/departmentStore';

// 仓库分类树节点（最多 2 级）
interface CategoryNode {
  id: string;
  name: string;
  parent_id?: string | null;
  level: number;
  sort_order?: number;
  children?: CategoryNode[];
}

type TabKey = 'fixed-assets' | 'material-consumption' | 'expense-detail';

type MatrixData = {
  departments: string[];
  departmentIds: string[];
  rows: Array<{
    l1Id: string;
    l1Name: string;
    l2Id: string;
    l2Name: string;
    category: string;
    values: (number | 0)[];
    total: number;
  }>;
  totals: (number | 0)[];
  grandTotal: number;
  lastMonth?: { grandTotal: number; totals: (number | 0)[]; month?: string };
  month?: string;
};

type ExpenseRow = {
  id: string;
  item_name: string;
  sku?: string;
  category_id?: string;
  category_name?: string;
  category_parent_id?: string;
  category_parent_name?: string;
  department_id?: string;
  department_name?: string;
  quantity: number;
  unit?: string;
  unit_price: number;
  total_amount: number;
  movement_type: 'inbound' | 'expense';
  operator_name?: string;
  reason?: string;
  created_at?: string;
};

type ExpenseDetailData = {
  page: number;
  page_size: number;
  total_count: number;
  total_amount: number;
  list: ExpenseRow[];
};

type StockTakeStatus = 'pending' | 'draft' | 'submitted' | 'reviewing' | 'returned' | 'completed';

interface StockTakeProgressItem {
  warehouse_id: string;
  warehouse_name: string;
  department_name: string;
  status: StockTakeStatus;
  take_no: string;
}

function compressAmount(n: number | 0 | null | undefined): string {
  const v = Number(n) || 0;
  if (v === 0) return '-';
  const abs = Math.abs(v);
  if (abs >= 10000) return `${(v / 10000).toFixed(1)}万`;
  if (abs >= 1000) return `${(v / 1000).toFixed(1)}千`;
  return v.toFixed(0);
}

function calcChangeRate(cur: number, last: number): number | null {
  const c = Number(cur) || 0;
  const l = Number(last) || 0;
  if (l === 0 && c === 0) return null;
  if (l === 0) return c > 0 ? 100 : 0;
  return Math.round(((c - l) / l) * 1000) / 10;
}

function TrendBadge({ rate, compact }: { rate: number | null; compact?: boolean }) {
  if (rate === null) return <span className="text-gray-300 text-xs">—</span>;
  if (rate === 100) return <span className="inline-flex items-center gap-0.5 text-red-500 text-xs font-medium">{compact ? '新' : '新增'} ↑</span>;
  if (rate === 0) return <span className="inline-flex items-center gap-0.5 text-gray-400 text-xs">{compact ? '—' : '持平'}</span>;
  const sign = rate > 0 ? '+' : '';
  if (rate > 0) {
    return <span className="inline-flex items-center gap-0.5 text-red-500 text-xs font-medium">{sign}{rate}% ↑</span>;
  }
  if (rate < 0) {
    return <span className="inline-flex items-center gap-0.5 text-green-600 text-xs font-medium">{sign}{rate}% ↓</span>;
  }
  return <span className="inline-flex items-center gap-0.5 text-gray-400 text-xs">0%</span>;
}

function DetailModal({
  open, title, onClose,
  rows, columns,
  // Tab 模式：如果提供了 tabSections，则用 tab 切换；否则走单表模式
  tabSections,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  rows?: any[] | null;
  columns?: { key: string; label: string; align?: 'left' | 'right'; format?: (v: any) => string }[];
  tabSections?: { label: string; rows: any[] | null; columns: { key: string; label: string; align?: 'left' | 'right'; format?: (v: any) => string }[]; footer?: React.ReactNode }[];
}) {
  // 单表模式
  function SingleTable() {
    if (!open) return null;
    return (
      <>
        <div className="flex-1 overflow-auto">
          {!rows ? (
            <div className="py-12 text-center text-gray-400"><p className="text-xs">加载中...</p></div>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center text-gray-400">
              <AlertCircle size={28} className="mx-auto mb-2 opacity-50"/>
              <p className="text-xs">暂无明细数据</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="bg-gray-50/60">
                    {columns!.map(col => (
                      <th
                        key={col.key}
                        className="px-3 py-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wide"
                        style={{ textAlign: col.align || 'left' }}
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((row, i) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}>
                      {columns!.map(col => {
                        const val = row[col.key];
                        const text = col.format ? col.format(val) : (val === undefined || val === null || val === '' ? '-' : String(val));
                        return (
                          <td
                            key={col.key}
                            className="px-3 py-2 text-[11px] text-gray-700"
                            style={{ textAlign: col.align || 'left' }}
                          >
                            {text}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </>
    );
  }

  // Tab 模式
  function TabbedSections() {
    const [activeTab, setActiveTab] = useState(0);
    const section = tabSections![activeTab];

    return (
      <>
        {/* Tab 切换栏 */}
        <div className="flex gap-1 px-4 pt-3 border-b border-gray-100">
          {tabSections!.map((s, i) => (
            <button
              key={i}
              onClick={() => setActiveTab(i)}
              className={`px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors ${
                i === activeTab
                  ? 'bg-primary-50 text-primary-700 border-b-2 border-primary-500 -mb-px'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto">
          {!section.rows ? (
            <div className="py-12 text-center text-gray-400"><p className="text-xs">加载中...</p></div>
          ) : section.rows.length === 0 ? (
            <div className="py-12 text-center text-gray-400">
              <AlertCircle size={28} className="mx-auto mb-2 opacity-50"/>
              <p className="text-xs">暂无数据</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="bg-gray-50/60">
                      {section.columns.map(col => (
                        <th
                          key={col.key}
                          className="px-3 py-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wide"
                          style={{ textAlign: col.align || 'left' }}
                        >
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {section.rows.map((row, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}>
                        {section.columns.map(col => {
                          const val = row[col.key];
                          const text = col.format ? col.format(val) : (val === undefined || val === null || val === '' ? '-' : String(val));
                          return (
                            <td
                              key={col.key}
                              className="px-3 py-2 text-[11px] text-gray-700"
                              style={{ textAlign: col.align || 'left' }}
                            >
                              {text}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {section.footer && (
                <div className="border-t border-gray-100 bg-gray-50/60 px-4 py-2.5">{section.footer}</div>
              )}
            </>
          )}
        </div>
      </>
    );
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-white w-full sm:max-w-xl rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800 text-sm">{title}</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-md"><X size={16}/></button>
        </div>
        {tabSections ? <TabbedSections /> : <SingleTable />}
      </div>
    </div>
  );
}

/** 把L1/L2分类树拍平成级联选项 */
function flattenCategories(tree: CategoryNode[] | undefined): { value: string; label: string; level: number; parentId?: string }[] {
  const out: { value: string; label: string; level: number; parentId?: string }[] = [];
  if (!tree) return out;
  for (const n of tree) {
    out.push({ value: n.id, label: n.name, level: 1, parentId: undefined });
    if (n.children) {
      for (const c of n.children) {
        out.push({ value: c.id, label: c.name, level: 2, parentId: n.id });
      }
    }
  }
  return out;
}

export default function ManagementReport() {
  const [tab, setTab] = useState<TabKey>('fixed-assets');
  const [currentMonth, setCurrentMonth] = useState<Date>(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });
  const [fixedData, setFixedData] = useState<MatrixData | null>(null);
  const [materialData, setMaterialData] = useState<MatrixData | null>(null);
  const [fixedLoading, setFixedLoading] = useState(false);
  const [materialLoading, setMaterialLoading] = useState(false);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTitle, setDetailTitle] = useState('');
  // 单表模式（固定资产明细）
  const [detailRows, setDetailRows] = useState<any[] | null>(null);
  const [detailCols, setDetailCols] = useState<any[]>([]);
  // Tab 模式（原材料消耗明细：仓库消耗 + 食材采购）
  const [detailTabSections, setDetailTabSections] = useState<{ label: string; rows: any[] | null; columns: any[]; footer?: ReactNode }[] | null>(null);

  // 部门费用明细状态
  const { departments, fetchDepartments } = useDepartmentStore();
  const [whCategories, setWhCategories] = useState<CategoryNode[] | undefined>(undefined);
  const [expFilterDept, setExpFilterDept] = useState<string>('');
  const [expFilterL1, setExpFilterL1] = useState<string>('');
  const [expFilterL2, setExpFilterL2] = useState<string>('');
  const [expKeyword, setExpKeyword] = useState('');
  const [expPage, setExpPage] = useState(1);
  const [expData, setExpData] = useState<ExpenseDetailData | null>(null);
  const [expLoading, setExpLoading] = useState(false);

  // 盘点状态条
  const [stockTakeProgress, setStockTakeProgress] = useState<StockTakeProgressItem[]>([]);
  const [stockTakeLoading, setStockTakeLoading] = useState(false);

  const yearMonth = format(currentMonth, 'yyyy-MM');
  const monthLabel = format(currentMonth, 'yyyy年MM月', { locale: zhCN });

  const loadFixed = useCallback(async () => {
    setFixedLoading(true);
    try {
      const data = await api.get('/reports/fixed-assets');
      setFixedData(data as any);
    } catch (e) {
      console.error(e);
    } finally { setFixedLoading(false); }
  }, []);

  const loadMaterial = useCallback(async (ym: string) => {
    setMaterialLoading(true);
    try {
      const data = await api.get(`/reports/material-consumption?month=${ym}`);
      setMaterialData(data as any);
    } catch (e) {
      console.error(e);
    } finally { setMaterialLoading(false); }
  }, []);

  const loadExpense = useCallback(async (ym: string, page: number) => {
    setExpLoading(true);
    try {
      const params = new URLSearchParams({
        month: ym,
        page: String(page),
        page_size: '50',
      });
      if (expFilterDept) params.set('department_id', expFilterDept);
      if (expFilterL2) {
        params.set('category_id', expFilterL2);
      } else if (expFilterL1) {
        params.set('category_parent_id', expFilterL1);
      }
      if (expKeyword.trim()) params.set('keyword', expKeyword.trim());
      const data = await api.get(`/reports/expense-detail?${params.toString()}`);
      setExpData(data as ExpenseDetailData);
    } catch (e) {
      console.error(e);
    } finally { setExpLoading(false); }
  }, [expFilterDept, expFilterL1, expFilterL2, expKeyword]);

  useEffect(() => { loadFixed(); fetchDepartments(); }, [loadFixed, fetchDepartments]);
  useEffect(() => { loadMaterial(yearMonth); }, [yearMonth, loadMaterial]);
  useEffect(() => {
    (async () => {
      try {
        const t = await api.get<CategoryNode[]>('/warehouses/categories/tree');
        setWhCategories(Array.isArray(t) ? t : (t as any).data ?? []);
      } catch (e) { /* ignore */ }
    })();
  }, []);

  useEffect(() => {
    if (tab === 'expense-detail') {
      setExpPage(1);
      loadExpense(yearMonth, 1);
    }
  }, [tab, yearMonth, loadExpense]);

  // 月份变化时获取该月各仓库盘点状态
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStockTakeLoading(true);
      try {
        const data = await api.get<StockTakeProgressItem[]>(`/stock-takes/progress/${yearMonth}`);
        if (!cancelled) {
          setStockTakeProgress(Array.isArray(data) ? data : (data as any).data ?? []);
        }
      } catch (e) {
        if (!cancelled) setStockTakeProgress([]);
      } finally {
        if (!cancelled) setStockTakeLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [yearMonth]);

  const handlePrevMonth = () => setCurrentMonth(prev => subMonths(prev, 1));
  const handleNextMonth = () => {
    const now = new Date(); now.setDate(1); now.setHours(0,0,0,0);
    const cur = new Date(currentMonth); cur.setHours(0,0,0,0);
    if (cur < now) setCurrentMonth(prev => addMonths(prev, 1));
  };

  const openCellDetail = async (opts: {
    type: 'fixed' | 'material';
    categoryId: string;
    categoryName: string;
    departmentId: string;
    departmentName: string;
    value: number;
  }) => {
    if (!opts.value || Number(opts.value) === 0) return;
    setDetailTitle(`${opts.departmentName} · ${opts.categoryName}`);
    setDetailRows(null);
    setDetailTabSections(null);
    setDetailOpen(true);
    try {
      if (opts.type === 'fixed') {
        const rows = await api.get(`/reports/fixed-assets/detail?category_id=${opts.categoryId}&department_id=${opts.departmentId}`);
        setDetailCols([
          { key: 'item_name', label: '物资名称' },
          { key: 'sku', label: 'SKU' },
          { key: 'quantity', label: '数量', align: 'right' as const, format: (v: any) => (v ?? '-') + ' 件' },
          { key: 'unit_price', label: '单价', align: 'right' as const, format: (v: any) => formatCurrency(v) },
          { key: 'total_amount', label: '金额', align: 'right' as const, format: (v: any) => formatCurrency(v) },
        ]);
        setDetailRows(Array.isArray(rows) ? rows : (rows as any).data ?? []);
      } else {
        const data = await api.get(`/reports/material-consumption/detail?category_id=${opts.categoryId}&department_id=${opts.departmentId}&month=${yearMonth}`) as any;
        const result = Array.isArray(data) ? data : (data.data ?? data);

        // Tab 1：仓库消耗（stock_movements 明细）
        const stockCols = [
          { key: 'created_at', label: '时间' },
          { key: 'item_name', label: '物资名称' },
          { key: 'operator_name', label: '操作人' },
          { key: 'quantity', label: '数量', align: 'right' as const, format: (v: any) => Math.abs(Number(v) || 0) + ' 件' },
          { key: 'total_amount', label: '金额', align: 'right' as const, format: (v: any) => formatCurrency(Math.abs(Number(v) || 0)) },
        ];

        // Tab 2：食材采购（按采购分类汇总）
        const purchaseCols = [
          { key: 'category_name', label: '采购分类' },
          { key: 'amount', label: '金额', align: 'right' as const, format: (v: any) => formatCurrency(Number(v) || 0) },
          { key: 'purchases_count', label: '笔数', align: 'right' as const },
        ];

        setDetailTabSections([
          {
            label: '仓库消耗',
            rows: result.stock_movements ?? [],
            columns: stockCols,
          },
          {
            label: '食材采购',
            rows: result.purchase_summary ?? [],
            columns: purchaseCols,
            footer: (
              <div className="flex items-center justify-between text-xs text-gray-600">
                <span className="text-gray-500">合计</span>
                <div className="flex items-center gap-4">
                  <span className="font-semibold text-primary-700">{formatCurrency(Number(result.purchase_total) || 0)}</span>
                  <span className="text-gray-400">{result.purchase_total_count || 0} 笔</span>
                </div>
              </div>
            ),
          },
        ]);
      }
    } catch (e) {
      setDetailRows([]);
      setDetailTabSections(null);
    }
  };

  const downloadPDF = async () => {
    const apiBase = import.meta.env.VITE_API_URL || '/api';
    const token = api.getToken();

    let url = '';
    let filename = '';
    if (tab === 'fixed-assets') {
      url = `${apiBase}/reports/pdf/fixed-assets`;
      filename = `固定资产库存_${new Date().toLocaleDateString('zh-CN')}.pdf`;
    } else if (tab === 'material-consumption') {
      url = `${apiBase}/reports/pdf/material-consumption?month=${yearMonth}`;
      filename = `原材料消耗_${yearMonth}.pdf`;
    } else if (tab === 'expense-detail') {
      const params = new URLSearchParams({ month: yearMonth });
      if (expFilterDept) params.set('department_id', expFilterDept);
      if (expFilterL2) params.set('category_id', expFilterL2);
      else if (expFilterL1) params.set('category_parent_id', expFilterL1);
      if (expKeyword.trim()) params.set('keyword', expKeyword.trim());
      url = `${apiBase}/reports/pdf/expense-detail?${params.toString()}`;
      filename = `部门费用明细_${yearMonth}.pdf`;
    } else {
      return;
    }

    try {
      const headers: Record<string, string> = {
        'Accept': 'application/pdf',
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      const res = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) {
        let errMsg = `下载失败 (HTTP ${res.status})`;
        try {
          const errData = await res.json();
          if (errData?.error) errMsg = errData.error;
        } catch {}
        throw new Error(errMsg);
      }

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('pdf') && !contentType.includes('octet-stream')) {
        let errMsg = '服务器返回了非PDF内容';
        try {
          const errData = await res.json();
          if (errData?.error) errMsg = errData.error;
        } catch {}
        throw new Error(errMsg);
      }

      const blob = await res.blob();
      if (blob.size === 0) throw new Error('PDF文件为空');

      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
    } catch (e: any) {
      if (e.name === 'AbortError') {
        alert('PDF生成超时，请稍后重试');
      } else {
        alert(`PDF下载失败：${e.message || '未知错误'}`);
      }
    }
  };

  // 已移至各Tab分支内单独处理

  // 部门费用明细的筛选分类级联
  const flatCats = useMemo(() => flattenCategories(whCategories), [whCategories]);
  const l1Options = flatCats.filter(c => c.level === 1);
  const l2Options = flatCats.filter(c => c.level === 2 && (expFilterL1 ? c.parentId === expFilterL1 : true));

  const handleSearch = () => {
    setExpPage(1);
    loadExpense(yearMonth, 1);
  };

  return (
    <div className="space-y-4 sm:space-y-6 pb-16">
      <div className="no-print flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-serif font-bold text-gray-800">管理报表</h1>
          <p className="text-gray-500 mt-1 text-sm">
            {tab === 'fixed-assets' && '各部门固定资产库存价值，实时快照'}
            {tab === 'material-consumption' && '各部门当月原材料消耗（扫码领用）'}
            {tab === 'expense-detail' && '当月扫码领用消耗明细，支持筛选和导出'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-white rounded-lg border border-gray-200 p-1">
            <button onClick={handlePrevMonth} className="p-2 hover:bg-gray-100 rounded-md"><ChevronLeft size={18}/></button>
            <div className="px-4 py-1 min-w-[120px] text-center font-medium text-sm">{monthLabel}</div>
            <button onClick={handleNextMonth} className="p-2 hover:bg-gray-100 rounded-md"><ChevronRight size={18}/></button>
          </div>
          {(tab === 'fixed-assets' || tab === 'material-consumption' || tab === 'expense-detail') && (
            <button
              onClick={downloadPDF}
              className="btn-primary flex items-center gap-1.5 text-sm"
            >
              <FileDown size={16}/>PDF
            </button>
          )}
        </div>
      </div>

      {/* Tab */}
      <div className="no-print flex gap-2 overflow-x-auto pb-1">
        <TabButton label="固定资产库存" active={tab === 'fixed-assets'} onClick={() => setTab('fixed-assets')} />
        <TabButton label="原材料消耗" active={tab === 'material-consumption'} onClick={() => setTab('material-consumption')} />
        <TabButton label="部门费用明细" active={tab === 'expense-detail'} onClick={() => setTab('expense-detail')} />
      </div>

      {/* Content */}
      {tab === 'expense-detail' ? (
        <ExpenseDetailCard
          loading={expLoading}
          data={expData}
          departments={departments}
          filterDept={expFilterDept}
          setFilterDept={setExpFilterDept}
          l1Options={l1Options}
          filterL1={expFilterL1}
          setFilterL1={(v) => { setExpFilterL1(v); setExpFilterL2(''); }}
          l2Options={l2Options}
          filterL2={expFilterL2}
          setFilterL2={setExpFilterL2}
          keyword={expKeyword}
          setKeyword={setExpKeyword}
          onSearch={handleSearch}
          page={expPage}
          setPage={(p) => { setExpPage(p); loadExpense(yearMonth, p); }}
        />
      ) : tab === 'material-consumption' ? (
        <>
          {/* 盘点状态条：仅原材料消耗Tab显示 */}
          <StockTakeStatusBar
            month={format(currentMonth, 'M月')}
            items={stockTakeProgress}
            loading={stockTakeLoading}
          />
          <MatrixCard
            title="原材料 · 当月消耗"
            totalLabel="消耗总额"
            data={materialData}
            loading={materialLoading}
            onCellClick={(cell) => openCellDetail({ type: 'material', ...cell })}
            monthLabel={monthLabel}
          />
        </>
      ) : (
        <MatrixCard
          title="固定资产 · 库存价值"
          totalLabel="库存总值"
          data={fixedData}
          loading={fixedLoading}
          onCellClick={(cell) => openCellDetail({ type: 'fixed', ...cell })}
          hideMonthLabel
        />
      )}

      <DetailModal
        open={detailOpen}
        title={detailTitle}
        onClose={() => { setDetailOpen(false); setDetailTabSections(null); }}
        rows={detailRows}
        columns={detailCols}
        tabSections={detailTabSections}
      />
    </div>
  );
}

function TabButton({ label, active, onClick, disabled, badge }: { label: string; active: boolean; onClick: () => void; disabled?: boolean; badge?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-4 py-2 rounded-lg font-medium text-sm whitespace-nowrap transition-colors relative ${
        disabled
          ? 'bg-white text-gray-400 cursor-not-allowed border border-gray-100'
          : active
          ? 'bg-primary-500 text-white shadow-sm'
          : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
      }`}
    >
      {label}
      {badge && (
        <span className="absolute -top-1 -right-1 text-[10px] bg-amber-100 text-amber-700 rounded-full px-1.5 py-0.5">
          {badge}
        </span>
      )}
    </button>
  );
}

// PlaceholderCard 已移除：月末盘点Tab不再占位

const STOCK_TAKE_STATUS_CONFIG: Record<StockTakeStatus, { icon: string; color: string }> = {
  completed: { icon: '✅', color: 'text-green-600' },
  draft: { icon: '⏳', color: 'text-amber-600' },
  submitted: { icon: '⏳', color: 'text-amber-600' },
  reviewing: { icon: '⏳', color: 'text-amber-600' },
  returned: { icon: '⏳', color: 'text-amber-600' },
  pending: { icon: '❌', color: 'text-red-500' },
};

function StockTakeStatusBar({ month, items, loading }: {
  month: string;
  items: StockTakeProgressItem[];
  loading: boolean;
}) {
  // 加载中时显示紧凑的加载提示，避免展示旧月份的过期数据
  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-2 flex items-center gap-2 text-sm text-gray-400">
        <ClipboardCheck size={14} className="animate-pulse text-primary-400" />
        <span>正在加载盘点状态...</span>
      </div>
    );
  }

  // 没有任何需盘点的仓库时不显示
  if (items.length === 0) return null;

  const allCompleted = items.every(i => i.status === 'completed');
  const hasUncompleted = !allCompleted;

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-2.5">
      <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 whitespace-nowrap shrink-0">
          <ClipboardCheck size={14} className="text-primary-500" />
          <span>{month}盘点状态</span>
        </div>
        {allCompleted ? (
          <span className="text-sm text-green-600 font-medium">✅ 全部仓库已完成盘点</span>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {items.map(item => {
              const cfg = STOCK_TAKE_STATUS_CONFIG[item.status];
              return (
                <span key={item.warehouse_id} className={`inline-flex items-center gap-1 ${cfg.color}`}>
                  <span>{cfg.icon}</span>
                  <span className="font-medium">{item.warehouse_name}</span>
                </span>
              );
            })}
          </div>
        )}
      </div>
      {hasUncompleted && (
        <p className="text-xs text-amber-600 mt-1.5">* 未盘点仓库的成本数据为暂估</p>
      )}
    </div>
  );
}

function MatrixCard({ title, totalLabel, data, loading, onCellClick, hideMonthLabel, monthLabel }: {
  title: string;
  totalLabel: string;
  data: MatrixData | null;
  loading: boolean;
  onCellClick: (cell: { categoryId: string; categoryName: string; departmentId: string; departmentName: string; value: number }) => void;
  hideMonthLabel?: boolean;
  monthLabel?: string;
}) {
  return (
    <div className="card">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-semibold text-gray-800">{title}</h2>
          {!hideMonthLabel && monthLabel && (
            <p className="text-[11px] text-gray-400 mt-0.5">{monthLabel}</p>
          )}
          {hideMonthLabel && (
            <p className="text-[11px] text-gray-400 mt-0.5">实时快照，不受月份选择影响</p>
          )}
        </div>
        {data && (
          <div className="text-right">
            <p className="text-[11px] text-gray-400">{totalLabel}</p>
            <p className="text-xl font-bold text-primary-600">{formatCurrency(data.grandTotal)}</p>
            {data.lastMonth && (
              <TrendBadge rate={calcChangeRate(data.grandTotal, data.lastMonth.grandTotal)} />
            )}
          </div>
        )}
      </div>

      {loading && <div className="py-16 text-center text-gray-400">加载中...</div>}

      {!loading && (!data || data.rows.length === 0) && (
        <div className="py-16 text-center text-gray-400">
          <AlertCircle size={36} className="mx-auto mb-2 opacity-50"/>
          <p>暂无数据，请切换月份或确认是否有领料记录</p>
        </div>
      )}

      {!loading && data && data.rows.length > 0 && (
        <div className="overflow-x-auto overflow-y-hidden -mx-6 px-6 sm:-mx-8 sm:px-8">
          <div className="min-w-[640px]">
            <table className="data-table w-full text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-gray-50 z-10 min-w-[110px]">分类</th>
                  {data.departments.map(dept => (
                    <th key={dept} className="min-w-[80px] text-right whitespace-nowrap">
                      <span>{dept}</span>
                      {data.lastMonth && (
                        <div className="mt-0.5"><TrendBadge rate={calcChangeRate(data.totals[data.departments.indexOf(dept)] || 0, data.lastMonth.totals[data.departments.indexOf(dept)] || 0)} compact /></div>
                      )}
                    </th>
                  ))}
                  <th className="sm:sticky sm:right-0 bg-gray-50 z-10 min-w-[90px] text-right font-bold">合计</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const l1ColorMap: Record<string, { bg: string; sticky: string }> = {};
                  let colorIdx = 0;
                  const colorSchemes = [
                    { bg: 'bg-white', sticky: 'bg-white' },
                    { bg: 'bg-slate-50/60', sticky: 'bg-slate-50' },
                  ];
                  for (const row of data.rows) {
                    if (!l1ColorMap[row.l1Id]) {
                      l1ColorMap[row.l1Id] = colorSchemes[colorIdx % colorSchemes.length];
                      colorIdx++;
                    }
                  }
                  return data.rows.map((row, idx) => {
                    const prevRow = idx === 0 ? null : data.rows[idx - 1];
                    const showL1Gap = prevRow && prevRow.l1Id !== row.l1Id;
                    const color = l1ColorMap[row.l1Id];
                    const isFirstOfL1 = !prevRow || prevRow.l1Id !== row.l1Id;
                    return (
                      <Fragment key={row.l2Id}>
                        {showL1Gap && <tr key={`gap-${idx}`}><td colSpan={data.departments.length + 2} className="bg-transparent h-2 border-0 p-0"></td></tr>}
                        <tr className={`hover:bg-primary-50/40 transition-colors ${color.bg} ${isFirstOfL1 ? 'border-t border-gray-200' : ''}`}>
                          <td className={`sticky left-0 ${color.sticky} z-[1]`}>
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] text-gray-400 font-medium w-10 truncate">{row.l1Name}</span>
                              <span className="font-medium text-gray-800 truncate">{row.l2Name}</span>
                            </div>
                          </td>
                          {data.departments.map((dept, i) => {
                            const v = Number(row.values[i]) || 0;
                            const deptId = data.departmentIds[i];
                            return (
                              <td key={dept} className="text-right">
                                {v === 0 ? (
                                  <span className="text-gray-300">—</span>
                                ) : (
                                  <button
                                    onClick={() => onCellClick({
                                      categoryId: row.l2Id,
                                      categoryName: row.l2Name,
                                      departmentId: deptId,
                                      departmentName: dept,
                                      value: v,
                                    })}
                                    className="inline-block px-1.5 py-0.5 rounded-md hover:bg-primary-100 text-primary-700 font-semibold transition-colors"
                                  >
                                    <span className="sm:hidden">{compressAmount(v)}</span>
                                    <span className="hidden sm:inline">{formatCurrency(v)}</span>
                                  </button>
                                )}
                              </td>
                            );
                          })}
                          <td className={`sm:sticky sm:right-0 ${color.sticky} z-[1] text-right font-bold text-gray-800 whitespace-nowrap`}>
                            <span className="sm:hidden">{compressAmount(row.total)}</span>
                            <span className="hidden sm:inline">{formatCurrency(row.total)}</span>
                          </td>
                        </tr>
                      </Fragment>
                    );
                  });
                })()}
                <tr className="bg-gradient-to-r from-gray-100 to-gray-50 border-t-2 border-gray-300 shadow-sm">
                  <td className="sticky left-0 bg-gradient-to-r from-gray-100 to-gray-50 z-[2] font-bold text-gray-700">合计</td>
                  {data.departments.map((dept, i) => {
                    const v = Number(data.totals[i]) || 0;
                    return (
                      <td key={dept} className="text-right font-semibold text-gray-700 whitespace-nowrap">
                        {v === 0 ? <span className="text-gray-300">—</span> :
                        <span className="sm:hidden">{compressAmount(v)}</span>}
                        <span className={v === 0 ? '' : 'hidden sm:inline'}>{v !== 0 ? formatCurrency(v) : '—'}</span>
                      </td>
                    );
                  })}
                  <td className="sm:sticky sm:right-0 bg-gradient-to-l from-gray-50 to-gray-100 z-[2] text-right font-extrabold text-primary-700 whitespace-nowrap">
                    <span className="sm:hidden">{compressAmount(data.grandTotal)}</span>
                    <span className="hidden sm:inline">{formatCurrency(data.grandTotal)}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-gray-400 mt-2 sm:hidden">💡 左右滑动查看各部门数据；点击金额可查看明细</p>
          <p className="text-[11px] text-gray-400 mt-2 hidden sm:block">💡 点击金额可查看明细，点击右上角导出PDF</p>
        </div>
      )}
    </div>
  );
}

function ExpenseDetailCard({
  loading, data, departments,
  filterDept, setFilterDept,
  l1Options, filterL1, setFilterL1,
  l2Options, filterL2, setFilterL2,
  keyword, setKeyword, onSearch,
  page, setPage,
}: {
  loading: boolean;
  data: ExpenseDetailData | null;
  departments: { id: string; name: string }[];
  filterDept: string;
  setFilterDept: (v: string) => void;
  l1Options: { value: string; label: string }[];
  filterL1: string;
  setFilterL1: (v: string) => void;
  l2Options: { value: string; label: string }[];
  filterL2: string;
  setFilterL2: (v: string) => void;
  keyword: string;
  setKeyword: (v: string) => void;
  onSearch: () => void;
  page: number;
  setPage: (p: number) => void;
}) {
  const totalPages = data ? Math.max(1, Math.ceil(data.total_count / data.page_size)) : 1;

  return (
    <div className="card">
      {/* 筛选条 */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:gap-3 mb-4 p-3 sm:p-0 bg-gray-50 sm:bg-transparent -mx-6 px-6 sm:-mx-0 sm:px-0 rounded-lg sm:rounded-none">
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:gap-3 flex-1">
          <select
            value={filterDept}
            onChange={(e) => setFilterDept(e.target.value)}
            className="px-3 py-2 rounded-md border border-gray-200 bg-white text-sm min-w-[140px] flex-1 sm:flex-none"
          >
            <option value="">全部部门</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select
            value={filterL1}
            onChange={(e) => { setFilterL1(e.target.value); setFilterL2(''); }}
            className="px-3 py-2 rounded-md border border-gray-200 bg-white text-sm min-w-[140px] flex-1 sm:flex-none"
          >
            <option value="">全部 L1 分类</option>
            {l1Options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select
            value={filterL2}
            onChange={(e) => setFilterL2(e.target.value)}
            className="px-3 py-2 rounded-md border border-gray-200 bg-white text-sm min-w-[140px] flex-1 sm:flex-none"
            disabled={l2Options.length === 0}
          >
            <option value="">全部 L2 分类</option>
            {l2Options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <div className="relative flex-1 min-w-[160px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onSearch(); }}
              placeholder="搜索物资名称 / SKU"
              className="w-full pl-9 pr-3 py-2 rounded-md border border-gray-200 bg-white text-sm"
            />
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setFilterDept(''); setFilterL1(''); setFilterL2(''); setKeyword(''); setPage(1); }}
            className="px-3 py-2 rounded-md border border-gray-200 bg-white text-sm text-gray-500 hover:bg-gray-50"
            title="重置筛选"
          >重置</button>
          <button
            onClick={onSearch}
            className="btn-primary flex items-center justify-center gap-1.5 text-sm"
          >
            <Filter size={16}/>查询
          </button>
        </div>
      </div>

      {/* 汇总条 */}
      {data && !loading && (
        <div className="flex flex-wrap items-center gap-4 mb-3 text-sm">
          <div>
            <span className="text-gray-400 mr-2">总笔数</span>
            <span className="font-semibold text-gray-800">{data.total_count}</span>
          </div>
          <div>
            <span className="text-gray-400 mr-2">总金额</span>
            <span className="font-bold text-primary-700 text-lg">{formatCurrency(data.total_amount)}</span>
          </div>
        </div>
      )}

      {loading && <div className="py-16 text-center text-gray-400">加载中...</div>}

      {!loading && (!data || data.list.length === 0) && (
        <div className="py-16 text-center text-gray-400">
          <AlertCircle size={36} className="mx-auto mb-2 opacity-50"/>
          <p>当月暂无消耗记录</p>
          <p className="text-xs mt-1">建议切换月份或调整筛选条件</p>
        </div>
      )}

      {!loading && data && data.list.length > 0 && (
        <>
          {/* 表格（桌面端） */}
          <div className="hidden sm:block overflow-x-auto -mx-8 px-8">
            <table className="data-table w-full text-sm min-w-[1000px]">
              <thead>
                <tr>
                  <th>物资名称</th>
                  <th className="min-w-[120px]">分类</th>
                  <th className="min-w-[80px]">部门</th>
                  <th className="text-right min-w-[70px]">数量</th>
                  <th className="text-right min-w-[80px]">单价</th>
                  <th className="text-right min-w-[90px]">金额</th>
                  <th className="min-w-[80px]">方式</th>
                  <th className="min-w-[80px]">操作人</th>
                  <th className="min-w-[140px]">时间</th>
                </tr>
              </thead>
              <tbody>
                {data.list.map(r => (
                  <tr key={r.id}>
                    <td>
                      <div className="font-medium text-gray-800">{r.item_name}</div>
                      {r.sku && <div className="text-xs text-gray-400 mt-0.5">{r.sku}</div>}
                    </td>
                    <td>
                      {r.category_parent_name && <span className="text-xs text-gray-400 mr-1">{r.category_parent_name}/</span>}
                      <span className="text-sm">{r.category_name || '-'}</span>
                    </td>
                    <td>{r.department_name || '-'}</td>
                    <td className="text-right">{r.quantity} {r.unit || ''}</td>
                    <td className="text-right">{formatCurrency(r.unit_price)}</td>
                    <td className="text-right font-semibold text-gray-800">{formatCurrency(r.total_amount)}</td>
                    <td>
                      <span className={`inline-block px-2 py-0.5 text-xs rounded-full ${r.movement_type === 'expense'
                        ? 'bg-amber-50 text-amber-700 border border-amber-200'
                        : 'bg-green-50 text-green-700 border border-green-200'}`}>
                        {r.movement_type === 'expense' ? '即买即用' : '扫码入库'}
                      </span>
                    </td>
                    <td>{r.operator_name || '-'}</td>
                    <td className="text-gray-500">{r.created_at || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 卡片（移动端） */}
          <div className="sm:hidden space-y-2 -mx-6">
            {data.list.map(r => (
              <div key={r.id} className="bg-white border border-gray-100 rounded-xl p-4 mx-3 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-gray-800 truncate">{r.item_name}</div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {r.category_parent_name && `${r.category_parent_name}/`}{r.category_name || '未分类'} · {r.department_name || '-'}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className={`text-xs rounded-full px-2 py-0.5 ${r.movement_type === 'expense'
                      ? 'bg-amber-50 text-amber-700'
                      : 'bg-green-50 text-green-700'}`}>
                      {r.movement_type === 'expense' ? '即买即用' : '扫码入库'}
                    </div>
                    <div className="font-bold text-lg text-primary-700 mt-1">{formatCurrency(r.total_amount)}</div>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-gray-50 flex items-center justify-between text-xs text-gray-500">
                  <span>{r.quantity} {r.unit || '件'} × {formatCurrency(r.unit_price)}</span>
                  <span>{r.created_at || '-'}</span>
                </div>
                {r.operator_name && <div className="mt-1 text-xs text-gray-400">操作人：{r.operator_name}</div>}
              </div>
            ))}
          </div>

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-6 no-print">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 rounded-md border border-gray-200 text-sm disabled:opacity-40"
              >上一页</button>
              <span className="text-sm text-gray-500">{page} / {totalPages}</span>
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 rounded-md border border-gray-200 text-sm disabled:opacity-40"
              >下一页</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
