import { create } from 'zustand';
import { api } from '@/lib/api';
import type { PurchaseItem } from '@/types';

export interface PurchaseEntryItem {
  id: string;
  date?: string;
  ingredientId: string;
  ingredientName: string;
  categoryId: string;
  categoryName: string;
  departmentId: string;
  departmentName: string;
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
  movePurchaseDate: (itemId: string, oldDate: string, newDate: string) => Promise<boolean>;
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
  departmentId: row.department_id || '',
  departmentName: row.department_name || '',
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
    department_id: item.departmentId,
    department_name: item.departmentName,
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
      const data = await api.get<any[]>(`/purchase?date=${date}`);

      const items = data.map(dbToFrontend);

      set((state) => ({
        records: { ...state.records, [date]: items },
        loading: false,
      }));
    } catch (err: any) {
      set({ loading: false, error: err.message || '获取采购记录失败' });
    }
  },

  fetchMonthRecords: async (yearMonth) => {
    set({ loading: true, error: null });
    try {
      const data = await api.get<any[]>(
        `/purchase?month=${yearMonth}`
      );

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
    } catch (err: any) {
      set({ loading: false, error: err.message || '获取月度采购记录失败' });
      return [];
    }
  },

  fetchYearRecords: async (year) => {
    set({ loading: true, error: null });
    try {
      const data = await api.get<any[]>(
        `/purchase?year=${year}`
      );

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
    } catch (err: any) {
      set({ loading: false, error: err.message || '获取年度采购记录失败' });
      return [];
    }
  },

  addItem: async (date, item) => {
    try {
      await api.post('/purchase', frontendToDb(item, date));

      set((state) => ({
        records: {
          ...state.records,
          [date]: [...(state.records[date] || []), item],
        },
        error: null,
      }));

      return true;
    } catch (err: any) {
      set({ error: err.message || '添加记录失败' });
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

      await api.put(`/purchase/${itemId}`, updateData);

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
    } catch (err: any) {
      set({ error: err.message || '更新记录失败' });
      return false;
    }
  },

  removeItem: async (date, itemId) => {
    try {
      await api.delete(`/purchase/${itemId}`);

      set((state) => ({
        records: {
          ...state.records,
          [date]: (state.records[date] || []).filter((item) => item.id !== itemId),
        },
        error: null,
      }));

      return true;
    } catch (err: any) {
      set({ error: err.message || '删除记录失败' });
      return false;
    }
  },

  clearDate: async (date) => {
    try {
      await api.delete(`/purchase/date/${date}`);

      set((state) => ({
        records: { ...state.records, [date]: [] },
        error: null,
      }));

      return true;
    } catch (err: any) {
      set({ error: err.message || '清空记录失败' });
      return false;
    }
  },

  saveDateItems: async (date, items) => {
    try {
      const savedItems = await api.post<any[]>('/purchase/batch-save', {
        date,
        items: items.map((item) => frontendToDb(item, date)),
      });

      const resultItems: PurchaseEntryItem[] = savedItems.map((row: any) => ({
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
        records: { ...state.records, [date]: resultItems },
        error: null,
      }));
      return resultItems;
    } catch (err: any) {
      set({ error: err.message || '保存记录失败' });
      return null;
    }
  },

  movePurchaseDate: async (itemId, oldDate, newDate) => {
    try {
      await api.post('/purchase/move-date', { id: itemId, newDate });

      set((state) => {
        const newRecords = { ...state.records };
        
        newRecords[oldDate] = (newRecords[oldDate] || []).filter(item => item.id !== itemId);
        
        if (oldDate !== newDate) {
          const movedItem = state.records[oldDate]?.find(item => item.id === itemId);
          if (movedItem) {
            if (!newRecords[newDate]) {
              newRecords[newDate] = [];
            }
            
            const existingIdx = newRecords[newDate].findIndex(
              item => item.ingredientId === movedItem.ingredientId && item.purchaseUnit === movedItem.purchaseUnit
            );
            
            if (existingIdx !== -1) {
              newRecords[newDate][existingIdx] = {
                ...newRecords[newDate][existingIdx],
                purchaseQuantity: newRecords[newDate][existingIdx].purchaseQuantity + movedItem.purchaseQuantity,
                amount: newRecords[newDate][existingIdx].amount + movedItem.amount,
              };
            } else {
              newRecords[newDate].push({ ...movedItem, date: newDate });
            }
          }
        }
        
        return { records: newRecords, error: null };
      });

      return true;
    } catch (err: any) {
      set({ error: err.message || '移动日期失败' });
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