import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockQuery = vi.fn();
const mockGetUserByEmail = vi.fn();
const mockProvisionUserForEmail = vi.fn();

vi.mock('../db/index.js', () => ({
  query: mockQuery,
}));

vi.mock('./cognito.js', () => ({
  cognitoService: {
    getUserByEmail: mockGetUserByEmail,
  },
}));

vi.mock('./arda.js', () => ({
  ardaService: {
    provisionUserForEmail: mockProvisionUserForEmail,
    createOrder: vi.fn(),
    createItem: vi.fn(),
  },
}));

describe('inboundReceiptWorker helpers', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(async () => {
    process.env = originalEnv;
    const { stopInboundReceiptWorker } = await import('./inboundReceiptWorker.js');
    stopInboundReceiptWorker();
  });

  it('normalizes postmark payload and produces stable idempotency key', async () => {
    const { normalizePostmarkPayload } = await import('./inboundReceiptWorker.js');
    const payload = normalizePostmarkPayload({
      MessageID: '<abc123@example.com>',
      Subject: 'Your receipt',
      From: 'Sender <sender@example.com>',
      TextBody: 'Thanks for ordering',
      Headers: [{ Name: 'X-Test', Value: '1' }],
    });

    expect(payload.fromEmail).toBe('sender@example.com');
    expect(payload.messageId).toBe('abc123@example.com');
    expect(payload.idempotencyKey).toBe('postmark:abc123@example.com');
    expect(payload.contentHash).toHaveLength(64);
  });

  it('enqueues first payload and marks repeated payload as duplicate', async () => {
    const { enqueuePostmarkInboundReceipt } = await import('./inboundReceiptWorker.js');

    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'evt-1', status: 'received' }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'evt-1', status: 'received' }] });

    const payload = {
      MessageID: '<m-1@example.com>',
      Subject: 'Receipt',
      FromFull: { Email: 'sender@example.com' },
      TextBody: 'Thanks',
    };

    const first = await enqueuePostmarkInboundReceipt(payload);
    const second = await enqueuePostmarkInboundReceipt(payload);

    expect(first.duplicate).toBe(false);
    expect(first.eventId).toBe('evt-1');
    expect(second.duplicate).toBe(true);
    expect(second.eventId).toBe('evt-1');
  });

  it('resolves actor from cognito mapping first, then provision fallback', async () => {
    const { resolveInboundActorForSender } = await import('./inboundReceiptWorker.js');

    mockGetUserByEmail.mockReturnValueOnce({
      email: 'mapped@example.com',
      tenantId: 'tenant-1',
      sub: 'author-1',
    });
    const cognitoResolved = await resolveInboundActorForSender('mapped@example.com');
    expect(cognitoResolved?.source).toBe('cognito');
    expect(cognitoResolved?.actor.author).toBe('author-1');

    mockGetUserByEmail.mockReturnValueOnce(null);
    mockProvisionUserForEmail.mockResolvedValueOnce({
      author: 'provisioned-author',
      email: 'new@example.com',
      tenantId: 'tenant-2',
    });
    const provisionedResolved = await resolveInboundActorForSender('new@example.com');
    expect(provisionedResolved?.source).toBe('provisioned');
    expect(provisionedResolved?.actor.tenantId).toBe('tenant-2');
  });

  it('evaluates guardrails for low confidence and missing items', async () => {
    const { evaluateInboundGuardrails } = await import('./inboundReceiptWorker.js');

    const lowConfidence = evaluateInboundGuardrails(
      { isOrder: true, confidence: 0.5, items: [{ name: 'Item' }] },
      0.78
    );
    expect(lowConfidence.pass).toBe(false);
    expect(lowConfidence.reason).toBe('low_confidence');

    const noItems = evaluateInboundGuardrails(
      { isOrder: true, confidence: 0.9, items: [] },
      0.78
    );
    expect(noItems.pass).toBe(false);
    expect(noItems.reason).toBe('no_items');
  });

  it('purges raw content using configured retention days', async () => {
    const { purgeExpiredInboundRawContent } = await import('./inboundReceiptWorker.js');
    process.env.INBOUND_RETENTION_DAYS = '30';
    mockQuery.mockResolvedValueOnce({ rowCount: 2, rows: [{ id: 'a' }, { id: 'b' }] });

    const purged = await purgeExpiredInboundRawContent();
    expect(purged).toBe(2);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('UPDATE inbound_receipts'), [30]);
  });
});
