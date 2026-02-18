import { CanonicalLineItem, CanonicalPurchaseOrder } from '../types.js';
import { IntegrationAuthError, parseJsonResponse } from '../errors.js';

const XERO_ACCOUNTING_BASE_URL = 'https://api.xero.com/api.xro/2.0';

export interface XeroAdapterOptions {
  fetchFn?: typeof fetch;
}

export interface XeroListResult {
  orders: CanonicalPurchaseOrder[];
  hasMore: boolean;
  nextPage: number;
  apiCalls: number;
  maxUpdatedAt?: string;
}

interface XeroListParams {
  tenantId: string;
  accessToken: string;
  page: number;
  pageSize: number;
  dateFrom?: string;
  dateTo?: string;
  ifModifiedSince?: string;
}

function parseXeroDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;

  const msDate = value.match(/^\/Date\((\d+)(?:[+-]\d+)?\)\/$/);
  if (msDate) {
    const millis = Number(msDate[1]);
    if (Number.isFinite(millis)) {
      return new Date(millis).toISOString();
    }
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function mapXeroPurchaseOrder(raw: Record<string, unknown>): CanonicalPurchaseOrder {
  const lines = Array.isArray(raw.LineItems) ? raw.LineItems : [];

  const mappedLines: CanonicalLineItem[] = lines
    .filter((line): line is Record<string, unknown> => !!line && typeof line === 'object')
    .map((line, index) => {
      const quantity = toNumber(line.Quantity) ?? 1;
      const unitPrice = toNumber(line.UnitAmount);
      const totalPrice = toNumber(line.LineAmount) ?? (unitPrice !== undefined ? unitPrice * quantity : undefined);
      const item = (line.Item as Record<string, unknown> | undefined) || undefined;

      return {
        externalLineId: String(line.LineItemID || `${raw.PurchaseOrderID || raw.PurchaseOrderNumber || 'line'}:${index + 1}`),
        name: String(line.Description || item?.Name || item?.Code || 'Line item'),
        quantity,
        unit: typeof line.Unit === 'string' ? line.Unit : 'ea',
        unitPrice,
        totalPrice,
        sku: typeof item?.Code === 'string' ? item.Code : undefined,
        itemCode: typeof line.ItemCode === 'string' ? line.ItemCode : typeof item?.Code === 'string' ? item.Code : undefined,
      };
    });

  return {
    externalId: String(raw.PurchaseOrderID || raw.PurchaseOrderNumber || ''),
    externalNumber: String(raw.PurchaseOrderNumber || raw.PurchaseOrderID || ''),
    supplier: String((raw.Contact as Record<string, unknown> | undefined)?.Name || 'Unknown Supplier'),
    orderDate: parseXeroDate(raw.DateString || raw.Date),
    status: String(raw.Status || 'UNKNOWN'),
    totalAmount: toNumber(raw.Total),
    updatedAt: parseXeroDate(raw.UpdatedDateUTC),
    items: mappedLines,
    raw,
  };
}

export class XeroAdapter {
  private readonly fetchFn: typeof fetch;

  constructor(options: XeroAdapterOptions = {}) {
    this.fetchFn = options.fetchFn || fetch;
  }

  private async fetchWithBackoff(url: string, headers: Record<string, string>): Promise<Response> {
    let lastResponse: Response | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await this.fetchFn(url, { headers });

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

  async listPurchaseOrders(params: XeroListParams): Promise<XeroListResult> {
    const url = new URL(`${XERO_ACCOUNTING_BASE_URL}/PurchaseOrders`);
    url.searchParams.set('page', String(params.page));
    url.searchParams.set('pageSize', String(params.pageSize));
    if (params.dateFrom) url.searchParams.set('DateFrom', params.dateFrom);
    if (params.dateTo) url.searchParams.set('DateTo', params.dateTo);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${params.accessToken}`,
      'xero-tenant-id': params.tenantId,
      Accept: 'application/json',
    };

    if (params.ifModifiedSince) {
      headers['If-Modified-Since'] = new Date(params.ifModifiedSince).toUTCString();
    }

    const response = await this.fetchWithBackoff(url.toString(), headers);
    const payload = await parseJsonResponse(response);

    if (response.status === 401) {
      throw new IntegrationAuthError('XERO_UNAUTHORIZED', 'Xero token is unauthorized.');
    }

    if (!response.ok) {
      throw new Error(`Xero purchase order request failed (${response.status}).`);
    }

    const rawOrders = Array.isArray(payload?.PurchaseOrders)
      ? payload.PurchaseOrders as Record<string, unknown>[]
      : [];

    const orders = rawOrders.map(mapXeroPurchaseOrder);
    const maxUpdatedAt = orders
      .map((order) => order.updatedAt)
      .filter((value): value is string => !!value)
      .sort()
      .pop();

    return {
      orders,
      hasMore: rawOrders.length >= params.pageSize,
      nextPage: params.page + 1,
      apiCalls: 1,
      maxUpdatedAt,
    };
  }
}
