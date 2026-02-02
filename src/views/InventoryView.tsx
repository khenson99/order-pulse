import { useState, useCallback } from 'react';
import { InventoryItem, ItemColor, ReviewStatus } from '../types';
import { Icons } from '../components/Icons';
import { ardaApi, ArdaItemInput } from '../services/api';

interface InventoryViewProps {
  inventory: InventoryItem[];
  onReorder?: (item: InventoryItem) => void;
  onUpdateItem?: (id: string, updates: Partial<InventoryItem>) => void;
  title?: string;
  subtitle?: string;
  showBulkSync?: boolean;
  showHistoryAction?: boolean;
  showReorderAction?: boolean;
  emptyMessage?: string;
  reviewStatusById?: Record<string, ReviewStatus>;
  onReviewStatusChange?: (id: string, status: ReviewStatus) => void;
  showReviewColumn?: boolean;
  onAmazonLookup?: (item: InventoryItem) => void;
  showAmazonLookupAction?: boolean;
  amazonLookupLoadingIds?: Set<string>;
}

// Available colors for the color picker
const ITEM_COLORS: ItemColor[] = ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Gray', 'Pink', 'Purple'];

// Color to Tailwind class mapping
const colorClasses: Record<ItemColor, string> = {
  Red: 'bg-red-500',
  Orange: 'bg-orange-500',
  Yellow: 'bg-yellow-400',
  Green: 'bg-green-500',
  Blue: 'bg-blue-500',
  Gray: 'bg-gray-400',
  Pink: 'bg-pink-400',
  Purple: 'bg-purple-500',
};

