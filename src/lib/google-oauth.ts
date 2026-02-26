import { google } from "googleapis";
import { ApiError } from "../types";

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
] as const;

export function buildGmailAuthUrl(params: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  state: string;
  scopes?: readonly string[];
}): string {
  const oauth2Client = new google.auth.OAuth2(
    params.clientId,
    params.clientSecret,
    params.redirectUri,
  );

  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: params.scopes?.length ? [...params.scopes] : [...GMAIL_SCOPES],
    state: params.state,
  });
}

type TokenExchangeResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
};

async function postForm(url: string, body: Record<string, string>): Promise<TokenExchangeResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });

  const json = (await res.json().catch(() => null)) as TokenExchangeResponse | null;
  if (!res.ok) {
    const message =
      json?.error_description
      || json?.error
      || `OAuth token endpoint failed (${res.status})`;
    throw new ApiError(502, "INTERNAL_ERROR", message);
  }
  return json ?? {};
}

export async function exchangeCodeForTokens(params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<{ accessToken: string; refreshToken: string | null; expiryDateMs: number | null }> {
  const json = await postForm("https://oauth2.googleapis.com/token", {
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
    grant_type: "authorization_code",
  });

  const accessToken = typeof json.access_token === "string" ? json.access_token : "";
  const refreshToken = typeof json.refresh_token === "string" ? json.refresh_token : null;
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : null;
  const expiryDateMs = expiresIn ? Date.now() + expiresIn * 1000 : null;

  if (!accessToken) {
    throw new ApiError(502, "INTERNAL_ERROR", "OAuth token exchange returned no access_token");
  }

  return { accessToken, refreshToken, expiryDateMs };
}

export async function refreshAccessToken(params: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<{ accessToken: string; expiryDateMs: number | null }> {
  const json = await postForm("https://oauth2.googleapis.com/token", {
    refresh_token: params.refreshToken,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    grant_type: "refresh_token",
  });

  const accessToken = typeof json.access_token === "string" ? json.access_token : "";
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : null;
  const expiryDateMs = expiresIn ? Date.now() + expiresIn * 1000 : null;

  if (!accessToken) {
    throw new ApiError(502, "INTERNAL_ERROR", "OAuth refresh returned no access_token");
  }

  return { accessToken, expiryDateMs };
}

