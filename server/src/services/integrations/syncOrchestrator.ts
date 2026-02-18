import { v5 as uuidv5 } from 'uuid';
import { query } from '../../db/index.js';
import { decrypt, encrypt } from '../../utils/encryption.js';
import { appLogger } from '../../middleware/requestLogger.js';
import {
  completeProviderSyncRun,
  createProviderSyncRun,
  getProviderConnectionByIdForUser,
  getProviderConnectionByProviderTenant,
  getProviderSyncState,
  markProviderConnectionStatus,
  upsertProviderSyncState,
  updateProviderConnectionTokens,
} from './store.js';
import { QuickBooksAdapter } from './providers/quickbooksAdapter.js';
import { XeroAdapter } from './providers/xeroAdapter.js';
import { IntegrationAuthError } from './errors.js';
import { refreshQuickBooksTokens } from './quickbooksOAuth.js';
import { refreshXeroTokens } from './xeroOAuth.js';
import { CanonicalPurchaseOrder, ProviderConnection, SyncRunCounters, SyncTrigger } from './types.js';

const ORDER_ID_NAMESPACE = '27bf6e8b-0aa0-4123-98af-f4d1f20410d0';
const DEFAULT_BACKFILL_MONTHS = 12;
const QUICKBOOKS_MAX_RESULTS = 100;
const XERO_PAGE_SIZE = 100;
const runningConnectionIds = new Set<string>();

export interface SyncOptions {
  externalIds?: string[];
}

function toIsoDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function subtractMonths(now: Date, months: number): Date {
  const copy = new Date(now);
  copy.setMonth(copy.getMonth() - months);
  return copy;
}

function mergeMaxIso(existing: string | undefined, candidate: string | undefined): string | undefined {
  if (!candidate) return existing;
  if (!existing) return candidate;
  return candidate > existing ? candidate : existing;
}

export function isDeletedPurchaseOrderStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return normalized.includes('deleted') || normalized.includes('void');
}

export function buildProviderOrderId(
  userId: string,
  provider: ProviderConnection['provider'],
  tenantId: string,
  externalId: string,
): string {
  return uuidv5(`${userId}:${provider}:${tenantId}:${externalId}`, ORDER_ID_NAMESPACE);
}

function normalizeLineQuantity(value: number | undefined): number {
  if (!Number.isFinite(value || 0)) return 1;
  return Math.max(1, Math.round(value || 1));
}

async function persistCanonicalOrder(connection: ProviderConnection, order: CanonicalPurchaseOrder): Promise<SyncRunCounters> {
  const counters: SyncRunCounters = {
    ordersUpserted: 0,
    ordersDeleted: 0,
    itemsUpserted: 0,
    apiCalls: 0,
  };

  const orderId = buildProviderOrderId(connection.userId, connection.provider, connection.tenantId, order.externalId);

  if (isDeletedPurchaseOrderStatus(order.status)) {
    const deleted = await query(
      `DELETE FROM orders WHERE id = $1 AND user_id = $2`,
      [orderId, connection.userId],
    );
    counters.ordersDeleted = deleted.rowCount || 0;
    return counters;
  }

  await query(
    `
      INSERT INTO orders (id, user_id, original_email_id, supplier, order_date, total_amount, confidence, raw_data)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (id) DO UPDATE SET
        supplier = EXCLUDED.supplier,
        order_date = EXCLUDED.order_date,
        total_amount = EXCLUDED.total_amount,
        confidence = EXCLUDED.confidence,
        raw_data = EXCLUDED.raw_data
    `,
    [
      orderId,
      connection.userId,
      `${connection.provider}:${order.externalNumber}`,
      order.supplier,
      order.orderDate ? order.orderDate.slice(0, 10) : null,
      order.totalAmount ?? null,
      1,
      JSON.stringify({
        provider: connection.provider,
        tenantId: connection.tenantId,
        externalId: order.externalId,
        externalNumber: order.externalNumber,
        status: order.status,
        updatedAt: order.updatedAt,
        raw: order.raw,
      }),
    ],
  );

  counters.ordersUpserted = 1;

  await query(`DELETE FROM order_items WHERE order_id = $1`, [orderId]);

  for (const line of order.items) {
    const quantity = normalizeLineQuantity(line.quantity);
    const unitPrice = line.unitPrice ?? null;
    const totalPrice = line.totalPrice ?? (line.unitPrice !== undefined ? line.unitPrice * quantity : null);

    await query(
      `
        INSERT INTO order_items (order_id, name, quantity, unit, unit_price, total_price)
        VALUES ($1,$2,$3,$4,$5,$6)
      `,
      [
        orderId,
        line.name || line.itemCode || line.externalLineId,
        quantity,
        line.unit || 'ea',
        unitPrice,
        totalPrice,
      ],
    );

    counters.itemsUpserted += 1;
  }

  return counters;
}

