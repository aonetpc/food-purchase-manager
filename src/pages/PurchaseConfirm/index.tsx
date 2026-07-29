import { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  CheckCircle2, AlertCircle, ArrowLeft, Loader2, Pen, Package,
  Clock, User, Users, RotateCcw,
} from 'lucide-react';
import { api } from '@/lib/api';
import { formatCurrency } from '@/utils/format';

interface PurchaseItem {
  ingredient_name: string;
  purchase_unit: string;
  purchase_quantity: number;
  purchase_unit_price: number;
  amount: number;
  department_name: string;
}

interface UserConfirmation {
  confirmed: boolean;
  confirmed_at?: string;
  confirmed_by?: string;
  departments?: string[];
  signature_data?: string;
}

interface AllConfirmation {
  userid: string;
  name: string;
  confirmed: boolean;
  confirmed_at?: string;
}

interface ConfirmPageData {
  id: string;
  test_date?: string;
  purchase_date?: string;
  user: string;
  user_name: string;
  my_departments: string[];
  my_items: PurchaseItem[];
  my_total: number;
  my_confirmation: UserConfirmation | null;
  all_confirmations: AllConfirmation[];
  total_users: number;
  confirmed_users: number;
  created_at: string;
}

interface SubmitResult {
  success: boolean;
  message: string;
  confirmed_at: string;
  confirmed_departments: string[];
  progress: {
    confirmed_users: number;
    total_users: number;
    all_confirmed: boolean;
  };
  card_updated: boolean;
  card_error: string;
  pdf_url?: string;
  pdf_error?: string;
}

