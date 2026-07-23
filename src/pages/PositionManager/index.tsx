import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, Check, X, Users, DollarSign, Clock, Target, ChevronUp, ChevronDown } from 'lucide-react';
import { api } from '@/lib/api';

interface Department {
  id: string;
  name: string;
  parent_id?: string;
  full_path?: string;
}

interface Position {
  id: string;
  department_id: string;
  department_name: string;
  department_path?: string;
  name: string;
  type: 'internal' | 'external';
  pay_type: 'per_time' | 'per_hour';
  rate: number;
  need_assessment: number;
  sort_order: number;
  status: number;
  created_at: string;
  updated_at: string;
  auditor_count?: number;
  worker_count?: number;
}

export default function PositionManager() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showAddModal, setShowAddModal] = useState(false);
  const [showAuditorModal, setShowAuditorModal] = useState(false);
  const [editingPosition, setEditingPosition] = useState<Position | null>(null);
  const [selectedPosition, setSelectedPosition] = useState<Position | null>(null);
  const [auditors, setAuditors] = useState<{ id: string; user_id: string; name: string; username: string; phone: string; role: string }[]>([]);
  const [availableAuditors, setAvailableAuditors] = useState<{ id: string; name: string; username: string; phone: string; role: string }[]>([]);
  const [selectedAuditorId, setSelectedAuditorId] = useState('');

  const [newPosition, setNewPosition] = useState({
    name: '',
    department_id: '',
    type: 'external' as 'internal' | 'external',
    pay_type: 'per_time' as 'per_time' | 'per_hour',
    rate: '',
    need_assessment: 0,
    sort_order: 0,
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const [positionsRes, departmentsRes] = await Promise.all([
        api.get<Position[]>('/temp/positions'),
        api.get<Department[]>('/departments'),
      ]);
      setPositions(positionsRes);
      setDepartments(departmentsRes);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleAddPosition = async () => {
    if (!newPosition.name.trim() || !newPosition.department_id || !newPosition.rate) {
      setError('请填写完整信息');
      return;
    }

    try {
      await api.post('/temp/positions', {
        name: newPosition.name.trim(),
        department_id: newPosition.department_id,
        type: newPosition.type,
        pay_type: newPosition.pay_type,
        rate: parseFloat(newPosition.rate),
        need_assessment: newPosition.need_assessment,
        sort_order: newPosition.sort_order,
      });
      setShowAddModal(false);
      setNewPosition({ name: '', department_id: '', type: 'external', pay_type: 'per_time', rate: '', need_assessment: 0, sort_order: 0 });
      fetchData();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleUpdatePosition = async () => {
    if (!editingPosition) return;

    try {
      await api.put(`/temp/positions/${editingPosition.id}`, {
        name: editingPosition.name,
        department_id: editingPosition.department_id,
        type: editingPosition.type,
        pay_type: editingPosition.pay_type,
        rate: editingPosition.rate,
        need_assessment: editingPosition.need_assessment,
        sort_order: editingPosition.sort_order,
        status: editingPosition.status,
      });
      setEditingPosition(null);
      fetchData();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleDeletePosition = async (id: string) => {
    if (!window.confirm('确定删除该岗位吗？')) return;
    try {
      await api.delete(`/temp/positions/${id}`);
      fetchData();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleViewAuditors = async (position: Position) => {
    setSelectedPosition(position);
    setSelectedAuditorId('');
    try {
      const [auditorsRes, availableRes] = await Promise.all([
        api.get<{ id: string; user_id: string; name: string; username: string; phone: string; role: string }[]>(`/temp/positions/${position.id}/auditors`),
        api.get<{ id: string; name: string; username: string; phone: string; role: string }[]>('/temp/positions/available-auditors'),
      ]);
      setAuditors(auditorsRes);
      setAvailableAuditors(availableRes);
      setShowAuditorModal(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleAddAuditor = async () => {
    if (!selectedPosition || !selectedAuditorId) {
      setError('请选择审核员');
      return;
    }
    try {
      await api.post(`/temp/positions/${selectedPosition.id}/auditors`, { user_id: selectedAuditorId });
      fetchData();
      handleViewAuditors(selectedPosition);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleRemoveAuditor = async (userId: string) => {
    if (!selectedPosition || !window.confirm('确定移除该审核员吗？')) return;
    try {
      await api.delete(`/temp/positions/${selectedPosition.id}/auditors/${userId}`);
      handleViewAuditors(selectedPosition);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const getDepartmentName = (id: string) => {
    const dept = departments.find(d => d.id === id);
    return dept?.full_path || dept?.name || id;
  };

  const filteredPositions = positions.filter(p => p.status === 1);
  const disabledPositions = positions.filter(p => p.status === 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold text-gray-800">岗位管理</h1>
          <p className="text-gray-500 mt-1">管理外请和内部岗位，设置薪资标准和审核员</p>
        </div>
        <button onClick={() => setShowAddModal(true)} className="btn-primary flex items-center gap-2">
          <Plus size={18} />
          新增岗位
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
          {filteredPositions.length === 0 ? (
            <div className="card flex flex-col items-center justify-center py-20">
              <Target size={64} className="text-gray-300 mb-4" />
              <h3 className="text-lg font-medium text-gray-600 mb-2">暂无岗位</h3>
              <p className="text-gray-400 text-sm">请添加岗位以便管理外请人员打卡</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-4 font-medium text-gray-600">岗位名称</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">所属部门</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">类型</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">薪资标准</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">考核</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">审核员/人员</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPositions.map((pos, idx) => (
                    <tr key={pos.id} className="border-b border-gray-100 hover:bg-gray-50">
                      {editingPosition?.id === pos.id ? (
                        <>
                          <td colSpan={7} className="p-4">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                              <input
                                type="text"
                                value={editingPosition.name}
                                onChange={(e) => setEditingPosition(p => p ? { ...p, name: e.target.value } : null)}
                                className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
                                placeholder="岗位名称"
                              />
                              <select
                                value={editingPosition.department_id}
                                onChange={(e) => setEditingPosition(p => p ? { ...p, department_id: e.target.value } : null)}
                                className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
                              >
                                {departments.map(d => (
                                  <option key={d.id} value={d.id}>{d.full_path || d.name}</option>
                                ))}
                              </select>
                              <select
                                value={editingPosition.type}
                                onChange={(e) => setEditingPosition(p => p ? { ...p, type: e.target.value as 'internal' | 'external' } : null)}
                                className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
                              >
                                <option value="external">外请</option>
                                <option value="internal">内部</option>
                              </select>
                              <select
                                value={editingPosition.pay_type}
                                onChange={(e) => setEditingPosition(p => p ? { ...p, pay_type: e.target.value as 'per_time' | 'per_hour' } : null)}
                                className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
                              >
                                <option value="per_time">按次</option>
                                <option value="per_hour">按小时</option>
                              </select>
                              <input
                                type="number"
                                value={editingPosition.rate}
                                onChange={(e) => setEditingPosition(p => p ? { ...p, rate: parseFloat(e.target.value) } : null)}
                                className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
                                placeholder="单价"
                              />
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={editingPosition.need_assessment === 1}
                                  onChange={(e) => setEditingPosition(p => p ? { ...p, need_assessment: e.target.checked ? 1 : 0 } : null)}
                                />
                                需要考核
                              </label>
                              <div className="flex gap-2">
                                <button onClick={handleUpdatePosition} className="btn-primary">保存</button>
                                <button onClick={() => setEditingPosition(null)} className="btn-secondary">取消</button>
                              </div>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="py-4 px-4">
                            <div className="font-medium text-gray-800">{pos.name}</div>
                            <div className="text-xs text-gray-400">#{idx + 1}</div>
                          </td>
                          <td className="py-4 px-4">
                            <div className="text-sm text-gray-600">{getDepartmentName(pos.department_id)}</div>
                          </td>
                          <td className="py-4 px-4">
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                              pos.type === 'external' 
                                ? 'bg-orange-100 text-orange-700' 
                                : 'bg-green-100 text-green-700'
                            }`}>
                              {pos.type === 'external' ? '外请' : '内部'}
                            </span>
                          </td>
                          <td className="py-4 px-4">
                            <div className="flex items-center gap-2">
                              <DollarSign size={14} className="text-gray-400" />
                              <span className="font-medium">¥{pos.rate}</span>
                              <span className="text-sm text-gray-400">/{pos.pay_type === 'per_time' ? '次' : '小时'}</span>
                            </div>
                          </td>
                          <td className="py-4 px-4">
                            {pos.need_assessment === 1 ? (
                              <span className="inline-flex items-center gap-1 text-xs text-blue-600">
                                <Target size={14} /> 需要考核
                              </span>
                            ) : (
                              <span className="text-xs text-gray-400">不需要</span>
                            )}
                          </td>
                          <td className="py-4 px-4">
                            <div className="flex items-center gap-3 text-sm">
                              <span className="text-gray-500">
                                <Users size={14} className="inline mr-1" />
                                {pos.auditor_count || 0}审核员
                              </span>
                              <span className="text-gray-500">
                                {pos.worker_count || 0}人员
                              </span>
                            </div>
                          </td>
                          <td className="py-4 px-4">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleViewAuditors(pos)}
                                className="text-sm text-primary-600 hover:text-primary-700"
                              >
                                审核员
                              </button>
                              <button
                                onClick={() => setEditingPosition(pos)}
                                className="text-sm text-primary-600 hover:text-primary-700"
                              >
                                <Pencil size={16} />
                              </button>
                              <button
                                onClick={() => handleDeletePosition(pos.id)}
                                className="text-sm text-danger-600 hover:text-danger-700"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {disabledPositions.length > 0 && (
            <div className="mt-8">
              <h3 className="text-lg font-medium text-gray-600 mb-4">已禁用岗位</h3>
              <div className="space-y-2">
                {disabledPositions.map(pos => (
                  <div key={pos.id} className="card p-3 flex items-center justify-between opacity-60">
                    <span className="text-gray-500">{pos.name}</span>
                    <button
                      onClick={() => {
                        setEditingPosition({ ...pos, status: 1 });
                        handleUpdatePosition();
                      }}
                      className="text-sm text-primary-600"
                    >
                      启用
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowAddModal(false)}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">新增岗位</h3>
              <button onClick={() => setShowAddModal(false)} className="p-1 hover:bg-gray-100 rounded-md">
                <X size={20} className="text-gray-500" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">岗位名称 *</label>
                <input
                  type="text"
                  value={newPosition.name}
                  onChange={(e) => setNewPosition(p => ({ ...p, name: e.target.value }))}
                  placeholder="如：导医、外请导医"
                  className="w-full border border-gray-200 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">所属部门 *</label>
                <select
                  value={newPosition.department_id}
                  onChange={(e) => setNewPosition(p => ({ ...p, department_id: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                >
                  <option value="">请选择部门</option>
                  {departments.map(d => (
                    <option key={d.id} value={d.id}>{d.full_path || d.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">类型</label>
                  <select
                    value={newPosition.type}
                    onChange={(e) => setNewPosition(p => ({ ...p, type: e.target.value as 'internal' | 'external' }))}
                    className="w-full border border-gray-200 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  >
                    <option value="external">外请</option>
                    <option value="internal">内部</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">计费方式</label>
                  <select
                    value={newPosition.pay_type}
                    onChange={(e) => setNewPosition(p => ({ ...p, pay_type: e.target.value as 'per_time' | 'per_hour' }))}
                    className="w-full border border-gray-200 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  >
                    <option value="per_time">按次</option>
                    <option value="per_hour">按小时</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">单价 (元) *</label>
                <input
                  type="number"
                  step="0.01"
                  value={newPosition.rate}
                  onChange={(e) => setNewPosition(p => ({ ...p, rate: e.target.value }))}
                  placeholder="如：100"
                  className="w-full border border-gray-200 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                />
              </div>
              <div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={newPosition.need_assessment === 1}
                    onChange={(e) => setNewPosition(p => ({ ...p, need_assessment: e.target.checked ? 1 : 0 }))}
                  />
                  <span className="text-sm font-medium text-gray-700">需要月底考核</span>
                </label>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowAddModal(false)} className="btn-secondary flex-1">取消</button>
              <button onClick={handleAddPosition} className="btn-primary flex-1">添加</button>
            </div>
          </div>
        </div>
      )}

      {showAuditorModal && selectedPosition && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowAuditorModal(false)}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">岗位审核员 - {selectedPosition.name}</h3>
              <button onClick={() => setShowAuditorModal(false)} className="p-1 hover:bg-gray-100 rounded-md">
                <X size={20} className="text-gray-500" />
              </button>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">选择审核员</label>
              <div className="flex gap-2">
                <select
                  value={selectedAuditorId}
                  onChange={(e) => setSelectedAuditorId(e.target.value)}
                  className="flex-1 border border-gray-200 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                >
                  <option value="">请选择审核员</option>
                  {availableAuditors.map(auditor => (
                    <option key={auditor.id} value={auditor.id}>
                      {auditor.name} ({auditor.username}) {auditor.phone && `- ${auditor.phone}`}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleAddAuditor}
                  disabled={!selectedAuditorId}
                  className="btn-primary flex items-center justify-center gap-1 disabled:opacity-50"
                >
                  <Plus size={18} />
                  添加
                </button>
              </div>
            </div>
            {auditors.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <Users size={48} className="mx-auto mb-2 opacity-50" />
                <p>暂无审核员</p>
              </div>
            ) : (
              <div className="space-y-2">
                {auditors.map(auditor => (
                  <div key={auditor.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div>
                      <div className="font-medium text-gray-800">{auditor.name}</div>
                      <div className="text-xs text-gray-500">{auditor.username} | {auditor.phone || '无手机号'}</div>
                    </div>
                    <button
                      onClick={() => handleRemoveAuditor(auditor.user_id)}
                      className="text-danger-600 hover:text-danger-700"
                    >
                      <Trash2 size={16} />
                    </button>
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
