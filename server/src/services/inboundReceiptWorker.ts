import crypto from 'node:crypto';
import { query } from '../db/index.js';
import { appLogger } from '../middleware/requestLogger.js';
import { cognitoService } from './cognito.js';
import { ArdaActor, ardaService } from './arda.js';
import {
  analyzeEmailWithRetry,
  createGeminiExtractionModel,
  EmailExtractionResult,
  normalizeOrderDate,
} from './emailExtraction.js';

type InboundReceiptStatus = 'received' | 'processing' | 'retry' | 'quarantined' | 'synced' | 'failed';
type InboundAttemptStatus = 'processing' | 'retry' | 'quarantined' | 'synced' | 'failed';

interface InboundReceiptRow {
  id: string;
  provider: string;
  provider_message_id: string | null;
  message_id: string | null;
  idempotency_key: string;
  from_email: string;
  from_name: string | null;
  subject: string | null;
  source_recipient: string | null;
  email_date: string | null;
  raw_headers: unknown;
  raw_text_body: string | null;
  raw_html_body: string | null;
  content_hash: string;
  status: InboundReceiptStatus;
  guardrail_reason: string | null;
  resolved_user_email: string | null;
  resolved_author: string | null;
  resolved_tenant_id: string | null;
  extracted_data: unknown;
  arda_order_record_id: string | null;
  arda_item_record_ids: unknown;
  duplicate_of_event_id: string | null;
  attempt_count: number;
  next_attempt_at: string;
  last_error: string | null;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface InboundStatusRow {
  id: string;
  provider: string;
  provider_message_id: string | null;
  message_id: string | null;
  from_email: string;
  subject: string | null;
  status: InboundReceiptStatus;
  guardrail_reason: string | null;
  resolved_user_email: string | null;
  resolved_author: string | null;
  resolved_tenant_id: string | null;
  attempt_count: number;
  next_attempt_at: string;
  last_error: string | null;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
  arda_order_record_id: string | null;
  arda_item_count: number;
}

export interface PostmarkInboundAddress {
  Email?: string;
  Name?: string;
  MailboxHash?: string;
}

export interface PostmarkInboundPayload {
  MessageID?: string;
  Subject?: string;
  Date?: string;
  From?: string;
  FromName?: string;
  FromFull?: PostmarkInboundAddress;
  To?: string;
  TextBody?: string;
  HtmlBody?: string;
  StrippedTextReply?: string;
  Headers?: Array<{ Name?: string; Value?: string }>;
  [key: string]: unknown;
}

export interface NormalizedPostmarkPayload {
  provider: 'postmark';
  providerMessageId: string | null;
  messageId: string | null;
  fromEmail: string;
  fromName: string | null;
  subject: string;
  sourceRecipient: string | null;
  emailDate: string | null;
  rawHeaders: unknown;
  rawTextBody: string;
  rawHtmlBody: string;
  contentHash: string;
  idempotencyKey: string;
}

export interface EnqueueInboundResult {
  eventId: string;
  duplicate: boolean;
  status: InboundReceiptStatus;
}

export interface InboundStatusResponse {
  eventId: string;
  provider: string;
  providerMessageId: string | null;
  messageId: string | null;
  fromEmail: string;
  subject: string | null;
  status: InboundReceiptStatus;
  guardrailReason: string | null;
  resolvedUserEmail: string | null;
  resolvedAuthor: string | null;
  resolvedTenantId: string | null;
  attemptCount: number;
  nextAttemptAt: string;
  lastError: string | null;
  processedAt: string | null;
  createdAt: string;
  updatedAt: string;
  ardaOrderRecordId: string | null;
  ardaItemCount: number;
}

export interface InboundGuardrailEvaluation {
  pass: boolean;
  reason?: 'not_order' | 'no_items' | 'low_confidence' | 'duplicate';
}

export interface ResolvedInboundActor {
  actor: ArdaActor;
  source: 'cognito' | 'provisioned';
}

let processTimer: ReturnType<typeof setInterval> | null = null;
let purgeTimer: ReturnType<typeof setInterval> | null = null;
let isProcessing = false;
let immediateProcessTimer: ReturnType<typeof setTimeout> | null = null;
let extractionModel: ReturnType<typeof createGeminiExtractionModel> | null = null;

const PROCESS_INTERVAL_MS = 3_000;
const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;

function getInboundBatchSize(): number {
  return Number(process.env.INBOUND_PROCESS_BATCH_SIZE || '10');
}

function getInboundConfidenceThreshold(): number {
  return Number(process.env.INBOUND_CONFIDENCE_THRESHOLD || '0.78');
}

function getInboundMaxRetries(): number {
  return Number(process.env.INBOUND_MAX_RETRIES || '5');
}

function getInboundRetentionDays(): number {
  return Number(process.env.INBOUND_RETENTION_DAYS || '30');
}

function getExtractionModel() {
  if (!extractionModel) {
    extractionModel = createGeminiExtractionModel();
  }
  return extractionModel;
}

function parseEmailAddress(input?: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  const angleMatch = trimmed.match(/<([^>]+)>/);
  if (angleMatch?.[1]) {
    return angleMatch[1].trim().toLowerCase();
  }
  if (trimmed.includes('@')) {
    return trimmed.toLowerCase();
  }
  return null;
}

function normalizeMessageId(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^<|>$/g, '');
}

