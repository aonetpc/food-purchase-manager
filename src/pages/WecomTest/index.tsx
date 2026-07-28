import { useState, useEffect } from 'react';
import {
  Send, Save, AlertCircle, CheckCircle2, FlaskConical,
  Link2, MessageSquare, RefreshCw, Calendar, Clock, XCircle,
  ChevronDown, ChevronUp, Eye, FileDown, Download
} from 'lucide-react';
import { api } from '@/lib/api';

interface WecomTestConfig {
  test_webhook_url?: string;
  webhook_url?: string;
  app_domain?: string;
}

interface TestMessage {
  id: string;
  test_date: string;
  total_amount: number;
  departments: Array<{ id: string; name: string; confirmed?: boolean }>;
  purchase_items: Array<{
    ingredient_name: string;
    purchase_unit: string;
    purchase_quantity: number;
    purchase_unit_price: number;
    amount: number;
    department_name: string;
  }>;
  status: 'pending' | 'confirmed' | 'rejected';
  confirmed_by?: string;
  confirmed_at?: string;
  rejected_by?: string;
  rejected_at?: string;
  reject_reason?: string;
  wecom_sent: number;
  sent_at?: string;
  created_at: string;
  user_confirmations?: Record<string, { confirmed: boolean; confirmed_at?: string; confirmed_by?: string }>;
  user_departments?: Record<string, { departments: string[] } | string[]>;
  pdf_url?: string;
}

