import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Lock, User, UtensilsCrossed, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, user, loading: authLoading } = useAuthStore();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) {
      const from = (location.state as any)?.from?.pathname || '/daily';
      navigate(from, { replace: true });
    }
  }, [user, navigate, location.state]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const success = await login(username.trim(), password);
    if (success) {
      const from = (location.state as any)?.from?.pathname || '/daily';
      navigate(from, { replace: true });
    } else {
      setError('用户名或密码错误，或网络连接失败');
    }
    setLoading(false);
  };

  // 快速填充用户名：仅填用户名框，密码必须手动输入（避免在生产登录页暴露任何密码）
  const handleQuickFillUsername = (uname: string) => {
    setUsername(uname);
    setPassword('');
  };

  return (
    <div className="min-h-screen bg-cream-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-500 rounded-2xl mb-4 shadow-lg shadow-primary-500/30">
            <UtensilsCrossed className="text-white" size={32} />
          </div>
          <h1 className="text-2xl font-serif font-bold text-gray-800">食材采购管理平台</h1>
          <p className="text-gray-500 mt-2">请登录以继续使用</p>
        </div>

        <div className="card">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">用户名</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="请输入用户名"
                  className="input-field pl-10"
                  autoFocus
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">密码</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码"
                  className="input-field pl-10 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-danger-600 bg-danger-50 p-3 rounded-lg text-sm">
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={!username || !password || loading}
              className="w-full btn-primary py-2.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? '登录中...' : '登 录'}
            </button>
          </form>

          {/* 快速填用户名：仅填充用户名框，密码必须手动输入，生产环境也显示 */}
          <div className="mt-6 pt-5 border-t border-gray-100">
            <p className="text-xs text-gray-400 text-center mb-3">快速填用户名（密码需手动输入）</p>
            <button
              onClick={() => handleQuickFillUsername('viewer')}
              className="w-full py-2 px-3 text-sm bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors font-medium"
            >
              查看员账号
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
