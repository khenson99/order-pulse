import express from 'express';
import { createHmac } from 'node:crypto';
import { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buildQuickBooksAuthUrl: vi.fn(),
  exchangeQuickBooksCodeForTokens: vi.fn(),
  fetchQuickBooksCompanyName: vi.fn(),
  revokeQuickBooksToken: vi.fn(),
  buildXeroAuthUrl: vi.fn(),
  exchangeXeroCodeForTokens: vi.fn(),
  fetchXeroTenants: vi.fn(),
  fetchXeroOrganizationName: vi.fn(),
  revokeXeroConnection: vi.fn(),
  upsertProviderConnection: vi.fn(),
  listProviderConnectionsForUser: vi.fn(),
  deleteProviderConnectionForUser: vi.fn(),
  listProviderSyncRunsForConnection: vi.fn(),
  insertWebhookEvent: vi.fn(),
  markWebhookEventProcessed: vi.fn(),
  getProviderConnectionByIdForUser: vi.fn(),
  getProviderConnectionByProviderTenant: vi.fn(),
  enqueueProviderSync: vi.fn(),
  enqueueProviderSyncByTenant: vi.fn(),
}));

vi.mock('../config.js', () => ({
  enableAccountingConnectors: true,
}));

vi.mock('../services/integrations/quickbooksOAuth.js', () => ({
  buildQuickBooksAuthUrl: mocks.buildQuickBooksAuthUrl,
  exchangeQuickBooksCodeForTokens: mocks.exchangeQuickBooksCodeForTokens,
  fetchQuickBooksCompanyName: mocks.fetchQuickBooksCompanyName,
  revokeQuickBooksToken: mocks.revokeQuickBooksToken,
}));

vi.mock('../services/integrations/xeroOAuth.js', () => ({
  buildXeroAuthUrl: mocks.buildXeroAuthUrl,
  exchangeXeroCodeForTokens: mocks.exchangeXeroCodeForTokens,
  fetchXeroTenants: mocks.fetchXeroTenants,
  fetchXeroOrganizationName: mocks.fetchXeroOrganizationName,
  revokeXeroConnection: mocks.revokeXeroConnection,
}));

vi.mock('../services/integrations/store.js', () => ({
  upsertProviderConnection: mocks.upsertProviderConnection,
  listProviderConnectionsForUser: mocks.listProviderConnectionsForUser,
  deleteProviderConnectionForUser: mocks.deleteProviderConnectionForUser,
  listProviderSyncRunsForConnection: mocks.listProviderSyncRunsForConnection,
  insertWebhookEvent: mocks.insertWebhookEvent,
  markWebhookEventProcessed: mocks.markWebhookEventProcessed,
  getProviderConnectionByIdForUser: mocks.getProviderConnectionByIdForUser,
  getProviderConnectionByProviderTenant: mocks.getProviderConnectionByProviderTenant,
}));

vi.mock('../services/integrations/syncOrchestrator.js', () => ({
  enqueueProviderSync: mocks.enqueueProviderSync,
  enqueueProviderSyncByTenant: mocks.enqueueProviderSyncByTenant,
}));

async function startServer(authenticated = true): Promise<{ server: Server; baseUrl: string }> {
  const { integrationsRouter } = await import('./integrations.js');
  const app = express();
  app.use(express.json({
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf.toString('utf8');
    },
  }));
  app.use((req, _res, next) => {
    (req as any).session = authenticated ? { userId: 'user-1' } : {};
    next();
  });
  app.use('/api/integrations', integrationsRouter);

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

