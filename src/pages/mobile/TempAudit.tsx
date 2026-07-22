import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';

interface CheckinRecord {
  id: string;
  user_source: string;
  user_id: string;
  user_name: string;
  user_phone: string;
  position_id: string;
  position_name: string;
  position_type: string;
  department_id: string;
  department_name: string;
  checkin_date: string;
  hours: number | null;
  amount: number;
  status: 'pending' | 'approved' | 'rejected';
  audit_by: string;
  audit_note: string;
  audited_at: string;
  is_add_record: number;
  add_reason: string;
  assessment_status: string;
  assessment_discount: number;
  assessed_at: string;
  created_at: string;
}

interface Stats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  approved_amount: number;
  pending_amount: number;
}

export default function TempAudit() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const token = user?.token;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [records, setRecords] = useState<CheckinRecord[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [activeTab, setActiveTab] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [selectedRecord, setSelectedRecord] = useState<CheckinRecord | null>(null);
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [auditAction, setAuditAction] = useState<'approve' | 'reject'>('approve');
  const [auditNote, setAuditNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    fetchData();
  }, [activeTab]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const recordsUrl = activeTab === 'pending'
        ? '/temp/checkins/pending'
        : `/temp/checkins/approved?status=${activeTab}`;
      const [recordsRes, statsRes] = await Promise.all([
        api.get<CheckinRecord[]>(recordsUrl, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        api.get<Stats>('/temp/checkins/audit/stats', {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      setRecords(recordsRes || []);
      setStats(statsRes);
    } catch (err: any) {
      console.error('获取审核数据失败:', err);
      setError(err.message || '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleAudit = (record: CheckinRecord, action: 'approve' | 'reject') => {
    setSelectedRecord(record);
    setAuditAction(action);
    setAuditNote('');
    setShowAuditModal(true);
  };

  const submitAudit = async () => {
    if (!selectedRecord) return;
    if (auditAction === 'reject' && !auditNote.trim()) {
      setError('请填写驳回原因');
      return;
    }

    try {
      setSubmitting(true);
      const url = `/temp/checkins/${selectedRecord.id}/${auditAction}`;
      const body: any = {};
      if (auditAction === 'reject') {
        body.audit_note = auditNote.trim();
      }
      await api.post(url, body, {
        headers: { Authorization: `Bearer ${token}` },
      });

      setShowAuditModal(false);
      setSelectedRecord(null);
      setAuditNote('');
      fetchData();
    } catch (err: any) {
      setError(err.message || '审核失败');
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'pending': return '待审核';
      case 'approved': return '已通过';
      case 'rejected': return '已驳回';
      default: return status;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-700';
      case 'approved': return 'bg-green-100 text-green-700';
      case 'rejected': return 'bg-red-100 text-red-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const getAssessmentText = (status: string, discount: number) => {
    if (status === 'discounted') return `${(discount * 100).toFixed(0)}%结算`;
    if (status === 'passed') return '考核通过';
    if (status === 'pending') return '待考核';
    return '';
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-blue-600 to-purple-600 text-white px-6 pt-12 pb-8 rounded-b-3xl">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => navigate('/m')}
            className="p-2 -ml-2 hover:bg-white/10 rounded-lg"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-xl font-bold">打卡审核</h1>
          <button
            onClick={() => navigate('/m/temp-stats')}
            className="px-3 py-1.5 bg-white/20 rounded-lg text-sm"
          >
            统计
          </button>
        </div>

        {stats && (
          <div className="grid grid-cols-4 gap-2">
            <div className="text-center">
              <p className="text-2xl font-bold">{stats.total}</p>
              <p className="text-xs text-white/70">总计</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">{stats.pending}</p>
              <p className="text-xs text-white/70">待审核</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">{stats.approved}</p>
              <p className="text-xs text-white/70">已通过</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">¥{stats.approved_amount}</p>
              <p className="text-xs text-white/70">通过金额</p>
            </div>
          </div>
        )}
      </div>

      <div className="px-4 -mt-4 pb-8">
        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-xl text-sm">{error}</div>
        )}

        <div className="bg-white rounded-2xl shadow-sm p-1 mb-4 flex">
          {(['pending', 'approved', 'rejected'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'bg-blue-500 text-white'
                  : 'text-gray-600'
              }`}
            >
              {getStatusText(tab)}
              {tab === 'pending' && stats && stats.pending > 0 && (
                <span className="ml-1 px-1.5 py-0.5 bg-red-500 text-white text-xs rounded-full">
                  {stats.pending}
                </span>
              )}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-8">
            <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500"></div>
            <p className="text-gray-500 text-sm mt-2">加载中...</p>
          </div>
        ) : records.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <svg className="w-16 h-16 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-sm">暂无{getStatusText(activeTab)}记录</p>
          </div>
        ) : (
          <div className="space-y-3">
            {records.map(record => (
              <div key={record.id} className="bg-white rounded-2xl shadow-sm p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-800">{record.user_name}</h3>
                      {record.is_add_record === 1 && (
                        <span className="text-xs px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded">补录</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{record.position_name} · {record.department_name}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full ${getStatusColor(record.status)}`}>
                    {getStatusText(record.status)}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <p className="text-xs text-gray-400">日期</p>
                    <p className="text-gray-700">{record.checkin_date}</p>
                  </div>
                  {record.hours && (
                    <div>
                      <p className="text-xs text-gray-400">工时</p>
                      <p className="text-gray-700">{record.hours}小时</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-gray-400">金额</p>
                    <p className="text-gray-700 font-semibold">¥{record.amount}</p>
                  </div>
                </div>

                {record.audit_note && record.status === 'rejected' && (
                  <div className="mt-2 text-xs text-red-600 bg-red-50 p-2 rounded">
                    驳回原因：{record.audit_note}
                  </div>
                )}

                {record.assessment_status && record.assessment_status !== 'pending' && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      record.assessment_status === 'discounted'
                        ? 'bg-orange-100 text-orange-700'
                        : 'bg-green-100 text-green-700'
                    }`}>
                      {getAssessmentText(record.assessment_status, record.assessment_discount)}
                    </span>
                  </div>
                )}

                {record.status === 'pending' && (
                  <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100">
                    <button
                      onClick={() => handleAudit(record, 'reject')}
                      className="flex-1 py-2 bg-red-50 text-red-600 rounded-lg text-sm font-medium active:scale-95 transition-transform"
                    >
                      驳回
                    </button>
                    <button
                      onClick={() => handleAudit(record, 'approve')}
                      className="flex-1 py-2 bg-green-500 text-white rounded-lg text-sm font-medium active:scale-95 transition-transform"
                    >
                      通过
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {showAuditModal && selectedRecord && (
        <div className="fixed inset-0 bg-black/50 flex items-end justify-center z-50" onClick={() => setShowAuditModal(false)}>
          <div className="bg-white w-full max-w-md rounded-t-3xl p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-800">
                {auditAction === 'approve' ? '确认通过' : '确认驳回'}
              </h3>
              <button onClick={() => setShowAuditModal(false)} className="text-gray-400">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="bg-gray-50 rounded-xl p-3 mb-4">
              <p className="text-sm text-gray-700">
                <span className="font-medium">{selectedRecord.user_name}</span> · {selectedRecord.position_name}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {selectedRecord.checkin_date} {selectedRecord.hours && `· ${selectedRecord.hours}小时`} · ¥{selectedRecord.amount}
              </p>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {auditAction === 'reject' ? '驳回原因 *' : '审核备注'}
              </label>
              <textarea
                value={auditNote}
                onChange={(e) => setAuditNote(e.target.value)}
                rows={3}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none"
                placeholder={auditAction === 'reject' ? '请填写驳回原因（必填）' : '可填写审核备注（选填）'}
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowAuditModal(false)}
                className="flex-1 py-3 bg-gray-100 text-gray-600 rounded-xl font-medium"
              >
                取消
              </button>
              <button
                onClick={submitAudit}
                disabled={submitting}
                className={`flex-1 py-3 text-white rounded-xl font-medium disabled:opacity-50 ${
                  auditAction === 'approve' ? 'bg-green-500' : 'bg-red-500'
                }`}
              >
                {submitting ? '提交中...' : `确认${auditAction === 'approve' ? '通过' : '驳回'}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
