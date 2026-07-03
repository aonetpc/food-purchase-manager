import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
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
  getIngredientById: (id: string) => Ingredient | undefined;
  getIngredientsByCategory: (categoryId: string) => Ingredient[];
}

export const useIngredientStore = create<IngredientStore>()((set, get) => ({
  ingredients: [],
  loading: false,
  error: null,

  fetchIngredients: async () => {
    // 先从缓存读取
    const cached = cache.get<Ingredient[]>(CACHE_KEY);
    if (cached && cached.length > 0) {
      set({ ingredients: cached, loading: false });
      return;
    }

    set({ loading: true, error: null });
    try {
      const { data, error } = await supabase
        .from('ingredients')
        .select('*')
        .order('name', { ascending: true });

      if (error) {
        set({ loading: false, error: error.message });
        return;
      }

      const ingredients: Ingredient[] = data.map((row) => ({
        id: row.id,
        name: row.name,
        categoryId: row.category_id,
        baseUnit: row.base_unit,
        basePrice: parseFloat(row.base_price),
        image: row.image || '',
        units: row.units || [{ unit: row.base_unit, factor: 1, isCommon: true }],
      }));

      // 写入缓存
      cache.set(CACHE_KEY, ingredients);
      set({ ingredients, loading: false });
    } catch (err) {
      set({ loading: false, error: '获取食材失败' });
    }
  },

  addIngredient: async (data) => {
    try {
      const { data: result, error } = await supabase
        .from('ingredients')
        .insert({
          name: data.name,
          category_id: data.categoryId,
          base_unit: data.baseUnit,
          base_price: data.basePrice,
          image: data.image || '',
          units: data.units || [{ unit: data.baseUnit, factor: 1, isCommon: true }],
        })
        .select()
        .single();

      if (error || !result) {
        set({ error: error?.message || '添加食材失败' });
        return null;
      }

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
    } catch (err) {
      set({ error: '添加食材失败' });
      return null;
    }
  },

  updateIngredient: async (id, data) => {
    try {
      const updateData: any = {
        updated_at: new Date().toISOString(),
      };
      
      if (data.name) updateData.name = data.name;
      if (data.categoryId) updateData.category_id = data.categoryId;
      if (data.baseUnit) updateData.base_unit = data.baseUnit;
      if (data.basePrice) updateData.base_price = data.basePrice;
      if (data.image) updateData.image = data.image;
      if (data.units) updateData.units = data.units;

      const { error } = await supabase
        .from('ingredients')
        .update(updateData)
        .eq('id', id);

      if (error) {
        set({ error: error.message });
        return false;
      }

      const updatedIngredients = get().ingredients.map((ing) =>
        ing.id === id ? { ...ing, ...data } : ing
      );
      cache.set(CACHE_KEY, updatedIngredients);
      set({ ingredients: updatedIngredients, error: null });

      return true;
    } catch (err) {
      set({ error: '更新食材失败' });
      return false;
    }
  },

  deleteIngredient: async (id) => {
    try {
      const { error } = await supabase
        .from('ingredients')
        .delete()
        .eq('id', id);

      if (error) {
        set({ error: error.message });
        return false;
      }

      const updatedIngredients = get().ingredients.filter((ing) => ing.id !== id);
      cache.set(CACHE_KEY, updatedIngredients);
      set({ ingredients: updatedIngredients, error: null });

      return true;
    } catch (err) {
      set({ error: '删除食材失败' });
      return false;
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