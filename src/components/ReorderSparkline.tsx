import React from 'react';
import { LineChart, Line, ResponsiveContainer, Tooltip } from 'recharts';

interface OrderDataPoint {
  date: string;
  quantity: number;
}

interface ReorderSparklineProps {
  orders: OrderDataPoint[];
  width?: number;
  height?: number;
  color?: string;
  showTooltip?: boolean;
}

export const ReorderSparkline: React.FC<ReorderSparklineProps> = ({
  orders,
  width = 100,
  height = 24,
  color = '#f97316', // orange-500
  showTooltip = true,
}) => {
  if (!orders || orders.length < 2) {
    return (
      <div 
        className="flex items-center justify-center text-xs text-arda-text-muted"
        style={{ width, height }}
      >
        —
      </div>
    );
  }

  // Sort and format data for the chart
  const chartData = orders
    .map(o => ({
      date: o.date,
      quantity: o.quantity,
      displayDate: new Date(o.date).toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric' 
      }),
    }))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return (
    <div style={{ width, height }} className="overflow-hidden">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          {showTooltip && (
            <Tooltip
              contentStyle={{
                background: '#ffffff',
                border: '1px solid #E5E7EB',
                borderRadius: '6px',
                fontSize: '11px',
                padding: '4px 8px',
              }}
              labelStyle={{ color: '#4B5563' }}
              formatter={(value) => [`Qty: ${value}`, '']}
              labelFormatter={(_label, payload) => {
                if (payload && payload[0]) {
                  return (payload[0].payload as { displayDate: string }).displayDate;
                }
                return '';
              }}
            />
          )}
          <Line
            type="monotone"
            dataKey="quantity"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 3, fill: color }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default ReorderSparkline;