function computeContentHash(parts: string[]): string {
  return crypto.createHash('sha256').update(parts.join('\n')).digest('hex');
}

function buildIdempotencyKey(messageId: string | null, contentHash: string): string {
  return messageId ? `postmark:${messageId}` : `postmark:${contentHash}`;
}

function inferSupplierFromEmail(email: string): string {
  const domain = email.split('@')[1] || '';
  const base = domain.split('.')[0] || 'Unknown';
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function computeRetryDelayMs(attemptNumber: number): number {
  const minute = 60 * 1000;
  return Math.min(60 * minute, Math.pow(2, Math.max(0, attemptNumber - 1)) * minute);
}

export function evaluateInboundGuardrails(
  result: Pick<EmailExtractionResult, 'isOrder' | 'confidence' | 'items'>,
  threshold: number
): InboundGuardrailEvaluation {
  if (!result.isOrder) {
    return { pass: false, reason: 'not_order' };
  }
  if (!Array.isArray(result.items) || result.items.length === 0) {
    return { pass: false, reason: 'no_items' };
  }
  if (typeof result.confidence !== 'number' || result.confidence < threshold) {
    return { pass: false, reason: 'low_confidence' };
  }
  return { pass: true };
}

export function isTransientInboundError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('econnreset') ||
    message.includes('eai_again') ||
    message.includes('rate limit') ||
    message.includes('429') ||
    message.includes('502') ||
    message.includes('503') ||
    message.includes('504')
  );
}

export function normalizePostmarkPayload(payload: PostmarkInboundPayload): NormalizedPostmarkPayload {
  const messageId = normalizeMessageId(
    typeof payload.MessageID === 'string' ? payload.MessageID : null
  );

  const fromEmail = (
    payload.FromFull?.Email?.trim().toLowerCase() ||
    parseEmailAddress(typeof payload.From === 'string' ? payload.From : '') ||
    ''
  );
  const fromName = (payload.FromFull?.Name || payload.FromName || null)?.trim() || null;
  const subject = (typeof payload.Subject === 'string' ? payload.Subject : '').trim();
  const rawTextBody = (
    typeof payload.TextBody === 'string'
      ? payload.TextBody
      : (typeof payload.StrippedTextReply === 'string' ? payload.StrippedTextReply : '')
  ).trim();
  const rawHtmlBody = (typeof payload.HtmlBody === 'string' ? payload.HtmlBody : '').trim();
  const sourceRecipient = (typeof payload.To === 'string' ? payload.To : null)?.trim() || null;
  const emailDate = (typeof payload.Date === 'string' ? payload.Date : null)?.trim() || null;

  const contentHash = computeContentHash([
    fromEmail,
    subject,
    emailDate || '',
    rawTextBody,
    rawHtmlBody,
  ]);

  return {
    provider: 'postmark',
    providerMessageId: messageId,
    messageId,
    fromEmail,
    fromName,
    subject,
    sourceRecipient,
    emailDate,
    rawHeaders: payload.Headers || [],
    rawTextBody,
    rawHtmlBody,
    contentHash,
    idempotencyKey: buildIdempotencyKey(messageId, contentHash),
  };
}

