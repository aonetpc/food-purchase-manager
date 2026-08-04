import { useState, useMemo, useEffect } from 'react';
import {
  X,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Warehouse as WarehouseIcon,
  ClipboardList,
  Truck,
} from 'lucide-react';
import { api } from '@/lib/api';

// ====== 最小化类型定义（避免循环依赖） ======
interface Wh {
  id: string;
  name: string;
  type?: string;
  department_id?: string;
  department_name?: string;
}
interface CatNode {
  id: string;
  name: string;
  parent_id?: string | null;
  level: number;
  children?: CatNode[];
}
interface WhItem {
  id: string;
  name: string;
  sku?: string;
  spec?: string;
  unit?: string;
  reference_price?: number;
  category_id?: string;
}
interface Supplier {
  id: string;
  name: string;
  prepay_balance?: number;
}

// 导入结果行
export interface PasteLine {
  item_id: string;
  item_name: string;
  unit: string;
  quantity: string;
  unit_price: string;
  warehouse_id: string;
  warehouse_name: string;
  supplier_id?: string;
  supplier_name?: string;
  reason: string;
}

// 解析行状态
type RowStatus = 'matched' | 'item_missing' | 'item_similar' | 'warehouse_missing' | 'supplier_missing' | 'error';

interface ParsedRow {
  id: string;
  rawText: string;
  rowIndex: number;
  name: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  warehouse: string;
  supplier: string;
  reason: string;
  status: RowStatus;
  matchedItem?: WhItem;
  matchedWarehouse?: Wh;
  matchedSupplier?: Supplier;
  // 相似度候选列表（status='item_similar' 时使用）
  similarCandidates?: WhItem[];
  error?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (lines: PasteLine[]) => void;
  onItemCreated?: (item: WhItem) => void;
  onSupplierCreated?: (supplier: Supplier) => void;
  warehouses: Wh[];
  categoryTree: CatNode[];
  items: WhItem[];
  suppliers: Supplier[];
  // 预付/月结采购已选表头供应商时传入，导入时自动复用，不解析供应商列
  fixedSupplier?: Supplier | null;
}

const genId = () => Math.random().toString(36).substring(2, 11);

// 扁平化分类树（供新增物资表单使用）
const flattenCats = (
  nodes: CatNode[],
  prefix = '',
): { id: string; name: string }[] => {
  const result: { id: string; name: string }[] = [];
  nodes.forEach((n) => {
    const name = prefix ? `${prefix} / ${n.name}` : n.name;
    result.push({ id: n.id, name });
    if (n.children?.length) result.push(...flattenCats(n.children, name));
  });
  return result;
};

