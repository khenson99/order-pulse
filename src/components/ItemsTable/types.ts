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

export const ORDER_METHOD_OPTIONS: Array<{ value: OrderMethod; label: string }> = [
  { value: 'online', label: 'Online' },
  { value: 'purchase_order', label: 'Purchase Order' },
  { value: 'production', label: 'Production' },
  { value: 'shopping', label: 'Shopping' },
  { value: 'email', label: 'Email' },
];

export const DEFAULT_ORDER_METHOD_BY_SOURCE: Record<MasterListItem['source'], OrderMethod> = {
  email: 'online',
  url: 'online',
  barcode: 'shopping',
  photo: 'production',
  csv: 'purchase_order',
};

export type RowSyncStatus = 'idle' | 'syncing' | 'success' | 'error';

export interface RowSyncState {
  status: RowSyncStatus;
  ardaEntityId?: string;
  error?: string;
}

export interface SyncResult {
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

export interface EmailItem {
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
