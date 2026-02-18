import { query } from '../../db/index.js';
import {
  IntegrationConnectionSummary,
  IntegrationProvider,
  ProviderConnection,
  ProviderSyncRun,
  ProviderSyncState,
  SyncRunCounters,
  SyncRunStatus,
  SyncTrigger,
} from './types.js';

interface ProviderConnectionRow {
  id: string;
  user_id: string;
  provider: IntegrationProvider;
  tenant_id: string;
  tenant_name: string | null;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  token_expires_at: string | Date;
  scope: string | null;
  status: ProviderConnection['status'];
  metadata: Record<string, unknown> | null;
  created_at: string | Date;
  updated_at: string | Date;
}

interface ProviderSyncStateRow {
  connection_id: string;
  backfill_started_at: string | Date | null;
  backfill_completed_at: string | Date | null;
  last_cursor_utc: string | Date | null;
  cursor_payload: Record<string, unknown> | null;
  last_successful_sync_at: string | Date | null;
  last_error: string | null;
  updated_at: string | Date;
}

interface ProviderSyncRunRow {
  id: string;
  connection_id: string;
  trigger: SyncTrigger;
  status: SyncRunStatus;
  orders_upserted: number;
  orders_deleted: number;
  items_upserted: number;
  api_calls: number;
  started_at: string | Date;
  finished_at: string | Date | null;
  error: string | null;
}

interface ConnectionSummaryRow {
  id: string;
  provider: IntegrationProvider;
  tenant_id: string;
  tenant_name: string | null;
  status: ProviderConnection['status'];
  token_expires_at: string | Date;
  created_at: string | Date;
  updated_at: string | Date;
  run_id: string | null;
  run_status: SyncRunStatus | null;
  run_trigger: SyncTrigger | null;
  run_started_at: string | Date | null;
  run_finished_at: string | Date | null;
  run_error: string | null;
}

export interface UpsertProviderConnectionInput {
  userId: string;
  provider: IntegrationProvider;
  tenantId: string;
  tenantName?: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string;
  tokenExpiresAt: Date;
  scope?: string;
  metadata?: Record<string, unknown>;
  status?: ProviderConnection['status'];
}

interface UpdateProviderConnectionTokensInput {
  id: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string;
  tokenExpiresAt: Date;
  scope?: string;
  status?: ProviderConnection['status'];
}

export interface UpsertSyncStateInput {
  connectionId: string;
  backfillStartedAt?: Date;
  backfillCompletedAt?: Date;
  lastCursorUtc?: Date;
  cursorPayload?: Record<string, unknown>;
  lastSuccessfulSyncAt?: Date;
  lastError?: string | null;
}

function asDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function mapConnection(row: ProviderConnectionRow): ProviderConnection {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name || undefined,
    accessTokenEncrypted: row.access_token_encrypted,
    refreshTokenEncrypted: row.refresh_token_encrypted,
    tokenExpiresAt: asDate(row.token_expires_at),
    scope: row.scope || undefined,
    status: row.status,
    metadata: row.metadata || undefined,
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
}

function mapSyncState(row: ProviderSyncStateRow): ProviderSyncState {
  return {
    connectionId: row.connection_id,
    backfillStartedAt: row.backfill_started_at ? asDate(row.backfill_started_at) : undefined,
    backfillCompletedAt: row.backfill_completed_at ? asDate(row.backfill_completed_at) : undefined,
    lastCursorUtc: row.last_cursor_utc ? asDate(row.last_cursor_utc) : undefined,
    cursorPayload: row.cursor_payload || undefined,
    lastSuccessfulSyncAt: row.last_successful_sync_at ? asDate(row.last_successful_sync_at) : undefined,
    lastError: row.last_error || undefined,
    updatedAt: asDate(row.updated_at),
  };
}

function mapSyncRun(row: ProviderSyncRunRow): ProviderSyncRun {
  return {
    id: row.id,
    connectionId: row.connection_id,
    trigger: row.trigger,
    status: row.status,
    ordersUpserted: Number(row.orders_upserted || 0),
    ordersDeleted: Number(row.orders_deleted || 0),
    itemsUpserted: Number(row.items_upserted || 0),
    apiCalls: Number(row.api_calls || 0),
    startedAt: asDate(row.started_at),
    finishedAt: row.finished_at ? asDate(row.finished_at) : undefined,
    error: row.error || undefined,
  };
}

