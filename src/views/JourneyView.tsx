import React, { useState, useMemo } from 'react';
import { ExtractedOrder, InventoryItem, RawEmail, LineItemNodeData, ItemVelocityProfile } from '../types';
import { Icons } from '../components/Icons';
import { buildVelocityProfiles, buildJourneyTree } from '../utils/inventoryLogic';
import { exportVelocityToCSV, exportOrdersToCSV } from '../utils/exportUtils';
import { VelocityBadge } from '../components/VelocityBadge';

interface JourneyViewProps {
  orders: ExtractedOrder[];
  inventory: InventoryItem[];
  emails?: RawEmail[];
  onReorder?: (item: InventoryItem) => void;
}

type ViewMode = 'timeline' | 'suppliers' | 'items';

const isCodeLikeName = (name: string): boolean => {
  const trimmed = name.trim();
  return /^[A-Z0-9-]{8,}$/.test(trimmed) || /^amazon product/i.test(trimmed);
};

const parsePriceValue = (price?: string): number | undefined => {
  if (!price) return undefined;
  const parsed = parseFloat(price.replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
};

const getHumanItemName = (item: { name: string; amazonEnriched?: { itemName?: string }; asin?: string }): string => {
  const enrichedName = item.amazonEnriched?.itemName?.trim();
  if (enrichedName) return enrichedName;
  const raw = item.name?.trim() || '';
  if (!raw) return item.asin ? 'Amazon product' : 'Item';
  if (isCodeLikeName(raw)) return item.asin ? 'Amazon product' : 'Item';
  return raw;
};

export const JourneyView: React.FC<JourneyViewProps> = ({
  orders,
  inventory,
  emails,
  onReorder,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('timeline');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedSuppliers, setExpandedSuppliers] = useState<Set<string>>(new Set());
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const [selectedItem, setSelectedItem] = useState<LineItemNodeData | null>(null);

  // Build velocity profiles
  const velocityProfiles = useMemo(() => buildVelocityProfiles(orders), [orders]);
  // Journey tree built for future use
  const _journeyTree = useMemo(() => buildJourneyTree(orders, emails), [orders, emails]);

  // Get selected item's profile
  const selectedProfile = selectedItem 
    ? velocityProfiles.get(selectedItem.normalizedName) 
    : undefined;

  // Find matching inventory item for reorder
  const matchingInventoryItem = selectedItem 
    ? inventory.find(i => i.name.toLowerCase().trim() === selectedItem.normalizedName)
    : undefined;

  // Selected item details (prefer Amazon enrichment)
  const selectedAmazon = selectedItem?.amazonEnriched;
  const selectedDisplayName = selectedItem ? getHumanItemName(selectedItem) : '';
  const selectedUnitPrice = selectedItem?.unitPrice ?? selectedAmazon?.unitPrice ?? parsePriceValue(selectedAmazon?.price);
  const selectedTotalPrice = selectedUnitPrice
    ? selectedUnitPrice * (selectedItem?.quantity || 1)
    : selectedItem?.totalPrice;
  const selectedImage = selectedAmazon?.imageUrl || selectedProfile?.imageUrl;
  const selectedAmazonUrl = selectedAmazon?.amazonUrl || selectedProfile?.amazonUrl;

  // Stats
  const stats = useMemo(() => {
    const suppliers = new Set<string>();
    let totalItems = 0;
    orders.forEach(o => {
      suppliers.add(o.supplier);
      totalItems += o.items.length;
    });
    return {
      orders: orders.length,
      suppliers: suppliers.size,
      items: totalItems,
      uniqueItems: velocityProfiles.size,
    };
  }, [orders, velocityProfiles]);

  // Group orders by supplier
  const ordersBySupplier = useMemo(() => {
    const map = new Map<string, ExtractedOrder[]>();
    orders.forEach(order => {
      const list = map.get(order.supplier) || [];
      list.push(order);
      map.set(order.supplier, list);
    });
    // Sort suppliers by order count
    return Array.from(map.entries())
      .sort((a, b) => b[1].length - a[1].length);
  }, [orders]);

  // Filter based on search
  const filteredOrders = useMemo(() => {
    if (!searchQuery.trim()) return orders;
    const q = searchQuery.toLowerCase();
    return orders.filter(o => 
      o.supplier.toLowerCase().includes(q) ||
      o.items.some(i => i.name.toLowerCase().includes(q))
    );
  }, [orders, searchQuery]);

  const filteredProfiles = useMemo(() => {
    if (!searchQuery.trim()) return Array.from(velocityProfiles.values());
    const q = searchQuery.toLowerCase();
    return Array.from(velocityProfiles.values()).filter(p =>
      p.displayName.toLowerCase().includes(q) ||
      p.supplier.toLowerCase().includes(q) ||
      p.sku?.toLowerCase().includes(q)
    );
  }, [velocityProfiles, searchQuery]);

  const toggleSupplier = (supplier: string) => {
    setExpandedSuppliers(prev => {
      const next = new Set(prev);
      if (next.has(supplier)) {
        next.delete(supplier);
      } else {
        next.add(supplier);
      }
      return next;
    });
  };

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

  const handleItemClick = (item: LineItemNodeData) => {
    setSelectedItem(item);
  };

  const handleExportOrders = () => exportOrdersToCSV(orders);
  const handleExportItems = () => exportVelocityToCSV(Array.from(velocityProfiles.values()));

  // Empty state
  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-12rem)] text-center">
        <div className="w-16 h-16 rounded-2xl bg-arda-bg-tertiary flex items-center justify-center mb-4">
          <Icons.GitBranch className="w-8 h-8 text-arda-text-muted" />
        </div>
        <h2 className="text-xl font-semibold text-arda-text-primary mb-2">No Orders Yet</h2>
        <p className="text-arda-text-muted max-w-md">
          Run the ingestion engine to process your emails and see your complete order journey here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-6rem)] gap-6">
      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-arda-text-primary">Order Journey</h1>
            <p className="text-arda-text-secondary text-sm mt-1">
              Trace the flow from suppliers to orders to items
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportOrders}
              className="flex items-center gap-2 px-3 py-2 text-sm bg-white hover:bg-arda-bg-tertiary text-arda-text-secondary border border-arda-border rounded-lg transition-colors"
            >
              <Icons.Download className="w-4 h-4" />
              Orders
            </button>
            <button
              onClick={handleExportItems}
              className="flex items-center gap-2 px-3 py-2 text-sm bg-white hover:bg-arda-bg-tertiary text-arda-text-secondary border border-arda-border rounded-lg transition-colors"
            >
              <Icons.Download className="w-4 h-4" />
              Items
            </button>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl p-4 border border-arda-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-arda-bg-tertiary flex items-center justify-center">
                <Icons.Building2 className="w-5 h-5 text-arda-accent" />
              </div>
              <div>
                <div className="text-2xl font-bold text-arda-text-primary">{stats.suppliers}</div>
                <div className="text-xs text-arda-text-muted">Suppliers</div>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-arda-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-arda-bg-tertiary flex items-center justify-center">
                <Icons.Package className="w-5 h-5 text-arda-accent" />
              </div>
              <div>
                <div className="text-2xl font-bold text-arda-text-primary">{stats.orders}</div>
                <div className="text-xs text-arda-text-muted">Orders</div>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-arda-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-arda-bg-tertiary flex items-center justify-center">
                <Icons.Box className="w-5 h-5 text-arda-accent" />
              </div>
              <div>
                <div className="text-2xl font-bold text-arda-text-primary">{stats.items}</div>
                <div className="text-xs text-arda-text-muted">Line Items</div>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-arda-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-arda-bg-tertiary flex items-center justify-center">
                <Icons.Activity className="w-5 h-5 text-arda-accent" />
              </div>
              <div>
                <div className="text-2xl font-bold text-arda-text-primary">{stats.uniqueItems}</div>
                <div className="text-xs text-arda-text-muted">Unique Items</div>
              </div>
            </div>
          </div>
        </div>

        {/* View Controls */}
        <div className="flex items-center gap-4 mb-4">
          {/* View Mode Toggle */}
          <div className="flex bg-arda-bg-tertiary rounded-lg p-1 border border-arda-border">
            <button
              onClick={() => setViewMode('timeline')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'timeline'
                  ? 'bg-arda-accent text-white'
                  : 'text-arda-text-secondary hover:text-arda-text-primary'
              }`}
            >
              By Date
            </button>
            <button
              onClick={() => setViewMode('suppliers')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'suppliers'
                  ? 'bg-arda-accent text-white'
                  : 'text-arda-text-secondary hover:text-arda-text-primary'
              }`}
            >
              By Supplier
            </button>
            <button
              onClick={() => setViewMode('items')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'items'
                  ? 'bg-arda-accent text-white'
                  : 'text-arda-text-secondary hover:text-arda-text-primary'
              }`}
            >
              By Item
            </button>
          </div>

          {/* Search */}
          <div className="flex-1 relative">
            <Icons.Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-arda-text-muted" />
            <input
              type="text"
              placeholder="Search orders, suppliers, items..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white border border-arda-border rounded-lg pl-10 pr-10 py-2 text-sm text-arda-text-primary placeholder-arda-text-muted focus:outline-none focus:ring-2 focus:ring-arda-accent focus:border-transparent"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-arda-text-muted hover:text-arda-text-primary"
              >
                <Icons.X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto bg-white rounded-xl border border-arda-border p-4">
          {viewMode === 'timeline' && (
            <TimelineView 
              orders={filteredOrders}
              expandedOrders={expandedOrders}
              toggleOrder={toggleOrder}
              onItemClick={handleItemClick}
              velocityProfiles={velocityProfiles}
            />
          )}
          {viewMode === 'suppliers' && (
            <SupplierView
              ordersBySupplier={ordersBySupplier}
              expandedSuppliers={expandedSuppliers}
              expandedOrders={expandedOrders}
              toggleSupplier={toggleSupplier}
              toggleOrder={toggleOrder}
              onItemClick={handleItemClick}
              velocityProfiles={velocityProfiles}
              searchQuery={searchQuery}
            />
          )}
          {viewMode === 'items' && (
            <ItemsView
              profiles={filteredProfiles}
              onItemClick={handleItemClick}
              selectedItem={selectedItem}
            />
          )}
        </div>
      </div>

      {/* Detail Panel */}
      {selectedItem && selectedProfile && (
        <div className="w-96 flex-shrink-0 bg-white border border-arda-border rounded-xl overflow-hidden flex flex-col">
          {/* Header with Amazon Image */}
          <div className="p-5 border-b border-arda-border">
            <div className="flex items-start gap-4">
              {/* Product Image from Amazon or placeholder */}
              {selectedImage ? (
                <img 
                  src={selectedImage}
                  alt=""
                  className="w-20 h-20 rounded-lg object-contain bg-white flex-shrink-0"
                />
              ) : (
                <div className="w-16 h-16 rounded-lg bg-arda-bg-tertiary flex items-center justify-center flex-shrink-0">
                  <Icons.Package className="w-8 h-8 text-arda-accent" />
                </div>
              )}
              
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between">
                  <h3 className="text-lg font-semibold text-arda-text-primary leading-tight">
                    {selectedDisplayName}
                  </h3>
                  <button
                    onClick={() => setSelectedItem(null)}
                    aria-label="Close item details"
                    className="p-1 text-arda-text-muted hover:text-arda-text-primary hover:bg-arda-bg-tertiary rounded-lg transition-colors"
                  >
                    <Icons.X className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-sm text-arda-text-secondary mt-1">{selectedItem.supplier || selectedProfile.supplier}</p>
                <div className="flex flex-wrap gap-1 mt-2">
                  {(selectedItem.sku || selectedProfile.sku) && (
                    <span className="px-2 py-0.5 bg-arda-bg-tertiary text-arda-text-secondary text-xs rounded font-mono">
                      SKU: {selectedItem.sku || selectedProfile.sku}
                    </span>
                  )}
                  {(selectedItem.asin || selectedProfile.asin) && (
                    <span className="px-2 py-0.5 bg-orange-100 text-orange-700 text-xs rounded font-mono">
                      ASIN: {selectedItem.asin || selectedProfile.asin}
                    </span>
                  )}
                </div>
                {selectedAmazonUrl && (
                  <a 
                    href={selectedAmazonUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-2 text-xs text-arda-accent hover:underline"
                  >
                    View on Amazon <Icons.ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* Item Details */}
          <div className="p-5 border-b border-arda-border space-y-3">
            <h4 className="text-sm font-medium text-arda-text-primary">Item Details</h4>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-arda-text-secondary">Order Date</span>
                <span className="text-arda-text-primary">{selectedItem.orderDate || selectedProfile.lastOrderDate}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-arda-text-secondary">Quantity</span>
                <span className="text-arda-text-primary">{selectedItem.quantity} {selectedItem.unit}</span>
              </div>
              {selectedUnitPrice !== undefined && (
                <div className="flex items-center justify-between">
                  <span className="text-arda-text-secondary">Unit Price</span>
                  <span className="text-arda-accent font-semibold">${selectedUnitPrice.toFixed(2)}</span>
                </div>
              )}
              {selectedTotalPrice !== undefined && (
                <div className="flex items-center justify-between">
                  <span className="text-arda-text-secondary">Total</span>
                  <span className="text-arda-accent font-semibold">${selectedTotalPrice.toFixed(2)}</span>
                </div>
              )}
              {selectedAmazon?.price && (
                <div className="flex items-center justify-between">
                  <span className="text-arda-text-secondary">Amazon Price</span>
                  <span className="text-arda-text-primary">{selectedAmazon.price}</span>
                </div>
              )}
              {selectedAmazon?.unitCount !== undefined && (
                <div className="flex items-center justify-between">
                  <span className="text-arda-text-secondary">Unit Count</span>
                  <span className="text-arda-text-primary">{selectedAmazon.unitCount}</span>
                </div>
              )}
              {selectedAmazon?.upc && (
                <div className="flex items-center justify-between">
                  <span className="text-arda-text-secondary">UPC</span>
                  <span className="text-arda-text-primary font-mono">{selectedAmazon.upc}</span>
                </div>
              )}
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-3 p-5 border-b border-arda-border">
            <StatCard 
              value={selectedProfile.dailyBurnRate.toFixed(1)} 
              label="Units/Day" 
              color="orange" 
            />
            <StatCard 
              value={Math.round(selectedProfile.averageCadenceDays).toString()} 
              label="Days Between Orders" 
              color="blue" 
            />
            <StatCard 
              value={selectedProfile.totalQuantityOrdered.toString()} 
              label="Total Ordered" 
              color="green" 
            />
            <StatCard 
              value={selectedProfile.orderCount.toString()} 
              label="Orders Placed" 
              color="purple" 
            />
          </div>

          {/* Recommendations */}
          <div className="p-5 border-b border-arda-border">
            <h4 className="text-sm font-medium text-arda-text-primary mb-3">Kanban Settings</h4>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-arda-text-secondary">Min Qty (Reorder Point)</span>
                <span className="text-sm font-semibold text-arda-text-primary bg-arda-bg-tertiary px-2 py-1 rounded">
                  {selectedProfile.recommendedMin}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-arda-text-secondary">Order Qty</span>
                <span className="text-sm font-semibold text-arda-text-primary bg-arda-bg-tertiary px-2 py-1 rounded">
                  {selectedProfile.recommendedOrderQty}
                </span>
              </div>
              {selectedProfile.nextPredictedOrder && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-arda-text-secondary">Next Predicted Order</span>
                  <span className="text-sm font-semibold text-arda-accent">
                    {new Date(selectedProfile.nextPredictedOrder).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Order History */}
          <div className="flex-1 overflow-y-auto p-5">
          <h4 className="text-sm font-medium text-arda-text-primary mb-3">Order History</h4>
            <div className="space-y-2">
              {selectedProfile.orders
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                .map((order, idx) => (
                  <div 
                    key={`${order.orderId}-${idx}`}
                  className="flex items-center justify-between p-3 bg-arda-bg-tertiary rounded-lg hover:bg-arda-bg-secondary transition-colors"
                  >
                    <div>
                    <div className="text-sm text-arda-text-primary font-medium">
                        {new Date(order.date).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </div>
                    </div>
                    <div className="text-right">
                    <div className="text-sm font-semibold text-arda-text-primary">
                        ×{order.quantity}
                      </div>
                      {order.unitPrice && (
                      <div className="text-xs text-arda-text-muted">
                          ${order.unitPrice.toFixed(2)} ea
                        </div>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </div>

          {/* Actions */}
        <div className="p-5 border-t border-arda-border space-y-2">
            {matchingInventoryItem && onReorder && (
              <button
                onClick={() => onReorder(matchingInventoryItem)}
                className="w-full bg-arda-accent hover:bg-arda-accent-hover text-white py-2.5 px-4 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
              >
                <Icons.Send className="w-4 h-4" />
                Create Reorder Email
              </button>
            )}
            <button
            className="w-full bg-white hover:bg-arda-bg-tertiary text-arda-text-primary py-2.5 px-4 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 border border-arda-border"
            >
              <Icons.Upload className="w-4 h-4" />
              Push to Arda
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// Stat Card Component
const StatCard: React.FC<{ value: string; label: string; color: string }> = ({ value, label, color }) => {
  const colorClasses: Record<string, string> = {
    orange: 'text-arda-accent',
    blue: 'text-arda-accent',
    green: 'text-arda-accent',
    purple: 'text-arda-accent',
  };
  
  return (
    <div className="bg-arda-bg-tertiary rounded-lg p-3 border border-arda-border">
      <div className={`text-2xl font-bold ${colorClasses[color]}`}>{value}</div>
      <div className="text-xs text-arda-text-muted mt-1">{label}</div>
    </div>
  );
};

// Timeline View Component
const TimelineView: React.FC<{
  orders: ExtractedOrder[];
  expandedOrders: Set<string>;
  toggleOrder: (id: string) => void;
  onItemClick: (item: LineItemNodeData) => void;
  velocityProfiles: Map<string, ItemVelocityProfile>;
}> = ({ orders, expandedOrders, toggleOrder, onItemClick, velocityProfiles }) => {
  // Sort by date descending
  const sortedOrders = useMemo(() => 
    [...orders].sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime()),
    [orders]
  );

  return (
    <div className="space-y-3">
      {sortedOrders.map((order) => (
        <OrderCard
          key={order.id}
          order={order}
          isExpanded={expandedOrders.has(order.id)}
          onToggle={() => toggleOrder(order.id)}
          onItemClick={onItemClick}
          velocityProfiles={velocityProfiles}
        />
      ))}
    </div>
  );
};

// Supplier View Component
const SupplierView: React.FC<{
  ordersBySupplier: [string, ExtractedOrder[]][];
  expandedSuppliers: Set<string>;
  expandedOrders: Set<string>;
  toggleSupplier: (supplier: string) => void;
  toggleOrder: (id: string) => void;
  onItemClick: (item: LineItemNodeData) => void;
  velocityProfiles: Map<string, ItemVelocityProfile>;
  searchQuery: string;
}> = ({ ordersBySupplier, expandedSuppliers, expandedOrders, toggleSupplier, toggleOrder, onItemClick, velocityProfiles, searchQuery }) => {
  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return ordersBySupplier;
    const q = searchQuery.toLowerCase();
    return ordersBySupplier.filter(([supplier, orders]) =>
      supplier.toLowerCase().includes(q) ||
      orders.some(o => o.items.some(i => i.name.toLowerCase().includes(q)))
    );
  }, [ordersBySupplier, searchQuery]);

  return (
    <div className="space-y-4">
      {filtered.map(([supplier, supplierOrders]) => (
        <div key={supplier} className="bg-white rounded-lg overflow-hidden border border-arda-border">
          {/* Supplier Header */}
          <button
            onClick={() => toggleSupplier(supplier)}
            className="w-full flex items-center gap-3 p-4 hover:bg-arda-bg-tertiary transition-colors"
          >
            <div className="w-10 h-10 rounded-lg bg-arda-bg-tertiary flex items-center justify-center flex-shrink-0">
              <Icons.Building2 className="w-5 h-5 text-arda-accent" />
            </div>
            <div className="flex-1 text-left">
              <div className="text-arda-text-primary font-medium">{supplier}</div>
              <div className="text-sm text-arda-text-secondary">{supplierOrders.length} orders</div>
            </div>
            <Icons.ChevronRight 
              className={`w-5 h-5 text-arda-text-muted transition-transform ${
                expandedSuppliers.has(supplier) ? 'rotate-90' : ''
              }`}
            />
          </button>

          {/* Supplier Orders */}
          {expandedSuppliers.has(supplier) && (
            <div className="px-4 pb-4 space-y-2">
              {supplierOrders
                .sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime())
                .map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    isExpanded={expandedOrders.has(order.id)}
                    onToggle={() => toggleOrder(order.id)}
                    onItemClick={onItemClick}
                    velocityProfiles={velocityProfiles}
                    compact
                  />
                ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

// Items View Component
const ItemsView: React.FC<{
  profiles: ItemVelocityProfile[];
  onItemClick: (item: LineItemNodeData) => void;
  selectedItem: LineItemNodeData | null;
}> = ({ profiles, onItemClick, selectedItem }) => {
  // Sort by daily burn rate
  const sorted = useMemo(() => 
    [...profiles].sort((a, b) => b.dailyBurnRate - a.dailyBurnRate),
    [profiles]
  );

  return (
    <div className="grid gap-3">
      {sorted.map((profile) => {
        const isSelected = selectedItem?.normalizedName === profile.normalizedName;
        
        return (
          <button
            key={profile.normalizedName}
            onClick={() => onItemClick({
              lineItemId: profile.normalizedName,
              orderId: '',
              emailId: '',
              name: profile.displayName,
              normalizedName: profile.normalizedName,
              quantity: profile.totalQuantityOrdered,
              unit: 'total',
              sku: profile.sku,
              asin: profile.asin,
              supplier: profile.supplier,
              amazonEnriched: profile.asin ? {
                asin: profile.asin,
                itemName: profile.displayName,
                imageUrl: profile.imageUrl,
                amazonUrl: profile.amazonUrl,
              } : undefined,
            })}
            className={`w-full text-left p-4 rounded-lg transition-all ${
              isSelected 
                ? 'bg-arda-accent/20 border-2 border-arda-accent' 
                : 'bg-white border border-arda-border hover:bg-arda-bg-tertiary'
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-arda-text-primary font-medium truncate">{profile.displayName}</span>
                  {profile.sku && (
                    <span className="text-xs text-arda-text-muted font-mono bg-arda-bg-tertiary px-1.5 py-0.5 rounded">
                      {profile.sku}
                    </span>
                  )}
                </div>
                <div className="text-sm text-arda-text-secondary mt-1">{profile.supplier}</div>
              </div>
              <VelocityBadge
                dailyBurnRate={profile.dailyBurnRate}
                averageCadenceDays={profile.averageCadenceDays}
                orderCount={profile.orderCount}
                compact
              />
            </div>
            
            {/* Order dates as small pills */}
            <div className="flex flex-wrap gap-1.5 mt-3">
              {profile.orders
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                .slice(0, 5)
                .map((order, idx) => (
                  <span
                    key={idx}
                    className="text-xs bg-arda-bg-tertiary text-arda-text-secondary px-2 py-0.5 rounded"
                  >
                    {new Date(order.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    <span className="text-arda-text-muted ml-1">×{order.quantity}</span>
                  </span>
                ))}
              {profile.orders.length > 5 && (
                <span className="text-xs text-arda-text-muted">
                  +{profile.orders.length - 5} more
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
};

// Order Card Component
const OrderCard: React.FC<{
  order: ExtractedOrder;
  isExpanded: boolean;
  onToggle: () => void;
  onItemClick: (item: LineItemNodeData) => void;
  velocityProfiles: Map<string, ItemVelocityProfile>;
  compact?: boolean;
}> = ({ order, isExpanded, onToggle, onItemClick, velocityProfiles, compact = false }) => {
  return (
    <div className={`bg-white rounded-lg overflow-hidden border border-arda-border ${
      compact ? '' : ''
    }`}>
      {/* Order Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-4 hover:bg-arda-bg-tertiary transition-colors"
      >
        <div className={`rounded-lg flex items-center justify-center flex-shrink-0 ${
          compact ? 'w-8 h-8 bg-arda-bg-tertiary' : 'w-10 h-10 bg-arda-bg-tertiary'
        }`}>
          <Icons.Package className={`text-arda-accent ${compact ? 'w-4 h-4' : 'w-5 h-5'}`} />
        </div>
        
        <div className="flex-1 text-left min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-arda-text-primary font-medium">
              {compact ? '' : `${order.supplier} - `}
              {new Date(order.orderDate).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
            {order.confidence && order.confidence < 0.8 && (
              <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">
                Low confidence
              </span>
            )}
          </div>
          <div className="text-sm text-arda-text-secondary">
            {order.items.length} item{order.items.length !== 1 ? 's' : ''}
            {order.totalAmount && ` • $${order.totalAmount.toFixed(2)}`}
          </div>
        </div>

        <Icons.ChevronRight 
          className={`w-5 h-5 text-arda-text-muted transition-transform ${isExpanded ? 'rotate-90' : ''}`}
        />
      </button>

      {/* Order Items */}
      {isExpanded && (
        <div className="border-t border-arda-border p-3 space-y-2">
          {order.items.map((item, idx) => {
            const normalizedName = item.normalizedName || item.name.toLowerCase().trim();
            const profile = velocityProfiles.get(normalizedName);
            const displayName = getHumanItemName(item);
            const unitPrice = item.unitPrice ?? item.amazonEnriched?.unitPrice ?? parsePriceValue(item.amazonEnriched?.price);
            const totalPrice = unitPrice ? unitPrice * item.quantity : undefined;
            
            const itemData: LineItemNodeData = {
              lineItemId: item.id || `${order.id}-${idx}`,
              orderId: order.id,
              emailId: order.originalEmailId,
              name: displayName,
              normalizedName,
              quantity: item.quantity,
              unit: item.unit,
              unitPrice: unitPrice,
              sku: item.sku || item.asin,
              asin: item.asin,
              supplier: order.supplier,
              orderDate: order.orderDate,
              totalPrice,
              amazonEnriched: item.amazonEnriched,
            };

            return (
              <div
                key={idx}
                className="w-full rounded-lg bg-arda-bg-tertiary border border-arda-border"
              >
                <button
                  onClick={() => onItemClick(itemData)}
                  className="w-full flex items-center gap-3 p-3 hover:bg-arda-bg-secondary transition-colors text-left rounded-lg"
                >
                {/* Amazon product image or fallback icon */}
                {item.amazonEnriched?.imageUrl ? (
                  <img 
                    src={item.amazonEnriched.imageUrl} 
                    alt=""
                    className="w-12 h-12 rounded-lg object-contain bg-white flex-shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-lg bg-arda-bg-tertiary flex items-center justify-center flex-shrink-0">
                    <Icons.Box className="w-5 h-5 text-arda-accent" />
                  </div>
                )}
                
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-arda-text-primary truncate">
                    {displayName}
                  </div>
                  <div className="flex items-center flex-wrap gap-2 text-xs text-arda-text-muted">
                    <span>{item.quantity} {item.unit}</span>
                    {unitPrice && <span className="text-arda-accent font-medium">@ ${unitPrice.toFixed(2)}</span>}
                    {totalPrice && <span className="text-arda-accent">Total: ${totalPrice.toFixed(2)}</span>}
                    {item.asin && <span className="text-arda-accent">ASIN: {item.asin}</span>}
                  </div>
                </div>

                {profile && profile.orderCount > 1 && (
                  <VelocityBadge
                    dailyBurnRate={profile.dailyBurnRate}
                    averageCadenceDays={profile.averageCadenceDays}
                    orderCount={profile.orderCount}
                    compact
                  />
                )}
                </button>
                {item.amazonEnriched?.amazonUrl && (
                  <div className="px-3 pb-3 pl-16">
                    <a 
                      href={item.amazonEnriched.amazonUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-arda-accent hover:underline"
                    >
                      View on Amazon →
                    </a>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default JourneyView;
