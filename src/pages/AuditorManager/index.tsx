import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, X, Users, Check, UserCircle } from 'lucide-react';
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
}

interface AuditorAssignment {
  id: string;
  position_id: string;
  position_name: string;
  department_name: string;
}

export default function AuditorManager() {
  const [users, setUsers] = useState<User[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [auditors, setAuditors] = useState<{ user: User; assignments: AuditorAssignment[] }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [selectedPositions, setSelectedPositions] = useState<string[]>([]);

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
      setPositions(positionsRes);

      const auditorsData = await Promise.all(
        usersRes.map(async user => {
          const assignments: AuditorAssignment[] = [];
          for (const pos of positionsRes) {
            try {
              const auditorsForPos = await api.get<{ user_id: string }[]>(`/temp/positions/${pos.id}/auditors`);
              if (auditorsForPos.some(a => a.user_id === user.id)) {
                assignments.push({
                  id: '',
                  position_id: pos.id,
                  position_name: pos.name,
                  department_name: pos.department_name,
                });
              }
            } catch (e) {
              console.log(e);
            }
          }
          return { user, assignments };
        })
      );

      setAuditors(auditorsData.filter(a => a.assignments.length > 0));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleAddAuditor = () => {
    setSelectedUser(null);
    setSelectedPositions([]);
    setShowAddModal(true);
  };

  const handleSaveAuditor = async () => {
    if (!selectedUser || selectedPositions.length === 0) {
      setError('请选择用户和至少一个岗位');
      return;
    }

    try {
      for (const posId of selectedPositions) {
        await api.post(`/temp/positions/${posId}/auditors`, { user_id: selectedUser.id });
      }
      setShowAddModal(false);
      fetchData();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleRemovePosition = async (userId: string, positionId: string) => {
    if (!window.confirm('确定解除该审核员的此岗位权限吗？')) return;
    try {
      await api.delete(`/temp/positions/${positionId}/auditors/${userId}`);
      fetchData();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold text-gray-800">审核员管理</h1>
          <p className="text-gray-500 mt-1">为岗位分配审核员，审核员只能审核自己负责岗位的打卡</p>
        </div>
        <button onClick={handleAddAuditor} className="btn-primary flex items-center gap-2">
          <Plus size={18} />
          分配审核员
        </button>
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
        <>
          {auditors.length === 0 ? (
            <div className="card flex flex-col items-center justify-center py-20">
              <Users size={64} className="text-gray-300 mb-4" />
              <h3 className="text-lg font-medium text-gray-600 mb-2">暂无审核员</h3>
              <p className="text-gray-400 text-sm">点击上方按钮为岗位分配审核员</p>
            </div>
          ) : (
            <div className="space-y-4">
              {auditors.map(({ user, assignments }) => (
                <div key={user.id} className="card p-4">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center text-blue-600">
                        <UserCircle size={24} />
                      </div>
                      <div>
                        <h3 className="font-medium text-gray-800">{user.name}</h3>
                        <p className="text-sm text-gray-500">{user.username} | {user.phone || '无手机号'}</p>
                        <p className="text-xs text-gray-400">当前角色: {user.role}</p>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm">
                      <Check size={14} />
                      审核员
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {assignments.map(assign => (
                      <div
                        key={assign.position_id}
                        className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-lg"
                      >
                        <span className="text-sm text-gray-700">{assign.department_name}</span>
                        <span className="text-sm text-gray-500">/</span>
                        <span className="text-sm font-medium text-gray-800">{assign.position_name}</span>
                        <button
                          onClick={() => handleRemovePosition(user.id, assign.position_id)}
                          className="p-1 text-gray-400 hover:text-danger-500 hover:bg-danger-50 rounded"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowAddModal(false)}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">分配审核员</h3>
              <button onClick={() => setShowAddModal(false)} className="p-1 hover:bg-gray-100 rounded-md">
                <X size={20} className="text-gray-500" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">选择审核员 *</label>
                <select
                  value={selectedUser?.id || ''}
                  onChange={(e) => {
                    const user = users.find(u => u.id === e.target.value);
                    setSelectedUser(user || null);
                  }}
                  className="w-full border border-gray-200 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                >
                  <option value="">请选择用户</option>
                  {users.map(user => (
                    <option key={user.id} value={user.id}>{user.name} ({user.username})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">选择岗位（可多选）*</label>
                <div className="flex flex-wrap gap-2">
                  {positions.map(pos => (
                    <button
                      key={pos.id}
                      onClick={() => {
                        setSelectedPositions(prev =>
                          prev.includes(pos.id)
                            ? prev.filter(p => p !== pos.id)
                            : [...prev, pos.id]
                        );
                      }}
                      className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                        selectedPositions.includes(pos.id)
                          ? 'bg-primary-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {pos.department_name} / {pos.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {error && (
              <p className="text-danger-500 text-sm mt-2">{error}</p>
            )}

            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowAddModal(false)} className="btn-secondary flex-1">取消</button>
              <button onClick={handleSaveAuditor} className="btn-primary flex-1">保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
