import { useState, useEffect, useMemo, useCallback } from 'react';
import { ChevronLeft, ChevronRight, FileDown, X, TrendingUp, TrendingDown, Minus, AlertCircle, ClipboardCheck, Building2 } from 'lucide-react';
import { format, subMonths, addMonths } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { api } from '@/lib/api';
import { formatCurrency } from '@/utils/format';

type TabKey = 'fixed-assets' | 'material-consumption' | 'inventory-check' | 'expense-detail';

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

/** 移动端数字缩写 */
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
  if (l === 0) return c > 0 ? 999 : -999; // 无对比值
  return Math.round(((c - l) / l) * 1000) / 10;
}

function TrendBadge({ rate }: { rate: number | null }) {
  if (rate === null) return <span className="text-gray-300 text-xs">—</span>;
  if (rate > 0) {
    return <span className="inline-flex items-center gap-0.5 text-red-500 text-xs font-medium"><TrendingUp size={12}/>{rate >= 999 ? '↑' : `${rate}%`}</span>;
  }
  if (rate < 0) {
    return <span className="inline-flex items-center gap-0.5 text-green-600 text-xs font-medium"><TrendingDown size={12}/>{rate <= -999 ? '↓' : `${rate}%`}</span>;
  }
  return <span className="inline-flex items-center gap-0.5 text-gray-400 text-xs"><Minus size={12}/>0%</span>;
}

