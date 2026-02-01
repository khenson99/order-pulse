import { useState, useEffect } from 'react';
import { Icons } from '../components/Icons';
import { ExtractedOrder, InventoryItem } from '../types';

interface PipelineViewProps {
  isIngesting: boolean;
  progress: {
    total: number;
    processed: number;
    success: number;
    failed: number;
    currentTask: string;
  };
  currentEmail: { id: string; subject: string; sender: string } | null;
  orders: ExtractedOrder[];
  inventory: InventoryItem[];
  logs: string[];
  onContinueToDashboard: () => void;
}

export const PipelineView: React.FC<PipelineViewProps> = ({
  isIngesting,
  progress,
  currentEmail,
  orders,
  inventory,
  logs,
  onContinueToDashboard,
}) => {
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());

  // Auto-expand new orders as they come in
  useEffect(() => {
    if (orders.length > 0) {
      const latestOrder = orders[orders.length - 1];
      setExpandedOrders(prev => new Set(prev).add(latestOrder.id));
    }
  }, [orders.length]);

  const toggleOrder = (orderId: string) => {
    setExpandedOrders(prev => {
      const next = new Set(prev);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  };

  const totalLineItems = orders.reduce((sum, o) => sum + o.items.length, 0);

  return (
    <div className="min-h-screen bg-slate-900 text-white p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Email Processing Pipeline</h1>
          <p className="text-slate-400">
            {isIngesting 
              ? 'Analyzing your emails and extracting purchase orders...'
              : progress.processed > 0 
                ? 'Processing complete! Review your extracted orders below.'
                : 'Starting email analysis...'}
          </p>
        </div>

        {/* Pipeline Stages */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          {/* Stage 1: Emails */}
          <div className={`bg-slate-800 rounded-xl p-4 border-2 ${isIngesting ? 'border-blue-500' : 'border-slate-700'}`}>
            <div className="flex items-center gap-3 mb-3">
              <div className={`p-2 rounded-lg ${isIngesting ? 'bg-blue-500/20' : 'bg-slate-700'}`}>
                <Icons.Mail className={`w-5 h-5 ${isIngesting ? 'text-blue-400' : 'text-slate-400'}`} />
              </div>
              <div>
                <div className="font-semibold">Emails</div>
                <div className="text-2xl font-bold text-blue-400">{progress.total}</div>
              </div>
            </div>
            <div className="text-xs text-slate-500">
              {isIngesting ? `Processing ${progress.processed}/${progress.total}` : 'Scanned'}
            </div>
          </div>

          {/* Stage 2: Orders */}
          <div className={`bg-slate-800 rounded-xl p-4 border-2 ${orders.length > 0 ? 'border-green-500' : 'border-slate-700'}`}>
            <div className="flex items-center gap-3 mb-3">
              <div className={`p-2 rounded-lg ${orders.length > 0 ? 'bg-green-500/20' : 'bg-slate-700'}`}>
                <Icons.Package className={`w-5 h-5 ${orders.length > 0 ? 'text-green-400' : 'text-slate-400'}`} />
              </div>
              <div>
                <div className="font-semibold">Orders</div>
                <div className="text-2xl font-bold text-green-400">{orders.length}</div>
              </div>
            </div>
            <div className="text-xs text-slate-500">Extracted from emails</div>
          </div>

          {/* Stage 3: Line Items */}
          <div className={`bg-slate-800 rounded-xl p-4 border-2 ${totalLineItems > 0 ? 'border-orange-500' : 'border-slate-700'}`}>
            <div className="flex items-center gap-3 mb-3">
              <div className={`p-2 rounded-lg ${totalLineItems > 0 ? 'bg-orange-500/20' : 'bg-slate-700'}`}>
                <Icons.BarChart3 className={`w-5 h-5 ${totalLineItems > 0 ? 'text-orange-400' : 'text-slate-400'}`} />
              </div>
              <div>
                <div className="font-semibold">Line Items</div>
                <div className="text-2xl font-bold text-orange-400">{totalLineItems}</div>
              </div>
            </div>
            <div className="text-xs text-slate-500">Products in orders</div>
          </div>

          {/* Stage 4: Unique Items */}
          <div className={`bg-slate-800 rounded-xl p-4 border-2 ${inventory.length > 0 ? 'border-purple-500' : 'border-slate-700'}`}>
            <div className="flex items-center gap-3 mb-3">
              <div className={`p-2 rounded-lg ${inventory.length > 0 ? 'bg-purple-500/20' : 'bg-slate-700'}`}>
                <Icons.CheckCircle2 className={`w-5 h-5 ${inventory.length > 0 ? 'text-purple-400' : 'text-slate-400'}`} />
              </div>
              <div>
                <div className="font-semibold">Unique Items</div>
                <div className="text-2xl font-bold text-purple-400">{inventory.length}</div>
              </div>
            </div>
            <div className="text-xs text-slate-500">Aggregated products</div>
          </div>
        </div>

        {/* Progress Bar */}
        {isIngesting && (
          <div className="bg-slate-800 rounded-xl p-4 mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-slate-400">{progress.currentTask}</span>
              <span className="text-sm font-mono text-slate-400">
                {progress.processed}/{progress.total}
              </span>
            </div>
            <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-blue-500 to-green-500 transition-all duration-300"
                style={{ width: progress.total > 0 ? `${(progress.processed / progress.total) * 100}%` : '0%' }}
              />
            </div>
          </div>
        )}

        {/* Current Email Being Processed */}
        {currentEmail && isIngesting && (
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="animate-spin">
                <Icons.Loader2 className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <div className="text-sm text-slate-400">Processing email:</div>
                <div className="font-medium truncate">{currentEmail.subject}</div>
                <div className="text-xs text-slate-500">{currentEmail.sender}</div>
              </div>
            </div>
          </div>
        )}

        {/* Orders List */}
        {orders.length > 0 && (
          <div className="mb-6">
            <h2 className="text-lg font-semibold mb-4">Extracted Orders</h2>
            <div className="space-y-3">
              {orders.slice().reverse().map(order => (
                <div key={order.id} className="bg-slate-800 rounded-xl overflow-hidden border border-slate-700">
                  {/* Order Header */}
                  <button
                    onClick={() => toggleOrder(order.id)}
                    className="w-full p-4 flex items-center justify-between hover:bg-slate-750 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className="bg-green-500/20 p-2 rounded-lg">
                        <Icons.Package className="w-5 h-5 text-green-400" />
                      </div>
                      <div className="text-left">
                        <div className="font-medium">{order.supplier}</div>
                        <div className="text-sm text-slate-400">
                          {new Date(order.orderDate).toLocaleDateString()} • {order.items.length} item{order.items.length !== 1 ? 's' : ''}
                          {order.totalAmount ? ` • $${order.totalAmount.toFixed(2)}` : ''}
                        </div>
                      </div>
                    </div>
                    <Icons.ArrowRight className={`w-5 h-5 text-slate-400 transition-transform ${expandedOrders.has(order.id) ? 'rotate-90' : ''}`} />
                  </button>

                  {/* Order Items */}
                  {expandedOrders.has(order.id) && (
                    <div className="border-t border-slate-700 p-4 bg-slate-850">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-slate-400 text-left">
                            <th className="pb-2">Item Name</th>
                            <th className="pb-2">Qty</th>
                            <th className="pb-2">Unit</th>
                            <th className="pb-2 text-right">Unit Price</th>
                          </tr>
                        </thead>
                        <tbody>
                          {order.items.map((item, idx) => (
                            <tr key={idx} className="border-t border-slate-700/50">
                              <td className="py-2 font-medium">{item.name}</td>
                              <td className="py-2">{item.quantity}</td>
                              <td className="py-2 text-slate-400">{item.unit}</td>
                              <td className="py-2 text-right">
                                {item.unitPrice ? `$${item.unitPrice.toFixed(2)}` : '-'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Continue Button */}
        {!isIngesting && orders.length > 0 && (
          <div className="text-center">
            <button
              onClick={onContinueToDashboard}
              className="bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 px-8 py-3 rounded-xl font-medium transition-all shadow-lg shadow-orange-500/25"
            >
              Continue to Dashboard →
            </button>
          </div>
        )}

        {/* Logs */}
        {logs.length > 0 && (
          <div className="mt-8">
            <h3 className="text-sm font-semibold text-slate-400 mb-2">Activity Log</h3>
            <div className="bg-slate-800/50 rounded-lg p-3 max-h-40 overflow-y-auto font-mono text-xs text-slate-500">
              {logs.slice(0, 20).map((log, idx) => (
                <div key={idx} className="py-0.5">{log}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
