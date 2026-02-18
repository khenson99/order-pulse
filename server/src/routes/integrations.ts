import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Request, Response, Router } from 'express';
import { decrypt, encrypt } from '../utils/encryption.js';
import {
  buildQuickBooksAuthUrl,
  exchangeQuickBooksCodeForTokens,
  fetchQuickBooksCompanyName,
  revokeQuickBooksToken,
} from '../services/integrations/quickbooksOAuth.js';
import {
  buildXeroAuthUrl,
  exchangeXeroCodeForTokens,
  fetchXeroOrganizationName,
  fetchXeroTenants,
  revokeXeroConnection,
} from '../services/integrations/xeroOAuth.js';
import {
  deleteProviderConnectionForUser,
  getProviderConnectionByIdForUser,
  getProviderConnectionByProviderTenant,
  insertWebhookEvent,
  listProviderConnectionsForUser,
  listProviderSyncRunsForConnection,
  markWebhookEventProcessed,
  upsertProviderConnection,
} from '../services/integrations/store.js';
import { IntegrationProvider } from '../services/integrations/types.js';
import { enqueueProviderSync, enqueueProviderSyncByTenant } from '../services/integrations/syncOrchestrator.js';
import { enableAccountingConnectors } from '../config.js';

const router = Router();
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

const oauthStateStore = new Map<string, { userId: string; provider: IntegrationProvider; expiresAt: number }>();

function isSupportedProvider(value: string): value is IntegrationProvider {
  return value === 'quickbooks' || value === 'xero';
}

