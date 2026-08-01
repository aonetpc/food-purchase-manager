import { useState, useEffect } from 'react';
import { Settings, MessageSquare, FileText, DollarSign, RefreshCw, Eye, EyeOff, Send, CheckCircle2, AlertCircle, Save, Link2, X, Smartphone } from 'lucide-react';
import { api } from '@/lib/api';

interface WecomConfig {
  corp_id?: string;
  app_secret?: string;
  agent_id?: string;
  query_agent_id?: string;
  query_app_secret?: string;
  chat_id?: string;
  webhook_url?: string;
  approval_template_id?: string;
  applicant_userid?: string;
  payment_options?: Array<{ label: string; key: string }>;
  default_payment_key?: string;
  payee_name?: string;
  bank_name?: string;
  bank_account?: string;
  payment_reason_template?: string;
  callback_token?: string;
  callback_aes_key?: string;
  approval_field_mapping?: Record<string, string>;
  wx_app_id?: string;
  wx_app_secret?: string;
  warehouse_approval_template_id?: string;
  warehouse_field_mapping?: Record<string, string>;
  warehouse_dept_options?: Array<{ key: string; text: string }>;
}

interface TemplateControl {
  control: string;
  id: string;
  label: string;
  value?: any;
}

const FIELD_MAPPING_OPTIONS = [
  { key: 'date', label: '采购日期', control: 'Date' },
  { key: 'amount', label: '报销金额', control: 'Money' },
  { key: 'reason', label: '付款事由', control: 'Text' },
  { key: 'department', label: '涉及部门', control: 'Text' },
  { key: 'payee_name', label: '收款人姓名', control: 'Text' },
  { key: 'bank_name', label: '开户银行', control: 'Text' },
  { key: 'bank_account', label: '银行账号', control: 'Text' },
  { key: 'payment_method', label: '付款方式', control: 'Select' },
  { key: 'details', label: '采购明细', control: 'Textarea' },
];

// 仓库采购审批模板字段映射选项
const WAREHOUSE_FIELD_MAPPING_OPTIONS = [
  { key: 'department', label: '申购部门', control: 'MultiSelector' },
  { key: 'reason', label: '申购事由', control: 'Text' },
  { key: 'attachment', label: '附件', control: 'File' },
];

