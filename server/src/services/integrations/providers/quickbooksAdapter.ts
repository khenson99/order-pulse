import { CanonicalLineItem, CanonicalPurchaseOrder } from '../types.js';
import { IntegrationAuthError, parseJsonResponse } from '../errors.js';

const QUICKBOOKS_API_BASE_URL = 'https://quickbooks.api.intuit.com';

export interface QuickBooksAdapterOptions {
  fetchFn?: typeof fetch;
}

export interface QuickBooksListResult {
  orders: CanonicalPurchaseOrder[];
  hasMore: boolean;
  nextStartPosition: number;
  apiCalls: number;
  maxUpdatedAt?: string;
}

interface QuickBooksQueryParams {
  realmId: string;
  accessToken: string;
  query: string;
}

interface QuickBooksBackfillParams {
  realmId: string;
  accessToken: string;
  startDate: string;
  endDate: string;
  startPosition: number;
  maxResults: number;
}

interface QuickBooksIncrementalParams {
  realmId: string;
  accessToken: string;
  changedSince: string;
  startPosition: number;
  maxResults: number;
}

function parseQuickBooksDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function pickLineName(line: Record<string, unknown>, detail: Record<string, unknown> | undefined): string {
  if (typeof line.Description === 'string' && line.Description.trim()) return line.Description;
  const itemRef = detail?.ItemRef as Record<string, unknown> | undefined;
  if (typeof itemRef?.name === 'string' && itemRef.name.trim()) return itemRef.name;
  if (typeof itemRef?.value === 'string' && itemRef.value.trim()) return itemRef.value;
  return 'Line item';
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function mapQuickBooksPurchaseOrder(raw: Record<string, unknown>): CanonicalPurchaseOrder {
  const lines = Array.isArray(raw.Line) ? raw.Line : [];
  const mappedLines: CanonicalLineItem[] = lines
    .filter((line): line is Record<string, unknown> => !!line && typeof line === 'object')
    .map((line) => {
      const detail =
        (line.ItemBasedExpenseLineDetail as Record<string, unknown> | undefined)
        || (line.SalesItemLineDetail as Record<string, unknown> | undefined)
        || undefined;
      const itemRef = detail?.ItemRef as Record<string, unknown> | undefined;
      const quantity = toNumber(detail?.Qty) ?? 1;
      const unitPrice = toNumber(detail?.UnitPrice);
      const totalPrice = toNumber(line.Amount) ?? (unitPrice !== undefined ? unitPrice * quantity : undefined);

      return {
        externalLineId: String(line.Id || `${raw.Id || raw.DocNumber || 'po'}:${Math.random().toString(36).slice(2, 8)}`),
        name: pickLineName(line, detail),
        quantity,
        unit: typeof detail?.Unit === 'string' ? detail.Unit : 'ea',
        unitPrice,
        totalPrice,
        sku: typeof itemRef?.value === 'string' ? itemRef.value : undefined,
        itemCode: typeof itemRef?.name === 'string' ? itemRef.name : undefined,
      };
    });

  const meta = (raw.MetaData as Record<string, unknown> | undefined) || {};

  return {
    externalId: String(raw.Id || raw.DocNumber || ''),
    externalNumber: String(raw.DocNumber || raw.Id || ''),
    supplier: String((raw.VendorRef as Record<string, unknown> | undefined)?.name || 'Unknown Supplier'),
    orderDate: parseQuickBooksDate(raw.TxnDate),
    status: String(raw.POStatus || raw.TxnStatus || raw.PrivateNote || 'UNKNOWN'),
    totalAmount: toNumber(raw.TotalAmt),
    updatedAt: parseQuickBooksDate(meta.LastUpdatedTime),
    items: mappedLines,
    raw,
  };
}

export class QuickBooksAdapter {
  private readonly fetchFn: typeof fetch;

  constructor(options: QuickBooksAdapterOptions = {}) {
    this.fetchFn = options.fetchFn || fetch;
  }

  private async fetchWithBackoff(url: string, accessToken: string): Promise<Response> {
    let lastResponse: Response | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await this.fetchFn(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });

      if (response.status !== 429 && response.status < 500) {
        return response;
      }

      lastResponse = response;
      if (attempt < 2) {
        const delayMs = Math.pow(2, attempt) * 250 + Math.floor(Math.random() * 100);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    return lastResponse!;
  }

  async listBackfill(params: QuickBooksBackfillParams): Promise<QuickBooksListResult> {
    const where = `TxnDate >= '${params.startDate}' AND TxnDate <= '${params.endDate}'`;
    const query = `SELECT * FROM PurchaseOrder WHERE ${where} STARTPOSITION ${params.startPosition} MAXRESULTS ${params.maxResults}`;
    return this.queryPurchaseOrders({ realmId: params.realmId, accessToken: params.accessToken, query });
  }

  async listIncremental(params: QuickBooksIncrementalParams): Promise<QuickBooksListResult> {
    const where = `MetaData.LastUpdatedTime >= '${params.changedSince}'`;
    const query = `SELECT * FROM PurchaseOrder WHERE ${where} STARTPOSITION ${params.startPosition} MAXRESULTS ${params.maxResults}`;
    return this.queryPurchaseOrders({ realmId: params.realmId, accessToken: params.accessToken, query });
  }

  async listIncrementalViaCdc(params: {
    realmId: string;
    accessToken: string;
    changedSince: string;
  }): Promise<{ orders: CanonicalPurchaseOrder[]; apiCalls: number; maxUpdatedAt?: string }> {
    const url = new URL(`${QUICKBOOKS_API_BASE_URL}/v3/company/${encodeURIComponent(params.realmId)}/cdc`);
    url.searchParams.set('entities', 'PurchaseOrder');
    url.searchParams.set('changedSince', params.changedSince);
    url.searchParams.set('minorversion', '75');

    const response = await this.fetchWithBackoff(url.toString(), params.accessToken);

    const payload = await parseJsonResponse(response);
    if (response.status === 401) {
      throw new IntegrationAuthError('QUICKBOOKS_UNAUTHORIZED', 'QuickBooks token is unauthorized.');
    }
    if (!response.ok) {
      throw new Error(`QuickBooks CDC request failed (${response.status}).`);
    }

    const queryResponse = payload?.CDCResponse?.QueryResponse;
    const normalized = Array.isArray(queryResponse) ? queryResponse : [queryResponse].filter(Boolean);
    const rawOrders: Record<string, unknown>[] = [];

    for (const resultSet of normalized) {
      const purchaseOrders = (resultSet?.PurchaseOrder || []) as Record<string, unknown>[];
      if (Array.isArray(purchaseOrders)) {
        rawOrders.push(...purchaseOrders);
      }
    }

    const mapped = rawOrders.map(mapQuickBooksPurchaseOrder);
    const maxUpdatedAt = mapped
      .map((order) => order.updatedAt)
      .filter((value): value is string => !!value)
      .sort()
      .pop();

    return {
      orders: mapped,
      apiCalls: 1,
      maxUpdatedAt,
    };
  }

  async getPurchaseOrdersByIds(params: {
    realmId: string;
    accessToken: string;
    externalIds: string[];
  }): Promise<{ orders: CanonicalPurchaseOrder[]; apiCalls: number; maxUpdatedAt?: string }> {
    const ids = Array.from(new Set(params.externalIds.map((id) => id.trim()).filter(Boolean)));
    if (!ids.length) {
      return { orders: [], apiCalls: 0 };
    }

    const where = ids.length === 1
      ? `Id = '${ids[0].replace(/'/g, "''")}'`
      : `Id IN (${ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(',')})`;

    const query = `SELECT * FROM PurchaseOrder WHERE ${where}`;
    const result = await this.queryPurchaseOrders({ realmId: params.realmId, accessToken: params.accessToken, query });

    return {
      orders: result.orders,
      apiCalls: result.apiCalls,
      maxUpdatedAt: result.maxUpdatedAt,
    };
  }

  private async queryPurchaseOrders(params: QuickBooksQueryParams): Promise<QuickBooksListResult> {
    const url = new URL(`${QUICKBOOKS_API_BASE_URL}/v3/company/${encodeURIComponent(params.realmId)}/query`);
    url.searchParams.set('query', params.query);
    url.searchParams.set('minorversion', '75');

    const response = await this.fetchWithBackoff(url.toString(), params.accessToken);

    const payload = await parseJsonResponse(response);

    if (response.status === 401) {
      throw new IntegrationAuthError('QUICKBOOKS_UNAUTHORIZED', 'QuickBooks token is unauthorized.');
    }

    if (!response.ok) {
      throw new Error(`QuickBooks query failed (${response.status}).`);
    }

    const rawOrders = Array.isArray(payload?.QueryResponse?.PurchaseOrder)
      ? payload.QueryResponse.PurchaseOrder as Record<string, unknown>[]
      : [];

    const mapped = rawOrders.map(mapQuickBooksPurchaseOrder);
    const maxUpdatedAt = mapped
      .map((order) => order.updatedAt)
      .filter((value): value is string => !!value)
      .sort()
      .pop();

    const maxResultsMatch = params.query.match(/MAXRESULTS\s+(\d+)/i);
    const requestedPageSize = maxResultsMatch ? Number(maxResultsMatch[1]) : rawOrders.length;

    return {
      orders: mapped,
      hasMore: rawOrders.length > 0 && rawOrders.length >= requestedPageSize,
      nextStartPosition: (() => {
        const match = params.query.match(/STARTPOSITION\s+(\d+)/i);
        const startPosition = match ? Number(match[1]) : 1;
        return startPosition + rawOrders.length;
      })(),
      apiCalls: 1,
      maxUpdatedAt,
    };
  }
}
