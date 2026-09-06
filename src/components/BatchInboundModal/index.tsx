import { useState, useMemo, useEffect } from 'react';
import {
  X,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  ClipboardList,
  Package,
  Trash2,
  Plus,
  AlertTriangle,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';

// ====== 最小化类型定义（避免循环依赖） ======
interface Wh {
  warehouse_id: string;
  warehouse_name: string;
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
  unit?: string;
  reference_price?: number;
  category_id?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  warehouses: Wh[];
}

// 草稿行状态：matched 可入库，item_missing/item_similar 需处理，error 不可入库
type RowStatus = 'matched' | 'item_missing' | 'item_similar' | 'error';

interface DraftRow {
  id: string;
  rawText: string;
  rowIndex: number;
  name: string;
  unit: string;
  pastedUnit?: string; // 粘贴时解析出的原始单位（用于提示是否发生了单位统一）
  quantity: string;
  unitPrice: string;
  reason: string;
  status: RowStatus;
  matchedItem?: WhItem;
  similarCandidates?: WhItem[];
  error?: string;
}

const genId = () => Math.random().toString(36).substring(2, 11);

// 清洗数字字符串：移除千分位逗号、全角逗号、空白、货币符号等
function cleanNumberStr(val: string): string {
  if (!val) return '';
  return String(val).replace(/[,，\s¥￥$]/g, '').trim();
}

// 扁平化分类树
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

// 解析单行（共用逻辑）
function parseLine(line: string, idx: number, allItems: WhItem[]): DraftRow {
  // 优先 Tab，其次逗号，最后空白
  let cols = line.split('\t');
  if (cols.length < 2) cols = line.split(/[,，]/);
  if (cols.length < 2) cols = line.split(/\s+/);
  cols = cols.map((c) => c.trim());

  if (cols.length < 1 || !cols[0]) {
    return {
      id: genId(),
      rawText: line,
      rowIndex: idx,
      name: '',
      unit: '',
      quantity: '',
      unitPrice: '',
      reason: '',
      status: 'error',
      error: '格式不正确，至少需要物资名称',
    };
  }

  const name = cols[0];
  let unit = '';
  let quantity = '1';
  let unitPrice = '0';
  let reason = '';

  if (cols.length <= 3) {
    // 简写格式：名称 [数量] 单价
    if (cols.length === 2) {
      quantity = cols[1];
    } else if (cols.length === 3) {
      quantity = cols[1];
      unitPrice = cols[2];
    }
  } else {
    // 完整格式：名称 | 单位 | 数量 | 单价 | 理由
    unit = cols[1] || '';
    quantity = cols[2] || '1';
    unitPrice = cols[3] || '0';
    reason = cols[4] || '';
  }

  // 本地精确匹配
  const matchedItem = allItems.find((it) => it.name === name);
  let status: RowStatus = 'matched';
  if (!matchedItem) status = 'item_missing';

  // 记录粘贴时的原始单位（用于后续提示是否发生了单位统一）
  const pastedUnit = unit;

  // 匹配到物资时：单位强制以物品主数据为准，粘贴单位仅作参考
  if (matchedItem) {
    if (matchedItem.unit) unit = matchedItem.unit;
    if ((!unitPrice || unitPrice === '0') && matchedItem.reference_price != null) {
      unitPrice = String(matchedItem.reference_price);
    }
  }

  return {
    id: genId(),
    rawText: line,
    rowIndex: idx,
    name,
    unit,
    pastedUnit,
    quantity,
    unitPrice,
    reason,
    status,
    matchedItem,
  };
}

export default function BatchInboundModal({ open, onClose, onSuccess, warehouses }: Props) {
  const { user } = useAuthStore();
  const [warehouseId, setWarehouseId] = useState<string>('');
  const [pasteText, setPasteText] = useState('');
  const [draftRows, setDraftRows] = useState<DraftRow[]>([]);
  const [step, setStep] = useState<'paste' | 'draft'>('paste');
  const [allItems, setAllItems] = useState<WhItem[]>([]);
  const [categoryTree, setCategoryTree] = useState<CatNode[]>([]);
  const [parsing, setParsing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitResult, setSubmitResult] = useState<{
    success_count: number;
    failed_count: number;
    failed: { line: number; item_name: string; error: string }[];
  } | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  // 新增物资弹窗
  const [resolveRow, setResolveRow] = useState<DraftRow | null>(null);
  const [newItemForm, setNewItemForm] = useState({
    name: '',
    categoryId: '',
    unit: '',
    refPrice: '',
  });
  const [newItemError, setNewItemError] = useState('');
  const [saving, setSaving] = useState(false);

  const flatCats = useMemo(() => flattenCats(categoryTree), [categoryTree]);

  // 打开时初始化
  useEffect(() => {
    if (open) {
      setPasteText('');
      setDraftRows([]);
      setStep('paste');
      setWarehouseId('');
      setSubmitError('');
      setSubmitResult(null);
      setShowConfirm(false);
      setResolveRow(null);
      Promise.all([
        api.get<WhItem[]>('/warehouses/items').catch(() => []),
        api.get<CatNode[]>('/warehouses/categories/tree').catch(() => []),
      ]).then(([items, tree]) => {
        setAllItems(items || []);
        setCategoryTree(tree || []);
      });
    }
  }, [open]);

  // ===== 解析粘贴文本 =====
  const parseText = async () => {
    if (!warehouseId) {
      setSubmitError('请先选择入库仓库');
      return;
    }
    const lines = pasteText.trim().split('\n').filter((l) => l.trim());
    const rows: DraftRow[] = [];
    const needSearchIdx: number[] = [];

    lines.forEach((line, idx) => {
      // 跳过表头
      if (idx === 0) {
        const hits = (line.match(/物资名称|单位|数量|单价|理由/g) || []).length;
        if (hits >= 2) return;
      }
      const row = parseLine(line, idx, allItems);
      if (row.status === 'item_missing') needSearchIdx.push(rows.length);
      rows.push(row);
    });

    // 第二遍：本地未匹配的调用相似度查询
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
              row.matchedItem = result.exact;
              if (!row.unit && result.exact.unit) row.unit = result.exact.unit;
              if ((!row.unitPrice || row.unitPrice === '0') && result.exact.reference_price != null) {
                row.unitPrice = String(result.exact.reference_price);
              }
              row.status = 'matched';
            } else if (result.candidates && result.candidates.length > 0) {
              row.status = 'item_similar';
              row.similarCandidates = result.candidates;
            } else {
              row.status = 'item_missing';
            }
          } catch {
            row.status = 'item_missing';
          }
        }),
      );
      setParsing(false);
    }

    setDraftRows(rows);
    setStep('draft');
    setSubmitError('');
    setSubmitResult(null);
  };

  // ===== 统计（草稿模式核心） =====
  const stats = useMemo(() => {
    const valid = draftRows.filter((r) => r.status === 'matched');
    const needResolve = draftRows.filter((r) => r.status !== 'matched' && r.status !== 'error').length;
    const errorCount = draftRows.filter((r) => r.status === 'error').length;
    let totalQty = 0;
    let totalAmount = 0;
    valid.forEach((r) => {
      const q = Number(cleanNumberStr(r.quantity));
      const p = Number(cleanNumberStr(r.unitPrice));
      if (!isNaN(q)) totalQty += q;
      if (!isNaN(q) && !isNaN(p)) totalAmount += q * p;
    });
    return {
      matchedCount: valid.length,
      needResolve,
      errorCount,
      totalQty,
      totalAmount,
      totalKinds: valid.length,
    };
  }, [draftRows]);

  // ===== 行编辑 =====
  const updateRow = (id: string, patch: Partial<DraftRow>) => {
    setDraftRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const removeRow = (id: string) => {
    setDraftRows((prev) => prev.filter((r) => r.id !== id));
  };

  // 手动新增一行（从已有物资选择）
  const addManualRow = () => {
    const newRow: DraftRow = {
      id: genId(),
      rawText: '',
      rowIndex: draftRows.length,
      name: '',
      unit: '',
      quantity: '1',
      unitPrice: '0',
      reason: '',
      status: 'item_missing',
    };
    setDraftRows((prev) => [...prev, newRow]);
  };

  // 手动选择物资后填入
  const handleManualPick = (rowId: string, itemId: string) => {
    const item = allItems.find((it) => it.id === itemId);
    if (!item) return;
    setDraftRows((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        // 方案A：映射已有物品后，单位强制以物品主数据为准，避免库存单位混乱
        const newUnit = item.unit || r.unit || '';
        const newPrice =
          r.unitPrice && r.unitPrice !== '0'
            ? r.unitPrice
            : item.reference_price != null
            ? String(item.reference_price)
            : '0';
        return {
          ...r,
          status: 'matched' as RowStatus,
          matchedItem: item,
          name: item.name,
          unit: newUnit,
          unitPrice: newPrice,
          similarCandidates: undefined,
        };
      }),
    );
  };

  // ===== 新增物资到物资库 =====
  const handleResolveItem = (row: DraftRow) => {
    setResolveRow(row);
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
      setAllItems((prev) => [created, ...prev]);
      setDraftRows((prev) =>
        prev.map((r) => {
          if (r.id !== resolveRow?.id) return r;
          // 新增物资后，单位以用户在表单确认的为准（默认是粘贴单位，用户可改）
          const newUnit = created.unit || r.unit || '';
          const newPrice =
            r.unitPrice && r.unitPrice !== '0'
              ? r.unitPrice
              : created.reference_price != null
              ? String(created.reference_price)
              : '0';
          return {
            ...r,
            status: 'matched' as RowStatus,
            matchedItem: created,
            name: created.name,
            unit: newUnit,
            unitPrice: newPrice,
          };
        }),
      );
      setResolveRow(null);
    } catch (err: any) {
      if (err.status === 409 || err.code === 409) {
        setNewItemError('已存在同名物资，请关闭后使用"映射物资"选择已有物资');
      } else {
        setNewItemError(err.message || '新增物资失败');
      }
    } finally {
      setSaving(false);
    }
  };

  // ===== 选择相似候选物资 =====
  const handlePickSimilar = (row: DraftRow, item: WhItem) => {
    setDraftRows((prev) =>
      prev.map((r) => {
        if (r.id !== row.id) return r;
        // 方案A：映射已有物品后，单位强制以物品主数据为准，避免库存单位混乱
        const newUnit = item.unit || r.unit || '';
        const newPrice =
          r.unitPrice && r.unitPrice !== '0'
            ? r.unitPrice
            : item.reference_price != null
            ? String(item.reference_price)
            : '0';
        return {
          ...r,
          status: 'matched' as RowStatus,
          matchedItem: item,
          name: item.name,
          unit: newUnit,
          unitPrice: newPrice,
          similarCandidates: undefined,
        };
      }),
    );
  };

  // ===== 提交入库 =====
  const handleConfirm = async () => {
    if (!warehouseId) {
      setSubmitError('请选择入库仓库');
      return;
    }
    const validRows = draftRows.filter((r) => r.status === 'matched' && r.matchedItem);
    if (validRows.length === 0) {
      setSubmitError('没有可导入的有效数据');
      return;
    }

    setSubmitting(true);
    setSubmitError('');
    try {
      const result = await api.post<{
        success_count: number;
        failed_count: number;
        failed: { line: number; item_name: string; error: string }[];
      }>('/stock-movements/batch-inbound', {
        warehouse_id: warehouseId,
        operator_id: user?.id,
        operator_name: user?.name,
        items: validRows.map((r) => ({
          item_id: r.matchedItem!.id,
          item_name: r.name,
          quantity: Number(cleanNumberStr(r.quantity)),
          unit: r.unit,
          unit_price: r.unitPrice ? Number(cleanNumberStr(r.unitPrice)) : null,
          reason: r.reason,
        })),
      });
      setSubmitResult({
        success_count: result.success_count,
        failed_count: result.failed_count,
        failed: result.failed || [],
      });
      // 全部成功则关闭并刷新
      if (result.failed_count === 0) {
        onSuccess();
        onClose();
      } else {
        // 部分成功也刷新列表，但保留草稿让用户处理失败行
        onSuccess();
        // 移除已成功的行（按 item_id + quantity 匹配移除）
        const failedKeys = new Set(
          (result.failed || []).map((f) => `${f.item_name}`),
        );
        setDraftRows((prev) =>
          prev.filter((r) => {
            if (r.status !== 'matched') return true; // 未处理的行保留
            return failedKeys.has(r.name);
          }),
        );
        setShowConfirm(false);
      }
    } catch (err: any) {
      setSubmitError(err.message || '批量入库失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  const selectedWh = warehouses.find((w) => w.warehouse_id === warehouseId);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={() => !submitting && onClose()}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-success-100 rounded-xl flex items-center justify-center">
              <ClipboardList size={18} className="text-success-600" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-800">批量粘贴入库</h2>
              <p className="text-xs text-gray-500">
                {step === 'paste' ? '从 Excel/WPS 复制数据，快速入库' : '草稿预览 · 确认无误后写入数据库'}
              </p>
            </div>
          </div>
          <button
            onClick={() => !submitting && onClose()}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
            disabled={submitting}
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {/* 仓库选择（始终展示） */}
        <div className="px-6 py-3 border-b border-gray-100 bg-gray-50/50">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
              入库仓库 <span className="text-danger-500">*</span>
            </label>
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              disabled={submitting || step === 'draft'}
              className="input-field flex-1 disabled:bg-gray-100"
            >
              <option value="">请选择仓库</option>
              {warehouses.map((w) => (
                <option key={w.warehouse_id} value={w.warehouse_id}>
                  {w.warehouse_name}
                </option>
              ))}
            </select>
          </div>
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
                  '格式：物资名称 单位 数量 单价 理由\n例如：\n洗洁精5L 桶 10 35.00 日常补充\n灯泡LED12W 个 20 8.50 月度补充\n\n简写（2列）：物资名称 数量\n简写（3列）：物资名称 数量 单价\n\n支持千分位逗号（如 2,000.00）'
                }
                className="w-full h-56 border border-gray-200 rounded-lg px-4 py-3 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-success-500/20 focus:border-success-500 resize-none"
              />
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
              <p>
                <strong>格式说明：</strong>每行一条，用 Tab（Excel 复制自带）、空格或逗号分隔
              </p>
              <p className="mt-1">
                列顺序：
                <code className="bg-amber-100 px-1 rounded">物资名称 | 单位 | 数量 | 单价 | 理由</code>
              </p>
              <p className="mt-1">
                简写模式（3列）：<code className="bg-amber-100 px-1 rounded">物资名称 | 数量 | 单价</code>
                ，单位/理由留空
              </p>
              <p className="mt-1">
                ✅ 支持 Excel 带千分位逗号的数字（如 <code className="bg-amber-100 px-1 rounded">2,000.00</code>）
              </p>
              <p className="mt-1">
                解析后进入<strong>草稿预览</strong>，可编辑/删除/新增，确认无误后再写入数据库
              </p>
            </div>
          </div>
        ) : (
          /* ===== 步骤2：草稿预览 ===== */
          <div className="flex-1 overflow-y-auto p-4">
            {/* 统计卡 */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
              <div className="bg-green-50 border border-green-200 rounded-lg p-2.5">
                <div className="text-xs text-green-600">已匹配</div>
                <div className="text-lg font-bold text-green-700">{stats.matchedCount}</div>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-2.5">
                <div className="text-xs text-blue-600">物资种数</div>
                <div className="text-lg font-bold text-blue-700">{stats.totalKinds}</div>
              </div>
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-2.5">
                <div className="text-xs text-purple-600">数量合计</div>
                <div className="text-lg font-bold text-purple-700">{stats.totalQty}</div>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                <div className="text-xs text-amber-600">入库总额</div>
                <div className="text-lg font-bold text-amber-700">¥{stats.totalAmount.toFixed(2)}</div>
              </div>
              <div className={`border rounded-lg p-2.5 ${stats.needResolve + stats.errorCount > 0 ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
                <div className="text-xs text-gray-600">需处理/错误</div>
                <div className={`text-lg font-bold ${stats.needResolve + stats.errorCount > 0 ? 'text-red-700' : 'text-gray-700'}`}>
                  {stats.needResolve + stats.errorCount}
                </div>
              </div>
            </div>

            {/* 提交结果提示 */}
            {submitResult && (
              <div
                className={`mb-3 p-3 rounded-lg text-xs ${
                  submitResult.failed_count > 0
                    ? 'bg-amber-50 border border-amber-200 text-amber-800'
                    : 'bg-green-50 border border-green-200 text-green-800'
                }`}
              >
                <div className="flex items-center gap-2 font-medium">
                  <CheckCircle size={14} />
                  成功 {submitResult.success_count} 条
                  {submitResult.failed_count > 0 && (
                    <>
                      <AlertCircle size={14} className="ml-2" />
                      失败 {submitResult.failed_count} 条（失败行已保留在草稿，可修改后再次提交）
                    </>
                  )}
                </div>
                {submitResult.failed.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {submitResult.failed.map((f, i) => (
                      <li key={i}>
                        第{f.line}行 {f.item_name || '-'}：{f.error}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* 草稿列表（每行可编辑） */}
            <div className="space-y-2">
              {draftRows.map((row, idx) => (
                <div
                  key={row.id}
                  className={`p-3 rounded-lg border transition-all ${
                    row.status === 'matched'
                      ? 'border-green-200 bg-green-50/30'
                      : row.status === 'error'
                      ? 'border-red-200 bg-red-50/30'
                      : 'border-amber-200 bg-amber-50/30'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-xs text-gray-400 mt-2 flex-shrink-0 w-6">#{idx + 1}</span>
                    <div className="flex-1 grid grid-cols-12 gap-2">
                      {/* 物资名称 */}
                      <div className="col-span-12 md:col-span-4">
                        <label className="block text-[10px] text-gray-500 mb-0.5">物资名称</label>
                        {row.status === 'matched' ? (
                          <input
                            type="text"
                            value={row.name}
                            onChange={(e) => updateRow(row.id, { name: e.target.value })}
                            className="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-primary-400"
                          />
                        ) : row.status === 'item_similar' ? (
                          <div className="space-y-1">
                            <input
                              type="text"
                              value={row.name}
                              onChange={(e) => updateRow(row.id, { name: e.target.value })}
                              className="w-full text-xs border border-amber-300 rounded px-2 py-1 focus:outline-none focus:border-amber-400"
                            />
                            <select
                              className="w-full text-xs border border-amber-300 rounded px-1.5 py-1 bg-white"
                              onChange={(e) => {
                                const item = row.similarCandidates?.find((c) => c.id === e.target.value);
                                if (item) handlePickSimilar(row, item);
                              }}
                              value=""
                            >
                              <option value="">选择相似物资...</option>
                              {row.similarCandidates?.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name} ({c.unit || '-'})
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : row.status === 'item_missing' ? (
                          <div className="space-y-1">
                            <input
                              type="text"
                              value={row.name}
                              onChange={(e) => updateRow(row.id, { name: e.target.value })}
                              className="w-full text-xs border border-amber-300 rounded px-2 py-1 focus:outline-none focus:border-amber-400"
                            />
                            <select
                              className="w-full text-xs border border-amber-300 rounded px-1.5 py-1 bg-white"
                              onChange={(e) => {
                                if (e.target.value) handleManualPick(row.id, e.target.value);
                              }}
                              value=""
                            >
                              <option value="">映射已有物资...</option>
                              {allItems.slice(0, 100).map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name} ({c.unit || '-'})
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <div className="text-xs text-red-600 py-1">{row.error || '错误'}</div>
                        )}
                      </div>

                      {/* 单位 */}
                      <div className="col-span-3 md:col-span-2">
                        <label className="block text-[10px] text-gray-500 mb-0.5">单位</label>
                        <input
                          type="text"
                          value={row.unit}
                          onChange={(e) => updateRow(row.id, { unit: e.target.value })}
                          placeholder="如 个"
                          className="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-primary-400"
                        />
                        {row.pastedUnit && row.pastedUnit !== row.unit && (
                          <p className="text-[10px] text-amber-600 mt-0.5 leading-tight">
                            已统一为物品标准单位「{row.unit}」（粘贴：{row.pastedUnit}）
                          </p>
                        )}
                      </div>

                      {/* 数量 */}
                      <div className="col-span-3 md:col-span-2">
                        <label className="block text-[10px] text-gray-500 mb-0.5">数量</label>
                        <input
                          type="text"
                          value={row.quantity}
                          onChange={(e) => updateRow(row.id, { quantity: e.target.value })}
                          placeholder="如 10"
                          className="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-primary-400"
                        />
                      </div>

                      {/* 单价 */}
                      <div className="col-span-3 md:col-span-2">
                        <label className="block text-[10px] text-gray-500 mb-0.5">单价</label>
                        <input
                          type="text"
                          value={row.unitPrice}
                          onChange={(e) => updateRow(row.id, { unitPrice: e.target.value })}
                          placeholder="如 35.00"
                          className="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-primary-400"
                        />
                      </div>

                      {/* 小计 */}
                      <div className="col-span-3 md:col-span-2">
                        <label className="block text-[10px] text-gray-500 mb-0.5">小计</label>
                        <div className="text-xs font-semibold text-gray-700 py-1">
                          ¥
                          {(() => {
                            const q = Number(cleanNumberStr(row.quantity));
                            const p = Number(cleanNumberStr(row.unitPrice));
                            if (isNaN(q) || isNaN(p)) return '-';
                            return (q * p).toFixed(2);
                          })()}
                        </div>
                      </div>

                      {/* 理由（整行） */}
                      <div className="col-span-9 md:col-span-10">
                        <label className="block text-[10px] text-gray-500 mb-0.5">理由</label>
                        <input
                          type="text"
                          value={row.reason}
                          onChange={(e) => updateRow(row.id, { reason: e.target.value })}
                          placeholder="如 日常补充"
                          className="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-primary-400"
                        />
                      </div>
                    </div>

                    {/* 操作按钮 */}
                    <div className="flex flex-col gap-1 flex-shrink-0">
                      {row.status === 'item_missing' && (
                        <button
                          onClick={() => handleResolveItem(row)}
                          className="text-xs bg-primary-500 text-white px-2 py-1 rounded hover:bg-primary-600 whitespace-nowrap"
                          title="新增到物资库"
                        >
                          新增物资
                        </button>
                      )}
                      {row.status === 'item_similar' && (
                        <button
                          onClick={() => handleResolveItem(row)}
                          className="text-xs bg-primary-500 text-white px-2 py-1 rounded hover:bg-primary-600 whitespace-nowrap"
                          title="新增到物资库"
                        >
                          新增物资
                        </button>
                      )}
                      <button
                        onClick={() => removeRow(row.id)}
                        className="text-xs bg-red-50 text-red-600 px-2 py-1 rounded hover:bg-red-100 whitespace-nowrap flex items-center gap-1 justify-center"
                        title="删除该行"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              {/* 手动新增一行 */}
              <button
                onClick={addManualRow}
                className="w-full py-2 border-2 border-dashed border-gray-200 rounded-lg text-xs text-gray-500 hover:border-primary-300 hover:text-primary-600 hover:bg-primary-50/30 flex items-center justify-center gap-1"
              >
                <Plus size={14} /> 手动添加一行
              </button>
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
                disabled={!pasteText.trim() || parsing || !warehouseId}
                className="btn-primary flex-1 bg-success-500 hover:bg-success-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {parsing ? '解析中...' : '解析预览'}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setStep('paste')}
                disabled={submitting}
                className="btn-secondary flex items-center gap-1 disabled:opacity-50"
              >
                <RefreshCw size={14} /> 重新粘贴
              </button>
              <button
                onClick={onClose}
                disabled={submitting}
                className="btn-secondary flex-1 disabled:opacity-50"
              >
                {submitResult ? '关闭' : '取消'}
              </button>
              <button
                onClick={() => setShowConfirm(true)}
                disabled={stats.matchedCount === 0 || submitting}
                className="btn-primary flex-1 bg-success-500 hover:bg-success-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                确认入库 ({stats.matchedCount} 条)
              </button>
            </>
          )}
        </div>

        {submitError && (
          <div className="mx-6 mb-3 flex items-center gap-2 text-danger-600 bg-danger-50 p-2.5 rounded-lg text-xs">
            <AlertCircle size={14} />
            <span>{submitError}</span>
          </div>
        )}

        {/* ===== 二次确认弹窗 ===== */}
        {showConfirm && (
          <div
            className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4"
            onClick={() => !submitting && setShowConfirm(false)}
          >
            <div
              className="bg-white rounded-xl shadow-xl p-5 w-full max-w-md"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle size={20} className="text-amber-500" />
                <h3 className="text-base font-semibold text-gray-800">确认入库</h3>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 mb-3 text-sm">
                <div className="flex justify-between mb-1">
                  <span className="text-gray-500">入库仓库：</span>
                  <span className="font-medium text-gray-800">{selectedWh?.warehouse_name || '-'}</span>
                </div>
                <div className="flex justify-between mb-1">
                  <span className="text-gray-500">物资种数：</span>
                  <span className="font-medium text-gray-800">{stats.totalKinds} 种</span>
                </div>
                <div className="flex justify-between mb-1">
                  <span className="text-gray-500">数量合计：</span>
                  <span className="font-medium text-gray-800">{stats.totalQty}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">入库总额：</span>
                  <span className="font-bold text-amber-700">¥{stats.totalAmount.toFixed(2)}</span>
                </div>
              </div>
              <p className="text-xs text-gray-500 mb-4">
                确认后将写入数据库并更新库存，无法撤销。请再次核对金额是否正确。
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowConfirm(false)}
                  disabled={submitting}
                  className="btn-secondary flex-1 text-sm disabled:opacity-50"
                >
                  再核对一下
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={submitting}
                  className="btn-primary flex-1 text-sm bg-success-500 hover:bg-success-600 disabled:opacity-50"
                >
                  {submitting ? '提交中...' : '确认入库'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ===== 新增物资弹窗 ===== */}
        {resolveRow && (
          <div
            className="fixed inset-0 bg-black/30 flex items-center justify-center z-[60]"
            onClick={() => {
              setResolveRow(null);
              setNewItemError('');
            }}
          >
            <div
              className="bg-white rounded-xl shadow-xl p-5 w-full max-w-md"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-base font-semibold text-gray-800 mb-3 flex items-center gap-2">
                <Package size={16} className="text-primary-500" />
                新增物资
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">物资名称</label>
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
                    onChange={(e) => setNewItemForm({ ...newItemForm, categoryId: e.target.value })}
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
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">参考单价</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={newItemForm.refPrice}
                      onChange={(e) => setNewItemForm({ ...newItemForm, refPrice: e.target.value })}
                      className="input-field text-sm"
                    />
                  </div>
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
                    setNewItemError('');
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
      </div>
    </div>
  );
}
