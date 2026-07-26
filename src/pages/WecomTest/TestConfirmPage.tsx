import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CheckCircle2, AlertCircle, ArrowLeft, Loader2 } from 'lucide-react';

export default function WecomTestConfirm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetchDetail();
  }, [id]);

  const fetchDetail = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/wecom/test-messages/${id}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '请求失败' }));
        throw new Error(err.error || '消息不存在');
      }
      const result = await res.json();
      setData(result);
    } catch (err: any) {
      setError(err.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    setProcessing(true);
    setError('');
    try {
      const res = await fetch(`/api/wecom/test-messages/${id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed_by: '测试用户' }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '操作失败' }));
        throw new Error(err.error || '确认失败');
      }
      setSuccess(true);
      setTimeout(() => fetchDetail(), 300);
    } catch (err: any) {
      setError(err.message || '确认失败');
    } finally {
      setProcessing(false);
    }
  };

  const handleReject = async () => {
    const reason = window.prompt('请输入驳回原因（可选）：');
    if (reason === null) return;
    setProcessing(true);
    setError('');
    try {
      const res = await fetch(`/api/wecom/test-messages/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rejected_by: '测试用户', reject_reason: reason || '' }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '操作失败' }));
        throw new Error(err.error || '驳回失败');
      }
      setSuccess(true);
      setTimeout(() => fetchDetail(), 300);
    } catch (err: any) {
      setError(err.message || '驳回失败');
    } finally {
      setProcessing(false);
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
            <h2 className="text-lg font-semibold">加载失败</h2>
          </div>
          <p className="text-gray-600 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  const statusText = data?.status === 'confirmed' ? '已确认' : data?.status === 'rejected' ? '已驳回' : '待处理';
  const statusColor = data?.status === 'confirmed' ? 'text-green-600' : data?.status === 'rejected' ? 'text-red-600' : 'text-yellow-600';

  return (
    <div className="min-h-screen bg-cream-100 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-xl shadow-lg p-6">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-xl font-bold text-gray-800">🧪 测试确认单</h1>
            <span className={`text-sm font-medium ${statusColor}`}>
              {statusText}
            </span>
          </div>

          {success && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3 mb-4">
              <CheckCircle2 size={20} className="text-green-500 flex-shrink-0" />
              <span className="text-green-700 text-sm">操作成功，状态已更新</span>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3 mb-4">
              <AlertCircle size={20} className="text-red-500 flex-shrink-0" />
              <span className="text-red-700 text-sm">{error}</span>
            </div>
          )}

          <div className="space-y-3 text-sm mb-6">
            <div className="flex justify-between py-2 border-b border-gray-100">
              <span className="text-gray-500">采购日期</span>
              <span className="text-gray-800 font-medium">{data?.test_date}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-100">
              <span className="text-gray-500">涉及部门</span>
              <span className="text-gray-800 font-medium">
                {data?.departments?.map((d: any) => d.name).join('、')}
              </span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-100">
              <span className="text-gray-500">总金额</span>
              <span className="text-primary-600 font-bold text-base">
                ¥{Number(data?.total_amount || 0).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-100">
              <span className="text-gray-500">食材数量</span>
              <span className="text-gray-800 font-medium">{data?.purchase_items?.length || 0} 项</span>
            </div>
            {data?.confirmed_at && (
              <div className="flex justify-between py-2 border-b border-gray-100">
                <span className="text-gray-500">确认时间</span>
                <span className="text-green-600 font-medium">{data.confirmed_at}</span>
              </div>
            )}
            {data?.rejected_at && (
              <div className="flex justify-between py-2 border-b border-gray-100">
                <span className="text-gray-500">驳回时间</span>
                <span className="text-red-600 font-medium">{data.rejected_at}</span>
              </div>
            )}
            {data?.reject_reason && (
              <div className="flex justify-between py-2 border-b border-gray-100">
                <span className="text-gray-500">驳回原因</span>
                <span className="text-red-600">{data.reject_reason}</span>
              </div>
            )}
          </div>

          {data?.status === 'pending' && (
            <div className="flex gap-3">
              <button
                onClick={handleConfirm}
                disabled={processing}
                className="flex-1 bg-green-600 text-white py-3 rounded-lg font-medium hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {processing ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
                确认
              </button>
              <button
                onClick={handleReject}
                disabled={processing}
                className="flex-1 bg-red-500 text-white py-3 rounded-lg font-medium hover:bg-red-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {processing ? <Loader2 size={18} className="animate-spin" /> : <AlertCircle size={18} />}
                驳回
              </button>
            </div>
          )}

          <button
            onClick={() => navigate('/wecom-test')}
            className="mt-4 w-full flex items-center justify-center gap-2 text-gray-500 text-sm hover:text-gray-700 transition-colors py-2"
          >
            <ArrowLeft size={16} />
            返回测试页
          </button>
        </div>
      </div>
    </div>
  );
}
