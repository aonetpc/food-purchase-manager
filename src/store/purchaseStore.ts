import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import type { PurchaseItem } from '@/types';

export interface PurchaseEntryItem {
  id: string;
  date?: string;
  ingredientId: string;
  ingredientName: string;
  categoryId: string;
  categoryName: string;
  purchaseUnit: string;
  purchaseQuantity: number;
  purchaseUnitPrice: number;
  baseUnit: string;
  baseUnitPrice: number;
  baseQuantity: number;
  amount: number;
}

interface PurchaseStore {
  records: Record<string, PurchaseEntryItem[]>;
  loading: boolean;
  error: string | null;
  fetchRecords: (date: string) => Promise<void>;
  fetchMonthRecords: (yearMonth: string) => Promise<PurchaseEntryItem[]>;
  fetchYearRecords: (year: string) => Promise<PurchaseEntryItem[]>;
  addItem: (date: string, item: PurchaseEntryItem) => Promise<boolean>;
  updateItem: (date: string, itemId: string, updates: Partial<PurchaseEntryItem>) => Promise<boolean>;
  removeItem: (date: string, itemId: string) => Promise<boolean>;
  clearDate: (date: string) => Promise<boolean>;
  saveDateItems: (date: string, items: PurchaseEntryItem[]) => Promise<PurchaseEntryItem[] | null>;
  getItems: (date: string) => PurchaseEntryItem[];
  hasRecord: (date: string) => boolean;
}

// 辅助函数：将数据库记录转换为前端格式
const dbToFrontend = (row: any): PurchaseEntryItem => ({
  id: row.id,
  date: row.date,
  ingredientId: row.ingredient_id,
  ingredientName: row.ingredient_name,
  categoryId: row.category_id || '',
  categoryName: row.category_name || '',
  purchaseUnit: row.purchase_unit,
  purchaseQuantity: parseFloat(row.purchase_quantity),
  purchaseUnitPrice: parseFloat(row.purchase_unit_price),
  baseUnit: row.base_unit || '',
  baseUnitPrice: parseFloat(row.base_unit_price) || 0,
  baseQuantity: parseFloat(row.base_quantity) || 0,
  amount: parseFloat(row.amount),
});

const frontendToDb = (item: PurchaseEntryItem, date: string) => {
  const data: any = {
    date,
    ingredient_id: item.ingredientId,
    ingredient_name: item.ingredientName,
    category_id: item.categoryId,
    category_name: item.categoryName,
    purchase_unit: item.purchaseUnit,
    purchase_quantity: item.purchaseQuantity,
    purchase_unit_price: item.purchaseUnitPrice,
    base_unit: item.baseUnit,
    base_unit_price: item.baseUnitPrice,
    base_quantity: item.baseQuantity,
    amount: item.amount,
  };
  if (item.id && item.id.length === 36) {
    data.id = item.id;
  }
  return data;
};

