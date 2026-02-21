// API client for backend communication
// Production defaults to same-origin so Vercel rewrites keep session cookies first-party.
const DEFAULT_DEV_API_BASE_URL = 'http://localhost:3001';
const DEFAULT_ARDA_APP_URL = 'https://live.app.arda.cards';
const DEFAULT_ARDA_APP_URL_TEMPLATE = `${DEFAULT_ARDA_APP_URL}/?tenantId={tenantId}`;
const SESSION_EXPIRED_MESSAGE = 'Session expired. Please sign in again.';
export const SESSION_EXPIRED_EVENT = 'orderpulse:session-expired';

interface ApiBaseUrlConfig {
  viteApiUrl?: string;
  isProd: boolean;
}

export function normalizeApiBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  return trimmed.replace(/\/+$/, '');
}

export function resolveApiBaseUrl({ viteApiUrl, isProd }: ApiBaseUrlConfig): string {
  if (viteApiUrl !== undefined) {
    return normalizeApiBaseUrl(viteApiUrl);
  }
  return isProd ? '' : DEFAULT_DEV_API_BASE_URL;
}

const API_BASE_URL = resolveApiBaseUrl({
  viteApiUrl: import.meta.env.VITE_API_URL as string | undefined,
  isProd: import.meta.env.PROD,
});

export function buildArdaOpenUrl(
  tenantId: string | null | undefined,
  options?: { appUrl?: string; appUrlTemplate?: string },
): string {
  const appUrl = normalizeApiBaseUrl(
    options?.appUrl ?? (import.meta.env.VITE_ARDA_APP_URL as string | undefined) ?? DEFAULT_ARDA_APP_URL,
  );
  const appUrlTemplate = (
    options?.appUrlTemplate ??
    (import.meta.env.VITE_ARDA_APP_URL_TEMPLATE as string | undefined) ??
    DEFAULT_ARDA_APP_URL_TEMPLATE
  ).trim();

  if (!tenantId || !appUrlTemplate.includes('{tenantId}')) {
    return appUrl;
  }

  return appUrlTemplate.replaceAll('{tenantId}', encodeURIComponent(tenantId));
}

interface ApiError {
  error: string;
  code?: string;
  details?: unknown;
}

export class SessionExpiredError extends Error {
  constructor(message = SESSION_EXPIRED_MESSAGE) {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

export class ApiRequestError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function isSessionExpiredError(error: unknown): error is SessionExpiredError {
  return error instanceof SessionExpiredError;
}

export function isApiRequestError(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError;
}

let hasNotifiedSessionExpired = false;

function notifySessionExpired(): void {
  if (hasNotifiedSessionExpired) return;
  hasNotifiedSessionExpired = true;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
  }
}

// Test helper for deterministic assertions.
export function resetSessionExpiredSignalForTests(): void {
  hasNotifiedSessionExpired = false;
}

async function fetchApi<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    credentials: 'include', // Include cookies for session
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error: ApiError = await response.json().catch(() => ({ error: 'Request failed' }));
    if (response.status === 401) {
      notifySessionExpired();
      throw new SessionExpiredError();
    }
    throw new ApiRequestError(
      error.error || `HTTP ${response.status}`,
      response.status,
      error.code,
      error.details
    );
  }

  return response.json();
}

// Auth API
export const authApi = {
  getLoginUrl: () => `${API_BASE_URL}/auth/google`,

  login: (email: string, password: string) =>
    fetchApi<{ success: boolean; user: { id: string; email: string; name: string; picture_url: string } }>(
      '/auth/local/login',
      {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }
    ),

  signup: (email: string, password: string, name?: string) =>
    fetchApi<{ success: boolean; user: { id: string; email: string; name: string; picture_url: string } }>(
      '/auth/local/signup',
      {
        method: 'POST',
        body: JSON.stringify({ email, password, name }),
      }
    ),
  
  getCurrentUser: () => fetchApi<{ user: { id: string; email: string; name: string; picture_url: string } }>('/auth/me'),
  
  // Exchange short-lived auth token for session (used after OAuth redirect)
  exchangeToken: (token: string) => fetchApi<{ success: boolean; user: { id: string; email: string; name: string; picture_url: string } }>(`/auth/token-exchange?token=${token}`),
  
  logout: () => fetchApi<{ success: boolean }>('/auth/logout', { method: 'POST' }),
};

// Gmail API
export interface GmailMessage {
  id: string;
  subject: string;
  sender: string;
  date: string;
  snippet: string;
  body: string;
}

