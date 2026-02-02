// Arda API Service - Integration with prod.alpha001.io.arda.cards
import { v4 as uuidv4 } from 'uuid';

const ARDA_BASE_URL = process.env.ARDA_BASE_URL || 'https://prod.alpha001.io.arda.cards';
const ARDA_API_KEY = process.env.ARDA_API_KEY;
const ARDA_TENANT_ID = process.env.ARDA_TENANT_ID;

// Cache for tenant lookups (reserved for future use)
// const tenantCache = new Map<string, string>();

// Types based on Arda OpenAPI schemas (matching actual API structure)
export interface QuantityValue {
  amount: number;
  unit: string;
}

export interface ItemSupplyValue {
  supplier: string;
  name?: string;
  sku?: string;
  orderMethod?: 'EMAIL' | 'MANUAL' | 'AUTO' | 'FAX' | 'PHONE' | 'WEB' | 'EDI';
  url?: string;
  orderQuantity?: QuantityValue;
  unitCost?: { value: number; currency: string };
}

export interface PhysicalLocatorValue {
  facility: string;
  department?: string;
  location?: string;
  subLocation?: string;
}

export type ItemColor = 'BLUE' | 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' | 'PINK' | 'PURPLE' | 'GRAY';

// Arda Item.Entity structure
export interface ArdaItemEntity {
  eId: string;
  name: string;
  description?: string;
  imageUrl?: string;
  locator?: PhysicalLocatorValue;
  internalSKU?: string;
  minQuantity?: QuantityValue;
  notes?: string;
  primarySupply?: ItemSupplyValue;
  itemColor?: ItemColor;
}

// Our simplified input that gets mapped to Arda format
export interface ItemInput {
  name: string;
  primarySupplier: string;
  orderMechanism?: string;
  location?: string;
  minQty?: number;
  minQtyUnit?: string;
  orderQty?: number;
  orderQtyUnit?: string;
  primarySupplierLink?: string;
  imageUrl?: string;
  sku?: string;
  color?: string;
}

export interface ItemInputMetadata {
  tenantId: string;
}

export interface ItemCreateRequest {
  payload: ItemInput;
  metadata: ItemInputMetadata;
  effectiveAt: number;
  author: string;
}

export interface KanbanCardInput {
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
  seedStatus?: 'AVAILABLE' | 'REQUESTED' | 'IN_PROCESS' | 'READY' | 'FULFILLING' | 'FULFILLED' | 'IN_USE' | 'DEPLETED' | 'REQUESTING' | 'UNKNOWN';
  notes?: string;
}

export interface OrderHeaderInput {
  orderDate: { utcTimestamp: number };
  allowPartial: boolean;
  expedite: boolean;
  deliverBy?: { utcTimestamp: number };
  supplierName?: string;
  notes?: string;
  taxesAndFees: Record<string, { value: number; currency: string }>;
}

export interface EntityRecord {
  rId: string;
  asOf: { effective: number; recorded: number };
  payload: unknown;
  metadata: unknown;
  previous?: string;
  retired: boolean;
}

// PageResult interface available for paginated API calls
// interface PageResult {
//   thisPage: string;
//   nextPage: string;
//   results: UserAccountRecord[];
//   totalCount?: number;
// }

interface ArdaError {
  responseMessage: string;
  code: number;
  details?: unknown;
}

// Helper to make Arda API calls
async function ardaFetch<T>(
  endpoint: string,
  options: {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    body?: unknown;
    author: string;
    effectiveAsOf?: number;
    tenantId?: string;
  }
): Promise<T> {
  if (!ARDA_API_KEY) {
    throw new Error('ARDA_API_KEY environment variable not set');
  }

  const effectiveAsOf = options.effectiveAsOf || Date.now();
  const url = `${ARDA_BASE_URL}${endpoint}?effectiveasof=${effectiveAsOf}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${ARDA_API_KEY}`,
    'X-Author': options.author,
    'X-Request-ID': uuidv4(),
  };

  // Add tenant header if provided (required for some endpoints)
  if (options.tenantId) {
    headers['X-Tenant-Id'] = options.tenantId;
  }

  const response = await fetch(url, {
    method: options.method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    let errorData: ArdaError;
    try {
      errorData = await response.json() as ArdaError;
    } catch {
      errorData = {
        responseMessage: `HTTP ${response.status}`,
        code: response.status,
      };
    }
    throw new Error(`Arda API Error: ${errorData.responseMessage} (${errorData.code})`);
  }

  const data = await response.json() as T;
  return data;
}

