export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
}

export interface UnitConversion {
  unit: string;
  factor: number;
  isCommon?: boolean;
}

export interface Ingredient {
  id: string;
  name: string;
  categoryId: string;
  baseUnit: string;
  basePrice: number;
  image: string;
  units: UnitConversion[];
}

export interface PurchaseItem {
  id: string;
  ingredientId: string;
  ingredientName: string;
  categoryId: string;
  categoryName: string;
  departmentId?: string;
  departmentName?: string;
  purchaseUnit: string;
  purchaseQuantity: number;
  purchaseUnitPrice: number;
  baseQuantity: number;
  baseUnit: string;
  baseUnitPrice: number;
  amount: number;
  lastMonthBasePrice: number;
  priceChange: number;
  priceChangeRate: number;
}

export interface DailyPurchaseRecord {
  date: string;
  items: PurchaseItem[];
  totalAmount: number;
  categorySummary: CategorySummary[];
}

export interface CategorySummary {
  categoryId: string;
  categoryName: string;
  color: string;
  amount: number;
  percentage: number;
  itemCount: number;
}

export interface MonthlyAnalysis {
  yearMonth: string;
  totalAmount: number;
  itemCount: number;
  avgPrice: number;
  lastMonthTotalAmount: number;
  lastMonthAvgPrice: number;
  amountChangeRate: number;
  priceChangeRate: number;
  categoryBreakdown: CategoryMonthlyData[];
  topGainers: PriceChangeItem[];
  topLosers: PriceChangeItem[];
  monthlyTrend: MonthlyTrendPoint[];
}

export interface CategoryMonthlyData {
  categoryId: string;
  categoryName: string;
  color: string;
  totalAmount: number;
  avgPrice: number;
  lastMonthAvgPrice: number;
  priceChangeRate: number;
  amountPercentage: number;
}

export interface PriceChangeItem {
  ingredientId: string;
  ingredientName: string;
  categoryName: string;
  baseUnit: string;
  currentPrice: number;
  lastPrice: number;
  changeRate: number;
}

export interface MonthlyTrendPoint {
  month: string;
  totalAmount: number;
  avgPrice: number;
}

export interface YearlyPriceData {
  ingredientId: string;
  ingredientName: string;
  categoryName: string;
  baseUnit: string;
  yearlyAvg: number;
  monthlyPrices: MonthlyPrice[];
}

export interface MonthlyPrice {
  month: string;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
}
