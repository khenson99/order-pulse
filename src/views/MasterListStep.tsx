import { useState, useMemo, useCallback } from 'react';
import { Icons } from '../components/Icons';
import { ScannedBarcode, CapturedPhoto } from './OnboardingFlow';
import { CSVItem } from './CSVUploadStep';

// Simple email item from onboarding
interface EmailItem {
  id: string;
  name: string;
  supplier: string;
  asin?: string;
  imageUrl?: string;
  lastPrice?: number;
  quantity?: number;
  location?: string;
  recommendedMin?: number;
  recommendedOrderQty?: number;
}

// Master list item - unified from all sources
export interface MasterListItem {
  id: string;
  source: 'email' | 'barcode' | 'photo' | 'csv';
  // Core fields
  name: string;
  description?: string;
  supplier?: string;
  location?: string;
  // Identifiers
  barcode?: string;
  sku?: string;
  asin?: string;
  // Quantities
  minQty?: number;
  orderQty?: number;
  currentQty?: number;
  // Pricing
  unitPrice?: number;
  // Media
  imageUrl?: string;
  // Status
  isEditing?: boolean;
  isVerified: boolean;
  needsAttention: boolean;
  validationErrors?: string[];
}

interface MasterListStepProps {
  emailItems: EmailItem[];
  scannedBarcodes: ScannedBarcode[];
  capturedPhotos: CapturedPhoto[];
  csvItems: CSVItem[];
  onComplete: (items: MasterListItem[]) => void;
  onBack: () => void;
}