/** 明细弹窗 */
function DetailModal({ open, title, onClose, rows, columns }: {
  open: boolean;
  title: string;
  onClose: () => void;
  rows: any[] | null;
  columns: { key: string; label: string; align?: 'left' | 'right'; format?: (v: any) => string }[];
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800 text-base">{title}</h3>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X size={18}/></button>
        </div>
        <div className="flex-1 overflow-auto">
          {!rows ? (
            <div className="py-16 text-center text-gray-400"><p>加载中...</p></div>
          ) : rows.length === 0 ? (
            <div className="py-16 text-center text-gray-400"><AlertCircle size={36} className="mx-auto mb-2 opacity-50"/><p>暂无明细数据</p></div>
          ) : (
            <div className="overflow-x-auto -mx-5">
              <table className="data-table min-w-full">
                <thead>
                  <tr>
                    {columns.map(col => (
                      <th key={col.key} style={{ textAlign: col.align || 'left' }}>{col.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i}>
                      {columns.map(col => {
                        const val = row[col.key];
                        const text = col.format ? col.format(val) : (val === undefined || val === null || val === '' ? '-' : String(val));
                        return <td key={col.key} style={{ textAlign: col.align || 'left' }}>{text}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
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
  const [detailRows, setDetailRows] = useState<any[] | null>(null);
  const [detailCols, setDetailCols] = useState<any[]>([]);

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

  useEffect(() => { loadFixed(); }, [loadFixed]);
  useEffect(() => { loadMaterial(yearMonth); }, [yearMonth, loadMaterial]);

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
        const rows = await api.get(`/reports/material-consumption/detail?category_id=${opts.categoryId}&department_id=${opts.departmentId}&month=${yearMonth}`);
        setDetailCols([
          { key: 'created_at', label: '时间' },
          { key: 'item_name', label: '物资名称' },
          { key: 'operator_name', label: '操作人' },
          { key: 'quantity', label: '数量', align: 'right' as const, format: (v: any) => Math.abs(Number(v) || 0) + ' 件' },
          { key: 'total_amount', label: '金额', align: 'right' as const, format: (v: any) => formatCurrency(Math.abs(Number(v) || 0)) },
        ]);
        setDetailRows(Array.isArray(rows) ? rows : (rows as any).data ?? []);
      }
    } catch (e) {
      setDetailRows([]);
    }
  };

  const downloadPDF = () => {
    if (tab === 'fixed-assets') {
      window.open(`${import.meta.env.VITE_API_BASE_URL || ''}/api/reports/pdf/fixed-assets`, '_blank');
    } else if (tab === 'material-consumption') {
      window.open(`${import.meta.env.VITE_API_BASE_URL || ''}/api/reports/pdf/material-consumption?month=${yearMonth}`, '_blank');
    }
  };

  const currentData: MatrixData | null =
    tab === 'fixed-assets' ? fixedData :
    tab === 'material-consumption' ? materialData : null;
  const currentLoading =
    tab === 'fixed-assets' ? fixedLoading :
    tab === 'material-consumption' ? materialLoading : false;

  return (
    <div className="space-y-4 sm:space-y-6 pb-16">
      <div className="no-print flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-serif font-bold text-gray-800">管理报表</h1>
          <p className="text-gray-500 mt-1 text-sm">
            {tab === 'fixed-assets' && '各部门固定资产库存价值，实时快照'}
            {tab === 'material-consumption' && '各部门当月原材料消耗（扫码领用）'}
            {(tab === 'inventory-check' || tab === 'expense-detail') && '开发中，敬请期待'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-white rounded-lg border border-gray-200 p-1">
            <button onClick={handlePrevMonth} className="p-2 hover:bg-gray-100 rounded-md"><ChevronLeft size={18}/></button>
            <div className="px-4 py-1 min-w-[120px] text-center font-medium text-sm">{monthLabel}</div>
            <button onClick={handleNextMonth} className="p-2 hover:bg-gray-100 rounded-md"><ChevronRight size={18}/></button>
          </div>
          {(tab === 'fixed-assets' || tab === 'material-consumption') && currentData && (
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
        <TabButton label="月末盘点" active={tab === 'inventory-check'} onClick={() => setTab('inventory-check')} disabled badge="开发中" />
        <TabButton label="部门费用明细" active={tab === 'expense-detail'} onClick={() => setTab('expense-detail')} disabled badge="开发中" />
      </div>

      {/* Content */}
      {(tab === 'inventory-check' || tab === 'expense-detail') ? (
        <PlaceholderCard type={tab} />
      ) : (
        <MatrixCard
          title={tab === 'fixed-assets' ? '固定资产 · 库存价值' : '原材料 · 当月消耗'}
          totalLabel={tab === 'fixed-assets' ? '库存总值' : '消耗总额'}
          data={currentData}
          loading={currentLoading}
          onCellClick={(cell) => openCellDetail({ type: tab === 'fixed-assets' ? 'fixed' : 'material', ...cell })}
          hideMonthLabel={tab === 'fixed-assets'}
          monthLabel={monthLabel}
        />
      )}

      <DetailModal open={detailOpen} title={detailTitle} onClose={() => setDetailOpen(false)} rows={detailRows} columns={detailCols}/>
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

function PlaceholderCard({ type }: { type: TabKey }) {
  const title = type === 'inventory-check' ? '月末盘点' : '部门费用明细';
  const desc = type === 'inventory-check'
    ? '预计支持：各仓库月末库存快照、与账面差异对比、盘点录入、差异报告。'
    : '预计支持：按时间段、按部门、按分类筛选消耗明细，支持导出。';
  return (
    <div className="card flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mb-4">
        {type === 'inventory-check' ? <ClipboardCheck size={32} className="text-gray-400"/> : <Building2 size={32} className="text-gray-400"/>}
      </div>
      <h3 className="text-lg font-semibold text-gray-700 mb-1">{title}</h3>
      <p className="text-sm text-gray-400 max-w-md">{desc}</p>
      <p className="mt-3 text-xs text-gray-300">预计后续版本发布</p>
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
          <h2 className="text-lg font-semibold text-gray-800">{title}</h2>
          {!hideMonthLabel && monthLabel && (
            <p className="text-xs text-gray-400 mt-0.5">{monthLabel}</p>
          )}
          {hideMonthLabel && (
            <p className="text-xs text-gray-400 mt-0.5">实时快照，不受月份选择影响</p>
          )}
        </div>
        {data && (
          <div className="text-right">
            <p className="text-xs text-gray-400">{totalLabel}</p>
            <p className="text-2xl font-bold text-primary-600">{formatCurrency(data.grandTotal)}</p>
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
          <p>暂无数据</p>
        </div>
      )}

      {!loading && data && data.rows.length > 0 && (
        <div className="overflow-x-auto -mx-6 px-6 sm:-mx-8 sm:px-8">
          <div className="min-w-[640px]">
            <table className="data-table w-full text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-gray-50 z-10 min-w-[120px]">分类</th>
                  {data.departments.map(dept => (
                    <th key={dept} className="min-w-[90px] text-right whitespace-nowrap">
                      <span>{dept}</span>
                      {data.lastMonth && (
                        <div><TrendBadge rate={calcChangeRate(data.totals[data.departments.indexOf(dept)] || 0, data.lastMonth.totals[data.departments.indexOf(dept)] || 0)} /></div>
                      )}
                    </th>
                  ))}
                  <th className="sticky right-0 bg-gray-50 z-10 min-w-[100px] text-right font-bold">合计</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, idx) => {
                  const prevRow = idx === 0 ? null : data.rows[idx - 1];
                  const showL1Gap = prevRow && prevRow.l1Id !== row.l1Id;
                  return (
                    <>
                      {showL1Gap && <tr key={`gap-${idx}`}><td colSpan={data.departments.length + 2} className="bg-transparent h-0 border-0 p-0"></td></tr>}
                      <tr key={row.l2Id} className="hover:bg-primary-50/40 transition-colors">
                        <td className="sticky left-0 bg-white z-[1]">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-gray-400 font-medium w-10 truncate">{row.l1Name}</span>
                            <span className="font-medium text-gray-800 truncate">{row.l2Name}</span>
                          </div>
                        </td>
                        {data.departments.map((dept, i) => {
                          const v = Number(row.values[i]) || 0;
                          const deptId = data.departmentIds[i];
                          return (
                            <td key={dept} className="text-right">
                              {v === 0 ? (
                                <span className="text-gray-200">-</span>
                              ) : (
                                <button
                                  onClick={() => onCellClick({
                                    categoryId: row.l2Id,
                                    categoryName: row.l2Name,
                                    departmentId: deptId,
                                    departmentName: dept,
                                    value: v,
                                  })}
                                  className="inline-block px-2 py-0.5 rounded-md hover:bg-primary-100 text-primary-700 font-semibold transition-colors"
                                >
                                  <span className="sm:hidden">{compressAmount(v)}</span>
                                  <span className="hidden sm:inline">{formatCurrency(v)}</span>
                                </button>
                              )}
                            </td>
                          );
                        })}
                        <td className="sticky right-0 bg-white z-[1] text-right font-bold text-gray-800 whitespace-nowrap">
                          <span className="sm:hidden">{compressAmount(row.total)}</span>
                          <span className="hidden sm:inline">{formatCurrency(row.total)}</span>
                        </td>
                      </tr>
                    </>
                  );
                })}
                <tr className="bg-gray-100/80 border-t-2 border-gray-200">
                  <td className="sticky left-0 bg-gray-100 z-[1] font-bold text-gray-700">合计</td>
                  {data.departments.map((dept, i) => {
                    const v = Number(data.totals[i]) || 0;
                    return (
                      <td key={dept} className="text-right font-bold text-gray-800 whitespace-nowrap">
                        <span className="sm:hidden">{compressAmount(v)}</span>
                        <span className="hidden sm:inline">{formatCurrency(v)}</span>
                      </td>
                    );
                  })}
                  <td className="sticky right-0 bg-gray-100 z-[1] text-right font-extrabold text-primary-700 whitespace-nowrap">
                    <span className="sm:hidden">{compressAmount(data.grandTotal)}</span>
                    <span className="hidden sm:inline">{formatCurrency(data.grandTotal)}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-400 mt-3 sm:hidden">💡 左右滑动查看各部门数据；点击金额可查看明细</p>
          <p className="text-xs text-gray-400 mt-3 hidden sm:block">💡 点击金额可查看明细，点击右上角导出PDF</p>
        </div>
      )}
    </div>
  );
}