// Editable cell component
const EditableCell: React.FC<{
  value: string | number | undefined;
  type?: 'text' | 'number' | 'url';
  onSave: (value: string | number) => void;
  className?: string;
  placeholder?: string;
}> = ({ value, type = 'text', onSave, className = '', placeholder = '—' }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(String(value ?? ''));

  const handleSave = () => {
    setIsEditing(false);
    const newValue = type === 'number' ? parseFloat(editValue) || 0 : editValue;
    if (newValue !== value) {
      onSave(newValue);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') {
      setEditValue(String(value ?? ''));
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <input
        type={type}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        autoFocus
        aria-label="Edit value"
        placeholder={placeholder}
        className={`w-full px-2 py-1 text-sm border border-arda-accent rounded bg-white focus:outline-none focus:ring-2 focus:ring-arda-accent/30 ${className}`}
      />
    );
  }

  return (
    <div
      onClick={() => {
        setEditValue(String(value ?? ''));
        setIsEditing(true);
      }}
      className={`cursor-pointer hover:bg-arda-bg-tertiary px-2 py-1 rounded transition-colors min-h-[28px] ${className}`}
    >
      {value !== undefined && value !== '' ? (
        type === 'url' && value ? (
          <a 
            href={String(value)} 
            target="_blank" 
            rel="noopener noreferrer" 
            className="text-arda-accent hover:underline truncate block max-w-[120px]"
            onClick={(e) => e.stopPropagation()}
          >
            {String(value).replace(/^https?:\/\//, '').substring(0, 20)}...
          </a>
        ) : (
          value
        )
      ) : (
        <span className="text-arda-text-muted italic">{placeholder}</span>
      )}
    </div>
  );
};

// Color picker component
const ColorPicker: React.FC<{
  value?: ItemColor;
  onSelect: (color: ItemColor | undefined) => void;
}> = ({ value, onSelect }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-8 h-8 rounded-lg border border-arda-border hover:border-arda-accent transition-colors flex items-center justify-center"
      >
        {value ? (
          <span className={`w-5 h-5 rounded-full ${colorClasses[value]}`} />
        ) : (
          <span className="w-5 h-5 rounded-full border-2 border-dashed border-arda-border" />
        )}
      </button>
      
      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="absolute top-10 left-0 z-20 bg-white border border-arda-border rounded-lg shadow-lg p-2 grid grid-cols-4 gap-1 min-w-[120px]">
            {ITEM_COLORS.map((color) => (
              <button
                key={color}
                onClick={() => {
                  onSelect(color);
                  setIsOpen(false);
                }}
                className={`w-6 h-6 rounded-full ${colorClasses[color]} hover:ring-2 ring-offset-1 ring-arda-accent transition-all ${
                  value === color ? 'ring-2 ring-arda-accent' : ''
                }`}
                title={color}
              />
            ))}
            <button
              onClick={() => {
                onSelect(undefined);
                setIsOpen(false);
              }}
              className="w-6 h-6 rounded-full border-2 border-dashed border-gray-300 hover:border-arda-accent transition-colors flex items-center justify-center text-gray-400 text-xs"
              title="No color"
            >
              ✕
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export const InventoryView: React.FC<InventoryViewProps> = ({
  inventory,
  onReorder,
  onUpdateItem,
  title = 'Inventory Intelligence',
  subtitle,
  showBulkSync = true,
  showHistoryAction = true,
  showReorderAction = true,
  emptyMessage,
  reviewStatusById,
  onReviewStatusChange,
  showReviewColumn = false,
  onAmazonLookup,
  showAmazonLookupAction = false,
  amazonLookupLoadingIds,
}) => {
  const reviewBadgeClasses: Record<ReviewStatus, string> = {
    pending: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    approved: 'bg-green-50 text-green-700 border-green-200',
    excluded: 'bg-red-50 text-red-700 border-red-200',
  };
  const [historyItem, setHistoryItem] = useState<InventoryItem | null>(null);
  const [syncingItems, setSyncingItems] = useState<Set<string>>(new Set());
  const [syncResults, setSyncResults] = useState<Record<string, 'success' | 'error' | null>>({});
  const [, setSyncErrors] = useState<Record<string, string>>({});
  const [isBulkSyncing, setIsBulkSyncing] = useState(false);
  const [bulkSyncError, setBulkSyncError] = useState<string | null>(null);
  // Local state for items when no external handler
  const [localItems, setLocalItems] = useState<InventoryItem[]>(inventory);

  // Use provided items or local state
  const items = onUpdateItem ? inventory : localItems;

  // Update handler
  const handleUpdate = useCallback((id: string, updates: Partial<InventoryItem>) => {
    if (onUpdateItem) {
      onUpdateItem(id, updates);
    } else {
      setLocalItems(prev => prev.map(item => 
        item.id === id ? { ...item, ...updates } : item
      ));
    }
  }, [onUpdateItem]);

  // Sync single item to Arda
  const handleSyncToArda = async (item: InventoryItem) => {
    setSyncingItems(prev => new Set(prev).add(item.id));
    setSyncResults(prev => ({ ...prev, [item.id]: null }));
    setSyncErrors(prev => ({ ...prev, [item.id]: '' }));

    try {
      const ardaItem: ArdaItemInput = {
        name: item.name,
        orderMechanism: 'email',
        minQty: item.recommendedMin,
        minQtyUnit: 'each',
        primarySupplier: item.supplier,
        orderQty: item.recommendedOrderQty,
        orderQtyUnit: 'each',
        location: item.location,
        primarySupplierLink: item.productUrl,
        imageUrl: item.imageUrl,
      };
      await ardaApi.createItem(ardaItem);
      setSyncResults(prev => ({ ...prev, [item.id]: 'success' }));
      // Mark as no longer draft
      handleUpdate(item.id, { isDraft: false });
    } catch (error) {
      console.error('Failed to sync to Arda:', error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      setSyncResults(prev => ({ ...prev, [item.id]: 'error' }));
      setSyncErrors(prev => ({ ...prev, [item.id]: errorMsg }));
    } finally {
      setSyncingItems(prev => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  // Bulk sync all items to Arda
  const handleBulkSync = async () => {
    setIsBulkSyncing(true);
    setBulkSyncError(null);
    try {
      const ardaItems: ArdaItemInput[] = items.map(item => ({
        name: item.name,
        orderMechanism: 'email',
        minQty: item.recommendedMin,
        minQtyUnit: 'each',
        primarySupplier: item.supplier,
        orderQty: item.recommendedOrderQty,
        orderQtyUnit: 'each',
        location: item.location,
        primarySupplierLink: item.productUrl,
        imageUrl: item.imageUrl,
      }));
      const result = await ardaApi.bulkCreateItems(ardaItems);
      
      // Check for overall success
      if (!result.success && result.error) {
        setBulkSyncError(result.error);
        if (result.details) {
          setBulkSyncError(`${result.error}: ${result.details.message || JSON.stringify(result.details)}`);
        }
      }
      
      result.results?.forEach((r: any, i: number) => {
        if (items[i]) {
          setSyncResults(prev => ({
            ...prev,
            [items[i].id]: r.status === 'fulfilled' ? 'success' : 'error',
          }));
          if (r.error) {
            setSyncErrors(prev => ({ ...prev, [items[i].id]: r.error }));
          }
          if (r.status === 'fulfilled') {
            handleUpdate(items[i].id, { isDraft: false });
          }
        }
      });
    } catch (error) {
      console.error('Bulk sync failed:', error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      setBulkSyncError(errorMsg);
    } finally {
      setIsBulkSyncing(false);
    }
  };

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-arda-text-muted">
        <Icons.Package className="w-16 h-16 mb-4 opacity-20 text-arda-accent" />
        <p>{emptyMessage || 'No inventory data derived yet. Go to Ingestion Engine to process emails.'}</p>
      </div>
    );
  }

  // Sort: drafts first, then by name
  const sortedItems = [...items].sort((a, b) => {
    if (a.isDraft && !b.isDraft) return -1;
    if (!a.isDraft && b.isDraft) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-arda-text-primary">{title}</h2>
          {subtitle && (
            <p className="text-xs text-arda-text-secondary mt-1">{subtitle}</p>
          )}
        </div>
        <div className="flex gap-2">
          {showBulkSync && (
            <button
              onClick={handleBulkSync}
              disabled={isBulkSyncing}
              className="bg-arda-success/10 hover:bg-arda-success text-arda-success hover:text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 border border-arda-success/30 disabled:opacity-50"
            >
              {isBulkSyncing ? (
                <Icons.Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Icons.Upload className="w-3 h-3" />
              )}
              Sync All to Arda
            </button>
          )}
          <span className="bg-arda-bg-tertiary text-arda-text-secondary px-3 py-1 rounded-lg text-sm flex items-center gap-2 border border-arda-border">
            <Icons.Package className="w-4 h-4"/> {items.length} Items
          </span>
        </div>
      </div>

      {/* Error Banner */}
      {bulkSyncError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <Icons.AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="font-semibold text-red-800 text-sm">Sync Failed</h4>
            <p className="text-red-700 text-sm mt-1">{bulkSyncError}</p>
          </div>
          <button
            onClick={() => setBulkSyncError(null)}
            title="Dismiss error"
            aria-label="Dismiss error"
            className="text-red-400 hover:text-red-600 p-1"
          >
            <Icons.X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white border border-arda-border rounded-xl shadow-arda overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-arda-bg-secondary border-b border-arda-border">
              <tr className="text-arda-text-muted font-medium text-xs uppercase tracking-wide">
                <th className="px-3 py-3 text-left w-12">Color</th>
                <th className="px-3 py-3 text-left min-w-[180px]">Item Name</th>
                <th className="px-3 py-3 text-left min-w-[120px]">Supplier</th>
                <th className="px-3 py-3 text-left min-w-[120px]">Location</th>
                <th className="px-3 py-3 text-right w-20">Order Qty</th>
                <th className="px-3 py-3 text-right w-20">Min Qty</th>
                <th className="px-3 py-3 text-left w-32">Image URL</th>
                <th className="px-3 py-3 text-left w-32">Product URL</th>
                {showReviewColumn && (
                  <th className="px-3 py-3 text-left w-40">Review</th>
                )}
                <th className="px-3 py-3 text-center w-12">Status</th>
                <th className="px-3 py-3 text-right w-28">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-arda-border">
              {sortedItems.map((item) => (
                <tr 
                  key={item.id} 
                  className={`hover:bg-arda-bg-tertiary/50 transition-colors ${
                    item.isDraft ? 'bg-yellow-50/50 border-l-2 border-l-yellow-400' : ''
                  }`}
                >
                  {/* Color */}
                  <td className="px-3 py-2">
                    <ColorPicker
                      value={item.color}
                      onSelect={(color) => handleUpdate(item.id, { color })}
                    />
                  </td>

                  {/* Item Name */}
                  <td className="px-1 py-2">
                    <div title={item.originalName || item.name}>
                      <EditableCell
                        value={item.name}
                        onSave={(val) => handleUpdate(item.id, { name: String(val) })}
                        className="font-medium text-arda-text-primary"
                      />
                      {item.originalName && (
                        <span className="ml-1 text-[10px] text-arda-text-muted" title="Name simplified by AI">
                          ✨
                        </span>
                      )}
                      {item.isDraft && (
                        <span className="ml-2 text-[10px] bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded font-medium">
                          DRAFT
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Supplier */}
                  <td className="px-1 py-2">
                    <EditableCell
                      value={item.supplier}
                      onSave={(val) => handleUpdate(item.id, { supplier: String(val) })}
                      className="text-arda-text-secondary"
                    />
                  </td>

                  {/* Location */}
                  <td className="px-1 py-2">
                    <EditableCell
                      value={item.location}
                      onSave={(val) => handleUpdate(item.id, { location: String(val) })}
                      className="text-arda-text-secondary"
                      placeholder="Add location"
                    />
                  </td>

                  {/* Order Qty */}
                  <td className="px-1 py-2 text-right">
                    <EditableCell
                      value={item.recommendedOrderQty}
                      type="number"
                      onSave={(val) => handleUpdate(item.id, { recommendedOrderQty: Number(val) })}
                      className="text-arda-accent font-mono font-bold text-right"
                    />
                  </td>

                  {/* Min Qty */}
                  <td className="px-1 py-2 text-right">
                    <EditableCell
                      value={item.recommendedMin}
                      type="number"
                      onSave={(val) => handleUpdate(item.id, { recommendedMin: Number(val) })}
                      className="font-mono text-right"
                    />
                  </td>

                  {/* Image URL */}
                  <td className="px-1 py-2">
                    <div className="flex items-center gap-2">
                      {item.imageUrl && (
                        <img 
                          src={item.imageUrl} 
                          alt="" 
                          className="w-6 h-6 rounded object-cover border border-arda-border"
                          onError={(e) => (e.currentTarget.style.display = 'none')}
                        />
                      )}
                      <EditableCell
                        value={item.imageUrl}
                        type="url"
                        onSave={(val) => handleUpdate(item.id, { imageUrl: String(val) })}
                        placeholder="Add image"
                      />
                    </div>
                  </td>

                  {/* Product URL */}
                  <td className="px-1 py-2">
                    <EditableCell
                      value={item.productUrl}
                      type="url"
                      onSave={(val) => handleUpdate(item.id, { productUrl: String(val) })}
                      placeholder="Add URL"
                    />
                  </td>

                  {/* Review */}
                  {showReviewColumn && (
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${reviewBadgeClasses[reviewStatusById?.[item.id] || 'pending']}`}>
                          {(reviewStatusById?.[item.id] || 'pending').toUpperCase()}
                        </span>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              if (!onReviewStatusChange) return;
                              const current = reviewStatusById?.[item.id] || 'pending';
                              onReviewStatusChange(item.id, current === 'approved' ? 'pending' : 'approved');
                            }}
                            className="text-xs px-2 py-1 rounded border border-green-200 text-green-700 hover:bg-green-50 transition-colors"
                            title="Approve item"
                            aria-label="Approve item"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!onReviewStatusChange) return;
                              const current = reviewStatusById?.[item.id] || 'pending';
                              onReviewStatusChange(item.id, current === 'excluded' ? 'pending' : 'excluded');
                            }}
                            className="text-xs px-2 py-1 rounded border border-red-200 text-red-700 hover:bg-red-50 transition-colors"
                            title="Exclude item"
                            aria-label="Exclude item"
                          >
                            Exclude
                          </button>
                        </div>
                      </div>
                    </td>
                  )}

                  {/* Status */}
                  <td className="px-3 py-2 text-center">
                    {syncResults[item.id] === 'success' && (
                      <span className="text-arda-success" title="Synced">
                        <Icons.Check className="w-4 h-4 inline" />
                      </span>
                    )}
                    {syncResults[item.id] === 'error' && (
                      <span className="text-arda-danger" title="Sync failed">
                        <Icons.AlertCircle className="w-4 h-4 inline" />
                      </span>
                    )}
                    {syncingItems.has(item.id) && (
                      <Icons.Loader2 className="w-4 h-4 inline animate-spin text-arda-accent" />
                    )}
                  </td>

                  {/* Actions */}
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      {showHistoryAction && (
                        <button
                          onClick={() => setHistoryItem(item)}
                          className="p-1.5 text-arda-text-muted hover:text-arda-accent transition-colors rounded hover:bg-arda-accent/10"
                          title="View history"
                        >
                          <Icons.Clock className="w-4 h-4" />
                        </button>
                      )}
                      {showAmazonLookupAction && onAmazonLookup && (
                        <button
                          onClick={() => onAmazonLookup(item)}
                          disabled={(!item.asin && !item.productUrl) || amazonLookupLoadingIds?.has(item.id)}
                          className="p-1.5 text-arda-text-muted hover:text-arda-accent transition-colors rounded hover:bg-arda-accent/10 disabled:opacity-50"
                          title="Lookup Amazon info"
                          aria-label="Lookup Amazon info"
                        >
                          {amazonLookupLoadingIds?.has(item.id) ? (
                            <Icons.Loader2 className="w-4 h-4 animate-spin text-arda-accent" />
                          ) : (
                            <Icons.Search className="w-4 h-4" />
                          )}
                        </button>
                      )}
                      <button
                        onClick={() => handleSyncToArda(item)}
                        disabled={syncingItems.has(item.id)}
                        className="p-1.5 text-arda-success hover:bg-arda-success/10 transition-colors rounded disabled:opacity-50"
                        title="Sync to Arda"
                      >
                        <Icons.Upload className="w-4 h-4" />
                      </button>
                      {showReorderAction && onReorder && (
                        <button
                          onClick={() => onReorder(item)}
                          className="p-1.5 text-arda-accent hover:bg-arda-accent/10 transition-colors rounded"
                          title="Reorder"
                        >
                          <Icons.Send className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* History Modal */}
      {historyItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white border border-arda-border rounded-xl w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-4 border-b border-arda-border flex justify-between items-center bg-arda-bg-secondary">
              <div>
                <h3 className="text-lg font-bold text-arda-text-primary">{historyItem.name}</h3>
                <p className="text-xs text-arda-text-muted">Purchase History from {historyItem.supplier}</p>
              </div>
              <button 
                onClick={() => setHistoryItem(null)}
                title="Close history"
                aria-label="Close history"
                className="text-arda-text-muted hover:text-arda-text-primary transition-colors p-1"
              >
                <Icons.X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="max-h-[60vh] overflow-y-auto p-4">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-arda-text-muted border-b border-arda-border font-mono text-xs uppercase">
                    <th className="pb-3 font-medium">Order Date</th>
                    <th className="pb-3 font-medium text-right">Quantity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-arda-border font-mono">
                  {historyItem.history.slice().reverse().map((record, idx) => (
                    <tr key={idx} className="group hover:bg-arda-bg-tertiary transition-colors">
                      <td className="py-3 text-arda-text-secondary">
                        {new Date(record.date).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric'
                        })}
                      </td>
                      <td className="py-3 text-right text-arda-text-primary font-medium">
                        {record.quantity} units
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="p-4 bg-arda-bg-secondary border-t border-arda-border flex justify-between items-center">
              <div className="text-xs text-arda-text-muted">
                Total Orders: <span className="text-arda-text-primary font-bold">{historyItem.orderCount}</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleSyncToArda(historyItem)}
                  disabled={syncingItems.has(historyItem.id)}
                  className="bg-arda-success/10 hover:bg-arda-success text-arda-success hover:text-white px-3 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 border border-arda-success/20 disabled:opacity-50"
                >
                  <Icons.Upload className="w-3 h-3" />
                  Sync to Arda
                </button>
                {onReorder && (
                  <button
                    onClick={() => {
                      onReorder(historyItem);
                      setHistoryItem(null);
                    }}
                    className="bg-arda-accent text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-arda-accent-hover transition-all flex items-center gap-2"
                  >
                    <Icons.Send className="w-3 h-3" />
                    Reorder Item
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
