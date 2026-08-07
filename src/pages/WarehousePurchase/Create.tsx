import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Search,
  X,
  AlertCircle,
  Package,
  ChevronUp,
  ChevronDown,
  Save,
  Send,
  Clipboard,
  Loader2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useDepartmentStore } from '@/store/departmentStore';
import { useSupplierStore } from '@/store/supplierStore';
import { formatCurrency } from '@/utils/format';
import WarehouseBatchPasteModal, { type PasteLine } from '@/components/WarehouseBatchPasteModal';

// ====== 类型定义 ======

// 仓库
interface Warehouse {
  id: string;
  name: string;
  type?: string;
  department_id?: string;
  department_name?: string;
  location?: string;
}

// 物资
interface WarehouseItem {
  id: string;
  name: string;
  sku?: string;
  category_id?: string;
  category_name?: string;
  category_full_path?: string;
  spec?: string;
  unit?: string;
  reference_price?: number;
}

// 分类树节点
interface CategoryNode {
  id: string;
  name: string;
  parent_id?: string | null;
  level: number;
  children?: CategoryNode[];
}

// 扁平化分类（用于搜索弹窗的分类筛选）
interface FlatCategory {
  id: string;
  name: string;
  level: number;
}

// 明细行（本地表单状态）
interface LineItem {
  key: string;
  item_id: string;
  item_name: string;
  unit: string;
  quantity: string;
  unit_price: string;
  warehouse_id: string;
  warehouse_name: string;
  department_id: string;
  department_name: string;
  reason: string;
  instant_use_override: number | null;
}

// 后端返回的采购单明细（用于编辑模式回填）
interface PurchaseItemDTO {
  id: string;
  item_id?: string;
  item_name: string;
  spec?: string;
  unit?: string;
  quantity: number;
  unit_price: number;
  amount?: number;
  warehouse_id?: string;
  warehouse_name?: string;
  department_id?: string;
  department_name?: string;
  reason?: string;
}

// 后端返回的采购单详情
interface PurchaseDetailDTO {
  id: string;
  status: string;
  warehouse_id?: string;
  warehouse_name?: string;
  total_amount: number;
  items?: PurchaseItemDTO[];
  purchase_type?: 'normal' | 'prepay' | 'monthly';
  supplier_id?: string;
  supplier_name?: string;
  prepay_amount?: number;
}

// ====== 工具函数 ======

// 安全数值解析（兼容后端 Decimal 对象）
const safeNum = (val: any): number => {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (typeof val === 'object') {
    val = val.String || val.string || JSON.stringify(val);
  }
  const n = parseFloat(String(val));
  return isNaN(n) ? 0 : n;
};

// 生成临时唯一 key
const genKey = (): string => Math.random().toString(36).substring(2, 11);

// 扁平化分类树
const flattenCategories = (nodes: CategoryNode[], prefix = ''): FlatCategory[] => {
  const result: FlatCategory[] = [];
  nodes.forEach((n) => {
    const name = prefix ? `${prefix} / ${n.name}` : n.name;
    result.push({ id: n.id, name, level: n.level });
    if (n.children?.length) {
      result.push(...flattenCategories(n.children, name));
    }
  });
  return result;
};

// 生成空明细行
const emptyLine = (): LineItem => ({
  key: genKey(),
  item_id: '',
  item_name: '',
  unit: '',
  quantity: '1',
  unit_price: '0',
  warehouse_id: '',
  warehouse_name: '',
  department_id: '',
  department_name: '',
  reason: '',
  instant_use_override: null,
});