export async function enqueuePostmarkInboundReceipt(payload: PostmarkInboundPayload): Promise<EnqueueInboundResult> {
  const normalized = normalizePostmarkPayload(payload);
  if (!normalized.fromEmail) {
    throw new Error('Invalid Postmark payload: missing sender email');
  }

  const insertResult = await query<{ id: string; status: InboundReceiptStatus }>(
    `
    INSERT INTO inbound_receipts (
      provider,
      provider_message_id,
      message_id,
      idempotency_key,
      from_email,
      from_name,
      subject,
      source_recipient,
      email_date,
      raw_headers,
      raw_text_body,
      raw_html_body,
      content_hash,
      status,
      next_attempt_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      CASE WHEN $9::text IS NOT NULL THEN $9::timestamptz ELSE NULL END,
      $10::jsonb, $11, $12, $13, 'received', NOW()
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id, status
    `,
    [
      normalized.provider,
      normalized.providerMessageId,
      normalized.messageId,
      normalized.idempotencyKey,
      normalized.fromEmail,
      normalized.fromName,
      normalized.subject,
      normalized.sourceRecipient,
      normalized.emailDate,
      JSON.stringify(normalized.rawHeaders),
      normalized.rawTextBody,
      normalized.rawHtmlBody,
      normalized.contentHash,
    ]
  );

  if (insertResult.rowCount && insertResult.rows[0]) {
    const inserted = insertResult.rows[0];
    appLogger.info(
      { eventId: inserted.id, senderEmail: normalized.fromEmail, status: inserted.status, attempt: 0 },
      'Inbound receipt accepted'
    );
    triggerInboundProcessing();
    return { eventId: inserted.id, duplicate: false, status: inserted.status };
  }

  const existingResult = await query<{ id: string; status: InboundReceiptStatus }>(
    `
    SELECT id, status
    FROM inbound_receipts
    WHERE idempotency_key = $1
    LIMIT 1
    `,
    [normalized.idempotencyKey]
  );

  if (!existingResult.rowCount || !existingResult.rows[0]) {
    throw new Error('Failed to resolve existing inbound receipt');
  }

  const existing = existingResult.rows[0];
  appLogger.info(
    { eventId: existing.id, senderEmail: normalized.fromEmail, status: existing.status, attempt: 0 },
    'Inbound receipt duplicate ignored by idempotency key'
  );
  return { eventId: existing.id, duplicate: true, status: existing.status };
}

export async function getInboundReceiptStatus(eventId: string): Promise<InboundStatusResponse | null> {
  const result = await query<InboundStatusRow>(
    `
    SELECT
      id,
      provider,
      provider_message_id,
      message_id,
      from_email,
      subject,
      status,
      guardrail_reason,
      resolved_user_email,
      resolved_author,
      resolved_tenant_id,
      attempt_count,
      next_attempt_at,
      last_error,
      processed_at,
      created_at,
      updated_at,
      arda_order_record_id,
      COALESCE(jsonb_array_length(arda_item_record_ids), 0)::int AS arda_item_count
    FROM inbound_receipts
    WHERE id = $1
    LIMIT 1
    `,
    [eventId]
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    eventId: row.id,
    provider: row.provider,
    providerMessageId: row.provider_message_id,
    messageId: row.message_id,
    fromEmail: row.from_email,
    subject: row.subject,
    status: row.status,
    guardrailReason: row.guardrail_reason,
    resolvedUserEmail: row.resolved_user_email,
    resolvedAuthor: row.resolved_author,
    resolvedTenantId: row.resolved_tenant_id,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
    processedAt: row.processed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ardaOrderRecordId: row.arda_order_record_id,
    ardaItemCount: row.arda_item_count,
  };
}