// Look up tenant ID from user email via Cognito user cache
// Now uses the local Cognito users file synced from GitHub workflow
import { cognitoService } from './cognito.js';

export async function getTenantByEmail(email: string): Promise<string | null> {
  const user = cognitoService.getUserByEmail(email);
  if (user?.tenantId) {
    console.log(`🔑 Found tenant ID for ${email}: ${user.tenantId}`);
    return user.tenantId;
  }
  console.log(`⚠️ No tenant found for ${email} in Cognito cache`);
  return null;
}

// Get tenant ID - from env, or look up from Cognito cache
async function resolveTenantId(author: string): Promise<string> {
  // First priority: environment variable
  if (ARDA_TENANT_ID && ARDA_TENANT_ID !== 'your_tenant_uuid_here') {
    return ARDA_TENANT_ID;
  }

  // Second: try Cognito lookup
  const cognitoTenant = await getTenantByEmail(author);
  if (cognitoTenant) {
    return cognitoTenant;
  }

  // Check if we're in mock mode
  if (process.env.ARDA_MOCK_MODE === 'true') {
    return 'mock-tenant-id';
  }

  throw new Error(
    `ARDA_TENANT_ID not configured and no tenant found for ${author}. ` +
    'Please set ARDA_TENANT_ID in .env or ensure user is in Cognito.'
  );
}

// Check if mock mode is enabled
export function isMockMode(): boolean {
  return process.env.ARDA_MOCK_MODE === 'true' || 
         (!ARDA_API_KEY || !ARDA_TENANT_ID || ARDA_TENANT_ID === 'your_tenant_uuid_here');
}

// Map color string to Arda ItemColor enum
function mapToArdaColor(color?: string): ItemColor | undefined {
  if (!color) return undefined;
  const colorMap: Record<string, ItemColor> = {
    'blue': 'BLUE',
    'green': 'GREEN',
    'yellow': 'YELLOW',
    'orange': 'ORANGE',
    'red': 'RED',
    'pink': 'PINK',
    'purple': 'PURPLE',
    'gray': 'GRAY',
    'grey': 'GRAY',
  };
  return colorMap[color.toLowerCase()] || undefined;
}

// Map order mechanism to Arda OrderMethod enum
function mapToArdaOrderMethod(mechanism?: string): ItemSupplyValue['orderMethod'] {
  if (!mechanism) return 'EMAIL';
  const methodMap: Record<string, ItemSupplyValue['orderMethod']> = {
    'email': 'EMAIL',
    'manual': 'MANUAL',
    'auto': 'AUTO',
    'fax': 'FAX',
    'phone': 'PHONE',
    'web': 'WEB',
    'edi': 'EDI',
  };
  return methodMap[mechanism.toLowerCase()] || 'EMAIL';
}

// Create an item in Arda's Item Data Authority
// Maps our simplified ItemInput to Arda's Item.Entity schema
export async function createItem(
  item: ItemInput,
  author: string
): Promise<EntityRecord> {
  const tenantId = await resolveTenantId(author);

  // Build Arda Item.Entity structure
  const ardaItem: ArdaItemEntity = {
    eId: uuidv4(),
    name: item.name,
    imageUrl: item.imageUrl || undefined,
    internalSKU: item.sku || undefined,
    itemColor: mapToArdaColor(item.color),
  };

  // Add minQuantity if provided
  if (item.minQty) {
    ardaItem.minQuantity = {
      amount: item.minQty,
      unit: item.minQtyUnit || 'each',
    };
  }

  // Add locator if location provided
  if (item.location) {
    ardaItem.locator = {
      facility: 'Main', // Default facility
      location: item.location,
    };
  }

  // Add primarySupply
  ardaItem.primarySupply = {
    supplier: item.primarySupplier,
    orderMethod: mapToArdaOrderMethod(item.orderMechanism),
    url: item.primarySupplierLink || undefined,
  };

  // Add orderQuantity to supply if provided
  if (item.orderQty) {
    ardaItem.primarySupply.orderQuantity = {
      amount: item.orderQty,
      unit: item.orderQtyUnit || item.minQtyUnit || 'each',
    };
  }

  console.log('📤 Creating Arda item:', JSON.stringify(ardaItem, null, 2));

  return ardaFetch<EntityRecord>('/v1/item/item', {
    method: 'POST',
    body: ardaItem,
    author,
    tenantId,
  });
}

