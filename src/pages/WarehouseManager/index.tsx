import { useState, useEffect } from 'react';
import {
  Warehouse as WarehouseIcon,
  FolderTree,
  Package,
  Plus,
  Pencil,
  Trash2,
  X,
  Search,
  AlertCircle,
  Check,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useDepartmentStore } from '@/store/departmentStore';

// ====== 类型定义 ======

// 仓库类型：main 总仓 / dept 部门仓 / boss 老板仓
type WarehouseType = 'main' | 'dept' | 'boss';

interface WarehouseUser {
  user_id: string;
  name: string;
  role: 'manager' | 'viewer';
  wecom_userid?: string;
}

// 仓库
interface Warehouse {
  id: string;
  name: string;
  type: WarehouseType;
  department_id?: string;
  department_name?: string;
  manager_userid?: string;
  confirmer_userid?: string;
  confirmer_name?: string;
  managers?: WarehouseUser[];
  viewers?: WarehouseUser[];
  location?: string;
  enable_stock_take?: number;
  created_at?: string;
}

// 系统用户
interface SystemUser {
  id: string;
  name: string;
  username: string;
  phone?: string;
  role?: string;
  wecom_userid?: string;
}

// 分类树节点（最多 2 级）
interface CategoryNode {
  id: string;
  name: string;
  parent_id?: string | null;
  level: number;
  sort_order?: number;
  children?: CategoryNode[];
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
  instant_use?: number;
  created_at?: string;
}

// Tab 类型
type TabType = 'warehouses' | 'categories' | 'items';

// 仓库表单
interface WarehouseForm {
  id?: string;
  name: string;
  type: WarehouseType;
  department_id: string;
  location: string;
  enable_stock_take: boolean;
  // 用户选择（多选 user_id 数组）
  manager_user_ids: string[];
  viewer_user_ids: string[];
  confirmer_userid: string; // 直接存企微 userid 字符串
}

// 分类表单
interface CategoryForm {
  id?: string;
  name: string;
  parent_id: string | null;
  level: number;
}

// 物资表单
interface ItemForm {
  id?: string;
  name: string;
  sku: string;
  category_id: string;
  unit: string;
  reference_price: string;
  instant_use: boolean;
}

// 仓库类型显示配置
const WAREHOUSE_TYPE_CONFIG: Record<WarehouseType, { label: string; color: string }> = {
  main: { label: '总仓', color: 'bg-blue-50 text-blue-700' },
  dept: { label: '部门仓', color: 'bg-green-50 text-green-700' },
  boss: { label: '老板仓', color: 'bg-purple-50 text-purple-700' },
};

// 最大分类层级
const MAX_CATEGORY_LEVEL = 2;

// 表单初始值工厂
const emptyWarehouseForm = (): WarehouseForm => ({
  name: '',
  type: 'main',
  department_id: '',
  location: '',
  enable_stock_take: true,
  manager_user_ids: [],
  viewer_user_ids: [],
  confirmer_userid: '',
});

const emptyCategoryForm = (): CategoryForm => ({
  name: '',
  parent_id: null,
  level: 1,
});

const emptyItemForm = (): ItemForm => ({
  name: '',
  sku: '',
  category_id: '',
  unit: '',
  reference_price: '',
  instant_use: false,
});

// 扁平化分类树（用于物资表单下拉与筛选）
interface FlatCategory {
  id: string;
  name: string;
  level: number;
}
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

