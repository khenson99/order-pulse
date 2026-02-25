import express from 'express';
import { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getValidAccessToken: vi.fn(),
  getUserById: vi.fn(),
}));

vi.mock('./auth.js', () => ({
  getValidAccessToken: mocks.getValidAccessToken,
}));

vi.mock('../services/userStore.js', () => ({
  getUserById: mocks.getUserById,
}));

async function startServer(session: Record<string, unknown>): Promise<{ server: Server; baseUrl: string }> {
  const { gmailRouter } = await import('./gmail.js');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = session;
    next();
  });
  app.use('/api/gmail', gmailRouter);

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

describe('gmail status route', () => {
  let server: Server | null = null;
  let baseUrl = '';

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    ({ server, baseUrl } = await startServer({ userId: 'user-1' }));

    mocks.getUserById.mockResolvedValue({
      id: 'user-1',
      googleId: null,
      googleEmail: null,
      email: 'user@example.com',
      name: 'User',
      picture: '',
      accessToken: '',
      refreshToken: '',
      expiresAt: new Date('2026-01-01T00:00:00Z'),
      passwordHash: null,
    });
    mocks.getValidAccessToken.mockResolvedValue(null);
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((err) => (err ? reject(err) : resolve()));
      });
      server = null;
    }
  });

  it('requires authentication', async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((err) => (err ? reject(err) : resolve()));
      });
      server = null;
    }

    ({ server, baseUrl } = await startServer({}));

    const response = await fetch(`${baseUrl}/api/gmail/status`);
    expect(response.status).toBe(401);
  });

  it('returns disconnected when no googleId is linked', async () => {
    const response = await fetch(`${baseUrl}/api/gmail/status`);
    expect(response.status).toBe(200);
    const payload = await response.json() as { connected: boolean; gmailEmail: string | null };
    expect(payload).toEqual({ connected: false, gmailEmail: null });
    expect(mocks.getValidAccessToken).not.toHaveBeenCalled();
  });

  it('returns connected when googleId is linked and access token is valid', async () => {
    mocks.getUserById.mockResolvedValueOnce({
      id: 'user-1',
      googleId: 'google-1',
      googleEmail: 'google@example.com',
      email: 'user@example.com',
      name: 'User',
      picture: '',
      accessToken: '',
      refreshToken: 'refresh-token',
      expiresAt: new Date('2026-01-01T00:00:00Z'),
      passwordHash: null,
    });
    mocks.getValidAccessToken.mockResolvedValueOnce('access-token');

    const response = await fetch(`${baseUrl}/api/gmail/status`);
    expect(response.status).toBe(200);
    const payload = await response.json() as { connected: boolean; gmailEmail: string | null };
    expect(payload).toEqual({ connected: true, gmailEmail: 'google@example.com' });
  });

  it('returns GMAIL_AUTH_REQUIRED when linked but access token cannot be refreshed', async () => {
    mocks.getUserById.mockResolvedValueOnce({
      id: 'user-1',
      googleId: 'google-1',
      googleEmail: 'google@example.com',
      email: 'user@example.com',
      name: 'User',
      picture: '',
      accessToken: '',
      refreshToken: 'refresh-token',
      expiresAt: new Date('2026-01-01T00:00:00Z'),
      passwordHash: null,
    });
    mocks.getValidAccessToken.mockResolvedValueOnce(null);

    const response = await fetch(`${baseUrl}/api/gmail/status`);
    expect(response.status).toBe(403);
    const payload = await response.json() as { error: string; code?: string };
    expect(payload.code).toBe('GMAIL_AUTH_REQUIRED');
  });
});

