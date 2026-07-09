import { useState, useMemo, useEffect } from 'react';
import { X, CheckCircle, AlertCircle, Plus, Building2, Package, Scale, ClipboardList, RefreshCw } from 'lucide-react';
import { useIngredientStore, type Ingredient, type UnitConversion } from '@/store/ingredientStore';
import { useCategoryStore } from '@/store/categoryStore';
import { useDepartmentStore, type Department } from '@/store/departmentStore';
import { useSupplierStore } from '@/store/supplierStore';
import type { Supplier } from '@/types';
import type { PurchaseEntryItem } from '@/store/purchaseStore';
import { generateId } from '@/utils/format';

interface ParsedItem {
  id: string;
  rawText: string;
  rowIndex: number;
  name: string;
  quantity: number;
  unitPrice: number;
  unit: string;
  department: string;
  supplier: string;
  status: 'matched' | 'ingredient_missing' | 'unit_missing' | 'department_missing' | 'supplier_missing' | 'error';
  matchedIngredient?: Ingredient;
  matchedUnit?: UnitConversion;
  matchedDepartment?: Department;
  matchedSupplier?: Supplier;
  error?: string;
}

interface BatchPasteModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (items: PurchaseEntryItem[]) => void;
}

export default function BatchPasteModal({ open, onClose, onConfirm }: BatchPasteModalProps) {
  const { ingredients, addIngredient, updateIngredient } = useIngredientStore();
  const { categories } = useCategoryStore();
  const { departments, addDepartment: addDeptStore } = useDepartmentStore();
  const { suppliers, fetchSuppliers } = useSupplierStore();

  const [pasteText, setPasteText] = useState('');
  const [parsedItems, setParsedItems] = useState<ParsedItem[]>([]);
  const [step, setStep] = useState<'paste' | 'preview'>('paste');
  const [resolvingItem, setResolvingItem] = useState<ParsedItem | null>(null);
  const [resolveType, setResolveType] = useState<'ingredient' | 'unit' | 'department' | null>(null);

  const [newIngredientName, setNewIngredientName] = useState('');
  const [newIngredientCategory, setNewIngredientCategory] = useState('');
  const [newIngredientBaseUnit, setNewIngredientBaseUnit] = useState('');
  const [newIngredientBasePrice, setNewIngredientBasePrice] = useState('');

  const [newUnitName, setNewUnitName] = useState('');
  const [newUnitFactor, setNewUnitFactor] = useState('');

  const [deptMap, setDeptMap] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setPasteText('');
      setParsedItems([]);
      setStep('paste');
      setResolvingItem(null);
      setResolveType(null);
      fetchSuppliers();
    }
  }, [open, fetchSuppliers]);

  const parseText = () => {
    const lines = pasteText.trim().split('\n').filter(line => line.trim());
    const items: ParsedItem[] = [];

    lines.forEach((line, idx) => {
      const parts = line.split(/\s+|,|\t/).filter(p => p.trim());
      if (parts.length < 2) {
        items.push({
          id: generateId(),
          rawText: line,
          rowIndex: idx,
          name: '',
          quantity: 0,
          unitPrice: 0,
          unit: '',
          department: '',
          status: 'error',
          error: '格式不正确，至少需要名称和数量',
        });
        return;
      }

      const name = parts[0];
      const quantity = parseFloat(parts[1]) || 0;
      const unitPrice = parts.length >= 3 ? (parseFloat(parts[2]) || 0) : 0;
      const unit = parts.length >= 4 ? parts[3] : '公斤';
      const department = parts.length >= 5 ? parts[4] : '';
      const supplier = parts.length >= 6 ? parts[5] : '';

      let finalQuantity = quantity;
      let finalUnitPrice = unitPrice;

      if (parts.length === 2) {
        finalQuantity = 1;
        finalUnitPrice = quantity;
      }

      const ingredient = ingredients.find(i => i.name === name);
      const dept = departments.find(d => d.name === department || d.name === deptMap[department]);
      const supp = suppliers.find(s => s.name === supplier);

      let status: ParsedItem['status'] = 'matched';
      let matchedUnit: UnitConversion | undefined;

      if (!ingredient) {
        status = 'ingredient_missing';
      } else {
        matchedUnit = ingredient.units.find(u => u.unit === unit);
        if (!matchedUnit) {
          status = 'unit_missing';
        }
      }

      if (department && !dept) {
        if (status === 'matched') status = 'department_missing';
      }

      if (supplier && !supp) {
        if (status === 'matched' || status === 'department_missing') status = 'supplier_missing';
      }

      items.push({
        id: generateId(),
        rawText: line,
        rowIndex: idx,
        name,
        quantity: finalQuantity,
        unitPrice: finalUnitPrice,
        unit,
        department,
        supplier,
        status,
        matchedIngredient: ingredient,
        matchedUnit,
        matchedDepartment: dept || undefined,
        matchedSupplier: supp || undefined,
      });
    });

    setParsedItems(items);
    setStep('preview');
  };

  const matchedCount = useMemo(() => parsedItems.filter(i => i.status === 'matched').length, [parsedItems]);
  const needResolveCount = useMemo(() => parsedItems.filter(i => i.status !== 'matched' && i.status !== 'error').length, [parsedItems]);
  const errorCount = useMemo(() => parsedItems.filter(i => i.status === 'error').length, [parsedItems]);

  const handleResolveIngredient = (item: ParsedItem) => {
    setResolvingItem(item);
    setResolveType('ingredient');
    setNewIngredientName(item.name);
    setNewIngredientBaseUnit(item.unit || '公斤');
    setNewIngredientBasePrice(item.unitPrice.toString());
    setNewIngredientCategory(categories[0]?.id || '');
  };

  const handleAddIngredient = async () => {
    if (!newIngredientName.trim() || !newIngredientBaseUnit.trim()) return;

    const newIng: Ingredient = {
      id: generateId(),
      name: newIngredientName.trim(),
      categoryId: newIngredientCategory || categories[0]?.id || '',
      baseUnit: newIngredientBaseUnit.trim(),
      basePrice: parseFloat(newIngredientBasePrice) || 0,
      units: [{
        unit: newIngredientBaseUnit.trim(),
        factor: 1,
        isCommon: true,
      }],
    };

    try {
      const saved = await addIngredient(newIng);
      if (saved) {
        setParsedItems(prev => prev.map(i => {
          if (i.id !== resolvingItem?.id) return i;
          const existingDept = departments.find(d => d.name === i.department) || departments.find(d => d.name === deptMap[i.department]);
          const newStatus: ParsedItem['status'] = existingDept ? 'matched' : (i.department ? 'department_missing' : 'matched');
          return {
            ...i,
            status: newStatus,
            matchedIngredient: saved,
            matchedUnit: saved.units[0],
            matchedDepartment: existingDept,
          };
        }));
      }
    } catch (err) {
      console.error('add ingredient error:', err);
    }

    setResolvingItem(null);
    setResolveType(null);
  };

  const handleResolveUnit = (item: ParsedItem) => {
    setResolvingItem(item);
    setResolveType('unit');
    setNewUnitName(item.unit);
    setNewUnitFactor('');
  };

  const handleAddUnit = async () => {
    if (!resolvingItem?.matchedIngredient || !newUnitName.trim() || !newUnitFactor) return;

    const factor = parseFloat(newUnitFactor);
    if (isNaN(factor) || factor <= 0) return;

    const newUnits = [...resolvingItem.matchedIngredient.units, {
      unit: newUnitName.trim(),
      factor,
      isCommon: false,
    }];

    try {
      const updated = await updateIngredient(resolvingItem.matchedIngredient.id, {
        units: newUnits,
      });

      if (updated) {
        const newUnit = newUnits.find(u => u.unit === newUnitName.trim());
        setParsedItems(prev => prev.map(i =>
          i.id === resolvingItem?.id
            ? { ...i, status: 'matched', matchedUnit: newUnit }
            : i
        ));
      }
    } catch (err) {
      console.error('update unit error:', err);
    }

    setResolvingItem(null);
    setResolveType(null);
  };

  const handleSelectExistingUnit = (unit: UnitConversion) => {
    if (!resolvingItem) return;
    setParsedItems(prev => prev.map(i =>
      i.id === resolvingItem.id
        ? { ...i, status: 'matched', matchedUnit: unit, unit: unit.unit }
        : i
    ));
    setResolvingItem(null);
    setResolveType(null);
  };

  const handleResolveDepartment = (item: ParsedItem) => {
    setResolvingItem(item);
    setResolveType('department');
  };

  const handleMapDepartment = (deptId: string) => {
    if (!resolvingItem) return;
    const dept = departments.find(d => d.id === deptId);
    if (!dept) return;

    setDeptMap(prev => ({ ...prev, [resolvingItem.department]: dept.name }));

    setParsedItems(prev => prev.map(i =>
      i.id === resolvingItem.id
        ? { ...i, status: 'matched', matchedDepartment: dept }
        : i
    ));

    setResolvingItem(null);
    setResolveType(null);
  };

  const handleAddDepartment = async () => {
    if (!resolvingItem?.department) return;

    const newDept = await addDeptStore(resolvingItem.department);
    if (newDept) {
      setParsedItems(prev => prev.map(i =>
        i.id === resolvingItem.id
          ? { ...i, status: 'matched', matchedDepartment: newDept }
          : i
      ));
    }

    setResolvingItem(null);
    setResolveType(null);
  };

  const handleConfirm = () => {
    const validItems = parsedItems.filter(i => i.status === 'matched' && i.matchedIngredient && i.matchedUnit);
    const result: PurchaseEntryItem[] = validItems.map(item => {
      const ingredient = item.matchedIngredient!;
      const unit = item.matchedUnit!;
      const amount = Math.round(item.unitPrice * item.quantity * 100) / 100;
      const baseUnitPrice = Math.round((item.unitPrice / unit.factor) * 100) / 100;
      const baseQuantity = Math.round(item.quantity / unit.factor * 100) / 100;

      return {
        id: item.id,
        ingredientId: ingredient.id,
        ingredientName: ingredient.name,
        categoryId: ingredient.categoryId,
        categoryName: categories.find(c => c.id === ingredient.categoryId)?.name || '',
        departmentId: item.matchedDepartment?.id || departments[0]?.id || '',
        departmentName: item.matchedDepartment?.name || departments[0]?.name || '',
        supplierId: item.matchedSupplier?.id || suppliers[0]?.id || '',
        supplierName: item.matchedSupplier?.name || suppliers[0]?.name || '',
        purchaseUnit: item.unit,
        purchaseQuantity: item.quantity,
        purchaseUnitPrice: item.unitPrice,
        baseUnit: ingredient.baseUnit,
        baseUnitPrice,
        baseQuantity,
        amount,
      };
    });

    onConfirm(result);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center">
              <ClipboardList size={20} className="text-primary-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-800">批量粘贴导入</h2>
              <p className="text-sm text-gray-500">从 Excel 复制数据，快速录入</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {step === 'paste' ? (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                粘贴数据
              </label>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={'格式：名称 数量 单价 单位 部门\n例如：\n白菜 2 5 公斤 厨房\n猪肉 1 30 公斤 厨房\n纸巾 10 5 包 房务'}
                className="w-full h-64 border border-gray-200 rounded-lg px-4 py-3 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 resize-none"
              />
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <p className="text-sm text-amber-800">
                <strong>格式说明：</strong><br />
                每行一条记录，用空格、Tab或逗号分隔<br />
                列顺序：<code className="bg-amber-100 px-1.5 py-0.5 rounded">名称 数量 单价 单位 部门</code><br />
                单价、单位、部门为可选项，缺少时使用默认值
              </p>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-4">
                <span className="inline-flex items-center gap-1.5 text-sm">
                  <CheckCircle size={16} className="text-green-500" />
                  已匹配 <strong className="text-green-600">{matchedCount}</strong> 条
                </span>
                <span className="inline-flex items-center gap-1.5 text-sm">
                  <AlertCircle size={16} className="text-amber-500" />
                  需处理 <strong className="text-amber-600">{needResolveCount}</strong> 条
                </span>
                {errorCount > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-sm">
                    <AlertCircle size={16} className="text-red-500" />
                    错误 <strong className="text-red-600">{errorCount}</strong> 条
                  </span>
                )}
              </div>
              <button
                onClick={() => setStep('paste')}
                className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1"
              >
                <RefreshCw size={14} />
                重新粘贴
              </button>
            </div>

            <div className="space-y-2">
              {parsedItems.map((item) => (
                <div
                  key={item.id}
                  className={`p-3 rounded-lg border transition-all ${
                    item.status === 'matched'
                      ? 'border-green-200 bg-green-50/50'
                      : item.status === 'error'
                      ? 'border-red-200 bg-red-50/50'
                      : 'border-amber-200 bg-amber-50/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {item.status === 'matched' ? (
                        <CheckCircle size={18} className="text-green-500 flex-shrink-0" />
                      ) : item.status === 'error' ? (
                        <AlertCircle size={18} className="text-red-500 flex-shrink-0" />
                      ) : (
                        <AlertCircle size={18} className="text-amber-500 flex-shrink-0" />
                      )}
                      <div>
                        <div className="font-medium text-gray-800">
                          {item.name || item.rawText}
                        </div>
                        <div className="text-xs text-gray-500">
                          {item.quantity} {item.unit} · ¥{item.unitPrice}/{item.unit}
                          {item.department && ` · ${item.department}`}
                        </div>
                      </div>
                    </div>
                    <div>
                      {item.status === 'ingredient_missing' && (
                        <button
                          onClick={() => handleResolveIngredient(item)}
                          className="text-xs bg-primary-500 text-white px-3 py-1.5 rounded-md hover:bg-primary-600 transition-colors"
                        >
                          添加食材
                        </button>
                      )}
                      {item.status === 'unit_missing' && (
                        <button
                          onClick={() => handleResolveUnit(item)}
                          className="text-xs bg-amber-500 text-white px-3 py-1.5 rounded-md hover:bg-amber-600 transition-colors"
                        >
                          选择单位
                        </button>
                      )}
                      {item.status === 'department_missing' && (
                        <button
                          onClick={() => handleResolveDepartment(item)}
                          className="text-xs bg-blue-500 text-white px-3 py-1.5 rounded-md hover:bg-blue-600 transition-colors"
                        >
                          映射部门
                        </button>
                      )}
                      {item.status === 'error' && (
                        <span className="text-xs text-red-500">{item.error}</span>
                      )}
                      {item.status === 'matched' && (
                        <span className="text-xs text-green-600">已匹配</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
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

        {resolvingItem && resolveType === 'ingredient' && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[60]" onClick={() => { setResolvingItem(null); setResolveType(null); }}>
            <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-semibold text-gray-800 mb-4">添加新食材</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">食材名称</label>
                  <input
                    type="text"
                    value={newIngredientName}
                    onChange={(e) => setNewIngredientName(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">分类</label>
                  <select
                    value={newIngredientCategory}
                    onChange={(e) => setNewIngredientCategory(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  >
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">基准单位</label>
                    <input
                      type="text"
                      value={newIngredientBaseUnit}
                      onChange={(e) => setNewIngredientBaseUnit(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">基准单价</label>
                    <input
                      type="number"
                      value={newIngredientBasePrice}
                      onChange={(e) => setNewIngredientBasePrice(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                    />
                  </div>
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button onClick={() => { setResolvingItem(null); setResolveType(null); }} className="btn-secondary flex-1">
                  取消
                </button>
                <button onClick={handleAddIngredient} className="btn-primary flex-1">
                  添加
                </button>
              </div>
            </div>
          </div>
        )}

        {resolvingItem && resolveType === 'unit' && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[60]" onClick={() => { setResolvingItem(null); setResolveType(null); }}>
            <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-semibold text-gray-800 mb-4">
                选择单位 - {resolvingItem.matchedIngredient?.name}
              </h3>
              <p className="text-sm text-gray-500 mb-4">
                单位「{resolvingItem.unit}」不存在，请选择已有单位或添加新单位
              </p>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">已有单位</label>
                <div className="flex flex-wrap gap-2">
                  {resolvingItem.matchedIngredient?.units.map(u => (
                    <button
                      key={u.unit}
                      onClick={() => handleSelectExistingUnit(u)}
                      className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:border-primary-400 hover:bg-primary-50 transition-colors"
                    >
                      {u.unit} ({u.factor}{resolvingItem.matchedIngredient?.baseUnit})
                    </button>
                  ))}
                </div>
              </div>
              <div className="border-t border-gray-100 pt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">添加新单位</label>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    value={newUnitName}
                    onChange={(e) => setNewUnitName(e.target.value)}
                    placeholder="单位名称"
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  />
                  <input
                    type="number"
                    value={newUnitFactor}
                    onChange={(e) => setNewUnitFactor(e.target.value)}
                    placeholder={`1${resolvingItem.unit}=?${resolvingItem.matchedIngredient?.baseUnit}`}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  />
                </div>
                <button
                  onClick={handleAddUnit}
                  disabled={!newUnitName.trim() || !newUnitFactor}
                  className="mt-3 w-full btn-secondary text-sm disabled:opacity-50"
                >
                  添加单位
                </button>
              </div>
            </div>
          </div>
        )}

        {resolvingItem && resolveType === 'department' && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[60]" onClick={() => { setResolvingItem(null); setResolveType(null); }}>
            <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-semibold text-gray-800 mb-4">
                部门映射
              </h3>
              <p className="text-sm text-gray-500 mb-4">
                部门「{resolvingItem.department}」未识别，请选择对应部门
              </p>
              <div className="space-y-2 mb-4">
                {departments.map(d => (
                  <button
                    key={d.id}
                    onClick={() => handleMapDepartment(d.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 border border-gray-200 rounded-lg hover:border-primary-400 hover:bg-primary-50 transition-colors text-left"
                  >
                    <Building2 size={18} className="text-primary-500" />
                    <span className="font-medium text-gray-800">{d.name}</span>
                  </button>
                ))}
              </div>
              <div className="border-t border-gray-100 pt-4">
                <button
                  onClick={handleAddDepartment}
                  className="w-full btn-secondary text-sm flex items-center justify-center gap-2"
                >
                  <Plus size={16} />
                  创建新部门「{resolvingItem.department}」
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}