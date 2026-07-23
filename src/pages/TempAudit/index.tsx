import { useState, useEffect } from 'react';
import { Check, X, Calendar, Clock, DollarSign, User, Building, Filter, Search, Users } from 'lucide-react';
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

interface Position {
  id: string;
  name: string;
  department_name: string;
  type: string;
  pay_type: string;
  rate: number;
  status?: number;
}

const ADD_REASON_OPTIONS = [
  { value: 'no_phone', label: '老人无手机' },
  { value: 'phone_dead', label: '手机没电' },
  { value: 'forgot', label: '忘记打卡' },
  { value: 'other', label: '其他' },
];

export default function TempAudit() {
  const { user } = useAuthStore();
  const token = user?.token;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [records, setRecords] = useState<CheckinRecord[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [activeTab, setActiveTab] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [selectedRecord, setSelectedRecord] = useState<CheckinRecord | null>(null);
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [showAddRecordModal, setShowAddRecordModal] = useState(false);
  const [auditAction, setAuditAction] = useState<'approve' | 'reject'>('approve');
  const [auditNote, setAuditNote] = useState('');
  const [assignPositionId, setAssignPositionId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [addRecordForm, setAddRecordForm] = useState({
    user_name: '',
    user_phone: '',
    position_id: '',
    checkin_date: new Date().toISOString().split('T')[0],
    hours: '',
    add_reason: '',
  });
  const [showReAuditModal, setShowReAuditModal] = useState(false);
  const [reAuditForm, setReAuditForm] = useState({
    adjust_amount: '',
    assign_position_id: '',
    audit_note: '',
  });

  useEffect(() => {
    fetchData();
  }, [activeTab]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const [recordsRes, statsRes, positionsRes] = await Promise.all([
        api.get<CheckinRecord[]>(`/temp/checkins/${activeTab === 'rejected' ? 'approved' : activeTab}`, {
          headers: { Authorization: `Bearer ${token}` },
          params: activeTab === 'rejected' ? { status: 'rejected' } : activeTab === 'approved' ? { status: 'approved' } : {},
        }),
        api.get<Stats>('/temp/checkins/audit/stats', {
          headers: { Authorization: `Bearer ${token}` },
        }),
        api.get<Position[]>('/temp/positions', {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      setRecords(recordsRes || []);
      setStats(statsRes);
      setPositions(positionsRes || []);
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
    setAssignPositionId('');
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
      const body: any = {
        audit_note: auditNote.trim() || null,
      };

      if (auditAction === 'approve') {
        if (assignPositionId) {
          body.assign_position_id = assignPositionId;
        }
        await api.post(`/temp/checkins/${selectedRecord.id}/approve`, body, {
          headers: { Authorization: `Bearer ${token}` },
        });
      } else {
        await api.post(`/temp/checkins/${selectedRecord.id}/reject`, body, {
          headers: { Authorization: `Bearer ${token}` },
        });
      }

      setShowAuditModal(false);
      setSelectedRecord(null);
      setAuditNote('');
      setAssignPositionId('');
      fetchData();
    } catch (err: any) {
      setError(err.message || '审核失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReAudit = (record: CheckinRecord) => {
    setSelectedRecord(record);
    setReAuditForm({
      adjust_amount: '',
      assign_position_id: '',
      audit_note: '',
    });
    setShowReAuditModal(true);
  };

  const submitReAudit = async () => {
    if (!selectedRecord) return;

    try {
      setSubmitting(true);
      const body: any = {};
      if (reAuditForm.adjust_amount) body.adjust_amount = parseFloat(reAuditForm.adjust_amount);
      if (reAuditForm.assign_position_id) body.assign_position_id = reAuditForm.assign_position_id;
      if (reAuditForm.audit_note) body.audit_note = reAuditForm.audit_note;

      await api.put(`/temp/checkins/${selectedRecord.id}/re-audit`, body, {
        headers: { Authorization: `Bearer ${token}` },
      });

      setShowReAuditModal(false);
      setSelectedRecord(null);
      setReAuditForm({ adjust_amount: '', assign_position_id: '', audit_note: '' });
      fetchData();
    } catch (err: any) {
      setError(err.message || '修改失败');
    } finally {
      setSubmitting(false);
    }
  };

  const isTempPosition = (record: CheckinRecord) => {
    return record.position_name?.trim() === '临时岗位';
  };

  const formatCheckinDate = (dateStr: string) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const handleOpenAddRecord = () => {
    setAddRecordForm({
      user_name: '',
      user_phone: '',
      position_id: '',
      checkin_date: new Date().toISOString().split('T')[0],
      hours: '',
      add_reason: '',
    });
    setShowAddRecordModal(true);
  };

  const handleAddRecordFieldChange = (field: string, value: string) => {
    setAddRecordForm(prev => ({ ...prev, [field]: value }));
  };

  const submitAddRecord = async () => {
    if (!addRecordForm.user_name || !addRecordForm.position_id || !addRecordForm.checkin_date) {
      setError('请填写姓名、岗位和日期');
      return;
    }

    try {
      setSubmitting(true);
      await api.post('/temp/checkins/add-record', {
        ...addRecordForm,
        hours: addRecordForm.hours ? parseFloat(addRecordForm.hours) : null,
      }, {
        headers: { Authorization: `Bearer ${token}` },
      });

      setShowAddRecordModal(false);
      setAddRecordForm({
        user_name: '',
        user_phone: '',
        position_id: '',
        checkin_date: new Date().toISOString().split('T')[0],
        hours: '',
        add_reason: '',
      });
      fetchData();
    } catch (err: any) {
      setError(err.message || '补录失败');
    } finally {
      setSubmitting(false);
    }
  };

  const getSelectedPosition = () => {
    return positions.find(p => p.id === addRecordForm.position_id);
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

  const filteredRecords = records.filter(r => 
    r.user_name.includes(searchKeyword) || 
    r.position_name.includes(searchKeyword) ||
    r.department_name.includes(searchKeyword)
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold text-gray-800">打卡审核</h1>
          <p className="text-gray-500 mt-1">审核外请人员的打卡记录</p>
        </div>
      </div>

      {error && (
        <div className="bg-danger-50 border border-danger-200 rounded-lg p-4 flex items-center gap-3">
          <X size={20} className="text-danger-500" />
          <span className="text-danger-700">{error}</span>
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-5 gap-4">
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                <User size={20} className="text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-800">{stats.total}</p>
                <p className="text-sm text-gray-500">总记录</p>
              </div>
            </div>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-yellow-100 rounded-xl flex items-center justify-center">
                <Clock size={20} className="text-yellow-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-800">{stats.pending}</p>
                <p className="text-sm text-gray-500">待审核</p>
              </div>
            </div>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
                <Check size={20} className="text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-800">{stats.approved}</p>
                <p className="text-sm text-gray-500">已通过</p>
              </div>
            </div>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center">
                <X size={20} className="text-red-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-800">{stats.rejected}</p>
                <p className="text-sm text-gray-500">已驳回</p>
              </div>
            </div>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
                <DollarSign size={20} className="text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-800">¥{stats.approved_amount}</p>
                <p className="text-sm text-gray-500">通过金额</p>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {(['pending', 'approved', 'rejected'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === tab
                    ? 'bg-primary-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {getStatusText(tab)}
                {tab === 'pending' && stats && stats.pending > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.5 bg-red-500 text-white text-xs rounded-full">
                    {stats.pending}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleOpenAddRecord}
              className="px-4 py-2 bg-green-500 text-white rounded-lg text-sm font-medium hover:bg-green-600 transition-colors flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              补录打卡
            </button>
            <div className="relative">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                placeholder="搜索姓名、岗位、部门..."
                className="pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
              />
            </div>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-10 text-gray-500">加载中...</div>
        ) : filteredRecords.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <Filter size={48} className="mx-auto mb-2 opacity-50" />
            <p>暂无{getStatusText(activeTab)}记录</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 font-medium text-gray-600">姓名</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">岗位</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">部门</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">日期</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">工时</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">金额</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">考核</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">状态</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">备注</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.map(record => (
                  <tr key={record.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-800">{record.user_name}</span>
                        {record.is_add_record === 1 && (
                          <span className="text-xs px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded">补录</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-400">{record.user_phone || '-'}</div>
                    </td>
                    <td className="py-4 px-4">
                      <div className="text-sm text-gray-700">{record.position_name}</div>
                      <div className={`text-xs ${record.position_type === 'external' ? 'text-orange-500' : 'text-blue-500'}`}>
                        {record.position_type === 'external' ? '外请' : '内部'}
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <div className="text-sm text-gray-600">{record.department_name}</div>
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-1 text-sm text-gray-700">
                        <Calendar size={14} className="text-gray-400" />
                        {formatCheckinDate(record.checkin_date)}
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      {record.hours ? (
                        <div className="flex items-center gap-1 text-sm text-gray-700">
                          <Clock size={14} className="text-gray-400" />
                          {record.hours}小时
                        </div>
                      ) : (
                        <span className="text-sm text-gray-400">-</span>
                      )}
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-1">
                        <DollarSign size={14} className="text-gray-400" />
                        <span className="font-medium">¥{record.amount}</span>
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      {record.assessment_status === 'discounted' ? (
                        <span className="text-sm text-orange-600">{(record.assessment_discount * 100).toFixed(0)}%结算</span>
                      ) : record.assessment_status === 'passed' ? (
                        <span className="text-sm text-green-600">考核通过</span>
                      ) : record.assessment_status === 'pending' ? (
                        <span className="text-sm text-yellow-600">待考核</span>
                      ) : (
                        <span className="text-sm text-gray-400">-</span>
                      )}
                    </td>
                    <td className="py-4 px-4">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${getStatusColor(record.status)}`}>
                        {getStatusText(record.status)}
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      {record.audit_note && record.status === 'rejected' ? (
                        <div className="text-xs text-red-600 max-w-xs truncate">{record.audit_note}</div>
                      ) : record.add_reason && record.is_add_record === 1 ? (
                        <div className="text-xs text-orange-600 max-w-xs truncate">{record.add_reason}</div>
                      ) : (
                        <span className="text-xs text-gray-400">-</span>
                      )}
                    </td>
                    <td className="py-4 px-4">
                      {record.status === 'pending' && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleAudit(record, 'reject')}
                            className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-sm font-medium hover:bg-red-100 transition-colors"
                          >
                            驳回
                          </button>
                          <button
                            onClick={() => handleAudit(record, 'approve')}
                            className="px-3 py-1.5 bg-green-50 text-green-600 rounded-lg text-sm font-medium hover:bg-green-100 transition-colors"
                          >
                            通过
                          </button>
                        </div>
                      )}
                      {(record.status === 'approved' || record.status === 'rejected') && (
                        <button
                          onClick={() => handleReAudit(record)}
                          className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-sm font-medium hover:bg-blue-100 transition-colors"
                        >
                          重新审核
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAuditModal && selectedRecord && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowAuditModal(false)}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-800">
                {auditAction === 'approve' ? '确认通过' : '确认驳回'}
              </h3>
              <button onClick={() => setShowAuditModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <div className="bg-gray-50 rounded-xl p-4 mb-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 bg-primary-500 rounded-full flex items-center justify-center text-white font-medium">
                  {selectedRecord.user_name.charAt(0)}
                </div>
                <div>
                  <p className="font-medium text-gray-800">{selectedRecord.user_name}</p>
                  <p className="text-xs text-gray-500">{selectedRecord.position_name} · {selectedRecord.department_name}</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <span className="text-gray-400">日期：</span>
                  <span className="text-gray-700">{formatCheckinDate(selectedRecord.checkin_date)}</span>
                </div>
                <div>
                  <span className="text-gray-400">工时：</span>
                  <span className="text-gray-700">{selectedRecord.hours || '-'}小时</span>
                </div>
                <div>
                  <span className="text-gray-400">金额：</span>
                  <span className="text-gray-700 font-semibold">¥{selectedRecord.amount}</span>
                </div>
              </div>
            </div>

            {auditAction === 'approve' && isTempPosition(selectedRecord) && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <Users size={14} className="inline mr-1" />
                  分配岗位
                </label>
                <select
                  value={assignPositionId}
                  onChange={(e) => setAssignPositionId(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                >
                  <option value="">不分配，保持临时岗位</option>
                  {positions.filter(p => p.name !== '临时岗位' && p.status != 0).map(pos => (
                    <option key={pos.id} value={pos.id}>
                      {pos.department_name} / {pos.name} ({pos.type === 'external' ? '外请' : '内部'}) - ¥{pos.rate}/{pos.pay_type === 'per_hour' ? '小时' : '次'}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 mt-1">
                  分配岗位后，用户下次打卡可直接选择该岗位
                </p>
              </div>
            )}

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {auditAction === 'reject' ? '驳回原因 *' : '审核备注'}
              </label>
              <textarea
                value={auditNote}
                onChange={(e) => setAuditNote(e.target.value)}
                rows={3}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 resize-none"
                placeholder={auditAction === 'reject' ? '请填写驳回原因（必填）' : '可填写审核备注（选填）'}
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowAuditModal(false)}
                className="flex-1 py-3 bg-gray-100 text-gray-600 rounded-xl font-medium hover:bg-gray-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={submitAudit}
                disabled={submitting}
                className={`flex-1 py-3 text-white rounded-xl font-medium disabled:opacity-50 ${
                  auditAction === 'approve' ? 'bg-green-500 hover:bg-green-600' : 'bg-red-500 hover:bg-red-600'
                }`}
              >
                {submitting ? '提交中...' : `确认${auditAction === 'approve' ? '通过' : '驳回'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {showReAuditModal && selectedRecord && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowReAuditModal(false)}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-800">重新审核</h3>
              <button onClick={() => setShowReAuditModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <div className="bg-gray-50 rounded-xl p-4 mb-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 bg-primary-500 rounded-full flex items-center justify-center text-white font-medium">
                  {selectedRecord.user_name.charAt(0)}
                </div>
                <div>
                  <p className="font-medium text-gray-800">{selectedRecord.user_name}</p>
                  <p className="text-xs text-gray-500">{selectedRecord.position_name} · {selectedRecord.department_name}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-gray-400">日期：</span>
                  <span className="text-gray-700">{formatCheckinDate(selectedRecord.checkin_date)}</span>
                </div>
                <div>
                  <span className="text-gray-400">当前金额：</span>
                  <span className="text-gray-700 font-semibold">¥{selectedRecord.amount}</span>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">重新分配岗位</label>
                <select
                  value={reAuditForm.assign_position_id}
                  onChange={(e) => setReAuditForm(prev => ({ ...prev, assign_position_id: e.target.value }))}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                >
                  <option value="">不修改岗位</option>
                  {positions.filter(p => p.name !== '临时岗位' && p.status != 0).map(pos => (
                    <option key={pos.id} value={pos.id}>
                      {pos.department_name} / {pos.name} ({pos.type === 'external' ? '外请' : '内部'}) - ¥{pos.rate}/{pos.pay_type === 'per_hour' ? '小时' : '次'}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">调整金额</label>
                <input
                  type="number"
                  step="0.01"
                  value={reAuditForm.adjust_amount}
                  onChange={(e) => setReAuditForm(prev => ({ ...prev, adjust_amount: e.target.value }))}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  placeholder="留空则保持原金额或使用岗位单价"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">备注</label>
                <textarea
                  value={reAuditForm.audit_note}
                  onChange={(e) => setReAuditForm(prev => ({ ...prev, audit_note: e.target.value }))}
                  rows={2}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 resize-none"
                  placeholder="可填写修改原因"
                />
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setShowReAuditModal(false)}
                className="flex-1 py-3 bg-gray-100 text-gray-600 rounded-xl font-medium hover:bg-gray-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={submitReAudit}
                disabled={submitting}
                className="flex-1 py-3 bg-blue-500 text-white rounded-xl font-medium hover:bg-blue-600 transition-colors disabled:opacity-50"
              >
                {submitting ? '提交中...' : '确认修改'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddRecordModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowAddRecordModal(false)}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-800">补录打卡</h3>
              <button onClick={() => setShowAddRecordModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">姓名 *</label>
                <input
                  type="text"
                  value={addRecordForm.user_name}
                  onChange={(e) => handleAddRecordFieldChange('user_name', e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  placeholder="输入姓名后自动匹配已注册用户"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">手机号</label>
                <input
                  type="tel"
                  value={addRecordForm.user_phone}
                  onChange={(e) => handleAddRecordFieldChange('user_phone', e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  placeholder="可选，用于区分同名用户"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">岗位 *</label>
                <select
                  value={addRecordForm.position_id}
                  onChange={(e) => handleAddRecordFieldChange('position_id', e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                >
                  <option value="">请选择岗位</option>
                  {positions.filter(p => p.name !== '临时岗位' && p.status != 0).map(pos => (
                    <option key={pos.id} value={pos.id}>
                      {pos.department_name} / {pos.name} ({pos.type === 'external' ? '外请' : '内部'}) - ¥{pos.rate}/{pos.pay_type === 'per_hour' ? '小时' : '次'}
                    </option>
                  ))}
                </select>
              </div>

              {getSelectedPosition()?.pay_type === 'per_hour' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">工作小时数</label>
                  <input
                    type="number"
                    step="0.5"
                    value={addRecordForm.hours}
                    onChange={(e) => handleAddRecordFieldChange('hours', e.target.value)}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                    placeholder="请输入工作小时数"
                  />
                  {getSelectedPosition() && (
                    <p className="text-xs text-gray-400 mt-1">
                      单价 ¥{getSelectedPosition()?.rate}/小时，预计 ¥{(parseFloat(addRecordForm.hours) || 0) * (getSelectedPosition()?.rate || 0)}
                    </p>
                  )}
                </div>
              )}

              {getSelectedPosition()?.pay_type === 'per_time' && (
                <div className="p-3 bg-gray-50 rounded-xl">
                  <p className="text-sm text-gray-600">
                    按次计费：<span className="font-semibold text-orange-600">¥{getSelectedPosition()?.rate}</span>
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">补录原因</label>
                <select
                  value={addRecordForm.add_reason}
                  onChange={(e) => handleAddRecordFieldChange('add_reason', e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                >
                  <option value="">请选择补录原因</option>
                  {ADD_REASON_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.label}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">补录日期 *</label>
                <input
                  type="date"
                  value={addRecordForm.checkin_date}
                  onChange={(e) => handleAddRecordFieldChange('checkin_date', e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                />
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setShowAddRecordModal(false)}
                className="flex-1 py-3 bg-gray-100 text-gray-600 rounded-xl font-medium hover:bg-gray-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={submitAddRecord}
                disabled={submitting || !addRecordForm.user_name || !addRecordForm.position_id || !addRecordForm.checkin_date}
                className="flex-1 py-3 bg-green-500 text-white rounded-xl font-medium hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? '提交中...' : '确认补录'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}