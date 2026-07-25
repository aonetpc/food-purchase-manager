import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';

interface AssessmentRecord {
  id: string;
  user_name: string;
  user_phone: string;
  position_name: string;
  department_name: string;
  checkin_date: string;
  hours: number | null;
  amount: number;
  status: string;
  assessment_status: 'pending' | 'passed' | 'discounted';
  assessment_discount: number;
  assessed_at: string;
}

interface Stats {
  total: number;
  pending: number;
  passed: number;
  discounted: number;
  final_amount: number;
}

const DISCOUNT_OPTIONS = [
  { value: 1.0, label: '100%全额', color: 'green' },
  { value: 0.8, label: '80%结算', color: 'blue' },
  { value: 0.7, label: '70%结算', color: 'yellow' },
  { value: 0.5, label: '50%结算', color: 'orange' },
  { value: 0, label: '0%不予结算', color: 'red' },
];

export default function TempAssessment() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const token = user?.token;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [records, setRecords] = useState<AssessmentRecord[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [selectedRecord, setSelectedRecord] = useState<AssessmentRecord | null>(null);
  const [showAssessModal, setShowAssessModal] = useState(false);
  const [assessDiscount, setAssessDiscount] = useState(1.0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    fetchData();
  }, [selectedMonth]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const [recordsRes, statsRes] = await Promise.all([
        api.get<AssessmentRecord[]>(`/temp/assessments?month=${selectedMonth}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        api.get<Stats>(`/temp/assessments/stats?month=${selectedMonth}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      setRecords(recordsRes || []);
      setStats(statsRes);
    } catch (err: any) {
      console.error('获取考核数据失败:', err);
      setError(err.message || '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleAssess = (record: AssessmentRecord) => {
    setSelectedRecord(record);
    setAssessDiscount(record.assessment_discount || 1.0);
    setShowAssessModal(true);
  };

  const submitAssess = async () => {
    if (!selectedRecord) return;

    try {
      setSubmitting(true);
      await api.post(`/temp/assessments/${selectedRecord.id}`, {
        discount: assessDiscount,
      }, {
        headers: { Authorization: `Bearer ${token}` },
      });

      setShowAssessModal(false);
      setSelectedRecord(null);
      fetchData();
    } catch (err: any) {
      setError(err.message || '考核失败');
    } finally {
      setSubmitting(false);
    }
  };

  const generateMonthOptions = () => {
    const options = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const display = `${date.getFullYear()}年${date.getMonth() + 1}月`;
      options.push({ value: monthStr, label: display });
    }
    return options;
  };

  const getDiscountLabel = (discount: number) => {
    const option = DISCOUNT_OPTIONS.find(o => o.value === discount);
    return option ? option.label : `${(discount * 100).toFixed(0)}%`;
  };

  const getDiscountColor = (discount: number) => {
    const option = DISCOUNT_OPTIONS.find(o => o.value === discount);
    return option ? option.color : 'gray';
  };

  const colorMap: Record<string, string> = {
    green: 'bg-green-100 text-green-700',
    blue: 'bg-blue-100 text-blue-700',
    yellow: 'bg-yellow-100 text-yellow-700',
    orange: 'bg-orange-100 text-orange-700',
    red: 'bg-red-100 text-red-700',
    gray: 'bg-gray-100 text-gray-700',
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-purple-600 to-pink-600 text-white px-6 pt-12 pb-8 rounded-b-3xl">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => navigate('/m/temp-audit')}
            className="p-2 -ml-2 hover:bg-white/10 rounded-lg"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-xl font-bold">月底考核</h1>
          <div className="w-10"></div>
        </div>

        <div className="mb-4">
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="w-full px-4 py-2 bg-white/20 text-white rounded-xl text-sm border-none focus:outline-none"
          >
            {generateMonthOptions().map(opt => (
              <option key={opt.value} value={opt.value} className="text-gray-800">{opt.label}</option>
            ))}
          </select>
        </div>

        {stats && (
          <div className="grid grid-cols-4 gap-2">
            <div className="text-center">
              <p className="text-2xl font-bold">{stats.total}</p>
              <p className="text-xs text-white/70">总人次</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">{stats.pending}</p>
              <p className="text-xs text-white/70">待考核</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">{stats.passed}</p>
              <p className="text-xs text-white/70">已通过</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">¥{stats.final_amount}</p>
              <p className="text-xs text-white/70">最终金额</p>
            </div>
          </div>
        )}
      </div>

      <div className="px-4 -mt-4 pb-8">
        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-xl text-sm">{error}</div>
        )}

        {loading ? (
          <div className="text-center py-8">
            <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-purple-500"></div>
            <p className="text-gray-500 text-sm mt-2">加载中...</p>
          </div>
        ) : records.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <svg className="w-16 h-16 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            <p className="text-sm">本月暂无考核记录</p>
          </div>
        ) : (
          <div className="space-y-3">
            {records.map(record => (
              <div key={record.id} className="bg-white rounded-2xl shadow-sm p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-gray-800">{record.user_name}</h3>
                    <p className="text-xs text-gray-500 mt-0.5">{record.position_name} · {record.department_name}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    record.assessment_status === 'pending'
                      ? 'bg-yellow-100 text-yellow-700'
                      : colorMap[getDiscountColor(record.assessment_discount)]
                  }`}>
                    {record.assessment_status === 'pending' ? '待考核' : getDiscountLabel(record.assessment_discount)}
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
                    <p className="text-xs text-gray-400">原金额</p>
                    <p className="text-gray-700">¥{record.amount}</p>
                  </div>
                </div>

                {record.assessment_status !== 'pending' && (
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span className="text-gray-500">实际结算：</span>
                    <span className="font-semibold text-gray-800">
                      ¥{(record.amount * record.assessment_discount).toFixed(2)}
                    </span>
                  </div>
                )}

                <button
                  onClick={() => handleAssess(record)}
                  className="w-full mt-3 py-2 bg-purple-50 text-purple-600 rounded-lg text-sm font-medium active:scale-95 transition-transform"
                >
                  {record.assessment_status === 'pending' ? '进行考核' : '修改考核'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {showAssessModal && selectedRecord && (
        <div className="fixed inset-0 bg-black/50 flex items-end justify-center z-50" onClick={() => setShowAssessModal(false)}>
          <div className="bg-white w-full max-w-md rounded-t-3xl p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-800">月底考核</h3>
              <button onClick={() => setShowAssessModal(false)} className="text-gray-400">
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
                {selectedRecord.checkin_date} · 原金额 ¥{selectedRecord.amount}
              </p>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-3">选择考核结果</label>
              <div className="space-y-2">
                {DISCOUNT_OPTIONS.map(option => (
                  <button
                    key={option.value}
                    onClick={() => setAssessDiscount(option.value)}
                    className={`w-full flex items-center justify-between p-3 rounded-xl border-2 transition-colors ${
                      assessDiscount === option.value
                        ? `border-${option.color}-500 bg-${option.color}-50`
                        : 'border-gray-200'
                    }`}
                  >
                    <span className="text-sm font-medium text-gray-700">{option.label}</span>
                    {assessDiscount === option.value && (
                      <svg className={`w-5 h-5 text-${option.color}-500`} fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-blue-50 rounded-xl p-3 mb-4">
              <p className="text-sm text-blue-700">
                实际结算金额：<span className="font-bold">¥{(selectedRecord.amount * assessDiscount).toFixed(2)}</span>
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowAssessModal(false)}
                className="flex-1 py-3 bg-gray-100 text-gray-600 rounded-xl font-medium"
              >
                取消
              </button>
              <button
                onClick={submitAssess}
                disabled={submitting}
                className="flex-1 py-3 bg-purple-500 text-white rounded-xl font-medium disabled:opacity-50"
              >
                {submitting ? '提交中...' : '确认考核'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
