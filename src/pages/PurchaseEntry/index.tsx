import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, Plus, Trash2, Search,
  Calendar, ShoppingCart, CheckCircle2, X, Package, Settings, AlertCircle, Cloud, ClipboardList, Save, Send
} from 'lucide-react';
import { format, subDays, addDays } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { useIngredientStore } from '@/store/ingredientStore';
import { useCategoryStore } from '@/store/categoryStore';
import { useDepartmentStore } from '@/store/departmentStore';
import { useSupplierStore } from '@/store/supplierStore';
import type { Ingredient, UnitConversion } from '@/types';
import { usePurchaseStore, type PurchaseEntryItem } from '@/store/purchaseStore';
import { formatCurrency, formatNumber, generateId } from '@/utils/format';
import { formatDate } from '@/utils/date';
import BatchPasteModal from '@/components/BatchPasteModal';
import { api } from '@/lib/api';

interface DraftItem {
  id: string;
  ingredientId: string;
  ingredientName: string;
  categoryId: string;
  categoryName: string;
  departmentId: string;
  departmentName: string;
  supplierId: string;
  supplierName: string;
  purchaseUnit: string;
  factor: number;
  baseUnit: string;
  purchaseQuantity: number;
  purchaseUnitPrice: number;
}

const toEntryItem = (d: DraftItem): PurchaseEntryItem => {
  const amount = Math.round(d.purchaseUnitPrice * d.purchaseQuantity * 100) / 100;
  const baseUnitPrice = Math.round((d.purchaseUnitPrice / d.factor) * 100) / 100;
  const baseQuantity = Math.round(d.purchaseQuantity / d.factor * 100) / 100;
  return {
    id: d.id,
    ingredientId: d.ingredientId,
    ingredientName: d.ingredientName,
    categoryId: d.categoryId,
    categoryName: d.categoryName,
    departmentId: d.departmentId,
    departmentName: d.departmentName,
    supplierId: d.supplierId,
    supplierName: d.supplierName,
    purchaseUnit: d.purchaseUnit,
    purchaseQuantity: d.purchaseQuantity,
    purchaseUnitPrice: d.purchaseUnitPrice,
    baseUnit: d.baseUnit,
    baseUnitPrice,
    baseQuantity,
    amount,
  };
};

interface QuickIngredientForm {
  name: string;
  categoryId: string;
  baseUnit: string;
  basePrice: string;
}

