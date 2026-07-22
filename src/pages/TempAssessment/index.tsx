import { useState, useEffect } from 'react';
import { X, Calendar, DollarSign, User, Check, Target } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';

interface AssessmentWorker {
  user_id: string;
  user_name: string;
  user_phone: string;
  position_id: string;
  position_name: string;
  total_count: number;
  approved_count: number;
  rejected_count: number;
  total_amount: number;
  assessment_status: 'pending' | 'passed' | 'discounted';
  assessment_discount: number;
  final_amount: number;
}

interface PositionGroup {
  position_id: string;
  position_name: string;
  workers: AssessmentWorker[];
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
  const { user } = useAuthStore();
  const token = user?.token;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [groups, setGroups] = useState<PositionGroup[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().substring(0, 7));
  const [selectedWorker, setSelectedWorker] = useState<AssessmentWorker | null>(null);
  const [showAssessModal, setShowAssessModal] = useState(false);
  const [assessDiscount, setAssessDiscount] = useState(1.0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchData();
  }, [selectedMonth]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const [groupsRes, statsRes] = await Promise.all([
        api.get<PositionGroup[]>(`/temp/assessments/pending?month=${selectedMonth}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        api.get<Stats>(`/temp/assessments/stats?month=${selectedMonth}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      setGroups(groupsRes || []);
      setStats(statsRes);
    } catch (err: any) {
      console.error('获取考核数据失败:', err);
      setError(err.message || '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleAssess = (worker: AssessmentWorker) => {
    setSelectedWorker(worker);
    setAssessDiscount(worker.assessment_discount || 1.0);
    setShowAssessModal(true);
  };

  const submitAssess = async () => {
    if (!selectedWorker) return;

    try {
      setSubmitting(true);
      const assessment_status = assessDiscount === 1.0 ? 'passed' : 'discounted';
      
      await api.post(`/temp/assessments/${selectedWorker.user_id}/submit`, {
        user_id: selectedWorker.user_id,
        position_id: selectedWorker.position_id,
        month: selectedMonth,
        assessment_status,
        assessment_discount: assessDiscount,
      }, {
        headers: { Authorization: `Bearer ${token}` },
      });

      setShowAssessModal(false);
      setSelectedWorker(null);
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
      const monthStr = date.toISOString().substring(0, 7);
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

  const colorBgMap: Record<string, string> = {
    green: 'bg-green-500',
    blue: 'bg-blue-500',
    yellow: 'bg-yellow-500',
    orange: 'bg-orange-500',
    red: 'bg-red-500',
    gray: 'bg-gray-500',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold text-gray-800">月底考核</h1>
          <p className="text-gray-500 mt-1">对需要考核的打卡记录进行月底评估</p>
        </div>
        <div className="flex items-center gap-2">
          <Calendar size={18} className="text-gray-400" />
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="px-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
          >
            {generateMonthOptions().map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
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
              <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
                <User size={20} className="text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-800">{stats.total}</p>
                <p className="text-sm text-gray-500">总人次</p>
              </div>
            </div>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-yellow-100 rounded-xl flex items-center justify-center">
                <Target size={20} className="text-yellow-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-800">{stats.pending}</p>
                <p className="text-sm text-gray-500">待考核</p>
              </div>
            </div>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
                <Check size={20} className="text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-800">{stats.passed}</p>
                <p className="text-sm text-gray-500">已通过</p>
              </div>
            </div>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center">
                <X size={20} className="text-orange-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-800">{stats.discounted}</p>
                <p className="text-sm text-gray-500">已打折</p>
              </div>
            </div>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center">
                <DollarSign size={20} className="text-red-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-800">¥{stats.final_amount}</p>
                <p className="text-sm text-gray-500">最终金额</p>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        {loading ? (
          <div className="text-center py-10 text-gray-500">加载中...</div>
        ) : groups.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <Target size={48} className="mx-auto mb-2 opacity-50" />
            <p>本月暂无考核记录</p>
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map(group => (
              <div key={group.position_id}>
                <h3 className="text-lg font-semibold text-gray-800 mb-4">{group.position_name}</h3>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-3 px-4 font-medium text-gray-600">姓名</th>
                        <th className="text-left py-3 px-4 font-medium text-gray-600">打卡次数</th>
                        <th className="text-left py-3 px-4 font-medium text-gray-600">通过次数</th>
                        <th className="text-left py-3 px-4 font-medium text-gray-600">原金额</th>
                        <th className="text-left py-3 px-4 font-medium text-gray-600">考核结果</th>
                        <th className="text-left py-3 px-4 font-medium text-gray-600">实际金额</th>
                        <th className="text-left py-3 px-4 font-medium text-gray-600">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.workers.map(worker => (
                        <tr key={`${worker.user_id}-${worker.position_id}`} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-4 px-4">
                            <div className="font-medium text-gray-800">{worker.user_name}</div>
                            <div className="text-xs text-gray-400">{worker.user_phone || '-'}</div>
                          </td>
                          <td className="py-4 px-4">
                            <div className="text-sm text-gray-700">{worker.total_count}</div>
                          </td>
                          <td className="py-4 px-4">
                            <div className="text-sm text-gray-700">{worker.approved_count}</div>
                          </td>
                          <td className="py-4 px-4">
                            <div className="flex items-center gap-1">
                              <DollarSign size={14} className="text-gray-400" />
                              <span className="font-medium">¥{worker.total_amount}</span>
                            </div>
                          </td>
                          <td className="py-4 px-4">
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                              worker.assessment_status === 'pending'
                                ? 'bg-yellow-100 text-yellow-700'
                                : colorMap[getDiscountColor(worker.assessment_discount)]
                            }`}>
                              {worker.assessment_status === 'pending' ? '待考核' : getDiscountLabel(worker.assessment_discount)}
                            </span>
                          </td>
                          <td className="py-4 px-4">
                            {worker.assessment_status !== 'pending' ? (
                              <div className="font-semibold text-gray-800">
                                ¥{worker.final_amount.toFixed(2)}
                              </div>
                            ) : (
                              <span className="text-sm text-gray-400">-</span>
                            )}
                          </td>
                          <td className="py-4 px-4">
                            <button
                              onClick={() => handleAssess(worker)}
                              className="px-3 py-1.5 bg-purple-50 text-purple-600 rounded-lg text-sm font-medium hover:bg-purple-100 transition-colors"
                            >
                              {worker.assessment_status === 'pending' ? '进行考核' : '修改考核'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showAssessModal && selectedWorker && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowAssessModal(false)}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-800">月底考核</h3>
              <button onClick={() => setShowAssessModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <div className="bg-gray-50 rounded-xl p-4 mb-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 bg-purple-500 rounded-full flex items-center justify-center text-white font-medium">
                  {selectedWorker.user_name.charAt(0)}
                </div>
                <div>
                  <p className="font-medium text-gray-800">{selectedWorker.user_name}</p>
                  <p className="text-xs text-gray-500">{selectedWorker.position_name}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-gray-400">打卡次数：</span>
                  <span className="text-gray-700">{selectedWorker.total_count}次</span>
                </div>
                <div>
                  <span className="text-gray-400">原金额：</span>
                  <span className="text-gray-700 font-semibold">¥{selectedWorker.total_amount}</span>
                </div>
              </div>
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
                        ? `${colorBgMap[option.color]}/10 border-${option.color}-500`
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <span className="text-sm font-medium text-gray-700">{option.label}</span>
                    {assessDiscount === option.value && (
                      <Check size={18} className={`text-${option.color}-500`} />
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-blue-50 rounded-xl p-4 mb-4">
              <p className="text-sm text-blue-700">
                实际结算金额：<span className="font-bold text-lg">¥{(selectedWorker.total_amount * assessDiscount).toFixed(2)}</span>
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowAssessModal(false)}
                className="flex-1 py-3 bg-gray-100 text-gray-600 rounded-xl font-medium hover:bg-gray-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={submitAssess}
                disabled={submitting}
                className="flex-1 py-3 bg-purple-500 text-white rounded-xl font-medium hover:bg-purple-600 transition-colors disabled:opacity-50"
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