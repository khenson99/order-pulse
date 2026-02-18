export type IntegrationProvider = 'quickbooks' | 'xero';

export type ConnectionStatus = 'connected' | 'reauth_required' | 'error' | 'disconnected';

export type SyncTrigger = 'manual' | 'scheduled' | 'webhook' | 'backfill';

export type SyncRunStatus = 'running' | 'success' | 'failed';

export interface CanonicalLineItem {
  externalLineId: string;
  name: string;
  quantity: number;
  unit?: string;
  unitPrice?: number;
  totalPrice?: number;
  sku?: string;
  itemCode?: string;
}

export interface CanonicalPurchaseOrder {
  externalId: string;
  externalNumber: string;
  supplier: string;
  orderDate?: string;
  status: string;
  totalAmount?: number;
  updatedAt?: string;
  items: CanonicalLineItem[];
  raw: Record<string, unknown>;
}

export interface ProviderConnection {
  id: string;
  userId: string;
  provider: IntegrationProvider;
  tenantId: string;
  tenantName?: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string;
  tokenExpiresAt: Date;
  scope?: string;
  status: ConnectionStatus;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProviderSyncState {
  connectionId: string;
  backfillStartedAt?: Date;
  backfillCompletedAt?: Date;
  lastCursorUtc?: Date;
  cursorPayload?: Record<string, unknown>;
  lastSuccessfulSyncAt?: Date;
  lastError?: string;
  updatedAt: Date;
}

export interface ProviderSyncRun {
  id: string;
  connectionId: string;
  trigger: SyncTrigger;
  status: SyncRunStatus;
  ordersUpserted: number;
  ordersDeleted: number;
  itemsUpserted: number;
  apiCalls: number;
  startedAt: Date;
  finishedAt?: Date;
  error?: string;
}

export interface SyncRunCounters {
  ordersUpserted: number;
  ordersDeleted: number;
  itemsUpserted: number;
  apiCalls: number;
}

export interface SyncRunSummary extends ProviderSyncRun {
  provider: IntegrationProvider;
  tenantId: string;
  tenantName?: string;
}

export interface IntegrationConnectionSummary {
  id: string;
  provider: IntegrationProvider;
  tenantId: string;
  tenantName?: string;
  status: ConnectionStatus;
  tokenExpiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  lastRun?: {
    id: string;
    status: SyncRunStatus;
    trigger: SyncTrigger;
    startedAt: Date;
    finishedAt?: Date;
    error?: string;
  };
}
