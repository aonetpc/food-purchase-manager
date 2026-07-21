import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';

interface OverviewStats {
  total_workers: number;
  active_workers: number;
  today_checkins: number;
  month_checkins: number;
  month_approved_amount: number;
  month_final_amount: number;
}

interface DepartmentStat {
  department_id: string;
  department_name: string;
  total_checkins: number;
  approved_checkins: number;
  approved_amount: number;
  final_amount: number;
  position_count: number;
}

interface PositionStat {
  position_id: string;
  position_name: string;
  department_name: string;
  type: string;
  total_checkins: number;
  approved_amount: number;
  final_amount: number;
}

export default function TempStats() {
  const navigate = useNavigate();
  const { user, token } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [departments, setDepartments] = useState<DepartmentStat[]>([]);
  const [positions, setPositions] = useState<PositionStat[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().substring(0, 7));

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
      const [overviewRes, deptRes, posRes] = await Promise.all([
        api.get<OverviewStats>(`/temp/stats/overview?month=${selectedMonth}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        api.get<DepartmentStat[]>(`/temp/stats/departments?month=${selectedMonth}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        api.get<PositionStat[]>(`/temp/stats/positions?month=${selectedMonth}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      setOverview(overviewRes);
      setDepartments(deptRes || []);
      setPositions(posRes || []);
    } catch (err: any) {
      console.error('获取统计数据失败:', err);
      setError(err.message || '获取数据失败');
    } finally {
      setLoading(false);
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

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-indigo-600 to-blue-600 text-white px-6 pt-12 pb-8 rounded-b-3xl">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => navigate('/m/temp-audit')}
            className="p-2 -ml-2 hover:bg-white/10 rounded-lg"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-xl font-bold">统计看板</h1>
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
      </div>

      <div className="px-4 -mt-4 pb-8">
        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-xl text-sm">{error}</div>
        )}

        {loading ? (
          <div className="text-center py-8">
            <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-500"></div>
            <p className="text-gray-500 text-sm mt-2">加载中...</p>
          </div>
        ) : (
          <>
            {overview && (
              <div className="bg-white rounded-2xl shadow-sm p-6 mb-4">
                <h2 className="text-lg font-semibold text-gray-800 mb-4">总览</h2>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-blue-50 rounded-xl">
                    <p className="text-3xl font-bold text-blue-600">{overview.total_workers}</p>
                    <p className="text-xs text-gray-500 mt-1">外请人员总数</p>
                  </div>
                  <div className="p-4 bg-green-50 rounded-xl">
                    <p className="text-3xl font-bold text-green-600">{overview.active_workers}</p>
                    <p className="text-xs text-gray-500 mt-1">本月活跃人员</p>
                  </div>
                  <div className="p-4 bg-orange-50 rounded-xl">
                    <p className="text-3xl font-bold text-orange-600">{overview.today_checkins}</p>
                    <p className="text-xs text-gray-500 mt-1">今日打卡</p>
                  </div>
                  <div className="p-4 bg-purple-50 rounded-xl">
                    <p className="text-3xl font-bold text-purple-600">{overview.month_checkins}</p>
                    <p className="text-xs text-gray-500 mt-1">本月打卡</p>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-gray-400">本月通过金额</p>
                    <p className="text-xl font-bold text-gray-800">¥{overview.month_approved_amount}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">本月最终金额</p>
                    <p className="text-xl font-bold text-red-600">¥{overview.month_final_amount}</p>
                  </div>
                </div>
              </div>
            )}

            {departments.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm p-6 mb-4">
                <h2 className="text-lg font-semibold text-gray-800 mb-4">部门统计</h2>
                <div className="space-y-3">
                  {departments.map(dept => (
                    <div key={dept.department_id} className="p-4 bg-gray-50 rounded-xl">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-medium text-gray-800">{dept.department_name}</h3>
                        <span className="text-xs text-gray-500">{dept.position_count}个岗位</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-sm">
                        <div>
                          <p className="text-xs text-gray-400">打卡数</p>
                          <p className="text-gray-700 font-medium">{dept.total_checkins}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-400">通过数</p>
                          <p className="text-gray-700 font-medium">{dept.approved_checkins}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-400">最终金额</p>
                          <p className="text-red-600 font-semibold">¥{dept.final_amount}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {positions.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm p-6 mb-4">
                <h2 className="text-lg font-semibold text-gray-800 mb-4">岗位统计</h2>
                <div className="space-y-3">
                  {positions.map(pos => (
                    <div key={pos.position_id} className="p-4 bg-gray-50 rounded-xl">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <h3 className="font-medium text-gray-800">{pos.position_name}</h3>
                          <p className="text-xs text-gray-500">{pos.department_name}</p>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          pos.type === 'external'
                            ? 'bg-orange-100 text-orange-700'
                            : 'bg-blue-100 text-blue-700'
                        }`}>
                          {pos.type === 'external' ? '外请' : '内部'}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-sm">
                        <div>
                          <p className="text-xs text-gray-400">打卡数</p>
                          <p className="text-gray-700 font-medium">{pos.total_checkins}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-400">通过金额</p>
                          <p className="text-gray-700 font-medium">¥{pos.approved_amount}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-400">最终金额</p>
                          <p className="text-red-600 font-semibold">¥{pos.final_amount}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
