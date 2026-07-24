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
  daily_limit: number;
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

  const getCheckedCountToday = (positionId: string) => {
    return todayRecords.filter(r => r.position_id === positionId).length;
  };

  const isTempPosition = (position: Position) => {
    return position.name === '临时岗位';
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

  const todayCheckedCount = todayRecords.length;
  const todayAmount = todayRecords.reduce((sum, r) => sum + r.amount, 0);
  const todayPositionNames = todayRecords.map(r => `${r.position_name}¥${r.amount}`).join(' + ');

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <div className="bg-gradient-to-br from-purple-600 to-blue-600 text-white px-4 pt-16 pb-16 rounded-b-3xl">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold">{session.user.name}</h1>
            <p className="text-white/70 text-xs mt-0.5">
              已分配岗位：{positions.filter(p => p.name !== '临时岗位').map(p => p.name).join('、') || '未分配'}
            </p>
          </div>
        </div>

        {todayCheckedCount > 0 && (
          <div className="mt-4 p-3 bg-white/10 rounded-xl">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              <span className="text-sm text-white/90">今日已打卡 {todayCheckedCount} 次 ({todayPositionNames})</span>
            </div>
          </div>
        )}
      </div>

      <div className="px-4 mt-6">
        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-xl text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center py-8">
            <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-purple-500"></div>
            <p className="text-gray-500 text-sm mt-2">加载中...</p>
          </div>
        ) : (
          <>
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-3">
                <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
                <h2 className="text-sm font-semibold text-gray-700">我的岗位（已分配）</h2>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {positions.filter(p => p.name !== '临时岗位').map(pos => {
                  const checkedCount = getCheckedCountToday(pos.id);
                  const isPerTime = pos.pay_type === 'per_time';
                  const dailyLimit = pos.daily_limit || 1;
                  const remaining = dailyLimit - checkedCount;
                  const disabled = isPerTime && remaining <= 0;

                  return (
                    <button
                      key={pos.id}
                      onClick={() => !disabled && setSelectedPosition(pos.id)}
                      disabled={disabled}
                      className={`relative p-4 rounded-xl border-2 transition-all ${
                        selectedPosition === pos.id
                          ? 'border-purple-500 bg-purple-50'
                          : disabled
                            ? 'border-gray-200 bg-gray-100 opacity-60'
                            : 'border-gray-200 bg-white hover:border-gray-300'
                      }`}
                    >
                      <p className="font-semibold text-gray-800">{pos.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">¥{pos.rate}/{isPerTime ? '次' : '小时'}</p>
                      {isPerTime && (
                        <span className={`absolute top-2 right-2 px-2 py-0.5 text-xs rounded-full ${
                          remaining <= 0
                            ? 'bg-gray-100 text-gray-500'
                            : remaining < dailyLimit
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-green-100 text-green-700'
                        }`}>
                          {remaining <= 0 ? '已完成' : `${checkedCount}/${dailyLimit}次`}
                        </span>
                      )}
                      {selectedPosition === pos.id && !disabled && (
                        <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-purple-500 flex items-center justify-center">
                          <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        </div>
                      )}
                    </button>
                  );
                })}

                {positions.filter(p => p.name !== '临时岗位').length === 0 && (
                  <div className="col-span-2 p-6 bg-gray-50 rounded-xl text-center">
                    <p className="text-gray-400 text-sm">暂无分配岗位</p>
                  </div>
                )}
              </div>
            </div>

            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <h2 className="text-sm font-semibold text-gray-700">临时岗位（常显·临时调岗用）</h2>
              </div>

              <button
                onClick={() => setSelectedPosition(positions.find(p => p.name === '临时岗位')?.id || '')}
                className={`w-full p-4 rounded-xl border-2 transition-all ${
                  selectedPosition === positions.find(p => p.name === '临时岗位')?.id
                    ? 'border-purple-500 bg-purple-50'
                    : 'border-gray-300 bg-gray-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-lg">⭐</span>
                    <div>
                      <p className="font-semibold text-gray-800">临时岗位</p>
                      <p className="text-xs text-gray-500">打卡后由审核员分配岗位和金额</p>
                    </div>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    selectedPosition === positions.find(p => p.name === '临时岗位')?.id
                      ? 'border-purple-500 bg-purple-500'
                      : 'border-gray-400'
                  }`}>
                    {selectedPosition === positions.find(p => p.name === '临时岗位')?.id && (
                      <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </div>
                </div>
              </button>
            </div>

            <div className="bg-blue-50 rounded-xl p-4 mb-6">
              <div className="flex items-start gap-2">
                <svg className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="text-xs text-blue-700">
                  <p><strong>[我的岗位]</strong> = 审核员已分配给你的固定岗位</p>
                  <p><strong>[临时岗位]</strong> = 临时去其他岗位帮忙时打，审核员后续分配</p>
                  <p><strong>没有分配岗位的新用户</strong>，只看到临时岗位</p>
                </div>
              </div>
            </div>

            {selectedPosition && (() => {
              const pos = positions.find(p => p.id === selectedPosition);
              if (!pos) return null;

              return (
                <div className="bg-white rounded-2xl shadow-sm p-4 mb-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">确认打卡</h3>

                  <div className="mb-4">
                    <label className="block text-xs text-gray-500 mb-1">岗位</label>
                    <p className="font-medium text-gray-800">{pos.name}</p>
                  </div>

                  {pos.pay_type === 'per_hour' && (
                    <div className="mb-4">
                      <label className="block text-xs text-gray-500 mb-1">工作小时数 *</label>
                      <input
                        type="number"
                        step="0.5"
                        value={hours}
                        onChange={(e) => setHours(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 text-sm"
                        placeholder="请输入工作小时数"
                      />
                      <p className="text-xs text-gray-400 mt-1">
                        单价 ¥{pos.rate}/小时，预计 ¥{(parseFloat(hours) || 0) * pos.rate}
                      </p>
                    </div>
                  )}

                  {pos.pay_type === 'per_time' && !isTempPosition(pos) && (
                    <div className="mb-4 p-2 bg-gray-50 rounded-lg">
                      <p className="text-sm text-gray-600">
                        按次计费：<span className="font-semibold text-purple-600">¥{pos.rate}</span>
                      </p>
                    </div>
                  )}

                  <button
                    onClick={handleCheckin}
                    disabled={pos.pay_type === 'per_hour' && !hours}
                    className="w-full py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white font-semibold rounded-xl shadow-md active:scale-95 transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    确认打卡
                  </button>
                </div>
              );
            })()}

            <button
              onClick={() => navigate('/temp/profile')}
              className="w-full bg-white rounded-xl p-4 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                  <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <div>
                  <p className="font-medium text-gray-700">个人中心</p>
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