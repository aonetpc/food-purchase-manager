import { format, subMonths, subDays, addDays, startOfMonth, endOfMonth, eachDayOfInterval } from 'date-fns';
import { zhCN } from 'date-fns/locale';

export const formatDate = (date: Date | string, fmt: string = 'yyyy-MM-dd'): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  return format(d, fmt, { locale: zhCN });
};

export const formatDateCN = (date: Date | string): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  return format(d, 'yyyy年MM月dd日', { locale: zhCN });
};

export const formatMonthCN = (date: Date | string): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  return format(d, 'yyyy年MM月', { locale: zhCN });
};

export const getLastMonthSameDay = (date: Date | string): Date => {
  const d = typeof date === 'string' ? new Date(date) : date;
  return subMonths(d, 1);
};

export const getMonthDays = (year: number, month: number): Date[] => {
  const start = startOfMonth(new Date(year, month - 1));
  const end = endOfMonth(new Date(year, month - 1));
  return eachDayOfInterval({ start, end });
};

export const getPastDays = (days: number): Date[] => {
  const result: Date[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    result.push(subDays(today, i));
  }
  return result;
};

export const getPastMonths = (months: number): string[] => {
  const result: string[] = [];
  let current = new Date();
  current.setDate(1);
  for (let i = 0; i < months; i++) {
    result.push(format(current, 'yyyy-MM'));
    current = subMonths(current, 1);
  }
  return result.reverse();
};

export const getMonthLabel = (yearMonth: string): string => {
  const [year, month] = yearMonth.split('-');
  return `${parseInt(month)}月`;
};

export const getToday = (): Date => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
};

export { addDays, subDays, subMonths };
