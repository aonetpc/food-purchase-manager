import { create } from 'zustand';
import { api } from '@/lib/api';
import type { Supplier } from '@/types';

interface SupplierStore {
  suppliers: Supplier[];
  loading: boolean;
  error: string | null;
  fetchSuppliers: () => Promise<void>;
  addSupplier: (supplier: Omit<Supplier, 'id' | 'sort_order'>) => Promise<Supplier | null>;
  updateSupplier: (id: string, supplier: Partial<Supplier>) => Promise<boolean>;
  deleteSupplier: (id: string) => Promise<boolean>;
  moveUp: (id: string) => Promise<boolean>;
  moveDown: (id: string) => Promise<boolean>;
  getDefaultSupplier: () => Supplier | null;
}

export const useSupplierStore = create<SupplierStore>()((set, get) => ({
  suppliers: [],
  loading: false,
  error: null,

  fetchSuppliers: async () => {
    set({ loading: true, error: null });
    try {
      const data = await api.get<Supplier[]>('/suppliers');
      set({ suppliers: data, loading: false });
    } catch (err: any) {
      set({ loading: false, error: err.message || '获取供应商列表失败' });
    }
  },

  addSupplier: async (supplier) => {
    try {
      const data = await api.post<Supplier>('/suppliers', supplier);
      set((state) => ({
        suppliers: [...state.suppliers, data],
        error: null,
      }));
      return data;
    } catch (err: any) {
      set({ error: err.message || '添加供应商失败' });
      return null;
    }
  },

  updateSupplier: async (id, supplier) => {
    try {
      const data = await api.put<Supplier>(`/suppliers/${id}`, supplier);
      set((state) => ({
        suppliers: state.suppliers.map((s) =>
          s.id === id ? data : s
        ),
        error: null,
      }));
      return true;
    } catch (err: any) {
      set({ error: err.message || '更新供应商失败' });
      return false;
    }
  },

  deleteSupplier: async (id) => {
    try {
      await api.delete(`/suppliers/${id}`);
      set((state) => ({
        suppliers: state.suppliers.filter((s) => s.id !== id),
        error: null,
      }));
      return true;
    } catch (err: any) {
      set({ error: err.message || '删除供应商失败' });
      return false;
    }
  },

  moveUp: async (id) => {
    try {
      await api.post(`/suppliers/${id}/move-up`);
      await get().fetchSuppliers();
      return true;
    } catch (err: any) {
      set({ error: err.message || '移动失败' });
      return false;
    }
  },

  moveDown: async (id) => {
    try {
      await api.post(`/suppliers/${id}/move-down`);
      await get().fetchSuppliers();
      return true;
    } catch (err: any) {
      set({ error: err.message || '移动失败' });
      return false;
    }
  },

  getDefaultSupplier: () => {
    const suppliers = get().suppliers;
    return suppliers.length > 0 ? suppliers[0] : null;
  },
}));