async function refreshConnectionIfNeeded(connection: ProviderConnection): Promise<ProviderConnection> {
  const refreshWindowMs = 60_000;
  if (connection.tokenExpiresAt.getTime() > Date.now() + refreshWindowMs) {
    return connection;
  }

  try {
    const refreshToken = decrypt(connection.refreshTokenEncrypted);
    if (!refreshToken) {
      throw new IntegrationAuthError('INTEGRATION_REFRESH_TOKEN_MISSING', 'Missing refresh token.');
    }

    const tokenPayload = connection.provider === 'quickbooks'
      ? await refreshQuickBooksTokens(refreshToken)
      : await refreshXeroTokens(refreshToken);

    const updated = await updateProviderConnectionTokens({
      id: connection.id,
      accessTokenEncrypted: encrypt(tokenPayload.accessToken),
      refreshTokenEncrypted: encrypt(tokenPayload.refreshToken),
      tokenExpiresAt: tokenPayload.tokenExpiresAt,
      scope: tokenPayload.scope,
      status: 'connected',
    });

    if (!updated) {
      throw new Error('Connection not found during token refresh.');
    }

    return updated;
  } catch (error) {
    await markProviderConnectionStatus(connection.id, 'reauth_required');
    throw error;
  }
}

async function fetchQuickBooksOrders(
  connection: ProviderConnection,
  accessToken: string,
  state: Awaited<ReturnType<typeof getProviderSyncState>>,
  trigger: SyncTrigger,
  options: SyncOptions,
): Promise<{ orders: CanonicalPurchaseOrder[]; apiCalls: number; maxUpdatedAt?: string; isBackfill: boolean }> {
  const adapter = new QuickBooksAdapter();
  const now = new Date();
  const isBackfill = !state?.backfillCompletedAt;

  if (trigger === 'webhook' && options.externalIds?.length) {
    const byIds = await adapter.getPurchaseOrdersByIds({
      realmId: connection.tenantId,
      accessToken,
      externalIds: options.externalIds,
    });

    return {
      orders: byIds.orders,
      apiCalls: byIds.apiCalls,
      maxUpdatedAt: byIds.maxUpdatedAt,
      isBackfill,
    };
  }

  if (!isBackfill) {
    const changedSince = state?.lastCursorUtc?.toISOString() || new Date(Date.now() - (15 * 60 * 1000)).toISOString();

    try {
      const cdc = await adapter.listIncrementalViaCdc({
        realmId: connection.tenantId,
        accessToken,
        changedSince,
      });

      return {
        orders: cdc.orders,
        apiCalls: cdc.apiCalls,
        maxUpdatedAt: cdc.maxUpdatedAt,
        isBackfill,
      };
    } catch (error) {
      appLogger.warn({ err: error, connectionId: connection.id }, 'QuickBooks CDC failed; falling back to query polling');

      let apiCalls = 0;
      let maxUpdatedAt: string | undefined;
      const allOrders: CanonicalPurchaseOrder[] = [];
      let startPosition = 1;

      while (true) {
        const page = await adapter.listIncremental({
          realmId: connection.tenantId,
          accessToken,
          changedSince,
          startPosition,
          maxResults: QUICKBOOKS_MAX_RESULTS,
        });

        apiCalls += page.apiCalls;
        allOrders.push(...page.orders);
        maxUpdatedAt = mergeMaxIso(maxUpdatedAt, page.maxUpdatedAt);

        if (!page.hasMore) break;
        startPosition = page.nextStartPosition;
      }

      return { orders: allOrders, apiCalls, maxUpdatedAt, isBackfill };
    }
  }

  let startPosition = 1;
  let apiCalls = 0;
  let maxUpdatedAt: string | undefined;
  const allOrders: CanonicalPurchaseOrder[] = [];
  const startDate = toIsoDateOnly(subtractMonths(now, DEFAULT_BACKFILL_MONTHS));
  const endDate = toIsoDateOnly(now);

  while (true) {
    const page = await adapter.listBackfill({
      realmId: connection.tenantId,
      accessToken,
      startDate,
      endDate,
      startPosition,
      maxResults: QUICKBOOKS_MAX_RESULTS,
    });

    apiCalls += page.apiCalls;
    allOrders.push(...page.orders);
    maxUpdatedAt = mergeMaxIso(maxUpdatedAt, page.maxUpdatedAt);

    if (!page.hasMore) break;
    startPosition = page.nextStartPosition;
  }

  return { orders: allOrders, apiCalls, maxUpdatedAt, isBackfill };
}

