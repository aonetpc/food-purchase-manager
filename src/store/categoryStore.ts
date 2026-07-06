import { create } from 'zustand';
import { api } from '@/lib/api';
import { cache } from '@/lib/cache';
import type { Category } from '@/types';

const CACHE_KEY = 'categories';

interface CategoryStore {
  categories: Category[];
  loading: boolean;
  error: string | null;
  fetchCategories: () => Promise<void>;
  addCategory: (data: { name: string; icon?: string; color?: string }) => Promise<Category | null>;
  updateCategory: (id: string, data: Partial<Category>) => Promise<boolean>;
  deleteCategory: (id: string) => Promise<boolean>;
  moveCategoryUp: (id: string) => Promise<boolean>;
  moveCategoryDown: (id: string) => Promise<boolean>;
}

export const useCategoryStore = create<CategoryStore>()((set, get) => ({
  categories: [],
  loading: false,
  error: null,

  fetchCategories: async () => {
    const cached = cache.get<Category[]>(CACHE_KEY);
    if (cached && cached.length > 0) {
      set({ categories: cached, loading: false });
    }

    set({ loading: true, error: null });
    try {
      const data = await api.get<any[]>('/categories');

      const categories: Category[] = data.map((row) => ({
        id: row.id,
        name: row.name,
        icon: row.icon || '🏷️',
        color: row.color || '#666666',
      }));

      cache.set(CACHE_KEY, categories);
      set({ categories, loading: false });
    } catch (err: any) {
      set({ loading: false, error: err.message || '获取分类失败' });
    }
  },

  addCategory: async (data) => {
    try {
      const result = await api.post<any>('/categories', {
        name: data.name,
        icon: data.icon || '🏷️',
        color: data.color || '#666666',
      });

      const newCategory: Category = {
        id: result.id,
        name: result.name,
        icon: result.icon,
        color: result.color,
      };

      const updatedCategories = [...get().categories, newCategory];
      cache.set(CACHE_KEY, updatedCategories);
      set({ categories: updatedCategories, error: null });

      return newCategory;
    } catch (err: any) {
      set({ error: err.message || '添加分类失败' });
      throw err;
    }
  },

  updateCategory: async (id, data) => {
    try {
      await api.put(`/categories/${id}`, {
        name: data.name,
        icon: data.icon,
        color: data.color,
      });

      const updatedCategories = get().categories.map((cat) =>
        cat.id === id ? { ...cat, ...data } : cat
      );
      cache.set(CACHE_KEY, updatedCategories);
      set({ categories: updatedCategories, error: null });

      return true;
    } catch (err: any) {
      set({ error: err.message || '更新分类失败' });
      throw err;
    }
  },

  deleteCategory: async (id) => {
    try {
      await api.delete(`/categories/${id}`);

      const updatedCategories = get().categories.filter((cat) => cat.id !== id);
      cache.set(CACHE_KEY, updatedCategories);
      set({ categories: updatedCategories, error: null });

      return true;
    } catch (err: any) {
      set({ error: err.message || '删除分类失败' });
      throw err;
    }
  },

  moveCategoryUp: async (id) => {
    try {
      await api.post(`/categories/${id}/move-up`);

      const list = [...get().categories];
      const index = list.findIndex(c => c.id === id);
      if (index > 0) {
        [list[index - 1], list[index]] = [list[index], list[index - 1]];
        cache.set(CACHE_KEY, list);
        set({ categories: list });
      }

      return true;
    } catch (err: any) {
      set({ error: err.message || '上移失败' });
      throw err;
    }
  },

  moveCategoryDown: async (id) => {
    try {
      await api.post(`/categories/${id}/move-down`);

      const list = [...get().categories];
      const index = list.findIndex(c => c.id === id);
      if (index >= 0 && index < list.length - 1) {
        [list[index], list[index + 1]] = [list[index + 1], list[index]];
        cache.set(CACHE_KEY, list);
        set({ categories: list });
      }

      return true;
    } catch (err: any) {
      set({ error: err.message || '下移失败' });
      throw err;
    }
  },
}));

useCategoryStore.getState().fetchCategories();
