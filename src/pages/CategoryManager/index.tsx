import { useState } from 'react';
import { Plus, Pencil, Trash2, X, Check, AlertCircle, ArrowUp, ArrowDown } from 'lucide-react';
import { useCategoryStore } from '@/store/categoryStore';
import type { Category } from '@/types';

interface FormState {
  id?: string;
  name: string;
  icon: string;
  color: string;
}

const DEFAULT_ICONS = ['🥬', '🥩', '🐟', '🧂', '🍚', '🥚', '🧈', '🍎', '🥦', '🧄', '🍗', '🦐', '🍞', '🥛', '🍯'];

const DEFAULT_COLORS = [
  '#10b981', '#ef4444', '#3b82f6', '#f59e0b', '#a855f7',
  '#ec4899', '#14b8a6', '#f97316', '#8b5cf6', '#06b6d4',
];

export default function CategoryManager() {
  const { categories, addCategory, updateCategory, deleteCategory, moveCategoryUp, moveCategoryDown } = useCategoryStore();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [form, setForm] = useState<FormState>({ name: '', icon: '🥬', color: '#10b981' });
  const [error, setError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const openAdd = () => {
    setEditing(null);
    setForm({ name: '', icon: '🥬', color: '#10b981' });
    setError('');
    setShowModal(true);
  };

  const openEdit = (cat: Category) => {
    setEditing(cat);
    setForm({ id: cat.id, name: cat.name, icon: cat.icon, color: cat.color });
    setError('');
    setShowModal(true);
  };

  const handleSubmit = async () => {
    setError('');
    if (!form.name.trim()) {
      setError('请输入分类名称');
      return;
    }
    try {
      if (editing) {
        await updateCategory(editing.id, { name: form.name.trim(), icon: form.icon, color: form.color });
      } else {
        await addCategory({ name: form.name.trim(), icon: form.icon, color: form.color });
      }
      setShowModal(false);
    } catch (err: any) {
      setError(err.message || '操作失败');
    }
  };

  const handleDelete = (id: string) => {
    deleteCategory(id);
    setDeleteConfirm(null);
  };

  const handleMoveUp = (id: string) => {
    moveCategoryUp(id);
  };

  const handleMoveDown = (id: string) => {
    moveCategoryDown(id);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-serif font-bold text-gray-800">食材分类管理</h1>
          <p className="text-gray-500 mt-1">管理食材分类，支持新增、编辑、删除和排序</p>
        </div>
        <button onClick={openAdd} className="btn-primary flex items-center gap-2">
          <Plus size={18} />
          <span>新增分类</span>
        </button>
      </div>

      <div className="card">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {categories.map((cat, index) => (
            <div
              key={cat.id}
              className="p-4 rounded-xl border border-gray-100 hover:border-gray-200 hover:shadow-md transition-all group relative"
            >
              <div className="flex items-center gap-3 mb-3">
                <span
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-xl"
                  style={{ backgroundColor: cat.color + '20' }}
                >
                  {cat.icon}
                </span>
                <span className="font-medium text-gray-800">{cat.name}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400 flex items-center gap-1">
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: cat.color }} />
                  主题色
                </span>
                <span className="text-gray-400">#{index + 1}</span>
              </div>
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => handleMoveUp(cat.id)}
                  disabled={index === 0}
                  className="p-1.5 bg-white border border-gray-200 rounded-md text-gray-500 hover:text-primary-600 hover:border-primary-300 hover:bg-primary-50 disabled:opacity-30 disabled:cursor-not-allowed"
                  title="上移"
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  onClick={() => handleMoveDown(cat.id)}
                  disabled={index === categories.length - 1}
                  className="p-1.5 bg-white border border-gray-200 rounded-md text-gray-500 hover:text-primary-600 hover:border-primary-300 hover:bg-primary-50 disabled:opacity-30 disabled:cursor-not-allowed"
                  title="下移"
                >
                  <ArrowDown size={14} />
                </button>
                <button
                  onClick={() => openEdit(cat)}
                  className="p-1.5 bg-white border border-gray-200 rounded-md text-gray-500 hover:text-primary-600 hover:border-primary-300 hover:bg-primary-50"
                  title="编辑"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => setDeleteConfirm(cat.id)}
                  className="p-1.5 bg-white border border-gray-200 rounded-md text-gray-500 hover:text-danger-600 hover:border-danger-300 hover:bg-danger-50"
                  title="删除"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 新增/编辑弹窗 */}
      {showModal && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-md animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-800">
                {editing ? '编辑分类' : '新增分类'}
              </h3>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-gray-100 rounded-md">
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">分类名称</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="请输入分类名称"
                  className="input-field"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">分类图标</label>
                <div className="flex flex-wrap gap-2">
                  {DEFAULT_ICONS.map((icon) => (
                    <button
                      key={icon}
                      onClick={() => setForm({ ...form, icon })}
                      className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl transition-all ${
                        form.icon === icon
                          ? 'bg-primary-100 ring-2 ring-primary-500'
                          : 'bg-gray-50 hover:bg-gray-100'
                      }`}
                    >
                      {icon}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">主题颜色</label>
                <div className="flex flex-wrap gap-2">
                  {DEFAULT_COLORS.map((color) => (
                    <button
                      key={color}
                      onClick={() => setForm({ ...form, color })}
                      className={`w-8 h-8 rounded-full transition-all ${
                        form.color === color ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : ''
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 text-danger-600 bg-danger-50 p-3 rounded-lg text-sm">
                  <AlertCircle size={16} />
                  <span>{error}</span>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 p-5 border-t border-gray-100">
              <button onClick={() => setShowModal(false)} className="btn-secondary">
                取消
              </button>
              <button onClick={handleSubmit} className="btn-primary flex items-center gap-2">
                <Check size={18} />
                <span>{editing ? '保存修改' : '确认新增'}</span>
              </button>
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
              <p className="text-gray-500 text-sm">删除后该分类将被移除，确认要删除吗？</p>
            </div>
            <div className="flex justify-center gap-3 p-5 border-t border-gray-100">
              <button onClick={() => setDeleteConfirm(null)} className="btn-secondary">
                取消
              </button>
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
    </div>
  );
}
