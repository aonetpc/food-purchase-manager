import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { getTempUserSession, clearTempUserSession } from './Login';

interface Position {
  id: string;
  name: string;
  department_name: string;
  type: 'internal' | 'external';
  pay_type: 'per_time' | 'per_hour';
  rate: number;
}

interface CheckinRecord {
  id: string;
  position_id: string;
  position_name: string;
  department_name: string;
  checkin_date: string;
  hours: number;
  amount: number;
  status: 'pending' | 'approved' | 'rejected';
  audit_note: string;
}

export default function TempCheckin() {
  const navigate = useNavigate();
  const [session, setSession] = useState(getTempUserSession());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [positions, setPositions] = useState<Position[]>([]);
  const [selectedPosition, setSelectedPosition] = useState<string>('');
  const [hours, setHours] = useState('');
  const [todayChecked, setTodayChecked] = useState(false);
  const [todayRecords, setTodayRecords] = useState<CheckinRecord[]>([]);

  useEffect(() => {
    if (!session) {
      navigate('/temp/login');
      return;
    }

    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [meRes, todayRes] = await Promise.all([
        api.get<any>('/temp/auth/me', {
          headers: { Authorization: `Bearer ${session.token}` },
        }),
        api.get<any>('/temp/checkins/today', {
          headers: { Authorization: `Bearer ${session.token}` },
        }),
      ]);

      const myPositions = meRes.my_positions || [];
      const tempPositions = meRes.temp_positions || [];

      // 临时岗位：去重（如果已分配岗位中有临时岗位，不重复显示）
      const filteredMy = myPositions.filter((p: Position) => p.name !== '临时岗位');
      const tempPos: Position = tempPositions[0] || {
        id: 'temp-position-default',
        name: '临时岗位',
        department_name: '待分配',
        type: 'external' as const,
        pay_type: 'per_time' as const,
        rate: 0,
      };

      const allPositions: Position[] = [...filteredMy, tempPos];
      setPositions(allPositions);
      setTodayChecked(todayRes.checked);
      setTodayRecords(todayRes.records || []);
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

  const handleCheckin = async () => {
    if (!selectedPosition) {
      setError('请选择岗位');
      return;
    }

    const position = positions.find(p => p.id === selectedPosition);
    if (!position) {
      setError('岗位不存在');
      return;
    }

    if (position.pay_type === 'per_hour' && (!hours || parseFloat(hours) <= 0)) {
      setError('请输入有效小时数');
      return;
    }

    try {
      await api.post('/temp/checkins', {
        position_id: selectedPosition,
        hours: position.pay_type === 'per_hour' ? parseFloat(hours) : null,
      }, {
        headers: { Authorization: `Bearer ${session.token}` },
      });

      setError('');
      setSelectedPosition('');
      setHours('');
      fetchData();
    } catch (err: any) {
      setError(err.message || '打卡失败');
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

  if (!session) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-orange-500 to-red-500 text-white px-6 pt-12 pb-8 rounded-b-3xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">外请人员打卡</h1>
            <p className="text-white/70 text-sm mt-1">欢迎你，{session.user.name}</p>
          </div>
          <button
            onClick={() => {
              if (confirm('确定要退出登录吗？')) {
                clearTempUserSession();
                navigate('/temp/login');
              }
            }}
            className="px-3 py-1.5 bg-white/20 rounded-lg text-sm"
          >
            退出
          </button>
        </div>
      </div>

      <div className="px-4 -mt-4 pb-24">
        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-xl text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center py-8">
            <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-orange-500"></div>
            <p className="text-gray-500 text-sm mt-2">加载中...</p>
          </div>
        ) : (
          <>
            {todayChecked ? (
              <div className="bg-green-50 rounded-2xl p-4 mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="font-medium text-green-700">今日已打卡</span>
                </div>
                <div className="space-y-2 mt-3">
                  {todayRecords.map(record => (
                    <div key={record.id} className="flex items-center justify-between bg-white rounded-xl p-3">
                      <div>
                        <p className="font-medium text-gray-800">{record.position_name}</p>
                        <p className="text-xs text-gray-500">{record.department_name}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-gray-800">¥{record.amount}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${getStatusColor(record.status)}`}>
                          {getStatusText(record.status)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-2xl shadow-sm p-6 mb-4">
                <h2 className="text-lg font-semibold text-gray-800 mb-4">今日打卡</h2>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">选择岗位 *</label>
                    {positions.length === 0 ? (
                      <div className="p-4 bg-gray-50 rounded-xl text-center text-gray-400 text-sm">
                        暂无可用岗位，请联系管理员分配
                      </div>
                    ) : (
                      <select
                        value={selectedPosition}
                        onChange={(e) => setSelectedPosition(e.target.value)}
                        className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                      >
                        <option value="">请选择岗位</option>
                        {positions.filter(p => p.name !== '临时岗位').length > 0 && (
                          <optgroup label="已分配岗位">
                            {positions.filter(p => p.name !== '临时岗位').map(pos => (
                              <option key={pos.id} value={pos.id}>
                                {pos.department_name} / {pos.name} ({pos.type === 'external' ? '外请' : '内部'})
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {positions.filter(p => p.name === '临时岗位').map(pos => (
                          <optgroup label="其他" key="temp">
                            <option key={pos.id} value={pos.id}>
                              ⭐ 临时岗位（待审核分配）
                            </option>
                          </optgroup>
                        ))}
                      </select>
                    )}
                  </div>

                  {selectedPosition && (() => {
                    const pos = positions.find(p => p.id === selectedPosition);
                    return pos?.pay_type === 'per_hour' && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">工作小时数 *</label>
                        <input
                          type="number"
                          step="0.5"
                          value={hours}
                          onChange={(e) => setHours(e.target.value)}
                          className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                          placeholder="请输入工作小时数"
                        />
                        <p className="text-xs text-gray-400 mt-1">
                          单价 ¥{pos.rate}/小时，预计 ¥{(parseFloat(hours) || 0) * pos.rate}
                        </p>
                      </div>
                    );
                  })()}

                  {selectedPosition && (() => {
                    const pos = positions.find(p => p.id === selectedPosition);
                    return pos?.pay_type === 'per_time' && (
                      <div className="p-3 bg-gray-50 rounded-xl">
                        <p className="text-sm text-gray-600">
                          按次计费：<span className="font-semibold text-orange-600">¥{pos.rate}</span>
                        </p>
                      </div>
                    );
                  })()}

                  <button
                    onClick={handleCheckin}
                    disabled={!selectedPosition || (positions.find(p => p.id === selectedPosition)?.pay_type === 'per_hour' && !hours)}
                    className="w-full py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white font-semibold rounded-xl shadow-md active:scale-95 transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    确认打卡
                  </button>
                </div>
              </div>
            )}

            <button
              onClick={() => navigate('/temp/profile')}
              className="w-full bg-white rounded-2xl shadow-sm p-4 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                  <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <div>
                  <p className="font-medium text-gray-800">个人中心</p>
                  <p className="text-xs text-gray-400">查看打卡记录和月度统计</p>
                </div>
              </div>
              <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </>
        )}
      </div>
    </div>
  );
}