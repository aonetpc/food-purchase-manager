import { useState, useMemo, useEffect } from 'react';
import {
  X,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Warehouse as WarehouseIcon,
  ClipboardList,
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

// 导入结果行
export interface PasteLine {
  item_id: string;
  item_name: string;
  spec: string;
  unit: string;
  quantity: string;
  unit_price: string;
  warehouse_id: string;
  warehouse_name: string;
  reason: string;
}

// 解析行状态
type RowStatus = 'matched' | 'item_missing' | 'warehouse_missing' | 'error';

interface ParsedRow {
  id: string;
  rawText: string;
  rowIndex: number;
  name: string;
  spec: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  warehouse: string;
  reason: string;
  status: RowStatus;
  matchedItem?: WhItem;
  matchedWarehouse?: Wh;
  error?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (lines: PasteLine[]) => void;
  onItemCreated?: (item: WhItem) => void;
  warehouses: Wh[];
  categoryTree: CatNode[];
  items: WhItem[];
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
  warehouses,
  categoryTree,
  items: initialItems,
}: Props) {
  const [pasteText, setPasteText] = useState('');
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [step, setStep] = useState<'paste' | 'preview'>('paste');
  const [localItems, setLocalItems] = useState<WhItem[]>(initialItems);

  // 新增物资 / 仓库映射 弹窗
  const [resolveRow, setResolveRow] = useState<ParsedRow | null>(null);
  const [resolveType, setResolveType] = useState<'item' | 'warehouse' | null>(null);
  const [newItemForm, setNewItemForm] = useState({
    name: '',
    categoryId: '',
    spec: '',
    unit: '',
    refPrice: '',
  });
  const [newItemError, setNewItemError] = useState('');
  const [saving, setSaving] = useState(false);

  const flatCats = useMemo(() => flattenCats(categoryTree), [categoryTree]);

  useEffect(() => {
    if (open) {
      setPasteText('');
      setParsedRows([]);
      setStep('paste');
      setLocalItems(initialItems);
      setResolveRow(null);
      setResolveType(null);
    }
  }, [open, initialItems]);

  // ===== 解析粘贴文本 =====
  const parseText = () => {
    const lines = pasteText.trim().split('\n').filter((l) => l.trim());
    const rows: ParsedRow[] = [];

    lines.forEach((line, idx) => {
      // 优先 Tab（保留 Excel 空列），其次逗号，最后空白
      let cols = line.split('\t');
      if (cols.length < 2) cols = line.split(/[,，]/);
      if (cols.length < 2) cols = line.split(/\s+/);
      cols = cols.map((c) => c.trim());

      // 跳过表头（第一行且关键词命中≥2个）
      if (idx === 0) {
        const hits = (line.match(/物资名称|规格|单位|数量|单价|仓库|理由/g) || []).length;
        if (hits >= 2) return;
      }

      if (cols.length < 1 || !cols[0]) {
        rows.push({
          id: genId(),
          rawText: line,
          rowIndex: idx,
          name: '',
          spec: '',
          unit: '',
          quantity: '',
          unitPrice: '',
          warehouse: '',
          reason: '',
          status: 'error',
          error: '格式不正确，至少需要物资名称',
        });
        return;
      }

      const name = cols[0];
      let spec = '';
      let unit = '';
      let quantity = '1';
      let unitPrice = '0';
      let warehouse = '';
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
        // 完整格式：名称 | 规格 | 单位 | 数量 | 单价 | 仓库 | 理由
        spec = cols[1] || '';
        unit = cols[2] || '';
        quantity = cols[3] || '1';
        unitPrice = cols[4] || '0';
        warehouse = cols[5] || '';
        reason = cols[6] || '';
      }

      // 匹配物资库（先精确名称+规格，回退只按名称）
      const matchedItem =
        localItems.find((it) => it.name === name && (!spec || it.spec === spec)) ||
        localItems.find((it) => it.name === name);

      // 匹配仓库
      let matchedWarehouse: Wh | undefined;
      if (warehouse) {
        matchedWarehouse = warehouses.find((w) => w.name === warehouse);
      }

      let status: RowStatus = 'matched';
      if (!matchedItem) {
        status = 'item_missing';
      } else if (warehouse && !matchedWarehouse) {
        status = 'warehouse_missing';
      }

      // 匹配到物资时补全规格/单位/参考价
      if (matchedItem) {
        if (!spec && matchedItem.spec) spec = matchedItem.spec;
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
        spec,
        unit,
        quantity,
        unitPrice,
        warehouse,
        reason,
        status,
        matchedItem,
        matchedWarehouse,
      });
    });

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
      spec: row.spec,
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
        spec: newItemForm.spec.trim() || null,
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
          const newSpec = r.spec || created.spec || '';
          const newUnit = r.unit || created.unit || '';
          const newPrice =
            r.unitPrice && r.unitPrice !== '0'
              ? r.unitPrice
              : created.reference_price != null
              ? String(created.reference_price)
              : '0';
          let newStatus: RowStatus = 'matched';
          if (r.warehouse && !r.matchedWarehouse) newStatus = 'warehouse_missing';
          return {
            ...r,
            status: newStatus,
            matchedItem: created,
            spec: newSpec,
            unit: newUnit,
            unitPrice: newPrice,
          };
        }),
      );
      setResolveRow(null);
      setResolveType(null);
    } catch (err: any) {
      setNewItemError(err.message || '新增物资失败');
    } finally {
      setSaving(false);
    }
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
      prev.map((r) =>
        r.id === resolveRow.id
          ? { ...r, status: 'matched', matchedWarehouse: wh, warehouse: wh.name }
          : r,
      ),
    );
    setResolveRow(null);
    setResolveType(null);
  };

  // ===== 确认导入 =====
  const handleConfirm = () => {
    const validRows = parsedRows.filter((r) => r.status === 'matched');
    const lines: PasteLine[] = validRows.map((r) => ({
      item_id: r.matchedItem?.id || '',
      item_name: r.name,
      spec: r.spec,
      unit: r.unit,
      quantity: r.quantity,
      unit_price: r.unitPrice,
      warehouse_id: r.matchedWarehouse?.id || '',
      warehouse_name: r.matchedWarehouse?.name || r.warehouse,
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
                  '格式：物资名称 规格 单位 数量 单价 仓库名称 采购理由\n例如：\n洗洁精 5L 桶 10 35.00 厨房仓 日常补充\n灯泡 LED12W 个 20 8.50 总仓\n\n简写（3列）：物资名称 数量 单价\n白菜 2 5.00'
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
                  物资名称 | 规格 | 单位 | 数量 | 单价 | 仓库名称 | 采购理由
                </code>
              </p>
              <p className="mt-1">
                简写模式（3列）：
                <code className="bg-amber-100 px-1 rounded">物资名称 | 数量 | 单价</code>
                ，规格/单位/仓库留空
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
                          {row.spec && ` · ${row.spec}`}
                          {row.warehouse && ` · ${row.warehouse}`}
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
                      {row.status === 'warehouse_missing' && (
                        <button
                          onClick={() => handleResolveWarehouse(row)}
                          className="text-xs bg-blue-500 text-white px-2.5 py-1 rounded hover:bg-blue-600"
                        >
                          映射仓库
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
                disabled={!pasteText.trim()}
                className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                解析预览
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
                    <label className="block text-xs font-medium text-gray-700 mb-1">规格</label>
                    <input
                      type="text"
                      value={newItemForm.spec}
                      onChange={(e) => setNewItemForm({ ...newItemForm, spec: e.target.value })}
                      placeholder="如 500ml"
                      className="input-field text-sm"
                    />
                  </div>
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
      </div>
    </div>
  );
}
