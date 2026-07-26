import { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Clock, Package, ArrowLeft, Pen } from 'lucide-react';
import { api } from '@/lib/api';
import { formatCurrency } from '@/utils/format';

interface Department {
  id: string;
  name: string;
  confirmed: boolean;
  confirmed_by?: string;
  confirmed_at?: string;
}

interface PurchaseItem {
  ingredient_name: string;
  purchase_unit: string;
  purchase_quantity: number;
  purchase_unit_price: number;
  amount: number;
  department_name: string;
}

interface Confirmation {
  id: string;
  purchase_date: string;
  total_amount: number;
  departments: Department[];
  purchase_items: PurchaseItem[];
  status: string;
}

function SignatureCanvas({ onSignatureChange }: { onSignatureChange: (data: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, []);

  const getPos = (e: React.TouchEvent | React.MouseEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
  };

  const startDraw = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    setIsDrawing(true);
  };

  const draw = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    if (!isDrawing) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    setHasSignature(true);
  };

  const stopDraw = () => {
    if (isDrawing && hasSignature) {
      const canvas = canvasRef.current;
      if (canvas) {
        onSignatureChange(canvas.toDataURL('image/png'));
      }
    }
    setIsDrawing(false);
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    setHasSignature(false);
    onSignatureChange(null);
  };

  return (
    <div>
      <div className="border-2 border-dashed border-gray-300 rounded-lg overflow-hidden bg-white relative">
        <canvas
          ref={canvasRef}
          className="w-full touch-none"
          style={{ height: '120px' }}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={stopDraw}
          onMouseLeave={stopDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={stopDraw}
        />
        {!hasSignature && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-gray-300 text-sm">请在此处手写签名</span>
          </div>
        )}
      </div>
      {hasSignature && (
        <button
          onClick={clearSignature}
          className="mt-1 text-xs text-gray-400 hover:text-gray-600"
        >
          清除签名
        </button>
      )}
    </div>
  );
}

