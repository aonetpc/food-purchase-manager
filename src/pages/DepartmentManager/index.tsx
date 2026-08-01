import { useState, useEffect } from 'react';
import {
  Building2, Truck, Plus, Pencil, Trash2, ChevronUp, ChevronDown, AlertCircle, X
} from 'lucide-react';
import { api } from '@/lib/api';
import { useDepartmentStore, type Department } from '@/store/departmentStore';
import { useSupplierStore } from '@/store/supplierStore';
import type { Supplier } from '@/types';

type TabType = 'departments' | 'suppliers';

export default function DepartmentManager() {
  const [activeTab, setActiveTab] = useState<TabType>('departments');

  // 部门管理相关
  const {
    departments,
    loading: deptLoading,
    error: deptError,
    fetchDepartments,
    addDepartment,
    updateDepartment,
    deleteDepartment,
    moveUp: moveDeptUp,
    moveDown: moveDeptDown,
  } = useDepartmentStore();

  const [showAddDeptModal, setShowAddDeptModal] = useState(false);
  const [newDeptName, setNewDeptName] = useState('');
  const [addDeptError, setAddDeptError] = useState('');

  const [editDeptId, setEditDeptId] = useState<string | null>(null);
  const [editDeptName, setEditDeptName] = useState('');
  const [editDeptError, setEditDeptError] = useState('');
  const [editDeptConfirmer, setEditDeptConfirmer] = useState('');
  const [editDeptWecomId, setEditDeptWecomId] = useState('');

  const [hoveredDeptId, setHoveredDeptId] = useState<string | null>(null);

  // 供应商管理相关
  const {
    suppliers,
    loading: supplierLoading,
    error: supplierError,
    fetchSuppliers,
    addSupplier,
    updateSupplier,
    deleteSupplier,
    moveUp: moveSupplierUp,
    moveDown: moveSupplierDown,
  } = useSupplierStore();

  const [showAddSupplierModal, setShowAddSupplierModal] = useState(false);
  const [newSupplier, setNewSupplier] = useState({ name: '', contact: '', phone: '', address: '' });
  const [addSupplierError, setAddSupplierError] = useState('');

  const [editSupplierId, setEditSupplierId] = useState<string | null>(null);
  const [editSupplier, setEditSupplier] = useState<Supplier | null>(null);
  const [editSupplierError, setEditSupplierError] = useState('');

  const [hoveredSupplierId, setHoveredSupplierId] = useState<string | null>(null);

  useEffect(() => {
    fetchDepartments();
    fetchSuppliers();
  }, [fetchDepartments, fetchSuppliers]);

  // 部门操作
  const handleAddDept = async () => {
    setAddDeptError('');
    if (!newDeptName.trim()) {
      setAddDeptError('请输入部门名称');
      return;
    }

    const success = await addDepartment(newDeptName.trim());
    if (success) {
      setShowAddDeptModal(false);
      setNewDeptName('');
    } else {
      setAddDeptError(deptError || '添加失败');
    }
  };

  const handleEditDept = async (dept: Department) => {
    setEditDeptId(dept.id);
    setEditDeptName(dept.name);
    setEditDeptConfirmer(dept.confirmer_userid || '');
    setEditDeptWecomId(dept.wecom_dept_id || '');
    setEditDeptError('');
  };

  const handleSaveEditDept = async () => {
    setEditDeptError('');
    if (!editDeptName.trim()) {
      setEditDeptError('请输入部门名称');
      return;
    }

    // 一次性保存所有字段
    try {
      await api.put(`/departments/${editDeptId}`, {
        confirmer_userid: editDeptConfirmer.trim() || null,
        wecom_dept_id: editDeptWecomId.trim() || null,
      });
    } catch (e) {
      // 忽略错误，继续保存名称
    }
    const success = await updateDepartment(editDeptId!, editDeptName.trim());
    if (success) {
      setEditDeptId(null);
      setEditDeptName('');
    } else {
      setEditDeptError(deptError || '更新失败');
    }
  };

  const handleDeleteDept = async (id: string) => {
    if (window.confirm('确定删除该部门吗？')) {
      await deleteDepartment(id);
    }
  };

  // 供应商操作
  const handleAddSupplier = async () => {
    setAddSupplierError('');
    if (!newSupplier.name.trim()) {
      setAddSupplierError('请输入供应商名称');
      return;
    }

    const success = await addSupplier({
      name: newSupplier.name.trim(),
      contact: newSupplier.contact.trim(),
      phone: newSupplier.phone.trim(),
      address: newSupplier.address.trim(),
    });

    if (success) {
      setShowAddSupplierModal(false);
      setNewSupplier({ name: '', contact: '', phone: '', address: '' });
    } else {
      setAddSupplierError(supplierError || '添加失败');
    }
  };

  const handleEditSupplier = async (supplier: Supplier) => {
    setEditSupplierId(supplier.id);
    setEditSupplier({ ...supplier });
    setEditSupplierError('');
  };

  const handleSaveEditSupplier = async () => {
    setEditSupplierError('');
    if (!editSupplier?.name.trim()) {
      setEditSupplierError('请输入供应商名称');
      return;
    }

    const success = await updateSupplier(editSupplierId!, {
      name: editSupplier.name.trim(),
      contact: editSupplier.contact?.trim(),
      phone: editSupplier.phone?.trim(),
      address: editSupplier.address?.trim(),
    });

    if (success) {
      setEditSupplierId(null);
      setEditSupplier(null);
    } else {
      setEditSupplierError(supplierError || '更新失败');
    }
  };

  const handleDeleteSupplier = async (id: string) => {
    if (window.confirm('确定删除该供应商吗？')) {
      await deleteSupplier(id);
    }
  };

  const loading = deptLoading || supplierLoading;
  const error = activeTab === 'departments' ? deptError : supplierError;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold text-gray-800">部门与供应商管理</h1>
          <p className="text-gray-500 mt-1">管理采购部门和供应商，用于分类采购记录</p>
        </div>
        <button
          onClick={() => {
            if (activeTab === 'departments') {
              setShowAddDeptModal(true);
            } else {
              setShowAddSupplierModal(true);
            }
          }}
          className="btn-primary flex items-center gap-2"
        >
          <Plus size={18} />
          {activeTab === 'departments' ? '新增部门' : '新增供应商'}
        </button>
      </div>

      {/* 标签切换 */}
      <div className="flex gap-4 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('departments')}
          className={`pb-3 px-4 font-medium transition-colors relative ${
            activeTab === 'departments'
              ? 'text-primary-600 border-b-2 border-primary-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <div className="flex items-center gap-2">
            <Building2 size={18} />
            部门管理
          </div>
        </button>
        <button
          onClick={() => setActiveTab('suppliers')}
          className={`pb-3 px-4 font-medium transition-colors relative ${
            activeTab === 'suppliers'
              ? 'text-primary-600 border-b-2 border-primary-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <div className="flex items-center gap-2">
            <Truck size={18} />
            供应商管理
          </div>
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
      ) : activeTab === 'departments' ? (
        // 部门列表
        departments.length === 0 ? (
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
                onMouseEnter={() => setHoveredDeptId(dept.id)}
                onMouseLeave={() => setHoveredDeptId(null)}
              >
                {editDeptId === dept.id ? (
                  <div className="p-4">
                    <input
                      type="text"
                      value={editDeptName}
                      onChange={(e) => setEditDeptName(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                      autoFocus
                    />
                    <input
                      type="text"
                      value={editDeptConfirmer}
                      onChange={(e) => setEditDeptConfirmer(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 mt-2"
                      placeholder="确认人企微UserID"
                    />
                    <p className="text-xs text-gray-400 -mt-1">确认人企微UserID（用于采购确认）</p>
                    <input
                      type="text"
                      value={editDeptWecomId}
                      onChange={(e) => setEditDeptWecomId(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 mt-2"
                      placeholder="企微部门ID（数字，如：2）"
                    />
                    <p className="text-xs text-gray-400 -mt-1">企微部门ID：在企业微信管理后台→通讯录中查看部门ID</p>
                    {editDeptError && (
                      <p className="text-danger-500 text-xs mt-2">{editDeptError}</p>
                    )}
                    <div className="flex gap-2 mt-3">
                      <button onClick={handleSaveEditDept} className="btn-primary flex-1">
                        保存
                      </button>
                      <button onClick={() => setEditDeptId(null)} className="btn-secondary flex-1">
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
                        <div className="flex items-center gap-2 flex-wrap">
                          {idx === 0 && (
                            <span className="text-xs text-primary-500">默认部门</span>
                          )}
                          {dept.confirmer_userid && (
                            <span className="text-xs text-gray-400">确认人: {dept.confirmer_userid}</span>
                          )}
                          {dept.wecom_dept_id && (
                            <span className="text-xs text-blue-400">企微ID: {dept.wecom_dept_id}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    {hoveredDeptId === dept.id && (
                      <div className="absolute top-2 right-2 flex items-center gap-1 bg-white shadow-lg rounded-lg p-1">
                        {idx > 0 && (
                          <button
                            onClick={() => moveDeptUp(dept.id)}
                            className="p-1.5 text-gray-400 hover:text-primary-500 hover:bg-primary-50 rounded transition-colors"
                            title="上移"
                          >
                            <ChevronUp size={16} />
                          </button>
                        )}
                        {idx < departments.length - 1 && (
                          <button
                            onClick={() => moveDeptDown(dept.id)}
                            className="p-1.5 text-gray-400 hover:text-primary-500 hover:bg-primary-50 rounded transition-colors"
                            title="下移"
                          >
                            <ChevronDown size={16} />
                          </button>
                        )}
                        <button
                          onClick={() => handleEditDept(dept)}
                          className="p-1.5 text-gray-400 hover:text-primary-500 hover:bg-primary-50 rounded transition-colors"
                          title="编辑"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          onClick={() => handleDeleteDept(dept.id)}
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
        )
      ) : (
        // 供应商列表
        suppliers.length === 0 ? (
          <div className="card flex flex-col items-center justify-center py-20">
            <Truck size={64} className="text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-600 mb-2">暂无供应商</h3>
            <p className="text-gray-400 text-sm mb-6">请添加供应商以便记录采购来源</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {suppliers.map((supplier, idx) => (
              <div
                key={supplier.id}
                className="card relative group hover:shadow-lg transition-shadow"
                onMouseEnter={() => setHoveredSupplierId(supplier.id)}
                onMouseLeave={() => setHoveredSupplierId(null)}
              >
                {editSupplierId === supplier.id ? (
                  <div className="p-4 space-y-3">
                    <input
                      type="text"
                      value={editSupplier?.name || ''}
                      onChange={(e) => setEditSupplier(prev => prev ? { ...prev, name: e.target.value } : null)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                      placeholder="供应商名称"
                      autoFocus
                    />
                    <input
                      type="text"
                      value={editSupplier?.contact || ''}
                      onChange={(e) => setEditSupplier(prev => prev ? { ...prev, contact: e.target.value } : null)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                      placeholder="联系人"
                    />
                    <input
                      type="text"
                      value={editSupplier?.phone || ''}
                      onChange={(e) => setEditSupplier(prev => prev ? { ...prev, phone: e.target.value } : null)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                      placeholder="电话"
                    />
                    <input
                      type="text"
                      value={editSupplier?.address || ''}
                      onChange={(e) => setEditSupplier(prev => prev ? { ...prev, address: e.target.value } : null)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                      placeholder="地址"
                    />
                    {editSupplierError && (
                      <p className="text-danger-500 text-xs">{editSupplierError}</p>
                    )}
                    <div className="flex gap-2">
                      <button onClick={handleSaveEditSupplier} className="btn-primary flex-1">
                        保存
                      </button>
                      <button onClick={() => setEditSupplierId(null)} className="btn-secondary flex-1">
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-gray-400"># {idx + 1}</span>
                        <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center text-blue-600">
                          <Truck size={20} />
                        </div>
                        <div>
                          <h3 className="font-medium text-gray-800">{supplier.name}</h3>
                          {idx === 0 && (
                            <span className="text-xs text-blue-500">默认供应商</span>
                          )}
                        </div>
                      </div>
                      {hoveredSupplierId === supplier.id && (
                        <div className="absolute top-2 right-2 flex items-center gap-1 bg-white shadow-lg rounded-lg p-1">
                          {idx > 0 && (
                            <button
                              onClick={() => moveSupplierUp(supplier.id)}
                              className="p-1.5 text-gray-400 hover:text-primary-500 hover:bg-primary-50 rounded transition-colors"
                              title="上移"
                            >
                              <ChevronUp size={16} />
                            </button>
                          )}
                          {idx < suppliers.length - 1 && (
                            <button
                              onClick={() => moveSupplierDown(supplier.id)}
                              className="p-1.5 text-gray-400 hover:text-primary-500 hover:bg-primary-50 rounded transition-colors"
                              title="下移"
                            >
                              <ChevronDown size={16} />
                            </button>
                          )}
                          <button
                            onClick={() => handleEditSupplier(supplier)}
                            className="p-1.5 text-gray-400 hover:text-primary-500 hover:bg-primary-50 rounded transition-colors"
                            title="编辑"
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            onClick={() => handleDeleteSupplier(supplier.id)}
                            className="p-1.5 text-gray-400 hover:text-danger-500 hover:bg-danger-50 rounded transition-colors"
                            title="删除"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      )}
                    </div>
                    {(supplier.contact || supplier.phone || supplier.address) && (
                      <div className="text-xs text-gray-500 space-y-1 mt-2">
                        {supplier.contact && (
                          <div className="flex items-center gap-2">
                            <span className="text-gray-400">联系人:</span>
                            <span>{supplier.contact}</span>
                          </div>
                        )}
                        {supplier.phone && (
                          <div className="flex items-center gap-2">
                            <span className="text-gray-400">电话:</span>
                            <span>{supplier.phone}</span>
                          </div>
                        )}
                        {supplier.address && (
                          <div className="flex items-center gap-2">
                            <span className="text-gray-400">地址:</span>
                            <span>{supplier.address}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}

      {/* 新增部门模态框 */}
      {showAddDeptModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowAddDeptModal(false)}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">新增部门</h3>
              <button onClick={() => setShowAddDeptModal(false)} className="p-1 hover:bg-gray-100 rounded-md">
                <X size={20} className="text-gray-500" />
              </button>
            </div>
            <input
              type="text"
              value={newDeptName}
              onChange={(e) => setNewDeptName(e.target.value)}
              placeholder="部门名称"
              className="w-full border border-gray-200 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
              autoFocus
            />
            {addDeptError && (
              <p className="text-danger-500 text-sm mt-2">{addDeptError}</p>
            )}
            <div className="flex gap-3 mt-4">
              <button onClick={() => setShowAddDeptModal(false)} className="btn-secondary flex-1">
                取消
              </button>
              <button onClick={handleAddDept} className="btn-primary flex-1">
                添加
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 新增供应商模态框 */}
      {showAddSupplierModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowAddSupplierModal(false)}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">新增供应商</h3>
              <button onClick={() => setShowAddSupplierModal(false)} className="p-1 hover:bg-gray-100 rounded-md">
                <X size={20} className="text-gray-500" />
              </button>
            </div>
            <div className="space-y-3">
              <input
                type="text"
                value={newSupplier.name}
                onChange={(e) => setNewSupplier(prev => ({ ...prev, name: e.target.value }))}
                placeholder="供应商名称 *"
                className="w-full border border-gray-200 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                autoFocus
              />
              <input
                type="text"
                value={newSupplier.contact}
                onChange={(e) => setNewSupplier(prev => ({ ...prev, contact: e.target.value }))}
                placeholder="联系人"
                className="w-full border border-gray-200 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
              />
              <input
                type="text"
                value={newSupplier.phone}
                onChange={(e) => setNewSupplier(prev => ({ ...prev, phone: e.target.value }))}
                placeholder="电话"
                className="w-full border border-gray-200 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
              />
              <input
                type="text"
                value={newSupplier.address}
                onChange={(e) => setNewSupplier(prev => ({ ...prev, address: e.target.value }))}
                placeholder="地址"
                className="w-full border border-gray-200 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
              />
            </div>
            {addSupplierError && (
              <p className="text-danger-500 text-sm mt-2">{addSupplierError}</p>
            )}
            <div className="flex gap-3 mt-4">
              <button onClick={() => setShowAddSupplierModal(false)} className="btn-secondary flex-1">
                取消
              </button>
              <button onClick={handleAddSupplier} className="btn-primary flex-1">
                添加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}