import { useState, useEffect } from 'react';
import { Plus, X, Search, UserCheck, UserX, Building2, Target } from 'lucide-react';
import { api } from '@/lib/api';

interface User {
  id: string;
  name: string;
  username: string;
  phone: string;
  role: string;
}

interface Position {
  id: string;
  name: string;
  department_name: string;
  type: 'internal' | 'external';
  auditor_count: number;
}

interface AuditorPosition {
  id: string;
  position_id: string;
  user_id: string;
  user_name: string;
  user_phone: string;
}

interface PositionAuditor {
  id: string;
  user_id: string;
  name: string;
  username: string;
  phone: string;
  role: string;
}

export default function TempAuditorManager() {
  const [users, setUsers] = useState<User[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [selectedPosition, setSelectedPosition] = useState<Position | null>(null);
  const [auditors, setAuditors] = useState<PositionAuditor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const [usersRes, positionsRes] = await Promise.all([
        api.get<User[]>('/users'),
        api.get<Position[]>('/temp/positions'),
      ]);
      setUsers(usersRes);
      setPositions(positionsRes.filter(p => p.status === 1 && p.name !== '临时岗位'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectPosition = async (position: Position) => {
    setSelectedPosition(position);
    try {
      const res = await api.get<AuditorPosition[]>(`/temp/positions/${position.id}/auditors`);
      setAuditors(res);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleOpenAssignModal = () => {
    setSelectedUserId('');
    setShowAssignModal(true);
  };

  const handleAssignAuditor = async () => {
    if (!selectedPosition || !selectedUserId) return;
    setSubmitting(true);
    try {
      await api.post(`/temp/positions/${selectedPosition.id}/auditors`, { user_id: selectedUserId });
      const res = await api.get<AuditorPosition[]>(`/temp/positions/${selectedPosition.id}/auditors`);
      setAuditors(res);
      setSelectedUserId('');
      setShowAssignModal(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveAuditor = async (userId: string) => {
    if (!selectedPosition) return;
    if (!window.confirm('确定移除该审核员吗？')) return;
    try {
      await api.delete(`/temp/positions/${selectedPosition.id}/auditors/${userId}`);
      const res = await api.get<AuditorPosition[]>(`/temp/positions/${selectedPosition.id}/auditors`);
      setAuditors(res);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const availableUsers = users.filter(u => 
    !auditors.find(a => a.user_id === u.id) &&
    (u.name.includes(searchTerm) || u.username.includes(searchTerm))
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold text-gray-800">审核员管理</h1>
          <p className="text-gray-500 mt-1">管理岗位审核员的分配</p>
        </div>
      </div>

      {error && (
        <div className="bg-danger-50 border border-danger-200 rounded-lg p-4 flex items-center gap-3">
          <X size={20} className="text-danger-500" />
          <span className="text-danger-700">{error}</span>
        </div>
      )}

      {loading ? (
        <div className="text-center py-10 text-gray-500">加载中...</div>
      ) : (
        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-1">
            <div className="card">
              <div className="p-4 border-b border-gray-200">
                <h3 className="font-medium text-gray-800 flex items-center gap-2">
                  <Target size={18} className="text-gray-400" />
                  岗位列表
                </h3>
              </div>
              <div className="divide-y divide-gray-100 max-h-[600px] overflow-y-auto">
                {positions.map(pos => (
                  <div
                    key={pos.id}
                    onClick={() => handleSelectPosition(pos)}
                    className={`p-4 cursor-pointer hover:bg-gray-50 transition-colors ${
                      selectedPosition?.id === pos.id ? 'bg-primary-50' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-gray-800">{pos.name}</div>
                        <div className="text-xs text-gray-500 flex items-center gap-1">
                          <Building2 size={12} />
                          {pos.department_name}
                        </div>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        pos.type === 'external'
                          ? 'bg-orange-100 text-orange-700'
                          : 'bg-blue-100 text-blue-700'
                      }`}>
                        {pos.type === 'external' ? '外请' : '内部'}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-xs text-gray-400">
                        审核员：<span className="text-gray-600 font-medium">{pos.auditor_count || 0}人</span>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="col-span-2">
            {selectedPosition ? (
              <div className="card">
                <div className="flex items-center justify-between p-4 border-b border-gray-200">
                  <div>
                    <h3 className="font-medium text-gray-800">{selectedPosition.name}</h3>
                    <p className="text-sm text-gray-500">{selectedPosition.department_name} · {selectedPosition.type === 'external' ? '外请' : '内部'}</p>
                  </div>
                  <button
                    onClick={handleOpenAssignModal}
                    className="btn-primary flex items-center gap-2"
                  >
                    <Plus size={18} />
                    添加审核员
                  </button>
                </div>

                <div className="p-4">
                  {auditors.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                      <UserCheck size={48} className="mb-2 opacity-50" />
                      <p>该岗位暂无审核员</p>
                      <p className="text-xs mt-1">点击右上角添加审核员</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {auditors.map(auditor => (
                        <div key={auditor.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
                              <UserCheck size={20} className="text-primary-600" />
                            </div>
                            <div>
                              <div className="font-medium text-gray-800">{auditor.name}</div>
                              <div className="text-xs text-gray-500">
                                {auditor.username} {auditor.phone ? `· ${auditor.phone}` : ''}
                              </div>
                            </div>
                          </div>
                          <button
                            onClick={() => handleRemoveAuditor(auditor.user_id)}
                            className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                            title="移除审核员"
                          >
                            <UserX size={18} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="card flex flex-col items-center justify-center py-20">
                <Target size={64} className="text-gray-300 mb-4" />
                <h3 className="text-lg font-medium text-gray-600 mb-2">选择岗位查看审核员</h3>
                <p className="text-gray-400 text-sm">从左侧选择一个岗位来管理审核员</p>
              </div>
            )}
          </div>
        </div>
      )}

      {showAssignModal && selectedPosition && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowAssignModal(false)}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-800">添加审核员 - {selectedPosition.name}</h3>
              <button onClick={() => setShowAssignModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">搜索用户</label>
              <div className="relative">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  placeholder="搜索姓名或用户名..."
                />
              </div>
            </div>

            <div className="max-h-[400px] overflow-y-auto space-y-2">
              {availableUsers.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <p>没有可用的用户</p>
                </div>
              ) : (
                availableUsers.map(user => (
                  <div
                    key={user.id}
                    onClick={() => setSelectedUserId(user.id)}
                    className={`flex items-center justify-between p-3 border rounded-lg cursor-pointer transition-colors ${
                      selectedUserId === user.id
                        ? 'border-primary-500 bg-primary-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div>
                      <div className="font-medium text-gray-800">{user.name}</div>
                      <div className="text-xs text-gray-500">
                        {user.username} {user.phone ? `· ${user.phone}` : ''}
                      </div>
                    </div>
                    {selectedUserId === user.id && (
                      <UserCheck size={18} className="text-primary-500" />
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setShowAssignModal(false)}
                className="flex-1 py-3 bg-gray-100 text-gray-600 rounded-xl font-medium hover:bg-gray-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleAssignAuditor}
                disabled={!selectedUserId || submitting}
                className="flex-1 py-3 bg-primary-500 text-white rounded-xl font-medium hover:bg-primary-600 transition-colors disabled:opacity-50"
              >
                {submitting ? '提交中...' : '确认添加'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}