export default function WecomTest() {
  const [testWebhookUrl, setTestWebhookUrl] = useState('');
  const [prodWebhookUrl, setProdWebhookUrl] = useState('');
  const [appDomain, setAppDomain] = useState('');
  const [msgType, setMsgType] = useState<'markdown' | 'text'>('markdown');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [testDate, setTestDate] = useState('2026-07-07');
  const [sendingConfirm, setSendingConfirm] = useState(false);

  const [messages, setMessages] = useState<TestMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      await fetchConfig();
      await fetchMessages();
    } catch (_e) {
      // 错误已在各自函数中处理
    } finally {
      setLoading(false);
    }
  };

  const fetchConfig = async () => {
    try {
      const data = await api.get<WecomTestConfig>('/wecom/config');
      setTestWebhookUrl(data.test_webhook_url || '');
      setProdWebhookUrl(data.webhook_url || '');
      setAppDomain(data.app_domain || '');
    } catch (err: any) {
      setError(err.message || '获取配置失败');
    }
  };

  const fetchMessages = async () => {
    setLoadingMessages(true);
    try {
      const data = await api.get<TestMessage[]>('/wecom/test-messages');
      setMessages(data);
    } catch (_err) {
      // 静默失败，不打扰用户
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleSaveUrl = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await api.put<WecomTestConfig>('/wecom/config', { test_webhook_url: testWebhookUrl });
      setSuccess('测试群机器人 URL 已保存');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleSend = async () => {
    setError('');
    setSuccess('');
    if (!testWebhookUrl) {
      setError('请先填写并保存测试群机器人 Webhook URL');
      return;
    }
    setSending(true);
    try {
      const payload: { content?: string; msg_type: 'markdown' | 'text' } = { msg_type: msgType };
      const trimmed = content.trim();
      if (trimmed) {
        payload.content = trimmed;
      }
      const data = await api.post<{ success: boolean; message: string; error?: string }>('/wecom/test-group-send', payload);
      if (data.success) {
        setSuccess(data.message || '消息已发送到测试群');
        setTimeout(() => setSuccess(''), 5000);
        fetchMessages();
      } else {
        setError(data.error || '发送失败');
      }
    } catch (err: any) {
      setError(err.message || '发送失败');
    } finally {
      setSending(false);
    }
  };

  const handleSendConfirmation = async () => {
    setError('');
    setSuccess('');
    if (!testWebhookUrl) {
      setError('请先填写并保存测试群机器人 Webhook URL');
      return;
    }
    if (!testDate) {
      setError('请选择测试日期');
      return;
    }
    setSendingConfirm(true);
    try {
      const data = await api.post<{
        success: boolean; message: string; error?: string;
        id: string; test_date: string; total_amount: number;
        departments_count: number; items_count: number;
        sent_to_users?: Array<{ userid: string; departments: string; total: number }>;
        failed_users?: Array<{ userid: string; error: string }>;
      }>('/wecom/test-send-confirmation', { test_date: testDate });
      if (data.success) {
        let successMsg = `${data.message}（${data.departments_count}个部门，${data.items_count}项食材，¥${data.total_amount.toFixed(2)}）`;
        if (data.sent_to_users && data.sent_to_users.length > 0) {
          successMsg += '\n个人消息已发送：' + data.sent_to_users.map(u => u.userid).join('、');
        }
        if (data.failed_users && data.failed_users.length > 0) {
          successMsg += '\n发送失败：' + data.failed_users.map(u => u.userid).join('、');
        }
        setSuccess(successMsg);
        setTimeout(() => setSuccess(''), 5000);
        fetchMessages();
      } else {
        setError(data.error || '发送失败');
      }
    } catch (err: any) {
      setError(err.message || '发送失败');
    } finally {
      setSendingConfirm(false);
    }
  };

  const handleInsertTemplate = (template: string) => {
    setContent(template);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'confirmed':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded-full"><CheckCircle2 size={12} />已确认</span>;
      case 'rejected':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-700 text-xs font-medium rounded-full"><XCircle size={12} />已驳回</span>;
      default:
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-yellow-100 text-yellow-700 text-xs font-medium rounded-full"><Clock size={12} />待处理</span>;
    }
  };

  const openConfirmPage = (id: string) => {
    const base = appDomain || window.location.origin;
    window.open(`${base}/wecom-test-confirm/${id}`, '_blank');
  };

  const handleManualConfirm = async (id: string) => {
    try {
      await api.post(`/wecom/test-messages/${id}/confirm`);
      setSuccess('已手动确认，状态已更新');
      await fetchMessages();
    } catch (err: any) {
      setError(err.message || '确认失败');
    }
  };

  const handleManualReject = async (id: string) => {
    try {
      await api.post(`/wecom/test-messages/${id}/reject`, { reason: '手动测试驳回' });
      setSuccess('已手动驳回，状态已更新');
      await fetchMessages();
    } catch (err: any) {
      setError(err.message || '驳回失败');
    }
  };

  const handleGeneratePDF = async (id: string) => {
    try {
      console.log(`[PDF生成] 点击生成PDF，id=${id}`);
      const result = await api.post(`/wecom/test-messages/${id}/generate-pdf`);
      console.log(`[PDF生成] 响应结果:`, result);
      setSuccess('PDF生成成功');
      await fetchMessages();
    } catch (err: any) {
      console.error('[PDF生成] 失败:', err);
      setError(err.message || 'PDF生成失败，请刷新页面重试');
    }
  };

  const handleDownloadPDF = async (id: string) => {
    try {
      const token = localStorage.getItem('auth-session');
      let authToken = '';
      if (token) {
        const data = JSON.parse(token);
        authToken = data?.state?.user?.token || '';
      }
      
      const response = await fetch(`${api.getBaseUrl()}/wecom/test-messages/${id}/pdf`, {
        headers: {
          'Authorization': authToken ? `Bearer ${authToken}` : '',
        },
      });
      
      if (!response.ok) {
        throw new Error('下载失败');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `采购确认单_${id}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message || '下载失败');
    }
  };

  if (loading) {
    return <div className="text-center py-10 text-gray-500">加载中...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold text-gray-800 flex items-center gap-2">
            <FlaskConical size={24} className="text-primary-500" />
            企业微信测试
          </h1>
          <p className="text-gray-500 mt-1">
            用于开发测试，消息仅发送到测试群，<span className="text-primary-600 font-medium">不影响生产群</span>
          </p>
        </div>
        <button
          onClick={fetchAll}
          className="btn-secondary flex items-center gap-2 text-sm"
        >
          <RefreshCw size={16} />
          刷新
        </button>
      </div>

      {error && (
        <div className="bg-danger-50 border border-danger-200 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle size={20} className="text-danger-500 flex-shrink-0" />
          <span className="text-danger-700">{error}</span>
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
          <CheckCircle2 size={20} className="text-green-500 flex-shrink-0" />
          <span className="text-green-700">{success}</span>
        </div>
      )}

      {/* 测试群配置 */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Link2 size={20} className="text-primary-500" />
          <h2 className="text-lg font-semibold text-gray-800">测试群机器人配置</h2>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              测试群机器人 Webhook URL
              <span className="text-xs text-primary-500 ml-2">（独立配置，与生产群完全隔离）</span>
            </label>
            <input
              type="text"
              value={testWebhookUrl}
              onChange={(e) => setTestWebhookUrl(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
              placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."
            />
            <p className="text-xs text-gray-500 mt-1">
              📌 在企业微信新建一个测试群 → 群设置 → 群机器人 → 添加机器人 → 复制 Webhook 地址填入此处
            </p>
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleSaveUrl}
              disabled={saving}
              className="btn-secondary flex items-center gap-2 disabled:opacity-50"
            >
              <Save size={16} />
              {saving ? '保存中...' : '保存测试群 URL'}
            </button>
          </div>
        </div>
      </div>

      {/* 模拟采购确认通知（核心测试功能） */}
      <div className="card border-primary-200 bg-primary-50/30">
        <div className="flex items-center gap-2 mb-4">
          <Calendar size={20} className="text-primary-500" />
          <h2 className="text-lg font-semibold text-gray-800">模拟采购确认通知</h2>
          <span className="text-xs bg-primary-100 text-primary-700 px-2 py-0.5 rounded-full">推荐测试</span>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">选择采购日期</label>
              <input
                type="date"
                value={testDate}
                onChange={(e) => setTestDate(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 bg-white"
              />
              <p className="text-xs text-gray-500 mt-1">
                💡 系统会读取该日期的真实采购数据生成确认通知
              </p>
            </div>
            <div className="flex items-end">
              <button
                onClick={handleSendConfirmation}
                disabled={sendingConfirm}
                className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Send size={16} />
                {sendingConfirm ? '发送中...' : '发送采购确认通知到企业微信'}
              </button>
            </div>
          </div>

          <div className="bg-white/60 border border-gray-200 rounded-lg p-3 text-xs text-gray-600">
            <p className="font-medium text-gray-700 mb-1">消息包含：</p>
            <ul className="list-disc list-inside space-y-0.5 text-gray-600">
              <li>采购日期、涉及部门、总金额</li>
              <li>按部门分组的采购明细（含单价、数量、小计）</li>
              <li><strong>群消息</strong>：@相关部门确认人，底部提示去OA应用审批</li>
              <li><strong>个人消息</strong>：模板卡片含「去确认」按钮，点击卡片跳转到确认页（手写签名+确认）</li>
              <li><strong>权限隔离</strong>：每位确认人只能看到/确认自己负责的部门，互不影响</li>
              <li>操作结果会回显到下方消息列表的 confirmed/rejected 字段</li>
            </ul>
          </div>
        </div>
      </div>

      {/* 发送自定义测试消息 */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <MessageSquare size={20} className="text-primary-500" />
          <h2 className="text-lg font-semibold text-gray-800">发送自定义测试消息</h2>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">消息类型</label>
            <div className="flex gap-2">
              <button
                onClick={() => setMsgType('markdown')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  msgType === 'markdown'
                    ? 'bg-primary-500 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Markdown
              </button>
              <button
                onClick={() => setMsgType('text')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  msgType === 'text'
                    ? 'bg-primary-500 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                纯文本
              </button>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">消息内容</label>
              <div className="flex gap-1.5">
                <button
                  onClick={() => handleInsertTemplate('**【测试消息】**\n\n这是一条来自食材采购管理系统的测试消息。\n\n> 发送时间：' + new Date().toLocaleString('zh-CN'))}
                  className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition-colors"
                >
                  默认模板
                </button>
                <button
                  onClick={() => setContent('')}
                  className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition-colors"
                >
                  清空
                </button>
              </div>
            </div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={6}
              className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
              placeholder={
                msgType === 'markdown'
                  ? '留空则发送默认测试消息...'
                  : '留空则发送默认测试消息...'
              }
            />
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleSend}
              disabled={sending}
              className="btn-primary flex items-center gap-2 disabled:opacity-50"
            >
              <Send size={16} />
              {sending ? '发送中...' : '发送到测试群'}
            </button>
          </div>
        </div>
      </div>

      {/* 测试消息列表 */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Eye size={20} className="text-primary-500" />
            <h2 className="text-lg font-semibold text-gray-800">测试消息记录</h2>
            <span className="text-xs text-gray-500">（最近 {messages.length} 条）</span>
          </div>
          <button
            onClick={fetchMessages}
            disabled={loadingMessages}
            className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1 disabled:opacity-50"
          >
            <RefreshCw size={14} className={loadingMessages ? 'animate-spin' : ''} />
            刷新
          </button>
        </div>

        {messages.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <MessageSquare size={40} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">暂无测试消息记录</p>
            <p className="text-xs mt-1">发送一条采购确认通知开始测试</p>
          </div>
        ) : (
          <div className="space-y-2">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className="border border-gray-200 rounded-lg overflow-hidden"
              >
                <div
                  className="flex items-center justify-between px-4 py-3 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors"
                  onClick={() => setExpandedId(expandedId === msg.id ? null : msg.id)}
                >
                  <div className="flex items-center gap-3">
                    {expandedId === msg.id ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-800">
                          {msg.test_date}
                        </span>
                        {getStatusBadge(msg.status)}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        ¥{Number(msg.total_amount || 0).toFixed(2)} · {msg.departments?.length || 0}个部门 · {msg.purchase_items?.length || 0}项
                        {msg.user_departments && Object.keys(msg.user_departments).length > 0 && (
                          <span className="ml-2 text-primary-500">
                            · {Object.values(msg.user_confirmations || {}).filter((c: any) => c?.confirmed).length}/{Object.keys(msg.user_departments).length} 已确认
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {msg.pdf_url ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDownloadPDF(msg.id); }}
                        className="text-xs text-green-600 hover:text-green-700 flex items-center gap-1"
                        title="下载PDF"
                      >
                        <Download size={14} />
                        下载PDF
                      </button>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleGeneratePDF(msg.id); }}
                        className="text-xs text-gray-500 hover:text-green-600 flex items-center gap-1"
                        title="生成PDF"
                      >
                        <FileDown size={14} />
                        生成PDF
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); openConfirmPage(msg.id); }}
                      className="text-xs text-primary-600 hover:text-primary-700 hover:underline"
                    >
                      打开确认页
                    </button>
                    <span className="text-xs text-gray-400">
                      {msg.created_at?.substring(5, 16)}
                    </span>
                  </div>
                </div>

                {expandedId === msg.id && (
                  <div className="px-4 py-3 border-t border-gray-200 space-y-3">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                      <div className="bg-gray-50 rounded-lg p-2">
                        <p className="text-gray-500">状态</p>
                        <p className="font-medium text-gray-800 mt-0.5">
                          {msg.status === 'confirmed' ? '已确认' : msg.status === 'rejected' ? '已驳回' : '待处理'}
                        </p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-2">
                        <p className="text-gray-500">确认字段 (confirmed)</p>
                        <p className={`font-medium mt-0.5 ${msg.status === 'confirmed' ? 'text-green-600' : 'text-gray-400'}`}>
                          {msg.confirmed_by ? `${msg.confirmed_by}` : '未确认'}
                        </p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-2">
                        <p className="text-gray-500">驳回字段 (rejected)</p>
                        <p className={`font-medium mt-0.5 ${msg.status === 'rejected' ? 'text-red-600' : 'text-gray-400'}`}>
                          {msg.rejected_by ? `${msg.rejected_by}` : '未驳回'}
                        </p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-2">
                        <p className="text-gray-500">操作时间</p>
                        <p className="font-medium text-gray-800 mt-0.5">
                          {msg.confirmed_at?.substring(5, 16) || msg.rejected_at?.substring(5, 16) || '-'}
                        </p>
                      </div>
                    </div>

                    {msg.reject_reason && (
                      <div className="bg-red-50 border border-red-100 rounded-lg p-2 text-xs text-red-700">
                        <span className="font-medium">驳回原因：</span>{msg.reject_reason}
                      </div>
                    )}

                    {msg.status === 'pending' && (
                      <div className="flex gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleManualConfirm(msg.id); }}
                          className="flex-1 btn-primary text-xs py-2"
                        >
                          ✅ 手动确认
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleManualReject(msg.id); }}
                          className="flex-1 btn-danger text-xs py-2"
                        >
                          ❌ 手动驳回
                        </button>
                      </div>
                    )}

                    {/* 确认进度 */}
                    {msg.user_departments && Object.keys(msg.user_departments).length > 0 && (
                      <div className="bg-primary-50 border border-primary-100 rounded-lg p-2">
                        <p className="text-xs text-primary-700 font-medium mb-1">确认进度</p>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(msg.user_departments).map(([userid, deptData]) => {
                            const deptNames = Array.isArray(deptData) ? deptData : (deptData as any).departments || [];
                            const conf = (msg.user_confirmations || {})[userid];
                            return (
                              <div key={userid} className="flex items-center gap-1 text-xs">
                                {conf?.confirmed ? (
                                  <CheckCircle2 size={12} className="text-green-500" />
                                ) : (
                                  <Clock size={12} className="text-gray-400" />
                                )}
                                <span className={conf?.confirmed ? 'text-green-700' : 'text-gray-600'}>{userid}</span>
                                <span className="text-gray-400">({deptNames.join('、')})</span>
                                {conf?.confirmed && conf.confirmed_at && (
                                  <span className="text-gray-400">{conf.confirmed_at.substring(5, 16)}</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        <div className="mt-1 text-xs text-primary-600">
                          {Object.values(msg.user_confirmations || {}).filter((c: any) => c?.confirmed).length}/{Object.keys(msg.user_departments).length} 人已确认
                        </div>
                      </div>
                    )}

                    {/* PDF操作 */}
                    <div className="flex gap-2">
                      {msg.pdf_url ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDownloadPDF(msg.id); }}
                          className="btn-primary text-xs flex-1 flex items-center justify-center gap-1"
                        >
                          <Download size={14} />
                          下载PDF
                        </button>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleGeneratePDF(msg.id); }}
                          className="btn-secondary text-xs flex-1 flex items-center justify-center gap-1"
                        >
                          <FileDown size={14} />
                          生成PDF
                        </button>
                      )}
                    </div>

                    <div>
                      <p className="text-xs text-gray-500 mb-1">涉及部门</p>
                      <div className="flex flex-wrap gap-1">
                        {msg.departments?.map((d) => (
                          <span key={d.id} className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded">
                            {d.name}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-xs text-gray-500 mb-1">采购明细</p>
                      <div className="bg-gray-50 rounded-lg p-2 max-h-40 overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-gray-500 border-b border-gray-200">
                              <th className="text-left py-1 font-medium">食材</th>
                              <th className="text-left py-1 font-medium">部门</th>
                              <th className="text-right py-1 font-medium">单价</th>
                              <th className="text-right py-1 font-medium">数量</th>
                              <th className="text-right py-1 font-medium">金额</th>
                            </tr>
                          </thead>
                          <tbody>
                            {msg.purchase_items?.map((item, idx) => (
                              <tr key={idx} className="border-b border-gray-100 last:border-0">
                                <td className="py-1 text-gray-800">{item.ingredient_name}</td>
                                <td className="py-1 text-gray-600">{item.department_name}</td>
                                <td className="py-1 text-right text-gray-700">{item.purchase_unit_price.toFixed(2)}</td>
                                <td className="py-1 text-right text-gray-700">{item.purchase_quantity}{item.purchase_unit}</td>
                                <td className="py-1 text-right font-medium text-gray-800">¥{item.amount.toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 使用说明 */}
      <div className="card bg-blue-50 border-blue-100">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <FlaskConical size={18} className="text-blue-600" />
          </div>
          <div className="text-sm text-blue-900">
            <p className="font-medium mb-2">测试流程</p>
            <ol className="list-decimal list-inside space-y-1 text-blue-800 text-xs">
              <li>在部门管理中，给需要接收消息的部门设置「确认人」（填入企业微信 UserID）</li>
              <li>新建测试群 → 添加群机器人 → 复制 Webhook URL 填入上方并保存</li>
              <li>选择7月7日（或其他有数据的日期），点击"发送采购确认通知到企业微信"</li>
              <li>系统会同时发送：①群消息到测试群 ②个人消息到各部门确认人（只发TA负责部门的内容）</li>
              <li>在企业微信中收到消息后，点击消息里的 ✅确认 或 ❌驳回 链接</li>
              <li>跳转页面后点击确认/驳回按钮，操作结果会实时回写到下方"测试消息记录"</li>
              <li>展开某条消息可查看 <code className="bg-white/50 px-1 rounded">confirmed</code>、<code className="bg-white/50 px-1 rounded">rejected</code> 等状态字段</li>
            </ol>
            <p className="mt-3 text-xs text-blue-700">
              💡 <strong>怎么找到自己的 UserID？</strong>企业微信管理后台 → 通讯录 → 找到自己 → 账号 就是 UserID（如 DengYueZhen）
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
