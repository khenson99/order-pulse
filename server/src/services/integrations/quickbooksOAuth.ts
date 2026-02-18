import { asDateFromExpiresIn, IntegrationAuthError, parseJsonResponse, requireEnv } from './errors.js';

const QUICKBOOKS_OAUTH_AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2';
const QUICKBOOKS_OAUTH_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const QUICKBOOKS_API_BASE_URL = 'https://quickbooks.api.intuit.com';
const QUICKBOOKS_SCOPES = ['com.intuit.quickbooks.accounting'];

export interface QuickBooksTokenPayload {
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
  scope?: string;
}

function redirectUri(): string {
  const backendUrl = requireEnv('BACKEND_URL');
  return `${backendUrl.replace(/\/+$/, '')}/api/integrations/quickbooks/callback`;
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

function toTokenPayload(payload: any): QuickBooksTokenPayload {
  if (!payload?.access_token || !payload?.refresh_token) {
    throw new IntegrationAuthError('QUICKBOOKS_TOKEN_INVALID', 'QuickBooks token response is missing required fields.');
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    tokenExpiresAt: asDateFromExpiresIn(payload.expires_in),
    scope: typeof payload.scope === 'string' ? payload.scope : undefined,
  };
}

export function buildQuickBooksAuthUrl(state: string): string {
  const clientId = requireEnv('QUICKBOOKS_CLIENT_ID');
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: QUICKBOOKS_SCOPES.join(' '),
    redirect_uri: redirectUri(),
    state,
  });
  return `${QUICKBOOKS_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeQuickBooksCodeForTokens(code: string): Promise<QuickBooksTokenPayload> {
  const clientId = requireEnv('QUICKBOOKS_CLIENT_ID');
  const clientSecret = requireEnv('QUICKBOOKS_CLIENT_SECRET');

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
  });

  const response = await fetch(QUICKBOOKS_OAUTH_TOKEN_URL, {
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
      'QUICKBOOKS_TOKEN_EXCHANGE_FAILED',
      payload?.error_description || payload?.error || `QuickBooks token exchange failed (${response.status}).`,
    );
  }

  return toTokenPayload(payload);
}

export async function refreshQuickBooksTokens(refreshToken: string): Promise<QuickBooksTokenPayload> {
  const clientId = requireEnv('QUICKBOOKS_CLIENT_ID');
  const clientSecret = requireEnv('QUICKBOOKS_CLIENT_SECRET');

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const response = await fetch(QUICKBOOKS_OAUTH_TOKEN_URL, {
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
      'QUICKBOOKS_TOKEN_REFRESH_FAILED',
      payload?.error_description || payload?.error || `QuickBooks token refresh failed (${response.status}).`,
    );
  }

  return toTokenPayload(payload);
}

export async function fetchQuickBooksCompanyName(realmId: string, accessToken: string): Promise<string | undefined> {
  const response = await fetch(
    `${QUICKBOOKS_API_BASE_URL}/v3/company/${encodeURIComponent(realmId)}/companyinfo/${encodeURIComponent(realmId)}?minorversion=75`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    },
  );

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    return undefined;
  }

  return payload?.CompanyInfo?.CompanyName || payload?.QueryResponse?.CompanyInfo?.[0]?.CompanyName;
}

export async function revokeQuickBooksToken(token: string): Promise<void> {
  const clientId = requireEnv('QUICKBOOKS_CLIENT_ID');
  const clientSecret = requireEnv('QUICKBOOKS_CLIENT_SECRET');

  const body = new URLSearchParams({
    token,
  });

  const response = await fetch('https://developer.api.intuit.com/v2/oauth2/tokens/revoke', {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(clientId, clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });

  if (!response.ok) {
    const payload = await parseJsonResponse(response);
    throw new IntegrationAuthError(
      'QUICKBOOKS_TOKEN_REVOKE_FAILED',
      payload?.error_description || payload?.error || `QuickBooks token revoke failed (${response.status}).`,
    );
  }
}
