import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, X, Search, Check, Target, Building2 } from 'lucide-react';
import { api } from '@/lib/api';

interface Position {
  id: string;
  name: string;
  department_id: string;
  department_name: string;
  department_path: string;
  type: 'internal' | 'external';
  pay_type: 'per_time' | 'per_hour';
  rate: number;
  need_assessment: number;
  sort_order: number;
  status: number;
  auditor_count: number;
  worker_count: number;
  created_at: string;
  updated_at: string;
}

interface Department {
  id: string;
  name: string;
  full_path: string;
  level: number;
  parent_id: string | null;
}

interface PositionForm {
  name: string;
  department_id: string;
  type: 'internal' | 'external';
  pay_type: 'per_time' | 'per_hour';
  rate: string;
  need_assessment: number;
  sort_order: string;
}

export default function TempPositionManager() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingPosition, setEditingPosition] = useState<Position | null>(null);
  const [form, setForm] = useState<PositionForm>({
    name: '',
    department_id: '',
    type: 'external',
    pay_type: 'per_time',
    rate: '',
    need_assessment: 0,
    sort_order: '0',
  });
  const [submitting, setSubmitting] = useState(false);

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

  const handleOpenModal = (position?: Position) => {
    if (position) {
      setEditingPosition(position);
      setForm({
        name: position.name,
        department_id: position.department_id,
        type: position.type,
        pay_type: position.pay_type,
        rate: String(position.rate),
        need_assessment: position.need_assessment,
        sort_order: String(position.sort_order),
      });
    } else {
      setEditingPosition(null);
      setForm({
        name: '',
        department_id: '',
        type: 'external',
        pay_type: 'per_time',
        rate: '',
        need_assessment: 0,
        sort_order: '0',
      });
    }
    setShowModal(true);
  };

  const handleSubmit = async () => {
    if (!form.name || !form.department_id || !form.rate) {
      setError('请填写岗位名称、部门和单价');
      return;
    }

    try {
      setSubmitting(true);
      const data = {
        ...form,
        rate: parseFloat(form.rate),
        need_assessment: form.need_assessment,
        sort_order: parseInt(form.sort_order) || 0,
      };

      if (editingPosition) {
        await api.put(`/temp/positions/${editingPosition.id}`, data);
      } else {
        await api.post('/temp/positions', data);
      }

      setShowModal(false);
      fetchData();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (position: Position) => {
    if (!window.confirm(`确定删除岗位「${position.name}」吗？有打卡记录的岗位将被禁用。`)) return;
    try {
      await api.delete(`/temp/positions/${position.id}`);
      fetchData();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleStatusToggle = async (position: Position) => {
    try {
      await api.put(`/temp/positions/${position.id}`, { status: position.status === 1 ? 0 : 1 });
      fetchData();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const filteredPositions = positions.filter(p => 
    p.name.includes(searchTerm) || 
    p.department_name.includes(searchTerm)
  );

  const activePositions = filteredPositions.filter(p => p.status === 1);
  const inactivePositions = filteredPositions.filter(p => p.status === 0);

  const getDepartmentOptions = () => {
    const topLevel = departments.filter(d => !d.parent_id);
    const options: { value: string; label: string; disabled?: boolean }[] = [];
    
    topLevel.forEach(dept => {
      options.push({ value: dept.id, label: dept.full_path || dept.name });
      const children = departments.filter(d => d.parent_id === dept.id);
      children.forEach(child => {
        options.push({ value: child.id, label: `  ├ ${child.full_path || child.name}` });
      });
    });

    return options;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold text-gray-800">岗位管理</h1>
          <p className="text-gray-500 mt-1">管理外请人员的岗位信息</p>
        </div>
        <button
          onClick={() => handleOpenModal()}
          className="btn-primary flex items-center gap-2"
        >
          <Plus size={18} />
          新增岗位
        </button>
      </div>

      <div className="flex gap-4">
        <div className="relative flex-1 max-w-md">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchData()}
            placeholder="搜索岗位名称或部门..."
            className="w-full pl-10 border border-gray-200 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
          />
        </div>
        <button onClick={fetchData} className="btn-primary">搜索</button>
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
          {activePositions.length === 0 ? (
            <div className="card flex flex-col items-center justify-center py-20">
              <Target size={64} className="text-gray-300 mb-4" />
              <h3 className="text-lg font-medium text-gray-600 mb-2">暂无岗位</h3>
              <p className="text-gray-400 text-sm">点击右上角新增岗位</p>
            </div>
          ) : (
            <div className="card">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-3 px-4 font-medium text-gray-600">岗位名称</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-600">部门</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-600">类型</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-600">结算方式</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-600">单价</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-600">考核</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-600">审核员</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-600">人员数</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-600">状态</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-600">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activePositions.map(pos => (
                      <tr key={pos.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-4 px-4">
                          <div className="font-medium text-gray-800">{pos.name}</div>
                          <div className="text-xs text-gray-400">{pos.department_path}</div>
                        </td>
                        <td className="py-4 px-4">
                          <div className="flex items-center gap-2">
                            <Building2 size={14} className="text-gray-400" />
                            <span className="text-sm text-gray-600">{pos.department_name}</span>
                          </div>
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
                          <span className="text-sm text-gray-600">
                            {pos.pay_type === 'per_time' ? '按次' : '按小时'}
                          </span>
                        </td>
                        <td className="py-4 px-4">
                          <span className="font-medium text-gray-800">¥{pos.rate}</span>
                          <span className="text-xs text-gray-400">/{pos.pay_type === 'per_time' ? '次' : '小时'}</span>
                        </td>
                        <td className="py-4 px-4">
                          {pos.need_assessment === 1 ? (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
                              需要考核
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">无需考核</span>
                          )}
                        </td>
                        <td className="py-4 px-4">
                          <span className="text-sm text-gray-600">{pos.auditor_count || 0}人</span>
                        </td>
                        <td className="py-4 px-4">
                          <span className="text-sm text-gray-600">{pos.worker_count || 0}人</span>
                        </td>
                        <td className="py-4 px-4">
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                            启用
                          </span>
                        </td>
                        <td className="py-4 px-4">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleOpenModal(pos)}
                              className="p-1.5 text-gray-400 hover:text-primary-500 hover:bg-primary-50 rounded"
                              title="编辑"
                            >
                              <Pencil size={16} />
                            </button>
                            {pos.name !== '临时岗位' && (
                              <button
                                onClick={() => handleStatusToggle(pos)}
                                className="p-1.5 text-gray-400 hover:text-warning-500 hover:bg-warning-50 rounded"
                                title="禁用"
                              >
                                <X size={16} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {inactivePositions.length > 0 && (
            <div className="mt-8">
              <h3 className="text-lg font-medium text-gray-600 mb-4">已禁用岗位</h3>
              <div className="card">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-3 px-4 font-medium text-gray-600">岗位名称</th>
                        <th className="text-left py-3 px-4 font-medium text-gray-600">部门</th>
                        <th className="text-left py-3 px-4 font-medium text-gray-600">类型</th>
                        <th className="text-left py-3 px-4 font-medium text-gray-600">状态</th>
                        <th className="text-left py-3 px-4 font-medium text-gray-600">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inactivePositions.map(pos => (
                        <tr key={pos.id} className="border-b border-gray-100 opacity-60">
                          <td className="py-4 px-4">
                            <div className="font-medium text-gray-600">{pos.name}</div>
                          </td>
                          <td className="py-4 px-4">
                            <span className="text-sm text-gray-500">{pos.department_name}</span>
                          </td>
                          <td className="py-4 px-4">
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                              pos.type === 'external'
                                ? 'bg-orange-100 text-orange-600'
                                : 'bg-blue-100 text-blue-600'
                            }`}>
                              {pos.type === 'external' ? '外请' : '内部'}
                            </span>
                          </td>
                          <td className="py-4 px-4">
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                              禁用
                            </span>
                          </td>
                          <td className="py-4 px-4">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleOpenModal(pos)}
                                className="p-1.5 text-gray-400 hover:text-primary-500 hover:bg-primary-50 rounded"
                                title="编辑"
                              >
                                <Pencil size={16} />
                              </button>
                              <button
                                onClick={() => handleStatusToggle(pos)}
                                className="p-1.5 text-gray-400 hover:text-green-500 hover:bg-green-50 rounded"
                                title="启用"
                              >
                                <Check size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-800">
                {editingPosition ? '编辑岗位' : '新增岗位'}
              </h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">岗位名称 *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  placeholder="请输入岗位名称"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">所属部门 *</label>
                <select
                  value={form.department_id}
                  onChange={(e) => setForm(prev => ({ ...prev, department_id: e.target.value }))}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                >
                  <option value="">请选择部门</option>
                  {getDepartmentOptions().map(opt => (
                    <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">岗位类型 *</label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm(prev => ({ ...prev, type: e.target.value as 'internal' | 'external' }))}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  >
                    <option value="external">外请</option>
                    <option value="internal">内部</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">结算方式 *</label>
                  <select
                    value={form.pay_type}
                    onChange={(e) => setForm(prev => ({ ...prev, pay_type: e.target.value as 'per_time' | 'per_hour' }))}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  >
                    <option value="per_time">按次</option>
                    <option value="per_hour">按小时</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  单价 * <span className="text-gray-400 font-normal">（元/{form.pay_type === 'per_time' ? '次' : '小时'}）</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={form.rate}
                  onChange={(e) => setForm(prev => ({ ...prev, rate: e.target.value }))}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  placeholder="请输入单价"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">需要考核</label>
                  <select
                    value={form.need_assessment}
                    onChange={(e) => setForm(prev => ({ ...prev, need_assessment: parseInt(e.target.value) || 0 }))}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  >
                    <option value={0}>不需要</option>
                    <option value={1}>需要</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">排序</label>
                  <input
                    type="number"
                    value={form.sort_order}
                    onChange={(e) => setForm(prev => ({ ...prev, sort_order: e.target.value }))}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                    placeholder="0"
                  />
                </div>
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 py-3 bg-gray-100 text-gray-600 rounded-xl font-medium hover:bg-gray-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="flex-1 py-3 bg-primary-500 text-white rounded-xl font-medium hover:bg-primary-600 transition-colors disabled:opacity-50"
              >
                {submitting ? '提交中...' : (editingPosition ? '保存修改' : '创建岗位')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}