export async function resolveInboundActorForSender(senderEmail: string): Promise<ResolvedInboundActor | null> {
  const normalizedEmail = senderEmail.trim().toLowerCase();
  const cached = cognitoService.getUserByEmail(normalizedEmail);
  if (cached?.sub && cached.tenantId) {
    return {
      actor: {
        author: cached.sub,
        email: normalizedEmail,
        tenantId: cached.tenantId,
      },
      source: 'cognito',
    };
  }

  const provisioned = await ardaService.provisionUserForEmail(normalizedEmail);
  if (provisioned?.author && provisioned.tenantId) {
    return {
      actor: {
        author: provisioned.author,
        email: provisioned.email || normalizedEmail,
        tenantId: provisioned.tenantId,
      },
      source: 'provisioned',
    };
  }

  return null;
}

async function isDuplicateForResolvedUser(
  receiptId: string,
  resolvedUserEmail: string,
  messageId: string | null,
  contentHash: string
): Promise<string | null> {
  const duplicateResult = await query<{ id: string }>(
    `
    SELECT id
    FROM inbound_receipts
    WHERE id <> $1
      AND resolved_user_email = $2
      AND status IN ('processing', 'retry', 'quarantined', 'synced', 'failed')
      AND (
        ($3::text IS NOT NULL AND message_id = $3)
        OR content_hash = $4
      )
    ORDER BY created_at ASC
    LIMIT 1
    `,
    [receiptId, resolvedUserEmail, messageId, contentHash]
  );
  return duplicateResult.rows[0]?.id || null;
}

async function insertReceiptAttempt(
  receiptId: string,
  attemptNumber: number,
  status: InboundAttemptStatus,
  error: string | null,
  metadata: unknown
): Promise<void> {
  await query(
    `
    INSERT INTO inbound_receipt_attempts (
      receipt_id,
      attempt_number,
      status,
      error,
      metadata
    ) VALUES ($1, $2, $3, $4, $5::jsonb)
    `,
    [receiptId, attemptNumber, status, error, JSON.stringify(metadata || {})]
  );
}

async function markReceiptQuarantined(params: {
  row: InboundReceiptRow;
  attemptNumber: number;
  reason: string;
  actor?: ArdaActor;
  extractedData?: unknown;
  duplicateOfEventId?: string | null;
}): Promise<void> {
  await query(
    `
    UPDATE inbound_receipts
    SET
      status = 'quarantined',
      guardrail_reason = $2,
      resolved_user_email = COALESCE($3, resolved_user_email),
      resolved_author = COALESCE($4, resolved_author),
      resolved_tenant_id = COALESCE($5, resolved_tenant_id),
      extracted_data = COALESCE($6::jsonb, extracted_data),
      duplicate_of_event_id = COALESCE($7::uuid, duplicate_of_event_id),
      attempt_count = $8,
      last_error = NULL,
      next_attempt_at = NOW(),
      processed_at = NOW(),
      updated_at = NOW()
    WHERE id = $1
    `,
    [
      params.row.id,
      params.reason,
      params.actor?.email || null,
      params.actor?.author || null,
      params.actor?.tenantId || null,
      params.extractedData ? JSON.stringify(params.extractedData) : null,
      params.duplicateOfEventId || null,
      params.attemptNumber,
    ]
  );

  await insertReceiptAttempt(params.row.id, params.attemptNumber, 'quarantined', null, {
    reason: params.reason,
    duplicateOfEventId: params.duplicateOfEventId || null,
  });
}

