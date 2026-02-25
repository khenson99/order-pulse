import express, { Request, Response } from "express";
import { requestIdMiddleware } from "./middleware/request-id";
import { createAuthMiddleware, type AuthDependencies } from "./middleware/auth";
import { createErrorHandler } from "./middleware/error-handler";
import onboardingRoutes from "./routes/onboarding";
import type { Logger } from "./lib/logger";

export interface AppDependencies {
  auth: AuthDependencies;
  logger: Logger;
}

export function createApp(deps: AppDependencies) {
  const app = express();

  app.use(express.json());
  app.use(requestIdMiddleware as express.RequestHandler);

  // Health check (no auth required)
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  // All /api/onboarding/* routes require auth
  const authMiddleware = createAuthMiddleware(deps.auth);
  app.use(
    "/api/onboarding",
    authMiddleware as express.RequestHandler,
    onboardingRoutes,
  );

  app.use(createErrorHandler(deps.logger) as express.ErrorRequestHandler);

  return app;
}