export default function PurchaseEntry() {
  const navigate = useNavigate();
  const { saveDateItems, fetchRecords, clearDate, movePurchaseDate } = usePurchaseStore();
  const { ingredients, addIngredient } = useIngredientStore();
  const { categories } = useCategoryStore();
  const { departments, fetchDepartments, getDefaultDepartment } = useDepartmentStore();
  const { suppliers, fetchSuppliers, getDefaultSupplier } = useSupplierStore();

  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const params = new URLSearchParams(window.location.search);
    const dateParam = params.get('date');
    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      const d = new Date(dateParam + 'T00:00:00');
      if (!isNaN(d.getTime())) {
        d.setHours(0, 0, 0, 0);
        return d;
      }
    }
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const [showMainDatePicker, setShowMainDatePicker] = useState(false);
  const [mainTempDate, setMainTempDate] = useState(format(selectedDate, 'yyyy-MM-dd'));

  const dateStr = formatDate(selectedDate);
  const dateLabel = format(selectedDate, 'yyyy年MM月dd日 EEEE', { locale: zhCN });

  // 草稿列表
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState<string | null>(null);

  // 快速新增食材弹窗
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickForm, setQuickForm] = useState<QuickIngredientForm>({
    name: '',
    categoryId: '',
    baseUnit: '',
    basePrice: '',
  });
  const [quickError, setQuickError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState<string | null>(null);
  const [movingItem, setMovingItem] = useState<DraftItem | null>(null);
  const [showBatchPaste, setShowBatchPaste] = useState(false);
  const [sendingWecom, setSendingWecom] = useState(false);

  useEffect(() => {
    fetchDepartments();
    fetchSuppliers();
  }, [fetchDepartments, fetchSuppliers]);

  // 加载已有录入数据（异步）
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      await fetchRecords(dateStr);
      if (cancelled) return;

      const existing = usePurchaseStore.getState().records[dateStr] || [];
      setDraftItems(existing.map((it) => ({
        id: it.id,
        ingredientId: it.ingredientId,
        ingredientName: it.ingredientName,
        categoryId: it.categoryId,
        categoryName: it.categoryName,
        departmentId: it.departmentId,
        departmentName: it.departmentName,
        supplierId: it.supplierId || '',
        supplierName: it.supplierName || '',
        purchaseUnit: it.purchaseUnit,
        factor: it.purchaseUnitPrice > 0 ? (ingredients.find(i => i.id === it.ingredientId)?.units.find(u => u.unit === it.purchaseUnit)?.factor || 1) : 1,
        baseUnit: it.baseUnit,
        purchaseQuantity: it.purchaseQuantity,
        purchaseUnitPrice: it.purchaseUnitPrice,
      })));
      setLoading(false);
      setHasUnsavedChanges(false);
    };
    load();
    return () => { cancelled = true; };
  }, [dateStr, fetchRecords, ingredients]);

  const filteredIngredients = useMemo(() => {
    return ingredients.filter(ing => {
      const matchSearch = ing.name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchCategory = !filterCategory || ing.categoryId === filterCategory;
      return matchSearch && matchCategory;
    });
  }, [searchTerm, filterCategory]);

  const totalAmount = useMemo(() => {
    return Math.round(draftItems.reduce((sum, item) => {
      return sum + (item.purchaseUnitPrice * item.purchaseQuantity);
    }, 0) * 100) / 100;
  }, [draftItems]);

  const totalItems = draftItems.length;

  const categoryStats = useMemo(() => {
    const map = new Map<string, { name: string; color: string; amount: number; count: number }>();
    draftItems.forEach(item => {
      const existing = map.get(item.categoryId) || {
        name: item.categoryName,
        color: categories.find(c => c.id === item.categoryId)?.color || '#999',
        amount: 0,
        count: 0,
      };
      existing.amount += item.purchaseUnitPrice * item.purchaseQuantity;
      existing.count += 1;
      map.set(item.categoryId, existing);
    });
    return Array.from(map.entries()).map(([id, data]) => ({
      id, ...data, amount: Math.round(data.amount * 100) / 100,
    }));
  }, [draftItems]);

  const handlePrevDay = () => setSelectedDate(prev => subDays(prev, 1));
  const handleNextDay = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (selectedDate < today) setSelectedDate(prev => addDays(prev, 1));
  };

  const handleDatePickerOpen = () => {
    setMainTempDate(format(selectedDate, 'yyyy-MM-dd'));
    setShowMainDatePicker(true);
  };

  const handleConfirmDate = () => {
    const date = new Date(mainTempDate);
    date.setHours(0, 0, 0, 0);
    setSelectedDate(date);
    setShowMainDatePicker(false);
  };

  const addIngredientToList = (ing: Ingredient) => {
    const commonUnit = ing.units.find(u => u.isCommon) || ing.units[0];
    const category = categories.find(c => c.id === ing.categoryId);
    const defaultDept = getDefaultDepartment();
    const defaultSupplier = getDefaultSupplier();
    const newItem: DraftItem = {
      id: Math.random().toString(36).substring(2, 11),
      ingredientId: ing.id,
      ingredientName: ing.name,
      categoryId: ing.categoryId,
      categoryName: category?.name || '',
      departmentId: defaultDept?.id || '',
      departmentName: defaultDept?.name || '',
      supplierId: defaultSupplier?.id || '',
      supplierName: defaultSupplier?.name || '',
      purchaseUnit: commonUnit.unit,
      factor: commonUnit.factor,
      baseUnit: ing.baseUnit,
      purchaseQuantity: 1,
      purchaseUnitPrice: Math.round(ing.basePrice * commonUnit.factor * 100) / 100,
    };
    setDraftItems(prev => [...prev, newItem]);
    setHasUnsavedChanges(true);
    setShowAddPanel(false);
    setSearchTerm('');
  };

  const updateDraftItem = (id: string, field: keyof DraftItem, value: string | number) => {
    setDraftItems(prev => prev.map(item => {
      if (item.id !== id) return item;
      const updated = { ...item, [field]: value };
      if (field === 'purchaseUnit') {
        const ing = ingredients.find(i => i.id === item.ingredientId);
        const unitObj = ing?.units.find((u: UnitConversion) => u.unit === value);
        if (unitObj) updated.factor = unitObj.factor;
      }
      return updated;
    }));
    setHasUnsavedChanges(true);
  };

  const removeDraftItem = (id: string) => {
    setDraftItems(prev => prev.filter(item => item.id !== id));
    setHasUnsavedChanges(true);
  };

  const handleSave = async () => {
    if (draftItems.length === 0) {
      if (window.confirm('当前没有数据，保存后将清空当日所有记录，确定继续吗？')) {
        await clearDate(dateStr);
        setHasUnsavedChanges(false);
        setSaveError('');
      }
      return;
    }

    setIsSaving(true);
    setSaveError('');
    try {
      const entryItems = draftItems.map(toEntryItem);
      const savedItems = await saveDateItems(dateStr, entryItems);
      if (savedItems) {
        setDraftItems(prev => prev.map((item, idx) => {
          if (idx < savedItems.length && savedItems[idx]) {
            return {
              ...item,
              id: savedItems[idx].id,
            };
          }
          return item;
        }));
        setHasUnsavedChanges(false);
      } else {
        setSaveError('保存失败，请重试');
      }
    } catch (err: any) {
      setSaveError(err.message || '保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendToWecom = async () => {
    if (draftItems.length === 0) {
      setSaveError('请先添加采购食材');
      return;
    }

    const hasUnsaved = hasUnsavedChanges;
    if (hasUnsaved) {
      // 先保存
      setIsSaving(true);
      try {
        const entryItems = draftItems.map(toEntryItem);
        const savedItems = await saveDateItems(dateStr, entryItems);
        if (!savedItems) {
          setSaveError('保存失败，无法发送');
          return;
        }
        setHasUnsavedChanges(false);
      } catch (err: any) {
        setSaveError(err.message || '保存失败');
        return;
      } finally {
        setIsSaving(false);
      }
    }

    setSendingWecom(true);
    setSaveError('');
    try {
      const entryItems = draftItems.map(toEntryItem);
      const totalAmount = entryItems.reduce((sum, item) => sum + item.amount, 0);

      // 按部门分组
      const deptMap: Record<string, { id: string; name: string }> = {};
      for (const item of entryItems) {
        if (item.departmentId && !deptMap[item.departmentId]) {
          deptMap[item.departmentId] = { id: item.departmentId, name: item.departmentName || '' };
        }
      }
      const departments = Object.values(deptMap);

      await api.post('/purchase-confirmations', {
        purchase_date: dateStr,
        total_amount: totalAmount,
        departments,
        purchase_items: entryItems.map(item => ({
          ingredient_name: item.ingredientName,
          purchase_unit: item.purchaseUnit,
          purchase_quantity: item.purchaseQuantity,
          purchase_unit_price: item.purchaseUnitPrice,
          amount: item.amount,
          department_name: item.departmentName || '',
        })),
      });

      alert('已发送到企业微信群，等待厨房确认');
    } catch (err: any) {
      setSaveError(err.message || '发送失败');
    } finally {
      setSendingWecom(false);
    }
  };

  const handleMoveDate = (item: DraftItem) => {
    setMovingItem(item);
    setShowDatePicker(item.id);
  };

  const handleSelectDate = async (targetDateStr: string) => {
    if (!movingItem) return;
    
    const success = await movePurchaseDate(movingItem.id, dateStr, targetDateStr);
    if (success) {
      setDraftItems(prev => prev.filter(item => item.id !== movingItem!.id));
    }
    setShowDatePicker(null);
    setMovingItem(null);
  };

  const handleClear = () => {
    if (window.confirm('确定清空当日所有录入数据吗？')) {
      setDraftItems([]);
      setHasUnsavedChanges(true);
    }
  };

  const handleViewDaily = () => {
    navigate('/daily');
  };

  const handleBatchImport = (items: PurchaseEntryItem[]) => {
    const defaultSupplier = getDefaultSupplier();
    const newDraftItems: DraftItem[] = items.map(item => {
      const ing = ingredients.find(i => i.id === item.ingredientId);
      const unitObj = ing?.units.find(u => u.unit === item.purchaseUnit);
      return {
        id: item.id,
        ingredientId: item.ingredientId,
        ingredientName: item.ingredientName,
        categoryId: item.categoryId,
        categoryName: item.categoryName,
        departmentId: item.departmentId,
        departmentName: item.departmentName,
        supplierId: item.supplierId || defaultSupplier?.id || '',
        supplierName: item.supplierName || defaultSupplier?.name || '',
        purchaseUnit: item.purchaseUnit,
        factor: unitObj?.factor || 1,
        baseUnit: item.baseUnit,
        purchaseQuantity: item.purchaseQuantity,
        purchaseUnitPrice: item.purchaseUnitPrice,
      };
    });
    setDraftItems(prev => [...prev, ...newDraftItems]);
    setHasUnsavedChanges(true);
  };

  const existingRecord = draftItems.length > 0;

  return (
    <div className="space-y-6">
      {/* 顶部标题与日期选择 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-serif font-bold text-gray-800">采买清单录入</h1>
          <p className="text-gray-500 mt-1">录入每日实际采买明细，点击保存按钮保存数据</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-white rounded-lg border border-gray-200 p-1">
            <button onClick={handlePrevDay} className="p-2 hover:bg-gray-100 rounded-md transition-colors">
              <ChevronLeft size={18} />
            </button>
            <button onClick={handleDatePickerOpen} className="px-4 py-1.5 min-w-[180px] text-center font-medium text-sm hover:bg-gray-50 rounded-md transition-colors">
              {dateLabel}
            </button>
            <button onClick={handleNextDay} className="p-2 hover:bg-gray-100 rounded-md transition-colors">
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* 统计概览 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-gray-500 font-medium">录入总金额</p>
              <p className="text-2xl font-bold mt-2 text-primary-600">{formatCurrency(totalAmount)}</p>
            </div>
            <div className="w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center text-primary-600">
              <ShoppingCart size={24} />
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-gray-500 font-medium">录入品类数</p>
              <p className="text-2xl font-bold mt-2 text-accent-600">{totalItems} <span className="text-base font-normal text-gray-400">种</span></p>
            </div>
            <div className="w-12 h-12 bg-accent-100 rounded-xl flex items-center justify-center text-accent-600">
              <Package size={24} />
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-gray-500 font-medium">录入状态</p>
              <p className="text-lg font-bold mt-2 flex items-center gap-2">
                {isSaving ? (
                  <><Cloud className="text-primary-500 animate-pulse" size={20} /><span className="text-primary-600">保存中...</span></>
                ) : saveError ? (
                  <><AlertCircle className="text-danger-500" size={20} /><span className="text-danger-600">保存失败</span></>
                ) : hasUnsavedChanges ? (
                  <><Settings className="text-warning-500" size={20} /><span className="text-warning-600">未保存</span></>
                ) : draftItems.length > 0 ? (
                  <><CheckCircle2 className="text-success-500" size={20} /><span className="text-success-600">已保存</span></>
                ) : (
                  <><Calendar className="text-gray-400" size={20} /><span className="text-gray-500">暂无数据</span></>
                )}
              </p>
            </div>
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
              isSaving ? 'bg-primary-100 text-primary-600' :
              saveError ? 'bg-danger-100 text-danger-600' :
              hasUnsavedChanges ? 'bg-warning-100 text-warning-600' :
              draftItems.length > 0 ? 'bg-success-100 text-success-600' : 'bg-gray-100 text-gray-400'
            }`}>
              {isSaving ? <Cloud size={24} /> :
               saveError ? <AlertCircle size={24} /> :
               hasUnsavedChanges ? <Settings size={24} /> :
               draftItems.length > 0 ? <CheckCircle2 size={24} /> : <Calendar size={24} />}
            </div>
          </div>
        </div>
      </div>

      {/* 操作栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddPanel(true)}
            className="btn-primary flex items-center gap-2"
          >
            <Plus size={18} />
            <span>添加食材</span>
          </button>
          <button
            onClick={() => setShowBatchPaste(true)}
            className="btn-secondary flex items-center gap-2"
          >
            <ClipboardList size={18} />
            <span>批量粘贴</span>
          </button>
        </div>
        <div className="flex items-center gap-2">
          {draftItems.length > 0 && (
            <button onClick={handleClear} className="btn-secondary flex items-center gap-2 text-danger-600 hover:bg-danger-50">
              <Trash2 size={16} />
              <span>清空</span>
            </button>
          )}
          <button onClick={handleViewDaily} className="btn-secondary flex items-center gap-2">
            <ShoppingCart size={16} />
            <span>查看清单</span>
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            <Save size={18} />
            <span>{isSaving ? '保存中...' : '保存'}</span>
          </button>
          <button
            onClick={handleSendToWecom}
            disabled={sendingWecom || isSaving}
            className="btn-primary flex items-center gap-2 disabled:opacity-50 bg-green-600 hover:bg-green-700"
          >
            <Send size={18} />
            <span>{sendingWecom ? '发送中...' : '提交并发送到企微'}</span>
          </button>
        </div>
      </div>

      {/* 分类汇总 */}
      {categoryStats.length > 0 && (
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">分类汇总</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {categoryStats.map(cat => (
              <div key={cat.id} className="p-3 rounded-xl border border-gray-100">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: cat.color }} />
                  <span className="text-sm font-medium text-gray-700">{cat.name}</span>
                </div>
                <p className="text-lg font-bold text-gray-800">{formatCurrency(cat.amount)}</p>
                <span className="text-xs text-gray-500">{cat.count} 项</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 录入明细表格 */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-800">采买明细</h2>
          <span className="text-sm text-gray-500">共 {totalItems} 项</span>
        </div>

        {draftItems.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <ShoppingCart size={48} className="mx-auto mb-3 opacity-50" />
            <p className="text-lg">还没有添加任何食材</p>
            <p className="text-sm mt-1">点击上方"添加食材"按钮开始录入</p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-6 px-6">
            <table className="data-table min-w-full">
              <thead>
                <tr>
                  <th className="whitespace-nowrap">食材名称</th>
                  <th className="whitespace-nowrap">分类</th>
                  <th className="whitespace-nowrap">部门</th>
                  <th className="whitespace-nowrap">供应商</th>
                  <th className="whitespace-nowrap text-right">采购单位</th>
                  <th className="whitespace-nowrap text-right">数量</th>
                  <th className="whitespace-nowrap text-right">单价(元)</th>
                  <th className="whitespace-nowrap text-right">金额(元)</th>
                  <th className="whitespace-nowrap text-right">基准单价</th>
                  <th className="whitespace-nowrap text-center">操作</th>
                </tr>
              </thead>
              <tbody>
                {draftItems.map(item => {
                  const amount = Math.round(item.purchaseUnitPrice * item.purchaseQuantity * 100) / 100;
                  const baseUnitPrice = item.factor > 0 ? Math.round((item.purchaseUnitPrice / item.factor) * 100) / 100 : 0;
                  const ing = ingredients.find(i => i.id === item.ingredientId);
                  return (
                    <tr key={item.id}>
                      <td className="font-medium text-gray-800 whitespace-nowrap">{item.ingredientName}</td>
                      <td>
                        <span className="inline-flex items-center gap-1 text-xs text-gray-600">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: categories.find(c => c.id === item.categoryId)?.color }} />
                          {item.categoryName}
                        </span>
                      </td>
                      <td>
                        <select
                          value={item.departmentId}
                          onChange={(e) => {
                            const dept = departments.find(d => d.id === e.target.value);
                            updateDraftItem(item.id, 'departmentId', e.target.value);
                            if (dept) updateDraftItem(item.id, 'departmentName', dept.name);
                          }}
                          className="border border-gray-200 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                        >
                          {departments.map(d => (
                            <option key={d.id} value={d.id}>{d.name}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          value={item.supplierId}
                          onChange={(e) => {
                            const supplier = suppliers.find(s => s.id === e.target.value);
                            updateDraftItem(item.id, 'supplierId', e.target.value);
                            if (supplier) updateDraftItem(item.id, 'supplierName', supplier.name);
                          }}
                          className="border border-gray-200 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                        >
                          {suppliers.map(s => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="text-right">
                        <select
                          value={item.purchaseUnit}
                          onChange={(e) => updateDraftItem(item.id, 'purchaseUnit', e.target.value)}
                          className="border border-gray-200 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                        >
                          {ing?.units.map(u => (
                            <option key={u.unit} value={u.unit}>{u.unit}</option>
                          ))}
                        </select>
                      </td>
                      <td className="text-right">
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          value={item.purchaseQuantity}
                          onChange={(e) => updateDraftItem(item.id, 'purchaseQuantity', parseFloat(e.target.value) || 0)}
                          className="w-20 text-right border border-gray-200 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                        />
                      </td>
                      <td className="text-right">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.purchaseUnitPrice}
                          onChange={(e) => updateDraftItem(item.id, 'purchaseUnitPrice', parseFloat(e.target.value) || 0)}
                          className="w-24 text-right border border-gray-200 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                        />
                      </td>
                      <td className="text-right font-semibold text-gray-800">{formatCurrency(amount)}</td>
                      <td className="text-right text-gray-500 text-sm">
                        {formatCurrency(baseUnitPrice)}/{item.baseUnit}
                      </td>
                      <td className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => handleMoveDate(item)}
                            className="p-1.5 text-gray-400 hover:text-primary-500 hover:bg-primary-50 rounded-md transition-colors"
                            title="修改日期"
                          >
                            <Calendar size={16} />
                          </button>
                          <button
                            onClick={() => removeDraftItem(item.id)}
                            className="p-1.5 text-gray-400 hover:text-danger-500 hover:bg-danger-50 rounded-md transition-colors"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 font-semibold">
                  <td colSpan={5} className="text-right text-gray-600">合计</td>
                  <td className="text-right text-lg text-primary-600">{formatCurrency(totalAmount)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* 添加食材弹窗 */}
      {showAddPanel && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={() => setShowAddPanel(false)}>
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-800">选择食材</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setQuickForm({ name: searchTerm, categoryId: filterCategory || categories[0]?.id || '', baseUnit: '', basePrice: '' });
                    setQuickError('');
                    setShowQuickAdd(true);
                  }}
                  className="btn-secondary text-sm py-1.5 px-3 flex items-center gap-1"
                >
                  <Plus size={14} />
                  新增食材
                </button>
                <button onClick={() => setShowAddPanel(false)} className="p-1 hover:bg-gray-100 rounded-md transition-colors">
                  <X size={20} />
                </button>
              </div>
            </div>

            <div className="p-5 border-b border-gray-100">
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  type="text"
                  placeholder="搜索食材名称..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="input-field pl-10"
                  autoFocus
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setFilterCategory(null)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${!filterCategory ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  全部
                </button>
                {categories.map(cat => (
                  <button
                    key={cat.id}
                    onClick={() => setFilterCategory(filterCategory === cat.id ? null : cat.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1 ${filterCategory === cat.id ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                  >
                    <span>{cat.icon}</span>
                    <span>{cat.name}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {filteredIngredients.map(ing => (
                  <button
                    key={ing.id}
                    onClick={() => addIngredientToList(ing)}
                    className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:border-primary-300 hover:bg-primary-50 cursor-pointer text-left transition-all"
                  >
                    <div className="w-10 h-10 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                      <img src={ing.image} alt={ing.name} className="w-full h-full object-cover" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-gray-800 text-sm truncate">{ing.name}</p>
                      <p className="text-xs text-gray-500">{formatCurrency(ing.basePrice)}/{ing.baseUnit}</p>
                    </div>
                  </button>
                ))}
              </div>
              {filteredIngredients.length === 0 && (
                <div className="text-center py-12 text-gray-400">
                  <Search size={36} className="mx-auto mb-2 opacity-50" />
                  <p>未找到匹配的食材</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 快速新增食材弹窗 */}
      {showQuickAdd && (
        <div className="fixed inset-0 bg-black/30 z-[60] flex items-center justify-center p-4" onClick={() => setShowQuickAdd(false)}>
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-md animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-800">快速新增食材</h3>
              <button onClick={() => setShowQuickAdd(false)} className="p-1 hover:bg-gray-100 rounded-md">
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">食材名称</label>
                <input
                  type="text"
                  value={quickForm.name}
                  onChange={(e) => setQuickForm({ ...quickForm, name: e.target.value })}
                  placeholder="请输入食材名称"
                  className="input-field"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">所属分类</label>
                <select
                  value={quickForm.categoryId}
                  onChange={(e) => setQuickForm({ ...quickForm, categoryId: e.target.value })}
                  className="input-field"
                >
                  {categories.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.icon} {cat.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">基准单位</label>
                  <input
                    type="text"
                    value={quickForm.baseUnit}
                    onChange={(e) => setQuickForm({ ...quickForm, baseUnit: e.target.value })}
                    placeholder="如：公斤、个"
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">基准价（元）</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={quickForm.basePrice}
                    onChange={(e) => setQuickForm({ ...quickForm, basePrice: e.target.value })}
                    placeholder="基准价格"
                    className="input-field"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-400">
                提示：新增后可以在"食材管理"中完善单位换算等更多信息。
              </p>
              {quickError && (
                <div className="flex items-center gap-2 text-danger-600 bg-danger-50 p-3 rounded-lg text-sm">
                  <AlertCircle size={16} />
                  <span>{quickError}</span>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 p-5 border-t border-gray-100">
              <button onClick={() => setShowQuickAdd(false)} className="btn-secondary">取消</button>
              <button
                onClick={async () => {
                  setQuickError('');
                  if (!quickForm.name.trim()) { setQuickError('请输入食材名称'); return; }
                  if (!quickForm.categoryId) { setQuickError('请选择分类'); return; }
                  if (!quickForm.baseUnit.trim()) { setQuickError('请输入基准单位'); return; }
                  if (!quickForm.basePrice || parseFloat(quickForm.basePrice) <= 0) { setQuickError('请输入有效价格'); return; }

                  const newIng = await addIngredient({
                    name: quickForm.name.trim(),
                    categoryId: quickForm.categoryId,
                    baseUnit: quickForm.baseUnit.trim(),
                    basePrice: parseFloat(quickForm.basePrice),
                    image: `https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=${encodeURIComponent('fresh ' + quickForm.name + ' food ingredient')}&image_size=square`,
                    units: [{ unit: quickForm.baseUnit.trim(), factor: 1, isCommon: true }],
                  });

                  if (newIng) {
                    addIngredientToList(newIng);
                    setShowQuickAdd(false);
                  } else {
                    setQuickError('添加食材失败，请重试');
                  }
                }}
                className="btn-primary flex items-center gap-2"
              >
                <Plus size={16} />
                新增并添加
              </button>
            </div>
          </div>
        </div>
      )}

      {showDatePicker && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => { setShowDatePicker(null); setMovingItem(null); }}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">调整日期</h3>
              <button onClick={() => { setShowDatePicker(null); setMovingItem(null); }} className="p-1 hover:bg-gray-100 rounded-md">
                <X size={20} className="text-gray-500" />
              </button>
            </div>
            <p className="text-gray-600 mb-4">
              将 <span className="font-medium text-primary-600">{movingItem?.ingredientName}</span>
              从 <span className="font-medium">{dateStr}</span> 调整到：
            </p>
            <input
              type="date"
              defaultValue={dateStr}
              onChange={(e) => {
                if (e.target.value) {
                  handleSelectDate(e.target.value);
                }
              }}
              className="w-full border border-gray-200 rounded-lg px-4 py-3 text-lg focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
            />
            <div className="text-sm text-gray-400 mt-2">
              提示：如果目标日期已有相同食材，数量将自动合并
            </div>
          </div>
        </div>
      )}

      <BatchPasteModal
        open={showBatchPaste}
        onClose={() => setShowBatchPaste(false)}
        onConfirm={handleBatchImport}
      />

      {showMainDatePicker && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowMainDatePicker(false)}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">选择日期</h3>
              <button onClick={() => setShowMainDatePicker(false)} className="p-1 hover:bg-gray-100 rounded-md">
                <X size={20} className="text-gray-500" />
              </button>
            </div>
            <input
              type="date"
              value={mainTempDate}
              onChange={(e) => {
                if (e.target.value) {
                  setMainTempDate(e.target.value);
                }
              }}
              max={format(new Date(), 'yyyy-MM-dd')}
              className="w-full border border-gray-200 rounded-lg px-4 py-3 text-lg focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
            />
            <div className="mt-4 grid grid-cols-3 gap-2">
              <button onClick={() => {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                setMainTempDate(format(today, 'yyyy-MM-dd'));
              }} className="py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors">
                今天
              </button>
              <button onClick={() => {
                const yesterday = subDays(new Date(), 1);
                yesterday.setHours(0, 0, 0, 0);
                setMainTempDate(format(yesterday, 'yyyy-MM-dd'));
              }} className="py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors">
                昨天
              </button>
              <button onClick={() => {
                const sevenDaysAgo = subDays(new Date(), 7);
                sevenDaysAgo.setHours(0, 0, 0, 0);
                setMainTempDate(format(sevenDaysAgo, 'yyyy-MM-dd'));
              }} className="py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors">
                7天前
              </button>
            </div>
            <div className="mt-4 flex gap-3">
              <button onClick={() => setShowMainDatePicker(false)} className="flex-1 py-2.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
                取消
              </button>
              <button onClick={handleConfirmDate} className="flex-1 py-2.5 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors">
                确认
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