async function markReceiptSynced(params: {
  row: InboundReceiptRow;
  attemptNumber: number;
  actor: ArdaActor;
  extractedData: unknown;
  orderRecordId: string;
  itemRecordIds: string[];
}): Promise<void> {
  await query(
    `
    UPDATE inbound_receipts
    SET
      status = 'synced',
      guardrail_reason = NULL,
      resolved_user_email = $2,
      resolved_author = $3,
      resolved_tenant_id = $4,
      extracted_data = $5::jsonb,
      arda_order_record_id = $6,
      arda_item_record_ids = $7::jsonb,
      attempt_count = $8,
      last_error = NULL,
      next_attempt_at = NOW(),
      processed_at = NOW(),
      updated_at = NOW()
    WHERE id = $1
    `,
    [
      params.row.id,
      params.actor.email || null,
      params.actor.author,
      params.actor.tenantId || null,
      JSON.stringify(params.extractedData),
      params.orderRecordId,
      JSON.stringify(params.itemRecordIds),
      params.attemptNumber,
    ]
  );

  await insertReceiptAttempt(params.row.id, params.attemptNumber, 'synced', null, {
    orderRecordId: params.orderRecordId,
    itemCount: params.itemRecordIds.length,
  });
}

async function markReceiptRetry(params: {
  row: InboundReceiptRow;
  attemptNumber: number;
  errorMessage: string;
  actor?: ArdaActor;
}): Promise<void> {
  const retryAt = new Date(Date.now() + computeRetryDelayMs(params.attemptNumber));
  await query(
    `
    UPDATE inbound_receipts
    SET
      status = 'retry',
      resolved_user_email = COALESCE($2, resolved_user_email),
      resolved_author = COALESCE($3, resolved_author),
      resolved_tenant_id = COALESCE($4, resolved_tenant_id),
      attempt_count = $5,
      last_error = $6,
      next_attempt_at = $7::timestamptz,
      processed_at = NULL,
      updated_at = NOW()
    WHERE id = $1
    `,
    [
      params.row.id,
      params.actor?.email || null,
      params.actor?.author || null,
      params.actor?.tenantId || null,
      params.attemptNumber,
      params.errorMessage,
      retryAt.toISOString(),
    ]
  );

  await insertReceiptAttempt(params.row.id, params.attemptNumber, 'retry', params.errorMessage, {
    retryAt: retryAt.toISOString(),
  });
}

async function markReceiptFailed(params: {
  row: InboundReceiptRow;
  attemptNumber: number;
  errorMessage: string;
  actor?: ArdaActor;
}): Promise<void> {
  await query(
    `
    UPDATE inbound_receipts
    SET
      status = 'failed',
      resolved_user_email = COALESCE($2, resolved_user_email),
      resolved_author = COALESCE($3, resolved_author),
      resolved_tenant_id = COALESCE($4, resolved_tenant_id),
      attempt_count = $5,
      last_error = $6,
      next_attempt_at = NOW(),
      processed_at = NOW(),
      updated_at = NOW()
    WHERE id = $1
    `,
    [
      params.row.id,
      params.actor?.email || null,
      params.actor?.author || null,
      params.actor?.tenantId || null,
      params.attemptNumber,
      params.errorMessage,
    ]
  );

  await insertReceiptAttempt(params.row.id, params.attemptNumber, 'failed', params.errorMessage, {});
}

async function claimInboundReceipt(): Promise<InboundReceiptRow | null> {
  const claimResult = await query<InboundReceiptRow>(
    `
    WITH next_receipt AS (
      SELECT id
      FROM inbound_receipts
      WHERE status IN ('received', 'retry')
        AND next_attempt_at <= NOW()
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE inbound_receipts r
    SET status = 'processing', updated_at = NOW()
    FROM next_receipt
    WHERE r.id = next_receipt.id
    RETURNING r.*
    `
  );

  return claimResult.rows[0] || null;
}

