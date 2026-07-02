import type { MonthlyAnalysis, CategoryMonthlyData, PriceChangeItem, MonthlyTrendPoint, YearlyPriceData, MonthlyPrice, Ingredient, Category } from '@/types';
import { categories as defaultCategories } from './categories';
import { ingredients as defaultIngredients } from './ingredients';
import { getPastMonths, getMonthLabel } from '@/utils/date';
import { generateId } from '@/utils/format';

const generateMonthlyAnalysis = (yearMonth: string, ingredients: Ingredient[], categories: Category[]): MonthlyAnalysis => {
  const [year, month] = yearMonth.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  
  const categoryBreakdown: CategoryMonthlyData[] = categories.map(cat => {
    const baseAmount = Math.random() * 8000 + 3000;
    const avgPrice = Math.random() * 30 + 5;
    const lastMonthAvgPrice = avgPrice * (1 + (Math.random() - 0.45) * 0.15);
    const priceChangeRate = Math.round(((avgPrice - lastMonthAvgPrice) / lastMonthAvgPrice) * 1000) / 10;
    
    return {
      categoryId: cat.id,
      categoryName: cat.name,
      color: cat.color,
      totalAmount: Math.round(baseAmount * 100) / 100,
      avgPrice: Math.round(avgPrice * 100) / 100,
      lastMonthAvgPrice: Math.round(lastMonthAvgPrice * 100) / 100,
      priceChangeRate,
      amountPercentage: 0,
    };
  });

  const totalAmount = Math.round(categoryBreakdown.reduce((sum, c) => sum + c.totalAmount, 0) * 100) / 100;
  categoryBreakdown.forEach(c => {
    c.amountPercentage = Math.round((c.totalAmount / totalAmount) * 1000) / 10;
  });

  const sortedIngredients = [...ingredients].sort(() => Math.random() - 0.5);
  const topGainers: PriceChangeItem[] = sortedIngredients.slice(0, Math.min(5, sortedIngredients.length)).map(ing => {
    const currentPrice = ing.basePrice * (1 + Math.random() * 0.15 + 0.05);
    const lastPrice = ing.basePrice * (1 - Math.random() * 0.05);
    return {
      ingredientId: ing.id,
      ingredientName: ing.name,
      categoryName: categories.find(c => c.id === ing.categoryId)?.name || '',
      baseUnit: ing.baseUnit,
      currentPrice: Math.round(currentPrice * 100) / 100,
      lastPrice: Math.round(lastPrice * 100) / 100,
      changeRate: Math.round(((currentPrice - lastPrice) / lastPrice) * 1000) / 10,
    };
  }).sort((a, b) => b.changeRate - a.changeRate);

  const topLosers: PriceChangeItem[] = sortedIngredients.slice(5, Math.min(10, sortedIngredients.length)).map(ing => {
    const currentPrice = ing.basePrice * (1 - Math.random() * 0.12 - 0.03);
    const lastPrice = ing.basePrice * (1 + Math.random() * 0.05);
    return {
      ingredientId: ing.id,
      ingredientName: ing.name,
      categoryName: categories.find(c => c.id === ing.categoryId)?.name || '',
      baseUnit: ing.baseUnit,
      currentPrice: Math.round(currentPrice * 100) / 100,
      lastPrice: Math.round(lastPrice * 100) / 100,
      changeRate: Math.round(((currentPrice - lastPrice) / lastPrice) * 1000) / 10,
    };
  }).sort((a, b) => a.changeRate - b.changeRate);

  const past12Months = getPastMonths(12);
  const monthlyTrend: MonthlyTrendPoint[] = past12Months.map(m => ({
    month: getMonthLabel(m),
    totalAmount: Math.round((Math.random() * 15000 + 25000) * 100) / 100,
    avgPrice: Math.round((Math.random() * 10 + 15) * 100) / 100,
  }));

  const avgPrice = categoryBreakdown.length > 0
    ? Math.round(categoryBreakdown.reduce((sum, c) => sum + c.avgPrice, 0) / categoryBreakdown.length * 100) / 100
    : 0;
  const lastMonthAvgPrice = Math.round(avgPrice * (1 + (Math.random() - 0.45) * 0.08) * 100) / 100;
  const lastMonthTotalAmount = Math.round(totalAmount * (1 + (Math.random() - 0.45) * 0.1) * 100) / 100;

  return {
    yearMonth,
    totalAmount,
    itemCount: Math.floor(Math.random() * 30 + 80),
    avgPrice,
    lastMonthTotalAmount,
    lastMonthAvgPrice,
    amountChangeRate: Math.round(((totalAmount - lastMonthTotalAmount) / lastMonthTotalAmount) * 1000) / 10,
    priceChangeRate: Math.round(((avgPrice - lastMonthAvgPrice) / lastMonthAvgPrice) * 1000) / 10,
    categoryBreakdown,
    topGainers,
    topLosers,
    monthlyTrend,
  };
};

