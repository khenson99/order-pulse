import { Router } from "express";
import type { Response } from "express";
import type { AuthenticatedRequest } from "../types";
import { ApiError } from "../types";
import type { Config } from "../config";
import { GmailOAuthStore } from "../lib/gmail-oauth-store";
import { buildGmailAuthUrl } from "../lib/google-oauth";
import { refreshAccessToken } from "../lib/google-oauth";

function requireGmailConfig(config: Config): { clientId: string; clientSecret: string } {
  if (!config.googleClientId || !config.googleClientSecret) {
    throw new ApiError(503, "INTERNAL_ERROR", "Gmail OAuth is not configured");
  }
  return { clientId: config.googleClientId, clientSecret: config.googleClientSecret };
}

function isAccessTokenFresh(expiresAtMs: number | null): boolean {
  if (!expiresAtMs) return false;
  const skewMs = 60_000;
  return Date.now() + skewMs < expiresAtMs;
}

export function createOnboardingRoutes(params: {
  config: Config;
  gmailStore: GmailOAuthStore;
}) {
  const router = Router();

  router.get("/session", (req, res: Response) => {
    const { sub, tenantId } = (req as AuthenticatedRequest).auth;
    res.json({
      data: {
        userId: sub,
        tenantId,
        message: "Session endpoint placeholder",
      },
    });
  });

  router.post("/gmail/oauth/start", async (req, res) => {
    const { sub, tenantId } = (req as AuthenticatedRequest).auth;
    const gmail = requireGmailConfig(params.config);

    const { stateId } = await params.gmailStore.createOauthState({
      tenantId,
      userId: sub,
      returnTo: req.body?.returnTo,
    });

    const redirectUri = `${params.config.onboardingApiOrigin}/api/onboarding/gmail/oauth/callback`;
    const authUrl = buildGmailAuthUrl({
      clientId: gmail.clientId,
      clientSecret: gmail.clientSecret,
      redirectUri,
      state: stateId,
    });

    res.json({ authUrl });
  });

  router.get("/gmail/status", async (req, res) => {
    const { sub, tenantId } = (req as AuthenticatedRequest).auth;
    const configured = Boolean(params.config.googleClientId && params.config.googleClientSecret && params.config.onboardingTokenEncryptionKey);
    if (!configured) {
      res.json({ configured: false, connected: false });
      return;
    }

    const tokens = await params.gmailStore.getTokens({ tenantId, userId: sub });
    if (!tokens) {
      res.json({ configured: true, connected: false });
      return;
    }

    if (tokens.accessToken && isAccessTokenFresh(tokens.expiryDateMs)) {
      res.json({
        configured: true,
        connected: true,
        tokenExpiresAtMs: tokens.expiryDateMs,
      });
      return;
    }

    // Validate refresh viability by performing a refresh when needed.
    try {
      const gmail = requireGmailConfig(params.config);
      const refreshed = await refreshAccessToken({
        refreshToken: tokens.refreshToken,
        clientId: gmail.clientId,
        clientSecret: gmail.clientSecret,
      });

      await params.gmailStore.setTokens({
        tenantId,
        userId: sub,
        refreshToken: tokens.refreshToken,
        accessToken: refreshed.accessToken,
        expiryDateMs: refreshed.expiryDateMs,
      });

      res.json({
        configured: true,
        connected: true,
        tokenExpiresAtMs: refreshed.expiryDateMs,
      });
    } catch {
      res.json({ configured: true, connected: false });
    }
  });

  return router;
}

