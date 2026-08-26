import { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  CheckCircle2, AlertCircle, ArrowLeft, Loader2, Phone, User,
  FileText, Calendar, Clock, Users, MessageSquare, RefreshCw, X,
  HandCoins, BedDouble, UtensilsCrossed, Stethoscope, Car, PartyPopper,
  Target, Download, ChevronRight, RotateCcw, Trash2, Signature as SignatureIcon,
  ShieldCheck,
} from 'lucide-react';
import { api, bookingApi, type BookingApiOrder, type PackageRow, type MealTypeRow, type RoomTypeRow } from '@/lib/api';
import { checkupApi } from '@/pages/CheckupTemplates/api';
import { useAuthStore } from '@/store/authStore';
import SignatureCanvas, { type SignatureCanvasHandle } from '@/components/SignatureCanvas';

// 业务类型映射
const BIZ_MAP: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  checkup:   { label: '体检',   icon: <Stethoscope size={14} />, color: '#0EA5E9' },
  lodging:   { label: '住宿',   icon: <BedDouble  size={14} />, color: '#8B5CF6' },
  breakfast: { label: '早餐',   icon: <Clock      size={14} />, color: '#F59E0B' },
  lunch:     { label: '午餐',   icon: <UtensilsCrossed size={14} />, color: '#EF4444' },
  dinner:    { label: '晚餐',   icon: <UtensilsCrossed size={14} />, color: '#EC4899' },
  meeting:   { label: '会务',   icon: <PartyPopper size={14} />, color: '#14B8A6' },
  wellness:  { label: '康乐',   icon: <Target     size={14} />, color: '#84CC16' },
  carpickup: { label: '用车',   icon: <Car        size={14} />, color: '#6B7280' },
};

// 状态映射
const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  pending:           { label: '预测单',       color: '#E8B339', bg: 'rgba(232,179,57,.12)' },
  sales_confirming:  { label: '待销售确认',   color: '#F59E0B', bg: 'rgba(245,158,11,.12)' },
  reviewing:         { label: '待审核',       color: '#3B82F6', bg: 'rgba(59,130,246,.12)' },
  confirmed:         { label: '已确认',       color: '#10B981', bg: 'rgba(16,185,129,.12)' },
  rejected:          { label: '已驳回',       color: '#EF4444', bg: 'rgba(239,68,68,.12)' },
  completed:         { label: '已完成',       color: '#6366F1', bg: 'rgba(99,102,241,.12)' },
};

const ROLE_LABEL: Record<string, string> = {
  male: '男性',
  female_married: '已婚女',
  female_single: '未婚女',
};

// 销售胶囊/套餐名称友好化（对齐PC BookingBoard#friendlyCapsuleName）
function friendlyCapsuleName(cap: any): string {
  if (!cap) return '未设置套餐';
  const raw = String(cap.name || cap.code || '').trim();
  if (!raw) return cap.code ? `${cap.code}套餐` : '体检套餐';
  const ugly = [
    /^套餐\s*[0-9a-fA-F-]{8,}$/, /^[0-9a-fA-F]{8}-[0-9a-fA-F-]+$/,
    /^[0-9]+$/, /^[Pp]KG[_-]?\w+$/, /^[Pp]ackage[_-]?\w+$/, /^[0-9a-fA-F]{12,}$/,
  ].some(p => p.test(raw));
  if (!ugly) return raw;
  if (cap.code) return `${cap.code}套餐`;
  return '体检套餐';
}
// 折扣信息返回 { label: "X.X折", fromRate: true, nominalOnly: false }
//  - fromRate: 折扣率来源于 DB discount_rate（即使 final==base 也应显示谈判折扣）
//  - nominalOnly: true = final==base 但 rate<100（谈判折扣存在，金额未实际打折）
type DiscountInfo = { label: string; fromRate: boolean; nominalOnly: boolean };
function NO_DISCOUNT(): DiscountInfo { return { label: '', fromRate: false, nominalOnly: false }; }
function formatDiscountInfo(opts: { discount_rate?: number; final?: number; base?: number }): DiscountInfo {
  const { discount_rate, final = 0, base = 0 } = opts;
  const b = Number(base || 0);
  const f = Number(final || 0);
  if (typeof discount_rate === 'number' && discount_rate > 0 && discount_rate < 100) {
    const label = `${Math.round(discount_rate * 10) / 100}折`;
    // 实际金额无差但有 rate → 标记为"谈判折扣"
    const nominalOnly = b > 0 && f > 0 && f >= b;
    return { label, fromRate: true, nominalOnly };
  }
  if (b > 0 && f > 0 && f < b) {
    return {
      label: `${Math.round((f / b) * 1000) / 10}折`,
      fromRate: false,
      nominalOnly: false,
    };
  }
  return NO_DISCOUNT();
}
// 兼容旧接口（只返回字符串）
function formatDiscount(opts: { discount_rate?: number; final?: number; base?: number }): string {
  return formatDiscountInfo(opts).label;
}

