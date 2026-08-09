import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Plus, Pencil, Trash2, X, Search, AlertCircle, Settings, Package, RefreshCw, ImageIcon, Wand2, Loader2, ChevronDown, ChevronUp, Sparkles, Tags } from 'lucide-react';
import { useCategoryStore } from '@/store/categoryStore';
import { useIngredientStore } from '@/store/ingredientStore';
import type { Ingredient, UnitConversion } from '@/types';
import { formatCurrency } from '@/utils/format';
import CategoryManager from '@/pages/CategoryManager';

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

// 生成AI图片URL
const generateImageUrl = (name: string, variant?: string) => {
  const suffix = variant ? ` ${variant}` : '';
  const encoded = encodeURIComponent(`fresh ${name}${suffix} ingredient food photography white background`);
  return `https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=${encoded}&image_size=square`;
};

// 等待图片加载完成（带重试机制，应对AI生成的占位图）
const waitForImageLoad = (url: string, timeout = 45000): Promise<boolean> => {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const maxRetries = 15;
    let retryCount = 0;
    let lastDataUrl = '';

    const attemptLoad = () => {
      const elapsed = Date.now() - startTime;
      if (elapsed >= timeout || retryCount >= maxRetries) {
        resolve(false);
        return;
      }

      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          const currentDataUrl = canvas.toDataURL();
          
          if (img.width > 100 && img.height > 100 && currentDataUrl !== lastDataUrl) {
            lastDataUrl = currentDataUrl;
            retryCount++;
            setTimeout(attemptLoad, 3000);
          } else if (img.width > 100 && img.height > 100 && currentDataUrl === lastDataUrl) {
            resolve(true);
          } else {
            retryCount++;
            setTimeout(attemptLoad, 2000);
          }
        } else {
          retryCount++;
          setTimeout(attemptLoad, 2000);
        }
      };
      img.onerror = () => {
        retryCount++;
        setTimeout(attemptLoad, 2000);
      };
      img.src = url + '&t=' + Date.now();
    };

    setTimeout(attemptLoad, 3000);
  });
};

