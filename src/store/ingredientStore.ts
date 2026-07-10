import { create } from 'zustand';
import { api } from '@/lib/api';
import { cache } from '@/lib/cache';
import type { Ingredient, UnitConversion } from '@/types';

const CACHE_KEY = 'ingredients';

interface IngredientStore {
  ingredients: Ingredient[];
  loading: boolean;
  error: string | null;
  fetchIngredients: () => Promise<void>;
  addIngredient: (data: {
    name: string;
    categoryId: string;
    baseUnit: string;
    basePrice: number;
    image?: string;
    units?: UnitConversion[];
  }) => Promise<Ingredient | null>;
  updateIngredient: (id: string, data: Partial<Ingredient>) => Promise<boolean>;
  deleteIngredient: (id: string) => Promise<boolean>;
  syncCategory: (id: string) => Promise<{ success: boolean; updatedCount: number; message: string }>;
  getIngredientById: (id: string) => Ingredient | undefined;
  getIngredientsByCategory: (categoryId: string) => Ingredient[];
}

export const useIngredientStore = create<IngredientStore>()((set, get) => ({
  ingredients: [],
  loading: false,
  error: null,

  fetchIngredients: async () => {
    const cached = cache.get<Ingredient[]>(CACHE_KEY);
    if (cached && cached.length > 0) {
      set({ ingredients: cached, loading: false });
      return;
    }

    set({ loading: true, error: null });
    try {
      const data = await api.get<any[]>('/ingredients');

      const ingredients: Ingredient[] = data.map((row) => ({
        id: row.id,
        name: row.name,
        categoryId: row.category_id,
        baseUnit: row.base_unit,
        basePrice: parseFloat(row.base_price),
        image: row.image || '',
        units: row.units || [{ unit: row.base_unit, factor: 1, isCommon: true }],
      }));

      cache.set(CACHE_KEY, ingredients);
      set({ ingredients, loading: false });
    } catch (err: any) {
      set({ loading: false, error: err.message || '获取食材失败' });
    }
  },

  addIngredient: async (data) => {
    try {
      const result = await api.post<any>('/ingredients', {
        name: data.name,
        category_id: data.categoryId,
        base_unit: data.baseUnit,
        base_price: data.basePrice,
        image: data.image || '',
        units: data.units || [{ unit: data.baseUnit, factor: 1, isCommon: true }],
      });

      const newIngredient: Ingredient = {
        id: result.id,
        name: result.name,
        categoryId: result.category_id,
        baseUnit: result.base_unit,
        basePrice: parseFloat(result.base_price),
        image: result.image || '',
        units: result.units || [{ unit: result.base_unit, factor: 1, isCommon: true }],
      };

      const updatedIngredients = [...get().ingredients, newIngredient];
      cache.set(CACHE_KEY, updatedIngredients);
      set({ ingredients: updatedIngredients, error: null });

      return newIngredient;
    } catch (err: any) {
      set({ error: err.message || '添加食材失败' });
      throw err;
    }
  },

  updateIngredient: async (id, data) => {
    try {
      const updateData: any = {};
      
      if (data.name !== undefined) updateData.name = data.name;
      if (data.categoryId !== undefined) updateData.category_id = data.categoryId;
      if (data.baseUnit !== undefined) updateData.base_unit = data.baseUnit;
      if (data.basePrice !== undefined) updateData.base_price = data.basePrice;
      if (data.image !== undefined) updateData.image = data.image;
      if (data.units !== undefined) updateData.units = data.units;

      await api.put(`/ingredients/${id}`, updateData);

      const updatedIngredients = get().ingredients.map((ing) =>
        ing.id === id ? { ...ing, ...data } : ing
      );
      cache.set(CACHE_KEY, updatedIngredients);
      set({ ingredients: updatedIngredients, error: null });

      return true;
    } catch (err: any) {
      set({ error: err.message || '更新食材失败' });
      throw err;
    }
  },

  deleteIngredient: async (id) => {
    try {
      await api.delete(`/ingredients/${id}`);

      const updatedIngredients = get().ingredients.filter((ing) => ing.id !== id);
      cache.set(CACHE_KEY, updatedIngredients);
      set({ ingredients: updatedIngredients, error: null });

      return true;
    } catch (err: any) {
      set({ error: err.message || '删除食材失败' });
      return false;
    }
  },

  syncCategory: async (id) => {
    try {
      const result = await api.post<{ success: boolean; updatedCount: number; message: string }>(`/ingredients/${id}/sync-category`);
      set({ error: null });
      return result;
    } catch (err: any) {
      set({ error: err.message || '同步失败' });
      return { success: false, updatedCount: 0, message: err.message || '同步失败' };
    }
  },

  getIngredientById: (id) => {
    return get().ingredients.find((ing) => ing.id === id);
  },

  getIngredientsByCategory: (categoryId) => {
    return get().ingredients.filter((ing) => ing.categoryId === categoryId);
  },
}));

// 初始化时自动获取食材
useIngredientStore.getState().fetchIngredients();