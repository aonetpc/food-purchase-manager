import { useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { api } from '@/lib/api';

export default function Profile() {
  const { user } = useAuthStore();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');

    if (!oldPassword || !newPassword || !confirmPassword) {
      setError('请填写所有字段');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('新密码和确认密码不一致');
      return;
    }

    if (newPassword.length < 6) {
      setError('密码长度不能少于6位');
      return;
    }

    setLoading(true);
    try {
      await api.post('/auth/change-password', {
        userId: user?.id,
        oldPassword,
        newPassword,
      });
      setMessage('密码修改成功，请重新登录');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setError(err.message || '修改失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6">
      <div className="max-w-md mx-auto">
        <div className="bg-white rounded-xl shadow-lg p-8">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">👤</span>
            </div>
            <h2 className="text-xl font-bold text-gray-800">{user?.name || user?.username}</h2>
            <p className="text-gray-500 mt-1">
              {user?.role === 'admin' ? '管理员' : '查看者'}
            </p>
          </div>

          <div className="space-y-4 mb-8">
            <div className="bg-gray-50 rounded-lg p-4">
              <label className="block text-sm font-medium text-gray-600 mb-1">用户名</label>
              <p className="text-gray-800">{user?.username}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <label className="block text-sm font-medium text-gray-600 mb-1">姓名</label>
              <p className="text-gray-800">{user?.name}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <label className="block text-sm font-medium text-gray-600 mb-1">角色</label>
              <p className="text-gray-800">{user?.role === 'admin' ? '管理员' : '查看者'}</p>
            </div>
          </div>

          <div className="border-t pt-8">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">修改密码</h3>
            
            {message && (
              <div className="mb-4 p-3 bg-green-50 text-green-700 rounded-lg text-sm">
                {message}
              </div>
            )}
            
            {error && (
              <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  原密码
                </label>
                <input
                  type="password"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                  placeholder="请输入原密码"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  新密码
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                  placeholder="请输入新密码（至少6位）"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  确认新密码
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                  placeholder="请再次输入新密码"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-green-600 text-white py-2 px-4 rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? '修改中...' : '修改密码'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}