export const gmailApi = {
  getMessages: (query?: string, maxResults?: number) => 
    fetchApi<{ messages: GmailMessage[]; total: number }>(
      `/api/gmail/messages?q=${encodeURIComponent(query || '')}&maxResults=${maxResults || 10}`
    ),

  getStatus: () =>
    fetchApi<{ connected: boolean; gmailEmail?: string | null }>('/api/gmail/status'),
  
  sendEmail: (to: string, subject: string, body: string) =>
    fetchApi<{ success: boolean; messageId: string }>('/api/gmail/send', {
      method: 'POST',
      body: JSON.stringify({ to, subject, body }),
    }),
};

// Analysis API
export interface AnalysisResult {
  emailId: string;
  isOrder: boolean;
  supplier: string | null;
  orderDate: string | null;
  totalAmount: number | null;
  items: Array<{
    name: string;
    quantity: number;
    unit: string;
    unitPrice: number | null;
    totalPrice: number | null;
  }>;
  confidence: number;
}

export const analysisApi = {
  analyzeEmails: (emails: Array<{ id: string; subject: string; sender: string; body: string }>) =>
    fetchApi<{ results: AnalysisResult[] }>('/api/analyze', {
      method: 'POST',
      body: JSON.stringify({ emails }),
    }),
};

// Discover API
export interface DiscoveredSupplier {
  domain: string;
  displayName: string;
  emailCount: number;
  score: number;
  category: 'industrial' | 'retail' | 'office' | 'food' | 'electronics' | 'unknown';
  sampleSubjects: string[];
  isRecommended: boolean;
}

export const discoverApi = {
  discoverSuppliers: () => fetchApi<{ suppliers: DiscoveredSupplier[] }>('/api/discover/discover-suppliers'),
  
  startJobWithFilter: (supplierDomains?: string[]) =>
    fetchApi<{ jobId: string; status: string; message: string }>('/api/jobs/start', {
      method: 'POST',
      body: JSON.stringify({ supplierDomains }),
    }),
};

// Jobs API - Background processing with polling
export interface JobProgress {
  total: number;
  processed: number;
  success: number;
  failed: number;
  currentTask: string;
}

export interface JobEmailPreview {
  id: string;
  subject: string;
  sender: string;
  snippet?: string;
}

export interface JobOrder {
  id: string;
  supplier: string;
  orderDate: string;
  totalAmount: number;
  items: Array<{
    id: string;
    name: string;
    quantity: number;
    unit: string;
    unitPrice: number;
  }>;
  confidence: number;
}

export interface JobStatus {
  hasJob: boolean;
  jobId?: string;
  status?: 'pending' | 'running' | 'completed' | 'failed';
  progress?: JobProgress;
  currentEmail?: JobEmailPreview | null;
  orders?: JobOrder[];
  logs?: string[];
  error?: string;
  message?: string;
}

export const jobsApi = {
  // Start Amazon-first processing immediately
  startAmazon: () =>
    fetchApi<{ jobId: string }>('/api/jobs/start-amazon', {
      method: 'POST',
    }),
  
  // Start processing for selected suppliers
  startJob: (supplierDomains?: string[], jobType?: string) =>
    fetchApi<{ jobId: string }>('/api/jobs/start', {
      method: 'POST',
      body: JSON.stringify({ supplierDomains, jobType }),
    }),
  
  getStatus: (jobId?: string) =>
    fetchApi<JobStatus>(`/api/jobs/status${jobId ? `?jobId=${jobId}` : ''}`),
  
  getJob: (jobId: string) =>
    fetchApi<JobStatus>(`/api/jobs/${jobId}`),
};

export interface UrlScrapedItem {
  sourceUrl: string;
  productUrl?: string;
  imageUrl?: string;
  itemName?: string;
  supplier?: string;
  price?: number;
  currency?: string;
  description?: string;
  vendorSku?: string;
  asin?: string;
  needsReview: boolean;
  extractionSource: 'amazon-paapi' | 'html-metadata' | 'hybrid-ai' | 'error';
  confidence: number;
}

export interface UrlScrapeResult {
  sourceUrl: string;
  normalizedUrl?: string;
  status: 'success' | 'partial' | 'failed';
  message?: string;
  extractionSource: UrlScrapedItem['extractionSource'];
  item: UrlScrapedItem;
}

export interface UrlScrapeResponse {
  requested: number;
  processed: number;
  results: UrlScrapeResult[];
  items: UrlScrapedItem[];
}

export const urlIngestionApi = {
  scrapeUrls: (urls: string[]) =>
    fetchApi<UrlScrapeResponse>('/api/url-ingestion/scrape', {
      method: 'POST',
      body: JSON.stringify({ urls }),
    }),
};

// Amazon API
export interface AmazonItemData {
  ASIN: string;
  ItemName?: string;
  Price?: string;
  ImageURL?: string;
  AmazonURL?: string;
  Quantity?: string;
  Units?: string;
  UnitCount?: number;
  UnitPrice?: number;
  UPC?: string;
}

