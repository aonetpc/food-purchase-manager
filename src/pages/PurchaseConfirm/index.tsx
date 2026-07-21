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
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [activeDeptId, setActiveDeptId] = useState<string | null>(null);
  const [wecomAuthing, setWecomAuthing] = useState(false);

  useEffect(() => {
    // 1. 检查 URL 中的企微授权 code
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    
    if (code && state === 'wecom_confirm' && id) {
      handleWecomCallback(code);
      return;
    }
    
    // 2. 检查本地是否有登录态
    const token = api.getToken();
    if (token && id) {
      fetchData(id);
      return;
    }
    
    // 3. 未登录，检测是否在企微环境
    const isWecom = /wxwork/i.test(navigator.userAgent);
    if (isWecom && id) {
      setWecomAuthing(true);
      redirectToWecomAuth();
    } else if (id) {
      fetchData(id);
    }
  }, [id, searchParams]);

  const redirectToWecomAuth = () => {
    const redirectUri = encodeURIComponent(window.location.href.split('?')[0]);
    const authUrl = `${api.getBaseUrl()}/auth/wecom-auth-url?redirect_uri=${redirectUri}`;
    window.location.href = authUrl;
  };

  const handleWecomCallback = async (code: string) => {
    setWecomAuthing(true);
    try {
      const result = await api.post<{ success: boolean; user?: any; needBind?: boolean; error?: string }>('/auth/wecom-callback', {
        code,
        redirect_uri: window.location.href.split('?')[0],
      });
      
      if (result.error) {
        throw new Error(result.error);
      }
      
      if (result.user) {
        // 保存登录态
        localStorage.setItem('auth-session', JSON.stringify({ state: { user: result.user, pendingWecomUserId: null } }));
        setUserName(result.user.name || '');
        // 清理 URL 中的 code
        window.history.replaceState({}, '', `/confirm/${id}`);
        if (id) fetchData(id);
      } else {
        throw new Error('登录失败');
      }
    } catch (err: any) {
      setError(err.message || '企微登录失败');
      setWecomAuthing(false);
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

  const handleConfirm = async (deptId: string) => {
    if (!userName.trim()) {
      setError('请输入您的姓名');
      return;
    }
    setConfirming(true);
    setError('');
    try {
      await api.post(`/purchase-confirmations/${id}/confirm`, {
        department_id: deptId,
        confirmed_by: userName.trim(),
        signature_data: signatureData,
      });
      setSignatureData(null);
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

        {/* 确认人姓名输入 */}
        {!allConfirmed && (
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
                    <SignatureCanvas onSignatureChange={setSignatureData} />
                    <button
                      onClick={() => handleConfirm(dept.id)}
                      disabled={confirming || !userName.trim() || !signatureData}
                      className="w-full mt-3 py-2.5 bg-green-500 text-white text-sm font-medium rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:bg-gray-300 transition-colors"
                    >
                      {confirming ? '确认中...' : '确认采购入库'}
                    </button>
                    {!signatureData && (
                      <p className="text-xs text-gray-400 mt-1 text-center">请先手写签名后再确认</p>
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