// Create a Kanban card in Arda
export async function createKanbanCard(
  card: KanbanCardInput,
  author: string
): Promise<EntityRecord> {
  const tenantId = await resolveTenantId(author);

  return ardaFetch<EntityRecord>('/v1/kanban/kanban-card', {
    method: 'POST',
    body: card,
    author,
    tenantId,
  });
}

// Create an order in Arda
export async function createOrder(
  order: OrderHeaderInput,
  author: string
): Promise<EntityRecord> {
  const tenantId = await resolveTenantId(author);

  return ardaFetch<EntityRecord>('/v1/order/order', {
    method: 'POST',
    body: order,
    author,
    tenantId,
  });
}

// Velocity profile input for creating items from velocity data
export interface ItemVelocityProfileInput {
  displayName: string;
  supplier: string;
  dailyBurnRate: number;
  averageCadenceDays: number;
  recommendedMin: number;
  recommendedOrderQty: number;
  unit?: string; // Defaults to 'EA' if not provided
  location?: string;
  primarySupplierLink?: string;
  imageUrl?: string;
}

// Result type for sync operations
export interface VelocitySyncResult {
  displayName: string;
  success: boolean;
  itemId?: string;
  error?: string;
}

// Create an item in Arda from velocity profile data
// Calculates kanban parameters and sets order mechanism based on velocity
export async function createItemFromVelocity(
  profile: ItemVelocityProfileInput,
  author: string
): Promise<EntityRecord> {
  // Calculate kanban parameters
  const minQty = profile.recommendedMin;
  const orderQty = profile.recommendedOrderQty;
  const unit = profile.unit || 'EA';

  // Set order mechanism based on velocity: AUTO for high velocity (>5/day), MANUAL otherwise
  const orderMechanism = profile.dailyBurnRate > 5 ? 'AUTO' : 'MANUAL';

  // Create item using existing createItem function
  return createItem(
    {
      name: profile.displayName,
      orderMechanism,
      location: profile.location,
      minQty,
      minQtyUnit: unit,
      orderQty,
      orderQtyUnit: unit,
      primarySupplier: profile.supplier,
      primarySupplierLink: profile.primarySupplierLink,
      imageUrl: profile.imageUrl,
    },
    author
  );
}

// Sync multiple velocity profiles to Arda
// Creates items for each profile and returns results with success/failure status
export async function syncVelocityToArda(
  profiles: ItemVelocityProfileInput[],
  author: string
): Promise<VelocitySyncResult[]> {
  const results: VelocitySyncResult[] = [];

  for (const profile of profiles) {
    try {
      const result = await createItemFromVelocity(profile, author);
      
      // Extract item ID from the result (assuming it's in the payload)
      const itemId = (result.payload as { itemId?: string })?.itemId || result.rId;

      results.push({
        displayName: profile.displayName,
        success: true,
        itemId,
      });
    } catch (error) {
      results.push({
        displayName: profile.displayName,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

export const ardaService = {
  createItem,
  createKanbanCard,
  createOrder,
  getTenantByEmail,
  isMockMode,
  createItemFromVelocity,
  syncVelocityToArda,
  isConfigured: () => Boolean(ARDA_API_KEY && ARDA_TENANT_ID && ARDA_TENANT_ID !== 'your_tenant_uuid_here'),
};
