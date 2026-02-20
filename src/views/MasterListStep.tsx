import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Icons } from '../components/Icons';
import { InstructionCard } from '../components/InstructionCard';
import { API_BASE_URL, UrlScrapedItem, ardaApi, ArdaTenantResolutionDetails, isApiRequestError } from '../services/api';
import { ScannedBarcode, CapturedPhoto } from './OnboardingFlow';
import { CSVItem } from './CSVUploadStep';
import { exportItemsToCSV } from '../utils/exportUtils';

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

export interface MasterListItem {
  id: string;
  source: 'email' | 'url' | 'barcode' | 'photo' | 'csv';
  orderMethod: OrderMethod;
  name: string;
  description?: string;
  supplier?: string;
  location?: string;
  barcode?: string;
  sku?: string;
  asin?: string;
  minQty?: number;
  orderQty?: number;
  currentQty?: number;
  unitPrice?: number;
  imageUrl?: string;
  productUrl?: string;
  color?: string;
  needsAttention: boolean;
  validationErrors?: string[];
}

export type OrderMethod = 'online' | 'purchase_order' | 'production' | 'shopping' | 'email';

const ORDER_METHOD_OPTIONS: Array<{ value: OrderMethod; label: string }> = [
  { value: 'online', label: 'Online' },
  { value: 'purchase_order', label: 'Purchase Order' },
  { value: 'production', label: 'Production' },
  { value: 'shopping', label: 'Shopping' },
  { value: 'email', label: 'Email' },
];

const DEFAULT_ORDER_METHOD_BY_SOURCE: Record<MasterListItem['source'], OrderMethod> = {
  email: 'online',
  url: 'online',
  barcode: 'shopping',
  photo: 'production',
  csv: 'purchase_order',
};

interface MasterListStepProps {
  emailItems: EmailItem[];
  urlItems: UrlScrapedItem[];
  scannedBarcodes: ScannedBarcode[];
  capturedPhotos: CapturedPhoto[];
  csvItems: CSVItem[];
  onComplete: (items: MasterListItem[]) => void;
  onBack: () => void;
  onFooterStateChange?: (state: MasterListFooterState) => void;
}

type RowSyncStatus = 'idle' | 'syncing' | 'success' | 'error';

interface RowSyncState {
  status: RowSyncStatus;
  ardaEntityId?: string;
  error?: string;
}

interface SyncResult {
  success: boolean;
  ardaEntityId?: string;
  error?: string;
}

export interface MasterListFooterState {
  selectedCount: number;
  syncedCount: number;
  canSyncSelected: boolean;
  canComplete: boolean;
  isSyncing: boolean;
  onSyncSelected: () => void;
  onComplete: () => void;
}

interface EditableCellProps {
  value: string | number | undefined;
  onChange: (value: string) => void;
  type?: 'text' | 'number';
  placeholder?: string;
  className?: string;
}

const EditableCell: React.FC<EditableCellProps> = ({
  value,
  onChange,
  type = 'text',
  placeholder = '',
  className = '',
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [localValue, setLocalValue] = useState(String(value ?? ''));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLocalValue(String(value ?? ''));
  }, [value]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleBlur = () => {
    setIsEditing(false);
    if (localValue !== String(value ?? '')) {
      onChange(localValue);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleBlur();
    } else if (e.key === 'Escape') {
      setLocalValue(String(value ?? ''));
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type={type}
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className={`w-full px-2 py-1 text-sm border border-arda-accent rounded bg-white focus:outline-none focus:ring-2 focus:ring-arda-accent/30 ${className}`}
        placeholder={placeholder}
      />
    );
  }

  return (
    <div
      onClick={() => setIsEditing(true)}
      className={`px-2 py-1 text-sm cursor-text hover:bg-orange-50 rounded min-h-[28px] ${className} ${!value ? 'text-arda-text-muted italic' : ''}`}
    >
      {value !== undefined && value !== '' ? value : placeholder || '—'}
    </div>
  );
};

const toExternalUrl = (value?: string): string | null => {
  const raw = value?.trim();
  if (!raw || raw.startsWith('data:')) return null;

  try {
    return new URL(raw).toString();
  } catch {
    try {
      return new URL(`https://${raw}`).toString();
    } catch {
      return null;
    }
  }
};

