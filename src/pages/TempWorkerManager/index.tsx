import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, X, Users, Search, UserCheck, UserX, Check } from 'lucide-react';
import { api } from '@/lib/api';

interface TempWorker {
  id: string;
  name: string;
  phone: string;
  openid: string;
  unionid: string;
  avatar_url: string;
  status: number;
  created_at: string;
  last_login_at: string;
  position_count?: number;
  position_names?: string;
}

interface Position {
  id: string;
  name: string;
  type: 'internal' | 'external';
  department_name: string;
  is_primary: number;
  assigned_at: string;
  pay_type: string;
  rate: number;
}

export default function TempWorkerManager() {
  const [workers, setWorkers] = useState<TempWorker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedWorker, setSelectedWorker] = useState<TempWorker | null>(null);
  const [workerPositions, setWorkerPositions] = useState<Position[]>([]);
  const [showPositionModal, setShowPositionModal] = useState(false);
  const [allPositions, setAllPositions] = useState<Position[]>([]);
  const [selectedPositionId, setSelectedPositionId] = useState('');
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    fetchWorkers();
    fetchAllPositions();
  }, []);

  const fetchWorkers = async () => {
    setLoading(true);
    setError('');
    try {
      const url = searchTerm ? `/temp/workers?search=${encodeURIComponent(searchTerm)}` : '/temp/workers';
      const res = await api.get<TempWorker[]>(url);
      setWorkers(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const fetchAllPositions = async () => {
    try {
      const res = await api.get<Position[]>('/temp/positions');
      setAllPositions(res.filter(p => p.name !== '临时岗位' && p.status === 1));
    } catch (e) {
      console.error('获取岗位列表失败:', e);
    }
  };

  const handleViewPositions = async (worker: TempWorker) => {
    setSelectedWorker(worker);
    setSelectedPositionId('');
    try {
      const res = await api.get<Position[]>(`/temp/workers/${worker.id}/positions`);
      setWorkerPositions(res);
      setShowPositionModal(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleAssignPosition = async () => {
    if (!selectedWorker || !selectedPositionId) return;
    setAssigning(true);
    try {
      await api.post(`/temp/workers/${selectedWorker.id}/positions`, {
        position_id: selectedPositionId,
        is_primary: 0,
      });
      const res = await api.get<Position[]>(`/temp/workers/${selectedWorker.id}/positions`);
      setWorkerPositions(res);
      setSelectedPositionId('');
      fetchWorkers();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAssigning(false);
    }
  };

  const handleRemovePosition = async (positionId: string) => {
    if (!selectedWorker) return;
    if (!window.confirm('确定取消该岗位分配吗？')) return;
    try {
      await api.delete(`/temp/workers/${selectedWorker.id}/positions/${positionId}`);
      const res = await api.get<Position[]>(`/temp/workers/${selectedWorker.id}/positions`);
      setWorkerPositions(res);
      fetchWorkers();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleDisableWorker = async (id: string) => {
    if (!window.confirm('确定禁用该人员吗？禁用后无法打卡。')) return;
    try {
      await api.put(`/temp/workers/${id}`, { status: 0 });
      fetchWorkers();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleEnableWorker = async (id: string) => {
    try {
      await api.put(`/temp/workers/${id}`, { status: 1 });
      fetchWorkers();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleUpdateWorker = async (worker: TempWorker) => {
    const newName = prompt('请输入新姓名:', worker.name);
    if (!newName) return;
    try {
      await api.put(`/temp/workers/${worker.id}`, { name: newName.trim() });
      fetchWorkers();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const filteredWorkers = workers.filter(w => w.status === 1);
  const disabledWorkers = workers.filter(w => w.status === 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold text-gray-800">外请人员管理</h1>
          <p className="text-gray-500 mt-1">管理通过微信扫码注册的外请人员</p>
        </div>
      </div>

      <div className="flex gap-4">
        <div className="relative flex-1 max-w-md">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchWorkers()}
            placeholder="搜索姓名或手机号..."
            className="w-full pl-10 border border-gray-200 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
          />
        </div>
        <button onClick={fetchWorkers} className="btn-primary">搜索</button>
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
          {filteredWorkers.length === 0 ? (
            <div className="card flex flex-col items-center justify-center py-20">
              <Users size={64} className="text-gray-300 mb-4" />
              <h3 className="text-lg font-medium text-gray-600 mb-2">暂无外请人员</h3>
              <p className="text-gray-400 text-sm">人员通过微信扫码自动注册</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredWorkers.map(worker => (
                <div key={worker.id} className="card p-4 hover:shadow-lg transition-shadow">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center text-primary-600">
                        <UserCheck size={24} />
                      </div>
                      <div>
                        <h3 className="font-medium text-gray-800">{worker.name || '未设置姓名'}</h3>
                        <p className="text-sm text-gray-500">{worker.phone || '未绑定手机号'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleUpdateWorker(worker)}
                        className="p-1.5 text-gray-400 hover:text-primary-500 hover:bg-primary-50 rounded"
                        title="编辑姓名"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => handleDisableWorker(worker.id)}
                        className="p-1.5 text-gray-400 hover:text-danger-500 hover:bg-danger-50 rounded"
                        title="禁用"
                      >
                        <UserX size={16} />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2 text-sm">
                    {worker.position_names && (
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400">岗位:</span>
                        <span className="text-gray-600">{worker.position_names}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400">注册时间:</span>
                      <span className="text-gray-600">{new Date(worker.created_at).toLocaleDateString()}</span>
                    </div>
                    {worker.last_login_at && (
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400">最后登录:</span>
                        <span className="text-gray-600">{new Date(worker.last_login_at).toLocaleString()}</span>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => handleViewPositions(worker)}
                    className="mt-4 w-full btn-secondary text-sm"
                  >
                    查看岗位分配
                  </button>
                </div>
              ))}
            </div>
          )}

          {disabledWorkers.length > 0 && (
            <div className="mt-8">
              <h3 className="text-lg font-medium text-gray-600 mb-4">已禁用人员</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {disabledWorkers.map(worker => (
                  <div key={worker.id} className="card p-4 opacity-60">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center text-gray-500">
                          <UserX size={20} />
                        </div>
                        <div>
                          <h3 className="font-medium text-gray-600">{worker.name}</h3>
                          <p className="text-sm text-gray-400">{worker.phone}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleEnableWorker(worker.id)}
                        className="text-sm text-primary-600"
                      >
                        启用
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {showPositionModal && selectedWorker && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowPositionModal(false)}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">岗位分配 - {selectedWorker.name}</h3>
              <button onClick={() => setShowPositionModal(false)} className="p-1 hover:bg-gray-100 rounded-md">
                <X size={20} className="text-gray-500" />
              </button>
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">分配新岗位</label>
              <div className="flex gap-2">
                <select
                  value={selectedPositionId}
                  onChange={(e) => setSelectedPositionId(e.target.value)}
                  className="flex-1 px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                >
                  <option value="">请选择岗位</option>
                  {allPositions.filter(p => !workerPositions.find(wp => wp.id === p.id)).map(pos => (
                    <option key={pos.id} value={pos.id}>
                      {pos.department_name} / {pos.name} ({pos.type === 'external' ? '外请' : '内部'}) - ¥{pos.rate}/{pos.pay_type === 'per_hour' ? '小时' : '次'}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleAssignPosition}
                  disabled={!selectedPositionId || assigning}
                  className="px-4 py-3 bg-primary-500 text-white rounded-xl font-medium hover:bg-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Plus size={20} />
                </button>
              </div>
            </div>

            {workerPositions.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <Users size={48} className="mx-auto mb-2 opacity-50" />
                <p>该人员尚未分配岗位</p>
                <p className="text-xs mt-1">上方选择岗位后点击添加按钮分配</p>
              </div>
            ) : (
              <div className="space-y-2">
                {workerPositions.map(pos => (
                  <div key={pos.id} className="p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-gray-800">{pos.name}</div>
                        <div className="text-xs text-gray-500">{pos.department_name} | {pos.type === 'external' ? '外请' : '内部'}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        {pos.is_primary === 1 && (
                          <span className="text-xs px-2 py-1 bg-primary-100 text-primary-600 rounded">主岗</span>
                        )}
                        <button
                          onClick={() => handleRemovePosition(pos.id)}
                          className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded"
                          title="取消分配"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                    <div className="text-xs text-gray-400 mt-1">分配时间: {new Date(pos.assigned_at).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
