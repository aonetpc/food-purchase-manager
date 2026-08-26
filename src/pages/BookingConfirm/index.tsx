import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  CheckCircle2, AlertCircle, ArrowLeft, Loader2, Phone, User,
  FileText, Calendar, Users, MessageSquare, RefreshCw, X,
} from 'lucide-react';
import { api, bookingApi, type BookingApiOrder } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';

// 业务类型映射（与 BookingBoard/constants.ts 保持一致）
const BIZ_MAP: Record<string, { label: string; icon: string; color: string }> = {
  checkup:   { label: '体检', icon: '🩺', color: '#0EA5E9' },
  lodging:   { label: '住宿', icon: '🛏',  color: '#8B5CF6' },
  breakfast: { label: '早餐', icon: '🌅', color: '#F59E0B' },
  lunch:     { label: '午餐', icon: '🍽', color: '#EF4444' },
  dinner:    { label: '晚餐', icon: '🌙', color: '#EC4899' },
  meeting:   { label: '会务', icon: '📊', color: '#14B8A6' },
  wellness:  { label: '康乐', icon: '🎯', color: '#84CC16' },
  carpickup: { label: '用车', icon: '🚗', color: '#6B7280' },
};

// 状态映射
const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  pending:           { label: '预测单',   color: '#E8B339', bg: 'rgba(232,179,57,.12)' },
  sales_confirming:  { label: '待销售确认', color: '#F59E0B', bg: 'rgba(245,158,11,.12)' },
  reviewing:         { label: '待审核',     color: '#3B82F6', bg: 'rgba(59,130,246,.12)' },
  confirmed:         { label: '已确认',     color: '#10B981', bg: 'rgba(16,185,129,.12)' },
  rejected:          { label: '已驳回',     color: '#EF4444', bg: 'rgba(239,68,68,.12)' },
  completed:         { label: '已完成',     color: '#6366F1', bg: 'rgba(99,102,241,.12)' },
};