export const amazonApi = {
  getItem: (asin: string) =>
    fetchApi<{ item: AmazonItemData }>(`/api/amazon/item/${asin}`),
  
  getItems: (asins: string[]) =>
    fetchApi<{ items: Record<string, AmazonItemData>; requested: number; found: number }>('/api/amazon/items', {
      method: 'POST',
      body: JSON.stringify({ asins }),
    }),
    
  extractAsins: (text: string, subject?: string) =>
    fetchApi<{ asins: string[] }>('/api/amazon/extract-asins', {
      method: 'POST',
      body: JSON.stringify({ text, subject }),
    }),
};

// Orders API
export interface Order {
  id: string;
  user_id: string;
  original_email_id: string;
  supplier: string;
  order_date: string;
  total_amount: number;
  confidence: number;
  items: Array<{
    id: string;
    name: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    totalPrice: number;
  }>;
}

export interface InventoryItem {
  name: string;
  totalQuantityOrdered: number;
  orderCount: number;
  firstOrderDate: string;
  lastOrderDate: string;
  averageCadenceDays: number;
  dailyBurnRate: number;
  recommendedMin: number;
  recommendedOrderQty: number;
  lastPrice: number;
  suppliers: string;
  location?: string;
  imageUrl?: string;
  productUrl?: string;
  asin?: string;
}