async function fetchXeroOrders(
  connection: ProviderConnection,
  accessToken: string,
  state: Awaited<ReturnType<typeof getProviderSyncState>>,
): Promise<{ orders: CanonicalPurchaseOrder[]; apiCalls: number; maxUpdatedAt?: string; isBackfill: boolean }> {
  const adapter = new XeroAdapter();
  const now = new Date();
  const isBackfill = !state?.backfillCompletedAt;

  let page = 1;
  let apiCalls = 0;
  let maxUpdatedAt: string | undefined;
  const allOrders: CanonicalPurchaseOrder[] = [];

  const dateFrom = isBackfill ? toIsoDateOnly(subtractMonths(now, DEFAULT_BACKFILL_MONTHS)) : undefined;
  const dateTo = isBackfill ? toIsoDateOnly(now) : undefined;
  const ifModifiedSince = !isBackfill ? state?.lastCursorUtc?.toISOString() : undefined;

  while (true) {
    const result = await adapter.listPurchaseOrders({
      tenantId: connection.tenantId,
      accessToken,
      page,
      pageSize: XERO_PAGE_SIZE,
      dateFrom,
      dateTo,
      ifModifiedSince,
    });

    apiCalls += result.apiCalls;
    allOrders.push(...result.orders);
    maxUpdatedAt = mergeMaxIso(maxUpdatedAt, result.maxUpdatedAt);

    if (!result.hasMore) break;
    page = result.nextPage;
  }

  return { orders: allOrders, apiCalls, maxUpdatedAt, isBackfill };
}

