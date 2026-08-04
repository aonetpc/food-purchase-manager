import { useState, useMemo, useEffect } from 'react';
import {
  X,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  ClipboardList,
  Package,
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

// 解析行状态
type RowStatus = 'matched' | 'item_missing' | 'item_similar' | 'error';

interface ParsedRow {
  id: string;
  rawText: string;
  rowIndex: number;
  name: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  reason: string;
  status: RowStatus;
  matchedItem?: WhItem;
  similarCandidates?: WhItem[];
  error?: string;
}

const genId = () => Math.random().toString(36).substring(2, 11);

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

export default function BatchInboundModal({ open, onClose, onSuccess, warehouses }: Props) {
  const { user } = useAuthStore();
  const [warehouseId, setWarehouseId] = useState<string>('');
  const [pasteText, setPasteText] = useState('');
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [step, setStep] = useState<'paste' | 'preview'>('paste');
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

  // 新增物资弹窗
  const [resolveRow, setResolveRow] = useState<ParsedRow | null>(null);
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
      setParsedRows([]);
      setStep('paste');
      setWarehouseId('');
      setSubmitError('');
      setSubmitResult(null);
      setResolveRow(null);
      // 加载所有物资和分类树
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
    const rows: ParsedRow[] = [];
    const needSearchIdx: number[] = [];

    lines.forEach((line, idx) => {
      // 优先 Tab，其次逗号，最后空白
      let cols = line.split('\t');
      if (cols.length < 2) cols = line.split(/[,，]/);
      if (cols.length < 2) cols = line.split(/\s+/);
      cols = cols.map((c) => c.trim());

      // 跳过表头
      if (idx === 0) {
        const hits = (line.match(/物资名称|单位|数量|单价|理由/g) || []).length;
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
      if (!matchedItem) {
        status = 'item_missing';
        needSearchIdx.push(rows.length);
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
        reason,
        status,
        matchedItem,
      });
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

    setParsedRows(rows);
    setStep('preview');
    setSubmitError('');
    setSubmitResult(null);
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
          return {
            ...r,
            status: 'matched' as RowStatus,
            matchedItem: created,
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
        return {
          ...r,
          status: 'matched' as RowStatus,
          matchedItem: item,
          unit: newUnit,
          unitPrice: newPrice,
          similarCandidates: undefined,
        };
      }),
    );
  };

  // ===== 从已有物资列表手动映射 =====
  const handleManualMap = (row: ParsedRow, itemId: string) => {
    const item = allItems.find((it) => it.id === itemId);
    if (!item) return;
    handlePickSimilar(row, item);
  };

  // ===== 确认导入 =====
  const handleConfirm = async () => {
    if (!warehouseId) {
      setSubmitError('请选择入库仓库');
      return;
    }
    const validRows = parsedRows.filter((r) => r.status === 'matched' && r.matchedItem);
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
          quantity: Number(r.quantity),
          unit: r.unit,
          unit_price: r.unitPrice ? Number(r.unitPrice) : null,
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
        // 部分成功也刷新列表
        onSuccess();
      }
    } catch (err: any) {
      setSubmitError(err.message || '批量入库失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={() => !submitting && onClose()}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col"
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
              <p className="text-xs text-gray-500">从 Excel/WPS 复制数据，快速入库</p>
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
              disabled={submitting || step === 'preview'}
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
                  '格式：物资名称 单位 数量 单价 理由\n例如：\n洗洁精5L 桶 10 35.00 日常补充\n灯泡LED12W 个 20 8.50 月度补充\n\n简写（2列）：物资名称 数量\n简写（3列）：物资名称 数量 单价'
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
                未匹配的物资可在预览页一键新增到物资库，或从已有物资中手动映射
              </p>
            </div>
          </div>
        ) : (
          /* ===== 步骤2：预览 ===== */
          <div className="flex-1 overflow-y-auto p-4">
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
                      失败 {submitResult.failed_count} 条
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
                disabled={submitting}
                className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1 disabled:opacity-50"
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
                          {row.reason && ` · ${row.reason}`}
                        </div>
                      </div>
                    </div>
                    <div className="flex-shrink-0">
                      {row.status === 'item_missing' && (
                        <div className="flex items-center gap-1">
                          <select
                            className="text-xs border border-amber-300 rounded px-1.5 py-1 bg-white max-w-[180px]"
                            onChange={(e) => {
                              if (e.target.value) handleManualMap(row, e.target.value);
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
                          <button
                            onClick={() => handleResolveItem(row)}
                            className="text-xs bg-primary-500 text-white px-2 py-1 rounded hover:bg-primary-600 whitespace-nowrap"
                          >
                            新增
                          </button>
                        </div>
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
                                {c.name} ({c.unit || '-'})
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
                disabled={!pasteText.trim() || parsing || !warehouseId}
                className="btn-primary flex-1 bg-success-500 hover:bg-success-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {parsing ? '解析中...' : '解析预览'}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onClose}
                disabled={submitting}
                className="btn-secondary flex-1 disabled:opacity-50"
              >
                {submitResult ? '关闭' : '取消'}
              </button>
              <button
                onClick={handleConfirm}
                disabled={matchedCount === 0 || submitting}
                className="btn-primary flex-1 bg-success-500 hover:bg-success-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? '提交中...' : `确认入库 (${matchedCount} 条)`}
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
