import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import type { Ingredient, UnitConversion } from '@/types';

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

      set((state) => ({
        ingredients: [...state.ingredients, newIngredient],
        error: null,
      }));

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

      set((state) => ({
        ingredients: state.ingredients.map((ing) =>
          ing.id === id ? { ...ing, ...data } : ing
        ),
        error: null,
      }));

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

      set((state) => ({
        ingredients: state.ingredients.filter((ing) => ing.id !== id),
        error: null,
      }));

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