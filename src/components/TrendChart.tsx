import { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { formatCurrency } from '@/utils/format';

export default function TrendChart({ data }: { data: any[] }) {
  const chartData = useMemo(() => {
    const map = new Map<string, { month: string; 盈亏: number }>();
    data.forEach(d => {
      const m = d.period_month;
      const cur = map.get(m) || { month: m, 盈亏: 0 };
      cur.盈亏 += Number(d.total_diff_value) || 0;
      map.set(m, cur);
    });
    return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
  }, [data]);

  if (chartData.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-1.5">
        📈 盈亏趋势（按月汇总）
      </h3>
      <div style={{ width: '100%', height: 320 }}>
        <ResponsiveContainer>
          <LineChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="month" stroke="#94a3b8" fontSize={12} />
            <YAxis stroke="#94a3b8" fontSize={12} tickFormatter={(v) => `¥${v}`} />
            <Tooltip
              formatter={(v: number) => formatCurrency(v)}
              labelFormatter={(l) => `${l}`}
              contentStyle={{ border: '1px solid #e2e8f0', borderRadius: 8 }}
            />
            <Legend />
            <Line type="monotone" dataKey="盈亏" stroke="#2563eb" strokeWidth={2.5}
              dot={{ r: 4, fill: '#2563eb' }} activeDot={{ r: 6 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
