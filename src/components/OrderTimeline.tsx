import React, { useMemo } from 'react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { ExtractedOrder } from '../types';

interface OrderTimelineProps {
  orders: ExtractedOrder[];
  onOrderClick?: (order: ExtractedOrder) => void;
}

// Color palette for suppliers
const SUPPLIER_COLORS = [
  '#f97316', // orange-500
  '#3b82f6', // blue-500
  '#10b981', // green-500
  '#8b5cf6', // purple-500
  '#ec4899', // pink-500
  '#06b6d4', // cyan-500
  '#f59e0b', // amber-500
  '#ef4444', // red-500
  '#14b8a6', // teal-500
  '#6366f1', // indigo-500
];

interface ChartDataPoint {
  x: number; // timestamp
  y: number; // totalAmount
  order: ExtractedOrder;
  supplier: string;
  date: string;
  itemCount: number;
}

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length > 0) {
    const data = payload[0].payload as ChartDataPoint;
    const order = data.order;
    const date = new Date(order.orderDate);
    
    return (
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 shadow-lg">
        <div className="text-white font-semibold mb-2">{order.supplier}</div>
        <div className="text-sm space-y-1">
          <div className="text-slate-300">
            Date: <span className="text-white">{date.toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })}</span>
          </div>
          <div className="text-slate-300">
            Amount: <span className="text-white">${order.totalAmount?.toFixed(2) || 'N/A'}</span>
          </div>
          <div className="text-slate-300">
            Items: <span className="text-white">{order.items.length}</span>
          </div>
          {order.confidence < 1 && (
            <div className="text-slate-400 text-xs mt-1">
              Confidence: {(order.confidence * 100).toFixed(0)}%
            </div>
          )}
        </div>
      </div>
    );
  }
  return null;
};

export const OrderTimeline: React.FC<OrderTimelineProps> = ({
  orders,
  onOrderClick,
}) => {
  // Transform orders into chart data
  const chartData = useMemo(() => {
    return orders
      .filter(order => order.totalAmount !== undefined && order.totalAmount > 0)
      .map(order => ({
        x: new Date(order.orderDate).getTime(),
        y: order.totalAmount!,
        order,
        supplier: order.supplier,
        date: order.orderDate,
        itemCount: order.items.length,
      }))
      .sort((a, b) => a.x - b.x);
  }, [orders]);

  // Get unique suppliers and assign colors
  const supplierColorMap = useMemo(() => {
    const suppliers = Array.from(new Set(orders.map(o => o.supplier)));
    const map = new Map<string, string>();
    suppliers.forEach((supplier, index) => {
      map.set(supplier, SUPPLIER_COLORS[index % SUPPLIER_COLORS.length]);
    });
    return map;
  }, [orders]);

  // Group data by supplier for legend
  const supplierData = useMemo(() => {
    const suppliers = Array.from(new Set(orders.map(o => o.supplier)));
    return suppliers.map(supplier => ({
      name: supplier,
      color: supplierColorMap.get(supplier) || SUPPLIER_COLORS[0],
    }));
  }, [orders, supplierColorMap]);

  // Format date for X-axis
  const formatXAxis = (tickItem: number) => {
    const date = new Date(tickItem);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  };

  // Format currency for Y-axis
  const formatYAxis = (tickItem: number) => {
    if (tickItem >= 1000) {
      return `$${(tickItem / 1000).toFixed(1)}k`;
    }
    return `$${tickItem.toFixed(0)}`;
  };

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 bg-slate-900/50 rounded-lg border border-slate-800">
        <p className="text-slate-400 text-lg">No order data to display</p>
        <p className="text-slate-500 text-sm mt-1">
          Process orders to see timeline visualization
        </p>
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 bg-slate-900/50 rounded-lg border border-slate-800">
        <p className="text-slate-400 text-lg">No orders with amounts to display</p>
        <p className="text-slate-500 text-sm mt-1">
          Orders need total amounts to appear on the timeline
        </p>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-slate-900/50 rounded-lg border border-slate-800 p-4">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-white mb-1">Order Timeline</h3>
        <p className="text-sm text-slate-400">
          Visualizing {orders.length} order{orders.length !== 1 ? 's' : ''} over time
        </p>
      </div>
      
      <ResponsiveContainer width="100%" height={400}>
        <ScatterChart
          margin={{ top: 20, right: 30, bottom: 60, left: 60 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#475569" opacity={0.3} />
          <XAxis
            type="number"
            dataKey="x"
            domain={['dataMin', 'dataMax']}
            tickFormatter={formatXAxis}
            stroke="#94a3b8"
            style={{ fontSize: '12px' }}
            label={{
              value: 'Date',
              position: 'insideBottom',
              offset: -10,
              style: { textAnchor: 'middle', fill: '#94a3b8', fontSize: '14px' },
            }}
          />
          <YAxis
            type="number"
            dataKey="y"
            tickFormatter={formatYAxis}
            stroke="#94a3b8"
            style={{ fontSize: '12px' }}
            label={{
              value: 'Order Value',
              angle: -90,
              position: 'insideLeft',
              style: { textAnchor: 'middle', fill: '#94a3b8', fontSize: '14px' },
            }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ paddingTop: '20px' }}
            iconType="circle"
            formatter={(value) => (
              <span style={{ color: '#e2e8f0', fontSize: '12px' }}>{value}</span>
            )}
          />
          {supplierData.map((supplier) => {
            const supplierPoints = chartData.filter(d => d.supplier === supplier.name);
            return (
              <Scatter
                key={supplier.name}
                name={supplier.name}
                data={supplierPoints}
                fill={supplier.color}
                onClick={(data: ChartDataPoint) => {
                  if (onOrderClick && data?.order) {
                    onOrderClick(data.order);
                  }
                }}
                style={{ cursor: onOrderClick ? 'pointer' : 'default' }}
              />
            );
          })}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
};

export default OrderTimeline;