async function processClaimedReceipt(row: InboundReceiptRow): Promise<void> {
  const attemptNumber = row.attempt_count + 1;
  let resolvedActor: ArdaActor | undefined;
  let extractedResult: EmailExtractionResult | null = null;

  try {
    const actorResolution = await resolveInboundActorForSender(row.from_email);
    if (!actorResolution) {
      await markReceiptQuarantined({
        row,
        attemptNumber,
        reason: 'unmapped_sender',
      });
      appLogger.info(
        { eventId: row.id, senderEmail: row.from_email, status: 'quarantined', attempt: attemptNumber },
        'Inbound receipt quarantined due to unmapped sender'
      );
      return;
    }

    resolvedActor = actorResolution.actor;
    const duplicateOfEventId = await isDuplicateForResolvedUser(
      row.id,
      resolvedActor.email || row.from_email,
      row.message_id,
      row.content_hash
    );
    if (duplicateOfEventId) {
      await markReceiptQuarantined({
        row,
        attemptNumber,
        reason: 'duplicate',
        actor: resolvedActor,
        duplicateOfEventId,
      });
      appLogger.info(
        {
          eventId: row.id,
          senderEmail: row.from_email,
          resolvedUserEmail: resolvedActor.email,
          status: 'quarantined',
          attempt: attemptNumber,
        },
        'Inbound receipt quarantined as duplicate'
      );
      return;
    }

    const emailBody = row.raw_text_body || row.raw_html_body || '';
    const extractionInput = {
      id: row.id,
      subject: row.subject || '',
      sender: row.from_email,
      body: emailBody,
      date: row.email_date || undefined,
    };

    extractedResult = await analyzeEmailWithRetry(getExtractionModel() as any, extractionInput);

    const normalizedItems = (extractedResult.items || [])
      .map((item): { name: string; quantity: number; unit: string; unitPrice: number | null; sku?: string } | null => {
        if (!item || typeof item !== 'object') return null;
        const name = typeof item.name === 'string' ? item.name.trim() : '';
        if (!name) return null;
        const quantityRaw = Number((item as any).quantity);
        const quantity = Number.isFinite(quantityRaw) && quantityRaw > 0 ? quantityRaw : 1;
        const unit = typeof (item as any).unit === 'string' && (item as any).unit.trim()
          ? (item as any).unit.trim()
          : 'ea';
        const unitPriceRaw = (item as any).unitPrice;
        const unitPrice = typeof unitPriceRaw === 'number'
          ? unitPriceRaw
          : (typeof unitPriceRaw === 'string' ? Number(unitPriceRaw) : null);
        const sku = (typeof (item as any).partNumber === 'string' && (item as any).partNumber.trim())
          ? (item as any).partNumber.trim()
          : ((typeof (item as any).sku === 'string' && (item as any).sku.trim()) ? (item as any).sku.trim() : undefined);
        return { name, quantity, unit, unitPrice: Number.isFinite(unitPrice as number) ? (unitPrice as number) : null, sku };
      })
      .filter((item): item is { name: string; quantity: number; unit: string; unitPrice: number | null; sku?: string } => Boolean(item));

    extractedResult = {
      ...extractedResult,
      items: normalizedItems,
    };

    const guardrailEvaluation = evaluateInboundGuardrails(extractedResult, getInboundConfidenceThreshold());
    if (!guardrailEvaluation.pass) {
      await markReceiptQuarantined({
        row,
        attemptNumber,
        reason: guardrailEvaluation.reason || 'unknown_guardrail',
        actor: resolvedActor,
        extractedData: extractedResult,
      });
      appLogger.info(
        {
          eventId: row.id,
          senderEmail: row.from_email,
          resolvedUserEmail: resolvedActor.email,
          status: 'quarantined',
          attempt: attemptNumber,
        },
        'Inbound receipt quarantined by guardrail'
      );
      return;
    }

    const supplier = extractedResult.supplier || inferSupplierFromEmail(row.from_email);
    const orderDate = normalizeOrderDate(extractedResult.orderDate, row.email_date || undefined);

    const orderRecord = await ardaService.createOrder(
      {
        orderDate: {
          utcTimestamp: new Date(orderDate).getTime(),
        },
        allowPartial: false,
        expedite: false,
        supplierName: supplier,
        notes: `Forwarded receipt ${row.message_id || row.id}`,
        taxesAndFees: {},
      },
      resolvedActor
    );

    const itemRecordIds: string[] = [];
    for (const item of normalizedItems) {
      const itemRecord = await ardaService.createItem(
        {
          name: item.name,
          primarySupplier: supplier,
          orderMechanism: 'email',
          minQty: 1,
          minQtyUnit: item.unit || 'ea',
          orderQty: item.quantity || 1,
          orderQtyUnit: item.unit || 'ea',
          sku: item.sku,
        },
        resolvedActor
      );
      itemRecordIds.push(itemRecord.rId);
    }

    await markReceiptSynced({
      row,
      attemptNumber,
      actor: resolvedActor,
      extractedData: {
        ...extractedResult,
        supplier,
        orderDate,
      },
      orderRecordId: orderRecord.rId,
      itemRecordIds,
    });

    appLogger.info(
      {
        eventId: row.id,
        senderEmail: row.from_email,
        resolvedUserEmail: resolvedActor.email,
        status: 'synced',
        attempt: attemptNumber,
      },
      'Inbound receipt synced to Arda'
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const transient = isTransientInboundError(error);
    if (transient && attemptNumber < getInboundMaxRetries()) {
      await markReceiptRetry({
        row,
        attemptNumber,
        errorMessage: message,
        actor: resolvedActor,
      });
      appLogger.warn(
        {
          eventId: row.id,
          senderEmail: row.from_email,
          resolvedUserEmail: resolvedActor?.email,
          status: 'retry',
          attempt: attemptNumber,
        },
        'Inbound receipt processing failed transiently; scheduled retry'
      );
      return;
    }

    await markReceiptFailed({
      row,
      attemptNumber,
      errorMessage: message,
      actor: resolvedActor,
    });
    appLogger.error(
      {
        eventId: row.id,
        senderEmail: row.from_email,
        resolvedUserEmail: resolvedActor?.email,
        status: 'failed',
        attempt: attemptNumber,
      },
      'Inbound receipt processing failed'
    );
  }
}

export async function processInboundReceiptBatch(): Promise<number> {
  const batchSize = getInboundBatchSize();
  let processed = 0;

  for (let i = 0; i < batchSize; i++) {
    const claimed = await claimInboundReceipt();
    if (!claimed) break;
    await processClaimedReceipt(claimed);
    processed += 1;
  }

  return processed;
}

export async function purgeExpiredInboundRawContent(): Promise<number> {
  const retentionDays = getInboundRetentionDays();
  const result = await query<{ id: string }>(
    `
    UPDATE inbound_receipts
    SET
      raw_headers = NULL,
      raw_text_body = NULL,
      raw_html_body = NULL,
      updated_at = NOW()
    WHERE created_at < NOW() - ($1::text || ' days')::interval
      AND (raw_headers IS NOT NULL OR raw_text_body IS NOT NULL OR raw_html_body IS NOT NULL)
    RETURNING id
    `,
    [retentionDays]
  );
  return result.rowCount || 0;
}

export async function runInboundWorkerTick(): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;
  try {
    await processInboundReceiptBatch();
  } catch (error) {
    appLogger.error({ err: error }, 'Inbound worker tick failed');
  } finally {
    isProcessing = false;
  }
}

