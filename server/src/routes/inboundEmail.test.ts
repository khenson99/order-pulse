import express from 'express';
import { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnqueuePostmarkInboundReceipt = vi.fn();
const mockGetInboundReceiptStatus = vi.fn();

vi.mock('../services/inboundReceiptWorker.js', () => ({
  enqueuePostmarkInboundReceipt: mockEnqueuePostmarkInboundReceipt,
  getInboundReceiptStatus: mockGetInboundReceiptStatus,
}));

const originalEnv = process.env;

function basicAuthHeader(username: string, password: string): string {
  const token = Buffer.from(`${username}:${password}`).toString('base64');
  return `Basic ${token}`;
}

async function startServer(): Promise<{ server: Server; baseUrl: string }> {
  const { default: inboundEmailRouter } = await import('./inboundEmail.js');
  const app = express();
  app.use(express.json());
  app.use('/api/inbound', inboundEmailRouter);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

describe('inboundEmail routes', () => {
  let server: Server | null = null;
  let baseUrl = '';

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      POSTMARK_INBOUND_USERNAME: 'postmark-user',
      POSTMARK_INBOUND_PASSWORD: 'postmark-pass',
    };
    ({ server, baseUrl } = await startServer());
  });

  afterEach(async () => {
    process.env = originalEnv;
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((err) => (err ? reject(err) : resolve()));
      });
      server = null;
    }
  });

  it('rejects webhook requests with missing auth', async () => {
    const response = await fetch(`${baseUrl}/api/inbound/postmark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(401);
    expect(mockEnqueuePostmarkInboundReceipt).not.toHaveBeenCalled();
  });

  it('rejects webhook requests with invalid auth', async () => {
    const response = await fetch(`${baseUrl}/api/inbound/postmark`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: basicAuthHeader('wrong', 'creds'),
      },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(401);
    expect(mockEnqueuePostmarkInboundReceipt).not.toHaveBeenCalled();
  });

  it('accepts valid postmark payloads and enqueues processing', async () => {
    mockEnqueuePostmarkInboundReceipt.mockResolvedValue({
      eventId: 'evt-1',
      duplicate: false,
      status: 'received',
    });

    const response = await fetch(`${baseUrl}/api/inbound/postmark`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: basicAuthHeader('postmark-user', 'postmark-pass'),
      },
      body: JSON.stringify({
        MessageID: '<abc123@example.com>',
        Subject: 'Receipt',
        FromFull: { Email: 'sender@example.com', Name: 'Sender' },
        TextBody: 'Thanks for your order',
      }),
    });

    expect(response.status).toBe(202);
    expect(mockEnqueuePostmarkInboundReceipt).toHaveBeenCalledTimes(1);
    const body = await response.json() as { accepted: boolean; eventId: string };
    expect(body.accepted).toBe(true);
    expect(body.eventId).toBe('evt-1');
  });

  it('returns 404 for unknown inbound status event', async () => {
    mockGetInboundReceiptStatus.mockResolvedValue(null);

    const response = await fetch(`${baseUrl}/api/inbound/status/missing-id`, {
      headers: {
        authorization: basicAuthHeader('postmark-user', 'postmark-pass'),
      },
    });

    expect(response.status).toBe(404);
  });
});
