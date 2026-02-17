import express from 'express';
import { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = process.env;

const mockGetUserEmail = vi.fn();
const mockGetUserByEmail = vi.fn();
const mockGetSyncStatus = vi.fn();

const mockCreateItem = vi.fn();
const mockCreateKanbanCard = vi.fn();
const mockCreateOrder = vi.fn();
const mockCreateItemFromVelocity = vi.fn();
const mockNamedSyncVelocityToArda = vi.fn();
const mockServiceSyncVelocityToArda = vi.fn();
const mockProvisionUserForEmail = vi.fn();

vi.mock('./auth.js', () => ({
  getUserEmail: mockGetUserEmail,
}));

vi.mock('../services/cognito.js', () => ({
  cognitoService: {
    getUserByEmail: mockGetUserByEmail,
    getSyncStatus: mockGetSyncStatus,
  },
}));

vi.mock('../services/imageUpload.js', () => ({
  ensureHostedUrl: vi.fn(async (url: string) => url),
  isDataUrl: vi.fn(() => false),
}));

vi.mock('../services/arda.js', () => ({
  ardaService: {
    isConfigured: vi.fn(() => true),
    getTenantByEmail: vi.fn(),
    createItem: mockCreateItem,
    createKanbanCard: mockCreateKanbanCard,
    createOrder: mockCreateOrder,
    syncVelocityToArda: mockServiceSyncVelocityToArda,
    provisionUserForEmail: mockProvisionUserForEmail,
  },
  createItemFromVelocity: mockCreateItemFromVelocity,
  syncVelocityToArda: mockNamedSyncVelocityToArda,
}));

async function startTestServer(sessionUserId?: string): Promise<{ server: Server; baseUrl: string }> {
  const { default: ardaRouter } = await import('./arda.js');

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = sessionUserId ? { userId: sessionUserId } : {};
    next();
  });
  app.use('/api/arda', ardaRouter);

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));

  const address = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

describe('arda routes credential resolution', () => {
  let server: Server | null = null;
  let baseUrl = '';

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...originalEnv };

    mockGetSyncStatus.mockReturnValue({ userCount: 42, lastSync: '2026-02-17T00:00:00.000Z' });
    mockCreateItem.mockResolvedValue({ rId: 'record-1' });
    mockCreateKanbanCard.mockResolvedValue({ rId: 'record-2' });
    mockCreateOrder.mockResolvedValue({ rId: 'record-3' });
    mockCreateItemFromVelocity.mockResolvedValue({ rId: 'record-4' });
    mockNamedSyncVelocityToArda.mockResolvedValue([]);
    mockServiceSyncVelocityToArda.mockResolvedValue([]);
    mockProvisionUserForEmail.mockResolvedValue(null);
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

  it('fails authenticated writes when logged-in email is missing in Cognito and does not fallback to demo user', async () => {
    process.env.ARDA_MOCK_MODE = 'true';

    mockGetUserEmail.mockResolvedValue('auth-user@example.com');
    mockGetUserByEmail.mockImplementation((email: string) => {
      if (email === 'kyle@arda.cards') {
        return { email, tenantId: 'demo-tenant', sub: 'demo-author' };
      }
      return null;
    });

    ({ server, baseUrl } = await startTestServer('session-user-id'));

    const response = await fetch(`${baseUrl}/api/arda/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Filters', primarySupplier: 'Acme' }),
    });

    const data = await response.json() as { success?: boolean; details?: { email?: string } };
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.details?.email).toBe('auth-user@example.com');
    expect(mockCreateItem).not.toHaveBeenCalled();
    expect(mockProvisionUserForEmail).toHaveBeenCalledWith('auth-user@example.com');
    expect(mockGetUserByEmail).toHaveBeenCalledWith('auth-user@example.com');
    expect(mockGetUserByEmail.mock.calls.some(([email]) => email === 'kyle@arda.cards')).toBe(false);
  });

  it('auto-provisions authenticated missing users and proceeds with the provisioned tenant', async () => {
    mockGetUserEmail.mockResolvedValue('new-user@example.com');
    mockGetUserByEmail.mockReturnValue(null);
    mockProvisionUserForEmail.mockResolvedValue({
      author: 'provisioned-sub',
      email: 'new-user@example.com',
      tenantId: 'provisioned-tenant',
    });

    ({ server, baseUrl } = await startTestServer('session-user-id'));

    const response = await fetch(`${baseUrl}/api/arda/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Auto Item', primarySupplier: 'Auto Supplier' }),
    });

    expect(response.status).toBe(200);
    expect(mockProvisionUserForEmail).toHaveBeenCalledWith('new-user@example.com');
    expect(mockCreateItem).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Auto Item', primarySupplier: 'Auto Supplier' }),
      {
        author: 'provisioned-sub',
        email: 'new-user@example.com',
        tenantId: 'provisioned-tenant',
      }
    );
  });

  it('allows unauthenticated demo fallback only in mock mode', async () => {
    process.env.ARDA_MOCK_MODE = 'true';

    mockGetUserByEmail.mockImplementation((email: string) => {
      if (email === 'kyle@arda.cards') {
        return { email, tenantId: 'demo-tenant', sub: 'demo-author' };
      }
      return null;
    });

    ({ server, baseUrl } = await startTestServer());

    const response = await fetch(`${baseUrl}/api/arda/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Gloves', primarySupplier: 'SupplyCo' }),
    });

    expect(response.status).toBe(200);
    expect(mockCreateItem).toHaveBeenCalledTimes(1);
    expect(mockCreateItem).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Gloves', primarySupplier: 'SupplyCo' }),
      { author: 'demo-author', email: 'kyle@arda.cards', tenantId: 'demo-tenant' }
    );
  });

  it('uses authenticated user email mapping for actor credentials', async () => {
    mockGetUserEmail.mockResolvedValue('mapped@example.com');
    mockGetUserByEmail.mockImplementation((email: string) => {
      if (email === 'mapped@example.com') {
        return { email, tenantId: 'tenant-123', sub: 'author-123' };
      }
      if (email === 'kyle@arda.cards') {
        return { email, tenantId: 'demo-tenant', sub: 'demo-author' };
      }
      return null;
    });

    ({ server, baseUrl } = await startTestServer('session-user-id'));

    const response = await fetch(`${baseUrl}/api/arda/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Towels', primarySupplier: 'Warehouse' }),
    });

    expect(response.status).toBe(200);
    expect(mockCreateItem).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Towels', primarySupplier: 'Warehouse' }),
      { author: 'author-123', email: 'mapped@example.com', tenantId: 'tenant-123' }
    );
    expect(mockGetUserByEmail.mock.calls.some(([email]) => email === 'kyle@arda.cards')).toBe(false);
  });

  it('rejects sync-velocity when provided author does not match authenticated author', async () => {
    mockGetUserEmail.mockResolvedValue('mapped@example.com');
    mockGetUserByEmail.mockReturnValue({
      email: 'mapped@example.com',
      tenantId: 'tenant-123',
      sub: 'author-123',
    });

    ({ server, baseUrl } = await startTestServer('session-user-id'));

    const response = await fetch(`${baseUrl}/api/arda/sync-velocity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        author: 'different-author',
        profiles: [
          {
            displayName: 'AA Batteries',
            supplier: 'Warehouse',
            dailyBurnRate: 1,
            averageCadenceDays: 7,
            recommendedMin: 4,
            recommendedOrderQty: 12,
          },
        ],
      }),
    });

    expect(response.status).toBe(400);
    expect(mockNamedSyncVelocityToArda).not.toHaveBeenCalled();
  });
});
