import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ClipboardCheck, Search, Save, Send, AlertCircle, CheckCircle,
  ArrowLeft, Package, Loader2, Filter, X, TrendingUp, TrendingDown, Minus,
  FileDown, RotateCcw,
} from 'lucide-react';

// ================================================
// 类型定义
// ================================================
type StockTakeStatus = 'draft' | 'submitted' | 'reviewing' | 'returned' | 'completed';

interface ReviewSample {
  item_detail_id: string;
  item_id?: string;
  item_name: string;
  spec?: string | null;
  unit?: string | null;
  actual_quantity: number | null;
  verify_quantity: number | string | null;
  matched?: boolean | null;
}

interface StockTakeItem {
  id: string;
  stock_take_id: string;
  item_id: string;
  item_name: string;
  category_name: string | null;
  spec: string | null;
  unit: string | null;
  system_quantity: number;
  actual_quantity: number | null;
  difference: number;
  unit_price: number;
  system_value: number;
  actual_value: number;
  is_sampled?: number;
  remark?: string | null;
}

interface StockTakeMeta {
  id: string;
  take_no: string;
  warehouse_id: string;
  warehouse_name: string;
  period_month: string;
  status: StockTakeStatus;
  remark: string | null;
  manager_userid?: string;
  confirmer_userid?: string;
  items: StockTakeItem[];
  stats: { total: number; filled: number; diff: number };
  take_type: 'monthly' | 'annual';
  role: 'operator' | 'reviewer';
  operator_signature?: string | null;
  reviewer_signature?: string | null;
  review_sample?: ReviewSample[] | null;
}

// ================================================
// 常量
// ================================================
const BASE_URL = import.meta.env.VITE_API_URL || '/api';

