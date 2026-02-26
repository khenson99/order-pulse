import express, { Request, Response } from "express";
import { requestIdMiddleware } from "./middleware/request-id";
import { createAuthMiddleware, type AuthDependencies } from "./middleware/auth";
import { createErrorHandler } from "./middleware/error-handler";
import { createOnboardingRoutes } from "./routes/onboarding";
import { createGmailPublicRoutes } from "./routes/gmail-public";
import type { Logger } from "./lib/logger";
import type { Config } from "./config";
import { GmailOAuthStore, type KeyValueStore } from "./lib/gmail-oauth-store";

export interface AppDependencies {
  auth: AuthDependencies;
  logger: Logger;
  config: Config;
  kv: KeyValueStore;
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

  // All /api/onboarding/* routes require auth
  const authMiddleware = createAuthMiddleware(deps.auth);
  app.use(
    "/api/onboarding",
    authMiddleware as express.RequestHandler,
    createOnboardingRoutes({
      config: deps.config,
      gmailStore,
    }),
  );

  app.use(createErrorHandler(deps.logger) as express.ErrorRequestHandler);

  return app;
}