export async function upsertProviderConnection(input: UpsertProviderConnectionInput): Promise<ProviderConnection> {
  const result = await query<ProviderConnectionRow>(
    `
      INSERT INTO provider_connections (
        user_id,
        provider,
        tenant_id,
        tenant_name,
        access_token_encrypted,
        refresh_token_encrypted,
        token_expires_at,
        scope,
        status,
        metadata
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (user_id, provider)
      DO UPDATE SET
        tenant_id = EXCLUDED.tenant_id,
        tenant_name = EXCLUDED.tenant_name,
        access_token_encrypted = EXCLUDED.access_token_encrypted,
        refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
        token_expires_at = EXCLUDED.token_expires_at,
        scope = EXCLUDED.scope,
        status = EXCLUDED.status,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
      RETURNING *
    `,
    [
      input.userId,
      input.provider,
      input.tenantId,
      input.tenantName || null,
      input.accessTokenEncrypted,
      input.refreshTokenEncrypted,
      input.tokenExpiresAt,
      input.scope || null,
      input.status || 'connected',
      input.metadata ? JSON.stringify(input.metadata) : null,
    ],
  );

  return mapConnection(result.rows[0]);
}

export async function updateProviderConnectionTokens(
  input: UpdateProviderConnectionTokensInput,
): Promise<ProviderConnection | null> {
  const result = await query<ProviderConnectionRow>(
    `
      UPDATE provider_connections
      SET
        access_token_encrypted = $2,
        refresh_token_encrypted = $3,
        token_expires_at = $4,
        scope = COALESCE($5, scope),
        status = COALESCE($6, status),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [
      input.id,
      input.accessTokenEncrypted,
      input.refreshTokenEncrypted,
      input.tokenExpiresAt,
      input.scope || null,
      input.status || null,
    ],
  );

  if (!result.rows.length) return null;
  return mapConnection(result.rows[0]);
}

export async function markProviderConnectionStatus(
  connectionId: string,
  status: ProviderConnection['status'],
): Promise<void> {
  await query(
    `UPDATE provider_connections SET status = $2, updated_at = NOW() WHERE id = $1`,
    [connectionId, status],
  );
}

export async function getProviderConnectionByIdForUser(
  connectionId: string,
  userId: string,
): Promise<ProviderConnection | null> {
  const result = await query<ProviderConnectionRow>(
    `SELECT * FROM provider_connections WHERE id = $1 AND user_id = $2`,
    [connectionId, userId],
  );
  if (!result.rows.length) return null;
  return mapConnection(result.rows[0]);
}

export async function getProviderConnectionByProviderTenant(
  provider: IntegrationProvider,
  tenantId: string,
): Promise<ProviderConnection | null> {
  const result = await query<ProviderConnectionRow>(
    `SELECT * FROM provider_connections WHERE provider = $1 AND tenant_id = $2 AND status = 'connected'`,
    [provider, tenantId],
  );
  if (!result.rows.length) return null;
  return mapConnection(result.rows[0]);
}

export async function listProviderConnectionsForUser(
  userId: string,
): Promise<IntegrationConnectionSummary[]> {
  const result = await query<ConnectionSummaryRow>(
    `
      SELECT
        pc.id,
        pc.provider,
        pc.tenant_id,
        pc.tenant_name,
        pc.status,
        pc.token_expires_at,
        pc.created_at,
        pc.updated_at,
        latest.id AS run_id,
        latest.status AS run_status,
        latest."trigger" AS run_trigger,
        latest.started_at AS run_started_at,
        latest.finished_at AS run_finished_at,
        latest.error AS run_error
      FROM provider_connections pc
      LEFT JOIN LATERAL (
        SELECT id, status, "trigger", started_at, finished_at, error
        FROM provider_sync_runs
        WHERE connection_id = pc.id
        ORDER BY started_at DESC
        LIMIT 1
      ) latest ON true
      WHERE pc.user_id = $1
      ORDER BY pc.provider ASC
    `,
    [userId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name || undefined,
    status: row.status,
    tokenExpiresAt: asDate(row.token_expires_at),
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
    lastRun: row.run_id
      ? {
        id: row.run_id,
        status: row.run_status!,
        trigger: row.run_trigger!,
        startedAt: asDate(row.run_started_at!),
        finishedAt: row.run_finished_at ? asDate(row.run_finished_at) : undefined,
        error: row.run_error || undefined,
      }
      : undefined,
  }));
}

export async function listActiveProviderConnections(): Promise<ProviderConnection[]> {
  const result = await query<ProviderConnectionRow>(
    `SELECT * FROM provider_connections WHERE status = 'connected' ORDER BY updated_at ASC`,
  );
  return result.rows.map(mapConnection);
}

export async function deleteProviderConnectionForUser(connectionId: string, userId: string): Promise<boolean> {
  const result = await query(
    `DELETE FROM provider_connections WHERE id = $1 AND user_id = $2`,
    [connectionId, userId],
  );
  return (result.rowCount || 0) > 0;
}

export async function createProviderSyncRun(
  connectionId: string,
  trigger: SyncTrigger,
): Promise<ProviderSyncRun> {
  const result = await query<ProviderSyncRunRow>(
    `
      INSERT INTO provider_sync_runs (connection_id, "trigger", status)
      VALUES ($1, $2, 'running')
      RETURNING *
    `,
    [connectionId, trigger],
  );

  return mapSyncRun(result.rows[0]);
}

export async function completeProviderSyncRun(
  runId: string,
  status: Exclude<SyncRunStatus, 'running'>,
  counters: SyncRunCounters,
  error?: string,
): Promise<void> {
  await query(
    `
      UPDATE provider_sync_runs
      SET
        status = $2,
        orders_upserted = $3,
        orders_deleted = $4,
        items_upserted = $5,
        api_calls = $6,
        error = $7,
        finished_at = NOW()
      WHERE id = $1
    `,
    [
      runId,
      status,
      counters.ordersUpserted,
      counters.ordersDeleted,
      counters.itemsUpserted,
      counters.apiCalls,
      error || null,
    ],
  );
}

export async function listProviderSyncRunsForConnection(
  connectionId: string,
  userId: string,
  limit = 20,
): Promise<ProviderSyncRun[]> {
  const result = await query<ProviderSyncRunRow>(
    `
      SELECT runs.*
      FROM provider_sync_runs runs
      JOIN provider_connections conn ON conn.id = runs.connection_id
      WHERE runs.connection_id = $1 AND conn.user_id = $2
      ORDER BY runs.started_at DESC
      LIMIT $3
    `,
    [connectionId, userId, limit],
  );

  return result.rows.map(mapSyncRun);
}

export async function getProviderSyncState(connectionId: string): Promise<ProviderSyncState | null> {
  const result = await query<ProviderSyncStateRow>(
    `SELECT * FROM provider_sync_state WHERE connection_id = $1`,
    [connectionId],
  );
  if (!result.rows.length) return null;
  return mapSyncState(result.rows[0]);
}

export async function upsertProviderSyncState(input: UpsertSyncStateInput): Promise<void> {
  await query(
    `
      INSERT INTO provider_sync_state (
        connection_id,
        backfill_started_at,
        backfill_completed_at,
        last_cursor_utc,
        cursor_payload,
        last_successful_sync_at,
        last_error
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (connection_id)
      DO UPDATE SET
        backfill_started_at = COALESCE(EXCLUDED.backfill_started_at, provider_sync_state.backfill_started_at),
        backfill_completed_at = COALESCE(EXCLUDED.backfill_completed_at, provider_sync_state.backfill_completed_at),
        last_cursor_utc = COALESCE(EXCLUDED.last_cursor_utc, provider_sync_state.last_cursor_utc),
        cursor_payload = COALESCE(EXCLUDED.cursor_payload, provider_sync_state.cursor_payload),
        last_successful_sync_at = COALESCE(EXCLUDED.last_successful_sync_at, provider_sync_state.last_successful_sync_at),
        last_error = EXCLUDED.last_error,
        updated_at = NOW()
    `,
    [
      input.connectionId,
      input.backfillStartedAt || null,
      input.backfillCompletedAt || null,
      input.lastCursorUtc || null,
      input.cursorPayload ? JSON.stringify(input.cursorPayload) : null,
      input.lastSuccessfulSyncAt || null,
      input.lastError ?? null,
    ],
  );
}

export async function insertWebhookEvent(
  provider: IntegrationProvider,
  providerEventId: string,
  payload: Record<string, unknown>,
  connectionId: string | null,
  signatureValid: boolean,
): Promise<{ inserted: boolean; eventId: string | null }> {
  const inserted = await query<{ id: string }>(
    `
      INSERT INTO provider_webhook_events (provider, provider_event_id, connection_id, signature_valid, payload, status)
      VALUES ($1,$2,$3,$4,$5,'received')
      ON CONFLICT (provider, provider_event_id) DO NOTHING
      RETURNING id
    `,
    [provider, providerEventId, connectionId, signatureValid, JSON.stringify(payload)],
  );

  if (inserted.rows.length) {
    return { inserted: true, eventId: inserted.rows[0].id };
  }

  const existing = await query<{ id: string }>(
    `SELECT id FROM provider_webhook_events WHERE provider = $1 AND provider_event_id = $2`,
    [provider, providerEventId],
  );

  return { inserted: false, eventId: existing.rows[0]?.id || null };
}

export async function markWebhookEventProcessed(
  eventId: string,
  status: 'processed' | 'ignored' | 'failed',
): Promise<void> {
  await query(
    `
      UPDATE provider_webhook_events
      SET status = $2, processed_at = NOW()
      WHERE id = $1
    `,
    [eventId, status],
  );
}