export default function WarehouseBatchPasteModal({
  open,
  onClose,
  onConfirm,
  onItemCreated,
  onSupplierCreated,
  warehouses,
  categoryTree,
  items: initialItems,
  suppliers: initialSuppliers,
  fixedSupplier,
}: Props) {
  const [pasteText, setPasteText] = useState('');
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [step, setStep] = useState<'paste' | 'preview'>('paste');
  const [localItems, setLocalItems] = useState<WhItem[]>(initialItems);
  const [localSuppliers, setLocalSuppliers] = useState<Supplier[]>(initialSuppliers);

  // 新增物资 / 仓库映射 / 供应商映射 弹窗
  const [resolveRow, setResolveRow] = useState<ParsedRow | null>(null);
  const [resolveType, setResolveType] = useState<'item' | 'warehouse' | 'supplier' | null>(null);
  const [newItemForm, setNewItemForm] = useState({
    name: '',
    categoryId: '',
    unit: '',
    refPrice: '',
  });
  const [newItemError, setNewItemError] = useState('');
  const [newSupplierName, setNewSupplierName] = useState('');
  const [newSupplierError, setNewSupplierError] = useState('');
  const [saving, setSaving] = useState(false);

  const flatCats = useMemo(() => flattenCats(categoryTree), [categoryTree]);
  // 是否固定使用表头供应商（预付/月结）
  const useFixedSupplier = !!fixedSupplier;

  useEffect(() => {
    if (open) {
      setPasteText('');
      setParsedRows([]);
      setStep('paste');
      setResolveRow(null);
      setResolveType(null);
    }
  }, [open]);

  useEffect(() => {
    setLocalItems(initialItems);
  }, [initialItems]);

  useEffect(() => {
    setLocalSuppliers(initialSuppliers);
  }, [initialSuppliers]);

  // ===== 解析粘贴文本（异步：未匹配时调用相似度查询） =====
  const [parsing, setParsing] = useState(false);
  const parseText = async () => {
    const lines = pasteText.trim().split('\n').filter((l) => l.trim());
    const rows: ParsedRow[] = [];

    // 第一遍：解析所有行，本地精确匹配
    const needSearchIdx: number[] = []; // 需要相似度查询的行索引
    lines.forEach((line, idx) => {
      // 优先 Tab（保留 Excel 空列），其次逗号，最后空白
      let cols = line.split('\t');
      if (cols.length < 2) cols = line.split(/[,，]/);
      if (cols.length < 2) cols = line.split(/\s+/);
      cols = cols.map((c) => c.trim());

      // 跳过表头（第一行且关键词命中≥2个）
      if (idx === 0) {
        const hits = (line.match(/物资名称|规格|单位|数量|单价|仓库|供应商|理由/g) || []).length;
        if (hits >= 2) return;
      }

      if (cols.length < 1 || !cols[0]) {
        rows.push({
          id: genId(),
          rawText: line,
          rowIndex: idx,
          name: '',
          unit: '',
          quantity: '',
          unitPrice: '',
          warehouse: '',
          supplier: '',
          reason: '',
          status: 'error',
          error: '格式不正确，至少需要物资名称',
        });
        return;
      }

      const name = cols[0];
      let unit = '';
      let quantity = '1';
      let unitPrice = '0';
      let warehouse = '';
      let supplier = '';
      let reason = '';

      if (cols.length <= 3) {
        // 简写格式：名称 [数量] 单价
        if (cols.length === 2) {
          unitPrice = cols[1];
        } else if (cols.length === 3) {
          quantity = cols[1];
          unitPrice = cols[2];
        }
      } else {
        // 完整格式：名称 | 单位 | 数量 | 单价 | 仓库 | 供应商 | 理由
        // 合并方案后规格已并入名称，不再单独解析规格列
        unit = cols[1] || '';
        quantity = cols[2] || '1';
        unitPrice = cols[3] || '0';
        warehouse = cols[4] || '';
        if (useFixedSupplier) {
          reason = cols[5] || '';
        } else {
          supplier = cols[5] || '';
          reason = cols[6] || '';
        }
      }

      // 合并方案：name 即唯一标识，本地精确匹配
      const matchedItem = localItems.find((it) => it.name === name);

      // 匹配仓库
      let matchedWarehouse: Wh | undefined;
      if (warehouse) {
        matchedWarehouse = warehouses.find((w) => w.name === warehouse);
      }

      // 匹配供应商（固定供应商模式下直接使用表头供应商）
      let matchedSupplier: Supplier | undefined;
      if (useFixedSupplier) {
        matchedSupplier = fixedSupplier || undefined;
      } else if (supplier) {
        matchedSupplier = localSuppliers.find((s) => s.name === supplier);
      }

      let status: RowStatus = 'matched';
      if (!matchedItem) {
        // 本地未匹配，稍后调用相似度查询
        status = 'item_missing';
        needSearchIdx.push(rows.length); // 记录行在 rows 中的位置
      } else if (warehouse && !matchedWarehouse) {
        status = 'warehouse_missing';
      } else if (!useFixedSupplier && supplier && !matchedSupplier) {
        status = 'supplier_missing';
      }

      // 匹配到物资时补全单位/参考价
      if (matchedItem) {
        if (!unit && matchedItem.unit) unit = matchedItem.unit;
        if ((!unitPrice || unitPrice === '0') && matchedItem.reference_price != null) {
          unitPrice = String(matchedItem.reference_price);
        }
      }

      rows.push({
        id: genId(),
        rawText: line,
        rowIndex: idx,
        name,
        unit,
        quantity,
        unitPrice,
        warehouse,
        supplier,
        reason,
        status,
        matchedItem,
        matchedWarehouse,
        matchedSupplier,
      });
    });

    // 第二遍：对本地未匹配的行调用相似度查询接口
    if (needSearchIdx.length > 0) {
      setParsing(true);
      await Promise.all(
        needSearchIdx.map(async (rowIdx) => {
          const row = rows[rowIdx];
          try {
            const result = await api.get<{ exact: WhItem | null; candidates: WhItem[] }>(
              '/warehouses/items/search',
              { params: { q: row.name } },
            );
            if (result.exact) {
              // 后端精确匹配（可能本地列表未及时更新）
              row.matchedItem = result.exact;
              if (!row.unit && result.exact.unit) row.unit = result.exact.unit;
              if ((!row.unitPrice || row.unitPrice === '0') && result.exact.reference_price != null) {
                row.unitPrice = String(result.exact.reference_price);
              }
              // 重新判断状态
              if (row.warehouse && !row.matchedWarehouse) row.status = 'warehouse_missing';
              else if (!useFixedSupplier && row.supplier && !row.matchedSupplier) row.status = 'supplier_missing';
              else row.status = 'matched';
            } else if (result.candidates && result.candidates.length > 0) {
              // 有相似候选，标记待确认
              row.status = 'item_similar';
              row.similarCandidates = result.candidates;
            } else {
              row.status = 'item_missing';
            }
          } catch {
            // 查询失败保持 item_missing
          }
        }),
      );
      setParsing(false);
    }

    setParsedRows(rows);
    setStep('preview');
  };

  const matchedCount = useMemo(
    () => parsedRows.filter((r) => r.status === 'matched').length,
    [parsedRows],
  );
  const needResolveCount = useMemo(
    () => parsedRows.filter((r) => r.status !== 'matched' && r.status !== 'error').length,
    [parsedRows],
  );
  const errorCount = useMemo(
    () => parsedRows.filter((r) => r.status === 'error').length,
    [parsedRows],
  );

  // ===== 新增物资 =====
  const handleResolveItem = (row: ParsedRow) => {
    setResolveRow(row);
    setResolveType('item');
    setNewItemForm({
      name: row.name,
      categoryId: flatCats[0]?.id || '',
      unit: row.unit,
      refPrice: row.unitPrice,
    });
    setNewItemError('');
  };

  const handleAddItem = async () => {
    if (!newItemForm.name.trim()) {
      setNewItemError('请输入物资名称');
      return;
    }
    if (!newItemForm.unit.trim()) {
      setNewItemError('请输入计量单位');
      return;
    }
    setSaving(true);
    setNewItemError('');
    try {
      const created = await api.post<WhItem>('/warehouses/items', {
        name: newItemForm.name.trim(),
        category_id: newItemForm.categoryId || null,
        unit: newItemForm.unit.trim(),
        reference_price: newItemForm.refPrice ? parseFloat(newItemForm.refPrice) : null,
      });
      // 同步到本地物资列表
      setLocalItems((prev) => [created, ...prev]);
      onItemCreated?.(created);
      // 更新当前行状态
      setParsedRows((prev) =>
        prev.map((r) => {
          if (r.id !== resolveRow?.id) return r;
          const newUnit = r.unit || created.unit || '';
          const newPrice =
            r.unitPrice && r.unitPrice !== '0'
              ? r.unitPrice
              : created.reference_price != null
              ? String(created.reference_price)
              : '0';
          let newStatus: RowStatus = 'matched';
          if (r.warehouse && !r.matchedWarehouse) newStatus = 'warehouse_missing';
          else if (!useFixedSupplier && r.supplier && !r.matchedSupplier) newStatus = 'supplier_missing';
          return {
            ...r,
            status: newStatus,
            matchedItem: created,
            unit: newUnit,
            unitPrice: newPrice,
          };
        }),
      );
      setResolveRow(null);
      setResolveType(null);
    } catch (err: any) {
      // 409 表示已存在同名物资，提示用户使用映射
      if (err.status === 409 || err.code === 409) {
        setNewItemError('已存在同名物资，请关闭此弹窗后使用"映射物资"功能选择已有物资');
      } else {
        setNewItemError(err.message || '新增物资失败');
      }
    } finally {
      setSaving(false);
    }
  };

  // ===== 选择相似候选物资 =====
  const handlePickSimilar = (row: ParsedRow, item: WhItem) => {
    setParsedRows((prev) =>
      prev.map((r) => {
        if (r.id !== row.id) return r;
        const newUnit = r.unit || item.unit || '';
        const newPrice =
          r.unitPrice && r.unitPrice !== '0'
            ? r.unitPrice
            : item.reference_price != null
            ? String(item.reference_price)
            : '0';
        let newStatus: RowStatus = 'matched';
        if (r.warehouse && !r.matchedWarehouse) newStatus = 'warehouse_missing';
        else if (!useFixedSupplier && r.supplier && !r.matchedSupplier) newStatus = 'supplier_missing';
        return {
          ...r,
          status: newStatus,
          matchedItem: item,
          unit: newUnit,
          unitPrice: newPrice,
          similarCandidates: undefined,
        };
      }),
    );
  };

  // ===== 仓库映射 =====
  const handleResolveWarehouse = (row: ParsedRow) => {
    setResolveRow(row);
    setResolveType('warehouse');
  };

  const handleMapWarehouse = (whId: string) => {
    const wh = warehouses.find((w) => w.id === whId);
    if (!wh || !resolveRow) return;
    setParsedRows((prev) =>
      prev.map((r) => {
        if (r.id !== resolveRow.id) return r;
        let newStatus: RowStatus = 'matched';
        if (!useFixedSupplier && r.supplier && !r.matchedSupplier) newStatus = 'supplier_missing';
        return { ...r, status: newStatus, matchedWarehouse: wh, warehouse: wh.name };
      }),
    );
    setResolveRow(null);
    setResolveType(null);
  };

  // ===== 供应商映射 =====
  const handleResolveSupplier = (row: ParsedRow) => {
    setResolveRow(row);
    setResolveType('supplier');
    setNewSupplierName(row.supplier);
    setNewSupplierError('');
  };

  const handleMapSupplier = (supplierId: string) => {
    const supp = localSuppliers.find((s) => s.id === supplierId);
    if (!supp || !resolveRow) return;
    setParsedRows((prev) =>
      prev.map((r) =>
        r.id === resolveRow.id
          ? { ...r, status: 'matched', matchedSupplier: supp, supplier: supp.name }
          : r,
      ),
    );
    setResolveRow(null);
    setResolveType(null);
  };

  const handleAddSupplier = async () => {
    if (!newSupplierName.trim()) {
      setNewSupplierError('请输入供应商名称');
      return;
    }
    setSaving(true);
    setNewSupplierError('');
    try {
      const created = await api.post<Supplier>('/suppliers', {
        name: newSupplierName.trim(),
      });
      setLocalSuppliers((prev) => [created, ...prev]);
      onSupplierCreated?.(created);
      setParsedRows((prev) =>
        prev.map((r) =>
          r.id === resolveRow?.id
            ? { ...r, status: 'matched', matchedSupplier: created, supplier: created.name }
            : r,
        ),
      );
      setResolveRow(null);
      setResolveType(null);
    } catch (err: any) {
      setNewSupplierError(err.message || '新增供应商失败');
    } finally {
      setSaving(false);
    }
  };

  // ===== 确认导入 =====
  const handleConfirm = () => {
    const validRows = parsedRows.filter((r) => r.status === 'matched');
    const lines: PasteLine[] = validRows.map((r) => ({
      item_id: r.matchedItem?.id || '',
      item_name: r.name,
      unit: r.unit,
      quantity: r.quantity,
      unit_price: r.unitPrice,
      warehouse_id: r.matchedWarehouse?.id || '',
      warehouse_name: r.matchedWarehouse?.name || r.warehouse,
      supplier_id: useFixedSupplier
        ? fixedSupplier?.id
        : r.matchedSupplier?.id || '',
      supplier_name: useFixedSupplier
        ? fixedSupplier?.name
        : r.matchedSupplier?.name || r.supplier,
      reason: r.reason,
    }));
    onConfirm(lines);
    onClose();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-primary-100 rounded-xl flex items-center justify-center">
              <ClipboardList size={18} className="text-primary-600" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-800">批量粘贴导入</h2>
              <p className="text-xs text-gray-500">从 Excel/WPS 复制数据，快速录入</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {/* ===== 步骤1：粘贴 ===== */}
        {step === 'paste' ? (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">粘贴数据</label>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={
                  useFixedSupplier
                    ? '格式：物资名称 规格 单位 数量 单价 仓库名称 采购理由\n例如：\n洗洁精 5L 桶 10 35.00 厨房仓 日常补充\n灯泡 LED12W 个 20 8.50 总仓\n（供应商已自动使用表头选择的：' +
                      (fixedSupplier?.name || '') +
                      '）\n\n简写（3列）：物资名称 数量 单价\n白菜 2 5.00'
                    : '格式：物资名称 规格 单位 数量 单价 仓库名称 供应商 采购理由\n例如：\n洗洁精 5L 桶 10 35.00 厨房仓 永辉超市 日常补充\n灯泡 LED12W 个 20 8.50 总仓 飞利浦 月度补充\n\n简写（3列）：物资名称 数量 单价\n白菜 2 5.00'
                }
                className="w-full h-56 border border-gray-200 rounded-lg px-4 py-3 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 resize-none"
              />
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
              <p>
                <strong>格式说明：</strong>每行一条，用 Tab（Excel 复制自带）、空格或逗号分隔
              </p>
              <p className="mt-1">
                列顺序：
                <code className="bg-amber-100 px-1 rounded">
                  {useFixedSupplier
                    ? '物资名称 | 规格 | 单位 | 数量 | 单价 | 仓库名称 | 采购理由'
                    : '物资名称 | 规格 | 单位 | 数量 | 单价 | 仓库名称 | 供应商 | 采购理由'}
                </code>
              </p>
              {useFixedSupplier ? (
                <p className="mt-1">
                  当前为
                  <strong>预付/月结</strong>
                  采购，供应商自动使用表头选择的「{fixedSupplier?.name || '-'}」
                </p>
              ) : (
                <p className="mt-1">
                  供应商未匹配时可在预览页映射或新增到供应商库
                </p>
              )}
              <p className="mt-1">
                简写模式（3列）：
                <code className="bg-amber-100 px-1 rounded">物资名称 | 数量 | 单价</code>
                ，其余字段留空
              </p>
              <p className="mt-1">
                未匹配的物资可在预览页一键新增到物资库，仓库名不匹配可手动映射
              </p>
            </div>
          </div>
        ) : (
          /* ===== 步骤2：预览 ===== */
          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3 text-xs">
                <span className="inline-flex items-center gap-1">
                  <CheckCircle size={14} className="text-green-500" />
                  已匹配 <strong className="text-green-600">{matchedCount}</strong>
                </span>
                <span className="inline-flex items-center gap-1">
                  <AlertCircle size={14} className="text-amber-500" />
                  需处理 <strong className="text-amber-600">{needResolveCount}</strong>
                </span>
                {errorCount > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <AlertCircle size={14} className="text-red-500" />
                    错误 <strong className="text-red-600">{errorCount}</strong>
                  </span>
                )}
              </div>
              <button
                onClick={() => setStep('paste')}
                className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1"
              >
                <RefreshCw size={12} /> 重新粘贴
              </button>
            </div>

            <div className="space-y-1.5">
              {parsedRows.map((row) => (
                <div
                  key={row.id}
                  className={`p-2 rounded-lg border text-xs transition-all ${
                    row.status === 'matched'
                      ? 'border-green-200 bg-green-50/50'
                      : row.status === 'error'
                      ? 'border-red-200 bg-red-50/50'
                      : 'border-amber-200 bg-amber-50/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {row.status === 'matched' ? (
                        <CheckCircle size={16} className="text-green-500 flex-shrink-0" />
                      ) : row.status === 'error' ? (
                        <AlertCircle size={16} className="text-red-500 flex-shrink-0" />
                      ) : (
                        <AlertCircle size={16} className="text-amber-500 flex-shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="font-medium text-gray-800 truncate">
                          {row.name || row.rawText}
                        </div>
                        <div className="text-gray-500">
                          {row.quantity} {row.unit} · ¥{row.unitPrice}
                          {row.warehouse && ` · ${row.warehouse}`}
                          {useFixedSupplier && fixedSupplier
                            ? ` · 供应商: ${fixedSupplier.name}`
                            : !useFixedSupplier && row.supplier
                            ? ` · 供应商: ${row.supplier}`
                            : ''}
                          {row.reason && ` · ${row.reason}`}
                        </div>
                      </div>
                    </div>
                    <div className="flex-shrink-0">
                      {row.status === 'item_missing' && (
                        <button
                          onClick={() => handleResolveItem(row)}
                          className="text-xs bg-primary-500 text-white px-2.5 py-1 rounded hover:bg-primary-600"
                        >
                          新增物资
                        </button>
                      )}
                      {row.status === 'item_similar' && (
                        <div className="flex items-center gap-1">
                          <select
                            className="text-xs border border-amber-300 rounded px-1.5 py-1 bg-white max-w-[180px]"
                            onChange={(e) => {
                              const item = row.similarCandidates?.find((c) => c.id === e.target.value);
                              if (item) handlePickSimilar(row, item);
                            }}
                            value=""
                          >
                            <option value="">选择相似物资...</option>
                            {row.similarCandidates?.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name} ({c.unit})
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => handleResolveItem(row)}
                            className="text-xs bg-primary-500 text-white px-2 py-1 rounded hover:bg-primary-600 whitespace-nowrap"
                          >
                            新增
                          </button>
                        </div>
                      )}
                      {row.status === 'warehouse_missing' && (
                        <button
                          onClick={() => handleResolveWarehouse(row)}
                          className="text-xs bg-blue-500 text-white px-2.5 py-1 rounded hover:bg-blue-600"
                        >
                          映射仓库
                        </button>
                      )}
                      {row.status === 'supplier_missing' && (
                        <button
                          onClick={() => handleResolveSupplier(row)}
                          className="text-xs bg-purple-500 text-white px-2.5 py-1 rounded hover:bg-purple-600"
                        >
                          映射供应商
                        </button>
                      )}
                      {row.status === 'error' && (
                        <span className="text-xs text-red-500">{row.error}</span>
                      )}
                      {row.status === 'matched' && (
                        <span className="text-xs text-green-600">已匹配</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 底部按钮 */}
        <div className="px-6 py-3 border-t border-gray-100 flex gap-3">
          {step === 'paste' ? (
            <>
              <button onClick={onClose} className="btn-secondary flex-1">
                取消
              </button>
              <button
                onClick={parseText}
                disabled={!pasteText.trim() || parsing}
                className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {parsing ? '解析中...' : '解析预览'}
              </button>
            </>
          ) : (
            <>
              <button onClick={onClose} className="btn-secondary flex-1">
                取消
              </button>
              <button
                onClick={handleConfirm}
                disabled={matchedCount === 0}
                className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                确认导入 ({matchedCount} 条)
              </button>
            </>
          )}
        </div>

        {/* ===== 新增物资弹窗 ===== */}
        {resolveRow && resolveType === 'item' && (
          <div
            className="fixed inset-0 bg-black/30 flex items-center justify-center z-[60]"
            onClick={() => {
              setResolveRow(null);
              setResolveType(null);
            }}
          >
            <div
              className="bg-white rounded-xl shadow-xl p-5 w-full max-w-md"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-base font-semibold text-gray-800 mb-3">新增物资</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    物资名称
                  </label>
                  <input
                    type="text"
                    value={newItemForm.name}
                    onChange={(e) => setNewItemForm({ ...newItemForm, name: e.target.value })}
                    className="input-field text-sm"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">分类</label>
                  <select
                    value={newItemForm.categoryId}
                    onChange={(e) =>
                      setNewItemForm({ ...newItemForm, categoryId: e.target.value })
                    }
                    className="input-field text-sm"
                  >
                    <option value="">未分类</option>
                    {flatCats.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      单位 <span className="text-danger-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={newItemForm.unit}
                      onChange={(e) => setNewItemForm({ ...newItemForm, unit: e.target.value })}
                      placeholder="如 个、箱"
                      className="input-field text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    参考单价
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={newItemForm.refPrice}
                    onChange={(e) =>
                      setNewItemForm({ ...newItemForm, refPrice: e.target.value })
                    }
                    className="input-field text-sm"
                  />
                </div>
                {newItemError && (
                  <div className="flex items-center gap-2 text-danger-600 bg-danger-50 p-2 rounded-lg text-xs">
                    <AlertCircle size={14} />
                    <span>{newItemError}</span>
                  </div>
                )}
              </div>
              <div className="flex gap-3 mt-4">
                <button
                  onClick={() => {
                    setResolveRow(null);
                    setResolveType(null);
                  }}
                  className="btn-secondary flex-1 text-sm"
                >
                  取消
                </button>
                <button
                  onClick={handleAddItem}
                  disabled={saving}
                  className="btn-primary flex-1 text-sm disabled:opacity-50"
                >
                  {saving ? '保存中...' : '新增并匹配'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ===== 仓库映射弹窗 ===== */}
        {resolveRow && resolveType === 'warehouse' && (
          <div
            className="fixed inset-0 bg-black/30 flex items-center justify-center z-[60]"
            onClick={() => {
              setResolveRow(null);
              setResolveType(null);
            }}
          >
            <div
              className="bg-white rounded-xl shadow-xl p-5 w-full max-w-md max-h-[70vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-base font-semibold text-gray-800 mb-2">映射仓库</h3>
              <p className="text-xs text-gray-500 mb-3">
                仓库「{resolveRow.warehouse}」未识别，请选择对应仓库
              </p>
              <div className="space-y-1.5 overflow-y-auto flex-1">
                {warehouses.map((w) => (
                  <button
                    key={w.id}
                    onClick={() => handleMapWarehouse(w.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg hover:border-primary-400 hover:bg-primary-50 transition-colors text-left text-sm"
                  >
                    <WarehouseIcon size={16} className="text-primary-500" />
                    <span className="font-medium text-gray-800">{w.name}</span>
                    {w.department_name && (
                      <span className="text-xs text-gray-400">({w.department_name})</span>
                    )}
                  </button>
                ))}
              </div>
              <button
                onClick={() => {
                  setResolveRow(null);
                  setResolveType(null);
                }}
                className="mt-3 w-full btn-secondary text-sm"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* ===== 供应商映射弹窗 ===== */}
        {resolveRow && resolveType === 'supplier' && (
          <div
            className="fixed inset-0 bg-black/30 flex items-center justify-center z-[60]"
            onClick={() => {
              setResolveRow(null);
              setResolveType(null);
            }}
          >
            <div
              className="bg-white rounded-xl shadow-xl p-5 w-full max-w-md max-h-[70vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-base font-semibold text-gray-800 mb-2 flex items-center gap-2">
                <Truck size={16} className="text-purple-500" />
                映射供应商
              </h3>
              <p className="text-xs text-gray-500 mb-3">
                供应商「{resolveRow.supplier}」未识别，请选择已有供应商或新增
              </p>
              <div className="space-y-1.5 overflow-y-auto flex-1 mb-3 max-h-48">
                {localSuppliers.length === 0 ? (
                  <p className="text-center text-xs text-gray-400 py-4">暂无供应商，请新增</p>
                ) : (
                  localSuppliers.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => handleMapSupplier(s.id)}
                      className="w-full flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg hover:border-purple-400 hover:bg-purple-50 transition-colors text-left text-sm"
                    >
                      <Truck size={16} className="text-purple-500" />
                      <span className="font-medium text-gray-800">{s.name}</span>
                      {s.prepay_balance != null && Number(s.prepay_balance) > 0 && (
                        <span className="text-xs text-gray-400">
                          (余额¥{Number(s.prepay_balance).toFixed(2)})
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
              <div className="border-t border-gray-100 pt-3">
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  新增供应商
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newSupplierName}
                    onChange={(e) => setNewSupplierName(e.target.value)}
                    placeholder="输入新供应商名称"
                    className="input-field text-sm flex-1"
                    autoFocus
                  />
                  <button
                    onClick={handleAddSupplier}
                    disabled={saving || !newSupplierName.trim()}
                    className="btn-primary text-sm px-4 disabled:opacity-50"
                  >
                    {saving ? '...' : '新增'}
                  </button>
                </div>
                {newSupplierError && (
                  <div className="flex items-center gap-2 text-danger-600 mt-2 text-xs">
                    <AlertCircle size={14} />
                    <span>{newSupplierError}</span>
                  </div>
                )}
              </div>
              <button
                onClick={() => {
                  setResolveRow(null);
                  setResolveType(null);
                }}
                className="mt-3 w-full btn-secondary text-sm"
              >
                取消
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