const monthlyAnalysisCache = new Map<string, MonthlyAnalysis>();

export const getMonthlyAnalysis = (yearMonth: string, ingredients?: Ingredient[], categories?: Category[]): MonthlyAnalysis => {
  const ings = ingredients || defaultIngredients;
  const cats = categories || defaultCategories;
  const cacheKey = `${yearMonth}-${ings.length}-${cats.length}`;
  if (monthlyAnalysisCache.has(cacheKey)) {
    return monthlyAnalysisCache.get(cacheKey)!;
  }
  const analysis = generateMonthlyAnalysis(yearMonth, ings, cats);
  monthlyAnalysisCache.set(cacheKey, analysis);
  return analysis;
};

const generateYearlyPriceData = (ingredientId: string, ingredients: Ingredient[], categories: Category[]): YearlyPriceData => {
  const ingredient = ingredients.find(i => i.id === ingredientId);
  if (!ingredient) {
    return {
      ingredientId,
      ingredientName: '',
      categoryName: '',
      baseUnit: '',
      yearlyAvg: 0,
      monthlyPrices: [],
    };
  }

  const past12Months = getPastMonths(12);
  const basePrice = ingredient.basePrice;
  
  const monthlyPrices: MonthlyPrice[] = past12Months.map((month, idx) => {
    const trendFactor = (idx - 6) * 0.01;
    const volatility = (Math.random() - 0.5) * 0.2;
    const avgPrice = Math.round(basePrice * (1 + trendFactor + volatility) * 100) / 100;
    return {
      month,
      avgPrice,
      minPrice: Math.round(avgPrice * (1 - Math.random() * 0.1) * 100) / 100,
      maxPrice: Math.round(avgPrice * (1 + Math.random() * 0.1) * 100) / 100,
    };
  });

  const yearlyAvg = monthlyPrices.length > 0
    ? Math.round(monthlyPrices.reduce((sum, m) => sum + m.avgPrice, 0) / monthlyPrices.length * 100) / 100
    : 0;

  return {
    ingredientId,
    ingredientName: ingredient.name,
    categoryName: categories.find(c => c.id === ingredient.categoryId)?.name || '',
    baseUnit: ingredient.baseUnit,
    yearlyAvg,
    monthlyPrices,
  };
};

const yearlyPriceCache = new Map<string, YearlyPriceData>();

export const getYearlyPriceData = (ingredientId: string, ingredients?: Ingredient[], categories?: Category[]): YearlyPriceData => {
  const ings = ingredients || defaultIngredients;
  const cats = categories || defaultCategories;
  const cacheKey = `${ingredientId}-${ings.length}-${cats.length}`;
  if (yearlyPriceCache.has(cacheKey)) {
    return yearlyPriceCache.get(cacheKey)!;
  }
  const data = generateYearlyPriceData(ingredientId, ings, cats);
  yearlyPriceCache.set(cacheKey, data);
  return data;
};

export const getAllYearlyPriceData = (ingredients?: Ingredient[], categories?: Category[]): YearlyPriceData[] => {
  const ings = ingredients || defaultIngredients;
  const cats = categories || defaultCategories;
  return ings.map(ing => getYearlyPriceData(ing.id, ings, cats));
};

export { generateId };
