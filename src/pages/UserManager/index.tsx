import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { Plus, Edit, Trash2, Unlock, Lock, RefreshCw, X, Search, Phone, Building2, User } from 'lucide-react';

interface UserItem {
  id: string;
  username: string;
  name: string;
  role: 'admin' | 'finance' | 'boss' | 'viewer';
  role_id: string;
  status: number;
  phone?: string;
  department_id?: string;
  wecom_userid?: string;
  created_at: string;
  last_login_at?: string;
}

const ROLE_LABELS: Record<string, { label: string; color: string }> = {
  admin: { label: '管理员', color: 'bg-red-100 text-red-700' },
  finance: { label: '财务', color: 'bg-purple-100 text-purple-700' },
  boss: { label: '董事长', color: 'bg-amber-100 text-amber-700' },
  viewer: { label: '普通员工', color: 'bg-gray-100 text-gray-700' },
};

const ROLE_OPTIONS = [
  { value: 'admin', label: '管理员' },
  { value: 'finance', label: '财务' },
  { value: 'boss', label: '董事长' },
  { value: 'viewer', label: '普通员工' },
];

export default function UserManager() {
  const { user } = useAuthStore();
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchText, setSearchText] = useState('');
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetMessage, setResetMessage] = useState('');

  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserItem | null>(null);
  const [formData, setFormData] = useState({
    username: '',
    name: '',
    role: 'viewer' as 'admin' | 'finance' | 'boss' | 'viewer',
    phone: '',
    department_id: '',
    password: '',
  });
  const [formMessage, setFormMessage] = useState('');

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const data = await api.get<UserItem[]>('/auth/users');
      setUsers(data);
    } catch (err: any) {
      setError(err.message || '获取用户列表失败');
    } finally {
      setLoading(false);
    }
  };

  const filteredUsers = users.filter((u) =>
    u.username.toLowerCase().includes(searchText.toLowerCase()) ||
    u.name.toLowerCase().includes(searchText.toLowerCase())
  );

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      await api.put(`/auth/users/${userId}`, { role: newRole });
      await fetchUsers();
    } catch (err: any) {
      alert('更新失败：' + err.message);
    }
  };

  const handleUnbindWecom = async (userId: string) => {
    if (!confirm('确定要解除该用户的企微绑定吗？')) return;
    try {
      await api.post('/auth/unbind-wecom', { userId });
      await fetchUsers();
    } catch (err: any) {
      alert('解绑失败：' + err.message);
    }
  };

  const handleToggleStatus = async (userId: string, currentStatus: number) => {
    const newStatus = currentStatus === 1 ? 0 : 1;
    const action = newStatus === 1 ? '启用' : '禁用';
    if (!confirm(`确定要${action}该用户吗？`)) return;

    try {
      await api.put(`/auth/users/${userId}/status`, { status: newStatus });
      await fetchUsers();
    } catch (err: any) {
      alert(`${action}失败：` + err.message);
    }
  };

  const handleResetPassword = async () => {
    if (!resetUserId || !newPassword) return;

    if (newPassword.length < 6) {
      setResetMessage('密码长度不能少于6位');
      return;
    }

    setResetLoading(true);
    try {
      await api.post('/auth/reset-password', {
        userId: resetUserId,
        newPassword,
      });
      setResetMessage('密码重置成功');
      setResetUserId(null);
      setNewPassword('');
    } catch (err: any) {
      setResetMessage(err.message || '重置失败');
    } finally {
      setResetLoading(false);
    }
  };

  const handleAddUser = async () => {
    setFormMessage('');
    if (!formData.username || !formData.name) {
      setFormMessage('用户名和姓名为必填项');
      return;
    }

    try {
      await api.post('/auth/users', {
        username: formData.username,
        name: formData.name,
        role: formData.role,
        phone: formData.phone || undefined,
        department_id: formData.department_id || undefined,
        password: formData.password || undefined,
      });
      setShowAddModal(false);
      setFormData({
        username: '',
        name: '',
        role: 'viewer',
        phone: '',
        department_id: '',
        password: '',
      });
      await fetchUsers();
    } catch (err: any) {
      setFormMessage(err.message || '创建失败');
    }
  };

  const handleEditUser = async () => {
    setFormMessage('');
    if (!editingUser) return;

    try {
      await api.put(`/auth/users/${editingUser.id}`, {
        name: formData.name,
        role: formData.role,
        phone: formData.phone || undefined,
        department_id: formData.department_id || undefined,
      });
      setShowEditModal(false);
      setEditingUser(null);
      await fetchUsers();
    } catch (err: any) {
      setFormMessage(err.message || '更新失败');
    }
  };

  const openEditModal = (userItem: UserItem) => {
    setEditingUser(userItem);
    setFormData({
      username: userItem.username,
      name: userItem.name,
      role: userItem.role,
      phone: userItem.phone || '',
      department_id: userItem.department_id || '',
      password: '',
    });
    setShowEditModal(true);
  };

  const canManage = (targetUser: UserItem) => {
    if (user?.role !== 'admin') return false;
    if (targetUser.id === user.id) return false;
    return true;
  };

  const isCurrentUser = (targetUser: UserItem) => {
    return targetUser.id === user?.id;
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('zh-CN');
  };

  return (
    <div className="p-6">
      <div className="max-w-5xl mx-auto">
        <div className="bg-white rounded-xl shadow-lg p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-800">用户管理</h2>
            <button
              onClick={() => {
                setFormData({
                  username: '',
                  name: '',
                  role: 'viewer',
                  phone: '',
                  department_id: '',
                  password: '',
                });
                setFormMessage('');
                setShowAddModal(true);
              }}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              <Plus size={18} />
              新增用户
            </button>
          </div>

          <div className="mb-4">
            <div className="relative">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="搜索用户名或姓名..."
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
              />
            </div>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
              {error}
            </div>
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
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">用户名</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">姓名</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">角色</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">状态</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">企微绑定</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">创建时间</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredUsers.map((userItem) => (
                    <tr key={userItem.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-800">
                        {userItem.username}
                        {isCurrentUser(userItem) && (
                          <span className="ml-2 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">当前</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-800">{userItem.name}</td>
                      <td className="px-4 py-3">
                        {canManage(userItem) ? (
                          <select
                            value={userItem.role}
                            onChange={(e) => handleRoleChange(userItem.id, e.target.value)}
                            className={`px-2 py-1 text-xs rounded-full border-0 outline-none cursor-pointer ${ROLE_LABELS[userItem.role]?.color || 'bg-gray-100 text-gray-700'}`}
                          >
                            {ROLE_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        ) : (
                          <span className={`px-2 py-1 text-xs rounded-full ${ROLE_LABELS[userItem.role]?.color || 'bg-gray-100 text-gray-700'}`}>
                            {ROLE_LABELS[userItem.role]?.label || userItem.role}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {userItem.status === 1 ? (
                          <span className="flex items-center gap-1 text-green-600 text-sm">
                            <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                            启用
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-gray-400 text-sm">
                            <span className="w-2 h-2 bg-gray-300 rounded-full"></span>
                            禁用
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {userItem.wecom_userid ? (
                          <span className="flex items-center gap-2">
                            <span className="text-green-600 flex items-center gap-1">
                              <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                              已绑定
                            </span>
                            {canManage(userItem) && (
                              <button
                                onClick={() => handleUnbindWecom(userItem.id)}
                                className="text-red-500 hover:text-red-600 text-xs font-medium"
                              >
                                解绑
                              </button>
                            )}
                          </span>
                        ) : (
                          <span className="text-gray-400 flex items-center gap-1">
                            <span className="w-2 h-2 bg-gray-300 rounded-full"></span>
                            未绑定
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {formatDate(userItem.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        {canManage(userItem) ? (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => openEditModal(userItem)}
                              className="text-blue-600 hover:text-blue-700 text-sm"
                              title="编辑"
                            >
                              <Edit size={16} />
                            </button>
                            <button
                              onClick={() => handleToggleStatus(userItem.id, userItem.status)}
                              className={`text-sm ${userItem.status === 1 ? 'text-orange-600 hover:text-orange-700' : 'text-green-600 hover:text-green-700'}`}
                              title={userItem.status === 1 ? '禁用' : '启用'}
                            >
                              {userItem.status === 1 ? <Lock size={16} /> : <Unlock size={16} />}
                            </button>
                            <button
                              onClick={() => {
                                setResetUserId(userItem.id);
                                setNewPassword('');
                                setResetMessage('');
                              }}
                              className="text-green-600 hover:text-green-700 text-sm"
                              title="重置密码"
                            >
                              <RefreshCw size={16} />
                            </button>
                          </div>
                        ) : isCurrentUser(userItem) ? (
                          <span className="text-gray-400 text-sm">当前用户</span>
                        ) : (
                          <span className="text-gray-400 text-sm">无权限</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {filteredUsers.length === 0 && !loading && (
                <div className="text-center py-8 text-gray-500">
                  没有找到匹配的用户
                </div>
              )}
            </div>
          )}

          {resetUserId && (
            <div className="mt-6 p-4 bg-gray-50 rounded-lg">
              <h3 className="text-sm font-semibold text-gray-800 mb-3">重置密码</h3>

              {resetMessage && (
                <div className={`mb-3 p-2 text-sm rounded ${
                  resetMessage.includes('成功') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                }`}>
                  {resetMessage}
                </div>
              )}

              <div className="flex gap-3">
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                  placeholder="请输入新密码（至少6位）"
                />
                <button
                  onClick={handleResetPassword}
                  disabled={resetLoading}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                  {resetLoading ? '重置中...' : '确认重置'}
                </button>
                <button
                  onClick={() => setResetUserId(null)}
                  className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors"
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 新增用户弹窗 */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-semibold text-gray-800">新增用户</h3>
              <button onClick={() => setShowAddModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 space-y-4">
              {formMessage && (
                <div className={`p-2 text-sm rounded ${
                  formMessage.includes('成功') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                }`}>
                  {formMessage}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">用户名 *</label>
                <input
                  type="text"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                  placeholder="请输入用户名"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">姓名 *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                  placeholder="请输入姓名"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">角色</label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value as any })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                >
                  {ROLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">手机号</label>
                <div className="relative">
                  <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full pl-9 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                    placeholder="请输入手机号"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">初始密码</label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                  placeholder="留空则默认为 123456"
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
                onClick={handleAddUser}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                创建用户
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 编辑用户弹窗 */}
      {showEditModal && editingUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-semibold text-gray-800">编辑用户</h3>
              <button onClick={() => setShowEditModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 space-y-4">
              {formMessage && (
                <div className={`p-2 text-sm rounded ${
                  formMessage.includes('成功') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                }`}>
                  {formMessage}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">用户名</label>
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg">
                  <User size={16} className="text-gray-400" />
                  <span className="text-gray-600">{editingUser.username}</span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">姓名 *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                  placeholder="请输入姓名"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">角色</label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value as any })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                >
                  {ROLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">手机号</label>
                <div className="relative">
                  <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full pl-9 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                    placeholder="请输入手机号"
                  />
                </div>
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
                onClick={handleEditUser}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                保存修改
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
