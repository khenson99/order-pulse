import { InventoryItem, ExtractedOrder } from '../types';
import { Icons } from '../components/Icons';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid } from 'recharts';

interface CadenceViewProps {
  inventory: InventoryItem[];
  orders?: ExtractedOrder[];
}

export const CadenceView: React.FC<CadenceViewProps> = ({ inventory }) => {
  // Cadence chart data (days between orders)
  const cadenceData = inventory
    .map(item => ({
      name: item.name.substring(0, 15) + (item.name.length > 15 ? '...' : ''),
      fullName: item.name,
      cadence: Math.round(item.averageCadenceDays),
      orderCount: item.orderCount,
    }))
    .sort((a, b) => a.cadence - b.cadence)
    .slice(0, 10); // Top 10

  // Velocity chart data (units per day - consumption rate)
  const velocityData = inventory
    .map(item => ({
      name: item.name.substring(0, 15) + (item.name.length > 15 ? '...' : ''),
      fullName: item.name,
      velocity: parseFloat(item.dailyBurnRate.toFixed(2)),
      supplier: item.supplier,
    }))
    .sort((a, b) => b.velocity - a.velocity)
    .slice(0, 10); // Top 10 fastest movers

  // Build complete line item history from inventory
  const lineItemHistory = inventory
    .flatMap(item =>
      item.history.map(h => ({
        date: h.date,
        itemName: item.name,
        supplier: item.supplier,
        quantity: h.quantity,
        unitPrice: item.lastPrice,
      }))
    )
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 50); // Last 50 transactions

  // Summary stats
  const totalItems = inventory.length; // Unique item types
  const avgCadence = inventory.length > 0
    ? Math.round(inventory.reduce((sum, i) => sum + i.averageCadenceDays, 0) / inventory.length)
    : 0;
  const totalLineItems = inventory.reduce((sum, i) => sum + i.history.length, 0); // Total line item occurrences
  const fastestMover = velocityData[0];

  if (inventory.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-arda-text-muted">
        <Icons.TrendingUp className="w-16 h-16 mb-4 opacity-50" />
        <p className="text-lg">No order data for analysis</p>
        <p className="text-sm mt-2">Process emails from the Ingestion Engine to see analytics</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-arda-text-primary">Cadence & Velocity Analysis</h2>
          <p className="text-arda-text-muted text-sm">Purchase patterns and consumption rates</p>
        </div>
      </div>

      {/* Summary Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg border border-arda-border">
          <div className="flex items-center gap-3">
            <div className="bg-arda-bg-tertiary p-2 rounded">
              <Icons.Package className="text-arda-accent w-5 h-5" />
            </div>
            <div>
              <div className="text-2xl font-bold text-arda-text-primary">{totalItems}</div>
              <div className="text-xs text-arda-text-muted">Unique Items Tracked</div>
            </div>
          </div>
        </div>
        <div className="bg-white p-4 rounded-lg border border-arda-border">
          <div className="flex items-center gap-3">
            <div className="bg-arda-bg-tertiary p-2 rounded">
              <Icons.Calendar className="text-arda-accent w-5 h-5" />
            </div>
            <div>
              <div className="text-2xl font-bold text-arda-text-primary">{avgCadence} days</div>
              <div className="text-xs text-arda-text-muted">Avg Order Cadence</div>
            </div>
          </div>
        </div>
        <div className="bg-white p-4 rounded-lg border border-arda-border">
          <div className="flex items-center gap-3">
            <div className="bg-arda-bg-tertiary p-2 rounded">
              <Icons.Inbox className="text-arda-accent w-5 h-5" />
            </div>
            <div>
              <div className="text-2xl font-bold text-arda-text-primary">{totalLineItems}</div>
              <div className="text-xs text-arda-text-muted">Total Line Items</div>
            </div>
          </div>
        </div>
        <div className="bg-white p-4 rounded-lg border border-arda-border">
          <div className="flex items-center gap-3">
            <div className="bg-arda-bg-tertiary p-2 rounded">
              <Icons.TrendingUp className="text-arda-accent w-5 h-5" />
            </div>
            <div>
              <div className="text-lg font-bold text-arda-text-primary truncate max-w-[150px]" title={fastestMover?.fullName}>
                {fastestMover?.fullName.substring(0, 16) || '-'}
              </div>
              <div className="text-xs text-arda-text-muted">Fastest Mover ({fastestMover?.velocity}/day)</div>
            </div>
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cadence Chart */}
        <div className="bg-white border border-arda-border rounded-lg p-6">
          <h3 className="text-lg font-semibold text-arda-text-primary mb-4">Order Cadence (Days)</h3>
          <p className="text-arda-text-muted text-xs mb-4">Average days between orders per item</p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cadenceData} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
                <XAxis type="number" stroke="#6B7280" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis
                  dataKey="name"
                  type="category"
                  stroke="#6B7280"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  width={100}
                />
                <Tooltip
                  cursor={{ fill: '#F3F4F6' }}
                  contentStyle={{ background: '#FFFFFF', border: '1px solid #E5E7EB', color: '#111827' }}
                  formatter={(value, name, props) => [
                    `${value} days (${(props.payload as any).orderCount} orders)`,
                    (props.payload as any).fullName
                  ]}
                />
                <Bar dataKey="cadence" fill="#58a6ff" radius={[0, 4, 4, 0]} barSize={18}>
                  {cadenceData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.cadence < 14 ? '#f85149' : '#58a6ff'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Velocity Chart */}
        <div className="bg-white border border-arda-border rounded-lg p-6">
          <h3 className="text-lg font-semibold text-arda-text-primary mb-4">Consumption Velocity</h3>
          <p className="text-arda-text-muted text-xs mb-4">Units consumed per day (burn rate)</p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={velocityData} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
                <XAxis type="number" stroke="#6B7280" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis
                  dataKey="name"
                  type="category"
                  stroke="#6B7280"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  width={100}
                />
                <Tooltip
                  cursor={{ fill: '#F3F4F6' }}
                  contentStyle={{ background: '#FFFFFF', border: '1px solid #E5E7EB', color: '#111827' }}
                  formatter={(value, name, props) => [
                    `${value} units/day`,
                    (props.payload as any).fullName
                  ]}
                />
                <Bar dataKey="velocity" fill="#3fb950" radius={[0, 4, 4, 0]} barSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Order Line Item History Table */}
      <div className="bg-white border border-arda-border rounded-lg overflow-hidden">
        <div className="p-4 border-b border-arda-border">
          <h3 className="text-lg font-semibold text-arda-text-primary">Order Line Item History</h3>
          <p className="text-arda-text-muted text-xs">Complete history of ordered items from emails</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-arda-bg-tertiary">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-arda-text-muted uppercase tracking-wider">Date</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-arda-text-muted uppercase tracking-wider">Supplier</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-arda-text-muted uppercase tracking-wider">Item Name</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-arda-text-muted uppercase tracking-wider">Qty</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-arda-text-muted uppercase tracking-wider">Unit Price</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-arda-border">
              {lineItemHistory.map((item, idx) => (
                <tr key={idx} className="hover:bg-arda-bg-tertiary/50 transition-colors">
                  <td className="px-4 py-3 text-sm text-arda-text-secondary">
                    {new Date(item.date).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-arda-text-primary">{item.supplier}</td>
                  <td className="px-4 py-3 text-sm text-arda-text-primary font-medium">{item.itemName}</td>
                  <td className="px-4 py-3 text-sm text-arda-text-secondary text-right">{item.quantity}</td>
                  <td className="px-4 py-3 text-sm text-arda-text-secondary text-right">
                    {item.unitPrice > 0 ? `$${item.unitPrice.toFixed(2)}` : '—'}
                  </td>
                </tr>
              ))}
              {lineItemHistory.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-arda-text-muted">
                    No order history yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
