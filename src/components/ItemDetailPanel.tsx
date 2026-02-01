import React, { useEffect, useState } from 'react';
import { ItemVelocityProfile, InventoryItem } from '../types';
import { Icons } from './Icons';

interface ItemDetailPanelProps {
  itemProfile: ItemVelocityProfile;
  inventoryItem?: InventoryItem;
  onClose: () => void;
  onReorder?: (item: InventoryItem) => void;
  onPushToArda?: (profile: ItemVelocityProfile) => void;
}

export const ItemDetailPanel: React.FC<ItemDetailPanelProps> = ({
  itemProfile,
  inventoryItem,
  onClose,
  onReorder,
  onPushToArda,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    // Trigger slide-in animation on mount
    const timer = setTimeout(() => setIsOpen(true), 10);
    return () => clearTimeout(timer);
  }, []);

  const handleClose = () => {
    setIsOpen(false);
    // Wait for animation to complete before calling onClose
    setTimeout(() => onClose(), 300);
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={handleClose}
      />

      {/* Slide-out Panel */}
      <div
        className={`fixed right-0 top-0 h-full w-96 bg-white border-l border-arda-border z-50 flex flex-col shadow-2xl transform transition-transform duration-300 ease-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="p-4 border-b border-arda-border flex items-start justify-between flex-shrink-0">
          <div className="flex-1 min-w-0 pr-2">
            <h3 className="text-lg font-semibold text-arda-text-primary truncate">
              {itemProfile.displayName}
            </h3>
            <p className="text-sm text-arda-text-muted mt-1">
              {itemProfile.supplier}
            </p>
            {itemProfile.sku && (
              <span className="inline-block mt-2 px-2 py-0.5 bg-arda-bg-tertiary text-arda-text-secondary text-xs rounded">
                SKU: {itemProfile.sku}
              </span>
            )}
          </div>
          <button
            onClick={handleClose}
            className="p-1 text-arda-text-muted hover:text-arda-text-primary transition-colors flex-shrink-0"
            aria-label="Close panel"
          >
            <Icons.X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Velocity Stats Grid */}
          <div className="grid grid-cols-2 gap-3 p-4 border-b border-arda-border">
            <div className="bg-arda-bg-secondary rounded-lg p-3">
              <div className="text-2xl font-bold text-orange-400">
                {itemProfile.dailyBurnRate.toFixed(1)}
              </div>
              <div className="text-xs text-arda-text-muted mt-1">Daily Burn Rate</div>
            </div>
            <div className="bg-arda-bg-secondary rounded-lg p-3">
              <div className="text-2xl font-bold text-blue-400">
                {Math.round(itemProfile.averageCadenceDays)}
              </div>
              <div className="text-xs text-arda-text-muted mt-1">Cadence (Days)</div>
            </div>
            <div className="bg-arda-bg-secondary rounded-lg p-3">
              <div className="text-2xl font-bold text-green-400">
                {itemProfile.totalQuantityOrdered}
              </div>
              <div className="text-xs text-arda-text-muted mt-1">Total Ordered</div>
            </div>
            <div className="bg-arda-bg-secondary rounded-lg p-3">
              <div className="text-2xl font-bold text-purple-400">
                {itemProfile.orderCount}
              </div>
              <div className="text-xs text-arda-text-muted mt-1">Order Count</div>
            </div>
          </div>

          {/* Kanban Recommendations */}
          <div className="p-4 border-b border-arda-border">
            <h4 className="text-sm font-medium text-arda-text-secondary mb-3 flex items-center gap-2">
              <Icons.Box className="w-4 h-4" />
              Kanban Recommendations
            </h4>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-arda-text-muted">Min Qty (Reorder Point)</span>
                <span className="font-medium text-arda-text-primary">{itemProfile.recommendedMin}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-arda-text-muted">Order Qty (EOQ)</span>
                <span className="font-medium text-arda-text-primary">{itemProfile.recommendedOrderQty}</span>
              </div>
              {itemProfile.nextPredictedOrder && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-arda-text-muted">Next Predicted Order</span>
                  <span className="font-medium text-yellow-600">
                    {new Date(itemProfile.nextPredictedOrder).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Order History */}
          <div className="p-4">
            <h4 className="text-sm font-medium text-arda-text-secondary mb-3 flex items-center gap-2">
              <Icons.FileText className="w-4 h-4" />
              Order History
            </h4>
            <div className="space-y-2">
              {itemProfile.orders.length === 0 ? (
                <div className="text-center py-8 text-arda-text-muted text-sm">
                  <Icons.Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No order history available</p>
                </div>
              ) : (
                itemProfile.orders
                  .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                  .map((order, idx) => (
                    <div
                      key={`${order.orderId}-${idx}`}
                      className="flex items-center justify-between p-3 bg-arda-bg-secondary rounded-lg hover:bg-arda-bg-tertiary transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-arda-text-primary font-medium">
                          {new Date(order.date).toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </div>
                        <div className="text-xs text-arda-text-muted mt-1">
                          Order #{order.orderId.substring(0, 8)}...
                        </div>
                      </div>
                      <div className="text-right ml-4">
                        <div className="text-sm font-medium text-arda-text-primary">
                          Qty: {order.quantity}
                        </div>
                        {order.unitPrice !== undefined && (
                          <div className="text-xs text-arda-text-muted mt-1">
                            @ ${order.unitPrice.toFixed(2)}/ea
                          </div>
                        )}
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="p-4 border-t border-arda-border space-y-2 flex-shrink-0">
          {inventoryItem && onReorder && (
            <button
              onClick={() => onReorder(inventoryItem)}
              className="w-full bg-arda-accent hover:bg-arda-accent-hover text-white py-2.5 px-4 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
            >
              <Icons.Send className="w-4 h-4" />
              Create Reorder Email
            </button>
          )}
          {onPushToArda && (
            <button
              onClick={() => onPushToArda(itemProfile)}
              className="w-full bg-arda-bg-tertiary hover:bg-arda-border text-arda-text-primary py-2.5 px-4 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
            >
              <Icons.Upload className="w-4 h-4" />
              Push to Arda
            </button>
          )}
        </div>
      </div>
    </>
  );
};

export default ItemDetailPanel;
