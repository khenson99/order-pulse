import express, { Request, Response } from "express";
import { requestIdMiddleware } from "./middleware/request-id";
import { createAuthMiddleware, type AuthDependencies } from "./middleware/auth";
import { createErrorHandler } from "./middleware/error-handler";
import { createOnboardingRoutes } from "./routes/onboarding";
import { createGmailPublicRoutes } from "./routes/gmail-public";
import type { Logger } from "./lib/logger";
import type { Config } from "./config";
import type { OnboardingSessionStore } from "./lib/onboarding-session-store";
import { GmailOAuthStore, type KeyValueStore } from "./lib/gmail-oauth-store";

export interface AppDependencies {
  auth: AuthDependencies;
  logger: Logger;
  config: Config;
  kv: KeyValueStore;
  sessionStore: OnboardingSessionStore;
}

export function createApp(deps: AppDependencies) {
  const app = express();

  app.use(express.json());
  app.use(requestIdMiddleware as express.RequestHandler);

  // Health check (no auth required)
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  const gmailStore = new GmailOAuthStore(
    deps.kv,
    deps.config.onboardingTokenEncryptionKey,
  );

  // Public callback route (Google redirects here). Must be mounted before auth.
  app.use(
    "/api/onboarding/gmail",
    createGmailPublicRoutes({
      config: deps.config,
      gmailStore,
    }),
  );

  const authMiddleware = createAuthMiddleware(deps.auth);
  const onboardingRoutes = createOnboardingRoutes({
    logger: deps.logger,
    sessionStore: deps.sessionStore,
    config: deps.config,
    gmailStore,
  });

  // Most /api/onboarding/* routes require auth.
  // Exception: mobile token flows for scan/photo sessions (no Cognito headers).
  app.use(
    "/api/onboarding",
    ((req, res, next) => {
      const path = req.path ?? "";
      if (path === "/health") return next();

      const query = req.query as Record<string, unknown> | undefined;
      const token = query?.token;
      const isTokenFlow =
        typeof token === "string" &&
        token.length > 0 &&
        (path.startsWith("/scan-sessions/") || path.startsWith("/photo-sessions/"));

      if (isTokenFlow) return next();
      return (authMiddleware as express.RequestHandler)(req, res, next);
    }) as express.RequestHandler,
    onboardingRoutes as express.RequestHandler,
  );

  app.use(createErrorHandler(deps.logger) as express.ErrorRequestHandler);

  return app;
}