export const ordersApi = {
  getOrders: () => fetchApi<{ orders: Order[] }>('/api/orders'),
  
  saveOrders: (orders: Order[]) =>
    fetchApi<{ success: boolean; orders: Order[] }>('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ orders }),
    }),
  
  getInventory: () => fetchApi<{ inventory: InventoryItem[] }>('/api/orders/inventory'),
  
  deleteOrder: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/orders/${id}`, { method: 'DELETE' }),
};

export type IntegrationProvider = 'quickbooks' | 'xero';
export type IntegrationConnectionStatus = 'connected' | 'reauth_required' | 'error' | 'disconnected';
export type IntegrationSyncTrigger = 'manual' | 'scheduled' | 'webhook' | 'backfill';
export type IntegrationSyncStatus = 'running' | 'success' | 'failed';

export interface IntegrationConnection {
  id: string;
  provider: IntegrationProvider;
  tenantId: string;
  tenantName?: string;
  status: IntegrationConnectionStatus;
  tokenExpiresAt: string;
  createdAt: string;
  updatedAt: string;
  lastRun?: {
    id: string;
    status: IntegrationSyncStatus;
    trigger: IntegrationSyncTrigger;
    startedAt: string;
    finishedAt?: string;
    error?: string;
  };
}

export interface IntegrationSyncRun {
  id: string;
  connectionId: string;
  trigger: IntegrationSyncTrigger;
  status: IntegrationSyncStatus;
  ordersUpserted: number;
  ordersDeleted: number;
  itemsUpserted: number;
  apiCalls: number;
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

export const integrationsApi = {
  connectProvider: (provider: IntegrationProvider) =>
    fetchApi<{ authUrl: string }>(`/api/integrations/${provider}/connect`, {
      method: 'POST',
    }),

  listConnections: () =>
    fetchApi<{ connections: IntegrationConnection[] }>('/api/integrations/connections'),

  disconnectConnection: (connectionId: string) =>
    fetchApi<{ success: boolean }>(`/api/integrations/connections/${connectionId}`, {
      method: 'DELETE',
    }),

  syncConnection: (connectionId: string) =>
    fetchApi<{ success: boolean; runId: string }>(`/api/integrations/connections/${connectionId}/sync`, {
      method: 'POST',
    }),

  getConnectionRuns: (connectionId: string) =>
    fetchApi<{ runs: IntegrationSyncRun[] }>(`/api/integrations/connections/${connectionId}/runs`),
};

export { API_BASE_URL };

// Arda API
export interface ArdaItemInput {
  name: string;
  description?: string;
  orderMechanism?: string;
  minQty?: number;
  minQtyUnit?: string;
  primarySupplier: string;
  location?: string;
  orderQty?: number;
  orderQtyUnit?: string;
  primarySupplierLink?: string;
  imageUrl?: string;
  sku?: string;
  barcode?: string;
  unitPrice?: number;
}

export interface ArdaKanbanCardInput {
  item: {
    itemId: string;
    itemName: string;
  };
  quantity: {
    value: number;
    unit: string;
  };
  locator?: {
    facility: string;
    location?: string;
  };
  seedStatus?: string;
  notes?: string;
}

export interface ArdaOrderInput {
  orderDate?: string;
  supplier?: string;
  supplierName?: string;
  allowPartial?: boolean;
  expedite?: boolean;
  deliverBy?: string;
  notes?: string;
  taxesAndFees?: Record<string, { value: number; currency: string }>;
}

export interface ArdaEntityRecord {
  rId: string;
  asOf: { effective: number; recorded: number };
  payload: unknown;
  metadata: unknown;
  retired: boolean;
}

export interface ArdaItemVelocityProfileInput {
  displayName: string;
  supplier: string;
  dailyBurnRate: number;
  averageCadenceDays: number;
  recommendedMin: number;
  recommendedOrderQty: number;
  unit?: string;
  location?: string;
  primarySupplierLink?: string;
  imageUrl?: string;
}

export interface ArdaVelocitySyncResult {
  displayName: string;
  success: boolean;
  itemId?: string;
  error?: string;
}

export interface ArdaTenantSuggestion {
  tenantId: string;
  matchedEmail: string;
  domain: string;
  matchCount: number;
}

export interface ArdaTenantResolutionDetails {
  email?: string;
  message?: string;
  authorFound?: boolean;
  tenantIdFound?: boolean;
  canUseSuggestedTenant?: boolean;
  canCreateTenant?: boolean;
  suggestedTenant?: ArdaTenantSuggestion | null;
  tenantId?: string;
  autoProvisionAttempted?: boolean;
  autoProvisionSucceeded?: boolean;
  autoProvisionError?: string;
  resolutionMode?: 'mapped' | 'provisioned' | 'override' | 'unresolved';
}

export interface ArdaSyncStatusEvent {
  id: string;
  operation: string;
  success: boolean;
  requested: number;
  successful: number;
  failed: number;
  timestamp: string;
  error?: string;
  email?: string;
  tenantId?: string;
}

export interface ArdaSyncStatusResponse {
  success: boolean;
  message: string;
  user: string;
  ardaConfigured: boolean;
  totalAttempts: number;
  successfulAttempts: number;
  failedAttempts: number;
  totalRequested: number;
  totalSuccessful: number;
  totalFailed: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  recent: ArdaSyncStatusEvent[];
  updatedAt: string;
  timestamp: string;
}

export interface ArdaSyncedTenantContext {
  tenantId: string;
  email?: string;
  timestamp: string;
}

export function getLastSuccessfulSyncTenant(
  syncStatus: Pick<ArdaSyncStatusResponse, 'recent'> | null | undefined,
): ArdaSyncedTenantContext | null {
  const recentEvents = syncStatus?.recent ?? [];
  for (const event of recentEvents) {
    if (event.success && event.tenantId) {
      return {
        tenantId: event.tenantId,
        email: event.email,
        timestamp: event.timestamp,
      };
    }
  }
  return null;
}

export const ardaApi = {
  // Check if Arda is configured
  getStatus: () => fetchApi<{ configured: boolean; message: string }>('/api/arda/status'),

  // Create item in Arda
  createItem: (item: ArdaItemInput) =>
    fetchApi<{ success: boolean; record: ArdaEntityRecord }>('/api/arda/items', {
      method: 'POST',
      body: JSON.stringify(item),
    }),

  // Bulk create items
  bulkCreateItems: (items: ArdaItemInput[]) =>
    fetchApi<{
      success: boolean;
      code?: string;
      error?: string;
      details?: ArdaTenantResolutionDetails;
      summary?: { total: number; successful: number; failed: number };
      results?: Array<{ item: string; status: string; error?: string }>;
    }>('/api/arda/items/bulk', {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),

  resolveTenant: (action: 'create_new' | 'use_suggested') =>
    fetchApi<{ success: boolean; tenantId?: string; author?: string; error?: string }>('/api/arda/tenant/resolve', {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),

  getTenantStatus: () =>
    fetchApi<{
      success: boolean;
      resolved: boolean;
      code?: string;
      error?: string;
      details?: ArdaTenantResolutionDetails;
    }>('/api/arda/tenant/status'),

  getSyncStatus: () => fetchApi<ArdaSyncStatusResponse>('/api/arda/sync-status'),

  // Create Kanban card
  createKanbanCard: (card: ArdaKanbanCardInput) =>
    fetchApi<{ success: boolean; record: ArdaEntityRecord }>('/api/arda/kanban-cards', {
      method: 'POST',
      body: JSON.stringify(card),
    }),

  // Create order
  createOrder: (order: ArdaOrderInput) =>
    fetchApi<{ success: boolean; record: ArdaEntityRecord }>('/api/arda/orders', {
      method: 'POST',
      body: JSON.stringify(order),
    }),

  // Push velocity items to Arda
  pushVelocityItems: (items: ArdaItemVelocityProfileInput[]) =>
    fetchApi<{
      success: boolean;
      summary: { total: number; successful: number; failed: number };
      results: ArdaVelocitySyncResult[];
    }>('/api/arda/push-velocity', {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),
};