async function performSync(
  connection: ProviderConnection,
  runId: string,
  trigger: SyncTrigger,
  options: SyncOptions,
): Promise<void> {
  const counters: SyncRunCounters = {
    ordersUpserted: 0,
    ordersDeleted: 0,
    itemsUpserted: 0,
    apiCalls: 0,
  };

  const state = await getProviderSyncState(connection.id);
  if (!state?.backfillStartedAt) {
    await upsertProviderSyncState({
      connectionId: connection.id,
      backfillStartedAt: new Date(),
    });
  }

  let currentConnection = await refreshConnectionIfNeeded(connection);
  const accessToken = decrypt(currentConnection.accessTokenEncrypted);

  if (!accessToken) {
    throw new IntegrationAuthError('INTEGRATION_ACCESS_TOKEN_INVALID', 'Stored access token could not be decrypted.');
  }

  const fetched = currentConnection.provider === 'quickbooks'
    ? await fetchQuickBooksOrders(currentConnection, accessToken, state, trigger, options)
    : await fetchXeroOrders(currentConnection, accessToken, state);

  counters.apiCalls += fetched.apiCalls;

  for (const order of fetched.orders) {
    const rowCounters = await persistCanonicalOrder(currentConnection, order);
    counters.ordersUpserted += rowCounters.ordersUpserted;
    counters.ordersDeleted += rowCounters.ordersDeleted;
    counters.itemsUpserted += rowCounters.itemsUpserted;
  }

  const lastCursorIso = fetched.maxUpdatedAt || new Date().toISOString();

  await upsertProviderSyncState({
    connectionId: currentConnection.id,
    lastCursorUtc: new Date(lastCursorIso),
    lastSuccessfulSyncAt: new Date(),
    lastError: null,
    backfillCompletedAt: fetched.isBackfill ? new Date() : undefined,
    cursorPayload: {
      provider: currentConnection.provider,
      lastCursorUtc: lastCursorIso,
    },
  });

  await markProviderConnectionStatus(currentConnection.id, 'connected');
  await completeProviderSyncRun(runId, 'success', counters);
}

async function executeSyncRun(
  connection: ProviderConnection,
  runId: string,
  trigger: SyncTrigger,
  options: SyncOptions,
): Promise<void> {
  if (runningConnectionIds.has(connection.id)) {
    await completeProviderSyncRun(runId, 'failed', {
      ordersUpserted: 0,
      ordersDeleted: 0,
      itemsUpserted: 0,
      apiCalls: 0,
    }, 'Sync already running for this connection.');
    return;
  }

  runningConnectionIds.add(connection.id);

  try {
    await performSync(connection, runId, trigger, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown sync error';
    const isAuthError = error instanceof IntegrationAuthError;

    if (isAuthError) {
      await markProviderConnectionStatus(connection.id, 'reauth_required');
    }

    await upsertProviderSyncState({
      connectionId: connection.id,
      lastError: message,
    });

    await completeProviderSyncRun(
      runId,
      'failed',
      {
        ordersUpserted: 0,
        ordersDeleted: 0,
        itemsUpserted: 0,
        apiCalls: 0,
      },
      message,
    );

    appLogger.error({ err: error, connectionId: connection.id, runId, trigger }, 'Provider sync failed');
  } finally {
    runningConnectionIds.delete(connection.id);
  }
}

export async function enqueueProviderSync(
  connectionId: string,
  userId: string,
  trigger: SyncTrigger,
  options: SyncOptions = {},
): Promise<{ runId: string }> {
  const connection = await getProviderConnectionByIdForUser(connectionId, userId);
  if (!connection) {
    throw new Error('Provider connection not found.');
  }

  const run = await createProviderSyncRun(connection.id, trigger);

  queueMicrotask(() => {
    void executeSyncRun(connection, run.id, trigger, options);
  });

  return { runId: run.id };
}

export async function runProviderSyncNow(
  connectionId: string,
  userId: string,
  trigger: SyncTrigger,
  options: SyncOptions = {},
): Promise<{ runId: string }> {
  const connection = await getProviderConnectionByIdForUser(connectionId, userId);
  if (!connection) {
    throw new Error('Provider connection not found.');
  }

  const run = await createProviderSyncRun(connection.id, trigger);
  await executeSyncRun(connection, run.id, trigger, options);

  return { runId: run.id };
}

export async function enqueueProviderSyncByTenant(
  provider: ProviderConnection['provider'],
  tenantId: string,
  trigger: SyncTrigger,
  options: SyncOptions = {},
): Promise<{ runId: string } | null> {
  const connection = await getProviderConnectionByProviderTenant(provider, tenantId);
  if (!connection) return null;

  const run = await createProviderSyncRun(connection.id, trigger);

  queueMicrotask(() => {
    void executeSyncRun(connection, run.id, trigger, options);
  });

  return { runId: run.id };
}