const ColorPicker: React.FC<{ value?: string; onChange: (color: string) => void }> = ({ value, onChange }) => {
  const colors = [
    { id: 'BLUE', label: 'Blue', bg: 'bg-blue-500' },
    { id: 'GREEN', label: 'Green', bg: 'bg-green-500' },
    { id: 'YELLOW', label: 'Yellow', bg: 'bg-yellow-400' },
    { id: 'ORANGE', label: 'Orange', bg: 'bg-orange-500' },
    { id: 'RED', label: 'Red', bg: 'bg-red-500' },
    { id: 'PINK', label: 'Pink', bg: 'bg-pink-400' },
    { id: 'PURPLE', label: 'Purple', bg: 'bg-purple-500' },
    { id: 'GRAY', label: 'Gray', bg: 'bg-gray-400' },
  ];

  const [isOpen, setIsOpen] = useState(false);
  const selected = colors.find(c => c.id === value?.toUpperCase());

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-2 py-1 text-sm hover:bg-orange-50 rounded min-h-[28px] w-full"
      >
        {selected ? (
          <>
            <span className={`w-4 h-4 rounded ${selected.bg}`} />
            <span>{selected.label}</span>
          </>
        ) : (
          <span className="text-arda-text-muted italic">Select color</span>
        )}
      </button>
      {isOpen && (
        <div className="absolute z-10 mt-1 bg-white border border-arda-border rounded-lg shadow-lg p-2 grid grid-cols-4 gap-1">
          {colors.map(color => (
            <button
              key={color.id}
              type="button"
              onClick={() => {
                onChange(color.id);
                setIsOpen(false);
              }}
              className={`w-8 h-8 rounded ${color.bg} hover:ring-2 ring-offset-1 ring-arda-accent ${value?.toUpperCase() === color.id ? 'ring-2' : ''}`}
              title={color.label}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const MasterListStep: React.FC<MasterListStepProps> = ({
  emailItems,
  urlItems,
  scannedBarcodes,
  capturedPhotos,
  csvItems,
  onComplete,
  onBack,
  onFooterStateChange,
}) => {
  void onBack;

  const initialItems = useMemo(() => {
    const items: MasterListItem[] = [];

    emailItems.forEach(item => {
      items.push({
        id: item.id,
        source: 'email',
        orderMethod: DEFAULT_ORDER_METHOD_BY_SOURCE.email,
        name: item.name,
        supplier: item.supplier,
        location: item.location,
        asin: item.asin,
        minQty: item.recommendedMin,
        orderQty: item.recommendedOrderQty,
        unitPrice: item.lastPrice,
        imageUrl: item.imageUrl,
        productUrl: item.productUrl,
        needsAttention: !item.name || item.name.includes('Unknown'),
      });
    });

    urlItems.forEach((item, index) => {
      items.push({
        id: `url-${index}-${item.sourceUrl}`,
        source: 'url',
        orderMethod: DEFAULT_ORDER_METHOD_BY_SOURCE.url,
        name: item.itemName || 'Unknown item',
        description: item.description,
        supplier: item.supplier,
        sku: item.vendorSku,
        asin: item.asin,
        unitPrice: item.price,
        imageUrl: item.imageUrl,
        productUrl: item.productUrl || item.sourceUrl,
        needsAttention: item.needsReview || !item.itemName || !item.supplier,
      });
    });

    scannedBarcodes.forEach(barcode => {
      const existingByBarcode = items.find(i => i.barcode === barcode.barcode);
      if (!existingByBarcode) {
        items.push({
          id: `barcode-${barcode.id}`,
          source: 'barcode',
          orderMethod: DEFAULT_ORDER_METHOD_BY_SOURCE.barcode,
          name: barcode.productName || `Unknown (${barcode.barcode})`,
          barcode: barcode.barcode,
          imageUrl: barcode.imageUrl,
          needsAttention: !barcode.productName,
        });
      }
    });

    capturedPhotos.forEach(photo => {
      items.push({
        id: `photo-${photo.id}`,
        source: 'photo',
        orderMethod: DEFAULT_ORDER_METHOD_BY_SOURCE.photo,
        name: photo.suggestedName || 'Captured Item (analyzing...)',
        supplier: photo.suggestedSupplier,
        imageUrl: photo.imageData,
        needsAttention: !photo.suggestedName,
      });
    });

    csvItems.forEach(csvItem => {
      items.push({
        id: csvItem.id,
        source: 'csv',
        orderMethod: DEFAULT_ORDER_METHOD_BY_SOURCE.csv,
        name: csvItem.name,
        supplier: csvItem.supplier,
        location: csvItem.location,
        barcode: csvItem.barcode,
        sku: csvItem.sku,
        minQty: csvItem.minQty,
        orderQty: csvItem.orderQty,
        unitPrice: csvItem.unitPrice,
        productUrl: csvItem.productUrl,
        imageUrl: csvItem.imageUrl,
        color: csvItem.color,
        needsAttention: false,
      });
    });

    return items;
  }, [emailItems, urlItems, scannedBarcodes, capturedPhotos, csvItems]);

  const [items, setItems] = useState<MasterListItem[]>(initialItems);
  const [filter, setFilter] = useState<'all' | 'needs_attention' | 'synced' | 'errors'>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'email' | 'url' | 'barcode' | 'photo' | 'csv'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [syncStateById, setSyncStateById] = useState<Record<string, RowSyncState>>({});
  const [isBulkSyncing, setIsBulkSyncing] = useState(false);
  const [showFloatingCta, setShowFloatingCta] = useState(false);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setItems(prev => {
      const newItems = [...prev];
      let hasChanges = false;

      for (const newItem of initialItems) {
        const existingIndex = newItems.findIndex(i => i.id === newItem.id);
        if (existingIndex === -1) {
          newItems.push(newItem);
          hasChanges = true;
        } else {
          const existing = newItems[existingIndex];
          if (
            (!existing.name || existing.name.includes('analyzing'))
            && newItem.name && !newItem.name.includes('analyzing')
          ) {
            newItems[existingIndex] = {
              ...existing,
              name: newItem.name,
              supplier: newItem.supplier || existing.supplier,
              needsAttention: false,
            };
            hasChanges = true;
          }
        }
      }

      return hasChanges ? newItems : prev;
    });
  }, [initialItems]);

  useEffect(() => {
    const ids = new Set(items.map(item => item.id));

    setSelectedItemIds(prev => {
      const next = new Set(Array.from(prev).filter(id => ids.has(id)));
      if (next.size === prev.size) return prev;
      return next;
    });

    setSyncStateById(prev => {
      let changed = false;
      const next: Record<string, RowSyncState> = {};

      for (const [id, state] of Object.entries(prev)) {
        if (ids.has(id)) {
          next[id] = state;
        } else {
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [items]);

  const updateItem = useCallback((id: string, field: keyof MasterListItem, value: string | number | undefined) => {
    setItems(prev => prev.map(item => {
      if (item.id !== id) return item;

      const updated: MasterListItem = { ...item, [field]: value };
      if (field === 'name' && value && !String(value).includes('Unknown')) {
        updated.needsAttention = false;
      }
      return updated;
    }));

    setSyncStateById(prev => {
      const existing = prev[id];
      if (!existing || existing.status === 'idle') return prev;
      return {
        ...prev,
        [id]: { status: 'idle' },
      };
    });
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
    setSelectedItemIds(prev => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setSyncStateById(prev => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      const rowStatus = syncStateById[item.id]?.status ?? 'idle';
      if (filter === 'needs_attention' && !item.needsAttention) return false;
      if (filter === 'synced' && rowStatus !== 'success') return false;
      if (filter === 'errors' && rowStatus !== 'error') return false;
      if (sourceFilter !== 'all' && item.source !== sourceFilter) return false;
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          item.name.toLowerCase().includes(query)
          || item.sku?.toLowerCase().includes(query)
          || item.barcode?.toLowerCase().includes(query)
          || item.supplier?.toLowerCase().includes(query)
        );
      }
      return true;
    });
  }, [items, filter, sourceFilter, searchQuery, syncStateById]);

  const stats = useMemo(() => ({
    total: items.length,
    synced: items.filter(item => (syncStateById[item.id]?.status ?? 'idle') === 'success').length,
    errors: items.filter(item => (syncStateById[item.id]?.status ?? 'idle') === 'error').length,
    needsAttention: items.filter(i => i.needsAttention).length,
  }), [items, syncStateById]);

  const sourceCounts = useMemo(() => ({
    email: items.filter(item => item.source === 'email').length,
    url: items.filter(item => item.source === 'url').length,
    barcode: items.filter(item => item.source === 'barcode').length,
    photo: items.filter(item => item.source === 'photo').length,
    csv: items.filter(item => item.source === 'csv').length,
  }), [items]);

  const selectedCount = selectedItemIds.size;

  const hasSyncInProgress = useMemo(
    () => isBulkSyncing || Object.values(syncStateById).some(state => state.status === 'syncing'),
    [isBulkSyncing, syncStateById],
  );

  const syncedItems = useMemo(
    () => items.filter(item => (syncStateById[item.id]?.status ?? 'idle') === 'success'),
    [items, syncStateById],
  );

  const filteredIds = useMemo(() => filteredItems.map(item => item.id), [filteredItems]);
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every(id => selectedItemIds.has(id));
  const someFilteredSelected = filteredIds.some(id => selectedItemIds.has(id));

  useEffect(() => {
    if (!selectAllRef.current) return;
    selectAllRef.current.indeterminate = someFilteredSelected && !allFilteredSelected;
  }, [someFilteredSelected, allFilteredSelected]);

  const uploadImage = useCallback(async (imageData: string): Promise<string | null> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/photo/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ imageData }),
      });

      if (!response.ok) return null;
      const data = await response.json();
      return data.imageUrl ?? null;
    } catch {
      return null;
    }
  }, []);

  const resolveTenantForSync = useCallback(async (details?: ArdaTenantResolutionDetails): Promise<boolean> => {
    const suggested = details?.suggestedTenant;
    if (suggested && details?.canUseSuggestedTenant) {
      const useSuggestion = window.confirm(
        `No tenant was mapped to your login email. Use suggested tenant ${suggested.tenantId} from ${suggested.matchedEmail}?`
      );
      if (useSuggestion) {
        const resolution = await ardaApi.resolveTenant('use_suggested');
        return resolution.success;
      }
    }

    if (details?.canCreateTenant) {
      const createNew = window.confirm('No tenant is mapped for this account. Create a new tenant now?');
      if (createNew) {
        const resolution = await ardaApi.resolveTenant('create_new');
        return resolution.success;
      }
    }

    return false;
  }, []);

  const exportMasterListItemsFallback = useCallback((itemsToExport: MasterListItem[]) => {
    exportItemsToCSV(
      itemsToExport.map((item) => ({
        source: item.source,
        name: item.name,
        supplier: item.supplier,
        description: item.description,
        location: item.location,
        orderMethod: item.orderMethod,
        minQty: item.minQty,
        orderQty: item.orderQty,
        unitPrice: item.unitPrice,
        sku: item.sku,
        barcode: item.barcode,
        asin: item.asin,
        productUrl: item.productUrl,
        imageUrl: item.imageUrl,
        color: item.color,
      })),
      'master-list-tenant-unresolved'
    );
  }, []);

  const ensureTenantForSync = useCallback(async (itemsToExportOnFailure: MasterListItem[]): Promise<boolean> => {
    try {
      const status = await ardaApi.getTenantStatus();
      if (status.resolved) return true;

      const resolved = await resolveTenantForSync(status.details);
      if (resolved) return true;

      exportMasterListItemsFallback(itemsToExportOnFailure);
      return false;
    } catch (error) {
      if (isApiRequestError(error) && error.code === 'TENANT_REQUIRED') {
        const resolved = await resolveTenantForSync(error.details as ArdaTenantResolutionDetails | undefined);
        if (resolved) return true;
      }
      exportMasterListItemsFallback(itemsToExportOnFailure);
      return false;
    }
  }, [exportMasterListItemsFallback, resolveTenantForSync]);

  const syncItemToArda = useCallback(async (item: MasterListItem): Promise<SyncResult> => {
    try {
      let imageUrl = item.imageUrl;
      if (imageUrl?.startsWith('data:image/')) {
        const uploadedUrl = await uploadImage(imageUrl);
        imageUrl = uploadedUrl || undefined;
      }

      const payload = {
        name: item.name,
        primarySupplier: item.supplier || 'Unknown Supplier',
        orderMechanism: item.orderMethod,
        sku: item.sku,
        barcode: item.barcode,
        location: item.location,
        minQty: item.minQty || 1,
        orderQty: item.orderQty || item.minQty || 1,
        unitPrice: item.unitPrice,
        imageUrl,
        primarySupplierLink: item.productUrl,
        description: item.description,
      };

      const attemptSync = async (): Promise<{
        data?: { success: boolean; record?: { rId?: string } };
        error?: unknown;
      }> => {
        try {
          return { data: await ardaApi.createItem(payload) };
        } catch (error) {
          return { error };
        }
      };

      let attempt = await attemptSync();

      if (attempt.error && isApiRequestError(attempt.error) && attempt.error.code === 'TENANT_REQUIRED') {
        const resolved = await resolveTenantForSync(attempt.error.details as ArdaTenantResolutionDetails | undefined);
        if (resolved) {
          attempt = await attemptSync();
        } else {
          exportMasterListItemsFallback([item]);
          return {
            success: false,
            error: `${(attempt.error.details as ArdaTenantResolutionDetails | undefined)?.message || 'Tenant unresolved for sync.'} Exported item to CSV.`,
          };
        }
      }

      if (attempt.error) {
        if (isApiRequestError(attempt.error)) {
          const resolvedErrorMessage = attempt.error.message || '';
          if (
            attempt.error.status === 409 ||
            resolvedErrorMessage.toLowerCase().includes('already exists')
          ) {
            return { success: true, ardaEntityId: 'already-exists' };
          }

          const tenantDetails = attempt.error.details as ArdaTenantResolutionDetails | undefined;
          return {
            success: false,
            error: tenantDetails?.message || resolvedErrorMessage || 'Failed to sync item',
          };
        }
        return {
          success: false,
          error: attempt.error instanceof Error ? attempt.error.message : 'Unknown sync error',
        };
      }

      const data = attempt.data;
      return {
        success: true,
        ardaEntityId: data?.record?.rId,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown sync error',
      };
    }
  }, [exportMasterListItemsFallback, resolveTenantForSync, uploadImage]);

  const syncSingleItem = useCallback(async (id: string): Promise<boolean> => {
    const item = items.find(entry => entry.id === id);
    if (!item) return false;

    setSyncStateById(prev => ({
      ...prev,
      [id]: { status: 'syncing' },
    }));

    const result = await syncItemToArda(item);

    if (result.success) {
      setSyncStateById(prev => ({
        ...prev,
        [id]: { status: 'success', ardaEntityId: result.ardaEntityId },
      }));
      setItems(prev => prev.map(entry => (
        entry.id === id ? { ...entry, needsAttention: false } : entry
      )));
      return true;
    }

    setSyncStateById(prev => ({
      ...prev,
      [id]: { status: 'error', error: result.error || 'Sync failed' },
    }));
    return false;
  }, [items, syncItemToArda]);

  const syncSelectedItems = useCallback(async () => {
    const selectedIds = Array.from(selectedItemIds);
    if (selectedIds.length === 0 || isBulkSyncing) return;

    setIsBulkSyncing(true);
    try {
      const selectedItems = items.filter(item => selectedIds.includes(item.id));
      const tenantReady = await ensureTenantForSync(selectedItems);
      if (!tenantReady) {
        selectedIds.forEach((id) => {
          setSyncStateById(prev => ({
            ...prev,
            [id]: { status: 'error', error: 'Tenant unresolved. Exported selected items to CSV.' },
          }));
        });
        return;
      }

      for (let i = 0; i < selectedIds.length; i += 1) {
        const id = selectedIds[i];
        await syncSingleItem(id);
        if (i < selectedIds.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    } finally {
      setIsBulkSyncing(false);
    }
  }, [ensureTenantForSync, isBulkSyncing, items, selectedItemIds, syncSingleItem]);

  const toggleItemSelected = useCallback((id: string) => {
    setSelectedItemIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleSelectAllFiltered = useCallback(() => {
    setSelectedItemIds(prev => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filteredIds.forEach(id => next.delete(id));
      } else {
        filteredIds.forEach(id => next.add(id));
      }
      return next;
    });
  }, [allFilteredSelected, filteredIds]);

  const getSourceIcon = (source: MasterListItem['source']) => {
    switch (source) {
      case 'email': return <Icons.Mail className="w-3 h-3" />;
      case 'url': return <Icons.Link className="w-3 h-3" />;
      case 'barcode': return <Icons.Barcode className="w-3 h-3" />;
      case 'photo': return <Icons.Camera className="w-3 h-3" />;
      case 'csv': return <Icons.FileSpreadsheet className="w-3 h-3" />;
    }
  };

  const handleComplete = useCallback(() => {
    onComplete(syncedItems);
  }, [onComplete, syncedItems]);

  const handleSyncSelected = useCallback(() => {
    void syncSelectedItems();
  }, [syncSelectedItems]);

  const updateFloatingCtaVisibility = useCallback(() => {
    const scrollEl = tableScrollRef.current;
    if (!scrollEl) return;
    const scrollable = scrollEl.scrollHeight - scrollEl.clientHeight > 8;
    const show = scrollable && scrollEl.scrollTop > 120;
    setShowFloatingCta(show);
  }, []);

  useEffect(() => {
    const scrollEl = tableScrollRef.current;
    if (!scrollEl) return undefined;

    const handleScroll = () => updateFloatingCtaVisibility();
    const handleResize = () => updateFloatingCtaVisibility();

    updateFloatingCtaVisibility();
    scrollEl.addEventListener('scroll', handleScroll);
    window.addEventListener('resize', handleResize);

    return () => {
      scrollEl.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
    };
  }, [filteredItems.length, updateFloatingCtaVisibility]);

  useEffect(() => {
    onFooterStateChange?.({
      selectedCount,
      syncedCount: syncedItems.length,
      canSyncSelected: selectedCount > 0 && !hasSyncInProgress,
      canComplete: !hasSyncInProgress,
      isSyncing: isBulkSyncing,
      onSyncSelected: handleSyncSelected,
      onComplete: handleComplete,
    });
  }, [
    handleComplete,
    handleSyncSelected,
    hasSyncInProgress,
    isBulkSyncing,
    onFooterStateChange,
    selectedCount,
    syncedItems.length,
  ]);

  return (
    <div className="space-y-4">
      <InstructionCard
        title="What to do"
        icon="ListChecks"
        steps={[
          'Review and edit item details.',
          'Select items and sync to Arda.',
          'Complete setup when ready.',
        ]}
      />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 text-sm">
          <span className="font-medium">{stats.total} items</span>
          <span className="text-green-600">{stats.synced} synced</span>
          {stats.errors > 0 && (
            <span className="text-red-600">{stats.errors} failed</span>
          )}
          {stats.needsAttention > 0 && (
            <span className="text-orange-600">{stats.needsAttention} need attention</span>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between bg-white rounded-lg border border-arda-border p-2">
        <div className="flex items-center gap-2">
          {(['all', 'needs_attention', 'synced', 'errors'] as const).map(f => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded text-sm ${filter === f ? 'bg-arda-accent text-white' : 'hover:bg-gray-100'}`}
            >
              {f === 'needs_attention'
                ? 'Needs Attention'
                : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
          <select
            value={sourceFilter}
            onChange={(event) => setSourceFilter(event.target.value as typeof sourceFilter)}
            className="ml-2 text-sm border border-arda-border rounded px-2 py-1 bg-white"
            aria-label="Filter by source"
          >
            <option value="all">All sources</option>
            <option value="email">Email ({sourceCounts.email})</option>
            <option value="url">URL ({sourceCounts.url})</option>
            <option value="barcode">Barcode ({sourceCounts.barcode})</option>
            <option value="photo">Photo ({sourceCounts.photo})</option>
            <option value="csv">CSV ({sourceCounts.csv})</option>
          </select>
        </div>
        <div className="relative">
          <Icons.Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 pr-3 py-1 text-sm border border-arda-border rounded focus:outline-none focus:ring-1 focus:ring-arda-accent"
          />
        </div>
      </div>

      <div className="bg-white rounded-lg border border-arda-border overflow-hidden">
        <div
          ref={tableScrollRef}
          data-testid="masterlist-table-scroll"
          className="overflow-auto max-h-[65vh]"
        >
          <table className="w-full min-w-[1400px] table-auto text-sm">
            <thead className="bg-gray-50 border-b border-arda-border sticky top-0 z-10">
              <tr>
                <th className="px-2 py-2 text-left font-medium text-gray-600 w-10">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleSelectAllFiltered}
                    aria-label="Select all visible items"
                    className="rounded border-gray-300 text-arda-accent focus:ring-arda-accent"
                  />
                </th>
                <th className="px-2 py-2 text-left font-medium text-gray-600 w-8"></th>
                <th className="px-2 py-2 text-left font-medium text-gray-600 w-10">Img</th>
                <th className="px-2 py-2 text-left font-medium text-gray-600 w-44">Name</th>
                <th className="px-2 py-2 text-left font-medium text-gray-600 w-28">Supplier</th>
                <th className="px-2 py-2 text-left font-medium text-gray-600 w-28">Order Method</th>
                <th className="px-2 py-2 text-left font-medium text-gray-600 w-20">Location</th>
                <th className="px-2 py-2 text-left font-medium text-gray-600 w-20">SKU</th>
                <th className="px-2 py-2 text-right font-medium text-gray-600 w-16">Min</th>
                <th className="px-2 py-2 text-right font-medium text-gray-600 w-16">Order</th>
                <th className="px-2 py-2 text-right font-medium text-gray-600 w-20">Price</th>
                <th className="px-2 py-2 text-left font-medium text-gray-600 w-24">Color</th>
                <th className="px-2 py-2 text-left font-medium text-gray-600 w-32">Image URL</th>
                <th className="px-2 py-2 text-left font-medium text-gray-600 w-32">Product URL</th>
                <th className="px-2 py-2 text-center font-medium text-gray-600 w-[110px]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredItems.map(item => {
                const imageUrl = item.imageUrl?.trim();
                const productHref = toExternalUrl(item.productUrl);
                const rowSyncState = syncStateById[item.id];
                const rowStatus = rowSyncState?.status ?? 'idle';

                const rowBackground = rowStatus === 'success'
                  ? 'bg-green-50'
                  : rowStatus === 'error'
                    ? 'bg-red-50'
                    : item.needsAttention
                      ? 'bg-orange-50'
                      : '';

                return (
                  <tr
                    key={item.id}
                    className={`hover:bg-gray-50 ${rowBackground}`}
                  >
                    <td className="px-2 py-1">
                      <input
                        type="checkbox"
                        checked={selectedItemIds.has(item.id)}
                        onChange={() => toggleItemSelected(item.id)}
                        aria-label={`Select ${item.name}`}
                        className="rounded border-gray-300 text-arda-accent focus:ring-arda-accent"
                      />
                    </td>

                    <td className="px-2 py-1">
                      <span className="p-1 rounded bg-gray-100 text-gray-500 inline-flex">
                        {getSourceIcon(item.source)}
                      </span>
                    </td>

                    <td className="px-2 py-1">
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt=""
                          className="w-8 h-8 rounded object-cover"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded bg-gray-100 flex items-center justify-center">
                          <Icons.Package className="w-4 h-4 text-gray-400" />
                        </div>
                      )}
                    </td>

                    <td className="px-1 py-1">
                      <EditableCell
                        value={item.name}
                        onChange={(v) => updateItem(item.id, 'name', v)}
                        placeholder="Item name"
                        className="truncate"
                      />
                    </td>

                    <td className="px-1 py-1">
                      <EditableCell
                        value={item.supplier}
                        onChange={(v) => updateItem(item.id, 'supplier', v)}
                        placeholder="Supplier"
                        className="truncate"
                      />
                    </td>

                    <td className="px-1 py-1">
                      <select
                        value={item.orderMethod}
                        onChange={(event) => updateItem(item.id, 'orderMethod', event.target.value as OrderMethod)}
                        className="w-full px-2 py-1 text-sm border border-arda-border rounded bg-white focus:outline-none focus:ring-1 focus:ring-arda-accent"
                        aria-label={`Order method for ${item.name}`}
                      >
                        {ORDER_METHOD_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td className="px-1 py-1">
                      <EditableCell
                        value={item.location}
                        onChange={(v) => updateItem(item.id, 'location', v)}
                        placeholder="Location"
                      />
                    </td>

                    <td className="px-1 py-1">
                      <EditableCell
                        value={item.sku}
                        onChange={(v) => updateItem(item.id, 'sku', v)}
                        placeholder="SKU"
                      />
                    </td>

                    <td className="px-1 py-1 text-right">
                      <EditableCell
                        value={item.minQty}
                        onChange={(v) => updateItem(item.id, 'minQty', v ? parseFloat(v) : undefined)}
                        type="number"
                        placeholder="0"
                        className="text-right"
                      />
                    </td>

                    <td className="px-1 py-1 text-right">
                      <EditableCell
                        value={item.orderQty}
                        onChange={(v) => updateItem(item.id, 'orderQty', v ? parseFloat(v) : undefined)}
                        type="number"
                        placeholder="0"
                        className="text-right"
                      />
                    </td>

                    <td className="px-1 py-1 text-right">
                      <EditableCell
                        value={item.unitPrice !== undefined ? item.unitPrice.toFixed(2) : ''}
                        onChange={(v) => updateItem(item.id, 'unitPrice', v ? parseFloat(v) : undefined)}
                        type="number"
                        placeholder="0.00"
                        className="text-right"
                      />
                    </td>

                    <td className="px-1 py-1">
                      <ColorPicker
                        value={item.color}
                        onChange={(v) => updateItem(item.id, 'color', v)}
                      />
                    </td>

                    <td className="px-1 py-1">
                      <div className="space-y-1">
                        {imageUrl && (
                          <div className="px-2 py-1 flex items-center gap-2">
                            <img
                              src={imageUrl}
                              alt={`${item.name} preview`}
                              className="w-14 h-14 rounded border border-arda-border object-cover bg-gray-50"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                              }}
                            />
                          </div>
                        )}
                        <EditableCell
                          value={item.imageUrl}
                          onChange={(v) => updateItem(item.id, 'imageUrl', v || undefined)}
                          placeholder="https://..."
                          className="w-full text-xs text-gray-700 truncate border border-gray-300 rounded bg-white hover:bg-white max-w-[140px]"
                        />
                      </div>
                    </td>

                    <td className="px-1 py-1">
                      <div className="space-y-1">
                        <button
                          type="button"
                          onClick={() => {
                            if (!productHref) return;
                            window.open(productHref, '_blank', 'noopener,noreferrer');
                          }}
                          disabled={!productHref}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-blue-700 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-blue-200 disabled:border-blue-200 disabled:text-blue-500"
                        >
                          Open product
                          <Icons.ExternalLink className="w-3 h-3" />
                        </button>
                        <EditableCell
                          value={item.productUrl}
                          onChange={(v) => updateItem(item.id, 'productUrl', v || undefined)}
                          placeholder="https://..."
                          className="w-full text-xs text-gray-700 truncate border border-gray-300 rounded bg-white hover:bg-white max-w-[140px]"
                        />
                      </div>
                    </td>

                    <td className="px-2 py-1">
                      <div className="flex flex-col items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void syncSingleItem(item.id)}
                          disabled={isBulkSyncing || rowStatus === 'syncing'}
                          className="inline-flex items-center justify-center gap-1 px-2 py-1 text-xs rounded border border-green-700 bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-green-200 disabled:border-green-200 disabled:text-green-500 w-full"
                          title={rowStatus === 'success' ? 'Resync item' : 'Sync item'}
                        >
                          {rowStatus === 'syncing' ? (
                            <Icons.Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Icons.Upload className="w-3 h-3" />
                          )}
                          {rowStatus === 'success' ? 'Resync' : rowStatus === 'syncing' ? 'Syncing' : 'Sync'}
                        </button>
                        {rowStatus === 'success' && (
                          <span className="text-[11px] text-green-700 inline-flex items-center gap-1">
                            <Icons.CheckCircle2 className="w-3 h-3" />
                            Synced
                          </span>
                        )}
                        {rowStatus === 'error' && (
                          <span className="text-[11px] text-red-700 inline-flex items-center gap-1 text-center">
                            <Icons.AlertTriangle className="w-3 h-3 shrink-0" />
                            {rowSyncState?.error || 'Sync failed'}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => removeItem(item.id)}
                          className="inline-flex items-center justify-center gap-1 px-2 py-1 text-xs rounded border border-red-700 bg-red-600 text-white hover:bg-red-700 w-full"
                          title="Remove"
                        >
                          <Icons.Trash2 className="w-4 h-4" />
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filteredItems.length === 0 && (
          <div className="p-8 text-center text-gray-500">
            <Icons.Package className="w-10 h-10 mx-auto mb-2 opacity-50" />
            <p>No items to display</p>
          </div>
        )}
      </div>

      {showFloatingCta && (
        <div
          data-testid="masterlist-floating-cta"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 md:left-auto md:right-6 md:translate-x-0 z-40"
        >
          <div className="arda-glass rounded-2xl px-4 py-3 shadow-arda-lg flex items-center gap-2">
            <button
              type="button"
              onClick={handleSyncSelected}
              disabled={!selectedCount || hasSyncInProgress}
              className="btn-arda-outline text-sm py-1.5 flex items-center gap-2 disabled:opacity-50"
            >
              {isBulkSyncing ? (
                <Icons.Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Icons.Upload className="w-4 h-4" />
              )}
              Sync Selected ({selectedCount})
            </button>
            <button
              type="button"
              onClick={handleComplete}
              disabled={hasSyncInProgress}
              className={[
                'flex items-center gap-2 px-4 py-2 rounded-arda font-semibold text-sm transition-colors',
                !hasSyncInProgress
                  ? 'bg-arda-accent text-white hover:bg-arda-accent-hover'
                  : 'bg-arda-border text-arda-text-muted cursor-not-allowed',
              ].join(' ')}
            >
              <Icons.ArrowRight className="w-4 h-4" />
              Complete setup ({syncedItems.length} synced)
            </button>
          </div>
        </div>
      )}

      <div className="text-xs text-gray-400 text-center">
        Click any cell to edit. Press Enter to save, Escape to cancel.
      </div>
    </div>
  );
};
