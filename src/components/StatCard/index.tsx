import { ReactNode } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { formatCurrency, formatPercent } from '@/utils/format';

interface StatCardProps {
  title: string;
  value: string | number;
  prefix?: string;
  suffix?: string;
  changeRate?: number;
  changeLabel?: string;
  icon?: ReactNode;
  iconBg?: string;
  valueColor?: string;
}

export default function StatCard({
  title,
  value,
  prefix = '',
  suffix = '',
  changeRate,
  changeLabel = '较上月',
  icon,
  iconBg = 'bg-primary-100',
  valueColor = 'text-gray-800',
}: StatCardProps) {
  const isPositive = (changeRate || 0) >= 0;

  return (
    <div className="stat-card">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm text-gray-500 font-medium">{title}</p>
          <p className={`text-2xl font-bold mt-2 ${valueColor}`}>
            {prefix}{typeof value === 'number' ? formatCurrency(value).replace('¥', '') : value}{suffix}
          </p>
          {changeRate !== undefined && (
            <div className="flex items-center gap-1.5 mt-2">
              {isPositive ? (
                <TrendingUp size={14} className="text-danger-500" />
              ) : (
                <TrendingDown size={14} className="text-success-500" />
              )}
              <span className={`text-sm font-medium ${
                isPositive ? 'text-danger-600' : 'text-success-600'
              }`}>
                {formatPercent(changeRate)}
              </span>
              <span className="text-xs text-gray-400">{changeLabel}</span>
            </div>
          )}
        </div>
        {icon && (
          <div className={`w-12 h-12 ${iconBg} rounded-xl flex items-center justify-center text-primary-600`}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
