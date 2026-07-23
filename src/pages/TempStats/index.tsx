import { useState, useEffect } from 'react';
import { Calendar, Users, Activity, DollarSign, Building, Target, TrendingUp, TrendingDown, Download } from 'lucide-react';
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
  const { user } = useAuthStore();
  const token = user?.token;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [departments, setDepartments] = useState<DepartmentStat[]>([]);
  const [positions, setPositions] = useState<PositionStat[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().substring(0, 7));

  useEffect(() => {
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

  const getRateChange = (approved: number, final: number) => {
    if (approved === 0) return { rate: 0, label: '0%', isUp: false };
    const rate = ((final - approved) / approved * 100);
    return {
      rate: rate,
      label: `${rate > 0 ? '+' : ''}${rate.toFixed(1)}%`,
      isUp: rate > 0,
    };
  };

  const handleExportSalary = async () => {
    try {
      const BASE_URL = import.meta.env.VITE_API_URL || '/api';
      const response = await fetch(`${BASE_URL}/temp/stats/export-salary?month=${selectedMonth}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: '请求失败' }));
        throw new Error(error.error || `HTTP ${response.status}`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `工资表_${selectedMonth}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error('导出工资表失败:', err);
      setError(err.message || '导出失败');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold text-gray-800">统计看板</h1>
          <p className="text-gray-500 mt-1">查看外请人员打卡统计数据</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleExportSalary}
            className="btn-primary flex items-center gap-2"
          >
            <Download size={18} />
            导出工资表
          </button>
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
      </div>

      {error && (
        <div className="bg-danger-50 border border-danger-200 rounded-lg p-4 flex items-center gap-3">
          <Activity size={20} className="text-danger-500" />
          <span className="text-danger-700">{error}</span>
        </div>
      )}

      {loading ? (
        <div className="text-center py-10 text-gray-500">加载中...</div>
      ) : (
        <>
          {overview && (
            <div className="grid grid-cols-4 gap-4">
              <div className="card p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500 mb-1">外请人员总数</p>
                    <p className="text-3xl font-bold text-gray-800">{overview.total_workers}</p>
                  </div>
                  <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                    <Users size={24} className="text-blue-600" />
                  </div>
                </div>
              </div>

              <div className="card p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500 mb-1">本月活跃人员</p>
                    <p className="text-3xl font-bold text-gray-800">{overview.active_workers}</p>
                  </div>
                  <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                    <Activity size={24} className="text-green-600" />
                  </div>
                </div>
              </div>

              <div className="card p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500 mb-1">本月打卡次数</p>
                    <p className="text-3xl font-bold text-gray-800">{overview.month_checkins}</p>
                  </div>
                  <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center">
                    <Target size={24} className="text-orange-600" />
                  </div>
                </div>
              </div>

              <div className="card p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500 mb-1">今日打卡</p>
                    <p className="text-3xl font-bold text-gray-800">{overview.today_checkins}</p>
                  </div>
                  <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
                    <Calendar size={24} className="text-purple-600" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {overview && (
            <div className="grid grid-cols-2 gap-4">
              <div className="card p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-800">本月通过金额</h2>
                  <DollarSign size={20} className="text-green-500" />
                </div>
                <div className="flex items-end gap-4">
                  <div>
                    <p className="text-4xl font-bold text-gray-800">¥{Number(overview.month_approved_amount).toFixed(2)}</p>
                    <p className="text-sm text-gray-500 mt-1">原始审核通过金额</p>
                  </div>
                </div>
              </div>

              <div className="card p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-800">本月最终金额</h2>
                  <DollarSign size={20} className="text-red-500" />
                </div>
                <div className="flex items-end gap-4">
                  <div>
                    <p className="text-4xl font-bold text-red-600">¥{Number(overview.month_final_amount).toFixed(2)}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <p className="text-sm text-gray-500">考核后最终结算金额</p>
                      {overview.month_approved_amount > 0 && (
                        <span className={`flex items-center gap-1 text-sm ${
                          overview.month_final_amount >= overview.month_approved_amount
                            ? 'text-green-600'
                            : 'text-orange-600'
                        }`}>
                          {overview.month_final_amount >= overview.month_approved_amount ? (
                            <TrendingUp size={14} />
                          ) : (
                            <TrendingDown size={14} />
                          )}
                          {((overview.month_final_amount - overview.month_approved_amount) / overview.month_approved_amount * 100).toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {departments.length > 0 && (
            <div className="card">
              <div className="flex items-center gap-2 mb-4">
                <Building size={20} className="text-gray-400" />
                <h2 className="text-lg font-semibold text-gray-800">部门统计</h2>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {departments.map(dept => (
                  <div key={dept.department_id} className="bg-gray-50 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-medium text-gray-800">{dept.department_name}</h3>
                      <span className="text-xs text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full">
                        {dept.position_count}个岗位
                      </span>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-500">打卡数</span>
                        <span className="font-medium text-gray-700">{dept.total_checkins}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-500">通过数</span>
                        <span className="font-medium text-gray-700">{dept.approved_checkins}</span>
                      </div>
                      <div className="border-t border-gray-200 pt-2 mt-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-gray-500">通过金额</span>
                          <span className="text-gray-700">¥{Number(dept.approved_amount).toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-gray-500">最终金额</span>
                          <span className="font-semibold text-red-600">¥{Number(dept.final_amount).toFixed(2)}</span>
                        </div>
                        {dept.approved_amount > 0 && (
                          <div className="flex items-center justify-end mt-1">
                            <span className={`text-xs ${
                              dept.final_amount >= dept.approved_amount
                                ? 'text-green-600'
                                : 'text-orange-600'
                            }`}>
                              {((dept.final_amount - dept.approved_amount) / dept.approved_amount * 100).toFixed(1)}%
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {positions.length > 0 && (
            <div className="card">
              <div className="flex items-center gap-2 mb-4">
                <Target size={20} className="text-gray-400" />
                <h2 className="text-lg font-semibold text-gray-800">岗位统计</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-3 px-4 font-medium text-gray-600">岗位名称</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-600">部门</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-600">类型</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-600">打卡数</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-600">通过金额</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-600">最终金额</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-600">差额</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map(pos => (
                      <tr key={pos.position_id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-4 px-4">
                          <div className="font-medium text-gray-800">{pos.position_name}</div>
                        </td>
                        <td className="py-4 px-4">
                          <div className="text-sm text-gray-600">{pos.department_name}</div>
                        </td>
                        <td className="py-4 px-4">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                            pos.type === 'external'
                              ? 'bg-orange-100 text-orange-700'
                              : 'bg-blue-100 text-blue-700'
                          }`}>
                            {pos.type === 'external' ? '外请' : '内部'}
                          </span>
                        </td>
                        <td className="py-4 px-4">
                          <div className="font-medium text-gray-700">{pos.total_checkins}</div>
                        </td>
                        <td className="py-4 px-4">
                          <div className="text-gray-700">¥{Number(pos.approved_amount).toFixed(2)}</div>
                        </td>
                        <td className="py-4 px-4">
                          <div className="font-semibold text-red-600">¥{Number(pos.final_amount).toFixed(2)}</div>
                        </td>
                        <td className="py-4 px-4">
                          {pos.approved_amount > 0 ? (
                            <span className={`text-sm font-medium ${
                              pos.final_amount >= pos.approved_amount
                                ? 'text-green-600'
                                : 'text-orange-600'
                            }`}>
                              {((pos.final_amount - pos.approved_amount) / pos.approved_amount * 100).toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-sm text-gray-400">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}