export default function PurchaseConfirmPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const [data, setData] = useState<Confirmation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [userName, setUserName] = useState('');
  const [nameFromSession, setNameFromSession] = useState(false);
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [activeDeptId, setActiveDeptId] = useState<string | null>(null);
  const [wecomAuthing, setWecomAuthing] = useState(false);
  const [showBindForm, setShowBindForm] = useState(false);
  const [pendingWecomUserId, setPendingWecomUserId] = useState('');
  const [pendingWecomName, setPendingWecomName] = useState('');
  const [bindUsername, setBindUsername] = useState('');
  const [bindPassword, setBindPassword] = useState('');
  const [binding, setBinding] = useState(false);
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  const [isReSigning, setIsReSigning] = useState(false);
  const [userId, setUserId] = useState('');
  const [userSource, setUserSource] = useState('');

  useEffect(() => {
    // 1. 检查 URL 中的企微授权 code（只要有 code 就尝试回调，不严格检查 state）
    const code = searchParams.get('code');
    
    if (code && id) {
      handleWecomCallback(code);
      return;
    }
    
    // 2. 检测是否在企微/微信环境
    const isWecom = /wxwork|MicroMessenger/i.test(navigator.userAgent);
    
    if (isWecom && id) {
      // 企微环境下，先检查本地是否有有效的企微登录态
      const hasValidWecomSession = checkValidWecomSession();
      
      if (hasValidWecomSession) {
        // 有有效登录态，读取姓名
        try {
          const stored = localStorage.getItem('auth-session');
          if (stored) {
            const data = JSON.parse(stored);
            const name = data?.state?.user?.name || '';
            const uid = data?.state?.user?.id || '';
            if (name) {
              setUserName(name);
              setNameFromSession(true);
            }
            if (uid) {
              setUserId(uid);
              setUserSource('internal');
              loadUserSignature(uid, 'internal');
            }
          }
        } catch (e) {}
        fetchData(id);
        return;
      }
      
      // 无有效登录态，走企微免登
      setTimeout(() => {
        redirectToWecomAuth();
      }, 300);
      return;
    }
    
    // 3. 非企微环境，检查本地是否有登录态
    const token = api.getToken();
    if (token && id) {
      try {
        const stored = localStorage.getItem('auth-session');
        if (stored) {
          const data = JSON.parse(stored);
          const name = data?.state?.user?.name || '';
          const uid = data?.state?.user?.id || '';
          if (name) {
            setUserName(name);
            setNameFromSession(true);
          }
          if (uid) {
            setUserId(uid);
            setUserSource('internal');
            loadUserSignature(uid, 'internal');
          }
        }
      } catch (e) {
        console.error('读取登录态失败:', e);
      }
      fetchData(id);
      return;
    }
    
    // 4. 未登录且非企微环境，直接加载数据（可手动输入姓名）
    if (id) {
      fetchData(id);
    }
  }, [id, searchParams]);

  const checkValidWecomSession = () => {
    try {
      const stored = localStorage.getItem('auth-session');
      if (!stored) return false;
      
      const data = JSON.parse(stored);
      const user = data?.state?.user;
      
      if (!user || !user.id || !user.wecom_userid) return false;
      
      const sessionTime = data?.state?.sessionTime || data?.state?.user?.last_login_at;
      if (!sessionTime) return false;
      
      const sessionDate = new Date(sessionTime);
      const now = new Date();
      const hoursDiff = (now.getTime() - sessionDate.getTime()) / (1000 * 60 * 60);
      
      return hoursDiff < 24;
    } catch (e) {
      console.error('检查登录态失败:', e);
      return false;
    }
  };

  const redirectToWecomAuth = () => {
    const redirectUri = encodeURIComponent(window.location.href.split('?')[0]);
    const authUrl = `/api/auth/wecom-auth-url?redirect_uri=${redirectUri}`;
    window.location.href = authUrl;
  };

  const handleWecomCallback = async (code: string) => {
    setWecomAuthing(true);
    setError('');
    try {
      const result = await api.post<{ success: boolean; user?: any; needBind?: boolean; wecomUserId?: string; wecomName?: string; message?: string; error?: string }>('/auth/wecom-callback', {
        code,
        redirect_uri: window.location.href.split('?')[0],
      });
      
      if (result.error) {
        throw new Error(result.error);
      }
      
      if (result.needBind) {
        // 未绑定用户，显示绑定表单
        window.history.replaceState({}, '', `/confirm/${id}`);
        setWecomAuthing(false);
        setLoading(false);
        setPendingWecomUserId(result.wecomUserId || '');
        setPendingWecomName(result.wecomName || '');
        setShowBindForm(true);
        return;
      }
      
      if (result.user) {
        // 保存登录态（包含登录时间）
        const sessionData = { 
          state: { 
            user: result.user, 
            pendingWecomUserId: null,
            sessionTime: new Date().toISOString()
          } 
        };
        localStorage.setItem('auth-session', JSON.stringify(sessionData));
        setUserName(result.user.name || '');
        setNameFromSession(true);
        // 清理 URL 中的 code
        window.history.replaceState({}, '', `/confirm/${id}`);
        setWecomAuthing(false);
        if (id) fetchData(id);
      } else {
        throw new Error('登录失败');
      }
    } catch (err: any) {
      console.error('企微登录失败:', err);
      // 登录失败，清理URL中的code，降级到手动输入模式
      window.history.replaceState({}, '', `/confirm/${id}`);
      setWecomAuthing(false);
      setLoading(false);
      // 不设置错误提示，让用户可以手动输入姓名
    }
  };

  const handleBindWecom = async () => {
    if (!bindUsername.trim() || !bindPassword.trim()) {
      setError('请输入用户名和密码');
      return;
    }

    setBinding(true);
    setError('');
    try {
      // 1. 先用账号密码登录
      const loginResult = await api.post<any>('/auth/login', { 
        username: bindUsername.trim(), 
        password: bindPassword 
      });

      // 2. 绑定企微账号
      await api.post('/auth/bind-wecom', {
        userId: loginResult.id,
        wecomUserId: pendingWecomUserId,
      });

      // 3. 保存登录态（包含企微信息和登录时间）
      const user = {
        ...loginResult,
        wecom_userid: pendingWecomUserId,
      };
      const sessionData = { 
        state: { 
          user, 
          pendingWecomUserId: null,
          sessionTime: new Date().toISOString()
        } 
      };
      localStorage.setItem('auth-session', JSON.stringify(sessionData));
      setUserName(user.name || '');
      setNameFromSession(true);
      setShowBindForm(false);
      if (id) fetchData(id);
    } catch (err: any) {
      setError(err.message || '绑定失败，请检查用户名和密码');
    } finally {
      setBinding(false);
    }
  };

  const fetchData = async (confirmId: string) => {
    setLoading(true);
    try {
      const result = await api.get<Confirmation>(`/purchase-confirmations/${confirmId}`);
      setData(result);
    } catch (err: any) {
      setError(err.message || '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  const loadUserSignature = async (uid: string, source: string) => {
    try {
      const result = await api.get(`/user/signature?user_id=${uid}&user_source=${source}`);
      if (result.signature_data) {
        setSavedSignature(result.signature_data);
        setSignatureData(result.signature_data);
      }
    } catch (err) {
      console.log('No saved signature found');
    }
  };

  const saveUserSignature = async (uid: string, source: string, signature: string) => {
    try {
      await api.post('/user/signature', {
        user_id: uid,
        user_source: source,
        signature_data: signature,
      });
      setSavedSignature(signature);
    } catch (err) {
      console.error('Failed to save signature:', err);
    }
  };

  const handleConfirm = async (deptId: string) => {
    if (!userName.trim()) {
      setError('请输入您的姓名');
      return;
    }
    // 优先使用当前签名，如果没有则使用已保存的签名
    const sigToSend = signatureData || savedSignature;
    if (!sigToSend) {
      setError('请先手写签名后再确认');
      return;
    }
    setConfirming(true);
    setError('');
    try {
      await api.post(`/purchase-confirmations/${id}/confirm`, {
        department_id: deptId,
        confirmed_by: userName.trim(),
        signature_data: sigToSend,
      });

      if (userId && userSource && sigToSend) {
        await saveUserSignature(userId, userSource, sigToSend);
      }

      // 确认成功后保留签名数据，避免连续确认多个部门时签名丢失
      setSignatureData(sigToSend);
      setActiveDeptId(null);
      if (id) fetchData(id);
    } catch (err: any) {
      setError(err.message || '确认失败');
    } finally {
      setConfirming(false);
    }
  };

  if (wecomAuthing) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-gray-500 mb-2">正在通过企业微信登录...</div>
          <div className="text-xs text-gray-400">首次使用将自动创建确认账号</div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  // 企微未绑定时显示绑定表单
  if (showBindForm) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-6">
            <div className="inline-block w-16 h-16 bg-gradient-to-br from-green-500 to-green-600 rounded-2xl shadow-lg flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-800">账号绑定</h2>
            <p className="text-gray-500 text-sm mt-1">
              企业微信用户「{pendingWecomName || pendingWecomUserId}」
            </p>
            <p className="text-gray-400 text-xs mt-1">
              请使用系统账号密码登录以完成绑定
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-xl text-sm text-center">
              {error}
            </div>
          )}

          <div className="bg-white rounded-2xl shadow-xl p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">用户名</label>
              <input
                type="text"
                value={bindUsername}
                onChange={(e) => setBindUsername(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500"
                placeholder="请输入用户名"
                autoComplete="username"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">密码</label>
              <input
                type="password"
                value={bindPassword}
                onChange={(e) => setBindPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleBindWecom()}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500"
                placeholder="请输入密码"
                autoComplete="current-password"
              />
            </div>
            <button
              onClick={handleBindWecom}
              disabled={binding}
              className="w-full py-3 bg-gradient-to-r from-green-500 to-green-600 text-white font-semibold rounded-xl shadow-md active:scale-95 transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {binding ? '绑定中...' : '登录并绑定'}
            </button>
          </div>

          <p className="text-center text-xs text-gray-400 mt-6">
            绑定后下次将自动登录
          </p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-red-500 mb-4">{error}</p>
          <button onClick={() => window.history.back()} className="text-primary-500">
            返回
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const allConfirmed = data.departments.every(d => d.confirmed);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr.substring(0, 10);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const groupedItems: Record<string, PurchaseItem[]> = {};
  for (const item of data.purchase_items) {
    const deptName = item.department_name || '未分类';
    if (!groupedItems[deptName]) groupedItems[deptName] = [];
    groupedItems[deptName].push(item);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 顶部标题 */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-md mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => window.history.back()} className="p-1">
            <ArrowLeft size={20} className="text-gray-600" />
          </button>
          <h1 className="text-lg font-semibold text-gray-800">采购确认单</h1>
        </div>
      </div>

      <div className="max-w-md mx-auto p-4 space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {/* 基本信息 */}
        <div className="bg-white rounded-xl shadow-sm p-4">
          <div className="flex justify-between items-start mb-3">
            <div>
              <p className="text-sm text-gray-500">采购日期</p>
              <p className="font-medium text-gray-800">{formatDate(data.purchase_date)}</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-500">总金额</p>
              <p className="font-bold text-primary-600 text-lg">{formatCurrency(Number(data.total_amount) || 0)}</p>
            </div>
          </div>
          {allConfirmed && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2">
              <CheckCircle2 size={18} className="text-green-500" />
              <span className="text-sm text-green-700">全部部门已确认，正在自动发起报销...</span>
            </div>
          )}
        </div>

        {/* 确认人信息（自动获取，只读） */}
        {!allConfirmed && nameFromSession && userName && (
          <div className="bg-white rounded-xl shadow-sm p-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">确认人</label>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center">
                <span className="text-primary-600 text-sm font-medium">{userName.charAt(0)}</span>
              </div>
              <span className="text-gray-800 font-medium">{userName}</span>
            </div>
          </div>
        )}
        
        {/* 未登录时手动输入姓名 */}
        {!allConfirmed && !nameFromSession && (
          <div className="bg-white rounded-xl shadow-sm p-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">您的姓名</label>
            <input
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
              placeholder="请输入您的姓名"
            />
          </div>
        )}

        {/* 部门确认状态 */}
        <div className="bg-white rounded-xl shadow-sm p-4">
          <h2 className="font-medium text-gray-800 mb-3">部门确认</h2>
          <div className="space-y-3">
            {data.departments.map(dept => (
              <div key={dept.id} className="bg-gray-50 rounded-lg px-3 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {dept.confirmed ? (
                      <CheckCircle2 size={18} className="text-green-500" />
                    ) : (
                      <Clock size={18} className="text-gray-400" />
                    )}
                    <span className="text-sm font-medium text-gray-700">{dept.name}</span>
                  </div>
                  <div className="text-right">
                    {dept.confirmed ? (
                      <div className="text-xs text-gray-500">
                        <p>{dept.confirmed_by}</p>
                        <p>{dept.confirmed_at}</p>
                      </div>
                    ) : (
                      <button
                        onClick={() => setActiveDeptId(activeDeptId === dept.id ? null : dept.id)}
                        disabled={!userName.trim()}
                        className="px-3 py-1.5 bg-primary-500 text-white text-xs rounded-lg hover:bg-primary-600 disabled:opacity-50 transition-colors flex items-center gap-1"
                      >
                        <Pen size={12} />
                        {activeDeptId === dept.id ? '收起' : '签名确认'}
                      </button>
                    )}
                  </div>
                </div>
                {/* 签名区域 */}
                {activeDeptId === dept.id && !dept.confirmed && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      <Pen size={14} className="inline mr-1" />
                      手写签名
                    </label>
                    {savedSignature && !isReSigning ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-3">
                          <img
                            src={savedSignature}
                            alt="签名"
                            className="h-16 w-auto rounded-lg border border-gray-200 bg-white"
                          />
                          <div className="flex-1">
                            <p className="text-xs text-gray-500">已保存的签名</p>
                          </div>
                          <button
                            onClick={() => setIsReSigning(true)}
                            className="px-3 py-1.5 bg-gray-100 text-gray-600 text-xs rounded-lg hover:bg-gray-200 transition-colors"
                          >
                            重新签名
                          </button>
                        </div>
                        <button
                          onClick={() => handleConfirm(dept.id)}
                          disabled={confirming || !userName.trim()}
                          className="w-full py-2.5 bg-green-500 text-white text-sm font-medium rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:bg-gray-300 transition-colors"
                        >
                          {confirming ? '确认中...' : '确认采购入库'}
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <SignatureCanvas onSignatureChange={setSignatureData} />
                        <button
                          onClick={() => handleConfirm(dept.id)}
                          disabled={confirming || !userName.trim() || !signatureData}
                          className="w-full py-2.5 bg-green-500 text-white text-sm font-medium rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:bg-gray-300 transition-colors"
                        >
                          {confirming ? '确认中...' : '确认采购入库'}
                        </button>
                        {!signatureData && (
                          <p className="text-xs text-gray-400 mt-1 text-center">请先手写签名后再确认</p>
                        )}
                        {isReSigning && (
                          <button
                            onClick={() => {
                              setIsReSigning(false);
                              setSignatureData(savedSignature);
                            }}
                            className="w-full py-1.5 text-xs text-gray-400 hover:text-gray-600"
                          >
                            取消重新签名
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 采购明细 */}
        <div className="bg-white rounded-xl shadow-sm p-4">
          <h2 className="font-medium text-gray-800 mb-3">采购明细</h2>
          <div className="space-y-4">
            {Object.entries(groupedItems).map(([deptName, items]) => (
              <div key={deptName}>
                <div className="flex items-center gap-2 mb-2">
                  <Package size={14} className="text-primary-500" />
                  <span className="text-sm font-medium text-gray-700">{deptName}</span>
                  <span className="text-xs text-gray-400">
                    小计：¥{items.reduce((s, i) => s + i.amount, 0).toFixed(2)}
                  </span>
                </div>
                <div className="space-y-1 pl-6">
                  {items.map((item, idx) => (
                    <div key={idx} className="flex justify-between text-sm">
                      <span className="text-gray-600">
                        {item.ingredient_name}
                        <span className="text-gray-400 ml-1">
                          {item.purchase_unit_price.toFixed(2)}/{item.purchase_unit} ×{item.purchase_quantity}{item.purchase_unit}
                        </span>
                      </span>
                      <span className="font-medium text-gray-800">¥{item.amount.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
