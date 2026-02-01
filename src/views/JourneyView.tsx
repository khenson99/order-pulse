import React, { useState, useMemo } from 'react';
import { ExtractedOrder, InventoryItem, RawEmail, LineItemNodeData, ItemVelocityProfile } from '../types';
import { OrderTree } from '../components/OrderTree';
import { ReorderAlerts } from '../components/ReorderAlerts';
import { OrderTimeline } from '../components/OrderTimeline';
import { Icons } from '../components/Icons';
import { buildVelocityProfiles } from '../utils/inventoryLogic';
import { exportVelocityToCSV, exportOrdersToCSV } from '../utils/exportUtils';

interface JourneyViewProps {
  orders: ExtractedOrder[];
  inventory: InventoryItem[];
  emails?: RawEmail[];
  onReorder?: (item: InventoryItem) => void;
}

export const JourneyView: React.FC<JourneyViewProps> = ({
  orders,
  inventory,
  emails,
  onReorder,
}) => {
  const [selectedItem, setSelectedItem] = useState<LineItemNodeData | null>(null);
  const [activeTab, setActiveTab] = useState<'tree' | 'timeline'>('tree');
  
  // Build velocity profiles for the selected item panel
  const velocityProfiles = useMemo(() => 
    buildVelocityProfiles(orders),
    [orders]
  );

  const handleItemClick = (itemData: LineItemNodeData) => {
    setSelectedItem(itemData);
  };

  const getVelocityProfile = (normalizedName: string): ItemVelocityProfile | undefined => {
    return velocityProfiles.get(normalizedName);
  };

  const selectedProfile = selectedItem ? getVelocityProfile(selectedItem.normalizedName) : undefined;

  // Find matching inventory item for reorder
  const matchingInventoryItem = selectedItem 
    ? inventory.find(i => i.name.toLowerCase().trim() === selectedItem.normalizedName)
    : undefined;

  // Export handlers using utility functions
  const handleExportOrders = () => {
    exportOrdersToCSV(orders);
  };

  const handleExportItems = () => {
    const profilesArray = Array.from(velocityProfiles.values());
    exportVelocityToCSV(profilesArray);
  };

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-8rem)]">
      {/* Header with Title and Export Buttons */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white">Order Journey</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportOrders}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors"
          >
            <Icons.Download className="w-4 h-4" />
            <span>Export Orders CSV</span>
          </button>
          <button
            onClick={handleExportItems}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors"
          >
            <Icons.Download className="w-4 h-4" />
            <span>Export Items CSV</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-800">
        <button
          onClick={() => setActiveTab('tree')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'tree'
              ? 'text-white border-b-2 border-arda-accent'
              : 'text-slate-400 hover:text-slate-300'
          }`}
        >
          Tree
        </button>
        <button
          onClick={() => setActiveTab('timeline')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'timeline'
              ? 'text-white border-b-2 border-arda-accent'
              : 'text-slate-400 hover:text-slate-300'
          }`}
        >
          Timeline
        </button>
      </div>

      {/* Main Content */}
      <div className="flex gap-6 flex-1 min-h-0">
        {/* Main Content Area */}
        <div className="flex-1 min-w-0">
          {activeTab === 'tree' ? (
            <OrderTree
              orders={orders}
              emails={emails}
              onItemClick={handleItemClick}
              className="h-full"
            />
          ) : (
            <OrderTimeline
              orders={orders}
              onOrderClick={(order) => {
                // Could navigate to order details or highlight in tree
                console.log('Order clicked:', order);
              }}
            />
          )}
        </div>

        {/* Item Detail Panel or Reorder Alerts */}
        {selectedItem && selectedProfile ? (
          <div className="w-96 flex-shrink-0 bg-slate-900 border border-slate-800 rounded-lg overflow-hidden flex flex-col">
          {/* Header */}
          <div className="p-4 border-b border-slate-800 flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-semibold text-white truncate">
                {selectedProfile.displayName}
              </h3>
              <p className="text-sm text-slate-400 mt-1">
                {selectedProfile.supplier}
              </p>
              {selectedProfile.sku && (
                <span className="inline-block mt-2 px-2 py-0.5 bg-slate-800 text-slate-300 text-xs rounded">
                  SKU: {selectedProfile.sku}
                </span>
              )}
            </div>
            <button
              onClick={() => setSelectedItem(null)}
              className="p-1 text-slate-500 hover:text-white transition-colors"
              aria-label="Close panel"
            >
              <Icons.X className="w-5 h-5" />
            </button>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-3 p-4 border-b border-slate-800">
            <div className="bg-slate-800/50 rounded-lg p-3">
              <div className="text-2xl font-bold text-orange-400">
                {selectedProfile.dailyBurnRate.toFixed(1)}
              </div>
              <div className="text-xs text-slate-500 mt-1">Units/Day</div>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-3">
              <div className="text-2xl font-bold text-blue-400">
                {Math.round(selectedProfile.averageCadenceDays)}
              </div>
              <div className="text-xs text-slate-500 mt-1">Avg Days Between Orders</div>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-3">
              <div className="text-2xl font-bold text-green-400">
                {selectedProfile.totalQuantityOrdered}
              </div>
              <div className="text-xs text-slate-500 mt-1">Total Ordered</div>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-3">
              <div className="text-2xl font-bold text-purple-400">
                {selectedProfile.orderCount}
              </div>
              <div className="text-xs text-slate-500 mt-1">Orders Placed</div>
            </div>
          </div>

          {/* Recommendations */}
          <div className="p-4 border-b border-slate-800">
            <h4 className="text-sm font-medium text-slate-300 mb-3">Kanban Recommendations</h4>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">Min Qty (Reorder Point)</span>
                <span className="font-medium text-white">{selectedProfile.recommendedMin}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">Order Qty (EOQ)</span>
                <span className="font-medium text-white">{selectedProfile.recommendedOrderQty}</span>
              </div>
              {selectedProfile.nextPredictedOrder && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-400">Next Predicted Order</span>
                  <span className="font-medium text-yellow-400">
                    {new Date(selectedProfile.nextPredictedOrder).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Order History */}
          <div className="flex-1 overflow-y-auto p-4">
            <h4 className="text-sm font-medium text-slate-300 mb-3">Order History</h4>
            <div className="space-y-2">
              {selectedProfile.orders
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                .map((order, idx) => (
                  <div 
                    key={`${order.orderId}-${idx}`}
                    className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg"
                  >
                    <div>
                      <div className="text-sm text-white">
                        {new Date(order.date).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </div>
                      <div className="text-xs text-slate-500">
                        Order #{order.orderId.substring(0, 8)}...
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium text-white">
                        Qty: {order.quantity}
                      </div>
                      {order.unitPrice && (
                        <div className="text-xs text-slate-500">
                          @ ${order.unitPrice.toFixed(2)}/ea
                        </div>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="p-4 border-t border-slate-800 space-y-2">
            {matchingInventoryItem && onReorder && (
              <button
                onClick={() => onReorder(matchingInventoryItem)}
                className="w-full bg-arda-accent hover:bg-arda-accent-hover text-white py-2 px-4 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
              >
                <Icons.Send className="w-4 h-4" />
                Create Reorder Email
              </button>
            )}
            <button
              className="w-full bg-slate-800 hover:bg-slate-700 text-white py-2 px-4 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
            >
              <Icons.Upload className="w-4 h-4" />
              Push to Arda
            </button>
          </div>
        </div>
      ) : (
        <div className="w-96 flex-shrink-0">
          <ReorderAlerts
            velocityProfiles={velocityProfiles}
            onItemClick={(normalizedName) => {
              // Find and select the item when clicked from alerts
              const matchingOrder = orders.find(order =>
                order.items.some(item => item.normalizedName === normalizedName)
              );
              if (matchingOrder) {
                const matchingItem = matchingOrder.items.find(item => item.normalizedName === normalizedName);
                if (matchingItem) {
                  handleItemClick({
                    lineItemId: matchingItem.id || `${matchingOrder.id}-item`,
                    normalizedName: matchingItem.normalizedName || matchingItem.name.toLowerCase().trim(),
                    name: matchingItem.name,
                    quantity: matchingItem.quantity,
                    unit: matchingItem.unit,
                    unitPrice: matchingItem.unitPrice,
                    sku: matchingItem.sku,
                    orderId: matchingOrder.id,
                    emailId: matchingOrder.originalEmailId,
                  });
                }
              }
            }}
          />
        </div>
      )}
      </div>
    </div>
  );
};

export default JourneyView;
