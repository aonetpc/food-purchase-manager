export const formatCurrency = (amount: number): string => {
  return `¥${amount.toFixed(2)}`;
};

export const formatPercent = (value: number): string => {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
};

export const formatNumber = (value: number, decimals: number = 2): string => {
  return value.toFixed(decimals);
};

export const getPriceChangeColor = (changeRate: number): string => {
  if (changeRate > 5) return 'text-danger-600';
  if (changeRate > 0) return 'text-warning-600';
  if (changeRate > -3) return 'text-success-600';
  return 'text-success-700';
};

export const getPriceChangeBgColor = (changeRate: number): string => {
  if (changeRate > 5) return 'bg-danger-50 text-danger-700';
  if (changeRate > 0) return 'bg-warning-50 text-warning-700';
  return 'bg-success-50 text-success-700';
};

export const generateId = (): string => {
  return Math.random().toString(36).substring(2, 11);
};
