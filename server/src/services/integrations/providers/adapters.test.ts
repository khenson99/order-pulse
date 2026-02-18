import { describe, expect, it, vi } from 'vitest';
import { QuickBooksAdapter, mapQuickBooksPurchaseOrder } from './quickbooksAdapter.js';
import { XeroAdapter, mapXeroPurchaseOrder } from './xeroAdapter.js';
import { buildProviderOrderId, isDeletedPurchaseOrderStatus } from '../syncOrchestrator.js';

describe('provider adapters', () => {
  it('maps QuickBooks purchase orders to canonical shape', () => {
    const mapped = mapQuickBooksPurchaseOrder({
      Id: '123',
      DocNumber: 'PO-1001',
      VendorRef: { name: 'Acme Supply' },
      TxnDate: '2026-01-10',
      POStatus: 'Open',
      TotalAmt: 52.5,
      MetaData: { LastUpdatedTime: '2026-01-11T12:00:00Z' },
      Line: [
        {
          Id: 'line-1',
          Description: 'M8 Bolt',
          Amount: 42,
          ItemBasedExpenseLineDetail: {
            Qty: 6,
            UnitPrice: 7,
            ItemRef: { value: 'SKU-1', name: 'M8 Bolt' },
          },
        },
      ],
    });

    expect(mapped.externalId).toBe('123');
    expect(mapped.externalNumber).toBe('PO-1001');
    expect(mapped.supplier).toBe('Acme Supply');
    expect(mapped.totalAmount).toBe(52.5);
    expect(mapped.items).toHaveLength(1);
    expect(mapped.items[0].externalLineId).toBe('line-1');
    expect(mapped.items[0].quantity).toBe(6);
    expect(mapped.items[0].unitPrice).toBe(7);
    expect(mapped.updatedAt).toBe('2026-01-11T12:00:00.000Z');
  });

  it('maps Xero purchase orders with /Date(...) values', () => {
    const mapped = mapXeroPurchaseOrder({
      PurchaseOrderID: 'po-uuid',
      PurchaseOrderNumber: 'PO-900',
      Contact: { Name: 'Fastenal' },
      Status: 'AUTHORISED',
      Total: 130.25,
      Date: '/Date(1764806400000+0000)/',
      UpdatedDateUTC: '/Date(1764892800000+0000)/',
      LineItems: [
        {
          LineItemID: 'li-1',
          Description: 'Cutting fluid',
          Quantity: 2,
          UnitAmount: 15,
          LineAmount: 30,
          ItemCode: 'CF-12',
        },
      ],
    });

    expect(mapped.externalId).toBe('po-uuid');
    expect(mapped.externalNumber).toBe('PO-900');
    expect(mapped.supplier).toBe('Fastenal');
    expect(mapped.orderDate).toBe('2025-12-04T00:00:00.000Z');
    expect(mapped.updatedAt).toBe('2025-12-05T00:00:00.000Z');
    expect(mapped.items[0].itemCode).toBe('CF-12');
  });

  it('produces deterministic order IDs for idempotent upserts', () => {
    const first = buildProviderOrderId('user-1', 'quickbooks', 'realm-1', 'po-1');
    const second = buildProviderOrderId('user-1', 'quickbooks', 'realm-1', 'po-1');
    const third = buildProviderOrderId('user-1', 'xero', 'tenant-1', 'po-1');

    expect(first).toBe(second);
    expect(first).not.toBe(third);
  });

  it('flags deleted and voided statuses', () => {
    expect(isDeletedPurchaseOrderStatus('DELETED')).toBe(true);
    expect(isDeletedPurchaseOrderStatus('VOIDED')).toBe(true);
    expect(isDeletedPurchaseOrderStatus('AUTHORISED')).toBe(false);
  });

  it('retries QuickBooks queries after transient throttling and succeeds', async () => {
    vi.useFakeTimers();
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ Fault: {} }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        QueryResponse: {
          PurchaseOrder: [
            {
              Id: '123',
              DocNumber: 'PO-1001',
              VendorRef: { name: 'Acme Supply' },
              POStatus: 'Open',
              TotalAmt: 10,
              MetaData: { LastUpdatedTime: '2026-01-11T12:00:00Z' },
              Line: [],
            },
          ],
        },
      }), { status: 200 }));

    try {
      const adapter = new QuickBooksAdapter({ fetchFn });
      const resultPromise = adapter.listIncremental({
        realmId: 'realm-1',
        accessToken: 'token',
        changedSince: '2026-01-01T00:00:00.000Z',
        startPosition: 1,
        maxResults: 50,
      });

      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(result.orders).toHaveLength(1);
      expect(result.orders[0].externalNumber).toBe('PO-1001');
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries Xero requests after transient 5xx and succeeds', async () => {
    vi.useFakeTimers();
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ Message: 'try later' }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        PurchaseOrders: [
          {
            PurchaseOrderID: 'po-uuid',
            PurchaseOrderNumber: 'PO-900',
            Contact: { Name: 'Fastenal' },
            Status: 'AUTHORISED',
            Total: 130.25,
            UpdatedDateUTC: '/Date(1764892800000+0000)/',
            LineItems: [],
          },
        ],
      }), { status: 200 }));

    try {
      const adapter = new XeroAdapter({ fetchFn });
      const resultPromise = adapter.listPurchaseOrders({
        tenantId: 'tenant-1',
        accessToken: 'token',
        page: 1,
        pageSize: 100,
        ifModifiedSince: '2026-01-01T00:00:00.000Z',
      });

      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(result.orders).toHaveLength(1);
      expect(result.orders[0].externalId).toBe('po-uuid');
    } finally {
      vi.useRealTimers();
    }
  });
});