export const usePurchaseStore = create<PurchaseStore>()((set, get) => ({
  records: {},
  loading: false,
  error: null,

  fetchRecords: async (date) => {
    set({ loading: true, error: null });
    try {
      const { data, error } = await supabase
        .from('purchase_records')
        .select('*')
        .eq('date', date)
        .order('created_at', { ascending: true });

      if (error) {
        set({ loading: false, error: error.message });
        return;
      }

      const items = data.map(dbToFrontend);

      set((state) => ({
        records: { ...state.records, [date]: items },
        loading: false,
      }));
    } catch (err) {
      set({ loading: false, error: '获取采购记录失败' });
    }
  },

  fetchMonthRecords: async (yearMonth) => {
    set({ loading: true, error: null });
    try {
      const { data, error } = await supabase
        .from('purchase_records')
        .select('*')
        .gte('date', `${yearMonth}-01`)
        .lte('date', `${yearMonth}-31`)
        .order('date', { ascending: true });

      if (error) {
        set({ loading: false, error: error.message });
        return [];
      }

      const items = data.map(dbToFrontend);
      const byDate: Record<string, PurchaseEntryItem[]> = {};
      items.forEach(item => {
        const row = data.find(r => r.id === item.id);
        const d = row?.date || '';
        if (!byDate[d]) byDate[d] = [];
        byDate[d].push(item);
      });

      set((state) => ({
        records: { ...state.records, ...byDate },
        loading: false,
      }));

      return items;
    } catch (err) {
      set({ loading: false, error: '获取月度采购记录失败' });
      return [];
    }
  },

  fetchYearRecords: async (year) => {
    set({ loading: true, error: null });
    try {
      const { data, error } = await supabase
        .from('purchase_records')
        .select('*')
        .gte('date', `${year}-01-01`)
        .lte('date', `${year}-12-31`)
        .order('date', { ascending: true });

      if (error) {
        set({ loading: false, error: error.message });
        return [];
      }

      const items = data.map(dbToFrontend);
      const byDate: Record<string, PurchaseEntryItem[]> = {};
      items.forEach(item => {
        const row = data.find(r => r.id === item.id);
        const d = row?.date || '';
        if (!byDate[d]) byDate[d] = [];
        byDate[d].push(item);
      });

      set((state) => ({
        records: { ...state.records, ...byDate },
        loading: false,
      }));

      return items;
    } catch (err) {
      set({ loading: false, error: '获取年度采购记录失败' });
      return [];
    }
  },

  addItem: async (date, item) => {
    try {
      const { error } = await supabase
        .from('purchase_records')
        .insert(frontendToDb(item, date));

      if (error) {
        set({ error: error.message });
        return false;
      }

      set((state) => ({
        records: {
          ...state.records,
          [date]: [...(state.records[date] || []), item],
        },
        error: null,
      }));

      return true;
    } catch (err) {
      set({ error: '添加记录失败' });
      return false;
    }
  },

  updateItem: async (date, itemId, updates) => {
    try {
      const updateData: any = {};
      if (updates.ingredientId) updateData.ingredient_id = updates.ingredientId;
      if (updates.ingredientName) updateData.ingredient_name = updates.ingredientName;
      if (updates.categoryId) updateData.category_id = updates.categoryId;
      if (updates.categoryName) updateData.category_name = updates.categoryName;
      if (updates.purchaseUnit) updateData.purchase_unit = updates.purchaseUnit;
      if (updates.purchaseQuantity) updateData.purchase_quantity = updates.purchaseQuantity;
      if (updates.purchaseUnitPrice) updateData.purchase_unit_price = updates.purchaseUnitPrice;
      if (updates.baseUnit) updateData.base_unit = updates.baseUnit;
      if (updates.baseUnitPrice) updateData.base_unit_price = updates.baseUnitPrice;
      if (updates.baseQuantity) updateData.base_quantity = updates.baseQuantity;
      if (updates.amount) updateData.amount = updates.amount;

      const { error } = await supabase
        .from('purchase_records')
        .update(updateData)
        .eq('id', itemId);

      if (error) {
        set({ error: error.message });
        return false;
      }

      set((state) => ({
        records: {
          ...state.records,
          [date]: (state.records[date] || []).map((item) =>
            item.id === itemId ? { ...item, ...updates } : item
          ),
        },
        error: null,
      }));

      return true;
    } catch (err) {
      set({ error: '更新记录失败' });
      return false;
    }
  },

  removeItem: async (date, itemId) => {
    try {
      const { error } = await supabase
        .from('purchase_records')
        .delete()
        .eq('id', itemId);

      if (error) {
        set({ error: error.message });
        return false;
      }

      set((state) => ({
        records: {
          ...state.records,
          [date]: (state.records[date] || []).filter((item) => item.id !== itemId),
        },
        error: null,
      }));

      return true;
    } catch (err) {
      set({ error: '删除记录失败' });
      return false;
    }
  },

  clearDate: async (date) => {
    try {
      const { error } = await supabase
        .from('purchase_records')
        .delete()
        .eq('date', date);

      if (error) {
        set({ error: error.message });
        return false;
      }

      set((state) => ({
        records: { ...state.records, [date]: [] },
        error: null,
      }));

      return true;
    } catch (err) {
      set({ error: '清空记录失败' });
      return false;
    }
  },

  saveDateItems: async (date, items) => {
    try {
      await supabase.from('purchase_records').delete().eq('date', date);

      if (items.length > 0) {
        const dbItems = items.map((item) => frontendToDb(item, date));
        const { data, error } = await supabase
          .from('purchase_records')
          .insert(dbItems)
          .select();

        if (error) {
          set({ error: error.message });
          return false;
        }

        if (data) {
          const savedItems: PurchaseEntryItem[] = data.map((row: any) => ({
            id: row.id,
            date: row.date,
            ingredientId: row.ingredient_id,
            ingredientName: row.ingredient_name,
            categoryId: row.category_id,
            categoryName: row.category_name,
            purchaseUnit: row.purchase_unit,
            purchaseQuantity: parseFloat(row.purchase_quantity),
            purchaseUnitPrice: parseFloat(row.purchase_unit_price),
            baseUnit: row.base_unit,
            baseUnitPrice: parseFloat(row.base_unit_price),
            baseQuantity: parseFloat(row.base_quantity),
            amount: parseFloat(row.amount),
          }));

          set((state) => ({
            records: { ...state.records, [date]: savedItems },
            error: null,
          }));
          return true;
        }
      }

      set((state) => ({
        records: { ...state.records, [date]: [] },
        error: null,
      }));

      return true;
    } catch (err) {
      set({ error: '保存记录失败' });
      return false;
    }
  },

  getItems: (date) => {
    const records = get().records;
    if (!records[date]) {
      // 如果本地没有，触发获取
      get().fetchRecords(date);
    }
    return records[date] || [];
  },

  hasRecord: (date) => {
    const records = get().records;
    return (records[date]?.length || 0) > 0;
  },
}));

// 构建 DailyPurchaseRecord 格式（兼容原有逻辑）
export const buildDailyRecordFromEntry = (
  date: string,
  items: PurchaseEntryItem[]
) => {
  return {
    date,
    items: items.map((item) => ({
      id: item.id,
      ingredientId: item.ingredientId,
      ingredientName: item.ingredientName,
      categoryId: item.categoryId,
      categoryName: item.categoryName,
      purchaseUnit: item.purchaseUnit,
      purchaseQuantity: item.purchaseQuantity,
      purchaseUnitPrice: item.purchaseUnitPrice,
      baseQuantity: item.baseQuantity,
      baseUnit: item.baseUnit,
      baseUnitPrice: item.baseUnitPrice,
      amount: item.amount,
      lastMonthBasePrice: item.baseUnitPrice,
      priceChange: 0,
      priceChangeRate: 0,
    })),
    totalAmount: items.reduce((sum, item) => sum + item.amount, 0),
    categorySummary: [],
  };
};