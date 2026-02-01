// API client for backend communication
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface ApiError {
  error: string;
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
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// Auth API
export const authApi = {
  getLoginUrl: () => `${API_BASE_URL}/auth/google`,
  
  getCurrentUser: () => fetchApi<{ user: { id: string; email: string; name: string; picture_url: string } }>('/auth/me'),
  
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
  discoverSuppliers: async (): Promise<{ suppliers: DiscoveredSupplier[] }> => {
    const response = await fetch(`${API_BASE_URL}/api/discover/discover-suppliers`, {
      credentials: 'include',
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMsg = errorData.error || `HTTP ${response.status}`;
      throw new Error(errorMsg);
    }
    return response.json();
  },
  
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
  startJob: async (supplierDomain?: string): Promise<{ jobId: string }> => {
    const url = supplierDomain 
      ? `${API_BASE_URL}/api/jobs/start?supplier=${encodeURIComponent(supplierDomain)}`
      : `${API_BASE_URL}/api/jobs/start`;
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) {
      const error: ApiError = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }
    return response.json();
  },
  
  getStatus: (jobId?: string) =>
    fetchApi<JobStatus>(`/api/jobs/status${jobId ? `?jobId=${jobId}` : ''}`),
  
  getJob: (jobId: string) =>
    fetchApi<JobStatus>(`/api/jobs/${jobId}`),
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
}

export const ordersApi = {
  getOrders: () => fetchApi<{ orders: Order[] }>('/api/orders'),
  
  saveOrders: (orders: any[]) =>
    fetchApi<{ success: boolean; orders: Order[] }>('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ orders }),
    }),
  
  getInventory: () => fetchApi<{ inventory: InventoryItem[] }>('/api/orders/inventory'),
  
  deleteOrder: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/orders/${id}`, { method: 'DELETE' }),
};

export { API_BASE_URL };

// Arda API
export interface ArdaItemInput {
  name: string;
  orderMechanism?: string;
  minQty?: number;
  minQtyUnit?: string;
  primarySupplier: string;
  location?: string;
  orderQty?: number;
  orderQtyUnit?: string;
  primarySupplierLink?: string;
  imageUrl?: string;
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
      error?: string;
      details?: { email?: string; message?: string; authorFound?: boolean; tenantIdFound?: boolean };
      summary?: { total: number; successful: number; failed: number };
      results?: Array<{ item: string; status: string; error?: string }>;
    }>('/api/arda/items/bulk', {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),

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
