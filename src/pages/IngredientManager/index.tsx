import { useState } from 'react';
import { Plus, Pencil, Trash2, X, Search, AlertCircle, Settings, Package, RefreshCw } from 'lucide-react';
import { useCategoryStore } from '@/store/categoryStore';
import { useIngredientStore } from '@/store/ingredientStore';
import type { Ingredient, UnitConversion } from '@/types';
import { formatCurrency } from '@/utils/format';

interface UnitForm {
  unit: string;
  factor: string;
  isCommon: boolean;
}

interface IngredientForm {
  id?: string;
  name: string;
  categoryId: string;
  baseUnit: string;
  basePrice: string;
  image: string;
  units: UnitForm[];
}

const generateImageUrl = (name: string) => {
  const encoded = encodeURIComponent(`fresh ${name} ingredient food photography white background`);
  return `https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=${encoded}&image_size=square`;
};

export default function IngredientManager() {
  const { categories } = useCategoryStore();
  const { ingredients, addIngredient, updateIngredient, deleteIngredient, syncCategory } = useIngredientStore();

  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Ingredient | null>(null);
  const [showUnitModal, setShowUnitModal] = useState(false);
  const [unitEditingIngredient, setUnitEditingIngredient] = useState<Ingredient | null>(null);
  const [error, setError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [syncingIngredient, setSyncingIngredient] = useState<Ingredient | null>(null);
  const [syncResult, setSyncResult] = useState<{ count: number; message: string } | null>(null);

  const [form, setForm] = useState<IngredientForm>({
    name: '',
    categoryId: '',
    baseUnit: '',
    basePrice: '',
    image: '',
    units: [],
  });

  const filteredIngredients = ingredients.filter(ing => {
    const matchSearch = ing.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchCategory = !filterCategory || ing.categoryId === filterCategory;
    return matchSearch && matchCategory;
  });

  const openAdd = () => {
    setEditing(null);
    setForm({
      name: '',
      categoryId: categories[0]?.id || '',
      baseUnit: '公斤',
      basePrice: '',
      image: '',
      units: [{ unit: '公斤', factor: '1', isCommon: true }],
    });
    setError('');
    setShowModal(true);
  };

  const openEdit = (ing: Ingredient) => {
    setEditing(ing);
    setForm({
      id: ing.id,
      name: ing.name,
      categoryId: ing.categoryId,
      baseUnit: ing.baseUnit,
      basePrice: ing.basePrice.toString(),
      image: ing.image,
      units: ing.units.map(u => ({ unit: u.unit, factor: u.factor.toString(), isCommon: u.isCommon || false })),
    });
    setError('');
    setShowModal(true);
  };

  const handleSubmit = async () => {
    setError('');
    if (!form.name.trim()) { setError('请输入食材名称'); return; }
    if (!form.categoryId) { setError('请选择食材分类'); return; }
    if (!form.baseUnit.trim()) { setError('请输入基准单位'); return; }
    if (!form.basePrice || parseFloat(form.basePrice) <= 0) { setError('请输入有效基准价格'); return; }
    if (form.units.length === 0) { setError('至少需要一个单位'); return; }

    const units: UnitConversion[] = form.units.map(u => ({
      unit: u.unit.trim(),
      factor: parseFloat(u.factor) || 1,
      isCommon: u.isCommon,
    }));

    const baseUnitExists = units.some(u => u.unit === form.baseUnit.trim());
    if (!baseUnitExists) {
      setError('基准单位必须在单位列表中存在');
      return;
    }

    const image = form.image.trim() || generateImageUrl(form.name.trim());

    try {
      if (editing) {
        const categoryChanged = editing.categoryId !== form.categoryId;
        await updateIngredient(editing.id, {
          name: form.name.trim(),
          categoryId: form.categoryId,
          baseUnit: form.baseUnit.trim(),
          basePrice: parseFloat(form.basePrice),
          image,
          units,
        });
        setShowModal(false);
        // 如果分类变更，提示同步历史数据
        if (categoryChanged) {
          setSyncingIngredient({
            ...editing,
            categoryId: form.categoryId,
          });
          setSyncResult(null);
        }
      } else {
        await addIngredient({
          name: form.name.trim(),
          categoryId: form.categoryId,
          baseUnit: form.baseUnit.trim(),
          basePrice: parseFloat(form.basePrice),
          image,
          units,
        });
        setShowModal(false);
      }
    } catch (err: any) {
      setError(err.message || '操作失败');
    }
  };

  const handleSyncCategory = async () => {
    if (!syncingIngredient) return;
    const result = await syncCategory(syncingIngredient.id);
    if (result.success) {
      setSyncResult({ count: result.updatedCount, message: result.message });
    }
  };

  const openSyncModal = (ing: Ingredient) => {
    setSyncingIngredient(ing);
    setSyncResult(null);
  };

  const handleDelete = (id: string) => {
    deleteIngredient(id);
    setDeleteConfirm(null);
  };

  const addUnitRow = () => {
    setForm({
      ...form,
      units: [...form.units, { unit: '', factor: '1', isCommon: false }],
    });
  };

  const removeUnitRow = (index: number) => {
    if (form.units.length <= 1) return;
    setForm({
      ...form,
      units: form.units.filter((_, i) => i !== index),
    });
  };

  const updateUnitRow = (index: number, field: keyof UnitForm, value: any) => {
    const newUnits = [...form.units];
    newUnits[index] = { ...newUnits[index], [field]: value };
    setForm({ ...form, units: newUnits });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-serif font-bold text-gray-800">食材管理</h1>
          <p className="text-gray-500 mt-1">管理食材信息，包括分类、单位换算和价格</p>
        </div>
        <button onClick={openAdd} className="btn-primary flex items-center gap-2">
          <Plus size={18} />
          <span>新增食材</span>
        </button>
      </div>

      <div className="card">
        <div className="space-y-3 mb-5">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="搜索食材名称..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-11 pr-10 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 focus:bg-white transition-all"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 rounded-md hover:bg-gray-100"
                title="清除"
              >
                <X size={16} />
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setFilterCategory(null)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${!filterCategory ? 'bg-primary-500 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              全部
            </button>
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => setFilterCategory(filterCategory === cat.id ? null : cat.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 ${filterCategory === cat.id ? 'bg-primary-500 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                <span>{cat.icon}</span>
                <span>{cat.name}</span>
              </button>
            ))}
          </div>
        </div>

        {(searchTerm || filterCategory) && (
          <div className="text-xs text-gray-500 mb-3 px-1">
            找到 <span className="font-semibold text-primary-600">{filteredIngredients.length}</span> 个匹配的食材
          </div>
        )}

        <div className="overflow-x-auto -mx-6 px-6">
          <table className="data-table min-w-full">
            <thead>
              <tr>
                <th>食材</th>
                <th>分类</th>
                <th>基准单位</th>
                <th className="text-right">基准价</th>
                <th className="text-center">单位数</th>
                <th className="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredIngredients.map(ing => {
                const cat = categories.find(c => c.id === ing.categoryId);
                return (
                  <tr key={ing.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <img src={ing.image} alt={ing.name} className="w-10 h-10 rounded-lg object-cover bg-gray-100" />
                        <span className="font-medium text-gray-800">{ing.name}</span>
                      </div>
                    </td>
                    <td>
                      <span className="inline-flex items-center gap-1.5 text-sm">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cat?.color }} />
                        {cat?.name}
                      </span>
                    </td>
                    <td className="text-gray-700">{ing.baseUnit}</td>
                    <td className="text-right font-medium text-primary-600">{formatCurrency(ing.basePrice)}</td>
                    <td className="text-center">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 rounded-full text-xs text-gray-600">
                        <Package size={12} />
                        {ing.units.length} 个
                      </span>
                    </td>
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(ing)}
                          className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-md transition-colors"
                          title="编辑"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          onClick={() => openSyncModal(ing)}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                          title="同步分类到历史采购"
                        >
                          <RefreshCw size={16} />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(ing.id)}
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

        {filteredIngredients.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <Search size={40} className="mx-auto mb-3 opacity-50" />
            <p>未找到匹配的食材</p>
          </div>
        )}
      </div>

      {/* 新增/编辑弹窗 */}
      {showModal && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-800">{editing ? '编辑食材' : '新增食材'}</h3>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-gray-100 rounded-md">
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">食材名称</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="请输入食材名称"
                    className="input-field"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">所属分类</label>
                  <select
                    value={form.categoryId}
                    onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                    className="input-field"
                  >
                    {categories.map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.icon} {cat.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">基准单位</label>
                  <input
                    type="text"
                    value={form.baseUnit}
                    onChange={(e) => setForm({ ...form, baseUnit: e.target.value })}
                    placeholder="如：公斤、个、升"
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">基准价格（元）</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.basePrice}
                    onChange={(e) => setForm({ ...form, basePrice: e.target.value })}
                    placeholder="请输入基准价格"
                    className="input-field"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">图片URL（可选）</label>
                  <input
                    type="text"
                    value={form.image}
                    onChange={(e) => setForm({ ...form, image: e.target.value })}
                    placeholder="留空则自动生成"
                    className="input-field text-sm"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                    <Settings size={16} />
                    单位换算列表
                  </label>
                  <button onClick={addUnitRow} className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1">
                    <Plus size={14} /> 添加单位
                  </button>
                </div>
                <div className="space-y-2">
                  {form.units.map((u, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={u.unit}
                        onChange={(e) => updateUnitRow(idx, 'unit', e.target.value)}
                        placeholder="单位名"
                        className="input-field flex-1 text-sm"
                      />
                      <span className="text-gray-400 text-sm whitespace-nowrap">= 基准单位 ×</span>
                      <input
                        type="number"
                        value={u.factor}
                        onChange={(e) => updateUnitRow(idx, 'factor', e.target.value)}
                        step="0.01"
                        className="input-field w-20 text-sm text-right"
                      />
                      <label className="flex items-center gap-1 text-xs text-gray-500 whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={u.isCommon}
                          onChange={(e) => updateUnitRow(idx, 'isCommon', e.target.checked)}
                          className="rounded"
                        />
                        常用
                      </label>
                      <button
                        onClick={() => removeUnitRow(idx)}
                        disabled={form.units.length <= 1}
                        className="p-1.5 text-gray-400 hover:text-danger-500 hover:bg-danger-50 rounded-md disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  提示：换算系数 = 1个该单位 = 系数 × 基准单位。例：1斤 = 0.5公斤，则系数填0.5
                </p>
              </div>

              {error && (
                <div className="flex items-center gap-2 text-danger-600 bg-danger-50 p-3 rounded-lg text-sm">
                  <AlertCircle size={16} />
                  <span>{error}</span>
                </div>
              )}
            </div>

            <div className="flex justify-between items-center p-5 border-t border-gray-100">
              {editing && (
                <button
                  onClick={() => {
                    openSyncModal(editing);
                    setShowModal(false);
                  }}
                  className="text-sm text-blue-500 hover:text-blue-600 flex items-center gap-1"
                >
                  <RefreshCw size={14} />
                  同步分类到历史采购
                </button>
              )}
              <div className="flex gap-3 ml-auto">
                <button onClick={() => setShowModal(false)} className="btn-secondary">取消</button>
                <button onClick={handleSubmit} className="btn-primary">{editing ? '保存修改' : '确认新增'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认 */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={() => setDeleteConfirm(null)}>
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-sm animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 text-center">
              <div className="w-14 h-14 bg-danger-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="text-danger-500" size={28} />
              </div>
              <h3 className="text-lg font-semibold text-gray-800 mb-2">确认删除</h3>
              <p className="text-gray-500 text-sm">删除后该食材将被移除，确认要删除吗？</p>
            </div>
            <div className="flex justify-center gap-3 p-5 border-t border-gray-100">
              <button onClick={() => setDeleteConfirm(null)} className="btn-secondary">取消</button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                className="bg-danger-500 hover:bg-danger-600 text-white px-4 py-2 rounded-lg font-medium transition-colors"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 同步分类提示 */}
      {syncingIngredient && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={() => setSyncingIngredient(null)}>
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-md animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
                  <RefreshCw className="text-primary-500" size={20} />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-800">同步历史采购数据</h3>
                  <p className="text-sm text-gray-500">食材「{syncingIngredient.name}」的分类已修改</p>
                </div>
              </div>
              {syncResult ? (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                  <p className="text-green-700 text-sm">{syncResult.message}</p>
                  <p className="text-green-600 text-xs mt-1">已更新 {syncResult.count} 条采购记录</p>
                </div>
              ) : (
                <p className="text-gray-600 text-sm mb-4">
                  是否将历史采购记录的分类同步更新为新分类？此操作会影响该食材的所有历史采购数据。
                </p>
              )}
              <div className="flex justify-center gap-3 pt-4 border-t border-gray-100">
                <button onClick={() => setSyncingIngredient(null)} className="btn-secondary">
                  {syncResult ? '关闭' : '暂不同步'}
                </button>
                {!syncResult && (
                  <button onClick={handleSyncCategory} className="btn-primary flex items-center gap-2">
                    <RefreshCw size={16} />
                    立即同步
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
