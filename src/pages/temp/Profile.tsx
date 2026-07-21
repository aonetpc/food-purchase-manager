import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { getTempUserSession, clearTempUserSession } from './Login';

interface CheckinRecord {
  id: string;
  position_name: string;
  department_name: string;
  checkin_date: string;
  hours: number;
  amount: number;
  status: 'pending' | 'approved' | 'rejected';
  audit_note: string;
  assessed_at: string;
  assessment_status: string;
  assessment_discount: number;
}

interface MonthlySummary {
  total_count: number;
  approved_count: number;
  pending_count: number;
  rejected_count: number;
  approved_amount: number;
  pending_amount: number;
  final_amount: number;
}

interface Position {
  id: string;
  name: string;
  department_name: string;
  is_primary: number;
}

export default function TempProfile() {
  const navigate = useNavigate();
  const [session] = useState(getTempUserSession());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [records, setRecords] = useState<CheckinRecord[]>([]);
  const [summary, setSummary] = useState<MonthlySummary | null>(null);
  const [myPositions, setMyPositions] = useState<Position[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().substring(0, 7));

  useEffect(() => {
    if (!session) {
      navigate('/temp/login');
      return;
    }

    fetchData();
  }, [selectedMonth]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [meRes, recordsRes, summaryRes] = await Promise.all([
        api.get<any>('/temp/auth/me', {
          headers: { Authorization: `Bearer ${session.token}` },
        }),
        api.get<any>(`/temp/checkins/my?month=${selectedMonth}`, {
          headers: { Authorization: `Bearer ${session.token}` },
        }),
        api.get<any>(`/temp/checkins/summary?month=${selectedMonth}`, {
          headers: { Authorization: `Bearer ${session.token}` },
        }),
      ]);

      setMyPositions(meRes.my_positions || []);
      setRecords(recordsRes || []);
      setSummary(summaryRes);
    } catch (err: any) {
      console.error('获取数据失败:', err);
      if (err.response?.status === 401) {
        clearTempUserSession();
        navigate('/temp/login');
      } else {
        setError(err.message || '获取数据失败');
      }
    } finally {
      setLoading(false);
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
    if (status === 'discounted') {
      return `${(discount * 100).toFixed(0)}%结算`;
    }
    if (status === 'passed') {
      return '考核通过';
    }
    if (status === 'pending') {
      return '待考核';
    }
    return '';
  };

  const generateMonthOptions = () => {
    const options = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthStr = date.toISOString().substring(0, 7);
      const display = `${date.getFullYear()}年${date.getMonth() + 1}月`;
      options.push({ value: monthStr, label: display });
    }
    return options;
  };

  if (!session) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-blue-500 to-purple-500 text-white px-6 pt-12 pb-8 rounded-b-3xl">
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate('/temp/checkin')}
            className="p-2 -ml-2 hover:bg-white/10 rounded-lg"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-xl font-bold">个人中心</h1>
          <div className="w-10"></div>
        </div>
      </div>

      <div className="px-4 -mt-4 pb-8">
        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-xl text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center py-8">
            <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500"></div>
            <p className="text-gray-500 text-sm mt-2">加载中...</p>
          </div>
        ) : (
          <>
            <div className="bg-white rounded-2xl shadow-sm p-6 mb-4">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center">
                  <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h2 className="text-xl font-bold text-gray-800">{session.user.name}</h2>
                  <p className="text-gray-500 text-sm">{session.user.phone || '未绑定手机号'}</p>
                </div>
                <button
                  onClick={() => {
                    if (confirm('确定要退出登录吗？')) {
                      clearTempUserSession();
                      navigate('/temp/login');
                    }
                  }}
                  className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-sm"
                >
                  退出
                </button>
              </div>

              {myPositions.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <p className="text-sm font-medium text-gray-700 mb-2">我的岗位</p>
                  <div className="flex flex-wrap gap-2">
                    {myPositions.map(pos => (
                      <span
                        key={pos.id}
                        className={`px-3 py-1 rounded-full text-xs ${
                          pos.is_primary === 1
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {pos.department_name} / {pos.name}
                        {pos.is_primary === 1 && ' (主岗)'}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl shadow-sm p-6 mb-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-800">月度统计</h2>
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm"
                >
                  {generateMonthOptions().map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {summary && (
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center p-3 bg-gray-50 rounded-xl">
                    <p className="text-2xl font-bold text-gray-800">{summary.total_count}</p>
                    <p className="text-xs text-gray-500 mt-1">打卡次数</p>
                  </div>
                  <div className="text-center p-3 bg-green-50 rounded-xl">
                    <p className="text-2xl font-bold text-green-600">¥{summary.approved_amount}</p>
                    <p className="text-xs text-gray-500 mt-1">已通过金额</p>
                  </div>
                  <div className="text-center p-3 bg-yellow-50 rounded-xl">
                    <p className="text-2xl font-bold text-yellow-600">¥{summary.pending_amount}</p>
                    <p className="text-xs text-gray-500 mt-1">待审核金额</p>
                  </div>
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">打卡记录</h2>

              {records.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <svg className="w-12 h-12 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <p className="text-sm">暂无打卡记录</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {records.map(record => (
                    <div key={record.id} className="p-4 bg-gray-50 rounded-xl">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <p className="font-medium text-gray-800">{record.position_name}</p>
                          <p className="text-xs text-gray-500">{record.department_name}</p>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded-full ${getStatusColor(record.status)}`}>
                          {getStatusText(record.status)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-3">
                          <span className="text-gray-500">{record.checkin_date}</span>
                          {record.hours && (
                            <span className="text-gray-500">{record.hours}小时</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {record.assessment_status && record.assessment_status !== 'pending' && (
                            <span className={`text-xs px-2 py-0.5 rounded ${
                              record.assessment_status === 'discounted'
                                ? 'bg-orange-100 text-orange-700'
                                : 'bg-green-100 text-green-700'
                            }`}>
                              {getAssessmentText(record.assessment_status, record.assessment_discount)}
                            </span>
                          )}
                          <span className="font-semibold text-gray-800">¥{record.amount}</span>
                        </div>
                      </div>
                      {record.status === 'rejected' && record.audit_note && (
                        <div className="mt-2 text-xs text-red-600 bg-red-50 p-2 rounded">
                          驳回原因：{record.audit_note}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}