function n(n: any): number { return Number(n || 0); }
function formatCurrency(nu: any): string {
  const v = Number(nu || 0);
  return `¥${v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function formatDateTime(dt?: any): string {
  if (!dt) return '';
  const d = new Date(typeof dt === 'string' && !dt.includes('T') ? `${dt}T00:00:00` : dt);
  if (isNaN(d.getTime())) return String(dt).replace('T', ' ').substring(0, 16);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ============================================================
// 流程节点类型（用于审批流程卡展示）
// ============================================================
type StepStatus = 'done' | 'current' | 'waiting' | 'rejected';

interface FlowStep {
  key: string;
  title: string;
  status: StepStatus;
  name?: string;
  time?: string;
  signature?: string;     // base64 PNG
  remark?: string;        // 驳回原因等
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

  // 业务配置（套餐/房型/用餐类型）
  const [bizCfgLoading, setBizCfgLoading] = useState(false);
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [mealTypes, setMealTypes] = useState<MealTypeRow[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomTypeRow[]>([]);
  const [capsules, setCapsules] = useState<any[]>([]); // 销售体检胶囊，含 prices[role].discount_price

  // 操作 UI
  const [showRejectBox, setShowRejectBox] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [savedSignature, setSavedSignature] = useState<string | null>(null);   // 可复用的用户签字
  const [loadingSavedSig, setLoadingSavedSig] = useState(false);

  // 🔁 对齐采购确认页：解析当前签字读取 user key（URL queryUser = 企微H5；否则 localStorage auth-session.state.user）
  //   BookingConfirm 场景有三种人会点进确认页：销售员(确认)、审核员(审核)、执行人(标记完成)
  //   所以签字 key 按"当前登录身份"取，和采购确认页的 pattern 完全一致。
  const [currentSigUser, setCurrentSigUser] = useState<string>('');
  useEffect(() => {
    // 1) URL ?user=xxx 企微回调场景(和采购确认页 queryUser 一致)
    const q = searchParams.get('user');
    if (q) { setCurrentSigUser(q); return; }
    // 2) localStorage.auth-session.state.user 取后端返回的原始字段 wecom_userid（下划线，不是authStore驼峰）
    try {
      const stored = localStorage.getItem('auth-session');
      if (stored) {
        const data = JSON.parse(stored);
        const u = data?.state?.user;
        if (u) {
          if (u.wecom_userid) { setCurrentSigUser(u.wecom_userid); return; }
          if (u.id)         { setCurrentSigUser(u.id);         return; }
        }
      }
    } catch (_) { /* ignore */ }
    // 3) authStore 兜底（企微H5登录态会写wecomUserId；PC端系统用户登录态会写id）
    if (user) {
      const uidFromStore = (user as any).wecom_userid || (user as any).wecomUserId || user.id;
      if (uidFromStore) setCurrentSigUser(uidFromStore);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, user?.id]);

  // 签字画布 ref
  const salesSigRef = useRef<SignatureCanvasHandle>(null);
  const approveSigRef = useRef<SignatureCanvasHandle>(null);
  const completeSigRef = useRef<SignatureCanvasHandle>(null);
  const [salesSig, setSalesSig] = useState<string | null>(null);
  const [approveSig, setApproveSig] = useState<string | null>(null);
  const [completeSig, setCompleteSig] = useState<string | null>(null);

  // ---- 企微 OAuth ----
  useEffect(() => {
    if (!code || state !== 'wecom_confirm') return;
    if (user?.token) {
      const next = new URLSearchParams(searchParams);
      next.delete('code'); next.delete('state');
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
        const next = new URLSearchParams(searchParams);
        next.delete('code'); next.delete('state');
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

  useEffect(() => {
    if (authLoading) return;
    if (!orderId) return;
    if (user?.token) return;
    if (code && state === 'wecom_confirm') return;
    const redirectUri = `${window.location.origin}${window.location.pathname}?id=${encodeURIComponent(orderId)}`;
    window.location.href = `${api.getBaseUrl()}/auth/wecom-auth-url?redirect_uri=${encodeURIComponent(redirectUri)}`;
  }, [orderId, user?.token, code, state, authLoading]);

  // ---- 加载订单 + 业务配置 ----
  useEffect(() => {
    if (!orderId) { setError('缺少订单 id 参数'); setLoading(false); return; }
    if (!user?.token) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const [orderData, cfg] = await Promise.all([
          bookingApi.getOrder(orderId),
          bookingApi.getConfig(),
        ]);
        if (cancelled) return;
        setOrder(orderData);
        setPackages(cfg.packages || []);
        setMealTypes(cfg.mealTypes || []);
        setRoomTypes(cfg.roomTypes || []);

        // 若订单有销售员，加载销售体检胶囊（用于体检套餐价/折扣率显示）
        const sid = orderData.salesPersonId;
        if (sid) {
          try {
            const res = await checkupApi.listSalesCapsules(sid);
            if (!cancelled && res?.ok) setCapsules(res.data || []);
          } catch { /* ignore */ }
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || '加载订单失败');
      } finally {
        if (!cancelled) { setLoading(false); setBizCfgLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [orderId, user?.token]);

  // 🔁 对齐采购确认页：加载当前用户的复用签字
  //    user_source = URL有user参数(企微H5) => wecom；否则(PC端系统登录) => system
  //    user_id    = currentSigUser(上一步已经从 localStorage.auth-session 取后端原始字段 wecom_userid，不再用 authStore 错误的驼峰 wecomUserId)
  useEffect(() => {
    if (!currentSigUser) return;
    setLoadingSavedSig(true);
    (async () => {
      try {
        const userSource = searchParams.get('user') ? 'wecom' : 'system';
        const res = await api.get<any>('/user/signature', {
          params: { user_id: currentSigUser, user_source: userSource }
        });
        if (res && res.signature_data) {
          setSavedSignature(res.signature_data);
          // ✅ 对齐采购确认页：首次加载成功后自动把签字"回填"进当前所有角色的签字状态
          //    (后续如果用户点"清除/重签"，onChange 会覆盖对应 role 的状态变量)
          setSalesSig(res.signature_data);
          setApproveSig(res.signature_data);
          setCompleteSig(res.signature_data);
          salesSigRef.current?.setSignature(res.signature_data);
          approveSigRef.current?.setSignature(res.signature_data);
          completeSigRef.current?.setSignature(res.signature_data);
        }
      } catch { setSavedSignature(null); }
      finally { setLoadingSavedSig(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSigUser]);

  const refresh = async () => {
    if (!orderId || !user?.token) return;
    try {
      const data = await bookingApi.getOrder(orderId);
      setOrder(data);
    } catch (e: any) { setError(e.message || '刷新失败'); }
  };

  // --- 操作函数 ---
  const withSigReuseHint = (sig: string | null, action: () => Promise<void>) => async () => {
    setSubmitting(true); setError(''); setSuccessMsg('');
    try {
      if (!sig) { setError('请先签字再提交'); setSubmitting(false); return; }
      await action();
    } catch (e: any) { setError(e.message || '操作失败'); }
    finally { setSubmitting(false); }
  };

  const handleSalesConfirm = withSigReuseHint(salesSig, async () => {
    if (!order) return;
    const updated = await bookingApi.salesConfirmOrder(order.id, salesSig!);
    setOrder(updated);
    setSuccessMsg('销售员确认成功，已通知审核员审核');
  });

  const handleApprove = withSigReuseHint(approveSig, async () => {
    if (!order) return;
    const updated = await bookingApi.approveOrder(order.id, approveSig!);
    setOrder(updated);
    setSuccessMsg('审核通过，订单已确认');
  });

  const handleReject = async () => {
    if (!order) return;
    if (!rejectReason.trim()) { setError('请填写驳回原因'); return; }
    setSubmitting(true); setError(''); setSuccessMsg('');
    try {
      const updated = await bookingApi.rejectOrder(order.id, rejectReason.trim());
      setOrder(updated);
      setSuccessMsg('已驳回，已通知销售员修改');
      setShowRejectBox(false);
      setRejectReason('');
    } catch (e: any) { setError(e.message || '驳回失败'); }
    finally { setSubmitting(false); }
  };

  const handleComplete = withSigReuseHint(completeSig, async () => {
    if (!order) return;
    const updated = await bookingApi.completeOrder(order.id, completeSig!);
    setOrder(updated);
    setSuccessMsg('订单已标记完成');
  });

  // 复用上次签字：点击按钮后把 savedSignature 填入当前画布
  const applySavedSignature = (target: 'sales' | 'approve' | 'complete') => {
    if (!savedSignature) { setError('暂无已保存的签字，请先手绘一次'); return; }
    if (target === 'sales')   { salesSigRef.current?.setSignature(savedSignature);   setSalesSig(savedSignature); }
    if (target === 'approve') { approveSigRef.current?.setSignature(savedSignature); setApproveSig(savedSignature); }
    if (target === 'complete'){ completeSigRef.current?.setSignature(savedSignature); setCompleteSig(savedSignature); }
  };

  // ---- 渲染 ----
  if (authLoading) return <Shell><CenterCard><Loader2 size={32} className="animate-spin mx-auto mb-3 text-gray-400" /><p className="text-gray-500">企微登录中...</p></CenterCard></Shell>;
  if (loading) return <Shell><CenterCard><Loader2 size={32} className="animate-spin mx-auto mb-3 text-gray-400" /><p className="text-gray-500">加载中...</p></CenterCard></Shell>;
  if (error && !order) return <Shell><CenterCard><div className="flex items-center gap-3 text-red-600 mb-4"><AlertCircle size={24} /><h2 className="text-lg font-semibold">无法打开</h2></div><p className="text-gray-600 text-sm break-all">{error}</p><p className="text-gray-400 text-xs mt-3">提示：此链接由企业微信应用消息跳转产生，需在企业微信内打开</p></CenterCard></Shell>;
  if (!order) return null;

  const statusInfo = STATUS_MAP[order.status] || STATUS_MAP.pending;
  const items = (order as any).items || [];
  const derived = (order as any).derivedBreakfasts || [];
  const allItems = [...items, ...derived];
  const grouped: Record<string, typeof allItems> = {};
  for (const it of allItems) {
    const k = (it as any).itemType || (it as any).item_type || 'other';
    if (!grouped[k]) grouped[k] = [];
    grouped[k].push(it);
  }
  const bizSummary = Object.keys(grouped).map(k => BIZ_MAP[k]?.label || k).join('、');

  // 生成流程步骤
  const flowSteps = buildFlowSteps(order);

  return (
    <Shell>
      {/* 顶部栏 */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-md mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => window.history.back()} className="p-1">
            <ArrowLeft size={20} className="text-gray-600" />
          </button>
          <h1 className="text-lg font-semibold text-gray-800">预订确认单</h1>
          <span className="ml-auto text-xs font-medium px-2.5 py-1 rounded-full"
                style={{ color: statusInfo.color, background: statusInfo.bg }}>
            {statusInfo.label}
          </span>
        </div>
      </div>

      <div className="max-w-md mx-auto p-4 pb-28 space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2 text-sm text-red-700">
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" /><span>{error}</span>
          </div>
        )}
        {successMsg && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex items-start gap-2 text-sm text-green-700">
            <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0" /><span>{successMsg}</span>
          </div>
        )}

        {/* 订单头卡 */}
        <div className="rounded-2xl p-5 text-white shadow-lg"
             style={{ background: 'linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)' }}>
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-white/70 text-sm mb-1">订单号</p>
              <p className="text-base font-bold">{order.orderNo || '—'}</p>
            </div>
            <div className="text-right">
              <p className="text-white/70 text-sm mb-1">订单总额</p>
              <p className="text-2xl font-bold">{formatCurrency(order.totalAmount)}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><p className="text-white/70 text-xs mb-0.5">客户名称</p><p className="font-medium">{order.customerName || '—'}</p></div>
            <div><p className="text-white/70 text-xs mb-0.5">销售员</p><p className="font-medium">{order.salesPerson || '—'}</p></div>
          </div>
        </div>

        {/* 联系信息 */}
        <InfoCard icon={<User size={16} className="text-blue-500" />} title="联系信息">
          <Row label="联系人" value={order.contactName || '—'} />
          <Row label="联系电话" value={
            order.contactPhone ? (
              <a href={`tel:${order.contactPhone}`} className="text-blue-600 flex items-center gap-1"><Phone size={12} />{order.contactPhone}</a>
            ) : <span className="text-gray-400">—</span>
          } />
          <Row label="付款方式" value={order.paymentMethod || '—'} />
        </InfoCard>

        {/* 涉及业务 + 备注 */}
        <InfoCard icon={<FileText size={16} className="text-blue-500" />} title="涉及业务">
          <div className="flex flex-wrap gap-2 mb-2">
            {Object.keys(grouped).map(k => {
              const biz = BIZ_MAP[k] || { label: k, icon: null, color: '#6B7280' };
              const count = grouped[k].length;
              return (
                <span key={k} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
                      style={{ color: biz.color, background: `${biz.color}15` }}>
                  {biz.icon}{biz.label}
                  <span className="opacity-60">×{count}</span>
                </span>
              );
            })}
            {bizSummary === '' && <span className="text-xs text-gray-400">暂无业务项</span>}
          </div>
          {order.remark && (
            <div className="mt-2 pt-3 border-t border-gray-100">
              <div className="text-xs text-gray-500 mb-1 flex items-center gap-1"><MessageSquare size={12} />备注</div>
              <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">{order.remark}</p>
            </div>
          )}
        </InfoCard>

        {/* 业务明细 */}
        <InfoCard icon={<Calendar size={16} className="text-blue-500" />} title="预订明细">
          <div className="space-y-5">
            {Object.entries(grouped).map(([bizKey, bizItems]) => {
              const biz = BIZ_MAP[bizKey] || { label: bizKey, icon: null, color: '#6B7280' };
              const subTotal = bizItems.reduce((s, i) => s + Number((i as any).amount || 0), 0);
              return (
                <div key={bizKey}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-700 flex items-center gap-1.5">{biz.icon}{biz.label}</span>
                    <span className="text-xs text-gray-400">小计：{formatCurrency(subTotal)}</span>
                  </div>
                  <div className="space-y-3 pl-2 border-l-2" style={{ borderColor: `${biz.color}30` }}>
                    {bizItems.map((it, idx) => (
                      <div key={idx}>
                        <ItemHeader item={it} bizKey={bizKey} />
                        <ItemDetails
                          item={it}
                          bizKey={bizKey}
                          packages={packages}
                          mealTypes={mealTypes}
                          roomTypes={roomTypes}
                          capsules={capsules}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {Object.keys(grouped).length === 0 && <p className="text-sm text-gray-400">暂无明细</p>}
          </div>
        </InfoCard>

        {/* 操作区：销售确认 / 审核 / 标记完成 */}
        {order.status === 'sales_confirming' && (
          <ActionBox
            icon={<User size={16} />}
            title="销售员待确认"
            desc="请核对订单信息，签字后点击确认，进入审核员审核"
            tone="amber"
          >
            <SignatureActionsBar
              onLoadSaved={() => applySavedSignature('sales')}
              loadingSavedSig={loadingSavedSig}
              hasSavedSig={!!savedSignature}
            />
            <SignatureCanvas ref={salesSigRef} onChange={setSalesSig} />
            <button
              onClick={handleSalesConfirm}
              disabled={submitting || !salesSig}
              className="mt-3 w-full py-3 bg-amber-500 text-white font-medium rounded-xl disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
              {submitting ? '确认中...' : !salesSig ? '请先签字再确认' : '销售员确认'}
            </button>
          </ActionBox>
        )}

        {order.status === 'reviewing' && (
          <ActionBox icon={<ShieldCheck size={16} />} title="审核操作" tone="blue" desc="请确认订单信息无误，签字后审核通过">
            {showRejectBox ? (
              <div className="space-y-3">
                <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                  placeholder="请填写驳回原因..." rows={3}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none" />
                <div className="flex gap-2">
                  <button onClick={() => { setShowRejectBox(false); setRejectReason(''); }}
                    disabled={submitting}
                    className="flex-1 py-2.5 bg-gray-100 text-gray-600 text-sm font-medium rounded-xl">取消</button>
                  <button onClick={handleReject} disabled={submitting}
                    className="flex-1 py-2.5 bg-red-500 text-white text-sm font-medium rounded-xl disabled:opacity-50 flex items-center justify-center gap-1">
                    {submitting ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />}确认驳回
                  </button>
                </div>
              </div>
            ) : (
              <>
                <SignatureActionsBar onLoadSaved={() => applySavedSignature('approve')} loadingSavedSig={loadingSavedSig} hasSavedSig={!!savedSignature} />
                <SignatureCanvas ref={approveSigRef} onChange={setApproveSig} />
                <div className="flex gap-2 mt-3">
                  <button onClick={() => setShowRejectBox(true)} disabled={submitting}
                    className="flex-1 py-3 bg-gray-100 text-gray-700 text-sm font-medium rounded-xl flex items-center justify-center gap-1.5">
                    <X size={16} /> 驳回
                  </button>
                  <button onClick={handleApprove} disabled={submitting || !approveSig}
                    className="flex-1 py-3 bg-blue-500 text-white text-sm font-medium rounded-xl disabled:opacity-50 flex items-center justify-center gap-1.5">
                    {submitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                    {submitting ? '处理中...' : !approveSig ? '请先签字' : '审核通过'}
                  </button>
                </div>
              </>
            )}
          </ActionBox>
        )}

        {order.status === 'confirmed' && (
          <ActionBox icon={<CheckCircle2 size={16} />} title="订单已确认" desc="业务执行完毕后可标记完成" tone="green">
            <SignatureActionsBar onLoadSaved={() => applySavedSignature('complete')} loadingSavedSig={loadingSavedSig} hasSavedSig={!!savedSignature} />
            <SignatureCanvas ref={completeSigRef} onChange={setCompleteSig} />
            <button onClick={handleComplete} disabled={submitting || !completeSig}
              className="mt-3 w-full py-3 bg-indigo-500 text-white font-medium rounded-xl disabled:opacity-50 flex items-center justify-center gap-2">
              {submitting ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
              {submitting ? '处理中...' : !completeSig ? '请先签字再标记完成' : '标记完成'}
            </button>
          </ActionBox>
        )}

        {/* 审批流程卡：放在签字操作区全部下方，rejected 状态前叠加驳回详情卡 */}
        {order.status === 'rejected' && (
          <InfoCard icon={<X size={16} className="text-red-500" />} title="驳回信息">
            {order.rejectedByName && <Row label="驳回人" value={order.rejectedByName} />}
            {order.rejectedAt && <Row label="驳回时间" value={formatDateTime(order.rejectedAt)} />}
            {order.rejectionReason && <Row label="驳回原因" value={<span className="whitespace-pre-wrap break-words">{order.rejectionReason}</span>} />}
          </InfoCard>
        )}
        <ApprovalFlowCard steps={flowSteps} />

        <button onClick={refresh} className="w-full py-2 text-xs text-gray-400 flex items-center justify-center gap-1">
          <RefreshCw size={12} />刷新订单状态
        </button>
      </div>
    </Shell>
  );
}

// ============================================================
// 子组件：流程卡
// ============================================================
function buildFlowSteps(order: BookingApiOrder): FlowStep[] {
  // Step 1：创建
  const step1: FlowStep = {
    key: 'create', title: '预订员提交', status: 'done',
    name: order.bookerName, time: formatDateTime(order.createdAt),
  };

  // Step 2：销售确认
  let step2: FlowStep;
  if (order.salesConfirmedAt || order.salesConfirmedByName || order.salesConfirmedSignature) {
    step2 = { key: 'sales', title: '销售员确认', status: 'done', name: order.salesConfirmedByName || order.salesPerson, time: formatDateTime(order.salesConfirmedAt), signature: order.salesConfirmedSignature };
  } else if (order.status === 'sales_confirming') {
    step2 = { key: 'sales', title: '销售员确认', status: 'current' };
  } else if (order.status === 'pending') {
    step2 = { key: 'sales', title: '销售员确认', status: 'waiting' };
  } else { // reviewing/confirmed/rejected/completed 状态但没有销售确认信息 → 说明是老数据跳转直接到审核（兼容）
    step2 = { key: 'sales', title: '销售员确认', status: (order.status === 'rejected' ? 'rejected' : 'done'), name: order.salesConfirmedByName || order.salesPerson, time: formatDateTime(order.salesConfirmedAt), signature: order.salesConfirmedSignature };
  }

  // Step 3：审核
  let step3: FlowStep;
  if (order.approvedByName || order.approvedSignature || order.status === 'confirmed' || order.status === 'completed') {
    step3 = { key: 'approve', title: '审核员审核通过', status: 'done', name: order.approvedByName, time: formatDateTime(order.confirmedAt), signature: order.approvedSignature };
  } else if (order.status === 'rejected') {
    step3 = { key: 'approve', title: '审核员审核', status: 'rejected', name: order.rejectedByName, time: formatDateTime(order.rejectedAt), remark: order.rejectionReason ? `驳回原因：${order.rejectionReason}` : undefined, signature: (order as any).rejectedSignature };
  } else if (order.status === 'reviewing') {
    step3 = { key: 'approve', title: '审核员审核', status: 'current' };
  } else {
    step3 = { key: 'approve', title: '审核员审核', status: 'waiting' };
  }

  // Step 4：完成
  let step4: FlowStep;
  if (order.status === 'completed' || order.completedByName || order.completedSignature) {
    step4 = { key: 'done', title: '订单完成', status: 'done', name: order.completedByName, time: formatDateTime(order.completedAt), signature: order.completedSignature };
  } else if (order.status === 'confirmed') {
    step4 = { key: 'done', title: '订单完成', status: 'current' };
  } else {
    step4 = { key: 'done', title: '订单完成', status: 'waiting' };
  }

  return [step1, step2, step3, step4];
}

function ApprovalFlowCard({ steps }: { steps: FlowStep[] }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm p-4">
      <h2 className="text-sm font-medium text-gray-800 mb-3 flex items-center gap-2">
        <ShieldCheck size={16} className="text-blue-500" />审批流程
      </h2>
      <div className="space-y-0">
        {steps.map((s, idx) => (
          <div key={s.key} className="relative pl-8 pb-4 last:pb-0">
            {idx < steps.length - 1 && (
              <div className="absolute left-[11px] top-6 bottom-0 w-px bg-gray-200" aria-hidden />
            )}
            <StepDot status={s.status} />
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className={`text-sm font-medium ${s.status === 'current' ? 'text-blue-600' : s.status === 'rejected' ? 'text-red-600' : s.status === 'done' ? 'text-gray-800' : 'text-gray-400'}`}>
                  {s.title}
                  {s.status === 'current' && <span className="ml-2 inline-block w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse align-middle" />}
                </div>
                {s.name && <div className="text-xs text-gray-600 mt-0.5">操作人：{s.name}</div>}
                {s.time && <div className="text-xs text-gray-400 mt-0.5">时间：{s.time}</div>}
                {s.remark && <div className="text-xs text-red-500 mt-0.5 whitespace-pre-wrap break-words">{s.remark}</div>}
              </div>
              {s.signature && (
                <div className="flex-shrink-0">
                  <img src={s.signature} alt="签字" className="h-14 object-contain border border-gray-100 rounded-md bg-white p-1 max-w-[140px]" />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepDot({ status }: { status: StepStatus }) {
  const color =
    status === 'done'    ? 'bg-green-500 border-green-500' :
    status === 'current' ? 'bg-blue-500 border-blue-500 animate-pulse' :
    status === 'rejected'? 'bg-red-500 border-red-500' :
                           'bg-white border-gray-300';
  const icon = status === 'done' ? <CheckCircle2 size={12} className="text-white" /> : status === 'rejected' ? <X size={12} className="text-white" /> : null;
  return (
    <div className={`absolute left-0 top-0.5 w-6 h-6 rounded-full border-2 ${color} flex items-center justify-center`}>
      {icon}
    </div>
  );
}

// ============================================================
// 子组件：签字复用工具栏
// ============================================================
function SignatureActionsBar({ onLoadSaved, loadingSavedSig, hasSavedSig }: {
  onLoadSaved: () => void; loadingSavedSig: boolean; hasSavedSig: boolean;
}) {
  return (
    <div className="flex items-center justify-end mb-2">
      <button type="button" onClick={onLoadSaved} disabled={loadingSavedSig || !hasSavedSig}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
        {loadingSavedSig ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
        {loadingSavedSig ? '加载中' : hasSavedSig ? '读取上次签字' : '暂无已保存签字'}
      </button>
    </div>
  );
}

// ============================================================
// 子组件：InfoCard / Row
// ============================================================
function InfoCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm p-4">
      <h2 className="text-sm font-medium text-gray-800 mb-3 flex items-center gap-2">{icon}{title}</h2>
      <div className="space-y-2 text-sm">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-gray-500 flex-shrink-0">{label}</span>
      <span className="text-gray-800 text-right">{value}</span>
    </div>
  );
}

function ActionBox({ icon, title, desc, tone, children }: {
  icon: React.ReactNode; title: string; desc?: string; tone: 'amber' | 'blue' | 'green'; children: React.ReactNode;
}) {
  const toneMap = {
    amber: 'bg-amber-50 text-amber-800 border-amber-200',
    blue:  'bg-blue-50  text-blue-800  border-blue-200',
    green: 'bg-green-50 text-green-800 border-green-200',
  } as const;
  return (
    <div className="bg-white rounded-2xl shadow-sm p-4 space-y-3">
      <div className={`p-3 rounded-xl flex items-start gap-2 border ${toneMap[tone]}`}>
        <span className="mt-0.5">{icon}</span>
        <div>
          <p className="text-sm font-medium">{title}</p>
          {desc && <p className={`text-xs mt-0.5 opacity-80`}>{desc}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

// ============================================================
// 子组件：明细行
// ============================================================
function ItemHeader({ item, bizKey }: { item: any; bizKey: string }) {
  const date = item.date || '';
  const startTime = item.startTime || item.start_time || '';
  const endTime = item.endTime || item.end_time || '';
  const amount = Number(item.amount || 0);
  const timeStr = [date, startTime, endTime ? `-${endTime}` : ''].filter(Boolean).join(' ');

  // 住宿：显示 dateCheckIn → dateCheckOut
  const lodging = bizKey === 'lodging' ? item.extra || {} : null;
  const dateStr = lodging && lodging.dateCheckIn
    ? `${lodging.dateCheckIn} → ${lodging.dateCheckOut || ''}`
    : timeStr;

  return (
    <div className="flex justify-between items-start gap-2">
      <div className="flex-1 min-w-0">
        {dateStr && <p className="text-xs text-gray-500 mb-0.5">{dateStr}</p>}
      </div>
      <span className="text-sm text-gray-700 font-medium whitespace-nowrap">{formatCurrency(amount)}</span>
    </div>
  );
}

function ItemDetails({ item, bizKey, packages, mealTypes, roomTypes, capsules }: {
  item: any; bizKey: string; packages: PackageRow[]; mealTypes: MealTypeRow[]; roomTypes: RoomTypeRow[]; capsules: any[];
}) {
  const pax = Number(item.pax || 0);
  const biz = BIZ_MAP[bizKey] || { label: bizKey, icon: null, color: '#6B7280' };
  const unit: Record<string, string> = { lodging: '间', lunch: '桌', dinner: '桌', meeting: '人' };

  switch (bizKey) {
    case 'checkup':
      return <CheckupDetails item={item} packages={packages} capsules={capsules} pax={pax} bizColor={biz.color} />;
    case 'lunch':
    case 'dinner':
    case 'breakfast':
      return <MealDetails item={item} mealTypes={mealTypes} bizKey={bizKey} pax={pax} bizColor={biz.color} unit={unit} />;
    case 'lodging':
      return <LodgingDetails item={item} roomTypes={roomTypes} pax={pax} bizColor={biz.color} />;
    case 'carpickup':
      return <CarDetails item={item} pax={pax} />;
    case 'meeting':
    case 'wellness':
      return <SessionDetails item={item} bizKey={bizKey} pax={pax} />;
    default:
      return (
        <div className="py-1">
          <p className="text-sm text-gray-700">
            {biz.label}
            {pax > 0 && <span className="text-xs text-gray-400 ml-1.5">· {pax}人</span>}
          </p>
        </div>
      );
  }
}

// --- 体检套餐 + 折扣率（三角色分栏 + 名单默认折叠）---
function CheckupDetails({ item, packages, capsules, pax, bizColor }: {
  item: any; packages: PackageRow[]; capsules: any[]; pax: number; bizColor: string;
}) {
  const [paxOpen, setPaxOpen] = useState(false);
  const extra = item.extra || {};
  const paxList: any[] = extra.paxList || [];

  // 胶囊/套餐索引
  const capsuleByCode: Record<string, any> = {};
  for (const c of capsules || []) capsuleByCode[c.code] = c;
  const capsuleById: Record<string, any> = {};
  for (const c of capsules || []) capsuleById[c.id] = c;
  const pkgByCode: Record<string, PackageRow> = {};
  for (const p of packages || []) pkgByCode[p.code] = p;
  const pkgById: Record<string, PackageRow> = {};
  for (const p of packages || []) pkgById[p.id] = p;

  function paxRole(p: any): 'male' | 'female_married' | 'female_single' {
    if (p.gender === '女' || p.gender === 'F') return p.married ? 'female_married' : 'female_single';
    return 'male';
  }
  function lookupCapsule(pkgIdOrCode: string) {
    return capsuleByCode[pkgIdOrCode] || capsuleById[pkgIdOrCode] || null;
  }
  function lookupPackage(pkgIdOrCode: string): PackageRow | null {
    return pkgById[pkgIdOrCode] || pkgByCode[pkgIdOrCode] || null;
  }
  // 取三角色定价（优先级：pkg.role_plans > cap.role_plans > cap.prices[role] > cap.price 兜底）
  function getRolePricing(pkgIdOrCode: string, role: 'male' | 'female_married' | 'female_single') {
    const cap = lookupCapsule(pkgIdOrCode);
    const pkg = lookupPackage(pkgIdOrCode);
    const pkgRp = pkg?.role_plans?.[role];
    const capRp = cap?.role_plans?.[role];
    const capPrice = cap?.prices?.[role];
    let base = 0, final = 0, rate: number | undefined;
    base = Number(pkgRp?.original_total ?? capRp?.original_total ?? capPrice?.base_price ?? capRp?.base_price ?? cap?.price ?? 0);
    final = Number(pkgRp?.discount_price ?? capRp?.discount_price ?? capPrice?.discount_price ?? 0);
    rate = pkgRp?.discount_rate ?? capRp?.discount_rate ?? capPrice?.discount_rate;
    if (!base && final) base = final;
    if (!final && base) final = base;
    return { base, final, rate };
  }
  // 套餐 ID：订单选中套餐优先，否则名单中第一个非空 package
  const savedPkgId: string = extra.selectedChkPkgId || '';
  const firstPkgFromList: string = savedPkgId || (paxList.find((p: any) => p?.package)?.package || '');
  const firstCap = lookupCapsule(firstPkgFromList);
  const firstPkg = lookupPackage(firstPkgFromList);
  const packageName = friendlyCapsuleName(firstCap) || firstPkg?.name || (firstPkgFromList ? '体检套餐' : '未设置套餐');

  // 角色维度聚合（按订单实际套餐 pricing 取价）
  const roleOrder: Array<'male' | 'female_married' | 'female_single'> = ['male', 'female_married', 'female_single'];
  const paxByRole: Record<string, any[]> = { male: [], female_married: [], female_single: [] };
  const importedCounts: Record<string, number> = { male: 0, female_married: 0, female_single: 0 };
  for (const p of paxList) {
    const r = paxRole(p);
    importedCounts[r] += 1;
    paxByRole[r].push(p);
  }
  // 设定人数（savedCounts）：extra.roleCounts（驼峰/下划线兼容），缺则未设定
  const rawRoleCounts: any = extra.roleCounts || extra.role_counts || null;
  let savedCounts: Record<string, number | undefined> | null = null;
  if (rawRoleCounts) {
    savedCounts = {
      male: Number(rawRoleCounts.male ?? rawRoleCounts.Male),
      female_married: Number(rawRoleCounts.female_married ?? rawRoleCounts.femaleMarried ?? rawRoleCounts.FemaleMarried),
      female_single: Number(rawRoleCounts.female_single ?? rawRoleCounts.femaleSingle ?? rawRoleCounts.FemaleSingle),
    };
  }
  const hasRoleSetting = !!savedCounts && roleOrder.some(k => Number(savedCounts?.[k] || 0) > 0);

  // 每个角色价 & 小计（数量优先设定，否则已导入人数；定价统一按订单套餐取 firstPkgFromList）
  type RoleStat = {
    key: string; label: string;
    setN: number | '-'; importedN: number; remain: number;
    base: number; final: number; rate: number | undefined;
    subtotal: number;
    di: DiscountInfo;       // 折扣徽章：rate优先强制显示
    showDisc: boolean;      // 是否显示折扣行（有徽章则显示）
  };
  const roleStats: RoleStat[] = roleOrder.map(k => {
    const setN: number | '-' = hasRoleSetting ? (Number(savedCounts?.[k] || 0)) : '-';
    const importedN = importedCounts[k] || 0;
    const remain = hasRoleSetting ? Math.max(0, (Number(savedCounts?.[k] || 0)) - importedN) : 0;
    const pr = getRolePricing(firstPkgFromList, k);
    const di = formatDiscountInfo({ discount_rate: pr.rate, final: pr.final, base: pr.base });
    const qty = hasRoleSetting ? (Number(savedCounts?.[k] || 0)) : importedN;
    return {
      key: k,
      label: ROLE_LABEL[k] || k,
      setN, importedN, remain,
      base: pr.base, final: pr.final, rate: pr.rate,
      subtotal: qty * pr.final,
      di,
      showDisc: !!di.label, // 有 rate 就显示（谈判折扣也显示）
    };
  });
  // finalTotal：用于顶部「合计¥X」展示 = 三角色小计求和；兜底名单级
  let finalTotal = 0;
  for (const rs of roleStats) {
    const qty = (rs.setN === '-' ? rs.importedN : Number(rs.setN || 0));
    finalTotal += qty * rs.final;
  }
  if (finalTotal <= 0 && paxList.length > 0) {
    for (const p of paxList) finalTotal += Number((p as any).finalAmount || 0);
  }
  // 整体汇总（原价合计/折后合计/整体折扣/共节省）已移除：顶部右上角已有绿色合计显示

  // 名单逐行：用于折叠展开
  type PaxRow = { name: string; roleLabel: string; packageName: string; base: number; final: number; discount: string; custom: boolean };
  const rows: PaxRow[] = paxList.map((p: any) => {
    const role = paxRole(p);
    const pkgKey = p.package || firstPkgFromList;
    const pr = getRolePricing(pkgKey, role);
    const cap = lookupCapsule(pkgKey);
    const pkg = lookupPackage(pkgKey);
    let pkgName = friendlyCapsuleName(cap) || pkg?.name || '';
    if (!pkgName && p.package) pkgName = '体检套餐';
    let base = Number((p as any).originalAmount || pr.base || 0);
    let final = Number((p as any).finalAmount || pr.final || 0);
    if (!base && final) base = final;
    if (!final && base) final = base;
    const discount = formatDiscount({ final, base });
    return {
      name: p.name || '',
      roleLabel: ROLE_LABEL[role] || (p.gender || '男') + (p.married === true ? '·已婚' : p.married === false ? '·未婚' : ''),
      packageName: pkgName,
      base, final, discount,
      custom: !!(p.customItems && (p.customItems as any[]).length > 0),
    };
  });

  const cardStyle: React.CSSProperties = { borderColor: `${bizColor}25`, background: `${bizColor}08` };

  return (
    <div className="py-1">
      <p className="text-sm text-gray-700">
        体检
        {pax > 0 && <span className="text-xs text-gray-400 ml-1.5">· {pax}人（名单{paxList.length}人）</span>}
      </p>

      <div className={`mt-2 rounded-lg border p-2.5 space-y-3`} style={cardStyle}>
        {/* 头部：套餐名 + 合计 */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-white border" style={{ borderColor: `${bizColor}55`, color: bizColor }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M8 2v4M16 2v4M3 10h18" /></svg>
              体检套餐
            </span>
            <span className="text-sm font-semibold text-gray-800 truncate">{packageName}</span>
          </div>
          <span className="text-xs font-mono font-semibold text-green-700 whitespace-nowrap">合计 {formatCurrency(finalTotal)}</span>
        </div>

        {/* 三角色分栏：第一行=角色名左+折后价/人右；第二行=折扣徽章；等高底对齐 */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] items-stretch">
          {roleStats.map(rs => {
            const hasData = rs.setN !== 0 || rs.importedN > 0;
            return (
              <div key={rs.key} className="bg-white border rounded p-2 flex flex-col justify-between" style={{ borderColor: `${bizColor}22` }}>
                {/* 卡头第一行：角色名（左，min-h 统一）+ 折后价/人（右） */}
                <div className="flex items-center justify-between mb-1 min-h-[1.3em]">
                  <span className="text-gray-700 font-medium whitespace-nowrap">{rs.label}</span>
                  {rs.final > 0 ? (
                    <span className="text-gray-800 font-bold font-mono flex-shrink-0 whitespace-nowrap">
                      {formatCurrency(rs.final)}<span className="text-[10px] text-gray-400 font-normal font-sans">/人</span>
                    </span>
                  ) : hasData ? (
                    <span className="text-gray-300 text-[10px] font-mono flex-shrink-0 whitespace-nowrap">—/人</span>
                  ) : null}
                </div>
                {/* 卡头第二行：只放折扣徽章（有折扣率时显示左对齐，无则占位）*/}
                <div className="mb-1.5 min-h-[1.3em] flex items-center">
                  {rs.di.label ? (
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${
                      rs.di.nominalOnly
                        ? 'bg-sky-50 text-sky-600 border border-sky-100'   // 谈判折扣（蓝色提示）
                        : 'bg-red-50 text-red-500'                           // 实际有差（红色强提示）
                    }`}>
                      {rs.di.label}{rs.di.nominalOnly ? '（谈）' : ''}
                    </span>
                  ) : null}
                </div>
                {/* 卡体：设定/已导/待绑 或 0人占位 */}
                <div className="flex-1 flex flex-col justify-between gap-1.5">
                  {!hasData ? (
                    <div className="text-gray-300 text-center py-2 border border-dashed rounded" style={{ borderColor: '#E5E7EB' }}>
                      0人 · 暂无设定
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-3 gap-1 text-center font-mono">
                        <div className="bg-gray-50 rounded px-1 py-0.5">
                          <div className="text-[9px] text-gray-400">设定</div>
                          <div className="text-gray-800">{rs.setN === '-' ? '-' : rs.setN}</div>
                        </div>
                        <div className="bg-gray-50 rounded px-1 py-0.5">
                          <div className="text-[9px] text-gray-400">已导</div>
                          <div className="text-gray-800">{rs.importedN}</div>
                        </div>
                        <div className="rounded px-1 py-0.5" style={{ background: rs.remain > 0 ? 'rgba(245,158,11,.1)' : '#F9FAFB' }}>
                          <div className="text-[9px]" style={{ color: rs.remain > 0 ? '#F59E0B' : '#9CA3AF' }}>待绑</div>
                          <div style={{ color: rs.remain > 0 ? '#B45309' : '#1F2937' }}>{rs.remain}</div>
                        </div>
                      </div>
                      <div className="text-right text-green-700 font-mono font-semibold">
                        小计 {formatCurrency(rs.subtotal)}
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* 名单：默认折叠，点击展开（不再在上方渲染横滚姓名条） */}
        {rows.length > 0 && (
          <div className="border rounded" style={{ borderColor: `${bizColor}22` }}>
            <button
              type="button"
              onClick={() => setPaxOpen(v => !v)}
              className="w-full flex items-center justify-between px-2 py-1.5 text-[12px] text-gray-600 hover:bg-gray-50/60 rounded"
            >
              <span className="flex items-center gap-1">
                <span style={{ color: bizColor }}>●</span> 名单 {rows.length} 人
              </span>
              <span className="flex items-center gap-1 text-gray-400">
                {paxOpen ? '收起' : '展开'}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  style={{ transform: paxOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </span>
            </button>
            {paxOpen && (
              <div className="px-2 pb-2 space-y-2 border-t" style={{ borderColor: `${bizColor}22` }}>
                {rows.map((r, i) => (
                  <div key={i} className="flex items-start justify-between gap-2 pt-2 text-xs">
                    <div className="flex-1 min-w-0">
                      <div className="text-gray-700 font-medium">
                        {r.name || <span className="text-gray-400">未填姓名</span>}
                        {r.custom && <span className="ml-1.5 px-1 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px]">定制</span>}
                      </div>
                      <div className="text-gray-500 mt-0.5">
                        <span>{r.roleLabel}</span>
                        {r.packageName && <> · <span className="text-gray-600">{r.packageName}</span></>}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      {r.base > 0 && r.final < r.base ? (
                        <div className="text-gray-400 line-through text-[11px]">{formatCurrency(r.base)}</div>
                      ) : null}
                      <div className="flex items-baseline gap-1 justify-end">
                        <span className="text-gray-800 font-semibold">{formatCurrency(r.final)}</span>
                        {r.discount && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-500">{r.discount}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// --- 用餐：餐标 ---
function MealDetails({ item, mealTypes, bizKey, pax, bizColor, unit }: {
  item: any; mealTypes: MealTypeRow[]; bizKey: string; pax: number; bizColor: string; unit: Record<string, string>;
}) {
  const extra = item.extra || {};
  const sessions: any[] = extra.sessions || [];
  const mealByCode: Record<string, any> = {};
  const mealById: Record<string, any> = {};
  for (const m of mealTypes || []) {
    if (m.code) mealByCode[m.code] = m;
    if (m.id)   mealById[String(m.id)] = m;
  }
  const lookupMeal = (codeOrId: any) => mealByCode[codeOrId] || mealById[String(codeOrId)] || null;

  // header 统计
  const byTableSess = sessions.filter(s => lookupMeal(s.mealType)?.pricing_mode === 'per_table');
  const byPersonSess = sessions.filter(s => lookupMeal(s.mealType)?.pricing_mode === 'per_person');
  const tableCount = byTableSess.reduce((s, x) => s + Number(x.tables || 0), 0);
  const personCount = byPersonSess.reduce((s, x) => s + Number(x.pax || 0), 0);
  const headerSummary = [
    tableCount > 0 ? `桌餐${tableCount}桌` : null,
    personCount > 0 ? `按人${personCount}人` : null,
    pax > 0 && sessions.length === 0 ? `共${pax}人` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="py-1">
      <p className="text-sm text-gray-700">
        {BIZ_MAP[bizKey]?.label || bizKey}
        {headerSummary && <span className="text-xs text-gray-400 ml-1.5">· {headerSummary}</span>}
      </p>
      {sessions.length > 0 ? (
        <div className={`mt-2 rounded-lg border p-2.5 space-y-2.5`} style={{ borderColor: `${bizColor}25`, background: `${bizColor}08` }}>
          {sessions.map((s, i) => {
            const mt = lookupMeal(s.mealType);
            const pricingMode = (s.pricingMode || mt?.pricing_mode || 'per_table') as 'per_table' | 'per_person';
            const unitPrice = Number(s.unitPrice ?? mt?.unit_price ?? 0);
            const tables = Number(s.tables || 0);
            const perTable = Number(s.seatsPerTable || s.per_table || mt?.default_per_table || 0);
            const sessPax = Number(s.pax || 0);
            const sessDate = s.date || '';
            const sessTime = s.time || s.startTime || '';
            const qtyText = pricingMode === 'per_table'
              ? `${tables || '-'}桌 · 每桌${perTable || '-'}人`
              : `${sessPax || '-'}人`;
            const subtotal = pricingMode === 'per_table'
              ? unitPrice * (tables || 0)
              : unitPrice * (sessPax || 0);
            return (
              <div key={i} className="text-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {mt?.name
                      ? <span className="px-1.5 py-0.5 rounded text-[11px] font-medium" style={{ color: bizColor, background: `${bizColor}15` }}>{mt.name}</span>
                      : s.mealType && <span className="text-gray-400 text-[11px]">[{s.mealType}]</span>}
                    <span className="text-gray-500">
                      {pricingMode === 'per_table' ? '按桌' : '按人'}
                    </span>
                    <span className="text-gray-700 font-medium">{formatCurrency(unitPrice)}/{pricingMode === 'per_table' ? '桌' : '人'}</span>
                  </div>
                  {subtotal > 0 && <span className="text-gray-700 font-medium">小计 {formatCurrency(subtotal)}</span>}
                </div>
                <div className="mt-1 text-gray-600 flex items-center gap-3 flex-wrap">
                  <span className="text-gray-500">{[sessDate, sessTime].filter(Boolean).join(' ') || '时间未设'}</span>
                  <span>{qtyText}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-xs text-gray-400 mt-0.5">（无场次明细）共{pax}人</div>
      )}
    </div>
  );
}

// --- 住宿：双口径单价（议价优先）---
function LodgingDetails({ item, roomTypes, pax, bizColor }: {
  item: any; roomTypes: RoomTypeRow[]; pax: number; bizColor: string;
}) {
  const extra = item.extra || {};
  const lodgingTypeCode = extra.lodgingType || 'standard';
  const pricingMode: 'per_room' | 'per_person' = extra.pricingMode || extra.pricing_mode || 'per_room';
  const nights = Number(extra.nights || 0) || 1;
  const rooms = Number(extra.rooms || (pax ? Math.max(1, Math.ceil(pax / 2)) : 0)) || 1;
  const persons = Number(extra.persons || pax || 0) || 1;
  // 议价：PC 端逻辑一致——'customPrice' in extra 且非 null/undefined 即生效（对齐 BookingBoard L1307）
  const hasCustom = 'customPrice' in extra && extra.customPrice !== undefined && extra.customPrice !== null && extra.customPrice !== '';
  const customPrice = hasCustom ? Number(extra.customPrice) : 0;

  // 反查房型：优先按 code，再按 name 兜底
  let rt = (roomTypes || []).find(r => String(r.code) === String(lodgingTypeCode));
  if (!rt) rt = (roomTypes || []).find(r => String(r.name) === String(lodgingTypeCode));
  const typeName = rt?.name || (lodgingTypeCode === 'standard' ? '标准间' : lodgingTypeCode === 'bigbed' ? '大床房' : lodgingTypeCode === 'suite' ? '套房' : lodgingTypeCode === 'vipsuite' ? 'VIP套房' : lodgingTypeCode);

  // 标准双口径价（房型配置价，参考价永远走这个）
  const stdPerRoom = Number(rt?.price_per_room || (rt as any).pricePerRoom || rt?.price || 0);
  const stdPerPerson = Number(rt?.price_per_person || (rt as any).pricePerPerson || 0);
  // 主口径标准价（对齐 BookingBoard L1302-1306）
  const displayStd = pricingMode === 'per_person'
    ? (stdPerPerson > 0 ? stdPerPerson : (rt?.pricing_mode === 'per_person' ? Number(rt?.price || 0) : 0))
    : (stdPerRoom > 0 ? stdPerRoom : Number(rt?.price || 0));
  // 主口径显示价：议价覆盖（对齐 BookingBoard L1308）
  const mainUnitPrice = hasCustom ? customPrice : displayStd;
  const refPerRoom = stdPerRoom;
  const refPerPerson = stdPerPerson;

  const mainQty = pricingMode === 'per_room' ? rooms : persons;
  const mainUnit = pricingMode === 'per_room' ? '间' : '人';
  const mainSubtotal = mainUnitPrice * mainQty * nights;

  return (
    <div className="py-1">
      <div className="text-sm text-gray-700 flex items-center gap-2 flex-wrap">
        <span className="font-medium">{typeName}</span>
        {hasCustom && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">议价</span>}
        <span className="text-xs text-gray-400">· {nights}晚</span>
      </div>
      <div className={`mt-2 rounded-lg border p-2.5 space-y-2`} style={{ borderColor: `${bizColor}25`, background: `${bizColor}08` }}>
        {/* 主单价 */}
        <div className="flex items-center justify-between text-sm">
          <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${pricingMode === 'per_room' ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'}`}>
            此单{pricingMode === 'per_room' ? '按间计价' : '按人计价'}
          </span>
          <span className="text-gray-800 font-bold">
            {formatCurrency(mainUnitPrice)}<span className="text-xs text-gray-400 font-normal">/{mainUnit}/晚</span>
          </span>
        </div>
        {/* 参考单价（另一口径）：永远显示房型标准价，不受议价影响 */}
        {pricingMode === 'per_room' && refPerPerson > 0 ? (
          <div className="text-[11px] text-gray-400 flex items-center justify-between">
            <span>参考 · 按人单价</span>
            <span>{formatCurrency(refPerPerson)}<span className="opacity-60">/人/晚（此单按间）</span></span>
          </div>
        ) : null}
        {pricingMode === 'per_person' && refPerRoom > 0 ? (
          <div className="text-[11px] text-gray-400 flex items-center justify-between">
            <span>参考 · 按间单价</span>
            <span>{formatCurrency(refPerRoom)}<span className="opacity-60">/间/晚（此单按人）</span></span>
          </div>
        ) : null}
        {/* 合计 */}
        <div className="pt-2 mt-1 border-t border-dashed" style={{ borderColor: `${bizColor}25` }}>
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>数量</span>
            <span>
              {pricingMode === 'per_room'
                ? `${rooms}间 × ${nights}晚 × ${formatCurrency(mainUnitPrice)}/间/晚`
                : `${persons}人 × ${nights}晚 × ${formatCurrency(mainUnitPrice)}/人/晚`}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm mt-1">
            <span className="text-gray-700 font-medium">小计</span>
            <span className="text-gray-800 font-bold">{formatCurrency(mainSubtotal)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- 用车：多客户（对齐 PC extra.carpickup 新结构）---
function CarDetails({ item, pax }: { item: any; pax: number }) {
  const extra = item.extra || {};
  // 数据源：先 carpickup 新结构，fallback 旧 customers 平铺数组
  const carpickup: any = extra.carpickup || null;
  const newCustomers: any[] = carpickup?.customers || [];
  const oldCustomers: any[] = extra.customers || [];

  const hasNew = !!carpickup && Array.isArray(newCustomers) && newCustomers.length > 0;
  const shareRide = carpickup?.shareRide === true;
  const hasCustom = carpickup && carpickup.customAmount != null && carpickup.customAmount !== ''
    && !isNaN(Number(carpickup.customAmount));
  const perCustomer = Number(carpickup?.pricePerCustomer || 0);
  const customAmt = hasCustom ? Number(carpickup.customAmount) : 0;

  // 订单列表项 item.amount 为该明细总额（H5 ItemHeader 右侧已显示）
  // 客户总数 & 人数
  const customerCount = hasNew ? newCustomers.length : oldCustomers.length;
  const totalPax = hasNew
    ? newCustomers.reduce((s: number, c: any) => s + Number(c.paxCount || 0), 0)
    : oldCustomers.reduce((s: number, c: any) => s + Number(c.paxCount || 0), 0);
  const carRemark = carpickup?.remark || extra.remark || '';

  return (
    <div className="py-1">
      {/* 概要条：拼车/专车 + 客户数 + 单价/客户 + 议价覆盖 + 总价 */}
      <div className="flex flex-wrap items-center gap-2 text-xs mb-2">
        <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${
          shareRide ? 'bg-teal-50 text-teal-700 border border-teal-100' : 'bg-indigo-50 text-indigo-700 border border-indigo-100'
        }`}>
          {shareRide ? '拼车' : '专车'}
        </span>
        <span className="text-gray-600">{customerCount} 位客户 · 共 {totalPax || pax || 0} 人</span>
        {perCustomer > 0 && (
          <span className="text-gray-700 font-mono">{formatCurrency(perCustomer)}<span className="text-[10px] text-gray-400 font-sans">/客户</span></span>
        )}
        {hasCustom && (
          <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-700 text-[11px] border border-amber-100 font-medium">
            议价覆盖 {formatCurrency(customAmt)}
          </span>
        )}
        <span className="ml-auto text-green-700 font-bold font-mono text-sm">{formatCurrency(hasCustom ? customAmt : (item.amount || 0))}</span>
      </div>

      {/* 每位客户：接 + 送 两列卡片 */}
      {customerCount > 0 ? (
        <div className="space-y-3">
          {(hasNew ? newCustomers : oldCustomers).map((c: any, i: number) => (
            <div key={i} className="rounded-lg border border-gray-100 bg-gray-50 p-2.5">
              {/* 客户头：联系人 + 联系电话 · X人 */}
              <div className="flex items-center justify-between mb-2 text-xs">
                <div className="font-semibold text-gray-800">
                  客户 {i + 1}: <span>{c.customerName || c.name || c.contactName || '(未填客户名)'}</span>
                </div>
                <div className="text-gray-500 flex items-center gap-2 flex-shrink-0 ml-2">
                  {c.contactPhone && (
                    <a href={`tel:${c.contactPhone}`} className="text-blue-600 hover:underline flex items-center gap-1">
                      <Phone size={11} />{c.contactPhone}
                    </a>
                  )}
                  <span className="text-gray-400">·</span>
                  <span className="text-gray-600 font-mono">{Number(c.paxCount || 0)}人</span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {hasNew ? (
                  <>
                    {/* 接 — lime-50 */}
                    <div className="rounded border border-lime-100 bg-lime-50 p-2">
                      <div className="text-[10px] uppercase tracking-wide text-lime-700 mb-1">接 · Pickup</div>
                      <div className="text-gray-800 font-medium mb-0.5">
                        {[c.pickupDate, c.pickupTime].filter(Boolean).join(' ') || <span className="text-gray-400">接车时间未设</span>}
                      </div>
                      {c.pickupRoute ? (
                        <div className="text-gray-600 break-words whitespace-pre-wrap">📍 {c.pickupRoute}</div>
                      ) : <div className="text-gray-300">📍 未填写接车路线</div>}
                    </div>
                    {/* 送 — rose-50 */}
                    <div className="rounded border border-rose-100 bg-rose-50 p-2">
                      <div className="text-[10px] uppercase tracking-wide text-rose-700 mb-1">送 · Dropoff</div>
                      <div className="text-gray-800 font-medium mb-0.5">
                        {[c.dropoffDate, c.dropoffTime].filter(Boolean).join(' ') || <span className="text-gray-400">送车时间未设</span>}
                      </div>
                      {c.dropoffRoute ? (
                        <div className="text-gray-600 break-words whitespace-pre-wrap">📍 {c.dropoffRoute}</div>
                      ) : <div className="text-gray-300">📍 未填写送车路线</div>}
                    </div>
                  </>
                ) : (
                  <>
                    {/* 旧 customers 兼容：起址 -> 到址 两列 */}
                    <div className="rounded border border-lime-100 bg-lime-50 p-2">
                      <div className="text-[10px] uppercase tracking-wide text-lime-700 mb-1">起 · From</div>
                      <div className="text-gray-800 font-medium mb-0.5">
                        {[c.date, c.time || c.pickupTime].filter(Boolean).join(' ') || <span className="text-gray-400">时间未设</span>}
                      </div>
                      {c.fromAddr || c.pickupRoute ? (
                        <div className="text-gray-600 break-words">📍 {c.fromAddr || c.pickupRoute}</div>
                      ) : <div className="text-gray-300">📍 未填写出发地址</div>}
                    </div>
                    <div className="rounded border border-rose-100 bg-rose-50 p-2">
                      <div className="text-[10px] uppercase tracking-wide text-rose-700 mb-1">到 · To</div>
                      <div className="text-gray-800 font-medium mb-0.5">
                        {[c.dropoffDate, c.dropoffTime].filter(Boolean).join(' ') || <span className="text-gray-400">—</span>}
                      </div>
                      {c.toAddr || c.dropoffRoute ? (
                        <div className="text-gray-600 break-words">📍 {c.toAddr || c.dropoffRoute}</div>
                      ) : <div className="text-gray-300">📍 未填写目的地</div>}
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center text-gray-400 text-xs py-2 border border-dashed rounded">暂无客户明细</div>
      )}

      {/* 备注 */}
      {carRemark && (
        <div className="mt-3 pt-2 border-t border-dashed border-gray-200 text-xs text-gray-500">
          <span className="text-gray-400">用车备注：</span>
          <span className="whitespace-pre-wrap break-words text-gray-700">{carRemark}</span>
        </div>
      )}
    </div>
  );
}

// --- 会务/康乐：多场次 ---
function SessionDetails({ item, bizKey, pax }: { item: any; bizKey: string; pax: number }) {
  const extra = item.extra || {};
  const sessions: any[] = extra.sessions || [];
  return (
    <div className="py-1">
      <p className="text-sm text-gray-700">
        {BIZ_MAP[bizKey]?.label || bizKey}
        {pax > 0 && <span className="text-xs text-gray-400 ml-1.5">· 共{pax}人</span>}
        {sessions.length > 0 && <span className="text-xs text-gray-400 ml-1.5">· {sessions.length}场</span>}
      </p>
      {sessions.length > 0 && (
        <div className="mt-2 rounded-lg border border-gray-100 bg-gray-50 p-2.5 space-y-1.5">
          {sessions.map((s, i) => (
            <div key={i} className="text-xs text-gray-600 flex items-start gap-2">
              <span className="text-gray-400 flex-shrink-0">{i + 1}.</span>
              <div className="flex-1">
                <div>
                  {[s.date, (s.time || s.startTime || '')].filter(Boolean).join(' ') || '时间未设'}
                  {s.pax ? <span className="text-gray-400 mx-1.5">· {s.pax}人</span> : null}
                  {s.tables ? <span className="text-gray-400 mx-1.5">· {s.tables}桌</span> : null}
                  {s.meetingHall?.name ? <span className="text-gray-400 mx-1.5">· 场地：{s.meetingHall.name}</span> : s.hall ? <span className="text-gray-400 mx-1.5">· 场地：{s.hall}</span> : null}
                  {s.wellnessType?.name ? <span className="text-gray-400 mx-1.5">· 项目：{s.wellnessType.name}</span> : null}
                  {s.sessionType ? <span className="text-gray-400 mx-1.5">· {s.sessionType === 'half_am' ? '半天（上午）' : s.sessionType === 'half_pm' ? '半天（下午）' : s.sessionType === 'full' ? '全天' : s.sessionType}</span> : null}
                </div>
                {s.remark && <div className="text-gray-400 mt-0.5">备注：{s.remark}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) { return <div className="min-h-screen bg-gray-50">{children}</div>; }

function CenterCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-lg p-6 max-w-md w-full text-center">{children}</div>
    </div>
  );
}
