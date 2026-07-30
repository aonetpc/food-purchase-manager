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
} from 'lucide-react';
import { api } from '@/lib/api';
import { useDepartmentStore } from '@/store/departmentStore';
import { useSupplierStore } from '@/store/supplierStore';
import { formatCurrency } from '@/utils/format';

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
  spec: string;
  unit: string;
  quantity: string;
  unit_price: string;
  warehouse_id: string;
  warehouse_name: string;
  department_id: string;
  department_name: string;
  reason: string;
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
  spec: '',
  unit: '',
  quantity: '1',
  unit_price: '0',
  warehouse_id: '',
  warehouse_name: '',
  department_id: '',
  department_name: '',
  reason: '',
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
  const { departments, fetchDepartments } = useDepartmentStore();
  const { suppliers, fetchSuppliers } = useSupplierStore();

  // 采购类型状态
  const [purchaseType, setPurchaseType] = useState<'normal' | 'prepay' | 'monthly'>('normal');
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const [prepayAmount, setPrepayAmount] = useState<number>(0);

  // 表单状态
  const [lines, setLines] = useState<LineItem[]>([emptyLine()]);
  const [remark, setRemark] = useState('');

  // 页面状态
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // 批量粘贴
  const [showPastePanel, setShowPastePanel] = useState(false);
  const [pasteText, setPasteText] = useState('');

  // 物资搜索弹窗
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('');
  // 当前正在编辑的行 key（用于从弹窗选择物资后回填到对应行）
  const [editingLineKey, setEditingLineKey] = useState<string | null>(null);

  // ===== 初始化：加载仓库、物资、分类树、部门 =====
  useEffect(() => {
    fetchDepartments();
    fetchSuppliers();
    Promise.all([
      api.get<Warehouse[]>('/warehouses').catch(() => [] as Warehouse[]),
      api.get<WarehouseItem[]>('/warehouses/items').catch(() => [] as WarehouseItem[]),
      api.get<CategoryNode[]>('/warehouses/categories/tree').catch(() => [] as CategoryNode[]),
    ])
      .then(([wh, it, tree]) => {
        setWarehouses(wh);
        setItems(it);
        setCategoryTree(tree);
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
        setSelectedSupplierId(detail.supplier_id || '');
        setPrepayAmount(detail.prepay_amount ? safeNum(detail.prepay_amount) : 0);
        const restoredLines: LineItem[] = (detail.items || []).map((it) => ({
          key: genKey(),
          item_id: it.item_id || '',
          item_name: it.item_name,
          spec: it.spec || '',
          unit: it.unit || '',
          quantity: String(safeNum(it.quantity)),
          unit_price: String(safeNum(it.unit_price)),
          warehouse_id: it.warehouse_id || '',
          warehouse_name: it.warehouse_name || '',
          department_id: it.department_id || '',
          department_name: it.department_name || '',
          reason: it.reason || '',
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

  // 选择物资：自动填充规格和单位，单价默认用参考价
  const pickItem = (item: WarehouseItem) => {
    if (!editingLineKey) return;
    updateLine(editingLineKey, {
      item_id: item.id,
      item_name: item.name,
      spec: item.spec || '',
      unit: item.unit || '',
      unit_price:
        item.reference_price != null ? String(safeNum(item.reference_price)) : '0',
    });
    setShowAddPanel(false);
    setEditingLineKey(null);
  };

  // 选择部门时同步部门名称
  const handleDepartmentChange = (key: string, deptId: string) => {
    const dept = departments.find((d) => d.id === deptId);
    updateLine(key, { department_id: deptId, department_name: dept?.name || '' });
  };

  // 选择仓库时联动部门（部门仓自动填部门，总仓/老板仓清空部门可手选）
  const handleWarehouseChange = (key: string, whId: string) => {
    const wh = warehouses.find((w) => w.id === whId);
    if (!wh) {
      updateLine(key, { warehouse_id: '', warehouse_name: '' });
      return;
    }
    if (wh.type === 'dept' && wh.department_id) {
      const dept = departments.find((d) => d.id === wh.department_id);
      updateLine(key, {
        warehouse_id: whId,
        warehouse_name: wh.name,
        department_id: wh.department_id,
        department_name: dept?.name || wh.department_name || '',
      });
    } else {
      // 总仓/老板仓：清空部门，允许手动选择或留空
      updateLine(key, {
        warehouse_id: whId,
        warehouse_name: wh.name,
        department_id: '',
        department_name: '',
      });
    }
  };

  // 批量粘贴：解析粘贴文本，按 Tab/逗号分列
  const handlePasteImport = () => {
    const text = pasteText.trim();
    if (!text) {
      setError('请粘贴内容');
      return;
    }
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const newLines: LineItem[] = [];
    const errors: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i].trim();
      if (!raw) continue;
      // 跳过表头行
      if (i === 0 && /物资名称|规格|单位|数量|单价|仓库|部门|理由/i.test(raw)) continue;
      // 按 Tab 分列，回退到逗号
      let cols = raw.split('\t');
      if (cols.length === 1) cols = raw.split(/[,，]/);
      const colsTrimmed = cols.map((c) => c.trim());
      // 列顺序：物资名称 | 规格 | 单位 | 数量 | 单价 | 仓库名称 | 使用部门(可选) | 采购理由(可选)
      const [name, spec, unit, qty, price, whName, deptName, reason] = colsTrimmed;
      if (!name) {
        errors.push(`第 ${i + 1} 行：物资名称为空`);
        continue;
      }
      const line = emptyLine();
      line.item_name = name;
      line.spec = spec || '';
      line.unit = unit || '';
      line.quantity = qty || '1';
      line.unit_price = price || '0';
      line.reason = reason || '';
      // 匹配仓库
      if (whName) {
        const wh = warehouses.find((w) => w.name === whName);
        if (wh) {
          line.warehouse_id = wh.id;
          line.warehouse_name = wh.name;
          if (wh.type === 'dept' && wh.department_id) {
            const dept = departments.find((d) => d.id === wh.department_id);
            line.department_id = wh.department_id;
            line.department_name = dept?.name || wh.department_name || '';
          }
        } else {
          errors.push(`第 ${i + 1} 行：未找到仓库"${whName}"`);
        }
      }
      // 匹配物资库
      const matched = items.find(
        (it) => it.name === name && (!spec || it.spec === spec),
      );
      if (matched) {
        line.item_id = matched.id;
        if (!line.spec && matched.spec) line.spec = matched.spec;
        if (!line.unit && matched.unit) line.unit = matched.unit;
        if (line.unit_price === '0' && matched.reference_price != null) {
          line.unit_price = String(safeNum(matched.reference_price));
        }
      }
      // 手动指定部门
      if (deptName && !line.department_id) {
        const dept = departments.find((d) => d.name === deptName);
        if (dept) {
          line.department_id = dept.id;
          line.department_name = dept.name;
        }
      }
      newLines.push(line);
    }
    if (newLines.length === 0) {
      setError('未解析到有效行' + (errors.length ? `\n${errors.join('\n')}` : ''));
      return;
    }
    setLines(newLines);
    setShowPastePanel(false);
    setPasteText('');
    setError('');
    if (errors.length > 0) {
      // 显示警告但不阻止
      console.warn('批量粘贴部分行有问题:', errors);
    }
  };

  // ===== 校验 =====
  const validate = (): string | null => {
    // 预付款/月结需要选择供应商
    if ((purchaseType === 'prepay' || purchaseType === 'monthly') && !selectedSupplierId) {
      return '预付款和月结采购必须选择供应商';
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
    return {
      remark,
      purchase_type: purchaseType,
      supplier_id: (purchaseType === 'prepay' || purchaseType === 'monthly') ? selectedSupplierId || null : null,
      supplier_name: (purchaseType === 'prepay' || purchaseType === 'monthly') ? selectedSupplier?.name || null : null,
      prepay_amount: purchaseType === 'prepay' ? prepayAmount : 0,
      items: validLines.map((l) => ({
        item_id: l.item_id || null,
        item_name: l.item_name.trim(),
        spec: l.spec.trim() || null,
        unit: l.unit.trim(),
        quantity: parseFloat(l.quantity) || 0,
        unit_price: parseFloat(l.unit_price) || 0,
        amount: lineAmount(l),
        warehouse_id: l.warehouse_id || null,
        warehouse_name: l.warehouse_name || null,
        department_id: l.department_id || null,
        department_name: l.department_name || null,
        reason: l.reason.trim() || null,
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
                setPurchaseType(e.target.value as 'normal' | 'prepay' | 'monthly');
                // 切换类型时清空供应商和预付金额
                if (e.target.value === 'normal') {
                  setSelectedSupplierId('');
                  setPrepayAmount(0);
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
              </label>
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
              onClick={() => setShowPastePanel(true)}
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
                  <th className="whitespace-nowrap">规格</th>
                  <th className="whitespace-nowrap">单位</th>
                  <th className="whitespace-nowrap text-right">数量</th>
                  <th className="whitespace-nowrap text-right">单价(元)</th>
                  <th className="whitespace-nowrap text-right">金额(元)</th>
                  <th className="whitespace-nowrap">入库仓库</th>
                  <th className="whitespace-nowrap">使用部门</th>
                  <th className="whitespace-nowrap">采购理由</th>
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
                    {/* 规格 */}
                    <td>
                      <input
                        type="text"
                        value={line.spec}
                        onChange={(e) => updateLine(line.key, { spec: e.target.value })}
                        placeholder="规格"
                        className="w-24 border border-gray-200 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                      />
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
                    {/* 使用部门 */}
                    <td>
                      <select
                        value={line.department_id}
                        onChange={(e) => handleDepartmentChange(line.key, e.target.value)}
                        disabled={!!line.warehouse_id && warehouses.find(w => w.id === line.warehouse_id)?.type === 'dept'}
                        className="border border-gray-200 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 disabled:bg-gray-50 disabled:text-gray-500"
                      >
                        <option value="">未指定</option>
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
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
          onClick={() => setShowAddPanel(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-800">选择物资</h3>
              <button
                onClick={() => setShowAddPanel(false)}
                className="p-1 hover:bg-gray-100 rounded-md transition-colors"
              >
                <X size={20} />
              </button>
            </div>

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
                          {it.spec || '无规格'} · {it.unit || '无单位'}
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
      {showPastePanel && (
        <div
          className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4"
          onClick={() => setShowPastePanel(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div>
                <h3 className="text-lg font-semibold text-gray-800">批量粘贴</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  从 Excel/WPS 复制粘贴，按 Tab 分列。列顺序：物资名称 | 规格 | 单位 | 数量 | 单价 | 仓库名称 | 使用部门(可选) | 采购理由(可选)
                </p>
              </div>
              <button
                onClick={() => setShowPastePanel(false)}
                className="p-1 hover:bg-gray-100 rounded-md transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-700">
                <p className="font-medium mb-1">格式说明：</p>
                <p>每行一条物资，列之间用 Tab（从 Excel 粘贴自动带 Tab）或逗号分隔。</p>
                <p className="mt-1">示例：<code className="bg-blue-100 px-1 rounded">洗洁精	5L	桶	10	35.00	厨房仓		日常补充</code></p>
                <p className="mt-1">仓库名称需与系统仓库名一致，部门仓会自动关联部门；总仓行可不填部门。</p>
              </div>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="在此粘贴内容..."
                className="input-field min-h-[200px] font-mono text-sm"
                autoFocus
              />
            </div>

            <div className="flex justify-end gap-3 p-5 border-t border-gray-100">
              <button
                onClick={() => setShowPastePanel(false)}
                className="btn-secondary"
              >
                取消
              </button>
              <button
                onClick={handlePasteImport}
                className="btn-primary flex items-center gap-2"
              >
                <Clipboard size={16} />
                导入
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
