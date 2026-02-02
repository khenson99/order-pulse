import { useState, useMemo, useCallback, useDeferredValue } from 'react';
import { Icons } from '../components/Icons';
import { ScannedBarcode, CapturedPhoto } from './OnboardingFlow';
import { CSVItem, CSVItemColor } from './csvUploadUtils';
import { productApi } from '../services/api';

function trimOrUndefined(value: string | undefined): string | undefined {
  const v = (value ?? '').trim();
  return v ? v : undefined;
}

function parseOptionalNumber(value: string): number | undefined {
  const v = (value ?? '').trim();
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// Simple email item from onboarding
interface EmailItem {
  id: string;
  name: string;
  supplier: string;
  asin?: string;
  imageUrl?: string;
  productUrl?: string;
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
  // Media / Links
  imageUrl?: string;
  productUrl?: string;
  color?: CSVItemColor;
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
}

export const MasterListStep: React.FC<MasterListStepProps> = ({
  emailItems,
  scannedBarcodes,
  capturedPhotos,
  csvItems,
  onComplete,
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
        productUrl: item.productUrl,
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
        imageUrl: csvItem.imageUrl,
        productUrl: csvItem.productUrl,
        color: csvItem.color,
        isVerified: false,
        needsAttention: false,
      });
    });
    
    return items;
  }, [emailItems, scannedBarcodes, capturedPhotos, csvItems]);

  const [items, setItems] = useState<MasterListItem[]>(initialItems);
  const [filter, setFilter] = useState<'all' | 'needs_attention' | 'verified'>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'email' | 'barcode' | 'photo' | 'csv'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearch = useDeferredValue(searchQuery);
  const [enrichingIds, setEnrichingIds] = useState<Set<string>>(new Set());
  const [enrichErrorById, setEnrichErrorById] = useState<Record<string, string>>({});

  const updateItemFields = (id: string, updates: Partial<MasterListItem>) => {
    setItems(prev => prev.map(item => {
      if (item.id !== id) return item;
      const next: MasterListItem = { ...item, ...updates };
      if (typeof updates.name === 'string') {
        const trimmed = updates.name.trim();
        next.needsAttention = !trimmed || trimmed.toLowerCase().includes('unknown');
      }
      if (updates.isVerified === true) {
        next.needsAttention = false;
      }
      return next;
    }));
  };

  // Remove item from list
  const removeItem = (id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
  };

  // Verify all items
  const verifyAll = () => {
    setItems(prev => prev.map(item => ({ ...item, isVerified: true, needsAttention: false })));
  };

  const enrichFromProductUrl = useCallback(async (item: MasterListItem) => {
    const url = item.productUrl || (item.asin ? `https://www.amazon.com/dp/${item.asin}` : undefined);
    if (!url) return;

    setEnrichingIds(prev => new Set(prev).add(item.id));
    setEnrichErrorById(prev => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });

    try {
      const result = await productApi.enrichUrl(url);
      const data = result.data || {};
      setItems(prev => prev.map(existing => {
        if (existing.id !== item.id) return existing;

        const next: MasterListItem = { ...existing };

        if (data.productUrl) next.productUrl = data.productUrl;
        if (data.imageUrl) next.imageUrl = data.imageUrl;
        if (typeof data.unitPrice === 'number') next.unitPrice = data.unitPrice;

        // If we learned a pack size / unit count, use it as a reasonable default orderQty
        if (typeof data.unitCount === 'number' && data.unitCount > 0) {
          if (!next.orderQty || next.orderQty <= 1) {
            next.orderQty = data.unitCount;
          }
          if (!next.minQty || next.minQty <= 0) {
            next.minQty = Math.max(1, Math.ceil(data.unitCount / 2));
          }
        }

        // Only override name when it's clearly missing/placeholder
        if (data.name && (!next.name || next.name.includes('Unknown'))) {
          next.name = data.name;
        }

        return next;
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to enrich from URL';
      setEnrichErrorById(prev => ({ ...prev, [item.id]: message }));
    } finally {
      setEnrichingIds(prev => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }, []);

  // Filter items
  const filteredItems = useMemo(() => {
    return items.filter(item => {
      if (filter === 'needs_attention' && !item.needsAttention) return false;
      if (filter === 'verified' && !item.isVerified) return false;
      if (sourceFilter !== 'all' && item.source !== sourceFilter) return false;
      if (deferredSearch) {
        const query = deferredSearch.toLowerCase();
        return (
          item.name.toLowerCase().includes(query) ||
          item.sku?.toLowerCase().includes(query) ||
          item.barcode?.toLowerCase().includes(query) ||
          item.supplier?.toLowerCase().includes(query)
        );
      }
      return true;
    });
  }, [items, filter, sourceFilter, deferredSearch]);

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
  const getSourceIcon = useCallback((source: MasterListItem['source']) => {
    switch (source) {
      case 'email': return <Icons.Mail className="w-4 h-4" />;
      case 'barcode': return <Icons.Barcode className="w-4 h-4" />;
      case 'photo': return <Icons.Camera className="w-4 h-4" />;
      case 'csv': return <Icons.FileSpreadsheet className="w-4 h-4" />;
    }
  }, []);

  // Handle completion
  const handleComplete = useCallback(() => {
    onComplete(items);
  }, [items, onComplete]);

  return (
    <div className="space-y-6">
      {/* Actions */}
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-arda-text-secondary">
          Edit any field inline — changes are saved automatically.
        </div>
        <button
          type="button"
          onClick={verifyAll}
          className="btn-arda-outline"
        >
          Verify all
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="card-arda p-4">
          <div className="text-2xl font-bold text-arda-text-primary">{stats.total}</div>
          <div className="text-sm text-arda-text-secondary">Total Items</div>
        </div>
        <div className="card-arda p-4">
          <div className="text-2xl font-bold text-green-600">{stats.verified}</div>
          <div className="text-sm text-arda-text-secondary">Verified</div>
        </div>
        <div className="card-arda p-4">
          <div className="text-2xl font-bold text-arda-accent">{stats.needsAttention}</div>
          <div className="text-sm text-arda-text-secondary">Needs Attention</div>
        </div>
        <div className="card-arda p-4 col-span-2">
          <div className="flex items-center gap-4 text-sm">
            <span className="flex items-center gap-1">
              <Icons.Mail className="w-4 h-4 text-arda-accent" />
              {stats.bySource.email}
            </span>
            <span className="flex items-center gap-1">
              <Icons.Barcode className="w-4 h-4 text-arda-accent" />
              {stats.bySource.barcode}
            </span>
            <span className="flex items-center gap-1">
              <Icons.Camera className="w-4 h-4 text-arda-accent" />
              {stats.bySource.photo}
            </span>
            <span className="flex items-center gap-1">
              <Icons.FileSpreadsheet className="w-4 h-4 text-arda-accent" />
              {stats.bySource.csv}
            </span>
          </div>
          <div className="text-sm text-arda-text-secondary mt-1">By Source</div>
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
                className={[
                  'px-3 py-1.5 rounded-arda text-sm font-medium transition-colors border',
                  filter === f
                    ? 'bg-arda-accent text-white border-orange-600'
                    : 'bg-white/70 text-arda-text-secondary border-arda-border hover:bg-arda-bg-tertiary',
                ].join(' ')}
              >
                {f === 'needs_attention' ? 'Needs Attention' : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          <div className="h-6 w-px bg-arda-border" />
          <div className="flex items-center gap-1">
            {(['all', 'email', 'barcode', 'photo', 'csv'] as const).map(s => (
              <button
                key={s}
                onClick={() => setSourceFilter(s)}
                className={[
                  'px-2 py-1.5 rounded-arda text-sm transition-colors border',
                  sourceFilter === s
                    ? 'bg-orange-50 text-arda-accent border-orange-200'
                    : 'bg-transparent text-arda-text-secondary border-transparent hover:bg-arda-bg-tertiary hover:border-arda-border',
                ].join(' ')}
              >
                {s === 'all' ? 'All Sources' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Icons.Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-arda-text-muted" />
            <input
              type="text"
              placeholder="Search items..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input-arda pl-9 pr-4 py-2 text-sm bg-white"
            />
          </div>
        </div>
      </div>

      {/* Items table (inline editable) */}
      <div className="card-arda overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-arda">
            <thead className="bg-arda-bg-secondary border-b border-arda-border">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-arda-text-secondary uppercase tracking-wider">
                  Item
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-arda-text-secondary uppercase tracking-wider">
                  Supplier
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-arda-text-secondary uppercase tracking-wider">
                  Location
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-arda-text-secondary uppercase tracking-wider">
                  SKU
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-arda-text-secondary uppercase tracking-wider">
                  Barcode
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-arda-text-secondary uppercase tracking-wider">
                  Min / Order / Price
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-arda-text-secondary uppercase tracking-wider">
                  Product URL
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-arda-text-secondary uppercase tracking-wider">
                  Verified
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-arda-text-secondary uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-arda-border">
              {filteredItems.map(item => (
                <tr
                  key={item.id}
                  className={[
                    'transition-colors',
                    item.needsAttention ? 'bg-orange-50' : '',
                    item.isVerified ? 'bg-green-50' : '',
                  ].join(' ')}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="p-1.5 rounded-lg bg-arda-bg-tertiary border border-arda-border text-arda-accent flex-shrink-0">
                        {getSourceIcon(item.source)}
                      </span>
                      {item.imageUrl && (
                        <img
                          src={item.imageUrl}
                          alt=""
                          className="w-10 h-10 rounded-xl object-cover border border-arda-border bg-arda-bg-tertiary flex-shrink-0"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <input
                          type="text"
                          value={item.name}
                          onChange={(e) => updateItemFields(item.id, { name: e.target.value })}
                          className="w-full bg-transparent border border-transparent rounded-md px-2 py-1 text-sm font-semibold text-arda-text-primary focus:bg-white focus:border-arda-border focus:ring-2 focus:ring-arda-accent"
                          aria-label={`Item name (${item.id})`}
                          title="Item name"
                        />
                        <div className="mt-1 flex items-center gap-2 flex-wrap text-xs text-arda-text-muted">
                          {item.color && (
                            <span className="inline-flex items-center gap-1 bg-white/70 border border-arda-border rounded-lg px-2 py-0.5">
                              <span className="w-2 h-2 rounded-full bg-arda-accent" aria-hidden="true" />
                              {item.color}
                            </span>
                          )}
                          {item.needsAttention && (
                            <span className="inline-flex items-center gap-1 bg-orange-100/60 border border-orange-200 text-orange-800 rounded-lg px-2 py-0.5">
                              Needs review
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      value={item.supplier ?? ''}
                      onChange={(e) => updateItemFields(item.id, { supplier: trimOrUndefined(e.target.value) })}
                      className="w-full bg-transparent border border-transparent rounded-md px-2 py-1 text-sm text-arda-text-primary focus:bg-white focus:border-arda-border focus:ring-2 focus:ring-arda-accent"
                      placeholder="Supplier"
                      aria-label="Supplier"
                      title="Supplier"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      value={item.location ?? ''}
                      onChange={(e) => updateItemFields(item.id, { location: trimOrUndefined(e.target.value) })}
                      className="w-full bg-transparent border border-transparent rounded-md px-2 py-1 text-sm text-arda-text-primary focus:bg-white focus:border-arda-border focus:ring-2 focus:ring-arda-accent"
                      placeholder="Location"
                      aria-label="Location"
                      title="Location"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      value={item.sku ?? ''}
                      onChange={(e) => updateItemFields(item.id, { sku: trimOrUndefined(e.target.value) })}
                      className="w-full bg-transparent border border-transparent rounded-md px-2 py-1 text-sm text-arda-text-primary focus:bg-white focus:border-arda-border focus:ring-2 focus:ring-arda-accent"
                      placeholder="SKU"
                      aria-label="SKU"
                      title="SKU"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      value={item.barcode ?? ''}
                      onChange={(e) => updateItemFields(item.id, { barcode: trimOrUndefined(e.target.value) })}
                      className="w-full bg-transparent border border-transparent rounded-md px-2 py-1 text-sm text-arda-text-primary focus:bg-white focus:border-arda-border focus:ring-2 focus:ring-arda-accent font-mono"
                      placeholder="Barcode"
                      aria-label="Barcode"
                      title="Barcode"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="grid grid-cols-1 gap-1 min-w-[9rem]">
                      <input
                        type="number"
                        inputMode="numeric"
                        value={item.minQty ?? ''}
                        onChange={(e) => updateItemFields(item.id, { minQty: parseOptionalNumber(e.target.value) })}
                        className="w-full bg-transparent border border-transparent rounded-md px-2 py-1 text-sm text-arda-text-primary focus:bg-white focus:border-arda-border focus:ring-2 focus:ring-arda-accent"
                        placeholder="Min"
                        aria-label="Min qty"
                        title="Min qty"
                      />
                      <input
                        type="number"
                        inputMode="numeric"
                        value={item.orderQty ?? ''}
                        onChange={(e) => updateItemFields(item.id, { orderQty: parseOptionalNumber(e.target.value) })}
                        className="w-full bg-transparent border border-transparent rounded-md px-2 py-1 text-sm text-arda-text-primary focus:bg-white focus:border-arda-border focus:ring-2 focus:ring-arda-accent"
                        placeholder="Order"
                        aria-label="Order qty"
                        title="Order qty"
                      />
                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        value={item.unitPrice ?? ''}
                        onChange={(e) => updateItemFields(item.id, { unitPrice: parseOptionalNumber(e.target.value) })}
                        className="w-full bg-transparent border border-transparent rounded-md px-2 py-1 text-sm text-arda-text-primary focus:bg-white focus:border-arda-border focus:ring-2 focus:ring-arda-accent"
                        placeholder="Price"
                        aria-label="Unit price"
                        title="Unit price"
                      />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-1 min-w-[14rem]">
                      <input
                        type="url"
                        value={item.productUrl ?? ''}
                        onChange={(e) => updateItemFields(item.id, { productUrl: trimOrUndefined(e.target.value) })}
                        className="w-full bg-transparent border border-transparent rounded-md px-2 py-1 text-sm text-arda-text-primary focus:bg-white focus:border-arda-border focus:ring-2 focus:ring-arda-accent"
                        placeholder="https://…"
                        aria-label="Product URL"
                        title="Product URL"
                      />
                      {enrichErrorById[item.id] && (
                        <div className="text-xs text-red-600">
                          {enrichErrorById[item.id]}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <input
                      type="checkbox"
                      checked={item.isVerified}
                      onChange={(e) => updateItemFields(item.id, { isVerified: e.target.checked })}
                      className="rounded border-gray-300"
                      aria-label={`Verified: ${item.name}`}
                      title={`Verified: ${item.name}`}
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {(item.productUrl || item.asin) && (
                        <button
                          type="button"
                          onClick={() => enrichFromProductUrl(item)}
                          className="p-1.5 text-arda-text-muted hover:text-arda-accent hover:bg-orange-50 rounded-xl transition-colors disabled:opacity-50"
                          title={enrichingIds.has(item.id) ? 'Enriching…' : 'Enrich from product URL'}
                          disabled={enrichingIds.has(item.id)}
                        >
                          {enrichingIds.has(item.id) ? (
                            <Icons.Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Icons.Sparkles className="w-4 h-4" />
                          )}
                        </button>
                      )}
                      {item.productUrl && (
                        <a
                          href={item.productUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 text-arda-text-muted hover:text-arda-accent hover:bg-orange-50 rounded-xl transition-colors inline-flex"
                          title="Open product page"
                        >
                          <Icons.ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        className="p-1.5 text-arda-text-muted hover:text-red-700 hover:bg-red-50 rounded-xl transition-colors"
                        title="Remove"
                        aria-label={`Remove ${item.name}`}
                      >
                        <Icons.Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredItems.length === 0 && (
          <div className="p-12 text-center">
            <Icons.Package className="w-12 h-12 mx-auto text-arda-text-muted mb-4 opacity-60" />
            <h3 className="text-lg font-medium text-arda-text-primary mb-2">No Items</h3>
            <p className="text-arda-text-secondary">
              {items.length === 0
                ? 'Complete the previous steps to add items to your master list.'
                : 'No items match your current filters.'}
            </p>
          </div>
        )}
      </div>

      {/* Bottom CTA */}
      <div className="sticky bottom-24 z-20">
        <div className="bg-white/80 backdrop-blur border border-arda-border rounded-arda-lg shadow-arda p-4 flex items-center justify-between gap-4">
          <div className="text-sm text-arda-text-secondary">
            {items.length} item{items.length === 1 ? '' : 's'} ready
          </div>
          <button
            type="button"
            onClick={handleComplete}
            disabled={items.length === 0}
            className={[
              'flex items-center gap-2 px-4 py-2 rounded-arda font-semibold text-sm transition-colors',
              items.length > 0
                ? 'bg-green-600 text-white hover:bg-green-700'
                : 'bg-arda-border text-arda-text-muted cursor-not-allowed',
            ].join(' ')}
          >
            <Icons.ArrowRight className="w-4 h-4" />
            Add {items.length} Item{items.length === 1 ? '' : 's'} to Arda
          </button>
        </div>
      </div>
    </div>
  );
};