export const MasterListStep: React.FC<MasterListStepProps> = ({
  emailItems,
  scannedBarcodes,
  capturedPhotos,
  csvItems,
  onComplete,
  onBack,
}) => {
  // Build initial master list from all sources
  const initialItems = useMemo(() => {
    const items: MasterListItem[] = [];
    
    // Add email items
    emailItems.forEach(item => {
      items.push({
        id: item.id,
        source: 'email',
        name: item.name,
        supplier: item.supplier,
        location: item.location,
        asin: item.asin,
        minQty: item.recommendedMin,
        orderQty: item.recommendedOrderQty,
        unitPrice: item.lastPrice,
        imageUrl: item.imageUrl,
        isVerified: false,
        needsAttention: !item.name || item.name.includes('Unknown'),
      });
    });
    
    // Add scanned barcodes (that aren't duplicates of email items)
    scannedBarcodes.forEach(barcode => {
      // Check if already matched to an email item
      const existingByBarcode = items.find(i => i.barcode === barcode.barcode);
      if (!existingByBarcode) {
        items.push({
          id: `barcode-${barcode.id}`,
          source: 'barcode',
          name: barcode.productName || `Unknown (${barcode.barcode})`,
          barcode: barcode.barcode,
          imageUrl: barcode.imageUrl,
          isVerified: false,
          needsAttention: !barcode.productName,
        });
      }
    });
    
    // Add photo-captured items
    capturedPhotos.forEach(photo => {
      if (photo.suggestedName) {
        items.push({
          id: `photo-${photo.id}`,
          source: 'photo',
          name: photo.suggestedName,
          supplier: photo.suggestedSupplier,
          imageUrl: photo.imageData,
          isVerified: false,
          needsAttention: false,
        });
      }
    });
    
    // Add CSV items
    csvItems.forEach(csvItem => {
      items.push({
        id: csvItem.id,
        source: 'csv',
        name: csvItem.name,
        supplier: csvItem.supplier,
        location: csvItem.location,
        barcode: csvItem.barcode,
        sku: csvItem.sku,
        minQty: csvItem.minQty,
        orderQty: csvItem.orderQty,
        unitPrice: csvItem.unitPrice,
        isVerified: false,
        needsAttention: false,
      });
    });
    
    return items;
  }, [emailItems, scannedBarcodes, capturedPhotos, csvItems]);

  const [items, setItems] = useState<MasterListItem[]>(initialItems);
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<MasterListItem>>({});
  const [filter, setFilter] = useState<'all' | 'needs_attention' | 'verified'>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'email' | 'barcode' | 'photo' | 'csv'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Start editing an item
  const startEditing = (item: MasterListItem) => {
    setEditingItem(item.id);
    setEditForm({
      name: item.name,
      description: item.description,
      supplier: item.supplier,
      location: item.location,
      barcode: item.barcode,
      sku: item.sku,
      minQty: item.minQty,
      orderQty: item.orderQty,
      unitPrice: item.unitPrice,
    });
  };

  // Save edited item
  const saveEdit = () => {
    if (!editingItem) return;
    
    setItems(prev => prev.map(item => {
      if (item.id === editingItem) {
        return {
          ...item,
          ...editForm,
          needsAttention: false,
        };
      }
      return item;
    }));
    
    setEditingItem(null);
    setEditForm({});
  };

  // Cancel editing
  const cancelEdit = () => {
    setEditingItem(null);
    setEditForm({});
  };

  // Mark item as verified
  const verifyItem = (id: string) => {
    setItems(prev => prev.map(item => 
      item.id === id ? { ...item, isVerified: true, needsAttention: false } : item
    ));
  };

  // Remove item from list
  const removeItem = (id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
  };

  // Verify all items
  const verifyAll = () => {
    setItems(prev => prev.map(item => ({ ...item, isVerified: true, needsAttention: false })));
  };

  // Filter items
  const filteredItems = useMemo(() => {
    return items.filter(item => {
      // Filter by status
      if (filter === 'needs_attention' && !item.needsAttention) return false;
      if (filter === 'verified' && !item.isVerified) return false;
      
      // Filter by source
      if (sourceFilter !== 'all' && item.source !== sourceFilter) return false;
      
      // Filter by search
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          item.name.toLowerCase().includes(query) ||
          item.sku?.toLowerCase().includes(query) ||
          item.barcode?.toLowerCase().includes(query) ||
          item.supplier?.toLowerCase().includes(query)
        );
      }
      return true;
    });
  }, [items, filter, sourceFilter, searchQuery]);

  // Stats
  const stats = useMemo(() => ({
    total: items.length,
    verified: items.filter(i => i.isVerified).length,
    needsAttention: items.filter(i => i.needsAttention).length,
    bySource: {
      email: items.filter(i => i.source === 'email').length,
      barcode: items.filter(i => i.source === 'barcode').length,
      photo: items.filter(i => i.source === 'photo').length,
      csv: items.filter(i => i.source === 'csv').length,
    },
  }), [items]);

  // Source icon
  const getSourceIcon = (source: MasterListItem['source']) => {
    switch (source) {
      case 'email': return <Icons.Mail className="w-4 h-4" />;
      case 'barcode': return <Icons.Barcode className="w-4 h-4" />;
      case 'photo': return <Icons.Camera className="w-4 h-4" />;
      case 'csv': return <Icons.FileSpreadsheet className="w-4 h-4" />;
    }
  };

  // Handle completion
  const handleComplete = useCallback(() => {
    onComplete(items);
  }, [items, onComplete]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Master Item List</h1>
          <p className="text-gray-500 mt-1">
            Review, enrich, and verify items before syncing to Arda
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="px-4 py-2 text-gray-600 hover:text-gray-900 transition-colors"
          >
            Back
          </button>
          <button
            onClick={handleComplete}
            disabled={items.length === 0}
            className={`
              px-6 py-2 rounded-lg font-medium transition-colors flex items-center gap-2
              ${items.length > 0 
                ? 'bg-green-600 text-white hover:bg-green-700' 
                : 'bg-gray-200 text-gray-500 cursor-not-allowed'}
            `}
          >
            <Icons.ArrowRight className="w-4 h-4" />
            Continue to Arda Sync ({items.length} items)
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
          <div className="text-sm text-gray-500">Total Items</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-2xl font-bold text-green-600">{stats.verified}</div>
          <div className="text-sm text-gray-500">Verified</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-2xl font-bold text-yellow-600">{stats.needsAttention}</div>
          <div className="text-sm text-gray-500">Needs Attention</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4 col-span-2">
          <div className="flex items-center gap-4 text-sm">
            <span className="flex items-center gap-1">
              <Icons.Mail className="w-4 h-4 text-blue-500" />
              {stats.bySource.email}
            </span>
            <span className="flex items-center gap-1">
              <Icons.Barcode className="w-4 h-4 text-purple-500" />
              {stats.bySource.barcode}
            </span>
            <span className="flex items-center gap-1">
              <Icons.Camera className="w-4 h-4 text-orange-500" />
              {stats.bySource.photo}
            </span>
            <span className="flex items-center gap-1">
              <Icons.FileSpreadsheet className="w-4 h-4 text-green-500" />
              {stats.bySource.csv}
            </span>
          </div>
          <div className="text-sm text-gray-500 mt-1">By Source</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            {(['all', 'needs_attention', 'verified'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`
                  px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
                  ${filter === f 
                    ? 'bg-gray-900 text-white' 
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}
                `}
              >
                {f === 'needs_attention' ? 'Needs Attention' : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          <div className="h-6 w-px bg-gray-200" />
          <div className="flex items-center gap-1">
            {(['all', 'email', 'barcode', 'photo', 'csv'] as const).map(s => (
              <button
                key={s}
                onClick={() => setSourceFilter(s)}
                className={`
                  px-2 py-1.5 rounded text-sm transition-colors
                  ${sourceFilter === s 
                    ? 'bg-blue-100 text-blue-700' 
                    : 'text-gray-500 hover:bg-gray-100'}
                `}
              >
                {s === 'all' ? 'All Sources' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={verifyAll}
            className="px-3 py-1.5 text-sm text-green-600 hover:bg-green-50 rounded-lg transition-colors"
          >
            Verify All
          </button>
          <div className="relative">
            <Icons.Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search items..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Items list */}
      <div className="space-y-3">
        {filteredItems.map(item => (
          <div
            key={item.id}
            className={`
              bg-white rounded-lg border p-4 transition-all
              ${item.needsAttention ? 'border-yellow-300 bg-yellow-50' : 'border-gray-200'}
              ${item.isVerified ? 'border-green-300 bg-green-50' : ''}
            `}
          >
            {editingItem === item.id ? (
              /* Edit form */
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                    <input
                      type="text"
                      value={editForm.name || ''}
                      onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                    <input
                      type="text"
                      value={editForm.description || ''}
                      onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
                    <input
                      type="text"
                      value={editForm.supplier || ''}
                      onChange={(e) => setEditForm(prev => ({ ...prev, supplier: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Location / Bin</label>
                    <input
                      type="text"
                      value={editForm.location || ''}
                      onChange={(e) => setEditForm(prev => ({ ...prev, location: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">SKU</label>
                    <input
                      type="text"
                      value={editForm.sku || ''}
                      onChange={(e) => setEditForm(prev => ({ ...prev, sku: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Barcode</label>
                    <input
                      type="text"
                      value={editForm.barcode || ''}
                      onChange={(e) => setEditForm(prev => ({ ...prev, barcode: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Min Quantity</label>
                    <input
                      type="number"
                      value={editForm.minQty || ''}
                      onChange={(e) => setEditForm(prev => ({ ...prev, minQty: parseFloat(e.target.value) || undefined }))}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Order Quantity</label>
                    <input
                      type="number"
                      value={editForm.orderQty || ''}
                      onChange={(e) => setEditForm(prev => ({ ...prev, orderQty: parseFloat(e.target.value) || undefined }))}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={cancelEdit}
                    className="px-4 py-2 text-gray-600 hover:text-gray-900 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveEdit}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
                  >
                    Save Changes
                  </button>
                </div>
              </div>
            ) : (
              /* Display view */
              <div className="flex items-start gap-4">
                {/* Image */}
                {item.imageUrl && (
                  <div className="w-16 h-16 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                    <img 
                      src={item.imageUrl} 
                      alt={item.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                
                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`
                          p-1 rounded
                          ${item.source === 'email' ? 'bg-blue-100 text-blue-600' : ''}
                          ${item.source === 'barcode' ? 'bg-purple-100 text-purple-600' : ''}
                          ${item.source === 'photo' ? 'bg-orange-100 text-orange-600' : ''}
                          ${item.source === 'csv' ? 'bg-green-100 text-green-600' : ''}
                        `}>
                          {getSourceIcon(item.source)}
                        </span>
                        <h3 className="font-medium text-gray-900">{item.name}</h3>
                        {item.isVerified && (
                          <Icons.CheckCircle2 className="w-4 h-4 text-green-500" />
                        )}
                        {item.needsAttention && (
                          <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded text-xs font-medium">
                            Needs Review
                          </span>
                        )}
                      </div>
                      {item.description && (
                        <p className="text-sm text-gray-500 mt-0.5">{item.description}</p>
                      )}
                      <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                        {item.supplier && (
                          <span className="flex items-center gap-1">
                            <Icons.Building2 className="w-3 h-3" />
                            {item.supplier}
                          </span>
                        )}
                        {item.location && (
                          <span className="flex items-center gap-1">
                            <Icons.MapPin className="w-3 h-3" />
                            {item.location}
                          </span>
                        )}
                        {item.sku && (
                          <span>SKU: {item.sku}</span>
                        )}
                        {item.barcode && (
                          <span>Barcode: {item.barcode}</span>
                        )}
                      </div>
                    </div>
                    
                    {/* Quantities */}
                    <div className="text-right text-sm">
                      {item.minQty !== undefined && (
                        <div className="text-gray-500">Min: {item.minQty}</div>
                      )}
                      {item.orderQty !== undefined && (
                        <div className="text-gray-500">Order: {item.orderQty}</div>
                      )}
                      {item.unitPrice !== undefined && (
                        <div className="font-medium text-gray-900">
                          ${item.unitPrice.toFixed(2)}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                
                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => startEditing(item)}
                    className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    title="Edit"
                  >
                    <Icons.Pencil className="w-4 h-4" />
                  </button>
                  {!item.isVerified && (
                    <button
                      onClick={() => verifyItem(item.id)}
                      className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                      title="Verify"
                    >
                      <Icons.Check className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => removeItem(item.id)}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Remove"
                  >
                    <Icons.Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        
        {filteredItems.length === 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
            <Icons.Package className="w-12 h-12 mx-auto text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Items</h3>
            <p className="text-gray-500">
              {items.length === 0 
                ? 'Complete the previous steps to add items to your master list.'
                : 'No items match your current filters.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
