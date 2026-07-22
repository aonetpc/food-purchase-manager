import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';

interface TempUser {
  id: string;
  name: string;
  phone: string;
  avatar_url: string;
}

interface TempUserState {
  token: string;
  user: TempUser;
  is_new_user: boolean;
}

const TEMP_SESSION_KEY = 'temp_worker_session';

export const getTempUserSession = (): TempUserState | null => {
  try {
    const stored = localStorage.getItem(TEMP_SESSION_KEY);
    if (!stored) return null;
    return JSON.parse(stored);
  } catch {
    return null;
  }
};

export const saveTempUserSession = (session: TempUserState): void => {
  try {
    localStorage.setItem(TEMP_SESSION_KEY, JSON.stringify(session));
  } catch {}
};

export const clearTempUserSession = (): void => {
  localStorage.removeItem(TEMP_SESSION_KEY);
};

export default function TempLogin() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showRegister, setShowRegister] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  useEffect(() => {
    initLogin();
  }, []);

  const initLogin = async () => {
    try {
      const token = searchParams.get('token');
      const isNew = searchParams.get('is_new_user');
      const userId = searchParams.get('user_id');
      const userName = searchParams.get('user_name') || '';
      const userPhone = searchParams.get('user_phone') || '';

      if (token && isNew !== null) {
        const sessionData: TempUserState = {
          token,
          user: {
            id: userId || '',
            name: decodeURIComponent(userName),
            phone: decodeURIComponent(userPhone),
            avatar_url: '',
          },
          is_new_user: isNew === 'true',
        };
        saveTempUserSession(sessionData);
        searchParams.delete('token');
        searchParams.delete('is_new_user');
        searchParams.delete('user_id');
        searchParams.delete('user_name');
        searchParams.delete('user_phone');
        setSearchParams(searchParams, { replace: true });

        if (sessionData.is_new_user) {
          setShowRegister(true);
          setName(sessionData.user.name);
          setPhone(sessionData.user.phone);
        } else {
          navigate('/temp/checkin');
        }
        setLoading(false);
        return;
      }

      const session = getTempUserSession();
      if (session) {
        if (session.is_new_user) {
          setShowRegister(true);
          setName(session.user.name);
          setPhone(session.user.phone);
        } else {
          navigate('/temp/checkin');
        }
        setLoading(false);
        return;
      }

      await handleWechatAuth();
    } catch (err: any) {
      console.error('登录初始化失败:', err);
      setError(err.message || '登录失败');
      setLoading(false);
    }
  };

  const getWechatAuthUrl = async () => {
    const configRes = await api.get<any>('/wecom/config');
    const appId = configRes.wx_app_id || '';
    if (!appId) {
      throw new Error('微信公众号未配置，请联系管理员');
    }
    const cleanUrl = window.location.origin + window.location.pathname;
    const redirectUri = encodeURIComponent(cleanUrl);
    const timestamp = Date.now();
    const authUrl = `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${appId}&redirect_uri=${redirectUri}&response_type=code&scope=snsapi_base&state=${timestamp}#wechat_redirect`;
    return authUrl;
  };

  const handleWechatAuth = async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');

    if (!code) {
      const authUrl = await getWechatAuthUrl();
      window.location.href = authUrl;
      return;
    }

    const res = await api.post<any>('/temp/auth/wx-login', { code });

    if (!res.success) {
      setError(res.error || '登录失败');
      setLoading(false);
      return;
    }

    saveTempUserSession({
      token: res.token,
      user: res.user,
      is_new_user: res.is_new_user,
    });

    if (res.is_new_user) {
      setShowRegister(true);
    } else {
      navigate('/temp/checkin');
    }
    setLoading(false);
  };

  const handleRegister = async () => {
    if (!name.trim()) {
      setError('请输入姓名');
      return;
    }

    try {
      let session = getTempUserSession();
      if (!session) {
        const token = searchParams.get('token');
        if (!token) {
          setError('登录状态失效，请重新扫码');
          return;
        }
        session = {
          token,
          user: { id: '', name: '', phone: '', avatar_url: '' },
          is_new_user: true,
        };
      }

      const response = await fetch(`${api.getBaseUrl()}/temp/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.token}`,
        },
        body: JSON.stringify({ name: name.trim(), phone: phone.trim() }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: '注册失败' }));
        throw new Error(errorData.error || '注册失败');
      }

      session.is_new_user = false;
      session.user.name = name.trim();
      session.user.phone = phone.trim();
      saveTempUserSession(session);

      navigate('/temp/checkin');
    } catch (err: any) {
      setError(err.message || '注册失败');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 to-red-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mb-4"></div>
          <p className="text-gray-500 font-medium">正在通过微信登录...</p>
        </div>
      </div>
    );
  }

  if (showRegister) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 to-red-50 p-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="inline-block w-20 h-20 bg-gradient-to-br from-orange-500 to-red-500 rounded-3xl shadow-lg flex items-center justify-center mb-4">
              <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-800">完善信息</h1>
            <p className="text-gray-500 text-sm mt-1">首次登录，请完善您的个人信息</p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-xl text-sm text-center">
              {error}
            </div>
          )}

          <div className="bg-white rounded-2xl shadow-xl p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">姓名 *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                placeholder="请输入您的姓名"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">手机号</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                placeholder="请输入手机号（选填）"
              />
            </div>
            <button
              onClick={handleRegister}
              className="w-full py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white font-semibold rounded-xl shadow-md active:scale-95 transition-transform"
            >
              确认提交
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 to-red-50 p-4">
      <div className="w-full max-w-sm">
        <div className="text-center">
          <div className="inline-block w-24 h-24 bg-gradient-to-br from-orange-500 to-red-500 rounded-3xl shadow-lg flex items-center justify-center mb-6">
            <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-800 mb-2">外请人员打卡</h1>
          <p className="text-gray-500 text-sm">请使用微信扫码登录</p>

          {error && (
            <div className="mt-6 p-4 bg-red-50 text-red-600 rounded-xl text-sm">
              {error}
            </div>
          )}

          <button
            onClick={async () => {
              const authUrl = await getWechatAuthUrl();
              window.location.href = authUrl;
            }}
            className="mt-8 w-full py-3 bg-gradient-to-r from-green-500 to-green-600 text-white font-semibold rounded-xl shadow-md active:scale-95 transition-transform"
          >
            微信登录
          </button>
        </div>
      </div>
    </div>
  );
}