function formatCurrency(n: number): string {
  return `¥${Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDateTime(dt?: string): string {
  if (!dt) return '';
  const d = new Date(dt);
  if (isNaN(d.getTime())) return String(dt).replace('T', ' ').substring(0, 16);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function BookingConfirmPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const orderId = searchParams.get('id') || searchParams.get('order_id') || '';
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  const { user, wecomLogin } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [order, setOrder] = useState<BookingApiOrder | null>(null);
  const [showRejectBox, setShowRejectBox] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  // ① 企微 OAuth 回调处理：URL 带 code & state=wecom_confirm 时自动登录
  useEffect(() => {
    if (!code || state !== 'wecom_confirm') return;
    if (user?.token) {
      // 已登录，清理 code/state
      const next = new URLSearchParams(searchParams);
      next.delete('code');
      next.delete('state');
      setSearchParams(next, { replace: true });
      return;
    }
    let cancelled = false;
    (async () => {
      setAuthLoading(true);
      try {
        const result = await wecomLogin(code);
        if (cancelled) return;
        if (result && (result as any).needBind) {
          setError('您的企业微信账号未绑定系统用户，请联系管理员绑定后重试');
        }
        // 登录成功后清理 code/state，触发后续加载
        const next = new URLSearchParams(searchParams);
        next.delete('code');
        next.delete('state');
        setSearchParams(next, { replace: true });
      } catch (e: any) {
        setError(e.message || '企微登录失败，请重试');
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, state]);

  // ② 未登录且无 code：跳转企微 OAuth 授权
  useEffect(() => {
    if (authLoading) return;
    if (!orderId) return;
    if (user?.token) return; // 已登录
    if (code && state === 'wecom_confirm') return; // 正在登录
    // 跳转授权：redirect_uri 为当前页面（带 id）
    const redirectUri = `${window.location.origin}${window.location.pathname}?id=${encodeURIComponent(orderId)}`;
    window.location.href = `${api.getBaseUrl()}/auth/wecom-auth-url?redirect_uri=${encodeURIComponent(redirectUri)}`;
  }, [orderId, user?.token, code, state, authLoading]);

  // ③ 加载订单详情
  useEffect(() => {
    if (!orderId) {
      setError('缺少订单 id 参数');
      setLoading(false);
      return;
    }
    if (!user?.token) return; // 等待登录
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const data = await bookingApi.getOrder(orderId);
        if (!cancelled) setOrder(data);
      } catch (e: any) {
        if (!cancelled) setError(e.message || '加载订单失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [orderId, user?.token]);

  const refresh = async () => {
    if (!orderId || !user?.token) return;
    try {
      const data = await bookingApi.getOrder(orderId);
      setOrder(data);
    } catch (e: any) {
      setError(e.message || '刷新失败');
    }
  };

  // 销售员确认
  const handleSalesConfirm = async () => {
    if (!order) return;
    setSubmitting(true);
    setError('');
    setSuccessMsg('');
    try {
      const updated = await bookingApi.salesConfirmOrder(order.id);
      setOrder(updated);
      setSuccessMsg('已确认，已通知审核员审核');
    } catch (e: any) {
      setError(e.message || '确认失败');
    } finally {
      setSubmitting(false);
    }
  };

  // 审核通过
  const handleApprove = async () => {
    if (!order) return;
    setSubmitting(true);
    setError('');
    setSuccessMsg('');
    try {
      const updated = await bookingApi.approveOrder(order.id);
      setOrder(updated);
      setSuccessMsg('已审核通过，订单已确认');
    } catch (e: any) {
      setError(e.message || '审核失败');
    } finally {
      setSubmitting(false);
    }
  };

  // 驳回
  const handleReject = async () => {
    if (!order) return;
    if (!rejectReason.trim()) {
      setError('请填写驳回原因');
      return;
    }
    setSubmitting(true);
    setError('');
    setSuccessMsg('');
    try {
      const updated = await bookingApi.rejectOrder(order.id, rejectReason.trim());
      setOrder(updated);
      setSuccessMsg('已驳回，已通知销售员修改');
      setShowRejectBox(false);
      setRejectReason('');
    } catch (e: any) {
      setError(e.message || '驳回失败');
    } finally {
      setSubmitting(false);
    }
  };

  // 标记完成
  const handleComplete = async () => {
    if (!order) return;
    setSubmitting(true);
    setError('');
    setSuccessMsg('');
    try {
      const updated = await bookingApi.completeOrder(order.id);
      setOrder(updated);
      setSuccessMsg('订单已标记完成');
    } catch (e: any) {
      setError(e.message || '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  // 加载态
  if (authLoading) {
    return (
      <Shell>
        <CenterCard>
          <Loader2 size={32} className="animate-spin mx-auto mb-3 text-gray-400" />
          <p className="text-gray-500">企微登录中...</p>
        </CenterCard>
      </Shell>
    );
  }

  if (loading) {
    return (
      <Shell>
        <CenterCard>
          <Loader2 size={32} className="animate-spin mx-auto mb-3 text-gray-400" />
          <p className="text-gray-500">加载中...</p>
        </CenterCard>
      </Shell>
    );
  }

  if (error && !order) {
    return (
      <Shell>
        <CenterCard>
          <div className="flex items-center gap-3 text-red-600 mb-4">
            <AlertCircle size={24} />
            <h2 className="text-lg font-semibold">无法打开</h2>
          </div>
          <p className="text-gray-600 text-sm break-all">{error}</p>
          <p className="text-gray-400 text-xs mt-3">
            提示：此链接由企业微信应用消息模板卡片跳转产生，需在企业微信内打开。
          </p>
        </CenterCard>
      </Shell>
    );
  }

  if (!order) return null;

  const statusInfo = STATUS_MAP[order.status] || STATUS_MAP.pending;
  const items = order.items || [];
  const derivedBreakfasts = order.derivedBreakfasts || [];
  const allItems = [...items, ...derivedBreakfasts];

  // 按业务类型分组
  const grouped: Record<string, typeof allItems> = {};
  for (const it of allItems) {
    const key = it.itemType || 'other';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(it);
  }

  // 业务摘要
  const bizSummary = Object.keys(grouped)
    .map(k => BIZ_MAP[k]?.label || k)
    .join('、');

  const isSalesConfirming = order.status === 'sales_confirming';
  const isReviewing = order.status === 'reviewing';
  const isConfirmed = order.status === 'confirmed';
  const isRejected = order.status === 'rejected';

  return (
    <Shell>
      {/* 顶部标题栏 */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-md mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => window.history.back()} className="p-1">
            <ArrowLeft size={20} className="text-gray-600" />
          </button>
          <h1 className="text-lg font-semibold text-gray-800">预订确认单</h1>
          <span
            className="ml-auto text-xs font-medium px-2.5 py-1 rounded-full"
            style={{ color: statusInfo.color, background: statusInfo.bg }}
          >
            {statusInfo.label}
          </span>
        </div>
      </div>

      <div className="max-w-md mx-auto p-4 pb-24 space-y-4">
        {/* 错误提示 */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2 text-sm text-red-700">
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* 成功提示 */}
        {successMsg && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex items-start gap-2 text-sm text-green-700">
            <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* 订单基本信息卡片 */}
        <div className="rounded-2xl p-5 text-white shadow-lg"
             style={{ background: 'linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)' }}>
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-white/70 text-sm mb-1">订单号</p>
              <p className="text-base font-bold">{order.orderNo || '—'}</p>
            </div>
            <div className="text-right">
              <p className="text-white/70 text-sm mb-1">订单总额</p>
              <p className="text-2xl font-bold">{formatCurrency(Number(order.totalAmount || 0))}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-white/70 text-xs mb-0.5">客户名称</p>
              <p className="font-medium">{order.customerName || '—'}</p>
            </div>
            <div>
              <p className="text-white/70 text-xs mb-0.5">销售员</p>
              <p className="font-medium">{order.salesPerson || '—'}</p>
            </div>
          </div>
        </div>

        {/* 客户联系信息 */}
        <div className="bg-white rounded-2xl shadow-sm p-4 space-y-3">
          <h2 className="text-sm font-medium text-gray-800 flex items-center gap-2">
            <User size={16} className="text-blue-500" />
            联系信息
          </h2>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-gray-500">联系人</span>
              <span className="text-gray-800">{order.contactName || '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">联系电话</span>
              {order.contactPhone ? (
                <a href={`tel:${order.contactPhone}`} className="text-blue-600 flex items-center gap-1">
                  <Phone size={12} />
                  {order.contactPhone}
                </a>
              ) : (
                <span className="text-gray-400">—</span>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">付款方式</span>
              <span className="text-gray-800">{order.paymentMethod || '—'}</span>
            </div>
          </div>
        </div>

        {/* 业务摘要 */}
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <h2 className="text-sm font-medium text-gray-800 mb-3 flex items-center gap-2">
            <FileText size={16} className="text-blue-500" />
            涉及业务
          </h2>
          <div className="flex flex-wrap gap-2">
            {Object.keys(grouped).map(k => {
              const biz = BIZ_MAP[k] || { label: k, icon: '📄', color: '#6B7280' };
              const count = grouped[k].length;
              return (
                <span
                  key={k}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
                  style={{ color: biz.color, background: `${biz.color}15` }}
                >
                  <span>{biz.icon}</span>
                  {biz.label}
                  <span className="opacity-60">×{count}</span>
                </span>
              );
            })}
          </div>
          {order.remark && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <div className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                <MessageSquare size={12} /> 备注
              </div>
              <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">{order.remark}</p>
            </div>
          )}
        </div>

        {/* 业务明细（按类型分组） */}
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <h2 className="text-sm font-medium text-gray-800 mb-3 flex items-center gap-2">
            <Calendar size={16} className="text-blue-500" />
            预订明细
          </h2>
          <div className="space-y-4">
            {Object.entries(grouped).map(([bizKey, bizItems]) => {
              const biz = BIZ_MAP[bizKey] || { label: bizKey, icon: '📄', color: '#6B7280' };
              const subTotal = bizItems.reduce((s, i) => s + Number(i.amount || 0), 0);
              return (
                <div key={bizKey}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                      <span>{biz.icon}</span>
                      {biz.label}
                    </span>
                    <span className="text-xs text-gray-400">小计：{formatCurrency(subTotal)}</span>
                  </div>
                  <div className="space-y-2 pl-2 border-l-2" style={{ borderColor: `${biz.color}30` }}>
                    {bizItems.map((item, idx) => (
                      <ItemDetail key={idx} item={item} bizKey={bizKey} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 驳回信息 */}
        {isRejected && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <X size={18} className="text-red-500" />
              <span className="font-medium text-red-700">订单已驳回</span>
            </div>
            <div className="text-xs text-red-600 space-y-1">
              {order.rejectedByName || order.rejectedBy ? (
                <div>驳回人：{order.rejectedByName || order.rejectedBy}</div>
              ) : null}
              {order.rejectionReason && (
                <div>原因：{order.rejectionReason}</div>
              )}
              {order.rejectedAt && (
                <div>时间：{formatDateTime(order.rejectedAt)}</div>
              )}
            </div>
          </div>
        )}

        {/* 审核员操作区 */}
        {isReviewing && (
          <div className="bg-white rounded-2xl shadow-sm p-4">
            <h2 className="text-sm font-medium text-gray-800 mb-3">审核操作</h2>
            {showRejectBox ? (
              <div className="space-y-3">
                <textarea
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  placeholder="请填写驳回原因..."
                  rows={3}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowRejectBox(false); setRejectReason(''); }}
                    disabled={submitting}
                    className="flex-1 py-2.5 bg-gray-100 text-gray-600 text-sm font-medium rounded-xl"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleReject}
                    disabled={submitting}
                    className="flex-1 py-2.5 bg-red-500 text-white text-sm font-medium rounded-xl disabled:opacity-50 flex items-center justify-center gap-1"
                  >
                    {submitting ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />}
                    确认驳回
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => setShowRejectBox(true)}
                  disabled={submitting}
                  className="flex-1 py-3 bg-gray-100 text-gray-700 text-sm font-medium rounded-xl flex items-center justify-center gap-1.5"
                >
                  <X size={16} /> 驳回
                </button>
                <button
                  onClick={handleApprove}
                  disabled={submitting}
                  className="flex-1 py-3 bg-green-500 text-white text-sm font-medium rounded-xl disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {submitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                  审核通过
                </button>
              </div>
            )}
          </div>
        )}

        {/* 销售员确认按钮 */}
        {isSalesConfirming && (
          <div className="bg-white rounded-2xl shadow-sm p-4">
            <div className="mb-3 p-3 bg-amber-50 rounded-xl">
              <p className="text-sm text-amber-800 flex items-center gap-1.5">
                <User size={14} />
                销售员待确认
              </p>
              <p className="text-xs text-amber-600 mt-1">请核对订单信息，确认后通知审核员审核</p>
            </div>
            <button
              onClick={handleSalesConfirm}
              disabled={submitting}
              className="w-full py-3 bg-blue-500 text-white font-medium rounded-xl disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
              {submitting ? '确认中...' : '销售员确认'}
            </button>
          </div>
        )}

        {/* 已确认 → 可标记完成 */}
        {isConfirmed && (
          <div className="bg-white rounded-2xl shadow-sm p-4">
            <div className="mb-3 p-3 bg-green-50 rounded-xl flex items-center gap-2">
              <CheckCircle2 size={16} className="text-green-500" />
              <p className="text-sm text-green-700">订单已确认，可标记为已完成</p>
            </div>
            {order.confirmedAt && (
              <p className="text-xs text-gray-400 mb-3">确认时间：{formatDateTime(order.confirmedAt)}</p>
            )}
            <button
              onClick={handleComplete}
              disabled={submitting}
              className="w-full py-3 bg-indigo-500 text-white font-medium rounded-xl disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
              {submitting ? '处理中...' : '标记完成'}
            </button>
          </div>
        )}

        {/* 刷新按钮 */}
        <button
          onClick={refresh}
          className="w-full py-2 text-xs text-gray-400 flex items-center justify-center gap-1"
        >
          <RefreshCw size={12} /> 刷新订单状态
        </button>
      </div>
    </Shell>
  );
}

// 单条业务明细展示
function ItemDetail({ item, bizKey }: { item: any; bizKey: string }) {
  const date = item.date || '';
  const startTime = item.startTime || '';
  const endTime = item.endTime || '';
  const pax = item.pax ?? 0;
  const amount = Number(item.amount || 0);
  const extra = item.extra || {};
  const biz = BIZ_MAP[bizKey] || { label: bizKey, icon: '📄' };

  // 时间/日期展示
  const timeStr = [date, startTime, endTime ? `-${endTime}` : ''].filter(Boolean).join(' ');

  return (
    <div className="py-1.5">
      <div className="flex justify-between items-start gap-2">
        <div className="flex-1 min-w-0">
          {timeStr && (
            <p className="text-xs text-gray-500 mb-0.5">{timeStr}</p>
          )}
          <p className="text-sm text-gray-700">
            {biz.label}
            {pax > 0 && (
              <span className="text-xs text-gray-400 ml-1.5">
                · {pax}{bizKey === 'lodging' ? '间' : bizKey === 'lunch' || bizKey === 'dinner' ? '桌' : bizKey === 'meeting' ? '人' : '人'}
              </span>
            )}
          </p>
          {/* 住宿详情 */}
          {bizKey === 'lodging' && extra.lodgingType && (
            <p className="text-xs text-gray-400 mt-0.5">房型：{extra.lodgingType}</p>
          )}
          {bizKey === 'lodging' && extra.nights && (
            <p className="text-xs text-gray-400 mt-0.5">晚数：{extra.nights}</p>
          )}
          {bizKey === 'lodging' && extra.pricingMode && (
            <p className="text-xs text-gray-400 mt-0.5">
              计价：{extra.pricingMode === 'per_room' ? '按间' : '按人'}
            </p>
          )}
          {/* 用餐/会议/康乐 多场 */}
          {Array.isArray(extra.sessions) && extra.sessions.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {extra.sessions.map((s: any, i: number) => (
                <p key={i} className="text-xs text-gray-400">
                  {s.date} {s.time || s.startTime || ''} · {s.pax || 0}人
                  {s.tables ? ` · ${s.tables}桌` : ''}
                </p>
              ))}
            </div>
          )}
          {/* 体检人数列表 */}
          {bizKey === 'checkup' && Array.isArray(extra.paxList) && extra.paxList.length > 0 && (
            <p className="text-xs text-gray-400 mt-0.5">
              体检人数：{extra.paxList.length} 人
              {extra.packageTotal ? ` · 套餐合计 ${formatCurrency(Number(extra.packageTotal))}` : ''}
            </p>
          )}
          {/* 用车多客户 */}
          {bizKey === 'carpickup' && Array.isArray(extra.customers) && extra.customers.length > 0 && (
            <p className="text-xs text-gray-400 mt-0.5">
              客户数：{extra.customers.length} · 总人数：{extra.customers.reduce((s: number, c: any) => s + (c.paxCount || 0), 0)}
            </p>
          )}
        </div>
        <span className="text-sm text-gray-700 font-medium whitespace-nowrap">
          {formatCurrency(amount)}
        </span>
      </div>
    </div>
  );
}

// 简单容器
function Shell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-gray-50">{children}</div>;
}

// 居中卡片
function CenterCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-lg p-6 max-w-md w-full text-center">
        {children}
      </div>
    </div>
  );
}
