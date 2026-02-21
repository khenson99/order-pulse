import express from 'express';
import { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = process.env;

const mockGetUserEmail = vi.fn();
const mockGetUserByEmail = vi.fn();
const mockGetSyncStatus = vi.fn();
const mockFindTenantSuggestionForEmail = vi.fn();
const mockSyncUsersOnDemand = vi.fn();
const mockEnsureUserMappingForEmail = vi.fn();

const mockCreateItem = vi.fn();
const mockCreateKanbanCard = vi.fn();
const mockCreateOrder = vi.fn();
const mockCreateItemFromVelocity = vi.fn();
const mockNamedSyncVelocityToArda = vi.fn();
const mockServiceSyncVelocityToArda = vi.fn();
const mockProvisionUserForEmail = vi.fn();
const mockIsConfigured = vi.fn();

vi.mock('./auth.js', () => ({
  getUserEmail: mockGetUserEmail,
}));

vi.mock('../services/cognito.js', () => ({
  cognitoService: {
    getUserByEmail: mockGetUserByEmail,
    getSyncStatus: mockGetSyncStatus,
    findTenantSuggestionForEmail: mockFindTenantSuggestionForEmail,
    syncUsersOnDemand: mockSyncUsersOnDemand,
    ensureUserMappingForEmail: mockEnsureUserMappingForEmail,
  },
}));

vi.mock('../services/imageUpload.js', () => ({
  ensureHostedUrl: vi.fn(async (url: string) => url),
  isDataUrl: vi.fn(() => false),
}));

vi.mock('../services/arda.js', () => ({
  ardaService: {
    isConfigured: mockIsConfigured,
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
  const sessionData = sessionUserId ? { userId: sessionUserId } : {};
  app.use((req, _res, next) => {
    (req as any).session = sessionData;
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
    mockFindTenantSuggestionForEmail.mockReturnValue(null);
    mockSyncUsersOnDemand.mockResolvedValue(false);
    mockCreateItem.mockResolvedValue({ rId: 'record-1' });
    mockCreateKanbanCard.mockResolvedValue({ rId: 'record-2' });
    mockCreateOrder.mockResolvedValue({ rId: 'record-3' });
    mockCreateItemFromVelocity.mockResolvedValue({ rId: 'record-4' });
    mockNamedSyncVelocityToArda.mockResolvedValue([]);
    mockServiceSyncVelocityToArda.mockResolvedValue([]);
    mockProvisionUserForEmail.mockResolvedValue(null);
    mockIsConfigured.mockReturnValue(true);
    mockEnsureUserMappingForEmail.mockResolvedValue(true);
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

  it('attempts auto-provision and returns TENANT_REQUIRED with auto-provision details when provisioning fails', async () => {
    mockGetUserEmail.mockResolvedValue('auth-user@example.com');
    mockGetUserByEmail.mockReturnValue(null);

    ({ server, baseUrl } = await startTestServer('session-user-id'));

    const response = await fetch(`${baseUrl}/api/arda/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Filters', primarySupplier: 'Acme' }),
    });

    const data = await response.json() as {
      success?: boolean;
      code?: string;
      details?: {
        email?: string;
        canCreateTenant?: boolean;
        autoProvisionAttempted?: boolean;
        autoProvisionSucceeded?: boolean;
        autoProvisionError?: string;
      };
    };
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.code).toBe('TENANT_REQUIRED');
    expect(data.details?.email).toBe('auth-user@example.com');
    expect(data.details?.canCreateTenant).toBe(true);
    expect(data.details?.autoProvisionAttempted).toBe(true);
    expect(data.details?.autoProvisionSucceeded).toBe(false);
    expect(data.details?.autoProvisionError).toContain('did not return tenant credentials');
    expect(mockCreateItem).not.toHaveBeenCalled();
    expect(mockProvisionUserForEmail).toHaveBeenCalledWith('auth-user@example.com');
    expect(mockGetUserByEmail).toHaveBeenCalledWith('auth-user@example.com');
  });

  it('auto-provisions tenant during authenticated write when mapping is missing', async () => {
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
    expect(mockEnsureUserMappingForEmail).toHaveBeenCalledWith(
      'new-user@example.com',
      'provisioned-tenant',
      expect.objectContaining({ role: 'User', suppressMessage: true })
    );
    expect(mockCreateItem).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Auto Item', primarySupplier: 'Auto Supplier' }),
      {
        author: 'provisioned-sub',
        email: 'new-user@example.com',
        tenantId: 'provisioned-tenant',
      }
    );
  });

  it('refreshes Cognito mapping on-demand when tenant is missing', async () => {
    mockGetUserEmail.mockResolvedValue('mapped@example.com');
    mockGetUserByEmail
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ email: 'mapped@example.com', tenantId: 'tenant-123', sub: 'author-123' });
    mockSyncUsersOnDemand.mockResolvedValue(true);

    ({ server, baseUrl } = await startTestServer('session-user-id'));

    const response = await fetch(`${baseUrl}/api/arda/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Towels', primarySupplier: 'Warehouse' }),
    });

    expect(response.status).toBe(200);
    expect(mockSyncUsersOnDemand).toHaveBeenCalledWith('missing-tenant');
    expect(mockCreateItem).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Towels', primarySupplier: 'Warehouse' }),
      { author: 'author-123', email: 'mapped@example.com', tenantId: 'tenant-123' }
    );
  });

  it('resolves tenant via create_new and reuses session override for subsequent writes', async () => {
    mockGetUserEmail.mockResolvedValue('new-user@example.com');
    mockGetUserByEmail.mockReturnValue(null);
    mockProvisionUserForEmail.mockResolvedValue({
      author: 'provisioned-sub',
      email: 'new-user@example.com',
      tenantId: 'provisioned-tenant',
    });

    ({ server, baseUrl } = await startTestServer('session-user-id'));

    const resolveResponse = await fetch(`${baseUrl}/api/arda/tenant/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create_new' }),
    });
    const resolveData = await resolveResponse.json() as { success: boolean; tenantId?: string };

    expect(resolveResponse.status).toBe(200);
    expect(resolveData.success).toBe(true);
    expect(resolveData.tenantId).toBe('provisioned-tenant');
    expect(mockProvisionUserForEmail).toHaveBeenCalledWith('new-user@example.com');
    expect(mockEnsureUserMappingForEmail).toHaveBeenCalledWith(
      'new-user@example.com',
      'provisioned-tenant',
      expect.objectContaining({ role: 'User', suppressMessage: true })
    );

    const response = await fetch(`${baseUrl}/api/arda/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Auto Item', primarySupplier: 'Auto Supplier' }),
    });

    expect(response.status).toBe(200);
    expect(mockCreateItem).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Auto Item', primarySupplier: 'Auto Supplier' }),
      {
        author: 'provisioned-sub',
        email: 'new-user@example.com',
        tenantId: 'provisioned-tenant',
      }
    );
  });

  it('returns ARDA_NOT_CONFIGURED when create_new is requested without API configuration', async () => {
    mockGetUserEmail.mockResolvedValue('new-user@example.com');
    mockGetUserByEmail.mockReturnValue(null);
    mockIsConfigured.mockReturnValue(false);

    ({ server, baseUrl } = await startTestServer('session-user-id'));

    const resolveResponse = await fetch(`${baseUrl}/api/arda/tenant/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create_new' }),
    });
    const resolveData = await resolveResponse.json() as { success: boolean; code?: string; error?: string };

    expect(resolveResponse.status).toBe(503);
    expect(resolveData.success).toBe(false);
    expect(resolveData.code).toBe('ARDA_NOT_CONFIGURED');
    expect(resolveData.error).toContain('ARDA_API_KEY');
    expect(mockProvisionUserForEmail).not.toHaveBeenCalled();
  });

  it('returns TENANT_PROVISION_FAILED when create_new provisioning does not return tenant credentials', async () => {
    mockGetUserEmail.mockResolvedValue('new-user@example.com');
    mockGetUserByEmail.mockReturnValue(null);
    mockProvisionUserForEmail.mockResolvedValue(null);

    ({ server, baseUrl } = await startTestServer('session-user-id'));

    const resolveResponse = await fetch(`${baseUrl}/api/arda/tenant/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create_new' }),
    });
    const resolveData = await resolveResponse.json() as {
      success: boolean;
      code?: string;
      details?: { email?: string };
    };

    expect(resolveResponse.status).toBe(502);
    expect(resolveData.success).toBe(false);
    expect(resolveData.code).toBe('TENANT_PROVISION_FAILED');
    expect(resolveData.details?.email).toBe('new-user@example.com');
  });

  it('returns suggested tenant details for non-public company domain', async () => {
    mockGetUserEmail.mockResolvedValue('new@acme.com');
    mockGetUserByEmail.mockReturnValue({ email: 'new@acme.com', tenantId: '', sub: 'author-123' });
    mockFindTenantSuggestionForEmail.mockReturnValue({
      tenantId: 'tenant-from-domain',
      matchedEmail: 'ops@acme.com',
      domain: 'acme.com',
      matchCount: 2,
    });

    ({ server, baseUrl } = await startTestServer('session-user-id'));

    const response = await fetch(`${baseUrl}/api/arda/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Filters', primarySupplier: 'Acme' }),
    });
    const data = await response.json() as {
      code?: string;
      details?: { canUseSuggestedTenant?: boolean; suggestedTenant?: { tenantId?: string } };
    };

    expect(response.status).toBe(400);
    expect(data.code).toBe('TENANT_REQUIRED');
    expect(data.details?.canUseSuggestedTenant).toBe(true);
    expect(data.details?.suggestedTenant?.tenantId).toBe('tenant-from-domain');
  });

  it('applies suggested tenant override for the authenticated session', async () => {
    mockGetUserEmail.mockResolvedValue('new@acme.com');
    mockGetUserByEmail.mockReturnValue({ email: 'new@acme.com', tenantId: '', sub: 'author-123' });
    mockFindTenantSuggestionForEmail.mockReturnValue({
      tenantId: 'tenant-from-domain',
      matchedEmail: 'ops@acme.com',
      domain: 'acme.com',
      matchCount: 2,
    });

    ({ server, baseUrl } = await startTestServer('session-user-id'));

    const resolveResponse = await fetch(`${baseUrl}/api/arda/tenant/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'use_suggested' }),
    });

    expect(resolveResponse.status).toBe(200);

    const itemResponse = await fetch(`${baseUrl}/api/arda/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Domain Item', primarySupplier: 'Acme' }),
    });

    expect(itemResponse.status).toBe(200);
    expect(mockCreateItem).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Domain Item', primarySupplier: 'Acme' }),
      {
        author: 'author-123',
        email: 'new@acme.com',
        tenantId: 'tenant-from-domain',
      }
    );
  });

  it('rejects unauthenticated writes', async () => {
    ({ server, baseUrl } = await startTestServer());

    const response = await fetch(`${baseUrl}/api/arda/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Gloves', primarySupplier: 'SupplyCo' }),
    });

    const data = await response.json() as { error?: string };
    expect(response.status).toBe(401);
    expect(data.error).toContain('Authentication required');
    expect(mockCreateItem).not.toHaveBeenCalled();
  });

  it('uses authenticated user email mapping for actor credentials', async () => {
    mockGetUserEmail.mockResolvedValue('mapped@example.com');
    mockGetUserByEmail.mockReturnValue({ email: 'mapped@example.com', tenantId: 'tenant-123', sub: 'author-123' });

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
  });

  it('short-circuits create_new when tenant is already resolved', async () => {
    mockGetUserEmail.mockResolvedValue('mapped@example.com');
    mockGetUserByEmail.mockReturnValue({
      email: 'mapped@example.com',
      tenantId: 'tenant-123',
      sub: 'author-123',
    });

    ({ server, baseUrl } = await startTestServer('session-user-id'));

    const resolveResponse = await fetch(`${baseUrl}/api/arda/tenant/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create_new' }),
    });
    const resolveData = await resolveResponse.json() as { success?: boolean; tenantId?: string };

    expect(resolveResponse.status).toBe(200);
    expect(resolveData.success).toBe(true);
    expect(resolveData.tenantId).toBe('tenant-123');
    expect(mockProvisionUserForEmail).not.toHaveBeenCalled();
    expect(mockSyncUsersOnDemand).not.toHaveBeenCalled();
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

  it('returns recorded sync status after a successful write', async () => {
    mockGetUserEmail.mockResolvedValue('sync-status-success@example.com');
    mockGetUserByEmail.mockReturnValue({
      email: 'sync-status-success@example.com',
      tenantId: 'tenant-sync-status',
      sub: 'author-sync-status',
    });

    ({ server, baseUrl } = await startTestServer('sync-status-success-user'));

    const createResponse = await fetch(`${baseUrl}/api/arda/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Tracked Item', primarySupplier: 'Supplier' }),
    });
    expect(createResponse.status).toBe(200);

    const statusResponse = await fetch(`${baseUrl}/api/arda/sync-status`);
    const statusData = await statusResponse.json() as {
      success: boolean;
      message: string;
      totalAttempts: number;
      successfulAttempts: number;
      failedAttempts: number;
      recent: Array<{ operation: string; success: boolean; requested: number }>;
    };

    expect(statusResponse.status).toBe(200);
    expect(statusData.success).toBe(true);
    expect(statusData.message).toBe('Sync status loaded');
    expect(statusData.totalAttempts).toBe(1);
    expect(statusData.successfulAttempts).toBe(1);
    expect(statusData.failedAttempts).toBe(0);
    expect(statusData.recent[0]?.operation).toBe('item_create');
    expect(statusData.recent[0]?.success).toBe(true);
    expect(statusData.recent[0]?.requested).toBe(1);
  });

  it('returns recorded sync status after a failed write', async () => {
    mockGetUserEmail.mockResolvedValue('sync-status-fail@example.com');
    mockGetUserByEmail.mockReturnValue(null);

    ({ server, baseUrl } = await startTestServer('sync-status-fail-user'));

    const createResponse = await fetch(`${baseUrl}/api/arda/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Failing Item', primarySupplier: 'Supplier' }),
    });
    expect(createResponse.status).toBe(400);

    const statusResponse = await fetch(`${baseUrl}/api/arda/sync-status`);
    const statusData = await statusResponse.json() as {
      success: boolean;
      totalAttempts: number;
      successfulAttempts: number;
      failedAttempts: number;
      recent: Array<{ operation: string; success: boolean; error?: string }>;
    };

    expect(statusResponse.status).toBe(200);
    expect(statusData.success).toBe(true);
    expect(statusData.totalAttempts).toBe(1);
    expect(statusData.successfulAttempts).toBe(0);
    expect(statusData.failedAttempts).toBe(1);
    expect(statusData.recent[0]?.operation).toBe('item_create');
    expect(statusData.recent[0]?.success).toBe(false);
    expect(statusData.recent[0]?.error).toContain('Tenant required');
  });

  it('records provisioned tenant id in sync status events after auto-provisioned write', async () => {
    mockGetUserEmail.mockResolvedValue('status-provisioned@example.com');
    mockGetUserByEmail.mockReturnValue(null);
    mockProvisionUserForEmail.mockResolvedValue({
      author: 'status-provisioned-sub',
      email: 'status-provisioned@example.com',
      tenantId: 'tenant-from-provision',
    });

    ({ server, baseUrl } = await startTestServer('status-provisioned-user'));

    const createResponse = await fetch(`${baseUrl}/api/arda/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Provisioned Tracked Item', primarySupplier: 'Supplier' }),
    });
    expect(createResponse.status).toBe(200);

    const statusResponse = await fetch(`${baseUrl}/api/arda/sync-status`);
    const statusData = await statusResponse.json() as {
      success: boolean;
      recent: Array<{ success: boolean; tenantId?: string; email?: string }>;
    };

    expect(statusResponse.status).toBe(200);
    expect(statusData.success).toBe(true);
    expect(statusData.recent[0]?.success).toBe(true);
    expect(statusData.recent[0]?.tenantId).toBe('tenant-from-provision');
    expect(statusData.recent[0]?.email).toBe('status-provisioned@example.com');
  });
});