export default function WecomManager() {
  const [config, setConfig] = useState<WecomConfig>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // 敏感字段显示状态
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  // 敏感字段实际值
  const [secretValues, setSecretValues] = useState<Record<string, string>>({});

  // 各区块保存状态
  const [sectionStatus, setSectionStatus] = useState<Record<string, '' | 'saving' | 'saved'>>({});

  // 模板控件列表
  const [templateControls, setTemplateControls] = useState<TemplateControl[]>([]);
  // 仓库采购模板控件列表
  const [warehouseTemplateControls, setWarehouseTemplateControls] = useState<TemplateControl[]>([]);

  // 回调日志
  const [callbackLogs, setCallbackLogs] = useState<any[]>([]);
  const [showCallbackLogs, setShowCallbackLogs] = useState(false);

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    setLoading(true);
    try {
      const data = await api.get<WecomConfig>('/wecom/config');
      setConfig(data);
    } catch (err: any) {
      setError(err.message || '获取配置失败');
    } finally {
      setLoading(false);
    }
  };

  const toggleSecret = async (field: string) => {
    if (!showSecrets[field]) {
      // 获取实际值
      try {
        const data = await api.get<{ value: string }>(`/wecom/config/secret/${field}`);
        setSecretValues(prev => ({ ...prev, [field]: data.value }));
        setShowSecrets(prev => ({ ...prev, [field]: true }));
      } catch (err: any) {
        setError(err.message);
      }
    } else {
      setShowSecrets(prev => ({ ...prev, [field]: false }));
    }
  };

  const saveSection = async (section: string, updates: Partial<WecomConfig>) => {
    setSectionStatus(prev => ({ ...prev, [section]: 'saving' }));
    setError('');
    setSuccess('');
    try {
      const data = await api.put<WecomConfig>('/wecom/config', updates);
      setConfig(data);
      setSecretValues({});
      setShowSecrets({});
      setSectionStatus(prev => ({ ...prev, [section]: 'saved' }));
      setSuccess(`${section}配置已保存`);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || '保存失败');
      setSectionStatus(prev => ({ ...prev, [section]: '' }));
    }
  };

  const handleTestMessage = async () => {
    setError('');
    setSuccess('');
    try {
      const data = await api.post<{ success: boolean; message: string; error?: string }>('/wecom/test-message');
      if (data.success) {
        setSuccess('测试消息已发送，请检查企业微信群');
        setTimeout(() => setSuccess(''), 5000);
      } else {
        setError(data.error || '发送失败');
      }
    } catch (err: any) {
      setError(err.message || '发送失败');
    }
  };

  const handleFetchTemplate = async () => {
    if (!config.approval_template_id) {
      setError('请先填写审批模板ID');
      return;
    }
    setError('');
    try {
      const data = await api.get<any>(`/wecom/approval-template/${config.approval_template_id}`);
      // 企微API返回的结构: data.template_content.controls
      const controls = data.template_content?.controls || data.controls || [];
      const controlList: TemplateControl[] = [];
      for (const ctrl of controls) {
        const property = ctrl.property || ctrl;
        const titleArr = property.title || [];
        const title = titleArr.find((t: any) => t.lang === 'zh_CN')?.text
          || titleArr.find((t: any) => t.text)?.text
          || property.control
          || property.id;
        controlList.push({
          control: property.control,
          id: property.id,
          label: title,
          value: ctrl.value || property.value
        });
      }
      setTemplateControls(controlList);

      // 提取付款方式选项 (Selector控件)
      const paymentOptions: Array<{ label: string; key: string }> = [];
      for (const ctrl of controls) {
        const property = ctrl.property || ctrl;
        const selector = ctrl.config?.selector || ctrl.value?.selector;
        if (property.control === 'Selector' && selector && selector.options) {
          for (const opt of selector.options) {
            paymentOptions.push({ label: opt.value?.find((t: any) => t.lang === 'zh_CN')?.text || opt.key, key: opt.key });
          }
        }
      }
      if (paymentOptions.length > 0) {
        setConfig(prev => ({ ...prev, payment_options: paymentOptions }));
      }

      setSuccess(`已拉取模板，共${controlList.length}个字段${paymentOptions.length > 0 ? `，${paymentOptions.length}个付款方式选项` : ''}`);
      setTimeout(() => setSuccess(''), 5000);
    } catch (err: any) {
      setError(err.message || '拉取模板失败');
    }
  };

  // 拉取仓库采购审批模板结构
  const handleFetchWarehouseTemplate = async () => {
    if (!config.warehouse_approval_template_id) {
      setError('请先填写仓库审批模板ID');
      return;
    }
    setError('');
    try {
      const data = await api.get<any>(`/wecom/approval-template/${config.warehouse_approval_template_id}`);
      const controls = data.template_content?.controls || data.controls || [];
      const controlList: TemplateControl[] = [];
      const deptOptions: Array<{ key: string; text: string }> = [];
      for (const ctrl of controls) {
        const property = ctrl.property || ctrl;
        const titleArr = property.title || [];
        const title = titleArr.find((t: any) => t.lang === 'zh_CN')?.text
          || titleArr.find((t: any) => t.text)?.text
          || property.control
          || property.id;
        controlList.push({
          control: property.control,
          id: property.id,
          label: title,
          value: ctrl.value || property.value
        });
        // 提取 MultiSelector / Selector 的部门选项
        if (property.control === 'MultiSelector' || property.control === 'Selector') {
          const selector = ctrl.config?.selector || ctrl.value?.selector;
          if (selector && selector.options) {
            for (const opt of selector.options) {
              const text = opt.value?.find((t: any) => t.lang === 'zh_CN')?.text
                || opt.value?.find((t: any) => t.text)?.text
                || opt.key;
              deptOptions.push({ key: opt.key, text: String(text) });
            }
          }
        }
      }
      setWarehouseTemplateControls(controlList);
      // 保存部门选项到配置（持久化到后端）
      if (deptOptions.length > 0) {
        setConfig(prev => ({ ...prev, warehouse_dept_options: deptOptions }));
        setSuccess(`已拉取仓库模板，共${controlList.length}个字段，${deptOptions.length}个部门选项`);
      } else {
        setSuccess(`已拉取仓库模板，共${controlList.length}个字段`);
      }
      setTimeout(() => setSuccess(''), 5000);
    } catch (err: any) {
      setError(err.message || '拉取仓库模板失败');
    }
  };

  const fetchCallbackLogs = async () => {
    try {
      const data = await api.get<any[]>('/wecom/callback-logs');
      setCallbackLogs(data);
      setShowCallbackLogs(true);
    } catch (err: any) {
      setError(err.message || '获取日志失败');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setSuccess('已复制到剪贴板');
    setTimeout(() => setSuccess(''), 2000);
  };

  const getFieldValue = (field: string) => {
    if (showSecrets[field]) {
      return secretValues[field] || '';
    }
    return (config as any)[field] || '';
  };

  const setFieldValue = (field: string, value: string) => {
    setConfig(prev => ({ ...prev, [field]: value }));
    if (showSecrets[field]) {
      setSecretValues(prev => ({ ...prev, [field]: value }));
    }
  };

  if (loading) {
    return <div className="text-center py-10 text-gray-500">加载中...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-serif font-bold text-gray-800">企业微信管理</h1>
        <p className="text-gray-500 mt-1">配置企业微信应用、群聊、报销模板等参数</p>
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

      {/* 区块1：应用配置 */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Settings size={20} className="text-primary-500" />
          <h2 className="text-lg font-semibold text-gray-800">企业微信应用配置</h2>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">企业ID（CorpID）</label>
            <input
              type="text"
              value={getFieldValue('corp_id')}
              onChange={(e) => setFieldValue('corp_id', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
              placeholder="ww..."
            />
            <p className="text-xs text-gray-500 mt-1">📌 两个应用共用同一个CorpID</p>
          </div>

          <div className="border-t border-gray-100 pt-4">
            <h3 className="text-sm font-medium text-gray-800 mb-3 flex items-center gap-2">
              <MessageSquare size={16} className="text-primary-500" />
              采购应用（发送消息、发起审批）
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">应用Secret</label>
                <div className="relative">
                  <input
                    type={showSecrets.app_secret ? 'text' : 'password'}
                    value={getFieldValue('app_secret')}
                    onChange={(e) => setFieldValue('app_secret', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-4 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                    placeholder="采购应用的Secret"
                  />
                  <button
                    type="button"
                    onClick={() => toggleSecret('app_secret')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showSecrets.app_secret ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">应用AgentID</label>
                <input
                  type="text"
                  value={getFieldValue('agent_id')}
                  onChange={(e) => setFieldValue('agent_id', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  placeholder="1000002"
                />
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100 pt-4">
            <h3 className="text-sm font-medium text-gray-800 mb-3 flex items-center gap-2">
              <Smartphone size={16} className="text-accent-500" />
              查询应用（手机端免登查询）
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">应用Secret</label>
                <div className="relative">
                  <input
                    type={showSecrets.query_app_secret ? 'text' : 'password'}
                    value={getFieldValue('query_app_secret')}
                    onChange={(e) => setFieldValue('query_app_secret', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-4 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                    placeholder="查询应用的Secret"
                  />
                  <button
                    type="button"
                    onClick={() => toggleSecret('query_app_secret')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showSecrets.query_app_secret ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">应用AgentID</label>
                <input
                  type="text"
                  value={getFieldValue('query_agent_id')}
                  onChange={(e) => setFieldValue('query_agent_id', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  placeholder="1000010"
                />
              </div>
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-700">
                <p>💡 提示：查询应用的可信域名必须设置为 <strong>food.hywellness.com</strong></p>
                <p>可信IP需添加：<strong>124.220.25.15</strong></p>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100 pt-4">
            <h3 className="text-sm font-medium text-gray-800 mb-3 flex items-center gap-2">
              <Smartphone size={16} className="text-green-500" />
              微信公众号配置（临时工打卡H5）
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">公众号AppID</label>
                <input
                  type="text"
                  value={getFieldValue('wx_app_id')}
                  onChange={(e) => setFieldValue('wx_app_id', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  placeholder="wx..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">公众号AppSecret</label>
                <div className="relative">
                  <input
                    type={showSecrets.wx_app_secret ? 'text' : 'password'}
                    value={getFieldValue('wx_app_secret')}
                    onChange={(e) => setFieldValue('wx_app_secret', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-4 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                    placeholder="公众号的AppSecret"
                  />
                  <button
                    type="button"
                    onClick={() => toggleSecret('wx_app_secret')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showSecrets.wx_app_secret ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div className="bg-green-50 border border-green-100 rounded-lg p-3 text-xs text-green-700">
                <p>💡 配置要求：</p>
                <p>1. 在微信公众平台 → 设置与开发 → 公众号设置 → 功能设置 → 网页授权域名</p>
                <p>2. 添加域名：<strong>food.hywellness.com</strong></p>
                <p>3. 确保公众号已认证（未认证公众号无法使用网页授权获取用户信息）</p>
                <p>4. 网页授权回调域名需与当前域名一致</p>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={() => saveSection('应用配置', {
                corp_id: getFieldValue('corp_id'),
                app_secret: getFieldValue('app_secret'),
                agent_id: getFieldValue('agent_id'),
                query_app_secret: getFieldValue('query_app_secret'),
                query_agent_id: getFieldValue('query_agent_id'),
                wx_app_id: getFieldValue('wx_app_id'),
                wx_app_secret: getFieldValue('wx_app_secret'),
              })}
              disabled={sectionStatus['应用配置'] === 'saving'}
              className="btn-primary flex items-center gap-2 disabled:opacity-50"
            >
              {sectionStatus['应用配置'] === 'saving' ? '保存中...' : sectionStatus['应用配置'] === 'saved' ? '已保存' : '保存配置'}
              {sectionStatus['应用配置'] !== 'saving' && <Save size={16} />}
            </button>
          </div>
        </div>
      </div>

      {/* 区块2：群聊配置 */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <MessageSquare size={20} className="text-primary-500" />
          <h2 className="text-lg font-semibold text-gray-800">群聊配置</h2>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              群机器人 Webhook URL
              <span className="text-xs text-primary-500 ml-2">（推荐方式）</span>
            </label>
            <input
              type="text"
              value={getFieldValue('webhook_url')}
              onChange={(e) => setFieldValue('webhook_url', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
              placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."
            />
            <p className="text-xs text-gray-500 mt-1">
              📌 获取方式：群聊 → 右上角「...」→ 群机器人 → 添加机器人 → 复制 Webhook 地址
            </p>
          </div>
          <div className="border-t border-gray-100 pt-4">
            <details className="text-sm text-gray-500">
              <summary className="cursor-pointer text-primary-500 hover:text-primary-600">
                高级配置：内部群聊ID（API方式，无需配置）
              </summary>
              <div className="mt-3 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">内部群聊ID（ChatID）</label>
                  <input
                    type="text"
                    value={getFieldValue('chat_id')}
                    onChange={(e) => setFieldValue('chat_id', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                    placeholder="群聊ID（可选）"
                  />
                </div>
              </div>
            </details>
          </div>
          <div className="flex justify-between items-center">
              <div className="flex gap-2">
                <button
                  onClick={handleTestMessage}
                  className="btn-secondary flex items-center gap-2"
                >
                  <Send size={16} />
                  测试发送消息
                </button>
                <button
                  onClick={fetchCallbackLogs}
                  className="btn-secondary flex items-center gap-2"
                >
                  <RefreshCw size={16} />
                  查看回调日志
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => saveSection('群聊配置', {
                    webhook_url: getFieldValue('webhook_url'),
                    chat_id: getFieldValue('chat_id')
                  })}
                  disabled={sectionStatus['群聊配置'] === 'saving'}
                  className="btn-primary flex items-center gap-2 disabled:opacity-50"
                >
                  {sectionStatus['群聊配置'] === 'saving' ? '保存中...' : sectionStatus['群聊配置'] === 'saved' ? '已保存' : '保存配置'}
                  {sectionStatus['群聊配置'] !== 'saving' && <Save size={16} />}
                </button>
              </div>
            </div>
        </div>
      </div>

      {/* 区块3：费用报销模板配置 */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <FileText size={20} className="text-primary-500" />
          <h2 className="text-lg font-semibold text-gray-800">费用报销模板配置</h2>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">审批模板ID</label>
            <input
              type="text"
              value={getFieldValue('approval_template_id')}
              onChange={(e) => setFieldValue('approval_template_id', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
              placeholder="模板ID"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">申请人UserID</label>
            <input
              type="text"
              value={getFieldValue('applicant_userid')}
              onChange={(e) => setFieldValue('applicant_userid', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
              placeholder="你的企微userid"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">付款方式选项</label>
            <div className="space-y-2">
              {(config.payment_options || []).map((opt, idx) => (
                <div key={idx} className="flex gap-2">
                  <input
                    type="text"
                    value={opt.label}
                    onChange={(e) => {
                      const newOpts = [...(config.payment_options || [])];
                      newOpts[idx] = { ...opt, label: e.target.value };
                      setConfig(prev => ({ ...prev, payment_options: newOpts }));
                    }}
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                    placeholder="显示名称"
                  />
                  <input
                    type="text"
                    value={opt.key}
                    onChange={(e) => {
                      const newOpts = [...(config.payment_options || [])];
                      newOpts[idx] = { ...opt, key: e.target.value };
                      setConfig(prev => ({ ...prev, payment_options: newOpts }));
                    }}
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                    placeholder="选项key"
                  />
                  <button
                    onClick={() => {
                      const newOpts = (config.payment_options || []).filter((_, i) => i !== idx);
                      setConfig(prev => ({ ...prev, payment_options: newOpts }));
                    }}
                    className="px-3 text-gray-400 hover:text-danger-500"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                onClick={() => {
                  const newOpts = [...(config.payment_options || []), { label: '', key: '' }];
                  setConfig(prev => ({ ...prev, payment_options: newOpts }));
                }}
                className="text-sm text-primary-500 hover:text-primary-600"
              >
                + 添加选项
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">默认付款方式</label>
            <select
              value={config.default_payment_key || ''}
              onChange={(e) => setConfig(prev => ({ ...prev, default_payment_key: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
            >
              <option value="">请选择</option>
              {(config.payment_options || []).map((opt, idx) => (
                <option key={idx} value={opt.key}>{opt.label}</option>
              ))}
            </select>
          </div>

          {templateControls.length > 0 && (
            <div className="border-t border-gray-100 pt-4">
              <div className="flex items-center gap-2 mb-3">
                <Link2 size={16} className="text-primary-500" />
                <label className="text-sm font-medium text-gray-700">模板字段映射</label>
              </div>
              <p className="text-xs text-gray-500 mb-3">将系统字段映射到审批模板中的对应控件，配置完成后自动发起报销时会自动填充</p>
              <div className="space-y-2">
                {FIELD_MAPPING_OPTIONS.map(field => (
                  <div key={field.key} className="flex items-center gap-3">
                    <div className="w-28 text-xs text-gray-600 flex-shrink-0">
                      {field.label}
                      <span className="text-gray-400 ml-1">({field.control})</span>
                    </div>
                    <select
                      value={config.approval_field_mapping?.[field.key] || ''}
                      onChange={(e) => {
                        const newMapping = { ...(config.approval_field_mapping || {}), [field.key]: e.target.value || '' };
                        if (!e.target.value) delete newMapping[field.key];
                        setConfig(prev => ({ ...prev, approval_field_mapping: newMapping }));
                      }}
                      className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                    >
                      <option value="">-- 请选择对应字段 --</option>
                      {templateControls.map(ctrl => (
                        <option key={ctrl.id} value={ctrl.id}>
                          {ctrl.label} ({ctrl.control})
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <div className="mt-3 bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-600">
                <p>💡 提示：至少配置"报销金额"和"付款事由"字段，其他字段可选</p>
              </div>
            </div>
          )}

          <div className="flex justify-between items-center">
            <button
              onClick={handleFetchTemplate}
              className="btn-secondary flex items-center gap-2"
            >
              <RefreshCw size={16} />
              拉取模板结构
            </button>
            <button
              onClick={() => saveSection('报销模板', {
                approval_template_id: getFieldValue('approval_template_id'),
                applicant_userid: getFieldValue('applicant_userid'),
                payment_options: config.payment_options,
                default_payment_key: config.default_payment_key,
                approval_field_mapping: config.approval_field_mapping,
              })}
              disabled={sectionStatus['报销模板'] === 'saving'}
              className="btn-primary flex items-center gap-2 disabled:opacity-50"
            >
              {sectionStatus['报销模板'] === 'saving' ? '保存中...' : sectionStatus['报销模板'] === 'saved' ? '已保存' : '保存配置'}
              {sectionStatus['报销模板'] !== 'saving' && <Save size={16} />}
            </button>
          </div>
        </div>
      </div>

      {/* 区块3.5：仓库采购审批配置 */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <FileText size={20} className="text-accent-500" />
          <h2 className="text-lg font-semibold text-gray-800">仓库采购审批配置</h2>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">仓库审批模板ID</label>
            <input
              type="text"
              value={getFieldValue('warehouse_approval_template_id')}
              onChange={(e) => setFieldValue('warehouse_approval_template_id', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
              placeholder="仓库采购审批模板ID"
            />
            <p className="text-xs text-gray-500 mt-1">审批申请人将自动使用当前登录用户的企微账号提交（需在用户管理中绑定企微userid），未绑定时回退到费用报销模板中的申请人配置</p>
          </div>

          {warehouseTemplateControls.length > 0 && (
            <div className="border-t border-gray-100 pt-4">
              <div className="flex items-center gap-2 mb-3">
                <Link2 size={16} className="text-primary-500" />
                <label className="text-sm font-medium text-gray-700">模板字段映射</label>
              </div>
              <p className="text-xs text-gray-500 mb-3">将系统字段映射到仓库审批模板中的对应控件</p>
              <div className="space-y-2">
                {WAREHOUSE_FIELD_MAPPING_OPTIONS.map(field => (
                  <div key={field.key} className="flex items-center gap-3">
                    <div className="w-28 text-xs text-gray-600 flex-shrink-0">
                      {field.label}
                      <span className="text-gray-400 ml-1">({field.control})</span>
                    </div>
                    <select
                      value={config.warehouse_field_mapping?.[field.key] || ''}
                      onChange={(e) => {
                        const newMapping = { ...(config.warehouse_field_mapping || {}), [field.key]: e.target.value || '' };
                        if (!e.target.value) delete newMapping[field.key];
                        setConfig(prev => ({ ...prev, warehouse_field_mapping: newMapping }));
                      }}
                      className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                    >
                      <option value="">-- 请选择对应字段 --</option>
                      {warehouseTemplateControls.map(ctrl => (
                        <option key={ctrl.id} value={ctrl.id}>
                          {ctrl.label} ({ctrl.control})
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              {config.warehouse_dept_options && config.warehouse_dept_options.length > 0 && (
                <div className="mt-3 bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-600">
                  <p>💡 已缓存{config.warehouse_dept_options.length}个部门选项：</p>
                  <p className="mt-1">{config.warehouse_dept_options.map(o => o.text).join('、')}</p>
                  <p className="mt-1">提交审批时按名称自动匹配，未匹配部门会在事由中体现</p>
                </div>
              )}
            </div>
          )}

          <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 text-xs text-amber-700">
            <p>💡 使用说明：</p>
            <p>1. 填写模板ID后点「拉取模板结构」获取控件列表</p>
            <p>2. 申购部门支持多选（MultiSelector），按名称自动匹配系统部门</p>
            <p>3. 请确保企微模板部门名与系统部门名尽量一致</p>
            <p>4. 未匹配的部门会在申购事由中体现，信息不丢失</p>
          </div>

          <div className="flex justify-between items-center">
            <button
              onClick={handleFetchWarehouseTemplate}
              className="btn-secondary flex items-center gap-2"
            >
              <RefreshCw size={16} />
              拉取模板结构
            </button>
            <button
              onClick={() => saveSection('仓库审批', {
                warehouse_approval_template_id: getFieldValue('warehouse_approval_template_id'),
                warehouse_field_mapping: config.warehouse_field_mapping,
                warehouse_dept_options: config.warehouse_dept_options,
              })}
              disabled={sectionStatus['仓库审批'] === 'saving'}
              className="btn-primary flex items-center gap-2 disabled:opacity-50"
            >
              {sectionStatus['仓库审批'] === 'saving' ? '保存中...' : sectionStatus['仓库审批'] === 'saved' ? '已保存' : '保存配置'}
              {sectionStatus['仓库审批'] !== 'saving' && <Save size={16} />}
            </button>
          </div>
        </div>
      </div>

      {/* 区块4：固定报销信息 */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <DollarSign size={20} className="text-primary-500" />
          <h2 className="text-lg font-semibold text-gray-800">固定报销信息</h2>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">收款人</label>
            <input
              type="text"
              value={getFieldValue('payee_name')}
              onChange={(e) => setFieldValue('payee_name', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
              placeholder="收款人姓名"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">开户行</label>
            <input
              type="text"
              value={getFieldValue('bank_name')}
              onChange={(e) => setFieldValue('bank_name', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
              placeholder="如：中国工商银行XX支行"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">银行账号</label>
            <div className="relative">
              <input
                type={showSecrets.bank_account ? 'text' : 'password'}
                value={getFieldValue('bank_account')}
                onChange={(e) => setFieldValue('bank_account', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-4 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                placeholder="银行账号"
              />
              <button
                type="button"
                onClick={() => toggleSecret('bank_account')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showSecrets.bank_account ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">付款事由模板</label>
            <input
              type="text"
              value={getFieldValue('payment_reason_template')}
              onChange={(e) => setFieldValue('payment_reason_template', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
              placeholder="{date}食材采购费用"
            />
            <p className="text-xs text-gray-500 mt-1">{'{date}会自动替换为采购日期，如：2026-07-10食材采购费用'}</p>
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => saveSection('报销信息', {
                payee_name: getFieldValue('payee_name'),
                bank_name: getFieldValue('bank_name'),
                bank_account: getFieldValue('bank_account'),
                payment_reason_template: getFieldValue('payment_reason_template'),
              })}
              disabled={sectionStatus['报销信息'] === 'saving'}
              className="btn-primary flex items-center gap-2 disabled:opacity-50"
            >
              {sectionStatus['报销信息'] === 'saving' ? '保存中...' : sectionStatus['报销信息'] === 'saved' ? '已保存' : '保存配置'}
              {sectionStatus['报销信息'] !== 'saving' && <Save size={16} />}
            </button>
          </div>
        </div>
      </div>

      {/* 区块5：回调配置 */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <RefreshCw size={20} className="text-primary-500" />
          <h2 className="text-lg font-semibold text-gray-800">回调配置</h2>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">回调Token</label>
            <input
              type="text"
              value={getFieldValue('callback_token')}
              onChange={(e) => setFieldValue('callback_token', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
              placeholder="自定义Token"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">EncodingAESKey</label>
            <div className="relative">
              <input
                type={showSecrets.callback_aes_key ? 'text' : 'password'}
                value={getFieldValue('callback_aes_key')}
                onChange={(e) => setFieldValue('callback_aes_key', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-4 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                placeholder="EncodingAESKey"
              />
              <button
                type="button"
                onClick={() => toggleSecret('callback_aes_key')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showSecrets.callback_aes_key ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">回调URL（只读）</label>
            <input
              type="text"
              value={`${window.location.origin}/api/wecom/callback`}
              readOnly
              className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm bg-gray-50 text-gray-500"
            />
          </div>
          <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-500">
            <p>📌 配置方式：企微管理后台 → 应用管理 → 你的应用 → 接收消息 → 设置API接收</p>
            <p>→ 填入上方URL、Token、EncodingAESKey</p>
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => saveSection('回调配置', {
                callback_token: getFieldValue('callback_token'),
                callback_aes_key: getFieldValue('callback_aes_key'),
              })}
              disabled={sectionStatus['回调配置'] === 'saving'}
              className="btn-primary flex items-center gap-2 disabled:opacity-50"
            >
              {sectionStatus['回调配置'] === 'saving' ? '保存中...' : sectionStatus['回调配置'] === 'saved' ? '已保存' : '保存配置'}
              {sectionStatus['回调配置'] !== 'saving' && <Save size={16} />}
            </button>
          </div>
        </div>
      </div>

      {/* 回调日志弹窗 */}
      {showCallbackLogs && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowCallbackLogs(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[70vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-800">最近回调消息（可查看群ID）</h3>
              <button onClick={() => setShowCallbackLogs(false)} className="p-1 hover:bg-gray-100 rounded-md">
                <X size={20} className="text-gray-500" />
              </button>
            </div>
            <div className="p-6 space-y-3">
              {callbackLogs.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <MessageSquare size={40} className="mx-auto mb-2 opacity-30" />
                  <p>暂无回调消息</p>
                  <p className="text-xs mt-1">请先配置好回调URL，然后在群里发一条消息</p>
                </div>
              ) : (
                callbackLogs.map(log => (
                  <div key={log.id} className="border border-gray-200 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-gray-500">
                        {new Date(log.created_at).toLocaleString()}
                      </span>
                      {log.chat_id && (
                        <button
                          onClick={() => {
                            setFieldValue('chat_id', log.chat_id);
                            setShowCallbackLogs(false);
                          }}
                          className="text-xs text-primary-500 hover:text-primary-600 flex items-center gap-1"
                        >
                          使用此群ID
                        </button>
                      )}
                    </div>
                    {log.chat_id && (
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs text-gray-400">群ID:</span>
                        <code className="bg-gray-100 px-2 py-0.5 rounded text-xs font-mono flex-1">{log.chat_id}</code>
                        <button onClick={() => copyToClipboard(log.chat_id)} className="text-xs text-gray-500 hover:text-primary-500">复制</button>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
                      <div>类型: {log.msg_type || '-'}</div>
                      <div>发送者: {log.from_user || '-'}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="p-4 border-t border-gray-100 flex justify-between">
              <button
                onClick={fetchCallbackLogs}
                className="btn-secondary flex items-center gap-2"
              >
                <RefreshCw size={16} />
                刷新
              </button>
              <button
                onClick={() => setShowCallbackLogs(false)}
                className="btn-primary"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