export default function IngredientManager() {
  const navigate = useNavigate();
  const location = useLocation();
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
  const [currentCandidate, setCurrentCandidate] = useState<string | null>(null);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [showManualUrl, setShowManualUrl] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [batchMatching, setBatchMatching] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; currentName: string; message?: string } | null>(null);
  const candidateVariants = ['top view', 'close-up shot', 'natural lighting', 'professional studio'];

  type TabKey = 'ingredients' | 'categories';
  const ING_TABS: { key: TabKey; label: string; hash: string }[] = [
    { key: 'ingredients', label: '食材管理', hash: '#ingredients' },
    { key: 'categories', label: '分类管理', hash: '#categories' },
  ];
  const getActiveTab = (hash: string): TabKey => (hash === '#categories' ? 'categories' : 'ingredients');
  const [activeTab, setActiveTab] = useState<TabKey>(() => getActiveTab(location.hash));
  const switchIngTab = (key: TabKey) => {
    setActiveTab(key);
    const target = ING_TABS.find(t => t.key === key)?.hash || '';
    if (location.hash !== target) navigate(location.pathname + target, { replace: true });
  };

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
    setCurrentCandidate(null);
    setShowManualUrl(false);
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
    setCurrentCandidate(null);
    setShowManualUrl(false);
    setShowModal(true);
  };

  // 生成一张图片并等待其加载完成
  const generateAndWait = async (name: string, variant?: string): Promise<string | null> => {
    const imageUrl = generateImageUrl(name, variant);
    const loaded = await waitForImageLoad(imageUrl, 35000);
    return loaded ? imageUrl : null;
  };

  // 智能匹配图片：单张顺序生成，等待加载完成
  const handleSmartMatch = async (variant?: string) => {
    if (!form.name.trim()) {
      setError('请先输入食材名称');
      return;
    }
    setGeneratingImage(true);
    setCurrentCandidate(null);
    setError('');
    const imageUrl = await generateAndWait(form.name.trim(), variant);
    if (imageUrl) {
      setCurrentCandidate(imageUrl);
    } else {
      setError('图片生成超时或失败，请稍后重试或手动输入图片URL');
    }
    setGeneratingImage(false);
  };

  // 重新生成一张新的候选图片
  const handleRegenerate = () => {
    // 按序号循环切换变体，增加图片多样性
    const currentVariant = currentCandidate
      ? candidateVariants.find(v => currentCandidate.includes(encodeURIComponent(v).replace(/%20/g, ' ')))
      : undefined;
    const currentIndex = currentVariant ? candidateVariants.indexOf(currentVariant) : -1;
    const nextVariant = candidateVariants[(currentIndex + 1) % candidateVariants.length];
    handleSmartMatch(nextVariant);
  };

  // 采用当前候选图片
  const handleAdoptCandidate = () => {
    if (currentCandidate) {
      setForm({ ...form, image: currentCandidate });
      setCurrentCandidate(null);
    }
  };

  // 批量匹配图片
  const handleBatchMatch = async () => {
    const ingredientsToUpdate = ingredients.filter(ing => !ing.image || ing.image.trim() === '');
    if (ingredientsToUpdate.length === 0) {
      setBatchProgress({ current: 0, total: 0, currentName: '所有食材已有图片，无需匹配' });
      setTimeout(() => setBatchProgress(null), 2000);
      return;
    }
    setBatchMatching(true);
    setBatchProgress({ current: 0, total: ingredientsToUpdate.length, currentName: ingredientsToUpdate[0].name });
    let successCount = 0;
    for (let i = 0; i < ingredientsToUpdate.length; i++) {
      const ing = ingredientsToUpdate[i];
      setBatchProgress({ current: i + 1, total: ingredientsToUpdate.length, currentName: ing.name });
      const imageUrl = await generateAndWait(ing.name);
      if (imageUrl) {
        try {
          await updateIngredient(ing.id, { image: imageUrl });
          successCount++;
        } catch {
          // 跳过失败的
        }
      }
    }
    setBatchProgress({
      current: ingredientsToUpdate.length,
      total: ingredientsToUpdate.length,
      currentName: '完成',
      message: `成功匹配 ${successCount} / ${ingredientsToUpdate.length} 个食材`,
    });
    setBatchMatching(false);
    setTimeout(() => setBatchProgress(null), 3000);
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
      {/* 标题区 */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Package className="text-primary-600" size={26} />
          <div>
            <h1 className="text-2xl font-serif font-bold text-gray-800">食材管理</h1>
            <p className="text-sm text-gray-500 mt-1">管理食材信息及其分类</p>
          </div>
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1 border-b border-gray-200">
        <button
          onClick={() => switchIngTab('ingredients')}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'ingredients'
              ? 'border-primary-600 text-primary-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Package size={16} />
          食材管理
        </button>
        <button
          onClick={() => switchIngTab('categories')}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'categories'
              ? 'border-primary-600 text-primary-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Tags size={16} />
          分类管理
        </button>
      </div>

      {activeTab === 'categories' ? (
        <CategoryManager embedded />
      ) : (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-800">食材列表</h2>
              <p className="text-gray-500 text-sm">管理食材信息，包括分类、单位换算和价格</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleBatchMatch}
                disabled={batchMatching}
                className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-600 rounded-lg font-medium hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {batchMatching ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                <span>批量匹配图片</span>
              </button>
              <button onClick={openAdd} className="btn-primary flex items-center gap-2">
                <Plus size={18} />
                <span>新增食材</span>
              </button>
            </div>
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
              className="search-input"
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
                  <label className="block text-sm font-medium text-gray-700 mb-2">食材图片</label>
                  <div className="space-y-3">
                    {/* 当前图片预览 */}
                    <div className="flex items-center gap-4">
                      <div
                        className="w-20 h-20 rounded-xl bg-gray-100 border border-gray-200 overflow-hidden flex items-center justify-center cursor-pointer hover:ring-2 hover:ring-primary-300 transition-all flex-shrink-0"
                        onClick={() => form.image && setPreviewImage(form.image)}
                      >
                        {form.image ? (
                          <img src={form.image} alt="预览" className="w-full h-full object-cover" />
                        ) : (
                          <ImageIcon className="text-gray-300" size={28} />
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => handleSmartMatch()}
                            disabled={generatingImage || !form.name.trim()}
                            className="inline-flex items-center gap-1.5 px-3 py-2 bg-primary-50 text-primary-600 rounded-lg text-sm font-medium hover:bg-primary-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {generatingImage ? (
                              <>
                                <Loader2 size={15} className="animate-spin" />
                                生成中...
                              </>
                            ) : (
                              <>
                                <Wand2 size={15} />
                                智能匹配
                              </>
                            )}
                          </button>
                          {form.image && (
                            <button
                              type="button"
                              onClick={() => setForm({ ...form, image: '' })}
                              className="inline-flex items-center gap-1.5 px-3 py-2 bg-gray-50 text-gray-500 rounded-lg text-sm font-medium hover:bg-gray-100 transition-colors"
                            >
                              <X size={15} />
                              清除
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setShowManualUrl(!showManualUrl)}
                            className="inline-flex items-center gap-1.5 px-3 py-2 bg-gray-50 text-gray-500 rounded-lg text-sm font-medium hover:bg-gray-100 transition-colors"
                          >
                            {showManualUrl ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                            手动输入URL
                          </button>
                        </div>
                        <p className="text-xs text-gray-400 mt-1.5">
                          {generatingImage
                            ? '正在生成图片并等待加载完成，请稍候...'
                            : form.image
                            ? '点击图片可放大预览'
                            : '点击"智能匹配"根据食材名称自动生成图片'}
                        </p>
                      </div>
                    </div>

                    {/* 手动输入URL */}
                    {showManualUrl && (
                      <input
                        type="text"
                        value={form.image}
                        onChange={(e) => setForm({ ...form, image: e.target.value })}
                        placeholder="输入图片URL..."
                        className="input-field text-sm"
                      />
                    )}

                    {/* 候选图片预览 */}
                    {currentCandidate && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-gray-500 flex items-center gap-1">
                            <Sparkles size={12} className="text-primary-500" />
                            候选图片预览
                          </p>
                          <button
                            type="button"
                            onClick={handleRegenerate}
                            disabled={generatingImage}
                            className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1"
                          >
                            <RefreshCw size={12} />
                            换一张
                          </button>
                        </div>
                        <div className="flex items-center gap-4">
                          <div
                            className="w-32 h-32 rounded-xl border-2 border-primary-500 ring-2 ring-primary-200 overflow-hidden cursor-pointer flex-shrink-0"
                            onClick={() => setPreviewImage(currentCandidate)}
                          >
                            <img
                              src={currentCandidate}
                              alt="候选图片"
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div className="flex flex-col gap-2">
                            <button
                              type="button"
                              onClick={handleAdoptCandidate}
                              className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 transition-colors"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                              采用此图片
                            </button>
                            <button
                              type="button"
                              onClick={() => setCurrentCandidate(null)}
                              className="inline-flex items-center gap-1.5 px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
                            >
                              <X size={14} />
                              取消
                            </button>
                            <p className="text-xs text-gray-400">点击左侧图片可放大预览</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
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

      {/* 图片放大预览 */}
      {previewImage && (
        <div
          className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-8"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-w-md max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
            <img
              src={previewImage}
              alt="放大预览"
              className="rounded-xl shadow-2xl max-w-full max-h-[80vh] object-contain"
            />
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute -top-3 -right-3 w-8 h-8 bg-white rounded-full shadow-lg flex items-center justify-center hover:bg-gray-100"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      {/* 批量匹配进度 */}
      {batchProgress && (
        <div className="fixed bottom-6 right-6 z-50 bg-white rounded-xl shadow-xl border border-gray-100 p-4 w-72 animate-slide-up">
          <div className="flex items-center gap-3 mb-2">
            {batchMatching ? (
              <Loader2 size={18} className="animate-spin text-primary-500" />
            ) : (
              <Sparkles size={18} className="text-green-500" />
            )}
            <span className="text-sm font-medium text-gray-700">
              {batchMatching ? '批量匹配图片中...' : '批量匹配完成'}
            </span>
          </div>
          {batchProgress.total > 0 && (
            <>
              <div className="w-full bg-gray-100 rounded-full h-2 mb-2">
                <div
                  className="bg-primary-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
                />
              </div>
              <p className="text-xs text-gray-500">
                {batchProgress.current} / {batchProgress.total} - {batchProgress.currentName}
              </p>
            </>
          )}
          {batchProgress.total === 0 && (
            <p className="text-xs text-gray-500">{batchProgress.currentName}</p>
          )}
          {batchProgress.message && (
            <p className="text-xs text-green-600 mt-1">{batchProgress.message}</p>
          )}
        </div>
      )}
    </div>
      )}
    </div>
  );
}