function requireAuth(req: Request, res: Response, next: () => void): void {
  if (!req.session?.userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  next();
}

function requireConnectorsEnabled(res: Response): boolean {
  if (!enableAccountingConnectors) {
    res.status(404).json({ error: 'Accounting connectors are disabled' });
    return false;
  }
  return true;
}

function pruneOauthStateStore(now = Date.now()): void {
  for (const [key, value] of oauthStateStore.entries()) {
    if (value.expiresAt <= now) {
      oauthStateStore.delete(key);
    }
  }
}

function createOauthState(userId: string, provider: IntegrationProvider): string {
  const state = randomBytes(18).toString('hex');
  oauthStateStore.set(state, {
    userId,
    provider,
    expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
  });
  pruneOauthStateStore();
  return state;
}

function consumeOauthState(state: string): { userId: string; provider: IntegrationProvider } | null {
  const value = oauthStateStore.get(state);
  if (!value) return null;
  oauthStateStore.delete(state);
  if (value.expiresAt < Date.now()) return null;
  return {
    userId: value.userId,
    provider: value.provider,
  };
}

function frontendRedirectUrl(provider: IntegrationProvider, status: 'connected' | 'error', reason?: string): string {
  const base = process.env.FRONTEND_URL || 'http://localhost:5173';
  const url = new URL(base);
  url.searchParams.set('integration_provider', provider);
  url.searchParams.set('integration_status', status);
  if (reason) {
    url.searchParams.set('integration_reason', reason);
  }
  return url.toString();
}

router.post('/:provider/connect', requireAuth, async (req: Request, res: Response) => {
  if (!requireConnectorsEnabled(res)) return;

  const provider = req.params.provider;
  if (!isSupportedProvider(provider)) {
    return res.status(400).json({ error: 'provider must be quickbooks or xero' });
  }

  try {
    const state = createOauthState(req.session.userId!, provider);
    const authUrl = provider === 'quickbooks'
      ? buildQuickBooksAuthUrl(state)
      : buildXeroAuthUrl(state);

    res.json({ authUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to build connect URL';
    res.status(500).json({ error: message });
  }
});

router.get('/:provider/callback', async (req: Request, res: Response) => {
  if (!requireConnectorsEnabled(res)) return;

  const provider = req.params.provider;
  if (!isSupportedProvider(provider)) {
    return res.status(400).json({ error: 'provider must be quickbooks or xero' });
  }

  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';

  if (!code || !state) {
    return res.redirect(frontendRedirectUrl(provider, 'error', 'missing_code_or_state'));
  }

  const consumedState = consumeOauthState(state);
  if (!consumedState || consumedState.provider !== provider) {
    return res.redirect(frontendRedirectUrl(provider, 'error', 'invalid_state'));
  }

  if (!req.session?.userId || req.session.userId !== consumedState.userId) {
    return res.redirect(frontendRedirectUrl(provider, 'error', 'not_authenticated'));
  }

  try {
    if (provider === 'quickbooks') {
      const realmId = typeof req.query.realmId === 'string' ? req.query.realmId : '';
      if (!realmId) {
        return res.redirect(frontendRedirectUrl(provider, 'error', 'missing_realm_id'));
      }

      const tokens = await exchangeQuickBooksCodeForTokens(code);
      const tenantName = await fetchQuickBooksCompanyName(realmId, tokens.accessToken);

      const connection = await upsertProviderConnection({
        userId: consumedState.userId,
        provider,
        tenantId: realmId,
        tenantName,
        accessTokenEncrypted: encrypt(tokens.accessToken),
        refreshTokenEncrypted: encrypt(tokens.refreshToken),
        tokenExpiresAt: tokens.tokenExpiresAt,
        scope: tokens.scope,
        metadata: {
          realmId,
        },
      });

      await enqueueProviderSync(connection.id, consumedState.userId, 'backfill');
      return res.redirect(frontendRedirectUrl(provider, 'connected'));
    }

    const tokens = await exchangeXeroCodeForTokens(code);
    const tenants = await fetchXeroTenants(tokens.accessToken);
    if (!tenants.length) {
      return res.redirect(frontendRedirectUrl(provider, 'error', 'no_tenants'));
    }

    const requestedTenantId = typeof req.query.tenantId === 'string' ? req.query.tenantId : '';
    const selectedTenant = requestedTenantId
      ? tenants.find((tenant) => tenant.tenantId === requestedTenantId)
      : tenants[0];

    if (!selectedTenant) {
      return res.redirect(frontendRedirectUrl(provider, 'error', 'tenant_not_found'));
    }

    const tenantName = await fetchXeroOrganizationName(selectedTenant.tenantId, tokens.accessToken)
      || selectedTenant.tenantName;

    const connection = await upsertProviderConnection({
      userId: consumedState.userId,
      provider,
      tenantId: selectedTenant.tenantId,
      tenantName,
      accessTokenEncrypted: encrypt(tokens.accessToken),
      refreshTokenEncrypted: encrypt(tokens.refreshToken),
      tokenExpiresAt: tokens.tokenExpiresAt,
      scope: tokens.scope,
      metadata: {
        tenantType: selectedTenant.tenantType,
        candidateTenantCount: tenants.length,
        xeroConnectionId: selectedTenant.id,
      },
    });

    await enqueueProviderSync(connection.id, consumedState.userId, 'backfill');
    return res.redirect(frontendRedirectUrl(provider, 'connected'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'oauth_failure';
    return res.redirect(frontendRedirectUrl(provider, 'error', reason.slice(0, 120)));
  }
});

router.get('/connections', requireAuth, async (req: Request, res: Response) => {
  if (!requireConnectorsEnabled(res)) return;

  try {
    const connections = await listProviderConnectionsForUser(req.session.userId!);
    res.json({ connections });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load integration connections' });
  }
});

router.delete('/connections/:connectionId', requireAuth, async (req: Request, res: Response) => {
  if (!requireConnectorsEnabled(res)) return;

  try {
    const connection = await getProviderConnectionByIdForUser(req.params.connectionId, req.session.userId!);
    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    try {
      if (connection.provider === 'quickbooks') {
        const token = decrypt(connection.refreshTokenEncrypted) || decrypt(connection.accessTokenEncrypted);
        if (token) {
          await revokeQuickBooksToken(token);
        }
      } else {
        const accessToken = decrypt(connection.accessTokenEncrypted);
        const xeroConnectionId = (connection.metadata as Record<string, unknown> | undefined)?.xeroConnectionId;
        if (accessToken && typeof xeroConnectionId === 'string') {
          await revokeXeroConnection(xeroConnectionId, accessToken);
        }
      }
    } catch (error) {
      console.warn('Provider revoke failed during disconnect', {
        connectionId: connection.id,
        provider: connection.provider,
        error: error instanceof Error ? error.message : error,
      });
    }

    const deleted = await deleteProviderConnectionForUser(req.params.connectionId, req.session.userId!);
    if (!deleted) {
      return res.status(404).json({ error: 'Connection not found' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to disconnect provider' });
  }
});

router.post('/connections/:connectionId/sync', requireAuth, async (req: Request, res: Response) => {
  if (!requireConnectorsEnabled(res)) return;

  try {
    const result = await enqueueProviderSync(req.params.connectionId, req.session.userId!, 'manual');
    res.status(202).json({ success: true, runId: result.runId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to start sync';
    const statusCode = message.includes('not found') ? 404 : 500;
    res.status(statusCode).json({ error: message });
  }
});

router.get('/connections/:connectionId/runs', requireAuth, async (req: Request, res: Response) => {
  if (!requireConnectorsEnabled(res)) return;

  try {
    const runs = await listProviderSyncRunsForConnection(req.params.connectionId, req.session.userId!);
    res.json({ runs });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load sync runs' });
  }
});

function verifyQuickBooksWebhookSignature(payload: string, signatureHeader?: string): boolean {
  const verifier = process.env.QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN;
  if (!verifier) return true;
  if (!signatureHeader) return false;

  const computed = createHmac('sha256', verifier).update(payload).digest('base64');

  const expected = Buffer.from(computed);
  const provided = Buffer.from(signatureHeader);

  if (expected.length !== provided.length) {
    return false;
  }

  return timingSafeEqual(expected, provided);
}

interface QuickBooksWebhookEntity {
  name?: string;
  id?: string;
  operation?: string;
  lastUpdated?: string;
}

router.post('/webhooks/quickbooks', async (req: Request, res: Response) => {
  if (!requireConnectorsEnabled(res)) return;

  const rawBody = (req as Request & { rawBody?: string }).rawBody || JSON.stringify(req.body || {});
  const signatureHeader = typeof req.headers['intuit-signature'] === 'string'
    ? req.headers['intuit-signature']
    : undefined;

  const signatureValid = verifyQuickBooksWebhookSignature(rawBody, signatureHeader);

  const notifications = Array.isArray(req.body?.eventNotifications)
    ? req.body.eventNotifications
    : [];

  const syncByRealm = new Map<string, Set<string>>();

  for (let i = 0; i < notifications.length; i += 1) {
    const notification = notifications[i] as Record<string, unknown>;
    const realmId = String(notification.realmId || '');
    const entities = Array.isArray((notification.dataChangeEvent as Record<string, unknown> | undefined)?.entities)
      ? ((notification.dataChangeEvent as Record<string, unknown>).entities as QuickBooksWebhookEntity[])
      : [];

    for (let j = 0; j < entities.length; j += 1) {
      const entity = entities[j];
      if (String(entity.name || '').toLowerCase() !== 'purchaseorder') continue;
      if (!entity.id || !realmId) continue;

      const providerEventId = `${realmId}:${entity.id}:${entity.lastUpdated || i + '-' + j}`;
      const connection = await getProviderConnectionByProviderTenant('quickbooks', realmId);

      const inserted = await insertWebhookEvent(
        'quickbooks',
        providerEventId,
        {
          realmId,
          entity,
          notification,
        },
        connection?.id || null,
        signatureValid,
      );

      if (!inserted.inserted || !inserted.eventId) {
        continue;
      }

      if (!signatureValid) {
        await markWebhookEventProcessed(inserted.eventId, 'ignored');
        continue;
      }

      if (!connection) {
        await markWebhookEventProcessed(inserted.eventId, 'ignored');
        continue;
      }

      const existing = syncByRealm.get(realmId) || new Set<string>();
      existing.add(String(entity.id));
      syncByRealm.set(realmId, existing);
      await markWebhookEventProcessed(inserted.eventId, 'processed');
    }
  }

  if (signatureValid) {
    for (const [realmId, ids] of syncByRealm.entries()) {
      await enqueueProviderSyncByTenant('quickbooks', realmId, 'webhook', {
        externalIds: Array.from(ids),
      });
    }
  }

  res.status(202).json({ accepted: true, signatureValid, notifications: notifications.length });
});

export { router as integrationsRouter };
