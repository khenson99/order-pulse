import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegrationAuthError } from './errors.js';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  decrypt: vi.fn(),
  encrypt: vi.fn(),
  getProviderConnectionByIdForUser: vi.fn(),
  getProviderConnectionByProviderTenant: vi.fn(),
  getProviderSyncState: vi.fn(),
  markProviderConnectionStatus: vi.fn(),
  upsertProviderSyncState: vi.fn(),
  updateProviderConnectionTokens: vi.fn(),
  createProviderSyncRun: vi.fn(),
  completeProviderSyncRun: vi.fn(),
  refreshQuickBooksTokens: vi.fn(),
  refreshXeroTokens: vi.fn(),
  quickBooksAdapter: {
    listBackfill: vi.fn(),
    listIncrementalViaCdc: vi.fn(),
    listIncremental: vi.fn(),
    getPurchaseOrdersByIds: vi.fn(),
  },
  xeroAdapter: {
    listPurchaseOrders: vi.fn(),
  },
  appLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../db/index.js', () => ({
  query: mocks.query,
}));

vi.mock('../../utils/encryption.js', () => ({
  decrypt: mocks.decrypt,
  encrypt: mocks.encrypt,
}));

vi.mock('./store.js', () => ({
  getProviderConnectionByIdForUser: mocks.getProviderConnectionByIdForUser,
  getProviderConnectionByProviderTenant: mocks.getProviderConnectionByProviderTenant,
  getProviderSyncState: mocks.getProviderSyncState,
  markProviderConnectionStatus: mocks.markProviderConnectionStatus,
  upsertProviderSyncState: mocks.upsertProviderSyncState,
  updateProviderConnectionTokens: mocks.updateProviderConnectionTokens,
  createProviderSyncRun: mocks.createProviderSyncRun,
  completeProviderSyncRun: mocks.completeProviderSyncRun,
}));

vi.mock('./quickbooksOAuth.js', () => ({
  refreshQuickBooksTokens: mocks.refreshQuickBooksTokens,
}));

vi.mock('./xeroOAuth.js', () => ({
  refreshXeroTokens: mocks.refreshXeroTokens,
}));

vi.mock('./providers/quickbooksAdapter.js', () => ({
  QuickBooksAdapter: vi.fn(() => mocks.quickBooksAdapter),
}));

vi.mock('./providers/xeroAdapter.js', () => ({
  XeroAdapter: vi.fn(() => mocks.xeroAdapter),
}));

vi.mock('../../middleware/requestLogger.js', () => ({
  appLogger: mocks.appLogger,
}));