// 手写签名画布
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
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">请在下方区域手写签名</span>
        {hasSignature && (
          <button
            type="button"
            onClick={clearSignature}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-500"
          >
            <RotateCcw size={12} />
            清除重签
          </button>
        )}
      </div>
      <div className="relative border-2 border-dashed border-gray-300 rounded-lg bg-white overflow-hidden">
        <canvas
          ref={canvasRef}
          width={300}
          height={140}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={stopDraw}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={stopDraw}
          onMouseLeave={stopDraw}
          className="w-full h-36 touch-none"
        />
        {!hasSignature && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-gray-300 text-sm">✍️ 请在此处签名</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function PurchaseConfirmPage() {
  const { id: routeId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  // 兼容两种 URL 形式：/confirm/:id 或 /wecom-confirm?id=...&user=...
  const id = routeId || searchParams.get('id') || '';
  const queryUser = searchParams.get('user') || '';

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [data, setData] = useState<ConfirmPageData | null>(null);
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  const [isReSigning, setIsReSigning] = useState(false);
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null);
  const [currentUser, setCurrentUser] = useState<string>('');

  // 解析当前用户（按优先级：URL参数 > 企微登录态 > 内部登录态）
  useEffect(() => {
    if (queryUser) {
      setCurrentUser(queryUser);
      return;
    }
    try {
      const stored = localStorage.getItem('auth-session');
      if (stored) {
        const data = JSON.parse(stored);
        const u = data?.state?.user;
        if (u) {
          if (u.wecom_userid) {
            setCurrentUser(u.wecom_userid);
            return;
          }
          if (u.id) {
            setCurrentUser(u.id);
            return;
          }
        }
      }
    } catch (e) {
      // ignore
    }
  }, [queryUser]);

  useEffect(() => {
    if (id && currentUser) {
      fetchData();
      loadSavedSignature();
    } else if (id && !currentUser) {
      // 还没有 user，等一下
    } else {
      setError('缺少必要参数 id 或 user');
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, currentUser]);

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.get<ConfirmPageData>('/wecom/confirm-page', {
        params: { id, user: currentUser },
      });
      setData(result);
    } catch (err: any) {
      setError(err.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  // 加载该用户已保存的签名
  const loadSavedSignature = async () => {
    try {
      // 内部用户：user_source=system；企微用户：user_source=wecom
      const userSource = queryUser ? 'wecom' : 'system';
      const result = await api.get<{ signature_data: string | null }>(
        `/user/signature?user_id=${encodeURIComponent(currentUser)}&user_source=${userSource}`
      );
      if (result.signature_data) {
        setSavedSignature(result.signature_data);
        setSignatureData(result.signature_data);
      }
    } catch (_err) {
      // 静默失败
    }
  };

  const handleSubmit = async () => {
    if (!data) return;
    const sigToSend = signatureData || savedSignature;
    if (!sigToSend) {
      setError('请先手写签名后再确认');
      return;
    }
    setSubmitting(true);
    setError('');
    setSuccessMsg('');
    try {
      const result = await api.post<SubmitResult>('/wecom/confirm-submit', {
        id,
        user: currentUser,
        signature_data: sigToSend,
        name: data.user_name || currentUser,
      });
      setSubmitResult(result);
      setSuccessMsg(result.message);
      // 重新拉取最新状态
      await fetchData();
    } catch (err: any) {
      setError(err.message || '确认失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-cream-100 flex items-center justify-center">
        <div className="text-center text-gray-500">
          <Loader2 size={32} className="animate-spin mx-auto mb-3" />
          <p>加载中...</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="min-h-screen bg-cream-100 flex items-center justify-center p-6">
        <div className="bg-white rounded-xl shadow-lg p-6 max-w-md w-full">
          <div className="flex items-center gap-3 text-danger-600 mb-4">
            <AlertCircle size={24} />
            <h2 className="text-lg font-semibold">无法打开确认页</h2>
          </div>
          <p className="text-gray-600 text-sm break-all">{error}</p>
          <p className="text-gray-400 text-xs mt-3">
            提示：此链接由企业微信应用消息模板卡片跳转产生，包含 id 和 user 参数。
          </p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  // 已确认过
  const alreadyConfirmed = !!(data.my_confirmation && data.my_confirmation.confirmed);
  const allConfirmed = data.total_users > 0 && data.confirmed_users === data.total_users;

  // 按部门分组明细
  const groupedItems: Record<string, PurchaseItem[]> = {};
  for (const item of data.my_items) {
    const dn = item.department_name || '未分类';
    if (!groupedItems[dn]) groupedItems[dn] = [];
    groupedItems[dn].push(item);
  }

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr).substring(0, 16).replace('T', ' ');
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  return (
    <div className="min-h-screen bg-cream-100">
      {/* 顶部标题 */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-md mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => window.history.back()} className="p-1">
            <ArrowLeft size={20} className="text-gray-600" />
          </button>
          <h1 className="text-lg font-semibold text-gray-800">采购确认单</h1>
          {alreadyConfirmed && (
            <span className="ml-auto text-xs text-green-600 flex items-center gap-1">
              <CheckCircle2 size={14} /> 已确认
            </span>
          )}
        </div>
      </div>

      <div className="max-w-md mx-auto p-4 space-y-4">
        {/* 错误提示 */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2 text-sm text-red-700">
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* 成功提示 */}
        {successMsg && submitResult && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700">
            <div className="flex items-center gap-2 font-medium">
              <CheckCircle2 size={16} />
              {successMsg}
            </div>
            <div className="mt-1 text-xs text-green-600">
              确认时间：{submitResult.confirmed_at}
              <br />
              已确认部门：{submitResult.confirmed_departments.join('、')}
              <br />
              进度：{submitResult.progress.confirmed_users} / {submitResult.progress.total_users} 位确认人
              {submitResult.progress.all_confirmed && ' · 已全部确认 ✓'}
            </div>
            {!submitResult.card_updated && submitResult.card_error && (
              <div className="mt-1 text-xs text-yellow-600">
                提醒消息发送失败：{submitResult.card_error}（不影响确认结果）
              </div>
            )}
            {submitResult.progress.all_confirmed && submitResult.pdf_url && (
              <div className="mt-2 pt-2 border-t border-green-100">
                <a
                  href={submitResult.pdf_url}
                  download
                  className="inline-flex items-center gap-1 text-xs text-green-700 hover:text-green-800 font-medium"
                >
                  <span>📄</span> 下载自动生成的采购确认单PDF
                </a>
              </div>
            )}
            {submitResult.progress.all_confirmed && submitResult.pdf_error && (
              <div className="mt-1 text-xs text-red-600">
                PDF自动生成失败：{submitResult.pdf_error}
              </div>
            )}
          </div>
        )}

        {/* 基本信息 */}
        <div className="bg-white rounded-xl shadow-sm p-4">
          <div className="flex justify-between items-start mb-3">
            <div>
              <p className="text-sm text-gray-500">采购日期</p>
              <p className="font-medium text-gray-800">{data.test_date || data.purchase_date}</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-500">您负责金额</p>
              <p className="font-bold text-primary-600 text-lg">{formatCurrency(Number(data.my_total || 0))}</p>
            </div>
          </div>

          {/* 部门标签 */}
          <div className="flex flex-wrap gap-1.5 mt-2">
            {data.my_departments.map(d => (
              <span key={d} className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary-50 text-primary-700 text-xs rounded-full">
                <Package size={10} />
                {d}
              </span>
            ))}
          </div>

          {/* 确认进度 */}
          <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <Users size={12} />
              确认进度：{data.confirmed_users} / {data.total_users} 位
            </span>
            <span className="flex items-center gap-1">
              <User size={12} />
              当前用户：{data.user_name || currentUser}
            </span>
          </div>
          {allConfirmed && (
            <div className="mt-2 bg-green-50 border border-green-200 rounded-lg p-2 flex items-center gap-2">
              <CheckCircle2 size={14} className="text-green-500" />
              <span className="text-xs text-green-700">所有部门确认人均已完成确认</span>
            </div>
          )}
        </div>

        {/* 已确认信息 */}
        {alreadyConfirmed && data.my_confirmation && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 size={18} className="text-green-500" />
              <span className="font-medium text-green-700">您已确认</span>
            </div>
            <div className="text-xs text-green-700 space-y-1">
              <div>确认时间：{formatDate(data.my_confirmation.confirmed_at)}</div>
              {data.my_confirmation.confirmed_by && (
                <div>确认人：{data.my_confirmation.confirmed_by}</div>
              )}
            </div>
            {data.my_confirmation.signature_data && (
              <div className="mt-3">
                <div className="text-xs text-green-600 mb-1">签名：</div>
                <img
                  src={data.my_confirmation.signature_data}
                  alt="签名"
                  className="h-16 w-auto bg-white rounded border border-green-200 p-1"
                />
              </div>
            )}
          </div>
        )}

        {/* 采购明细 */}
        <div className="bg-white rounded-xl shadow-sm p-4">
          <h2 className="font-medium text-gray-800 mb-3 flex items-center gap-2">
            <Package size={16} className="text-primary-500" />
            您负责的采购明细
          </h2>
          <div className="space-y-4">
            {Object.entries(groupedItems).map(([deptName, items]) => (
              <div key={deptName}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-medium text-gray-700">{deptName}</span>
                  <span className="text-xs text-gray-400">
                    小计：¥{items.reduce((s, i) => s + i.amount, 0).toFixed(2)}
                  </span>
                </div>
                <div className="space-y-1 pl-2 border-l-2 border-gray-100">
                  {items.map((item, idx) => (
                    <div key={idx} className="flex justify-between text-sm">
                      <span className="text-gray-600">
                        {item.ingredient_name}
                        <span className="text-xs text-gray-400 ml-1">
                          ¥{Number(item.purchase_unit_price).toFixed(2)}/{item.purchase_unit} × {item.purchase_quantity}{item.purchase_unit}
                        </span>
                      </span>
                      <span className="text-gray-700">¥{Number(item.amount).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 手写签名 + 确认按钮（未确认时显示） */}
        {!alreadyConfirmed && (
          <div className="bg-white rounded-xl shadow-sm p-4">
            <h2 className="font-medium text-gray-800 mb-3 flex items-center gap-2">
              <Pen size={16} className="text-primary-500" />
              手写签名确认
            </h2>

            {savedSignature && !isReSigning ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                  <img
                    src={savedSignature}
                    alt="已保存签名"
                    className="h-16 w-auto rounded border border-gray-200 bg-white"
                  />
                  <div className="flex-1">
                    <p className="text-xs text-gray-500">已保存的签名</p>
                    <p className="text-xs text-gray-400 mt-1">直接确认或重新签名</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsReSigning(true);
                      setSignatureData(null);
                    }}
                    className="px-3 py-1.5 bg-gray-100 text-gray-600 text-xs rounded-lg hover:bg-gray-200"
                  >
                    重新签名
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="w-full py-3 bg-green-500 text-white font-medium rounded-lg hover:bg-green-600 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {submitting ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
                  {submitting ? '确认中...' : '确认采购入库'}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <SignatureCanvas onSignatureChange={setSignatureData} />
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting || !signatureData}
                  className="w-full py-3 bg-green-500 text-white font-medium rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:bg-gray-300 flex items-center justify-center gap-2"
                >
                  {submitting ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
                  {submitting ? '确认中...' : '确认采购入库'}
                </button>
                {!signatureData && (
                  <p className="text-xs text-gray-400 text-center">请先手写签名后再确认</p>
                )}
                {isReSigning && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsReSigning(false);
                      setSignatureData(savedSignature);
                    }}
                    className="w-full py-1.5 text-xs text-gray-400 hover:text-gray-600"
                  >
                    取消重新签名，使用已保存签名
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* 已确认后显示已确认按钮（灰色不可按） */}
        {alreadyConfirmed && (
          <div className="bg-white rounded-xl shadow-sm p-4">
            <button
              type="button"
              disabled
              className="w-full py-3 bg-gray-200 text-gray-500 font-medium rounded-lg flex items-center justify-center gap-2 cursor-not-allowed"
            >
              <CheckCircle2 size={18} />
              已确认（{formatDate(data.my_confirmation?.confirmed_at)}）
            </button>
            <div className="mt-3 text-xs text-gray-400 flex items-center gap-1 justify-center">
              <Clock size={12} />
              每位确认人独立确认，全部确认完成后单据状态会自动变更为「已确认」
            </div>
          </div>
        )}

        {/* 其他确认人状态 */}
        {data.all_confirmations.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm p-4">
            <h2 className="font-medium text-gray-800 mb-3 flex items-center gap-2 text-sm">
              <Users size={14} className="text-primary-500" />
              其他确认人状态
            </h2>
            <div className="space-y-1.5">
              {data.all_confirmations.map(c => (
                <div key={c.userid} className="flex items-center justify-between text-xs py-1">
                  <span className="text-gray-600">{c.name || c.userid}</span>
                  {c.confirmed ? (
                    <span className="flex items-center gap-1 text-green-600">
                      <CheckCircle2 size={12} /> 已确认 · {formatDate(c.confirmed_at)}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-yellow-600">
                      <Clock size={12} /> 待确认
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
