import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { api } from '@/lib/api';

/**
 * 企微H5应用首页
 * 在企微内打开时自动免登，外部浏览器跳转到账号登录
 */
export default function MobileHome() {
  const navigate = useNavigate();
  const { user, wecomLogin, login } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loginMode, setLoginMode] = useState<'wecom' | 'manual' | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // 检测是否在企微内
  const isWecom = () => {
    return /wxwork/i.test(navigator.userAgent);
  };

  // 企微免登流程
  useEffect(() => {
    if (user) {
      setLoading(false);
      return;
    }

    if (!isWecom()) {
      // 非企微环境，显示手动登录
      setLoginMode('manual');
      setLoading(false);
      return;
    }

    // 企微环境，加载JS-SDK并获取code
    loadWecomSDKAndAuth();
  }, []);

  // 加载企微JS-SDK并获取免登code
  const loadWecomSDKAndAuth = async () => {
    try {
      // 1. 加载企微JS-SDK
      await loadScript('https://res.wx.qq.com/open/js/jweixin-1.6.0.js');

      // 2. 获取企微配置（应用agent_id）
      const config = await api.get<any>('/wecom/config');

      // 3. 通过 wx.qyLogin 或redirect方式获取 code
      // 这里使用 redirect 方式（更可靠）
      // 检查URL中是否已有code
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get('code');

      if (code) {
        // 有code，调用后端换取用户身份
        const result = await wecomLogin(code);
        if (result.needBind) {
          setError('首次使用，请使用账号密码登录完成绑定');
          setLoginMode('manual');
        }
        setLoading(false);
      } else {
        // 无code，跳转到企微授权页
        const redirectUri = encodeURIComponent(window.location.href);
        const authUrl = `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${config.corp_id}&redirect_uri=${redirectUri}&response_type=code&scope=snsapi_base&state=STATE#wechat_redirect`;
        window.location.href = authUrl;
      }
    } catch (err: any) {
      console.error('企微登录失败:', err);
      setError(err.message || '企微登录失败');
      setLoginMode('manual');
      setLoading(false);
    }
  };

  const loadScript = (src: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('加载脚本失败'));
      document.head.appendChild(script);
    });
  };

  // 手动登录
  const handleManualLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const success = await login(username, password);
    if (!success) {
      setError('登录失败，请检查用户名密码');
    }
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-green-600 mb-4"></div>
          <p className="text-gray-500">登录中...</p>
        </div>
      </div>
    );
  }

  // 未登录 - 显示登录页
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-blue-50 p-6">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="inline-block w-20 h-20 bg-gradient-to-br from-green-500 to-green-600 rounded-3xl shadow-lg flex items-center justify-center mb-4">
              <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-800">食材采购查询</h1>
            <p className="text-gray-500 text-sm mt-1">请登录后使用</p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-xl text-sm text-center">
              {error}
            </div>
          )}

          <form onSubmit={handleManualLogin} className="bg-white rounded-2xl shadow-xl p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">用户名</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500"
                placeholder="请输入用户名"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500"
                placeholder="请输入密码"
                required
              />
            </div>
            <button
              type="submit"
              className="w-full py-3 bg-gradient-to-r from-green-500 to-green-600 text-white font-semibold rounded-xl shadow-md active:scale-95 transition-transform"
            >
              登录
            </button>
          </form>

          <p className="text-center text-xs text-gray-400 mt-6">
            企业微信内打开将自动登录
          </p>
        </div>
      </div>
    );
  }

  // 已登录 - 显示导航首页
  const { canViewMonthly, logout } = useAuthStore();

  const menus = [
    {
      key: 'daily',
      title: '今日采购',
      desc: '查看每日采购清单',
      icon: '📋',
      color: 'from-blue-500 to-blue-600',
      path: '/m/daily',
    },
    {
      key: 'yearly',
      title: '年度均价',
      desc: '12个月价格走势',
      icon: '📈',
      color: 'from-purple-500 to-purple-600',
      path: '/m/yearly',
    },
    {
      key: 'query',
      title: '食材查询',
      desc: '搜索食材价格',
      icon: '🔍',
      color: 'from-orange-500 to-orange-600',
      path: '/m/query',
    },
  ];

  // 月度分析仅财务/董事长可见
  if (canViewMonthly()) {
    menus.push({
      key: 'monthly',
      title: '月度分析',
      desc: '采购价格分析',
      icon: '📊',
      color: 'from-green-500 to-green-600',
      path: '/m/monthly',
    } as typeof menus[0]);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 顶部头部 */}
      <div className="bg-gradient-to-br from-green-500 to-green-600 text-white px-6 pt-12 pb-8 rounded-b-3xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold">食材采购查询</h1>
            <p className="text-white/70 text-sm mt-1">欢迎你，{user.name}</p>
          </div>
          <button
            onClick={() => {
              if (confirm('确定要退出登录吗？')) {
                logout();
              }
            }}
            className="px-3 py-1.5 bg-white/20 rounded-lg text-sm"
          >
            退出
          </button>
        </div>
        <div className="text-xs text-white/60">
          {user.role === 'admin' && '管理员'}
          {user.role === 'finance' && '财务'}
          {user.role === 'boss' && '董事长'}
          {user.role === 'viewer' && '员工'}
        </div>
      </div>

      {/* 菜单列表 */}
      <div className="px-4 -mt-4 pb-8">
        <div className="space-y-3">
          {menus.map((menu) => (
            <button
              key={menu.key}
              onClick={() => navigate(menu.path)}
              className="w-full bg-white rounded-2xl shadow-sm p-4 flex items-center gap-4 active:scale-98 transition-transform"
            >
              <div className={`w-14 h-14 bg-gradient-to-br ${menu.color} rounded-2xl flex items-center justify-center text-2xl shadow-md`}>
                {menu.icon}
              </div>
              <div className="flex-1 text-left">
                <p className="font-semibold text-gray-800 text-base">{menu.title}</p>
                <p className="text-gray-400 text-sm mt-0.5">{menu.desc}</p>
              </div>
              <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ))}
        </div>

        {/* 占位提示 */}
        <div className="mt-8 text-center">
          <p className="text-xs text-gray-300">更多功能开发中...</p>
        </div>
      </div>
    </div>
  );
}
