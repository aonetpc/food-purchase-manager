import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Plus, Edit, Trash2, X, Shield, Users } from 'lucide-react';

interface Role {
  id: string;
  code: string;
  name: string;
  description: string;
  is_system: number;
  sort_order: number;
  user_count?: number;
}

interface PermissionModule {
  code: string;
  name: string;
  permissions: {
    id: string;
    code: string;
    name: string;
    type: string;
    path?: string;
    icon?: string;
  }[];
}

export default function RoleManager() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPermModal, setShowPermModal] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [permRole, setPermRole] = useState<Role | null>(null);
  const [formData, setFormData] = useState({ code: '', name: '', description: '' });
  const [formMessage, setFormMessage] = useState('');

  const [allPermissions, setAllPermissions] = useState<PermissionModule[]>([]);
  const [rolePermissionIds, setRolePermissionIds] = useState<string[]>([]);
  const [permLoading, setPermLoading] = useState(false);

  useEffect(() => {
    fetchRoles();
  }, []);

  const fetchRoles = async () => {
    setLoading(true);
    try {
      const data = await api.get<Role[]>('/roles');
      setRoles(data);
    } catch (err: any) {
      setError(err.message || '获取角色列表失败');
    } finally {
      setLoading(false);
    }
  };

  const openPermModal = async (role: Role) => {
    setPermRole(role);
    setShowPermModal(true);
    setPermLoading(true);
    try {
      const [perms, rolePerms] = await Promise.all([
        api.get<PermissionModule[]>('/roles/permissions/all'),
        api.get<any[]>(`/roles/${role.id}/permissions`),
      ]);
      setAllPermissions(perms);
      setRolePermissionIds(rolePerms.map((p: any) => p.id));
    } catch (err: any) {
      setFormMessage('加载权限失败：' + err.message);
    } finally {
      setPermLoading(false);
    }
  };

  const handleSavePermissions = async () => {
    if (!permRole) return;
    setPermLoading(true);
    try {
      await api.put(`/roles/${permRole.id}/permissions`, { permissionIds: rolePermissionIds });
      setShowPermModal(false);
      setPermRole(null);
    } catch (err: any) {
      setFormMessage('保存失败：' + err.message);
    } finally {
      setPermLoading(false);
    }
  };

  const togglePermission = (permId: string) => {
    if (rolePermissionIds.includes(permId)) {
      setRolePermissionIds(rolePermissionIds.filter(id => id !== permId));
    } else {
      setRolePermissionIds([...rolePermissionIds, permId]);
    }
  };

  const toggleModule = (module: PermissionModule) => {
    const modulePermIds = module.permissions.map(p => p.id);
    const allChecked = modulePermIds.every(id => rolePermissionIds.includes(id));
    if (allChecked) {
      setRolePermissionIds(rolePermissionIds.filter(id => !modulePermIds.includes(id)));
    } else {
      const newIds = new Set([...rolePermissionIds, ...modulePermIds]);
      setRolePermissionIds(Array.from(newIds));
    }
  };

  const handleAddRole = async () => {
    setFormMessage('');
    if (!formData.code || !formData.name) {
      setFormMessage('角色编码和名称为必填项');
      return;
    }
    try {
      await api.post('/roles', formData);
      setShowAddModal(false);
      setFormData({ code: '', name: '', description: '' });
      await fetchRoles();
    } catch (err: any) {
      setFormMessage(err.message || '创建失败');
    }
  };

  const handleEditRole = async () => {
    setFormMessage('');
    if (!editingRole) return;
    try {
      await api.put(`/roles/${editingRole.id}`, { name: formData.name, description: formData.description });
      setShowEditModal(false);
      setEditingRole(null);
      await fetchRoles();
    } catch (err: any) {
      setFormMessage(err.message || '更新失败');
    }
  };

  const handleDeleteRole = async (role: Role) => {
    if (!confirm(`确定要删除角色"${role.name}"吗？`)) return;
    try {
      await api.delete(`/roles/${role.id}`);
      await fetchRoles();
    } catch (err: any) {
      alert('删除失败：' + err.message);
    }
  };

  return (
    <div className="p-6">
      <div className="max-w-5xl mx-auto">
        <div className="bg-white rounded-xl shadow-lg p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-800">角色管理</h2>
            <button
              onClick={() => {
                setFormData({ code: '', name: '', description: '' });
                setFormMessage('');
                setShowAddModal(true);
              }}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              <Plus size={18} />
              新增角色
            </button>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
          )}

          {loading ? (
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
              <p className="mt-2 text-gray-500">加载中...</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">角色名称</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">编码</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">描述</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">用户数</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {roles.map((role) => (
                    <tr key={role.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-800">
                        <div className="flex items-center gap-2">
                          {role.name}
                          {role.is_system === 1 && (
                            <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 text-xs rounded">内置</span>
                          )}
                          {role.code === 'admin' && (
                            <span className="px-1.5 py-0.5 bg-red-50 text-red-600 text-xs rounded">总管理</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 font-mono">{role.code}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{role.description || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{role.user_count || 0}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openPermModal(role)}
                            className={`text-sm ${role.code === 'admin' ? 'text-gray-400 cursor-not-allowed' : 'text-green-600 hover:text-green-700'}`}
                            title={role.code === 'admin' ? '管理员权限不可修改' : '配置权限'}
                            disabled={role.code === 'admin'}
                          >
                            <Shield size={16} />
                          </button>
                          {role.code !== 'admin' && (
                            <>
                              <button
                                onClick={() => {
                                  setEditingRole(role);
                                  setFormData({ code: role.code, name: role.name, description: role.description });
                                  setFormMessage('');
                                  setShowEditModal(true);
                                }}
                                className="text-blue-600 hover:text-blue-700 text-sm"
                                title="编辑"
                              >
                                <Edit size={16} />
                              </button>
                              {role.is_system !== 1 && (
                                <button
                                  onClick={() => handleDeleteRole(role)}
                                  className="text-red-500 hover:text-red-600 text-sm"
                                  title="删除"
                                >
                                  <Trash2 size={16} />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {roles.length === 0 && !loading && (
                <div className="text-center py-8 text-gray-500">暂无角色数据</div>
              )}
            </div>
          )}

          <div className="mt-4 p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
            <p className="flex items-center gap-2">
              <Users size={16} />
              说明：用户可同时拥有多个角色，权限取并集。管理员角色拥有所有权限且不可修改。
            </p>
          </div>
        </div>
      </div>

      {/* 新增角色弹窗 */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-semibold text-gray-800">新增角色</h3>
              <button onClick={() => setShowAddModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 space-y-4">
              {formMessage && (
                <div className="p-2 text-sm rounded bg-red-50 text-red-700">{formMessage}</div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">角色编码 *</label>
                <input
                  type="text"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                  placeholder="如：kitchen_manager"
                />
                <p className="mt-1 text-xs text-gray-400">英文+下划线，创建后不可修改</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">角色名称 *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                  placeholder="如：厨房管理员"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                  placeholder="角色描述"
                />
              </div>
            </div>
            <div className="flex gap-3 p-4 border-t">
              <button
                onClick={() => setShowAddModal(false)}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleAddRole}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 编辑角色弹窗 */}
      {showEditModal && editingRole && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-semibold text-gray-800">编辑角色</h3>
              <button onClick={() => setShowEditModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 space-y-4">
              {formMessage && (
                <div className="p-2 text-sm rounded bg-red-50 text-red-700">{formMessage}</div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">角色编码</label>
                <div className="px-3 py-2 bg-gray-50 rounded-lg text-gray-500 font-mono text-sm">{editingRole.code}</div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">角色名称 *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                />
              </div>
            </div>
            <div className="flex gap-3 p-4 border-t">
              <button
                onClick={() => setShowEditModal(false)}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleEditRole}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 权限配置弹窗 */}
      {showPermModal && permRole && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-semibold text-gray-800">
                配置权限 - {permRole.name}
              </h3>
              <button onClick={() => { setShowPermModal(false); setPermRole(null); }} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              {permLoading ? (
                <div className="text-center py-8 text-gray-500">加载中...</div>
              ) : (
                <div className="space-y-4">
                  {formMessage && (
                    <div className="p-2 text-sm rounded bg-red-50 text-red-700">{formMessage}</div>
                  )}
                  {allPermissions.map((module) => {
                    const modulePermIds = module.permissions.map(p => p.id);
                    const allChecked = modulePermIds.every(id => rolePermissionIds.includes(id));
                    const someChecked = modulePermIds.some(id => rolePermissionIds.includes(id));
                    return (
                      <div key={module.code} className="border border-gray-200 rounded-lg overflow-hidden">
                        <div className="bg-gray-50 px-4 py-2 flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={allChecked}
                            ref={(el) => { if (el) el.indeterminate = !allChecked && someChecked; }}
                            onChange={() => toggleModule(module)}
                            className="w-4 h-4 text-green-600 rounded focus:ring-green-500"
                          />
                          <span className="text-sm font-semibold text-gray-800">{module.name}</span>
                          <span className="text-xs text-gray-400">
                            ({modulePermIds.filter(id => rolePermissionIds.includes(id)).length}/{modulePermIds.length})
                          </span>
                        </div>
                        <div className="px-4 py-2 grid grid-cols-2 gap-2">
                          {module.permissions.map((perm) => (
                            <label key={perm.id} className="flex items-center gap-2 py-1 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={rolePermissionIds.includes(perm.id)}
                                onChange={() => togglePermission(perm.id)}
                                className="w-4 h-4 text-green-600 rounded focus:ring-green-500"
                              />
                              <div className="flex-1">
                                <span className="text-sm text-gray-700">{perm.name}</span>
                                <span className={`ml-2 px-1.5 py-0.5 text-xs rounded ${
                                  perm.type === 'menu' ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500'
                                }`}>
                                  {perm.type === 'menu' ? '菜单' : '操作'}
                                </span>
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="flex gap-3 p-4 border-t">
              <button
                onClick={() => { setShowPermModal(false); setPermRole(null); }}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSavePermissions}
                disabled={permLoading}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {permLoading ? '保存中...' : '保存权限'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
