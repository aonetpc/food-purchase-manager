import { useState, useEffect } from 'react';
import {
  Building2, Plus, Pencil, Trash2, ChevronUp, ChevronDown, AlertCircle, X
} from 'lucide-react';
import { useDepartmentStore, type Department } from '@/store/departmentStore';

export default function DepartmentManager() {
  const {
    departments,
    loading,
    error,
    fetchDepartments,
    addDepartment,
    updateDepartment,
    deleteDepartment,
    moveUp,
    moveDown,
  } = useDepartmentStore();

  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState('');

  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editError, setEditError] = useState('');

  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => {
    fetchDepartments();
  }, [fetchDepartments]);

  const handleAdd = async () => {
    setAddError('');
    if (!newName.trim()) {
      setAddError('请输入部门名称');
      return;
    }

    const success = await addDepartment(newName.trim());
    if (success) {
      setShowAddModal(false);
      setNewName('');
    } else {
      setAddError(error || '添加失败');
    }
  };

  const handleEdit = async (dept: Department) => {
    setEditId(dept.id);
    setEditName(dept.name);
    setEditError('');
  };

  const handleSaveEdit = async () => {
    setEditError('');
    if (!editName.trim()) {
      setEditError('请输入部门名称');
      return;
    }

    const success = await updateDepartment(editId!, editName.trim());
    if (success) {
      setEditId(null);
      setEditName('');
    } else {
      setEditError(error || '更新失败');
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('确定删除该部门吗？')) {
      await deleteDepartment(id);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold text-gray-800">部门管理</h1>
          <p className="text-gray-500 mt-1">管理采购部门，用于区分不同部门的采购记录</p>
        </div>
        <button onClick={() => setShowAddModal(true)} className="btn-primary flex items-center gap-2">
          <Plus size={18} />
          新增部门
        </button>
      </div>

      {error && (
        <div className="bg-danger-50 border border-danger-200 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle size={20} className="text-danger-500" />
          <span className="text-danger-700">{error}</span>
        </div>
      )}

      {loading ? (
        <div className="text-center py-10 text-gray-500">加载中...</div>
      ) : departments.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-20">
          <Building2 size={64} className="text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-600 mb-2">暂无部门</h3>
          <p className="text-gray-400 text-sm mb-6">请添加部门以便分类采购记录</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {departments.map((dept, idx) => (
            <div
              key={dept.id}
              className="card relative group hover:shadow-lg transition-shadow"
              onMouseEnter={() => setHoveredId(dept.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              {editId === dept.id ? (
                <div className="p-4">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                    autoFocus
                  />
                  {editError && (
                    <p className="text-danger-500 text-xs mt-2">{editError}</p>
                  )}
                  <div className="flex gap-2 mt-3">
                    <button onClick={handleSaveEdit} className="btn-primary flex-1">
                      保存
                    </button>
                    <button onClick={() => setEditId(null)} className="btn-secondary flex-1">
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-400"># {idx + 1}</span>
                    <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center text-primary-600">
                      <Building2 size={20} />
                    </div>
                    <div>
                      <h3 className="font-medium text-gray-800">{dept.name}</h3>
                      {idx === 0 && (
                        <span className="text-xs text-primary-500">默认部门</span>
                      )}
                    </div>
                  </div>
                  {hoveredId === dept.id && (
                    <div className="absolute top-2 right-2 flex items-center gap-1 bg-white shadow-lg rounded-lg p-1">
                      {idx > 0 && (
                        <button
                          onClick={() => moveUp(dept.id)}
                          className="p-1.5 text-gray-400 hover:text-primary-500 hover:bg-primary-50 rounded transition-colors"
                          title="上移"
                        >
                          <ChevronUp size={16} />
                        </button>
                      )}
                      {idx < departments.length - 1 && (
                        <button
                          onClick={() => moveDown(dept.id)}
                          className="p-1.5 text-gray-400 hover:text-primary-500 hover:bg-primary-50 rounded transition-colors"
                          title="下移"
                        >
                          <ChevronDown size={16} />
                        </button>
                      )}
                      <button
                        onClick={() => handleEdit(dept)}
                        className="p-1.5 text-gray-400 hover:text-primary-500 hover:bg-primary-50 rounded transition-colors"
                        title="编辑"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => handleDelete(dept.id)}
                        className="p-1.5 text-gray-400 hover:text-danger-500 hover:bg-danger-50 rounded transition-colors"
                        title="删除"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowAddModal(false)}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">新增部门</h3>
              <button onClick={() => setShowAddModal(false)} className="p-1 hover:bg-gray-100 rounded-md">
                <X size={20} className="text-gray-500" />
              </button>
            </div>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="部门名称"
              className="w-full border border-gray-200 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
              autoFocus
            />
            {addError && (
              <p className="text-danger-500 text-sm mt-2">{addError}</p>
            )}
            <div className="flex gap-3 mt-4">
              <button onClick={() => setShowAddModal(false)} className="btn-secondary flex-1">
                取消
              </button>
              <button onClick={handleAdd} className="btn-primary flex-1">
                添加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}