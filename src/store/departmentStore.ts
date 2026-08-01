import { create } from 'zustand';
import { api } from '@/lib/api';

export interface Department {
  id: string;
  name: string;
  sort_order: number;
  created_at?: string;
  confirmer_userid?: string;
  wecom_dept_id?: string;
}

interface DepartmentStore {
  departments: Department[];
  loading: boolean;
  error: string | null;
  fetchDepartments: () => Promise<void>;
  addDepartment: (name: string) => Promise<Department | null>;
  updateDepartment: (id: string, name: string) => Promise<boolean>;
  deleteDepartment: (id: string) => Promise<boolean>;
  moveUp: (id: string) => Promise<boolean>;
  moveDown: (id: string) => Promise<boolean>;
  getDefaultDepartment: () => Department | null;
}

export const useDepartmentStore = create<DepartmentStore>()((set, get) => ({
  departments: [],
  loading: false,
  error: null,

  fetchDepartments: async () => {
    set({ loading: true, error: null });
    try {
      const data = await api.get<Department[]>('/departments');
      set({ departments: data, loading: false });
    } catch (err: any) {
      set({ loading: false, error: err.message || '获取部门列表失败' });
    }
  },

  addDepartment: async (name) => {
    try {
      const data = await api.post<Department>('/departments', { name });
      set((state) => ({
        departments: [...state.departments, data],
        error: null,
      }));
      return data;
    } catch (err: any) {
      set({ error: err.message || '添加部门失败' });
      return null;
    }
  },

  updateDepartment: async (id, name) => {
    try {
      const data = await api.put<Department>(`/departments/${id}`, { name });
      set((state) => ({
        departments: state.departments.map((d) =>
          d.id === id ? data : d
        ),
        error: null,
      }));
      return true;
    } catch (err: any) {
      set({ error: err.message || '更新部门失败' });
      return false;
    }
  },

  deleteDepartment: async (id) => {
    try {
      await api.delete(`/departments/${id}`);
      set((state) => ({
        departments: state.departments.filter((d) => d.id !== id),
        error: null,
      }));
      return true;
    } catch (err: any) {
      set({ error: err.message || '删除部门失败' });
      return false;
    }
  },

  moveUp: async (id) => {
    try {
      await api.post(`/departments/${id}/move-up`);
      await get().fetchDepartments();
      return true;
    } catch (err: any) {
      set({ error: err.message || '移动失败' });
      return false;
    }
  },

  moveDown: async (id) => {
    try {
      await api.post(`/departments/${id}/move-down`);
      await get().fetchDepartments();
      return true;
    } catch (err: any) {
      set({ error: err.message || '移动失败' });
      return false;
    }
  },

  getDefaultDepartment: () => {
    const departments = get().departments;
    return departments.length > 0 ? departments[0] : null;
  },
}));