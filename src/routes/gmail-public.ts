import { Router } from "express";
import { ApiError } from "../types";
import type { Config } from "../config";
import { GmailOAuthStore } from "../lib/gmail-oauth-store";
import { exchangeCodeForTokens, refreshAccessToken } from "../lib/google-oauth";

function buildFrontendRedirect(frontendOrigin: string, path: string, params: Record<string, string>) {
  const url = new URL(path, frontendOrigin);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return url.toString();
}

function sanitizeRedirectPath(path: string | null): string {
  return path || "/onboarding";
}

export function createGmailPublicRoutes(params: {
  config: Config;
  gmailStore: GmailOAuthStore;
}) {
  const router = Router();

  router.get("/oauth/callback", async (req, res) => {
    const error = typeof req.query.error === "string" ? req.query.error : null;
    const code = typeof req.query.code === "string" ? req.query.code : null;
    const stateId = typeof req.query.state === "string" ? req.query.state : null;

    const frontendOrigin = params.config.onboardingFrontendOrigin;

    if (error) {
      res.redirect(buildFrontendRedirect(frontendOrigin, "/onboarding", { gmail: "error", reason: error }));
      return;
    }

    if (!code || !stateId) {
      res.redirect(buildFrontendRedirect(frontendOrigin, "/onboarding", { gmail: "error", reason: "missing_code" }));
      return;
    }

    if (!params.config.googleClientId || !params.config.googleClientSecret) {
      res.redirect(buildFrontendRedirect(frontendOrigin, "/onboarding", { gmail: "error", reason: "not_configured" }));
      return;
    }

    const state = await params.gmailStore.consumeOauthState(stateId);
    if (!state) {
      res.redirect(buildFrontendRedirect(frontendOrigin, "/onboarding", { gmail: "error", reason: "invalid_state" }));
      return;
    }

    const redirectUri = `${params.config.onboardingApiOrigin}/api/onboarding/gmail/oauth/callback`;
    const exchanged = await exchangeCodeForTokens({
      code,
      clientId: params.config.googleClientId,
      clientSecret: params.config.googleClientSecret,
      redirectUri,
    });

    let refreshToken = exchanged.refreshToken;

    // If Google doesn't return a refresh token (common on repeat auth), keep the existing one when present.
    if (!refreshToken) {
      try {
        const existing = await params.gmailStore.getTokens({
          tenantId: state.tenantId,
          userId: state.userId,
        });
        refreshToken = existing?.refreshToken ?? null;
      } catch {
        // Ignore and fall through.
      }
    }

    if (!refreshToken) {
      res.redirect(buildFrontendRedirect(frontendOrigin, "/onboarding", { gmail: "error", reason: "missing_refresh_token" }));
      return;
    }

    // Sanity-check refresh works. If it doesn't, treat as failure rather than claiming "connected".
    try {
      const refreshed = await refreshAccessToken({
        refreshToken,
        clientId: params.config.googleClientId,
        clientSecret: params.config.googleClientSecret,
      });

      await params.gmailStore.setTokens({
        tenantId: state.tenantId,
        userId: state.userId,
        refreshToken,
        accessToken: refreshed.accessToken,
        expiryDateMs: refreshed.expiryDateMs ?? exchanged.expiryDateMs,
      });
    } catch (e) {
      const requestId = (req as any).requestId ?? "unknown";
      const message = e instanceof ApiError ? e.message : "token_refresh_failed";
      res.redirect(buildFrontendRedirect(frontendOrigin, "/onboarding", { gmail: "error", reason: message, requestId }));
      return;
    }

    const targetPath = sanitizeRedirectPath(state.returnTo);
    res.redirect(buildFrontendRedirect(frontendOrigin, targetPath, { gmail: "connected" }));
  });

  return router;
}