const baseConnection = {
  id: 'conn-1',
  userId: 'user-1',
  provider: 'quickbooks' as const,
  tenantId: 'realm-1',
  tenantName: 'Acme',
  accessTokenEncrypted: 'enc-access',
  refreshTokenEncrypted: 'enc-refresh',
  tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
  status: 'connected' as const,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const runningRun = {
  id: 'run-1',
  connectionId: 'conn-1',
  trigger: 'manual' as const,
  status: 'running' as const,
  ordersUpserted: 0,
  ordersDeleted: 0,
  itemsUpserted: 0,
  apiCalls: 0,
  startedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const sampleOrder = {
  externalId: 'po-1',
  externalNumber: 'PO-1',
  supplier: 'Acme Supply',
  orderDate: '2026-01-02T00:00:00.000Z',
  status: 'OPEN',
  totalAmount: 42,
  updatedAt: '2026-01-03T00:00:00.000Z',
  items: [
    {
      externalLineId: 'line-1',
      name: 'Bolt',
      quantity: 2,
      unit: 'ea',
      unitPrice: 21,
      totalPrice: 42,
    },
  ],
  raw: {},
};

describe('syncOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.getProviderConnectionByIdForUser.mockResolvedValue(baseConnection);
    mocks.getProviderConnectionByProviderTenant.mockResolvedValue(baseConnection);
    mocks.createProviderSyncRun.mockResolvedValue(runningRun);
    mocks.decrypt.mockReturnValue('access-token');
    mocks.query.mockResolvedValue({ rows: [], rowCount: 1 });
    mocks.getProviderSyncState.mockResolvedValue({
      connectionId: 'conn-1',
      backfillStartedAt: new Date('2026-01-01T00:00:00.000Z'),
      backfillCompletedAt: new Date('2026-01-01T00:00:00.000Z'),
      lastCursorUtc: new Date('2026-01-01T00:00:00.000Z'),
      cursorPayload: {},
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    mocks.quickBooksAdapter.listBackfill.mockResolvedValue({
      orders: [sampleOrder],
      hasMore: false,
      nextStartPosition: 2,
      apiCalls: 1,
      maxUpdatedAt: '2026-01-03T00:00:00.000Z',
    });
    mocks.quickBooksAdapter.listIncrementalViaCdc.mockResolvedValue({
      orders: [sampleOrder],
      apiCalls: 1,
      maxUpdatedAt: '2026-01-03T00:00:00.000Z',
    });
  });

  it('runs backfill sync and upserts orders/items with success counters', async () => {
    mocks.getProviderSyncState.mockResolvedValueOnce(null);

    const { runProviderSyncNow } = await import('./syncOrchestrator.js');
    const result = await runProviderSyncNow('conn-1', 'user-1', 'backfill');

    expect(result.runId).toBe('run-1');
    expect(mocks.quickBooksAdapter.listBackfill).toHaveBeenCalledTimes(1);

    expect(
      mocks.query.mock.calls.some((call) => String(call[0]).includes('INSERT INTO orders')),
    ).toBe(true);
    expect(
      mocks.query.mock.calls.some((call) => String(call[0]).includes('INSERT INTO order_items')),
    ).toBe(true);

    expect(mocks.completeProviderSyncRun).toHaveBeenCalledWith(
      'run-1',
      'success',
      expect.objectContaining({
        ordersUpserted: 1,
        ordersDeleted: 0,
        itemsUpserted: 1,
        apiCalls: 1,
      }),
    );
    expect(mocks.upsertProviderSyncState).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'conn-1',
        backfillCompletedAt: expect.any(Date),
        lastError: null,
      }),
    );
  });

  it('deletes local order when provider status is void/deleted', async () => {
    mocks.quickBooksAdapter.listIncrementalViaCdc.mockResolvedValueOnce({
      orders: [
        {
          ...sampleOrder,
          status: 'VOIDED',
          items: [],
        },
      ],
      apiCalls: 1,
      maxUpdatedAt: '2026-01-04T00:00:00.000Z',
    });

    const { runProviderSyncNow } = await import('./syncOrchestrator.js');
    await runProviderSyncNow('conn-1', 'user-1', 'manual');

    expect(
      mocks.query.mock.calls.some((call) => String(call[0]).includes('DELETE FROM orders')),
    ).toBe(true);
    expect(mocks.completeProviderSyncRun).toHaveBeenCalledWith(
      'run-1',
      'success',
      expect.objectContaining({
        ordersUpserted: 0,
        ordersDeleted: 1,
        itemsUpserted: 0,
        apiCalls: 1,
      }),
    );
  });

  it('marks connection reauth_required and records failed run on auth error', async () => {
    mocks.getProviderSyncState.mockResolvedValueOnce(null);
    mocks.quickBooksAdapter.listBackfill.mockRejectedValueOnce(
      new IntegrationAuthError('QUICKBOOKS_UNAUTHORIZED', 'QuickBooks token is unauthorized.'),
    );

    const { runProviderSyncNow } = await import('./syncOrchestrator.js');
    await runProviderSyncNow('conn-1', 'user-1', 'backfill');

    expect(mocks.markProviderConnectionStatus).toHaveBeenCalledWith('conn-1', 'reauth_required');
    expect(mocks.upsertProviderSyncState).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'conn-1',
        lastError: 'QuickBooks token is unauthorized.',
      }),
    );
    expect(mocks.completeProviderSyncRun).toHaveBeenCalledWith(
      'run-1',
      'failed',
      expect.objectContaining({
        ordersUpserted: 0,
        ordersDeleted: 0,
        itemsUpserted: 0,
        apiCalls: 0,
      }),
      'QuickBooks token is unauthorized.',
    );
  });
});
