import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';

interface UserItem {
  id: string;
  username: string;
  name: string;
  role: 'admin' | 'viewer';
  created_at: string;
}

export default function UserManager() {
  const { user } = useAuthStore();
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetMessage, setResetMessage] = useState('');

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

  const canManage = (targetUser: UserItem) => {
    if (user?.role !== 'admin') return false;
    if (targetUser.id === user.id) return false;
    return true;
  };

  const isCurrentUser = (targetUser: UserItem) => {
    return targetUser.id === user?.id;
  };

  return (
    <div className="p-6">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-xl shadow-lg p-6">
          <h2 className="text-xl font-bold text-gray-800 mb-6">用户管理</h2>

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
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">创建时间</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {users.map((userItem) => (
                    <tr key={userItem.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-800">
                        {userItem.username}
                        {isCurrentUser(userItem) && (
                          <span className="ml-2 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">当前</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-800">{userItem.name}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 text-xs rounded-full ${
                          userItem.role === 'admin' 
                            ? 'bg-red-100 text-red-700' 
                            : 'bg-gray-100 text-gray-700'
                        }`}>
                          {userItem.role === 'admin' ? '管理员' : '查看者'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {new Date(userItem.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        {canManage(userItem) ? (
                          <button
                            onClick={() => {
                              setResetUserId(userItem.id);
                              setNewPassword('');
                              setResetMessage('');
                            }}
                            className="text-green-600 hover:text-green-700 text-sm font-medium"
                          >
                            重置密码
                          </button>
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
    </div>
  );
}