export default function WarehouseManager() {
  const [activeTab, setActiveTab] = useState<TabType>('warehouses');

  // ===== 仓库相关 state =====
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseLoading, setWarehouseLoading] = useState(false);
  const [warehouseError, setWarehouseError] = useState('');
  const [showWarehouseModal, setShowWarehouseModal] = useState(false);
  const [warehouseForm, setWarehouseForm] = useState<WarehouseForm>(emptyWarehouseForm());
  const [warehouseFormError, setWarehouseFormError] = useState('');
  const [deleteWarehouseId, setDeleteWarehouseId] = useState<string | null>(null);
  const [systemUsers, setSystemUsers] = useState<SystemUser[]>([]);
  const [userFilter, setUserFilter] = useState<Record<'manager' | 'viewer' | 'confirmer', string>>({
    manager: '',
    viewer: '',
    confirmer: '',
  });
  const [initialUserIds, setInitialUserIds] = useState<{
    manager_ids: string[];
    viewer_ids: string[];
    confirmer_userid: string;
  } | null>(null);

  // ===== 人员选择弹窗 state =====
  const [pickerModal, setPickerModal] = useState<{
    open: boolean;
    target: 'manager' | 'viewer';
    tempSelected: string[];
    search: string;
  }>({
    open: false,
    target: 'manager',
    tempSelected: [],
    search: '',
  });
  // 从系统用户快速选确认人弹窗
  const [confirmerPickerModal, setConfirmerPickerModal] = useState<{
    open: boolean;
    search: string;
  }>({ open: false, search: '' });

  // ===== 分类相关 state =====
  const [categoryTree, setCategoryTree] = useState<CategoryNode[]>([]);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [categoryError, setCategoryError] = useState('');
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<Set<string>>(new Set());
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [categoryForm, setCategoryForm] = useState<CategoryForm>(emptyCategoryForm());
  const [categoryFormError, setCategoryFormError] = useState('');
  const [deleteCategoryNode, setDeleteCategoryNode] = useState<CategoryNode | null>(null);

  // ===== 物资相关 state =====
  const [items, setItems] = useState<WarehouseItem[]>([]);
  const [itemLoading, setItemLoading] = useState(false);
  const [itemError, setItemError] = useState('');
  const [keyword, setKeyword] = useState('');
  const [filterCategoryId, setFilterCategoryId] = useState<string>('');
  const [showItemModal, setShowItemModal] = useState(false);
  const [itemForm, setItemForm] = useState<ItemForm>(emptyItemForm());
  const [itemFormError, setItemFormError] = useState('');
  const [deleteItemId, setDeleteItemId] = useState<string | null>(null);

  // 部门列表（用于仓库关联部门选择）
  const { departments, fetchDepartments } = useDepartmentStore();

  // ===== 初始化：加载仓库、分类树、部门、用户列表 =====
  useEffect(() => {
    fetchWarehouses();
    fetchCategoryTree();
    fetchDepartments();
    fetchSystemUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchSystemUsers = async () => {
    try {
      const data = await api.get<SystemUser[]>('/auth/users');
      // 按用户 id 去重，解决同一用户多角色返回多条的问题
      const seenIds = new Set<string>();
      const deduped: SystemUser[] = [];
      for (const u of data.filter((x: any) => x.status !== 0)) {
        if (!seenIds.has(u.id)) {
          seenIds.add(u.id);
          deduped.push(u);
        }
      }
      setSystemUsers(deduped);
    } catch (e: any) {
      console.warn('fetch users failed', e);
    }
  };

  // ===== 物资搜索/筛选变化时重新加载（带防抖） =====
  useEffect(() => {
    const t = setTimeout(() => {
      fetchItems();
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, filterCategoryId]);

  // ===== 仓库数据操作 =====
  const fetchWarehouses = async () => {
    setWarehouseLoading(true);
    setWarehouseError('');
    try {
      const data = await api.get<Warehouse[]>('/warehouses');
      setWarehouses(data);
    } catch (err: any) {
      setWarehouseError(err.message || '获取仓库列表失败');
    } finally {
      setWarehouseLoading(false);
    }
  };

  const openAddWarehouse = () => {
    setWarehouseForm(emptyWarehouseForm());
    setWarehouseFormError('');
    setUserFilter({ manager: '', viewer: '', confirmer: '' });
    setInitialUserIds(null);
    setShowWarehouseModal(true);
  };

  const openEditWarehouse = (w: Warehouse) => {
    const managerIds = (w.managers || []).map((u) => u.user_id);
    const viewerIds = (w.viewers || []).map((u) => u.user_id);
    // 直接取数据库里的企微 userid 字符串，不再通过系统用户反查
    const confirmerUserid = w.confirmer_userid || '';
    setWarehouseForm({
      id: w.id,
      name: w.name,
      type: w.type,
      department_id: w.department_id || '',
      location: w.location || '',
      enable_stock_take: w.enable_stock_take == null ? true : Number(w.enable_stock_take) === 1,
      manager_user_ids: managerIds,
      viewer_user_ids: viewerIds,
      confirmer_userid: confirmerUserid,
    });
    setInitialUserIds({
      manager_ids: [...managerIds],
      viewer_ids: [...viewerIds],
      confirmer_userid: confirmerUserid,
    });
    setWarehouseFormError('');
    setUserFilter({ manager: '', viewer: '', confirmer: '' });
    setShowWarehouseModal(true);
  };

  const handleWarehouseSubmit = async () => {
    setWarehouseFormError('');
    // 名称必填
    if (!warehouseForm.name.trim()) {
      setWarehouseFormError('请输入仓库名称');
      return;
    }
    // 部门仓必须关联部门，其他类型可选关联（用于确认通知）
    if (warehouseForm.type === 'dept' && !warehouseForm.department_id) {
      setWarehouseFormError('部门仓必须关联部门');
      return;
    }
    // 基础 payload（仓库本身字段）
    const payload = {
      name: warehouseForm.name.trim(),
      type: warehouseForm.type,
      department_id: warehouseForm.department_id || null,
      location: warehouseForm.location.trim() || null,
      enable_stock_take: warehouseForm.enable_stock_take ? 1 : 0,
    };
    try {
      let savedWarehouseId = warehouseForm.id;
      if (warehouseForm.id) {
        const updated = await api.put<Warehouse>(`/warehouses/${warehouseForm.id}`, payload);
        setWarehouses((prev) => prev.map((w) => (w.id === warehouseForm.id ? updated : w)));
      } else {
        const created = await api.post<Warehouse>('/warehouses', payload);
        savedWarehouseId = created.id;
        setWarehouses((prev) => [...prev, created]);
      }

      // 保存用户绑定：对比初始值，只提交变化的字段
      const userPayload: { manager_ids?: string[]; viewer_ids?: string[]; confirmer_userid?: string | null } = {};
      const sortedEqual = (a: string[], b: string[]) =>
        a.length === b.length && a.every((v, i) => v === b[i]);

      if (!initialUserIds) {
        // 新增仓库：始终提交全部
        userPayload.manager_ids = warehouseForm.manager_user_ids;
        userPayload.viewer_ids = warehouseForm.viewer_user_ids;
        userPayload.confirmer_userid = warehouseForm.confirmer_userid || null;
      } else {
        const mgrChanged = !sortedEqual(
          [...warehouseForm.manager_user_ids].sort(),
          [...initialUserIds.manager_ids].sort(),
        );
        const viewerChanged = !sortedEqual(
          [...warehouseForm.viewer_user_ids].sort(),
          [...initialUserIds.viewer_ids].sort(),
        );
        const confirmerChanged = warehouseForm.confirmer_userid !== initialUserIds.confirmer_userid;

        if (mgrChanged) userPayload.manager_ids = warehouseForm.manager_user_ids;
        if (viewerChanged) userPayload.viewer_ids = warehouseForm.viewer_user_ids;
        if (confirmerChanged) userPayload.confirmer_userid = warehouseForm.confirmer_userid || null;
      }

      // 只有当有变化字段时才调用用户绑定接口
      if (Object.keys(userPayload).length > 0) {
        await api.put(`/warehouses/${savedWarehouseId}/users`, userPayload);
      }

      // 重新拉一次仓库列表（带最新姓名）
      await fetchWarehouses();
      setShowWarehouseModal(false);
    } catch (err: any) {
      setWarehouseFormError(err.message || '保存失败');
    }
  };

  const handleDeleteWarehouse = async () => {
    if (!deleteWarehouseId) return;
    try {
      await api.delete(`/warehouses/${deleteWarehouseId}`);
      setWarehouses((prev) => prev.filter((w) => w.id !== deleteWarehouseId));
      setDeleteWarehouseId(null);
    } catch (err: any) {
      setWarehouseError(err.message || '删除失败');
      setDeleteWarehouseId(null);
    }
  };

  // ===== 人员选择弹窗辅助函数 =====
  const openPicker = (target: 'manager' | 'viewer') => {
    const currentList =
      target === 'manager'
        ? warehouseForm.manager_user_ids
        : warehouseForm.viewer_user_ids;
    setPickerModal({
      open: true,
      target,
      tempSelected: [...currentList],
      search: '',
    });
  };

  const confirmPicker = () => {
    if (pickerModal.target === 'manager') {
      setWarehouseForm((f) => ({ ...f, manager_user_ids: pickerModal.tempSelected }));
    } else {
      // 自动移除与管理员重复的
      setWarehouseForm((f) => ({
        ...f,
        viewer_user_ids: pickerModal.tempSelected.filter((id) => !f.manager_user_ids.includes(id)),
      }));
    }
    setPickerModal((m) => ({ ...m, open: false }));
  };

  const toggleTempUser = (userId: string) => {
    setPickerModal((m) => {
      const exists = m.tempSelected.includes(userId);
      return {
        ...m,
        tempSelected: exists
          ? m.tempSelected.filter((id) => id !== userId)
          : [...m.tempSelected, userId],
      };
    });
  };

  // ===== 分类数据操作 =====
  const fetchCategoryTree = async () => {
    setCategoryLoading(true);
    setCategoryError('');
    try {
      const data = await api.get<CategoryNode[]>('/warehouses/categories/tree');
      setCategoryTree(data);
      // 默认展开第一层节点
      setExpandedCategoryIds(new Set(data.map((n) => n.id)));
    } catch (err: any) {
      setCategoryError(err.message || '获取分类树失败');
    } finally {
      setCategoryLoading(false);
    }
  };

  // 切换节点展开/折叠
  const toggleCategoryExpand = (id: string) => {
    setExpandedCategoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // 打开新增分类弹窗（可指定父节点）
  const openAddCategory = (parent?: CategoryNode) => {
    if (parent) {
      setCategoryForm({ name: '', parent_id: parent.id, level: parent.level + 1 });
    } else {
      setCategoryForm({ name: '', parent_id: null, level: 1 });
    }
    setCategoryFormError('');
    setShowCategoryModal(true);
  };

  // 打开编辑分类弹窗
  const openEditCategory = (node: CategoryNode) => {
    setCategoryForm({
      id: node.id,
      name: node.name,
      parent_id: node.parent_id || null,
      level: node.level,
    });
    setCategoryFormError('');
    setShowCategoryModal(true);
  };

  // 在树中递归替换节点
  const replaceNode = (nodes: CategoryNode[], updated: CategoryNode): CategoryNode[] => {
    return nodes.map((n) => {
      if (n.id === updated.id) return { ...n, ...updated };
      if (n.children?.length) return { ...n, children: replaceNode(n.children, updated) };
      return n;
    });
  };

  // 在树中递归删除节点
  const removeNode = (nodes: CategoryNode[], id: string): CategoryNode[] => {
    return nodes
      .filter((n) => n.id !== id)
      .map((n) => ({ ...n, children: n.children ? removeNode(n.children, id) : undefined }));
  };

  const handleCategorySubmit = async () => {
    setCategoryFormError('');
    // 名称必填
    if (!categoryForm.name.trim()) {
      setCategoryFormError('请输入分类名称');
      return;
    }
    // 层级限制
    if (categoryForm.level > MAX_CATEGORY_LEVEL) {
      setCategoryFormError(`最多支持 ${MAX_CATEGORY_LEVEL} 级分类`);
      return;
    }
    const payload = {
      name: categoryForm.name.trim(),
      parent_id: categoryForm.parent_id,
      level: categoryForm.level,
    };
    try {
      if (categoryForm.id) {
        const updated = await api.put<CategoryNode>(
          `/warehouses/categories/${categoryForm.id}`,
          payload,
        );
        setCategoryTree((prev) => replaceNode(prev, updated));
      } else {
        const created = await api.post<CategoryNode>('/warehouses/categories', payload);
        // 将新节点插入到树中合适位置
        setCategoryTree((prev) => {
          if (!created.parent_id) {
            return [...prev, created];
          }
          const insertToParent = (nodes: CategoryNode[]): CategoryNode[] => {
            return nodes.map((n) => {
              if (n.id === created.parent_id) {
                return { ...n, children: [...(n.children || []), created] };
              }
              if (n.children?.length) {
                return { ...n, children: insertToParent(n.children) };
              }
              return n;
            });
          };
          return insertToParent(prev);
        });
        // 展开父节点以便看到新增的子分类
        if (created.parent_id) {
          setExpandedCategoryIds((prev) => new Set(prev).add(created.parent_id!));
        }
      }
      setShowCategoryModal(false);
    } catch (err: any) {
      setCategoryFormError(err.message || '保存失败');
    }
  };

  const handleDeleteCategory = async () => {
    if (!deleteCategoryNode) return;
    try {
      await api.delete(`/warehouses/categories/${deleteCategoryNode.id}`);
      setCategoryTree((prev) => removeNode(prev, deleteCategoryNode.id));
      setDeleteCategoryNode(null);
    } catch (err: any) {
      setCategoryError(err.message || '删除失败');
      setDeleteCategoryNode(null);
    }
  };

  // ===== 物资数据操作 =====
  const fetchItems = async () => {
    setItemLoading(true);
    setItemError('');
    try {
      const params: Record<string, any> = {};
      if (keyword.trim()) params.keyword = keyword.trim();
      if (filterCategoryId) params.category_id = filterCategoryId;
      const data = await api.get<WarehouseItem[]>('/warehouses/items', { params });
      setItems(data);
    } catch (err: any) {
      setItemError(err.message || '获取物资列表失败');
    } finally {
      setItemLoading(false);
    }
  };

  // 扁平化分类（供表单下拉与筛选使用）
  const flatCategories = flattenCategories(categoryTree);

  const openAddItem = () => {
    setItemForm(emptyItemForm());
    setItemFormError('');
    setShowItemModal(true);
  };

  const openEditItem = (item: WarehouseItem) => {
    setItemForm({
      id: item.id,
      name: item.name,
      sku: item.sku || '',
      category_id: item.category_id || '',
      unit: item.unit || '',
      reference_price: item.reference_price != null ? String(item.reference_price) : '',
      instant_use: Number(item.instant_use) === 1,
    });
    setItemFormError('');
    setShowItemModal(true);
  };

  const handleItemSubmit = async () => {
    setItemFormError('');
    // 名称必填
    if (!itemForm.name.trim()) {
      setItemFormError('请输入物资名称');
      return;
    }
    // 单位必填
    if (!itemForm.unit.trim()) {
      setItemFormError('请输入计量单位');
      return;
    }
    // 参考单价非负校验
    if (itemForm.reference_price && parseFloat(itemForm.reference_price) < 0) {
      setItemFormError('参考单价不能为负数');
      return;
    }
    const payload = {
      name: itemForm.name.trim(),
      sku: itemForm.sku.trim() || null,
      category_id: itemForm.category_id || null,
      unit: itemForm.unit.trim(),
      reference_price: itemForm.reference_price ? parseFloat(itemForm.reference_price) : null,
      instant_use: itemForm.instant_use ? 1 : 0,
    };
    try {
      if (itemForm.id) {
        const updated = await api.put<WarehouseItem>(`/warehouses/items/${itemForm.id}`, payload);
        setItems((prev) => prev.map((i) => (i.id === itemForm.id ? updated : i)));
      } else {
        const created = await api.post<WarehouseItem>('/warehouses/items', payload);
        setItems((prev) => [created, ...prev]);
      }
      setShowItemModal(false);
    } catch (err: any) {
      if (err.status === 409 || err.code === 409) {
        setItemFormError('已存在同名物资，请修改名称或使用已有物资');
      } else {
        setItemFormError(err.message || '保存失败');
      }
    }
  };

  const handleDeleteItem = async () => {
    if (!deleteItemId) return;
    try {
      await api.delete(`/warehouses/items/${deleteItemId}`);
      setItems((prev) => prev.filter((i) => i.id !== deleteItemId));
      setDeleteItemId(null);
    } catch (err: any) {
      setItemError(err.message || '删除失败');
      setDeleteItemId(null);
    }
  };

  // 递归渲染分类树
  const renderCategoryTree = (nodes: CategoryNode[], depth = 0) => {
    return nodes.map((node) => {
      const hasChildren = !!(node.children && node.children.length > 0);
      const expanded = expandedCategoryIds.has(node.id);
      const canAddChild = node.level < MAX_CATEGORY_LEVEL;
      return (
        <div key={node.id} className="select-none">
          <div
            className="flex items-center gap-2 py-2 px-2 rounded-lg hover:bg-gray-50 group"
            style={{ paddingLeft: `${depth * 24 + 8}px` }}
          >
            {/* 展开/折叠按钮 */}
            <button
              onClick={() => toggleCategoryExpand(node.id)}
              className={`w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-600 ${hasChildren ? '' : 'invisible'}`}
            >
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            {/* 层级标签 */}
            <span
              className={`inline-flex items-center justify-center w-6 h-6 rounded text-xs font-medium ${
                node.level === 1
                  ? 'bg-primary-100 text-primary-700'
                  : node.level === 2
                  ? 'bg-blue-50 text-blue-700'
                  : 'bg-gray-100 text-gray-600'
              }`}
            >
              L{node.level}
            </span>
            {/* 分类名称 */}
            <span className="font-medium text-gray-800 flex-1">{node.name}</span>
            {/* 操作按钮 */}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {canAddChild && (
                <button
                  onClick={() => openAddCategory(node)}
                  className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-md transition-colors"
                  title="新增子分类"
                >
                  <Plus size={14} />
                </button>
              )}
              <button
                onClick={() => openEditCategory(node)}
                className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-md transition-colors"
                title="编辑"
              >
                <Pencil size={14} />
              </button>
              <button
                onClick={() => setDeleteCategoryNode(node)}
                className="p-1.5 text-gray-400 hover:text-danger-600 hover:bg-danger-50 rounded-md transition-colors"
                title="删除"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
          {/* 子节点 */}
          {hasChildren && expanded && <div>{renderCategoryTree(node.children!, depth + 1)}</div>}
        </div>
      );
    });
  };

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div>
        <h1 className="text-2xl font-serif font-bold text-gray-800">仓库管理</h1>
        <p className="text-gray-500 mt-1">管理仓库、物资分类与物资库</p>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-4 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('warehouses')}
          className={`pb-3 px-4 font-medium transition-colors relative ${
            activeTab === 'warehouses'
              ? 'text-primary-600 border-b-2 border-primary-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <div className="flex items-center gap-2">
            <WarehouseIcon size={18} />
            仓库管理
          </div>
        </button>
        <button
          onClick={() => setActiveTab('categories')}
          className={`pb-3 px-4 font-medium transition-colors relative ${
            activeTab === 'categories'
              ? 'text-primary-600 border-b-2 border-primary-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <div className="flex items-center gap-2">
            <FolderTree size={18} />
            分类管理
          </div>
        </button>
        <button
          onClick={() => setActiveTab('items')}
          className={`pb-3 px-4 font-medium transition-colors relative ${
            activeTab === 'items'
              ? 'text-primary-600 border-b-2 border-primary-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <div className="flex items-center gap-2">
            <Package size={18} />
            物资库管理
          </div>
        </button>
      </div>

      {/* ========== Tab1：仓库管理 ========== */}
      {activeTab === 'warehouses' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">共 {warehouses.length} 个仓库</p>
            <button onClick={openAddWarehouse} className="btn-primary flex items-center gap-2">
              <Plus size={18} />
              <span>新增仓库</span>
            </button>
          </div>

          {warehouseError && (
            <div className="bg-danger-50 border border-danger-200 rounded-lg p-4 flex items-center gap-3">
              <AlertCircle size={20} className="text-danger-500" />
              <span className="text-danger-700">{warehouseError}</span>
            </div>
          )}

          {warehouseLoading ? (
            <div className="text-center py-10 text-gray-500">加载中...</div>
          ) : warehouses.length === 0 ? (
            <div className="card flex flex-col items-center justify-center py-20">
              <WarehouseIcon size={64} className="text-gray-300 mb-4" />
              <h3 className="text-lg font-medium text-gray-600 mb-2">暂无仓库</h3>
              <p className="text-gray-400 text-sm">请添加仓库以管理物资</p>
            </div>
          ) : (
            <div className="card overflow-x-auto">
              <table className="data-table min-w-full">
                <thead>
                  <tr>
                    <th>仓库名称</th>
                    <th>类型</th>
                    <th>关联部门</th>
                    <th>管理员</th>
                    <th>确认人</th>
                    <th>位置</th>
                    <th className="text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {warehouses.map((w) => {
                    const typeConf = WAREHOUSE_TYPE_CONFIG[w.type] || {
                      label: w.type,
                      color: 'bg-gray-50 text-gray-700',
                    };
                    return (
                      <tr key={w.id}>
                        <td>
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 bg-primary-100 rounded-lg flex items-center justify-center text-primary-600">
                              <WarehouseIcon size={18} />
                            </div>
                            <span className="font-medium text-gray-800">{w.name}</span>
                          </div>
                        </td>
                        <td>
                          <span className={`tag ${typeConf.color}`}>{typeConf.label}</span>
                        </td>
                        <td className="text-gray-700">{w.department_name || '-'}</td>
                        <td className="text-gray-700">
                          {w.managers && w.managers.length > 0
                            ? (
                              <div className="flex flex-wrap gap-1">
                                {w.managers.map((m) => (
                                  <span
                                    key={m.user_id}
                                    className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-primary-50 text-primary-700"
                                  >
                                    {m.name}
                                  </span>
                                ))}
                              </div>
                            )
                            : w.manager_userid ? (
                              <span className="text-gray-400 text-xs">{w.manager_userid} <AlertCircle size={10} className="inline -mt-0.5" /> 未绑定用户</span>
                            ) : (
                              '-'
                            )}
                        </td>
                        <td className="text-gray-700">{w.confirmer_name || w.confirmer_userid || '-'}</td>
                        <td className="text-gray-700">{w.location || '-'}</td>
                        <td className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => openEditWarehouse(w)}
                              className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-md transition-colors"
                              title="编辑"
                            >
                              <Pencil size={16} />
                            </button>
                            <button
                              onClick={() => setDeleteWarehouseId(w.id)}
                              className="p-1.5 text-gray-400 hover:text-danger-600 hover:bg-danger-50 rounded-md transition-colors"
                              title="删除"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ========== Tab2：分类管理 ========== */}
      {activeTab === 'categories' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">二级分类树形结构</p>
            <button onClick={() => openAddCategory()} className="btn-primary flex items-center gap-2">
              <Plus size={18} />
              <span>新增一级分类</span>
            </button>
          </div>

          {categoryError && (
            <div className="bg-danger-50 border border-danger-200 rounded-lg p-4 flex items-center gap-3">
              <AlertCircle size={20} className="text-danger-500" />
              <span className="text-danger-700">{categoryError}</span>
            </div>
          )}

          {categoryLoading ? (
            <div className="text-center py-10 text-gray-500">加载中...</div>
          ) : categoryTree.length === 0 ? (
            <div className="card flex flex-col items-center justify-center py-20">
              <FolderTree size={64} className="text-gray-300 mb-4" />
              <h3 className="text-lg font-medium text-gray-600 mb-2">暂无分类</h3>
              <p className="text-gray-400 text-sm">请添加一级分类开始管理</p>
            </div>
          ) : (
            <div className="card">
              <div className="space-y-1">{renderCategoryTree(categoryTree)}</div>
              <div className="mt-4 pt-4 border-t border-gray-100 text-xs text-gray-400">
                提示：分类最多支持二级，悬停节点可新增子分类、编辑或删除。
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========== Tab3：物资库管理 ========== */}
      {activeTab === 'items' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">共 {items.length} 项物资</p>
            <button onClick={openAddItem} className="btn-primary flex items-center gap-2">
              <Plus size={18} />
              <span>新增物资</span>
            </button>
          </div>

          {itemError && (
            <div className="bg-danger-50 border border-danger-200 rounded-lg p-4 flex items-center gap-3">
              <AlertCircle size={20} className="text-danger-500" />
              <span className="text-danger-700">{itemError}</span>
            </div>
          )}

          <div className="card">
            {/* 搜索与分类筛选 */}
            <div className="space-y-3 mb-5">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  type="text"
                  placeholder="搜索物资名称或 SKU..."
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  className="search-input"
                />
                {keyword && (
                  <button
                    onClick={() => setKeyword('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 rounded-md hover:bg-gray-100"
                    title="清除"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setFilterCategoryId('')}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    !filterCategoryId
                      ? 'bg-primary-500 text-white shadow-sm'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  全部分类
                </button>
                {flatCategories.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => setFilterCategoryId(filterCategoryId === cat.id ? '' : cat.id)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                      filterCategoryId === cat.id
                        ? 'bg-primary-500 text-white shadow-sm'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
            </div>

            {itemLoading ? (
              <div className="text-center py-10 text-gray-500">加载中...</div>
            ) : items.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <Package size={40} className="mx-auto mb-3 opacity-50" />
                <p>暂无物资数据</p>
              </div>
            ) : (
              <div className="overflow-x-auto -mx-6 px-6">
                <table className="data-table min-w-full">
                  <thead>
                    <tr>
                      <th>物资名称</th>
                      <th>SKU</th>
                      <th>分类</th>
                      <th>单位</th>
                      <th className="text-right">参考单价</th>
                      <th>属性</th>
                      <th className="text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id}>
                        <td className="font-medium text-gray-800">{item.name}</td>
                        <td className="text-gray-600">{item.sku || '-'}</td>
                        <td className="text-gray-600">
                          {item.category_full_path || item.category_name || '-'}
                        </td>
                        <td className="text-gray-700">{item.unit || '-'}</td>
                        <td className="text-right font-medium text-primary-600">
                          {item.reference_price != null
                            ? `¥${Number(item.reference_price).toFixed(2)}`
                            : '-'}
                        </td>
                        <td>
                          {Number(item.instant_use) === 1 && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
                              即采即用
                            </span>
                          )}
                        </td>
                        <td className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => openEditItem(item)}
                              className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-md transition-colors"
                              title="编辑"
                            >
                              <Pencil size={16} />
                            </button>
                            <button
                              onClick={() => setDeleteItemId(item.id)}
                              className="p-1.5 text-gray-400 hover:text-danger-600 hover:bg-danger-50 rounded-md transition-colors"
                              title="删除"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========== 仓库新增/编辑弹窗 ========== */}
      {showWarehouseModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowWarehouseModal(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[92vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-800">
                {warehouseForm.id ? '编辑仓库' : '新增仓库'}
              </h3>
              <button onClick={() => setShowWarehouseModal(false)} className="p-1 hover:bg-gray-100 rounded-md">
                <X size={20} className="text-gray-500" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {/* 仓库名称 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  仓库名称 <span className="text-danger-500">*</span>
                </label>
                <input
                  type="text"
                  value={warehouseForm.name}
                  onChange={(e) => setWarehouseForm({ ...warehouseForm, name: e.target.value })}
                  placeholder="请输入仓库名称"
                  className="input-field"
                  autoFocus
                />
              </div>
              {/* 仓库类型 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  仓库类型 <span className="text-danger-500">*</span>
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(WAREHOUSE_TYPE_CONFIG) as WarehouseType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setWarehouseForm({ ...warehouseForm, type: t })}
                      className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                        warehouseForm.type === t
                          ? 'bg-primary-500 text-white shadow-sm'
                          : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      {WAREHOUSE_TYPE_CONFIG[t].label}
                    </button>
                  ))}
                </div>
              </div>
              {/* 关联部门 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  关联部门
                  {warehouseForm.type === 'dept' && <span className="text-danger-500"> *</span>}
                </label>
                <select
                  value={warehouseForm.department_id}
                  onChange={(e) => setWarehouseForm({ ...warehouseForm, department_id: e.target.value })}
                  className="input-field"
                >
                  <option value="">
                    {warehouseForm.type === 'dept' ? '请选择部门' : '可选：绑定确认部门'}
                  </option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                {warehouseForm.type !== 'dept' && (
                  <p className="text-xs text-gray-400 mt-1">绑定部门后，该仓库的入库确认将通知对应部门确认人</p>
                )}
              </div>
              {/* 仓库管理员（弹窗式多选） */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  仓库管理员<span className="text-xs text-gray-400 font-normal ml-1">可多选，可执行出入库</span>
                </label>
                <button
                  type="button"
                  onClick={() => openPicker('manager')}
                  className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-left text-sm hover:bg-gray-50 hover:border-gray-300 transition-colors"
                >
                  <span className="text-gray-500 mr-2">选择管理员</span>
                  {warehouseForm.manager_user_ids.length > 0 ? (
                    <span className="text-primary-600 font-medium">
                      已选 {warehouseForm.manager_user_ids.length} 人
                    </span>
                  ) : (
                    <span className="text-gray-400">（点击选择）</span>
                  )}
                </button>
                {warehouseForm.manager_user_ids.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {warehouseForm.manager_user_ids.map((id) => {
                      const u = systemUsers.find((x) => x.id === id);
                      if (!u) return null;
                      return (
                        <span
                          key={id}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-primary-100 text-primary-700"
                        >
                          {u.name}
                          <button
                            onClick={() =>
                              setWarehouseForm((f) => ({
                                ...f,
                                manager_user_ids: f.manager_user_ids.filter((x) => x !== id),
                              }))
                            }
                            className="text-primary-500 hover:text-primary-800"
                          >
                            <X size={12} />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 仓库查看人（弹窗式多选） */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  仓库查看人<span className="text-xs text-gray-400 font-normal ml-1">可多选，仅查看数据</span>
                </label>
                <button
                  type="button"
                  onClick={() => openPicker('viewer')}
                  className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-left text-sm hover:bg-gray-50 hover:border-gray-300 transition-colors"
                >
                  <span className="text-gray-500 mr-2">选择查看人</span>
                  {warehouseForm.viewer_user_ids.length > 0 ? (
                    <span className="text-blue-600 font-medium">
                      已选 {warehouseForm.viewer_user_ids.length} 人
                    </span>
                  ) : (
                    <span className="text-gray-400">（点击选择）</span>
                  )}
                </button>
                <p className="text-xs text-gray-400 mt-1">已选为管理员的用户自动含查看权限，无需重复选择</p>
                {warehouseForm.viewer_user_ids.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {warehouseForm.viewer_user_ids.map((id) => {
                      const u = systemUsers.find((x) => x.id === id);
                      if (!u) return null;
                      return (
                        <span
                          key={id}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700"
                        >
                          {u.name}
                          <button
                            onClick={() =>
                              setWarehouseForm((f) => ({
                                ...f,
                                viewer_user_ids: f.viewer_user_ids.filter((x) => x !== id),
                              }))
                            }
                            className="text-blue-500 hover:text-blue-800"
                          >
                            <X size={12} />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 确认人：直接填企微 userid */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  确认人<span className="text-xs text-gray-400 font-normal ml-1">采购入库/盘点将通知此人</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={warehouseForm.confirmer_userid}
                    onChange={(e) =>
                      setWarehouseForm((f) => ({ ...f, confirmer_userid: e.target.value.trim() }))
                    }
                    placeholder="请输入企微 userid，例如：zhangsan"
                    className="input-field flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => setConfirmerPickerModal({ open: true, search: '' })}
                    className="px-3 py-2 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 whitespace-nowrap"
                  >
                    从系统用户选择
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  直接填写企微 userid。若对应人员在系统用户中已配置 wecom_userid，也可点击右侧快速选择自动填入。
                </p>
                {warehouseForm.confirmer_userid && (() => {
                  const matchedUser = systemUsers.find((u) => u.wecom_userid === warehouseForm.confirmer_userid);
                  return (
                    <div className="mt-2 flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs">
                      <span className="text-amber-800">
                        当前：{warehouseForm.confirmer_userid}
                        {matchedUser && <span className="ml-2 text-amber-600">（{matchedUser.name}）</span>}
                      </span>
                      <button
                        type="button"
                        onClick={() => setWarehouseForm((f) => ({ ...f, confirmer_userid: '' }))}
                        className="text-amber-600 hover:text-amber-800"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  );
                })()}
              </div>
              {/* 仓库位置 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">仓库位置</label>
                <input
                  type="text"
                  value={warehouseForm.location}
                  onChange={(e) => setWarehouseForm({ ...warehouseForm, location: e.target.value })}
                  placeholder="请输入仓库位置"
                  className="input-field"
                />
              </div>
              {/* 参与月末盘点 */}
              <div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={warehouseForm.enable_stock_take}
                    onChange={(e) =>
                      setWarehouseForm({ ...warehouseForm, enable_stock_take: e.target.checked })
                    }
                    className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="text-sm font-medium text-gray-700">参与月末盘点</span>
                  <span className="text-xs text-gray-400">开启后该仓库参与月末盘点流程</span>
                </label>
              </div>

              {warehouseFormError && (
                <div className="flex items-center gap-2 text-danger-600 bg-danger-50 p-3 rounded-lg text-sm">
                  <AlertCircle size={16} />
                  <span>{warehouseFormError}</span>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 p-5 border-t border-gray-100">
              <button onClick={() => setShowWarehouseModal(false)} className="btn-secondary">
                取消
              </button>
              <button onClick={handleWarehouseSubmit} className="btn-primary flex items-center gap-2">
                <Check size={18} />
                <span>{warehouseForm.id ? '保存修改' : '确认新增'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== 管理员/查看人 人员选择弹窗 ========== */}
      {pickerModal.open && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4"
          onClick={() => setPickerModal((m) => ({ ...m, open: false }))}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-800">
                选择{pickerModal.target === 'manager' ? '仓库管理员' : '仓库查看人'}
              </h3>
              <button
                onClick={() => setPickerModal((m) => ({ ...m, open: false }))}
                className="p-1 hover:bg-gray-100 rounded-md"
              >
                <X size={20} className="text-gray-500" />
              </button>
            </div>
            <div className="p-5">
              {/* 搜索 */}
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  type="text"
                  value={pickerModal.search}
                  onChange={(e) => setPickerModal((m) => ({ ...m, search: e.target.value }))}
                  placeholder="搜索姓名 / 用户名..."
                  className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
                />
              </div>
              {/* 列表 */}
              <div className="border border-gray-200 rounded-lg overflow-hidden max-h-72 overflow-y-auto divide-y divide-gray-50">
                {(() => {
                  const isViewer = pickerModal.target === 'viewer';
                  const managerIds = warehouseForm.manager_user_ids;
                  const filtered = systemUsers.filter((u) => {
                    if (isViewer && managerIds.includes(u.id)) return false;
                    if (!pickerModal.search) return true;
                    const kw = pickerModal.search.trim();
                    if (!kw) return true;
                    return (
                      u.name.includes(kw) ||
                      (u.username && u.username.includes(kw))
                    );
                  });
                  if (systemUsers.length === 0) {
                    return (
                      <div className="px-3 py-8 text-xs text-gray-400 text-center">用户列表加载中...</div>
                    );
                  }
                  if (filtered.length === 0) {
                    return (
                      <div className="px-3 py-8 text-xs text-gray-400 text-center">
                        {isViewer && managerIds.length > 0 && systemUsers.every((u) => managerIds.includes(u.id))
                          ? '已没有可分配的用户（管理员自动含查看权限）'
                          : '没有匹配的用户'}
                      </div>
                    );
                  }
                  return filtered.map((u) => {
                    const selected = pickerModal.tempSelected.includes(u.id);
                    return (
                      <div
                        key={u.id}
                        onClick={() => toggleTempUser(u.id)}
                        className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors ${
                          selected ? 'bg-primary-50' : ''
                        }`}
                      >
                        <div
                          className={`w-5 h-5 rounded-md border flex items-center justify-center flex-shrink-0 ${
                            selected
                              ? 'bg-primary-500 border-primary-500'
                              : 'border-gray-300'
                          }`}
                        >
                          {selected && <Check size={12} className="text-white" />}
                        </div>
                        <span className="flex-1 text-sm text-gray-800">{u.name}</span>
                        {u.role && (
                          <span className="text-xs text-gray-400">{u.role}</span>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
              <p className="mt-2 text-xs text-gray-400">
                已选 {pickerModal.tempSelected.length} 人
              </p>
            </div>
            <div className="flex justify-end gap-3 p-5 border-t border-gray-100">
              <button
                onClick={() => setPickerModal((m) => ({ ...m, open: false }))}
                className="btn-secondary"
              >
                取消
              </button>
              <button onClick={confirmPicker} className="btn-primary flex items-center gap-2">
                <Check size={16} />
                <span>确认选择</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== 确认人快速选择（从系统用户里选一个 wecom_userid） ========== */}
      {confirmerPickerModal.open && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4"
          onClick={() => setConfirmerPickerModal((m) => ({ ...m, open: false }))}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-800">从系统用户快速选择确认人</h3>
              <button
                onClick={() => setConfirmerPickerModal((m) => ({ ...m, open: false }))}
                className="p-1 hover:bg-gray-100 rounded-md"
              >
                <X size={20} className="text-gray-500" />
              </button>
            </div>
            <div className="p-5">
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  type="text"
                  value={confirmerPickerModal.search}
                  onChange={(e) => setConfirmerPickerModal((m) => ({ ...m, search: e.target.value }))}
                  placeholder="搜索姓名 / 企微 userid..."
                  className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                />
              </div>
              <div className="border border-gray-200 rounded-lg overflow-hidden max-h-72 overflow-y-auto divide-y divide-gray-50">
                {(() => {
                  const kw = confirmerPickerModal.search.trim();
                  const filtered = systemUsers.filter((u) => {
                    if (!kw) return true;
                    return (
                      u.name.includes(kw) ||
                      (u.wecom_userid && u.wecom_userid.includes(kw)) ||
                      (u.username && u.username.includes(kw))
                    );
                  });
                  if (systemUsers.length === 0) {
                    return (
                      <div className="px-3 py-8 text-xs text-gray-400 text-center">用户列表加载中...</div>
                    );
                  }
                  if (filtered.length === 0) {
                    return (
                      <div className="px-3 py-8 text-xs text-gray-400 text-center">没有匹配的用户</div>
                    );
                  }
                  return filtered.map((u) => {
                    const selected = warehouseForm.confirmer_userid && u.wecom_userid
                      ? warehouseForm.confirmer_userid === u.wecom_userid
                      : false;
                    return (
                      <div
                        key={u.id}
                        onClick={() => {
                          if (u.wecom_userid) {
                            setWarehouseForm((f) => ({ ...f, confirmer_userid: u.wecom_userid! }));
                          }
                          setConfirmerPickerModal((m) => ({ ...m, open: false }));
                        }}
                        className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors ${
                          selected ? 'bg-amber-50' : ''
                        }`}
                      >
                        <div
                          className={`w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0 ${
                            selected
                              ? 'bg-amber-500 border-amber-500'
                              : 'border-gray-300'
                          }`}
                        >
                          {selected && <div className="w-2 h-2 rounded-full bg-white" />}
                        </div>
                        <div className="flex-1">
                          <div className="text-sm text-gray-800">{u.name}</div>
                          <div className="text-xs text-gray-400">
                            wecom_userid:{' '}
                            {u.wecom_userid ? (
                              <span className="font-mono text-gray-600">{u.wecom_userid}</span>
                            ) : (
                              <span className="text-danger-500">未配置，点击无效</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
            <div className="flex justify-end gap-3 p-5 border-t border-gray-100">
              <button
                onClick={() => setConfirmerPickerModal((m) => ({ ...m, open: false }))}
                className="btn-secondary"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== 分类新增/编辑弹窗 ========== */}
      {showCategoryModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowCategoryModal(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-800">
                {categoryForm.id
                  ? '编辑分类'
                  : `新增${categoryForm.level === 1 ? '一级' : categoryForm.level === 2 ? '二级' : '三级'}分类`}
              </h3>
              <button onClick={() => setShowCategoryModal(false)} className="p-1 hover:bg-gray-100 rounded-md">
                <X size={20} className="text-gray-500" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  分类名称 <span className="text-danger-500">*</span>
                </label>
                <input
                  type="text"
                  value={categoryForm.name}
                  onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                  placeholder="请输入分类名称"
                  className="input-field"
                  autoFocus
                />
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-500">
                <p>
                  层级：第 {categoryForm.level} 级（最多 {MAX_CATEGORY_LEVEL} 级）
                </p>
                {categoryForm.parent_id && <p className="mt-1">父分类 ID：{categoryForm.parent_id}</p>}
              </div>

              {categoryFormError && (
                <div className="flex items-center gap-2 text-danger-600 bg-danger-50 p-3 rounded-lg text-sm">
                  <AlertCircle size={16} />
                  <span>{categoryFormError}</span>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 p-5 border-t border-gray-100">
              <button onClick={() => setShowCategoryModal(false)} className="btn-secondary">
                取消
              </button>
              <button onClick={handleCategorySubmit} className="btn-primary flex items-center gap-2">
                <Check size={18} />
                <span>{categoryForm.id ? '保存修改' : '确认新增'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== 物资新增/编辑弹窗 ========== */}
      {showItemModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowItemModal(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-800">
                {itemForm.id ? '编辑物资' : '新增物资'}
              </h3>
              <button onClick={() => setShowItemModal(false)} className="p-1 hover:bg-gray-100 rounded-md">
                <X size={20} className="text-gray-500" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {/* 物资名称 */}
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    物资名称 <span className="text-danger-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={itemForm.name}
                    onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                    placeholder="请输入物资名称"
                    className="input-field"
                    autoFocus
                  />
                </div>
                {/* SKU */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">SKU 编码</label>
                  <input
                    type="text"
                    value={itemForm.sku}
                    onChange={(e) => setItemForm({ ...itemForm, sku: e.target.value })}
                    placeholder="请输入 SKU"
                    className="input-field"
                  />
                </div>
                {/* 计量单位 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    计量单位 <span className="text-danger-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={itemForm.unit}
                    onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })}
                    placeholder="如：个、公斤、箱"
                    className="input-field"
                  />
                </div>
                {/* 所属分类 */}
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">所属分类</label>
                  <select
                    value={itemForm.category_id}
                    onChange={(e) => setItemForm({ ...itemForm, category_id: e.target.value })}
                    className="input-field"
                  >
                    <option value="">未分类</option>
                    {flatCategories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>
                {/* 参考单价 */}
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">参考单价（元）</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={itemForm.reference_price}
                    onChange={(e) => setItemForm({ ...itemForm, reference_price: e.target.value })}
                    placeholder="请输入参考单价"
                    className="input-field"
                  />
                </div>
                {/* 即采即用 */}
                <div className="col-span-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={itemForm.instant_use}
                      onChange={(e) => setItemForm({ ...itemForm, instant_use: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm font-medium text-gray-700">即采即用</span>
                    <span className="text-xs text-gray-400">（入库后自动出库归零，成本直接归集部门）</span>
                  </label>
                </div>
              </div>

              {itemFormError && (
                <div className="flex items-center gap-2 text-danger-600 bg-danger-50 p-3 rounded-lg text-sm">
                  <AlertCircle size={16} />
                  <span>{itemFormError}</span>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 p-5 border-t border-gray-100">
              <button onClick={() => setShowItemModal(false)} className="btn-secondary">
                取消
              </button>
              <button onClick={handleItemSubmit} className="btn-primary flex items-center gap-2">
                <Check size={18} />
                <span>{itemForm.id ? '保存修改' : '确认新增'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== 删除确认弹窗（仓库） ========== */}
      {deleteWarehouseId && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setDeleteWarehouseId(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 text-center">
              <div className="w-14 h-14 bg-danger-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="text-danger-500" size={28} />
              </div>
              <h3 className="text-lg font-semibold text-gray-800 mb-2">确认删除</h3>
              <p className="text-gray-500 text-sm">删除后该仓库将被移除，确认要删除吗？</p>
            </div>
            <div className="flex justify-center gap-3 p-5 border-t border-gray-100">
              <button onClick={() => setDeleteWarehouseId(null)} className="btn-secondary">
                取消
              </button>
              <button
                onClick={handleDeleteWarehouse}
                className="bg-danger-500 hover:bg-danger-600 text-white px-4 py-2 rounded-lg font-medium transition-colors"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== 删除确认弹窗（分类） ========== */}
      {deleteCategoryNode && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setDeleteCategoryNode(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 text-center">
              <div className="w-14 h-14 bg-danger-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="text-danger-500" size={28} />
              </div>
              <h3 className="text-lg font-semibold text-gray-800 mb-2">确认删除</h3>
              <p className="text-gray-500 text-sm">
                确定删除分类「{deleteCategoryNode.name}」吗？
                {deleteCategoryNode.children && deleteCategoryNode.children.length > 0 && (
                  <span className="block mt-1 text-danger-600">
                    该分类下有子分类，删除后子分类也将被移除。
                  </span>
                )}
              </p>
            </div>
            <div className="flex justify-center gap-3 p-5 border-t border-gray-100">
              <button onClick={() => setDeleteCategoryNode(null)} className="btn-secondary">
                取消
              </button>
              <button
                onClick={handleDeleteCategory}
                className="bg-danger-500 hover:bg-danger-600 text-white px-4 py-2 rounded-lg font-medium transition-colors"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== 删除确认弹窗（物资） ========== */}
      {deleteItemId && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setDeleteItemId(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 text-center">
              <div className="w-14 h-14 bg-danger-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="text-danger-500" size={28} />
              </div>
              <h3 className="text-lg font-semibold text-gray-800 mb-2">确认删除</h3>
              <p className="text-gray-500 text-sm">删除后该物资将被移除，确认要删除吗？</p>
            </div>
            <div className="flex justify-center gap-3 p-5 border-t border-gray-100">
              <button onClick={() => setDeleteItemId(null)} className="btn-secondary">
                取消
              </button>
              <button
                onClick={handleDeleteItem}
                className="bg-danger-500 hover:bg-danger-600 text-white px-4 py-2 rounded-lg font-medium transition-colors"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