function scheduleInboundWorkerTick(): void {
  void runInboundWorkerTick();
}

function scheduleInboundPurge(): void {
  void purgeExpiredInboundRawContent().catch((error) => {
    appLogger.error({ err: error }, 'Inbound raw-content purge failed');
  });
}

export function triggerInboundProcessing(): void {
  if (immediateProcessTimer) return;
  immediateProcessTimer = setTimeout(() => {
    immediateProcessTimer = null;
    scheduleInboundWorkerTick();
  }, 50);
}

export function startInboundReceiptWorker(): void {
  if (processTimer) return;

  processTimer = setInterval(() => {
    scheduleInboundWorkerTick();
  }, PROCESS_INTERVAL_MS);

  purgeTimer = setInterval(() => {
    scheduleInboundPurge();
  }, PURGE_INTERVAL_MS);

  scheduleInboundWorkerTick();
  scheduleInboundPurge();
}

export function stopInboundReceiptWorker(): void {
  if (processTimer) {
    clearInterval(processTimer);
    processTimer = null;
  }
  if (purgeTimer) {
    clearInterval(purgeTimer);
    purgeTimer = null;
  }
  if (immediateProcessTimer) {
    clearTimeout(immediateProcessTimer);
    immediateProcessTimer = null;
  }
}