describe('integrations routes', () => {
  let server: Server | null = null;
  let baseUrl = '';

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    process.env.FRONTEND_URL = 'http://localhost:5173';
    process.env.QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN = 'test-webhook-secret';

    mocks.buildQuickBooksAuthUrl.mockImplementation((state: string) => `https://qbo.example/connect?state=${state}`);
    mocks.exchangeQuickBooksCodeForTokens.mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      tokenExpiresAt: new Date('2026-12-01T00:00:00Z'),
      scope: 'com.intuit.quickbooks.accounting',
    });
    mocks.fetchQuickBooksCompanyName.mockResolvedValue('Acme Inc');
    mocks.upsertProviderConnection.mockResolvedValue({ id: 'conn-1' });
    mocks.enqueueProviderSync.mockResolvedValue({ runId: 'run-1' });
    mocks.listProviderConnectionsForUser.mockResolvedValue([
      { id: 'conn-1', provider: 'quickbooks', status: 'connected' },
    ]);
    mocks.listProviderSyncRunsForConnection.mockResolvedValue([
      { id: 'run-1', status: 'success', trigger: 'manual' },
    ]);

    mocks.getProviderConnectionByProviderTenant.mockResolvedValue({ id: 'conn-1' });
    mocks.insertWebhookEvent.mockResolvedValue({ inserted: true, eventId: 'evt-1' });
    mocks.markWebhookEventProcessed.mockResolvedValue(undefined);
    mocks.enqueueProviderSyncByTenant.mockResolvedValue({ runId: 'run-2' });
    mocks.getProviderConnectionByIdForUser.mockResolvedValue({
      id: 'conn-1',
      provider: 'quickbooks',
      refreshTokenEncrypted: 'encrypted-refresh',
      accessTokenEncrypted: 'encrypted-access',
      metadata: {},
    });
    mocks.deleteProviderConnectionForUser.mockResolvedValue(true);
    mocks.revokeQuickBooksToken.mockResolvedValue(undefined);
    mocks.revokeXeroConnection.mockResolvedValue(undefined);

    ({ server, baseUrl } = await startServer(true));
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((err) => (err ? reject(err) : resolve()));
      });
      server = null;
    }
  });

  it('requires authentication for connect endpoint', async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((err) => (err ? reject(err) : resolve()));
      });
      server = null;
    }

    ({ server, baseUrl } = await startServer(false));

    const response = await fetch(`${baseUrl}/api/integrations/quickbooks/connect`, {
      method: 'POST',
    });

    expect(response.status).toBe(401);
  });

  it('connect + callback stores QuickBooks connection and enqueues backfill', async () => {
    const connectResponse = await fetch(`${baseUrl}/api/integrations/quickbooks/connect`, {
      method: 'POST',
    });

    expect(connectResponse.status).toBe(200);
    const connectPayload = await connectResponse.json() as { authUrl: string };
    const authUrl = new URL(connectPayload.authUrl);
    const state = authUrl.searchParams.get('state');
    expect(state).toBeTruthy();

    const callbackResponse = await fetch(
      `${baseUrl}/api/integrations/quickbooks/callback?code=abc123&state=${encodeURIComponent(state!)}&realmId=123456`,
      { redirect: 'manual' },
    );

    expect(callbackResponse.status).toBe(302);
    expect(mocks.exchangeQuickBooksCodeForTokens).toHaveBeenCalledWith('abc123');
    expect(mocks.upsertProviderConnection).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueProviderSync).toHaveBeenCalledWith('conn-1', 'user-1', 'backfill');
  });

  it('starts manual sync and returns run id', async () => {
    const response = await fetch(`${baseUrl}/api/integrations/connections/conn-1/sync`, {
      method: 'POST',
    });

    expect(response.status).toBe(202);
    const payload = await response.json() as { runId: string };
    expect(payload.runId).toBe('run-1');
    expect(mocks.enqueueProviderSync).toHaveBeenCalledWith('conn-1', 'user-1', 'manual');
  });

  it('returns 404 when manual sync connection is not found', async () => {
    mocks.enqueueProviderSync.mockRejectedValueOnce(new Error('Provider connection not found.'));

    const response = await fetch(`${baseUrl}/api/integrations/connections/missing/sync`, {
      method: 'POST',
    });

    expect(response.status).toBe(404);
    const payload = await response.json() as { error: string };
    expect(payload.error).toContain('Provider connection not found');
  });

  it('lists provider connections for authenticated user', async () => {
    const response = await fetch(`${baseUrl}/api/integrations/connections`);

    expect(response.status).toBe(200);
    const payload = await response.json() as { connections: Array<{ id: string }> };
    expect(payload.connections).toHaveLength(1);
    expect(payload.connections[0].id).toBe('conn-1');
    expect(mocks.listProviderConnectionsForUser).toHaveBeenCalledWith('user-1');
  });

  it('lists sync runs for authenticated user connection', async () => {
    const response = await fetch(`${baseUrl}/api/integrations/connections/conn-1/runs`);

    expect(response.status).toBe(200);
    const payload = await response.json() as { runs: Array<{ id: string }> };
    expect(payload.runs).toHaveLength(1);
    expect(payload.runs[0].id).toBe('run-1');
    expect(mocks.listProviderSyncRunsForConnection).toHaveBeenCalledWith('conn-1', 'user-1');
  });

  it('disconnects QuickBooks connection and attempts token revoke', async () => {
    const response = await fetch(`${baseUrl}/api/integrations/connections/conn-1`, {
      method: 'DELETE',
    });

    expect(response.status).toBe(200);
    expect(mocks.getProviderConnectionByIdForUser).toHaveBeenCalledWith('conn-1', 'user-1');
    expect(mocks.deleteProviderConnectionForUser).toHaveBeenCalledWith('conn-1', 'user-1');
  });

  it('accepts QuickBooks webhook, validates signature, and enqueues sync by tenant', async () => {
    const payload = {
      eventNotifications: [
        {
          realmId: 'realm-1',
          dataChangeEvent: {
            entities: [
              {
                name: 'PurchaseOrder',
                id: 'po-100',
                operation: 'Update',
                lastUpdated: '2026-02-17T10:00:00Z',
              },
            ],
          },
        },
      ],
    };

    const rawBody = JSON.stringify(payload);
    const signature = createHmac('sha256', process.env.QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN!).update(rawBody).digest('base64');

    const response = await fetch(`${baseUrl}/api/integrations/webhooks/quickbooks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'intuit-signature': signature,
      },
      body: rawBody,
    });

    expect(response.status).toBe(202);
    const responsePayload = await response.json() as { accepted: boolean; signatureValid: boolean };
    expect(responsePayload.accepted).toBe(true);
    expect(responsePayload.signatureValid).toBe(true);

    expect(mocks.insertWebhookEvent).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueProviderSyncByTenant).toHaveBeenCalledWith(
      'quickbooks',
      'realm-1',
      'webhook',
      { externalIds: ['po-100'] },
    );
    expect(mocks.markWebhookEventProcessed).toHaveBeenCalledWith('evt-1', 'processed');
  });

  it('marks webhook events ignored when no matching realm connection exists', async () => {
    mocks.getProviderConnectionByProviderTenant.mockResolvedValueOnce(null);

    const payload = {
      eventNotifications: [
        {
          realmId: 'realm-missing',
          dataChangeEvent: {
            entities: [
              {
                name: 'PurchaseOrder',
                id: 'po-200',
                operation: 'Update',
                lastUpdated: '2026-02-17T10:00:00Z',
              },
            ],
          },
        },
      ],
    };

    const rawBody = JSON.stringify(payload);
    const signature = createHmac('sha256', process.env.QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN!).update(rawBody).digest('base64');

    const response = await fetch(`${baseUrl}/api/integrations/webhooks/quickbooks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'intuit-signature': signature,
      },
      body: rawBody,
    });

    expect(response.status).toBe(202);
    expect(mocks.markWebhookEventProcessed).toHaveBeenCalledWith('evt-1', 'ignored');
    expect(mocks.enqueueProviderSyncByTenant).not.toHaveBeenCalled();
  });

  it('ignores webhook events with invalid signature', async () => {
    const payload = {
      eventNotifications: [
        {
          realmId: 'realm-1',
          dataChangeEvent: {
            entities: [
              {
                name: 'PurchaseOrder',
                id: 'po-333',
                operation: 'Update',
                lastUpdated: '2026-02-17T10:00:00Z',
              },
            ],
          },
        },
      ],
    };

    const response = await fetch(`${baseUrl}/api/integrations/webhooks/quickbooks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'intuit-signature': 'invalid-signature',
      },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(202);
    const responsePayload = await response.json() as { signatureValid: boolean };
    expect(responsePayload.signatureValid).toBe(false);
    expect(mocks.markWebhookEventProcessed).toHaveBeenCalledWith('evt-1', 'ignored');
    expect(mocks.enqueueProviderSyncByTenant).not.toHaveBeenCalled();
  });

  it('requires auth for runs endpoint', async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((err) => (err ? reject(err) : resolve()));
      });
      server = null;
    }

    ({ server, baseUrl } = await startServer(false));

    const response = await fetch(`${baseUrl}/api/integrations/connections/conn-1/runs`);
    expect(response.status).toBe(401);
  });
});
