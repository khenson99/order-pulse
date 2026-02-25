import { Response, NextFunction } from "express";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import type { AuthContext, AuthenticatedRequest, ErrorCode } from "../types";
import type { Logger } from "../lib/logger";

export interface AuthDependencies {
  accessTokenVerifier: {
    verify(token: string): Promise<{ sub: string; token_use: string }>;
  };
  idTokenVerifier: {
    verify(token: string): Promise<Record<string, unknown>>;
  };
  logger: Logger;
}

function sendAuthError(
  res: Response,
  code: ErrorCode,
  message: string,
  requestId: string,
) {
  res.status(401).json({
    error: { code, message, requestId },
  });
}

export function createAuthMiddleware(deps: AuthDependencies) {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) => {
    const requestId = req.requestId ?? "unknown";
    const authHeader = req.headers.authorization;
    const idTokenHeader = req.headers["x-id-token"] as string | undefined;

    if (!authHeader?.startsWith("Bearer ") || !idTokenHeader) {
      deps.logger.warn(
        { requestId, path: req.path },
        "Missing auth tokens",
      );
      sendAuthError(
        res,
        "AUTH_MISSING_TOKEN",
        "Authorization Bearer token and X-ID-Token headers are required",
        requestId,
      );
      return;
    }

    const accessToken = authHeader.slice(7);

    try {
      await deps.accessTokenVerifier.verify(accessToken);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Token verification failed";
      const isExpired = message.toLowerCase().includes("expired");
      const code: ErrorCode = isExpired ? "AUTH_EXPIRED_TOKEN" : "AUTH_INVALID_TOKEN";

      deps.logger.warn(
        { requestId, path: req.path, error: message },
        "Access token verification failed",
      );
      sendAuthError(res, code, "Invalid or expired access token", requestId);
      return;
    }

    try {
      const idPayload = await deps.idTokenVerifier.verify(idTokenHeader);
      const sub = idPayload.sub as string;
      const email = (idPayload.email as string) ?? "";
      const tenantId = (idPayload["custom:tenant"] as string) ?? "";

      if (!sub) {
        sendAuthError(res, "AUTH_INVALID_TOKEN", "ID token missing sub claim", requestId);
        return;
      }

      const auth: AuthContext = { sub, email, tenantId };
      req.auth = auth;

      deps.logger.info(
        { requestId, userId: sub, tenantId, path: req.path, method: req.method },
        "Request authenticated",
      );

      next();
    } catch (err) {
      const message = err instanceof Error ? err.message : "ID token verification failed";
      deps.logger.warn(
        { requestId, path: req.path, error: message },
        "ID token verification failed",
      );
      sendAuthError(res, "AUTH_INVALID_TOKEN", "Invalid ID token", requestId);
    }
  };
}

export function createCognitoVerifiers(
  userPoolId: string,
  clientId: string,
) {
  const accessTokenVerifier = CognitoJwtVerifier.create({
    userPoolId,
    tokenUse: "access",
    clientId,
  });

  const idTokenVerifier = CognitoJwtVerifier.create({
    userPoolId,
    tokenUse: "id",
    clientId,
  });

  return { accessTokenVerifier, idTokenVerifier };
}
