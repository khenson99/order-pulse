import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const originalEnv = process.env;

const mockGetUserByEmail = vi.fn();
const fetchMock = vi.fn();

vi.mock('./cognito.js', () => ({
  cognitoService: {
    getUserByEmail: mockGetUserByEmail,
  },
}));

function mockArdaSuccessResponse() {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({
      rId: 'record-1',
      asOf: { effective: Date.now(), recorded: Date.now() },
      payload: {},
      metadata: {},
      retired: false,
    }),
  });
}

describe('arda service', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  describe('isMockMode', () => {
    it('returns true when ARDA_MOCK_MODE is true', async () => {
      process.env.ARDA_MOCK_MODE = 'true';
      process.env.ARDA_API_KEY = 'test-key';
      process.env.ARDA_TENANT_ID = 'test-tenant';

      const { isMockMode } = await import('./arda.js');
      expect(isMockMode()).toBe(true);
    });

    it('returns true when ARDA_API_KEY is not set', async () => {
      delete process.env.ARDA_API_KEY;
      delete process.env.ARDA_TENANT_ID;
      delete process.env.ARDA_MOCK_MODE;

      const { isMockMode } = await import('./arda.js');
      expect(isMockMode()).toBe(true);
    });

    it('returns true when ARDA_TENANT_ID is placeholder', async () => {
      process.env.ARDA_API_KEY = 'real-key';
      process.env.ARDA_TENANT_ID = 'your_tenant_uuid_here';
      delete process.env.ARDA_MOCK_MODE;

      const { isMockMode } = await import('./arda.js');
      expect(isMockMode()).toBe(true);
    });
  });

  describe('ardaService.isConfigured', () => {
    it('returns false when API key is missing', async () => {
      delete process.env.ARDA_API_KEY;
      process.env.ARDA_TENANT_ID = 'valid-tenant';

      const { ardaService } = await import('./arda.js');
      expect(ardaService.isConfigured()).toBe(false);
    });

    it('returns false when tenant ID is placeholder', async () => {
      process.env.ARDA_API_KEY = 'valid-key';
      process.env.ARDA_TENANT_ID = 'your_tenant_uuid_here';

      const { ardaService } = await import('./arda.js');
      expect(ardaService.isConfigured()).toBe(false);
    });

    it('returns true when properly configured', async () => {
      process.env.ARDA_API_KEY = 'valid-key';
      process.env.ARDA_TENANT_ID = 'c35bb200-ce7f-4280-9108-f61227127a98';

      const { ardaService } = await import('./arda.js');
      expect(ardaService.isConfigured()).toBe(true);
    });
  });

  describe('tenant resolution precedence', () => {
    it('uses Cognito tenant for authenticated email even when ARDA_TENANT_ID is set', async () => {
      process.env.ARDA_API_KEY = 'valid-key';
      process.env.ARDA_TENANT_ID = 'global-tenant';

      mockGetUserByEmail.mockReturnValue({ tenantId: 'tenant-from-email' });
      mockArdaSuccessResponse();

      const { createItem } = await import('./arda.js');
      await createItem(
        { name: 'Coffee Filters', primarySupplier: 'Acme' },
        { author: 'author-sub', email: 'user@example.com' }
      );

      expect(mockGetUserByEmail).toHaveBeenCalledWith('user@example.com');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, init] = fetchMock.mock.calls[0];
      const headers = init.headers as Record<string, string>;
      expect(headers['X-Tenant-Id']).toBe('tenant-from-email');
      expect(headers['X-Author']).toBe('author-sub');
    });

    it('uses explicit actor tenantId over all other sources', async () => {
      process.env.ARDA_API_KEY = 'valid-key';
      process.env.ARDA_TENANT_ID = 'global-tenant';

      mockArdaSuccessResponse();

      const { createItem } = await import('./arda.js');
      await createItem(
        { name: 'Paper Towels', primarySupplier: 'SupplyCo' },
        { author: 'author-sub', email: 'user@example.com', tenantId: 'explicit-tenant' }
      );

      expect(mockGetUserByEmail).not.toHaveBeenCalled();
      const [, init] = fetchMock.mock.calls[0];
      const headers = init.headers as Record<string, string>;
      expect(headers['X-Tenant-Id']).toBe('explicit-tenant');
    });

    it('throws when authenticated email has no Cognito mapping even if ARDA_TENANT_ID is set', async () => {
      process.env.ARDA_API_KEY = 'valid-key';
      process.env.ARDA_TENANT_ID = 'global-tenant';

      mockGetUserByEmail.mockReturnValue(null);

      const { createItem } = await import('./arda.js');

      await expect(
        createItem(
          { name: 'Gloves', primarySupplier: 'Vendor' },
          { author: 'author-sub', email: 'missing@example.com' }
        )
      ).rejects.toThrow('No tenant mapping found for authenticated email missing@example.com');

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('uses ARDA_TENANT_ID for legacy non-email flows', async () => {
      process.env.ARDA_API_KEY = 'valid-key';
      process.env.ARDA_TENANT_ID = 'legacy-tenant';

      mockArdaSuccessResponse();

      const { createItem } = await import('./arda.js');
      await createItem(
        { name: 'Batteries', primarySupplier: 'Warehouse' },
        { author: 'legacy-author' }
      );

      expect(mockGetUserByEmail).not.toHaveBeenCalled();
      const [, init] = fetchMock.mock.calls[0];
      const headers = init.headers as Record<string, string>;
      expect(headers['X-Tenant-Id']).toBe('legacy-tenant');
    });
  });

  describe('provisionUserForEmail', () => {
    it('returns null when ARDA_API_KEY is missing', async () => {
      delete process.env.ARDA_API_KEY;
      const { provisionUserForEmail } = await import('./arda.js');

      await expect(provisionUserForEmail('new@example.com')).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns actor credentials when provisioning endpoint returns tenant and author', async () => {
      process.env.ARDA_API_KEY = 'valid-key';

      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          payload: {
            tenantId: 'tenant-created',
            sub: 'author-created',
          },
        }),
      });

      const { provisionUserForEmail } = await import('./arda.js');
      const actor = await provisionUserForEmail('new@example.com');

      expect(actor).toEqual({
        author: 'author-created',
        email: 'new@example.com',
        tenantId: 'tenant-created',
      });
    });
  });
});