const STATUS_CONFIG: Record<StockTakeStatus, { label: string; badge: string; dot: string }> = {
  draft:     { label: '草稿',   badge: 'bg-orange-100 text-orange-700', dot: 'bg-orange-500' },
  returned:  { label: '已退回', badge: 'bg-red-100 text-red-700',       dot: 'bg-red-500' },
  submitted: { label: '已提交', badge: 'bg-blue-100 text-blue-700',     dot: 'bg-blue-500' },
  reviewing: { label: '复核中', badge: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500' },
  completed: { label: '已完成', badge: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
};

// ================================================
// 手写签名画布
// ================================================
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

// ================================================
// 工具函数
// ================================================
function formatCurrency(amount: number): string {
  const num = Number(amount) || 0;
  return `¥${num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatNumber(v: number): string {
  const n = Number(v) || 0;
  return Number.isInteger(n) ? String(n) : String(n);
}

function diffColor(v: number): string {
  if (v > 0) return 'text-emerald-600';
  if (v < 0) return 'text-red-600';
  return 'text-gray-400';
}

/** 从 remark 中解析 [退回原因] 后面的内容 */
function parseReturnReason(remark: string | null | undefined): string | null {
  if (!remark) return null;
  const m = String(remark).match(/\[退回原因\]([\s\S]*)/);
  return m ? m[1].trim() : null;
}

// ================================================
// 主组件
// ================================================
export default function StockTakeOperate() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || searchParams.get('r_token') || '';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [meta, setMeta] = useState<StockTakeMeta | null>(null);

  // 编辑态
  const [editItems, setEditItems] = useState<StockTakeItem[]>([]);
  const [modifiedIds, setModifiedIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);

  // 签名
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  // 复核抽样
  const [reviewSamples, setReviewSamples] = useState<ReviewSample[]>([]);
  const [returnReason, setReturnReason] = useState('');
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  // 筛选
  const [keyword, setKeyword] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [onlyDiff, setOnlyDiff] = useState(false);

  // 提示
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  // 3秒后清除提示
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  // ---- 拉取盘点单信息 ----
  const fetchMeta = useCallback(async () => {
    if (!token) {
      setError('缺少访问token，请通过企微盘点通知卡片进入');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${BASE_URL}/stock-takes/h5/meta?token=${encodeURIComponent(token)}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || '获取盘点单失败');
      }
      setMeta(data);
      setEditItems(data.items || []);
      setModifiedIds(new Set());
      // 保存签名
      if (data.role === 'operator' && data.operator_signature) {
        setSavedSignature(data.operator_signature);
      }
      if (data.role === 'reviewer' && data.reviewer_signature) {
        setSavedSignature(data.reviewer_signature);
      }
      // 抽样
      if (data.review_sample && Array.isArray(data.review_sample)) {
        setReviewSamples(data.review_sample);
      }
    } catch (err: any) {
      setError(err?.message || '获取盘点单失败');
      setMeta(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  // ---- 派生数据 ----
  const editable = meta
    ? meta.role === 'operator'
      ? ['draft', 'returned'].includes(meta.status)
      : false
    : false;
  const canReview = meta
    ? meta.role === 'reviewer' && ['submitted', 'reviewing'].includes(meta.status)
    : false;

  useEffect(() => {
    fetchMeta();
  }, [fetchMeta]);

  // 自动保存：每3分钟、页面失焦时保存
  useEffect(() => {
    if (!meta || !editable) return;
    const interval = setInterval(() => {
      if (modifiedIds.size > 0) handleSave(true);
    }, 3 * 60 * 1000);
    const handleBlur = () => {
      if (modifiedIds.size > 0) handleSave(true);
    };
    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') handleBlur();
    });
    return () => {
      clearInterval(interval);
      window.removeEventListener('blur', handleBlur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, editable, modifiedIds]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    editItems.forEach((it) => { if (it.category_name) set.add(it.category_name); });
    return Array.from(set).sort();
  }, [editItems]);

  const filteredItems = useMemo(() => {
    return editItems.filter((it) => {
      if (catFilter && it.category_name !== catFilter) return false;
      if (keyword) {
        const kw = keyword.toLowerCase();
        if (!`${it.item_name}`.toLowerCase().includes(kw) && !(it.spec || '').toLowerCase().includes(kw)) {
          return false;
        }
      }
      if (onlyDiff) {
        const actual = it.actual_quantity;
        const diff = actual !== null ? actual - Number(it.system_quantity) : 0;
        if (diff === 0) return false;
      }
      return true;
    });
  }, [editItems, catFilter, keyword, onlyDiff]);

  const summary = useMemo(() => {
    let filled = 0;
    let diffCount = 0;
    let sysValue = 0;
    let actualValue = 0;
    editItems.forEach((it) => {
      sysValue += Number(it.system_value) || 0;
      if (it.actual_quantity !== null) {
        filled += 1;
        const diff = Number(it.actual_quantity) - Number(it.system_quantity);
        const av = Number(it.actual_quantity) * Number(it.unit_price);
        actualValue += av;
        if (diff !== 0) diffCount += 1;
      } else {
        actualValue += Number(it.system_value) || 0;
      }
    });
    return {
      total: editItems.length,
      filled,
      unfilled: editItems.length - filled,
      diffCount,
      sysValue,
      actualValue,
      diffValue: actualValue - sysValue,
    };
  }, [editItems]);

  // ---- 更新明细（实时重算差异/价值） ----
  const updateItem = (id: string, patch: Partial<StockTakeItem>) => {
    setEditItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        const next = { ...it, ...patch };
        if (patch.actual_quantity !== undefined) {
          const aq = next.actual_quantity;
          next.difference = aq !== null ? aq - Number(next.system_quantity) : 0;
          next.actual_value = aq !== null ? aq * Number(next.unit_price) : 0;
        }
        return next;
      })
    );
    setModifiedIds((prev) => new Set(prev).add(id));
  };

  // ---- 全部实盘=系统 ----
  const fillAllWithSystem = () => {
    if (!editable) return;
    const newModified = new Set(modifiedIds);
    setEditItems((prev) =>
      prev.map((it) => {
        if (it.actual_quantity !== null) return it;
        newModified.add(it.id);
        return {
          ...it,
          actual_quantity: Number(it.system_quantity),
          difference: 0,
          actual_value: Number(it.system_value),
        };
      })
    );
    setModifiedIds(newModified);
    setToast({ type: 'success', msg: '已将未录入项填为系统数量' });
  };

  // ---- 保存（仅提交修改过的 items） ----
  const handleSave = async (silent = false): Promise<boolean> => {
    if (!token) return false;
    if (modifiedIds.size === 0) {
      if (!silent) setToast({ type: 'success', msg: '没有需要保存的修改' });
      return true;
    }
    setSaving(true);
    try {
      const payload = editItems
        .filter((it) => modifiedIds.has(it.id))
        .map((it) => ({
          id: it.id,
          actual_quantity: it.actual_quantity,
          remark: it.remark || null,
          system_quantity: it.system_quantity,
          unit_price: it.unit_price,
        }));
      const res = await fetch(`${BASE_URL}/stock-takes/h5/save?token=${encodeURIComponent(token)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || '保存失败');
      setModifiedIds(new Set());
      if (!silent) setToast({ type: 'success', msg: '保存成功' });
      return true;
    } catch (err: any) {
      setToast({ type: 'error', msg: err?.message || '保存失败' });
      return false;
    } finally {
      setSaving(false);
    }
  };

  // ---- 提交复核（先保存再提交） ----
  const handleSubmit = async () => {
    if (!token) return;
    if (summary.unfilled > 0) {
      setToast({ type: 'error', msg: `还有 ${summary.unfilled} 项物资未录入实盘数量，请先录入或点击「全部实盘=系统」` });
      return;
    }
    const sigToSend = signatureData || savedSignature;
    if (!sigToSend) {
      setToast({ type: 'error', msg: '请先手写签名后再提交' });
      return;
    }
    setSubmitting(true);
    try {
      const saved = await handleSave(true);
      if (!saved) { setSubmitting(false); return; }
      const res = await fetch(`${BASE_URL}/stock-takes/h5/submit?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature_data: sigToSend }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || '提交失败');
      setJustSubmitted(true);
    } catch (err: any) {
      setToast({ type: 'error', msg: err?.message || '提交失败' });
    } finally {
      setSubmitting(false);
    }
  };

  // ---- 修改抽样核验数量 ----
  const updateSample = (itemDetailId: string, verifyQty: number | null) => {
    setReviewSamples(prev => prev.map(s => s.item_detail_id === itemDetailId ? { ...s, verify_quantity: verifyQty, matched: null } : s));
  };

  // ---- 提交复核 ----
  const handleReview = async (action: 'pass' | 'return') => {
    if (!token) return;
    if (action === 'pass') {
      const allFilled = reviewSamples.every(s => s.verify_quantity !== null && s.verify_quantity !== '');
      if (!allFilled) {
        setToast({ type: 'error', msg: '请先填完所有抽样核验数量' });
        return;
      }
      const sigToSend = signatureData || savedSignature;
      if (!sigToSend) {
        setToast({ type: 'error', msg: '请先手写签名后再通过复核' });
        return;
      }
    } else {
      if (!returnReason.trim()) {
        setToast({ type: 'error', msg: '请填写退回原因' });
        return;
      }
    }
    setReviewing(true);
    try {
      const res = await fetch(`${BASE_URL}/stock-takes/h5/review?r_token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          samples: reviewSamples.map(s => ({ item_detail_id: s.item_detail_id, verify_quantity: s.verify_quantity })),
          return_reason: action === 'return' ? returnReason.trim() : undefined,
          signature_data: action === 'pass' ? (signatureData || savedSignature) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || '提交复核失败');
      setShowReturnModal(false);
      if (action === 'pass') {
        setToast({ type: 'success', msg: '✅ 复核通过，盘点已完成' });
      } else {
        setToast({ type: 'success', msg: '已退回，将通知盘点人修改' });
      }
      setTimeout(() => fetchMeta(), 600);
    } catch (err: any) {
      setToast({ type: 'error', msg: err?.message || '提交复核失败' });
    } finally {
      setReviewing(false);
    }
  };

  // ---- 导出PDF ----
  const handleExportPdf = async () => {
    if (!meta?.id) return;
    setLoading(true);
    try {
      const token2 = localStorage.getItem('auth.token');
      const url = `${BASE_URL}/stock-takes/${meta.id}/report-pdf${token2 ? `?token=${encodeURIComponent(token2)}` : ''}`;
      window.open(url, '_blank');
    } catch (err: any) {
      setToast({ type: 'error', msg: err?.message || '导出失败' });
    } finally {
      setLoading(false);
    }
  };

  // ================================================
  // 渲染：加载状态
  // ================================================
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-6 text-gray-500">
        <Loader2 size={40} className="animate-spin text-primary-500 mb-4" />
        <p className="text-base">正在加载盘点单...</p>
      </div>
    );
  }

  // ================================================
  // 渲染：错误状态
  // ================================================
  if (error || !meta) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-6 py-10">
        <div className="bg-white rounded-2xl shadow-sm p-8 max-w-sm w-full text-center">
          <div className="w-16 h-16 mx-auto rounded-full bg-red-50 flex items-center justify-center mb-4">
            <AlertCircle size={32} className="text-red-500" />
          </div>
          <h2 className="text-lg font-semibold text-gray-800 mb-2">无法打开盘点单</h2>
          <p className="text-sm text-gray-500 leading-relaxed mb-6">
            {error || '盘点单不存在或访问链接无效'}
          </p>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
            请联系管理员重新发送盘点通知
          </div>
        </div>
      </div>
    );
  }

  // ================================================
  // 渲染：提交成功页面
  // ================================================
  if (justSubmitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-6 py-10">
        <div className="bg-white rounded-2xl shadow-sm p-8 max-w-sm w-full text-center">
          <div className="w-20 h-20 mx-auto rounded-full bg-emerald-50 flex items-center justify-center mb-5">
            <CheckCircle size={44} className="text-emerald-500" />
          </div>
          <h2 className="text-xl font-semibold text-gray-800 mb-2">已提交，等待财务复核</h2>
          <p className="text-sm text-gray-500 leading-relaxed mb-2">
            盘点单 <span className="font-mono text-gray-700">{meta.take_no}</span>
          </p>
          <p className="text-sm text-gray-500 leading-relaxed mb-6">
            财务复核通过后将完成盘点，如被退回可在此重新编辑提交。
          </p>
          <button
            onClick={fetchMeta}
            className="w-full bg-primary-600 hover:bg-primary-700 text-white text-base font-medium py-3 rounded-xl flex items-center justify-center gap-2"
          >
            <ArrowLeft size={18} /> 查看盘点单
          </button>
        </div>
      </div>
    );
  }

  const statusCfg = STATUS_CONFIG[meta.status] || STATUS_CONFIG.draft;
  const parsedReturnReason = parseReturnReason(meta.remark);

  // 状态提示横幅
  const statusBanner = (() => {
    switch (meta.status) {
      case 'submitted':
        return { icon: <CheckCircle size={18} />, color: 'bg-blue-50 border-blue-200 text-blue-700', text: '已提交，等待财务复核' };
      case 'reviewing':
        return { icon: <Loader2 size={18} className="animate-spin" />, color: 'bg-purple-50 border-purple-200 text-purple-700', text: '财务复核中，请耐心等待' };
      case 'completed':
        return { icon: <CheckCircle size={18} />, color: 'bg-emerald-50 border-emerald-200 text-emerald-700', text: '盘点已完成' };
      default:
        return null;
    }
  })();

  // ================================================
  // 渲染：正常状态
  // ================================================
  return (
    <div className="min-h-screen bg-gray-50 pb-28">
      {/* 顶部信息区 */}
      <div className="bg-white px-4 pt-5 pb-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <ClipboardCheck size={20} className="text-primary-600 shrink-0" />
              <h1 className="text-lg font-semibold text-gray-800 truncate">{meta.warehouse_name}</h1>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              {meta.take_type === 'annual' ? '年度固定资产盘点' : '月末原材料盘点'}
            </p>
            <p className="text-sm text-gray-500 mt-0.5">
              归属月份：<span className="text-gray-700 font-medium">{meta.period_month}</span>
            </p>
            {meta.role === 'reviewer' && (
              <p className="text-xs text-purple-600 mt-1 bg-purple-50 inline-block px-2 py-0.5 rounded">财务复核视图</p>
            )}
            <p className="text-xs text-gray-400 font-mono mt-1">{meta.take_no}</p>
          </div>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium shrink-0 ${statusCfg.badge}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.dot}`} />
            {statusCfg.label}
          </span>
        </div>

        {/* 退回原因 */}
        {meta.status === 'returned' && parsedReturnReason && (
          <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
            <AlertCircle size={16} className="text-red-500 mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-red-700">已被财务退回，请修改后重新提交</p>
              <p className="text-red-600 mt-0.5">退回原因：{parsedReturnReason}</p>
            </div>
          </div>
        )}

        {/* 状态横幅（只读状态） */}
        {statusBanner && (
          <div className={`mt-3 border rounded-lg p-3 flex items-center gap-2 text-sm ${statusBanner.color}`}>
            {statusBanner.icon}
            <span className="font-medium">{statusBanner.text}</span>
          </div>
        )}
      </div>

      {/* 统计汇总条 sticky 顶部 */}
      <div className="sticky top-0 z-20 bg-white border-b border-gray-200 shadow-sm">
        <div className="px-4 py-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            {!canReview ? (
              <>
                <StatCell label="物资总数" value={String(summary.total)} />
                <StatCell label="已录入" value={`${summary.filled}/${summary.total}`} valueClass={summary.unfilled > 0 ? 'text-orange-600' : 'text-emerald-600'} />
                <StatCell label="差异条数" value={String(summary.diffCount)} valueClass={summary.diffCount > 0 ? 'text-red-600' : 'text-gray-700'} />
              </>
            ) : (
              <>
                <StatCell label="抽样数" value={String(reviewSamples.length)} />
                <StatCell
                  label="已核验"
                  value={`${reviewSamples.filter(s => s.verify_quantity !== null && s.verify_quantity !== '').length}/${reviewSamples.length}`}
                  valueClass={reviewSamples.some(s => s.verify_quantity === null || s.verify_quantity === '') ? 'text-orange-600' : 'text-emerald-600'}
                />
                <StatCell label="一致数" value={String(reviewSamples.filter(s => s.matched === true).length)} valueClass="text-primary-600" />
              </>
            )}
          </div>
          {!canReview && (
            <div className="grid grid-cols-3 gap-2 text-center mt-2 pt-2 border-t border-gray-100">
              <StatCell label="系统价值" value={formatCurrency(summary.sysValue)} small />
              <StatCell label="实盘价值" value={formatCurrency(summary.actualValue)} small />
              <StatCell
                label="差异金额"
                value={`${summary.diffValue > 0 ? '+' : ''}${formatCurrency(summary.diffValue)}`}
                valueClass={diffColor(summary.diffValue)}
                small
              />
            </div>
          )}
        </div>
      </div>

      {/* 搜索和筛选区 */}
      {!canReview && (
        <div className="px-3 py-3 space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="搜索物资名称 / 规格"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="w-full bg-white border border-gray-200 rounded-xl pl-10 pr-9 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500"
            />
            {keyword && (
              <button
                onClick={() => setKeyword('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
              >
                <X size={16} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} pointerEvents="none" />
              <select
                value={catFilter}
                onChange={(e) => setCatFilter(e.target.value)}
                className="w-full appearance-none bg-white border border-gray-200 rounded-xl pl-9 pr-8 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500"
              >
                <option value="">全部分类</option>
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <button
              onClick={() => setOnlyDiff((v) => !v)}
              className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border transition-colors ${
                onlyDiff
                  ? 'bg-primary-600 border-primary-600 text-white'
                  : 'bg-white border-gray-200 text-gray-700'
              }`}
            >
              <Filter size={14} />
              只看差异
            </button>

            {editable && (
              <button
                onClick={fillAllWithSystem}
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100"
              >
                <CheckCircle size={14} />
                实盘=系统
              </button>
            )}
          </div>

          <div className="text-xs text-gray-400 px-1">
            显示 {filteredItems.length} / {editItems.length} 项
          </div>
        </div>
      )}

      {/* 明细卡片列表 */}
      {!canReview && (
        <div className="px-3 space-y-3">
          {filteredItems.length === 0 ? (
            <div className="bg-white rounded-lg p-8 text-center text-gray-400">
              <Package size={36} className="mx-auto mb-2 text-gray-300" />
              <p className="text-sm">无符合条件的物资</p>
            </div>
          ) : (
            filteredItems.map((it) => {
              const actual = it.actual_quantity;
              const diff = actual !== null ? actual - Number(it.system_quantity) : 0;
              const actualValue = actual !== null ? actual * Number(it.unit_price) : 0;
              const isUnconfirmed = actual === null;
              const displayQty = actual !== null ? String(actual) : String(it.system_quantity);

              return (
                <div key={it.id} className="bg-white rounded-lg shadow-sm p-3.5">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-base font-semibold text-gray-800 truncate">{it.item_name}</h3>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500 mt-0.5">
                        {it.spec && <span>规格: {it.spec}</span>}
                        {it.unit && <span>单位: {it.unit}</span>}
                      </div>
                    </div>
                    {it.category_name && (
                      <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                        {it.category_name}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-sm py-1.5 border-b border-gray-100">
                    <span className="text-gray-500">系统数量</span>
                    <span className="text-gray-700 font-medium">
                      {formatNumber(it.system_quantity)} {it.unit || ''}
                      <span className="text-gray-400 ml-2">价值 {formatCurrency(it.system_value)}</span>
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-3 py-2">
                    <label className="text-sm text-gray-500 shrink-0">实盘数量</label>
                    <div className="flex items-center gap-2 flex-1 justify-end">
                      {editable ? (
                        <input
                          type="number"
                          step="any"
                          inputMode="decimal"
                          value={displayQty}
                          onChange={(e) => {
                            const v = e.target.value;
                            updateItem(it.id, { actual_quantity: v === '' ? null : Number(v) });
                          }}
                          className={`w-28 text-right text-base px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 ${
                            isUnconfirmed ? 'bg-amber-50 border-amber-300' : 'border-gray-200 bg-white'
                          }`}
                          placeholder={String(it.system_quantity)}
                        />
                      ) : (
                        <span className={`text-base font-medium ${isUnconfirmed ? 'text-gray-400 italic' : 'text-gray-800'}`}>
                          {actual !== null ? formatNumber(actual) : '未录入'}
                        </span>
                      )}
                      {it.unit && <span className="text-sm text-gray-500 shrink-0">{it.unit}</span>}
                    </div>
                  </div>
                  {editable && isUnconfirmed && (
                    <p className="text-xs text-amber-600 -mt-1 mb-1 text-right">待确认</p>
                  )}

                  <div className="flex items-center justify-between text-sm py-1.5 border-t border-gray-100">
                    <span className="text-gray-500 flex items-center gap-1">
                      差异
                      {diff > 0 ? (
                        <TrendingUp size={13} className="text-emerald-500" />
                      ) : diff < 0 ? (
                        <TrendingDown size={13} className="text-red-500" />
                      ) : (
                        <Minus size={13} className="text-gray-300" />
                      )}
                    </span>
                    <div className="flex items-center gap-3">
                      <span className={`font-semibold ${diffColor(diff)}`}>
                        {diff > 0 ? `+${formatNumber(diff)} (盘盈)` : diff < 0 ? `${formatNumber(diff)} (盘亏)` : '0 (一致)'}
                      </span>
                      <span className="text-gray-700">
                        实盘价值 <span className="font-medium">{formatCurrency(actualValue)}</span>
                      </span>
                    </div>
                  </div>

                  <div className="mt-2 pt-2 border-t border-gray-100">
                    {editable ? (
                      <input
                        type="text"
                        value={it.remark || ''}
                        onChange={(e) => updateItem(it.id, { remark: e.target.value })}
                        className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500"
                        placeholder="备注（可选）"
                      />
                    ) : (
                      it.remark && <p className="text-xs text-gray-500">备注：{it.remark}</p>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* 复核抽样列表 */}
      {canReview && (
        <div className="px-3 space-y-3">
          {reviewSamples.length === 0 ? (
            <div className="bg-white rounded-lg p-8 text-center text-gray-400">
              <ClipboardCheck size={36} className="mx-auto mb-2 text-gray-300" />
              <p className="text-sm">抽样数据加载中...</p>
            </div>
          ) : (
            reviewSamples.map(s => {
              const vq = s.verify_quantity;
              const matched = vq !== null && vq !== '' && Number(vq) === Number(s.actual_quantity);
              return (
                <div key={s.item_detail_id} className="bg-white rounded-lg shadow-sm p-3.5">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-base font-semibold text-gray-800 truncate">{s.item_name}</h3>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500 mt-0.5">
                        {s.spec && <span>规格: {s.spec}</span>}
                        {s.unit && <span>单位: {s.unit}</span>}
                      </div>
                    </div>
                    {s.matched === true && <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600">✅ 一致</span>}
                    {s.matched === false && <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-600">❌ 不一致</span>}
                  </div>
                  <div className="text-sm py-1.5 border-b border-gray-100 flex items-center justify-between">
                    <span className="text-gray-500">盘点数量</span>
                    <span className="text-gray-700 font-medium">{formatNumber(Number(s.actual_quantity))} {s.unit || ''}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-2">
                    <label className="text-sm text-gray-500 shrink-0">核验数量</label>
                    <div className="flex items-center gap-2 flex-1 justify-end">
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        value={vq === null || vq === undefined ? '' : String(vq)}
                        onChange={e => {
                          const v = e.target.value;
                          updateSample(s.item_detail_id, v === '' ? null : Number(v));
                        }}
                        className="w-28 text-right text-base px-3 py-2 border border-gray-200 rounded-lg bg-amber-50 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500"
                        placeholder="请输入"
                      />
                      {s.unit && <span className="text-sm text-gray-500 shrink-0">{s.unit}</span>}
                    </div>
                  </div>
                  {matched && s.verify_quantity !== null && (
                    <p className="text-xs text-emerald-600 mt-1 text-right bg-emerald-50 inline-block px-2 py-0.5 rounded float-right">核验一致 ✓</p>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* 签名区 - 提交复核前签名 / 展示已保存签名 */}
      {(editable || canReview || meta?.status === 'completed') && (
        <div className="px-3 mt-4 mb-4">
          <div className="bg-white rounded-lg shadow-sm p-4">
            {(editable && meta?.role === 'operator') && (
              <>
                <h3 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-1.5">
                  <ClipboardCheck size={16} /> 盘点人签名（提交前必须签）
                </h3>
                {savedSignature && !signatureData ? (
                  <div className="border border-gray-200 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-2">已保存签名（可重签覆盖）：</p>
                    <img src={savedSignature} alt="已保存签名" className="max-h-28 w-auto mx-auto" />
                    <button onClick={() => { setSavedSignature(null); setSignatureData(null); }}
                      className="mt-2 w-full text-sm text-primary-600 hover:bg-primary-50 py-1.5 rounded">
                      <RotateCcw size={14} className="inline mr-1" /> 清除并重新签名
                    </button>
                  </div>
                ) : (
                  <SignatureCanvas onSignatureChange={setSignatureData} />
                )}
              </>
            )}
            {canReview && (
              <>
                <h3 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-1.5">
                  <ClipboardCheck size={16} /> 财务复核签名（通过前必须签）
                </h3>
                {savedSignature && !signatureData ? (
                  <div className="border border-gray-200 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-2">已保存签名（可重签覆盖）：</p>
                    <img src={savedSignature} alt="已保存签名" className="max-h-28 w-auto mx-auto" />
                    <button onClick={() => { setSavedSignature(null); setSignatureData(null); }}
                      className="mt-2 w-full text-sm text-primary-600 hover:bg-primary-50 py-1.5 rounded">
                      <RotateCcw size={14} className="inline mr-1" /> 清除并重新签名
                    </button>
                  </div>
                ) : (
                  <SignatureCanvas onSignatureChange={setSignatureData} />
                )}
              </>
            )}
            {meta?.status === 'completed' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="border border-gray-200 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-500 mb-2">盘点人签名</p>
                  {meta.operator_signature ? (
                    <img src={meta.operator_signature} alt="盘点人签名" className="max-h-24 w-auto mx-auto" />
                  ) : (
                    <p className="text-gray-300 text-xs py-4">未签名</p>
                  )}
                </div>
                <div className="border border-gray-200 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-500 mb-2">财务复核签名</p>
                  {meta.reviewer_signature ? (
                    <img src={meta.reviewer_signature} alt="财务签名" className="max-h-24 w-auto mx-auto" />
                  ) : (
                    <p className="text-gray-300 text-xs py-4">未签名</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 底部操作栏 */}
      {(editable || canReview || meta?.status === 'completed') && (
        <div className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-200 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
          <div className="max-w-xl mx-auto px-4 py-3 flex items-center gap-3">
            {/* 盘点录入：保存 + 提交 */}
            {editable && (
              <>
                {modifiedIds.size > 0 && (
                  <span className="text-xs text-amber-600 shrink-0">已修改 {modifiedIds.size} 项</span>
                )}
                <button onClick={() => handleSave(false)} disabled={saving || submitting}
                  className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl text-base font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50">
                  {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />} 保存
                </button>
                <button onClick={handleSubmit} disabled={saving || submitting}
                  className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl text-base font-medium bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50">
                  {submitting ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />} 提交复核
                </button>
              </>
            )}
            {/* 复核：退回 + 通过 */}
            {canReview && (
              <>
                <button onClick={() => setShowReturnModal(true)} disabled={reviewing}
                  className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl text-base font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50">
                  <AlertCircle size={18} /> 退回
                </button>
                <button onClick={() => handleReview('pass')} disabled={reviewing}
                  className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl text-base font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
                  {reviewing ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle size={18} />} 复核通过
                </button>
              </>
            )}
            {/* 已完成：导出PDF */}
            {meta?.status === 'completed' && (
              <button onClick={handleExportPdf} disabled={loading}
                className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl text-base font-medium bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50">
                <FileDown size={18} /> 导出盘点报告
              </button>
            )}
          </div>
        </div>
      )}

      {/* 退回原因弹窗 */}
      {showReturnModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-6">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">退回盘点</h3>
            <label className="block text-sm font-medium text-gray-700 mb-2">退回原因 <span className="text-red-500">*</span></label>
            <textarea rows={4} value={returnReason} onChange={e => setReturnReason(e.target.value)}
              placeholder="请填写退回原因，通知盘点人修改"
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 resize-none" />
            <div className="mt-5 flex items-center gap-3">
              <button onClick={() => setShowReturnModal(false)} disabled={reviewing}
                className="flex-1 py-2.5 rounded-xl text-base font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50">
                取消
              </button>
              <button onClick={() => handleReview('return')} disabled={reviewing || !returnReason.trim()}
                className="flex-1 py-2.5 rounded-xl text-base font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
                {reviewing ? <Loader2 size={16} className="animate-spin inline mr-1" /> : null} 确认退回
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 全局提示 toast */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-[90%]">
          <div
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-lg text-sm ${
              toast.type === 'success'
                ? 'bg-emerald-600 text-white'
                : 'bg-red-600 text-white'
            }`}
          >
            {toast.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
            <span>{toast.msg}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ================================================
// 子组件：统计单元格
// ================================================
function StatCell({
  label,
  value,
  valueClass = 'text-gray-800',
  small = false,
}: {
  label: string;
  value: string;
  valueClass?: string;
  small?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className={`font-semibold ${small ? 'text-sm' : 'text-base'} ${valueClass}`}>{value}</p>
    </div>
  );
}
