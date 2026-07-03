import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
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
}

export const useCategoryStore = create<CategoryStore>()((set, get) => ({
  categories: [],
  loading: false,
  error: null,

  fetchCategories: async () => {
    // 先从缓存读取
    const cached = cache.get<Category[]>(CACHE_KEY);
    if (cached && cached.length > 0) {
      set({ categories: cached, loading: false });
      return;
    }

    set({ loading: true, error: null });
    try {
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .order('sort_order', { ascending: true });

      if (error) {
        set({ loading: false, error: error.message });
        return;
      }

      const categories: Category[] = data.map((row) => ({
        id: row.id,
        name: row.name,
        icon: row.icon || '🏷️',
        color: row.color || '#666666',
      }));

      // 写入缓存
      cache.set(CACHE_KEY, categories);
      set({ categories, loading: false });
    } catch (err) {
      set({ loading: false, error: '获取分类失败' });
    }
  },

  addCategory: async (data) => {
    try {
      const sort_order = get().categories.length + 1;
      const { data: result, error } = await supabase
        .from('categories')
        .insert({
          name: data.name,
          icon: data.icon || '🏷️',
          color: data.color || '#666666',
          sort_order,
        })
        .select()
        .single();

      if (error || !result) {
        set({ error: error?.message || '添加分类失败' });
        return null;
      }

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
    } catch (err) {
      set({ error: '添加分类失败' });
      return null;
    }
  },

  updateCategory: async (id, data) => {
    try {
      const { error } = await supabase
        .from('categories')
        .update({
          name: data.name,
          icon: data.icon,
          color: data.color,
        })
        .eq('id', id);

      if (error) {
        set({ error: error.message });
        return false;
      }

      const updatedCategories = get().categories.map((cat) =>
        cat.id === id ? { ...cat, ...data } : cat
      );
      cache.set(CACHE_KEY, updatedCategories);
      set({ categories: updatedCategories, error: null });

      return true;
    } catch (err) {
      set({ error: '更新分类失败' });
      return false;
    }
  },

  deleteCategory: async (id) => {
    try {
      const { error } = await supabase
        .from('categories')
        .delete()
        .eq('id', id);

      if (error) {
        set({ error: error.message });
        return false;
      }

      const updatedCategories = get().categories.filter((cat) => cat.id !== id);
      cache.set(CACHE_KEY, updatedCategories);
      set({ categories: updatedCategories, error: null });

      return true;
    } catch (err) {
      set({ error: '删除分类失败' });
      return false;
    }
  },
}));

// 初始化时自动获取分类
useCategoryStore.getState().fetchCategories();