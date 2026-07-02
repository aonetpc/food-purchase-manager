import type { DailyPurchaseRecord, PurchaseItem, CategorySummary, Ingredient, Category } from '@/types';
import { ingredients as defaultIngredients } from './ingredients';
import { categories as defaultCategories } from './categories';
import { generateId } from '@/utils/format';
import { formatDate, getPastDays, getLastMonthSameDay } from '@/utils/date';
import { format } from 'date-fns';

const generatePriceVariation = (basePrice: number, volatility: number = 0.12): number => {
  const variation = (Math.random() - 0.5) * 2 * volatility;
  return Math.round(basePrice * (1 + variation) * 100) / 100;
};

const generateDailyItems = (dateStr: string, ingredients: Ingredient[], categories: Category[], isLastMonth: boolean = false): PurchaseItem[] => {
  const items: PurchaseItem[] = [];
  const basePriceMap = new Map(ingredients.map(i => [i.id, i.basePrice]));
  const selectedCount = Math.min(Math.floor(Math.random() * 8) + 25, ingredients.length);
  const shuffled = [...ingredients].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, Math.max(selectedCount, 1));

  selected.forEach(ingredient => {
    const basePrice = basePriceMap.get(ingredient.id) || ingredient.basePrice;
    const currentBasePrice = generatePriceVariation(basePrice, isLastMonth ? 0.08 : 0.12);
    
    const commonUnits = ingredient.units.filter(u => u.isCommon);
    const purchaseUnitObj = commonUnits[Math.floor(Math.random() * commonUnits.length)] || ingredient.units[0];
    const purchaseUnit = purchaseUnitObj.unit;
    const factor = purchaseUnitObj.factor;
    
    const purchaseUnitPrice = Math.round(currentBasePrice * factor * 100) / 100;
    const purchaseQuantity = Math.round((Math.random() * 8 + 1) * 10) / 10;
    const baseQuantity = Math.round(purchaseQuantity / factor * 100) / 100;
    const amount = Math.round(purchaseUnitPrice * purchaseQuantity * 100) / 100;
    
    const lastMonthBasePrice = generatePriceVariation(basePrice, 0.1);
    const priceChange = Math.round((currentBasePrice - lastMonthBasePrice) * 100) / 100;
    const priceChangeRate = Math.round((priceChange / lastMonthBasePrice) * 1000) / 10;

    const category = categories.find(c => c.id === ingredient.categoryId);

    items.push({
      id: generateId(),
      ingredientId: ingredient.id,
      ingredientName: ingredient.name,
      categoryId: ingredient.categoryId,
      categoryName: category?.name || '',
      purchaseUnit,
      purchaseQuantity,
      purchaseUnitPrice,
      baseQuantity,
      baseUnit: ingredient.baseUnit,
      baseUnitPrice: currentBasePrice,
      amount,
      lastMonthBasePrice,
      priceChange,
      priceChangeRate,
    });
  });

  return items.sort((a, b) => a.categoryId.localeCompare(b.categoryId));
};

const calculateCategorySummary = (items: PurchaseItem[], categories: Category[]): CategorySummary[] => {
  const summaryMap = new Map<string, { amount: number; count: number; name: string; color: string }>();
  
  items.forEach(item => {
    const existing = summaryMap.get(item.categoryId) || {
      amount: 0,
      count: 0,
      name: item.categoryName,
      color: categories.find(c => c.id === item.categoryId)?.color || '#666',
    };
    existing.amount += item.amount;
    existing.count += 1;
    summaryMap.set(item.categoryId, existing);
  });

  const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);
  
  return Array.from(summaryMap.entries())
    .map(([categoryId, data]) => ({
      categoryId,
      categoryName: data.name,
      color: data.color,
      amount: Math.round(data.amount * 100) / 100,
      percentage: totalAmount > 0 ? Math.round((data.amount / totalAmount) * 1000) / 10 : 0,
      itemCount: data.count,
    }))
    .sort((a, b) => b.amount - a.amount);
};

const dailyRecordsCache = new Map<string, DailyPurchaseRecord>();

export const generateDailyRecord = (date: Date | string, ingredients?: Ingredient[], categories?: Category[]): DailyPurchaseRecord => {
  const ings = ingredients || defaultIngredients;
  const cats = categories || defaultCategories;
  const dateStr = typeof date === 'string' ? date : formatDate(date);
  const cacheKey = `${dateStr}-${ings.length}-${cats.length}`;
  
  if (dailyRecordsCache.has(cacheKey)) {
    return dailyRecordsCache.get(cacheKey)!;
  }

  const items = generateDailyItems(dateStr, ings, cats);
  const totalAmount = Math.round(items.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;
  const categorySummary = calculateCategorySummary(items, cats);

  const record: DailyPurchaseRecord = {
    date: dateStr,
    items,
    totalAmount,
    categorySummary,
  };

  dailyRecordsCache.set(cacheKey, record);
  return record;
};

export const getTodayRecord = (ingredients?: Ingredient[], categories?: Category[]): DailyPurchaseRecord => {
  return generateDailyRecord(new Date(), ingredients, categories);
};

export const getRecentRecords = (days: number = 7, ingredients?: Ingredient[], categories?: Category[]): DailyPurchaseRecord[] => {
  const pastDays = getPastDays(days);
  return pastDays.map(d => generateDailyRecord(d, ingredients, categories));
};

export const getLastMonthRecord = (date: Date | string, ingredients?: Ingredient[], categories?: Category[]): DailyPurchaseRecord => {
  const lastMonthDate = getLastMonthSameDay(date);
  return generateDailyRecord(lastMonthDate, ingredients, categories);
};

export { format };