export default function WarehousePurchaseCreate() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  // 编辑模式：路由参数存在 id
  const isEdit = !!id;

  // 基础数据
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [items, setItems] = useState<WarehouseItem[]>([]);
  const [categoryTree, setCategoryTree] = useState<CategoryNode[]>([]);
  const { fetchDepartments } = useDepartmentStore();
  const { suppliers, fetchSuppliers } = useSupplierStore();

  // 采购类型状态
  const [purchaseType, setPurchaseType] = useState<'normal' | 'prepay' | 'monthly'>('normal');
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const [supplierInputMode, setSupplierInputMode] = useState<'select' | 'temp'>('select');
  const [tempSupplierName, setTempSupplierName] = useState<string>('');
  const [prepayAmount, setPrepayAmount] = useState<number>(0);

  // 表单状态
  const [lines, setLines] = useState<LineItem[]>([emptyLine()]);
  const [remark, setRemark] = useState('');

  // 页面状态
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // 批量粘贴
  const [showBatchPaste, setShowBatchPaste] = useState(false);

  // 库存数据：{ [warehouse_id]: { [item_id]: { quantity, unit } } }
  const [inventoryMap, setInventoryMap] = useState<Record<string, Record<string, { quantity: number; unit?: string }>>>({});

  // 物资搜索弹窗
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('');
  // 当前正在编辑的行 key（用于从弹窗选择物资后回填到对应行）
  const [editingLineKey, setEditingLineKey] = useState<string | null>(null);

  // 快速添加物资
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickAddData, setQuickAddData] = useState({
    name: '',
    category_id: '',
    unit: '个',
    reference_price: '',
  });
  const [quickAddLoading, setQuickAddLoading] = useState(false);
  // 实时查重：输入名称时检测是否已存在
  const [dupHint, setDupHint] = useState<{ name: string; id: string } | null>(null);
  const [dupChecking, setDupChecking] = useState(false);

  // 防抖查重
  useEffect(() => {
    const name = quickAddData.name.trim();
    if (!name || !showQuickAdd) {
      setDupHint(null);
      return;
    }
    setDupChecking(true);
    const timer = setTimeout(async () => {
      try {
        const result = await api.get<{ exact: WarehouseItem | null; candidates: WarehouseItem[] }>(
          '/warehouses/items/search',
          { params: { q: name } },
        );
        if (result.exact) {
          setDupHint({ name: result.exact.name, id: result.exact.id });
        } else {
          setDupHint(null);
        }
      } catch {
        setDupHint(null);
      } finally {
        setDupChecking(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [quickAddData.name, showQuickAdd]);

  // ===== 初始化：加载仓库、物资、分类树、部门、库存 =====
  useEffect(() => {
    fetchDepartments();
    fetchSuppliers();
    Promise.all([
      api.get<Warehouse[]>('/warehouses').catch(() => [] as Warehouse[]),
      api.get<WarehouseItem[]>('/warehouses/items').catch(() => [] as WarehouseItem[]),
      api.get<CategoryNode[]>('/warehouses/categories/tree').catch(() => [] as CategoryNode[]),
      api.get<Array<{ warehouse_id: string; item_id: string; quantity: number; unit?: string }>>('/inventory').catch(() => []),
    ])
      .then(([wh, it, tree, inv]) => {
        setWarehouses(wh);
        setItems(it);
        setCategoryTree(tree);
        // 构建库存映射 { warehouse_id: { item_id: { quantity, unit } } }
        const map: Record<string, Record<string, { quantity: number; unit?: string }>> = {};
        (inv || []).forEach((row) => {
          if (!map[row.warehouse_id]) map[row.warehouse_id] = {};
          map[row.warehouse_id][row.item_id] = {
            quantity: safeNum(row.quantity),
            unit: row.unit,
          };
        });
        setInventoryMap(map);
      })
      .finally(() => {
        if (!isEdit) setLoading(false);
      });
  }, [fetchDepartments, fetchSuppliers, isEdit]);

  // ===== 编辑模式：加载采购单详情回填表单 =====
  useEffect(() => {
    if (!isEdit || !id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const detail = await api.get<PurchaseDetailDTO>(`/warehouse-purchases/${id}`);
        if (cancelled) return;
        setPurchaseType(detail.purchase_type || 'normal');
        // 编辑模式回填：有 supplier_id 用选择模式，只有 supplier_name 用临时输入模式
        if (detail.supplier_id) {
          setSupplierInputMode('select');
          setSelectedSupplierId(detail.supplier_id);
        } else if (detail.supplier_name) {
          setSupplierInputMode('temp');
          setTempSupplierName(detail.supplier_name);
        }
        setPrepayAmount(detail.prepay_amount ? safeNum(detail.prepay_amount) : 0);
        const restoredLines: LineItem[] = (detail.items || []).map((it: any) => ({
          key: genKey(),
          item_id: it.item_id || '',
          item_name: it.item_name,
          unit: it.unit || '',
          quantity: String(safeNum(it.quantity)),
          unit_price: String(safeNum(it.unit_price)),
          warehouse_id: it.warehouse_id || '',
          warehouse_name: it.warehouse_name || '',
          department_id: it.department_id || '',
          department_name: it.department_name || '',
          reason: it.reason || '',
          instant_use_override: it.instant_use_override !== undefined ? it.instant_use_override : null,
        }));
        setLines(restoredLines.length > 0 ? restoredLines : [emptyLine()]);
      } catch (err: any) {
        setError(err.message || '获取采购单详情失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEdit, id]);

  // 扁平化分类（供搜索弹窗筛选）
  const flatCategories = useMemo(() => flattenCategories(categoryTree), [categoryTree]);

  // 过滤后的物资列表（用于搜索弹窗）
  const filteredItems = useMemo(() => {
    return items.filter((it) => {
      const matchSearch =
        !searchTerm ||
        it.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (it.sku || '').toLowerCase().includes(searchTerm.toLowerCase());
      const matchCategory = !filterCategory || it.category_id === filterCategory;
      return matchSearch && matchCategory;
    });
  }, [items, searchTerm, filterCategory]);

  // 每行金额
  const lineAmount = (line: LineItem): number => {
    const qty = parseFloat(line.quantity) || 0;
    const price = parseFloat(line.unit_price) || 0;
    return Math.round(qty * price * 100) / 100;
  };

  // 合计金额
  const totalAmount = useMemo(() => {
    return Math.round(lines.reduce((sum, l) => sum + lineAmount(l), 0) * 100) / 100;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines]);

  // ===== 行操作 =====
  const updateLine = (key: string, patch: Partial<LineItem>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const removeLine = (key: string) => {
    setLines((prev) => (prev.filter((l) => l.key !== key).length > 0 ? prev.filter((l) => l.key !== key) : [emptyLine()]));
  };

  // 调整顺序：上移
  const moveUp = (key: string) => {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.key === key);
      if (idx <= 0) return prev;
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  };

  // 调整顺序：下移
  const moveDown = (key: string) => {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.key === key);
      if (idx < 0 || idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  };

  // 打开物资搜索弹窗（针对某一行）
  const openItemPicker = (key: string) => {
    setEditingLineKey(key);
    setSearchTerm('');
    setFilterCategory('');
    setShowAddPanel(true);
  };

  // 选择物资：自动填充单位，单价默认用参考价
  const pickItem = (item: WarehouseItem) => {
    if (!editingLineKey) return;
    updateLine(editingLineKey, {
      item_id: item.id,
      item_name: item.name,
      unit: item.unit || '',
      unit_price:
        item.reference_price != null ? String(safeNum(item.reference_price)) : '0',
    });
    setShowAddPanel(false);
    setEditingLineKey(null);
    // 重置快速添加表单
    setShowQuickAdd(false);
    setQuickAddData({ name: '', category_id: '', unit: '个', reference_price: '' });
  };

  // 快速添加物资并自动选中
  const handleQuickAdd = async () => {
    if (!quickAddData.name.trim()) return;
    setQuickAddLoading(true);
    try {
      const newItem = await api.post<WarehouseItem>('/warehouses/items', {
        name: quickAddData.name.trim(),
        category_id: quickAddData.category_id || null,
        unit: quickAddData.unit.trim() || '个',
        reference_price: parseFloat(quickAddData.reference_price) || 0,
      });
      // 添加到本地物资列表
      handleItemCreated(newItem);
      // 自动选中新创建的物资
      if (editingLineKey) {
        updateLine(editingLineKey, {
          item_id: newItem.id,
          item_name: newItem.name,
          unit: newItem.unit || '',
          unit_price: newItem.reference_price != null ? String(safeNum(newItem.reference_price)) : '0',
        });
        setShowAddPanel(false);
        setEditingLineKey(null);
      }
      // 重置快速添加表单
      setShowQuickAdd(false);
      setQuickAddData({ name: '', category_id: '', unit: '个', reference_price: '' });
    } catch (err: any) {
      // 409 表示已存在同名物资
      if (err.status === 409 || err.code === 409) {
        alert('已存在同名物资，请从左侧列表中选择，或修改名称后再添加');
      } else {
        alert(err.message || '添加物资失败');
      }
    } finally {
      setQuickAddLoading(false);
    }
  };

  // 更新快速添加表单
  const updateQuickAdd = (field: string, value: string) => {
    setQuickAddData((prev) => ({ ...prev, [field]: value }));
  };

  // 选择仓库
  const handleWarehouseChange = (key: string, whId: string) => {
    const wh = warehouses.find((w) => w.id === whId);
    if (!wh) {
      updateLine(key, { warehouse_id: '', warehouse_name: '' });
      return;
    }
    updateLine(key, {
      warehouse_id: whId,
      warehouse_name: wh.name,
    });
  };

  // 批量粘贴导入回调
  const handleBatchImport = (imported: PasteLine[]) => {
    const newLines: LineItem[] = imported.map((l) => ({
      key: genKey(),
      item_id: l.item_id,
      item_name: l.item_name,
      unit: l.unit,
      quantity: l.quantity || '1',
      unit_price: l.unit_price || '0',
      warehouse_id: l.warehouse_id,
      warehouse_name: l.warehouse_name,
      department_id: '',
      department_name: '',
      reason: l.reason,
      instant_use_override: null,
    }));
    // 检查现有行是否都是空行（未选择物资），如果是则用导入数据替换
    setLines((prev) => {
      const allEmpty = prev.every((l) => !l.item_id && !l.item_name);
      return allEmpty ? newLines : [...prev, ...newLines];
    });
    setShowBatchPaste(false);
  };

  // 物资库新增物资后同步到本地列表
  const handleItemCreated = (item: WarehouseItem) => {
    setItems((prev) => [item, ...prev]);
  };

  // 供应商新增后同步刷新供应商库
  const handleSupplierCreated = () => {
    fetchSuppliers();
  };

  // 获取某行当前库存（按所选仓库+物资）
  const getStockInfo = (line: LineItem): { quantity: number; unit?: string } | null => {
    if (!line.warehouse_id || !line.item_id) return null;
    return inventoryMap[line.warehouse_id]?.[line.item_id] || null;
  };

  // ===== 校验 =====
  const validate = (): string | null => {
    // 月结采购：必须选择已有供应商（不允许临时输入）
    if (purchaseType === 'monthly' && !selectedSupplierId) {
      return '月结采购必须选择供应商';
    }
    // 预付款采购：可以选择已有或临时输入
    if (purchaseType === 'prepay') {
      if (supplierInputMode === 'select' && !selectedSupplierId) {
        return '请选择供应商或切换为临时输入';
      }
      if (supplierInputMode === 'temp' && !tempSupplierName.trim()) {
        return '请输入供应商名称';
      }
    }
    // 预付款需要填写预付金额
    if (purchaseType === 'prepay' && (!prepayAmount || prepayAmount <= 0)) {
      return '预付款采购必须填写预付金额';
    }
    // 过滤掉完全空的行
    const validLines = lines.filter((l) => l.item_id || l.item_name);
    if (validLines.length === 0) return '请至少添加一条物资明细';
    for (let i = 0; i < validLines.length; i++) {
      const l = validLines[i];
      if (!l.item_name.trim()) return `第 ${i + 1} 行：请选择物资`;
      const qty = parseFloat(l.quantity);
      if (isNaN(qty) || qty <= 0) return `第 ${i + 1} 行：数量必须大于 0`;
      const price = parseFloat(l.unit_price);
      if (isNaN(price) || price < 0) return `第 ${i + 1} 行：单价不能为负`;
      if (!l.unit.trim()) return `第 ${i + 1} 行：单位不能为空`;
      if (!l.warehouse_id) return `第 ${i + 1} 行：请选择入库仓库`;
    }
    return null;
  };

  // ===== 构建提交 payload =====
  const buildPayload = () => {
    const validLines = lines.filter((l) => l.item_id || l.item_name);
    const selectedSupplier = suppliers.find(s => s.id === selectedSupplierId);
    const needSupplier = purchaseType === 'prepay' || purchaseType === 'monthly';
    // 临时输入模式：supplier_id = null，supplier_name = 输入值
    const supplierId = needSupplier ? (supplierInputMode === 'temp' ? null : selectedSupplierId || null) : null;
    const supplierName = needSupplier
      ? (supplierInputMode === 'temp' ? tempSupplierName.trim() : selectedSupplier?.name || null)
      : null;
    return {
      remark,
      purchase_type: purchaseType,
      supplier_id: supplierId,
      supplier_name: supplierName,
      prepay_amount: purchaseType === 'prepay' ? prepayAmount : 0,
      items: validLines.map((l) => ({
        item_id: l.item_id || null,
        item_name: l.item_name.trim(),
        unit: l.unit.trim(),
        quantity: parseFloat(l.quantity) || 0,
        unit_price: parseFloat(l.unit_price) || 0,
        amount: lineAmount(l),
        warehouse_id: l.warehouse_id || null,
        warehouse_name: l.warehouse_name || null,
        department_id: null,
        department_name: null,
        reason: l.reason.trim() || null,
        instant_use_override: l.instant_use_override,
      })),
    };
  };

  // ===== 保存草稿 =====
  const handleSaveDraft = async () => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = buildPayload();
      if (isEdit && id) {
        await api.put(`/warehouse-purchases/${id}`, payload);
      } else {
        await api.post('/warehouse-purchases', payload);
      }
      navigate('/warehouse-purchase');
    } catch (err: any) {
      setError(err.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  // ===== 保存并提交审批 =====
  const handleSubmit = async () => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = buildPayload();
      let purchaseId = id;
      if (isEdit && id) {
        await api.put(`/warehouse-purchases/${id}`, payload);
      } else {
        const created = await api.post<{ id: string }>('/warehouse-purchases', payload);
        purchaseId = created.id;
      }
      // 提交审批
      if (purchaseId) {
        await api.post(`/warehouse-purchases/${purchaseId}/submit`);
      }
      navigate('/warehouse-purchase');
    } catch (err: any) {
      setError(err.message || '提交审批失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-center py-20 text-gray-500">加载中...</div>;
  }

  return (
    <div className="space-y-6">
      {/* 页头 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/warehouse-purchase')}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            title="返回"
          >
            <ArrowLeft size={20} className="text-gray-600" />
          </button>
          <div>
            <h1 className="text-2xl font-serif font-bold text-gray-800">
              {isEdit ? '编辑采购单' : '新建采购单'}
            </h1>
            <p className="text-gray-500 mt-1">
              添加物资明细并选择入库仓库，可保存草稿或直接提交审批
            </p>
          </div>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="bg-danger-50 border border-danger-200 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle size={20} className="text-danger-500" />
          <span className="text-danger-700 flex-1">{error}</span>
          <button onClick={() => setError('')} className="p-1 hover:bg-danger-100 rounded-md">
            <X size={16} className="text-danger-500" />
          </button>
        </div>
      )}

      {/* 基本信息卡片 */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">基本信息</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 采购类型 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              采购类型 <span className="text-danger-500">*</span>
            </label>
            <select
              value={purchaseType}
              onChange={(e) => {
                const nextType = e.target.value as 'normal' | 'prepay' | 'monthly';
                setPurchaseType(nextType);
                // 切换到现购：清空供应商、临时输入、预付金额
                if (nextType === 'normal') {
                  setSelectedSupplierId('');
                  setTempSupplierName('');
                  setSupplierInputMode('select');
                  setPrepayAmount(0);
                }
                // 切换到月结：强制选择模式，清空临时输入
                if (nextType === 'monthly') {
                  setSupplierInputMode('select');
                  setTempSupplierName('');
                }
              }}
              className="input-field"
            >
              <option value="normal">现购</option>
              <option value="prepay">预付款采购</option>
              <option value="monthly">月结采购</option>
            </select>
          </div>
          {/* 供应商选择（预付款/月结时显示） */}
          {(purchaseType === 'prepay' || purchaseType === 'monthly') && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                供应商 <span className="text-danger-500">*</span>
                {purchaseType === 'monthly' && (
                  <span className="ml-2 text-xs text-slate-500 font-normal">（月结必须选择已有供应商）</span>
                )}
              </label>
              {/* 模式切换按钮：仅预付款时显示 */}
              {purchaseType === 'prepay' && (
                <div className="flex gap-1 mb-2">
                  <button
                    type="button"
                    onClick={() => setSupplierInputMode('select')}
                    className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                      supplierInputMode === 'select'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    选择已有
                  </button>
                  <button
                    type="button"
                    onClick={() => setSupplierInputMode('temp')}
                    className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                      supplierInputMode === 'temp'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    临时输入
                  </button>
                </div>
              )}
              {/* 输入控件 */}
              {(purchaseType === 'monthly' || supplierInputMode === 'select') ? (
                <select
                  value={selectedSupplierId}
                  onChange={(e) => setSelectedSupplierId(e.target.value)}
                  className="input-field"
                >
                  <option value="">请选择供应商</option>
                  {suppliers.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}{s.prepay_balance && s.prepay_balance > 0 ? ` (余额¥${Number(s.prepay_balance).toFixed(2)})` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={tempSupplierName}
                  onChange={(e) => setTempSupplierName(e.target.value)}
                  placeholder="请输入供应商名称（一次性使用，不会保存到供应商列表）"
                  className="input-field"
                />
              )}
            </div>
          )}
          {/* 预付款金额 */}
          {purchaseType === 'prepay' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                预付金额 <span className="text-danger-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">¥</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={prepayAmount || ''}
                  onChange={(e) => setPrepayAmount(parseFloat(e.target.value) || 0)}
                  placeholder="请输入预付金额"
                  className="input-field pl-7"
                />
              </div>
              {prepayAmount > 0 && totalAmount > 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  将预付 {((prepayAmount / totalAmount) * 100).toFixed(1)}%，
                  剩余 {(totalAmount - prepayAmount).toFixed(2)} 元入库后结算
                </p>
              )}
            </div>
          )}
          {/* 备注 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">备注</label>
            <input
              type="text"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="可选，填写采购备注"
              className="input-field"
            />
          </div>
        </div>
      </div>

      {/* 物资明细卡片 */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">物资明细</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              共 {lines.length} 行，合计 {formatCurrency(totalAmount)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowBatchPaste(true)}
              className="btn-secondary flex items-center gap-2"
            >
              <Clipboard size={16} />
              批量粘贴
            </button>
            <button
              onClick={() => setLines((prev) => [...prev, emptyLine()])}
              className="btn-primary flex items-center gap-2"
            >
              <Plus size={16} />
              添加行
            </button>
          </div>
        </div>

        {lines.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <Package size={40} className="mx-auto mb-3 opacity-50" />
            <p>暂无物资明细，点击"添加行"开始</p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-6 px-6">
            <table className="data-table min-w-full">
              <thead>
                <tr>
                  <th className="whitespace-nowrap">物资名称</th>
                  <th className="whitespace-nowrap">单位</th>
                  <th className="whitespace-nowrap text-right">数量</th>
                  <th className="whitespace-nowrap text-right">单价(元)</th>
                  <th className="whitespace-nowrap text-right">金额(元)</th>
                  <th className="whitespace-nowrap">入库仓库</th>
                  <th className="whitespace-nowrap text-right">当前库存</th>
                  <th className="whitespace-nowrap">采购理由</th>
                  <th className="whitespace-nowrap text-center">即采即用</th>
                  <th className="whitespace-nowrap text-center">操作</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, idx) => (
                  <tr key={line.key}>
                    {/* 物资名称（点击选择物资） */}
                    <td>
                      <button
                        onClick={() => openItemPicker(line.key)}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded-md border transition-colors w-full text-left ${
                          line.item_name
                            ? 'border-gray-200 hover:border-primary-300 hover:bg-primary-50'
                            : 'border-dashed border-gray-300 text-gray-400 hover:border-primary-300 hover:bg-primary-50'
                        }`}
                      >
                        {line.item_name ? (
                          <span className="font-medium text-gray-800 truncate">
                            {line.item_name}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-sm">
                            <Search size={14} />
                            选择物资
                          </span>
                        )}
                      </button>
                    </td>
                    {/* 单位 */}
                    <td>
                      <input
                        type="text"
                        value={line.unit}
                        onChange={(e) => updateLine(line.key, { unit: e.target.value })}
                        placeholder="单位"
                        className="w-20 border border-gray-200 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                      />
                    </td>
                    {/* 数量 */}
                    <td className="text-right">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.quantity}
                        onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                        className="w-20 text-right border border-gray-200 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                      />
                    </td>
                    {/* 单价 */}
                    <td className="text-right">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.unit_price}
                        onChange={(e) => updateLine(line.key, { unit_price: e.target.value })}
                        className="w-24 text-right border border-gray-200 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                      />
                    </td>
                    {/* 金额（自动计算） */}
                    <td className="text-right font-semibold text-gray-800">
                      {formatCurrency(lineAmount(line))}
                    </td>
                    {/* 入库仓库 */}
                    <td>
                      <select
                        value={line.warehouse_id}
                        onChange={(e) => handleWarehouseChange(line.key, e.target.value)}
                        className={`border rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 ${
                          line.warehouse_id ? 'border-gray-200' : 'border-dashed border-danger-300'
                        }`}
                      >
                        <option value="">选择仓库</option>
                        {warehouses.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                            {w.type === 'dept' && w.department_name ? `（${w.department_name}）` : ''}
                          </option>
                        ))}
                      </select>
                    </td>
                    {/* 当前库存 */}
                    <td className="text-right">
                      {(() => {
                        const stock = getStockInfo(line);
                        if (!line.warehouse_id) return <span className="text-xs text-gray-300">-</span>;
                        if (!line.item_id) return <span className="text-xs text-gray-300">-</span>;
                        if (!stock) return <span className="text-xs text-gray-400">0</span>;
                        const qty = stock.quantity;
                        const color = qty <= 0 ? 'text-red-500' : qty < 5 ? 'text-amber-600' : 'text-gray-700';
                        return (
                          <span className={`text-sm font-medium ${color}`} title="该仓库当前剩余库存">
                            {qty}
                            {stock.unit ? ` ${stock.unit}` : ''}
                          </span>
                        );
                      })()}
                    </td>
                    {/* 采购理由 */}
                    <td>
                      <input
                        type="text"
                        value={line.reason}
                        onChange={(e) => updateLine(line.key, { reason: e.target.value })}
                        placeholder="采购理由"
                        className="w-32 border border-gray-200 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                      />
                    </td>
                    {/* 即采即用 */}
                    <td className="text-center">
                      <input
                        type="checkbox"
                        checked={line.instant_use_override === 1}
                        onChange={(e) => updateLine(line.key, { instant_use_override: e.target.checked ? 1 : 0 })}
                        className="w-4 h-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                        title="勾选后入库时自动出库归零，成本直接归集部门"
                      />
                    </td>
                    {/* 操作：上移、下移、删除 */}
                    <td className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => moveUp(line.key)}
                          disabled={idx === 0}
                          className="p-1 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-md transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                          title="上移"
                        >
                          <ChevronUp size={16} />
                        </button>
                        <button
                          onClick={() => moveDown(line.key)}
                          disabled={idx === lines.length - 1}
                          className="p-1 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-md transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                          title="下移"
                        >
                          <ChevronDown size={16} />
                        </button>
                        <button
                          onClick={() => removeLine(line.key)}
                          className="p-1 text-gray-400 hover:text-danger-500 hover:bg-danger-50 rounded-md transition-colors"
                          title="删除"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 font-semibold">
                  <td colSpan={5} className="text-right text-gray-600">
                    合计
                  </td>
                  <td className="text-right text-lg text-primary-600">
                    {formatCurrency(totalAmount)}
                  </td>
                  <td colSpan={4}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* 底部操作按钮 */}
      <div className="flex items-center justify-end gap-3">
        <button
          onClick={() => navigate('/warehouse-purchase')}
          className="btn-secondary"
          disabled={saving}
        >
          取消
        </button>
        <button
          onClick={handleSaveDraft}
          disabled={saving}
          className="btn-secondary flex items-center gap-2 disabled:opacity-50"
        >
          <Save size={16} />
          {saving ? '保存中...' : '保存草稿'}
        </button>
        <button
          onClick={handleSubmit}
          disabled={saving}
          className="btn-primary flex items-center gap-2 disabled:opacity-50"
        >
          <Send size={16} />
          {saving ? '提交中...' : '保存并提交审批'}
        </button>
      </div>

      {/* ===== 物资搜索弹窗 ===== */}
      {showAddPanel && (
        <div
          className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4"
          onClick={() => { setShowAddPanel(false); setShowQuickAdd(false); }}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-800">选择物资</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowQuickAdd(!showQuickAdd)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    showQuickAdd
                      ? 'bg-primary-500 text-white'
                      : 'bg-primary-50 text-primary-600 hover:bg-primary-100'
                  }`}
                >
                  <Plus size={14} />
                  快速添加物资
                </button>
                <button
                  onClick={() => { setShowAddPanel(false); setShowQuickAdd(false); }}
                  className="p-1 hover:bg-gray-100 rounded-md transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* 快速添加表单 */}
            {showQuickAdd && (
              <div className="p-4 border-b border-gray-100 bg-gray-50 rounded-none">
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="text-xs text-gray-600 mb-1 block">物资名称 *</label>
                    <input
                      type="text"
                      value={quickAddData.name}
                      onChange={(e) => updateQuickAdd('name', e.target.value)}
                      placeholder="输入物资名称（含规格，如：食用油5L）"
                      className="input-field"
                      autoFocus
                    />
                    {dupChecking && (
                      <p className="text-xs text-gray-400 mt-1">检查中...</p>
                    )}
                    {dupHint && (
                      <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                        ⚠️ 已存在同名物资「{dupHint.name}」，请直接从左侧列表选择
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="text-xs text-gray-600 mb-1 block">分类</label>
                    <select
                      value={quickAddData.category_id}
                      onChange={(e) => updateQuickAdd('category_id', e.target.value)}
                      className="input-field"
                    >
                      <option value="">未分类</option>
                      {flatCategories.map((cat) => (
                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-600 mb-1 block">单位</label>
                    <input
                      type="text"
                      value={quickAddData.unit}
                      onChange={(e) => updateQuickAdd('unit', e.target.value)}
                      placeholder="如：个、箱、kg"
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-600 mb-1 block">参考单价</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={quickAddData.reference_price}
                      onChange={(e) => updateQuickAdd('reference_price', e.target.value)}
                      placeholder="0.00"
                      className="input-field"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-3">
                  <button
                    onClick={() => setShowQuickAdd(false)}
                    className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleQuickAdd}
                    disabled={!quickAddData.name.trim() || quickAddLoading}
                    className="px-4 py-1.5 text-xs bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
                  >
                    {quickAddLoading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                    {quickAddLoading ? '添加中...' : '添加并选中'}
                  </button>
                </div>
              </div>
            )}

            {/* 搜索框 + 分类筛选 */}
            <div className="p-5 border-b border-gray-100 space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  type="text"
                  placeholder="搜索物资名称或 SKU..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="input-field pl-10"
                  autoFocus
                />
              </div>
              {flatCategories.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setFilterCategory('')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      !filterCategory
                        ? 'bg-primary-500 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    全部分类
                  </button>
                  {flatCategories.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setFilterCategory(filterCategory === cat.id ? '' : cat.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        filterCategory === cat.id
                          ? 'bg-primary-500 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 物资列表 */}
            <div className="flex-1 overflow-y-auto p-5">
              {filteredItems.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <Package size={36} className="mx-auto mb-2 opacity-50" />
                  <p>未找到匹配的物资</p>
                  <p className="text-xs mt-1">点击右上角"快速添加物资"新增</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {filteredItems.map((it) => (
                    <button
                      key={it.id}
                      onClick={() => pickItem(it)}
                      className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:border-primary-300 hover:bg-primary-50 cursor-pointer text-left transition-all"
                    >
                      <div className="w-10 h-10 rounded-lg bg-primary-50 flex items-center justify-center text-primary-600 flex-shrink-0">
                        <Package size={18} />
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-gray-800 text-sm truncate">{it.name}</p>
                        <p className="text-xs text-gray-500">
                          {it.unit || '无单位'}
                          {it.reference_price != null
                            ? ` · ¥${safeNum(it.reference_price).toFixed(2)}`
                            : ''}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== 批量粘贴弹窗 ===== */}
      <WarehouseBatchPasteModal
        open={showBatchPaste}
        onClose={() => setShowBatchPaste(false)}
        onConfirm={handleBatchImport}
        onItemCreated={handleItemCreated}
        onSupplierCreated={handleSupplierCreated}
        warehouses={warehouses}
        categoryTree={categoryTree}
        items={items}
        suppliers={suppliers}
        fixedSupplier={
          (purchaseType === 'prepay' || purchaseType === 'monthly') && selectedSupplierId
            ? (() => {
                const s = suppliers.find((x) => x.id === selectedSupplierId);
                return s ? { id: s.id, name: s.name, prepay_balance: s.prepay_balance } : null;
              })()
            : null
        }
      />
    </div>
  );
}
