import { asDateFromExpiresIn, IntegrationAuthError, parseJsonResponse, requireEnv } from './errors.js';

const XERO_AUTHORIZE_URL = 'https://login.xero.com/identity/connect/authorize';
const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';
const XERO_CONNECTIONS_URL = 'https://api.xero.com/connections';
const XERO_ACCOUNTING_BASE_URL = 'https://api.xero.com/api.xro/2.0';
const XERO_SCOPES = ['openid', 'profile', 'email', 'offline_access', 'accounting.transactions.read'];

export interface XeroTokenPayload {
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
  scope?: string;
}

export interface XeroTenantConnection {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantType: string;
}

function redirectUri(): string {
  const backendUrl = requireEnv('BACKEND_URL');
  return `${backendUrl.replace(/\/+$/, '')}/api/integrations/xero/callback`;
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

function toTokenPayload(payload: any): XeroTokenPayload {
  if (!payload?.access_token || !payload?.refresh_token) {
    throw new IntegrationAuthError('XERO_TOKEN_INVALID', 'Xero token response is missing required fields.');
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    tokenExpiresAt: asDateFromExpiresIn(payload.expires_in),
    scope: typeof payload.scope === 'string' ? payload.scope : undefined,
  };
}

export function buildXeroAuthUrl(state: string): string {
  const clientId = requireEnv('XERO_CLIENT_ID');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri(),
    scope: XERO_SCOPES.join(' '),
    state,
  });

  return `${XERO_AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeXeroCodeForTokens(code: string): Promise<XeroTokenPayload> {
  const clientId = requireEnv('XERO_CLIENT_ID');
  const clientSecret = requireEnv('XERO_CLIENT_SECRET');

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
  });

  const response = await fetch(XERO_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(clientId, clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new IntegrationAuthError(
      'XERO_TOKEN_EXCHANGE_FAILED',
      payload?.error_description || payload?.error || `Xero token exchange failed (${response.status}).`,
    );
  }

  return toTokenPayload(payload);
}

export async function refreshXeroTokens(refreshToken: string): Promise<XeroTokenPayload> {
  const clientId = requireEnv('XERO_CLIENT_ID');
  const clientSecret = requireEnv('XERO_CLIENT_SECRET');

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const response = await fetch(XERO_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(clientId, clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new IntegrationAuthError(
      'XERO_TOKEN_REFRESH_FAILED',
      payload?.error_description || payload?.error || `Xero token refresh failed (${response.status}).`,
    );
  }

  return toTokenPayload(payload);
}

export async function fetchXeroTenants(accessToken: string): Promise<XeroTenantConnection[]> {
  const response = await fetch(XERO_CONNECTIONS_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new IntegrationAuthError('XERO_CONNECTIONS_FAILED', `Unable to read Xero tenant connections (${response.status}).`);
  }

  if (!Array.isArray(payload)) return [];

  return payload
    .filter((row) => typeof row?.tenantId === 'string')
    .map((row) => ({
      id: String(row.id || row.tenantId),
      tenantId: String(row.tenantId),
      tenantName: String(row.tenantName || row.tenantId),
      tenantType: String(row.tenantType || ''),
    }));
}

export async function fetchXeroOrganizationName(tenantId: string, accessToken: string): Promise<string | undefined> {
  const response = await fetch(`${XERO_ACCOUNTING_BASE_URL}/Organisation`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'xero-tenant-id': tenantId,
      Accept: 'application/json',
    },
  });

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    return undefined;
  }

  const org = Array.isArray(payload?.Organisations) ? payload.Organisations[0] : undefined;
  return typeof org?.Name === 'string' ? org.Name : undefined;
}

export async function revokeXeroConnection(connectionId: string, accessToken: string): Promise<void> {
  if (!connectionId) return;

  const response = await fetch(`${XERO_CONNECTIONS_URL}/${encodeURIComponent(connectionId)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const payload = await parseJsonResponse(response);
    throw new IntegrationAuthError(
      'XERO_CONNECTION_REVOKE_FAILED',
      payload?.message || payload?.error || `Xero connection revoke failed (${response.status}).`,
    );
  }
}
