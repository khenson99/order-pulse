import { Router, type Request, type Response } from "express";
import type { S3Client } from "@aws-sdk/client-s3";
import type { Logger } from "../lib/logger";
import type { Config } from "../config";
import { ApiError, type AuthContext } from "../types";
import type { CapturedPhoto, ScannedBarcode } from "../lib/onboarding-session-store";
import { OnboardingSessionStore } from "../lib/onboarding-session-store";
import { GmailOAuthStore, type KeyValueStore } from "../lib/gmail-oauth-store";
import { buildGmailAuthUrl, refreshAccessToken } from "../lib/google-oauth";
import { createImageUploadUrl } from "../lib/image-upload";
import { lookupProductByBarcode, validateBarcodeLookupCode } from "../lib/barcode-lookup";
import { scrapeUrls } from "../lib/url-scraper";

const TOKEN_EXPIRED_MESSAGE =
  "Session expired. Please reopen the link from the desktop session.";
const TOKEN_INVALID_MESSAGE =
  "Invalid session token. Please reopen the link from the desktop session.";

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

function tokenParam(req: { query: unknown }): string | null {
  const query = req.query as Record<string, unknown> | undefined;
  const value = query?.token;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function sendTokenError(res: Response, kind: "expired" | "invalid") {
  if (kind === "expired") {
    res.status(401).json({ code: "session_expired", message: TOKEN_EXPIRED_MESSAGE });
    return;
  }
  res.status(403).json({ code: "invalid_session_token", message: TOKEN_INVALID_MESSAGE });
}

function mapApiErrorToAdHocResponse(res: Response, err: ApiError) {
  if (err.statusCode === 404) {
    res.status(404).json({ error: err.message });
    return;
  }
  if (err.statusCode === 429) {
    res.setHeader("Retry-After", "10");
    res.status(429).json({ error: err.message });
    return;
  }
  if (err.statusCode === 400 || err.statusCode === 422) {
    res.status(400).json({ error: err.message });
    return;
  }
  // Default: fall back to stable error handler.
  throw err;
}

type MaybeAuthRequest = Request & { auth?: AuthContext; requestId?: string };

async function requireSessionAccess(params: {
  req: MaybeAuthRequest;
  res: Response;
  store: OnboardingSessionStore;
  sessionId: string;
}): Promise<{ createdAt: string } | null> {
  const token = tokenParam(params.req);
  if (token) {
    const result = await params.store.validateToken(params.sessionId, token);
    if (result === "expired") {
      sendTokenError(params.res, "expired");
      return null;
    }
    if (result === "invalid") {
      sendTokenError(params.res, "invalid");
      return null;
    }
    const meta = await params.store.getMeta(params.sessionId);
    if (!meta) {
      sendTokenError(params.res, "expired");
      return null;
    }
    return { createdAt: meta.createdAt };
  }

  const auth = params.req.auth;
  if (!auth) {
    params.res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  const meta = await params.store.getMeta(params.sessionId);
  if (!meta) {
    params.res.status(404).json({ error: "Session not found" });
    return null;
  }
  if (meta.userId !== auth.sub || meta.tenantId !== auth.tenantId) {
    params.res.status(404).json({ error: "Session not found" });
    return null;
  }
  return { createdAt: meta.createdAt };
}

export function createOnboardingRoutes(deps: {
  logger: Logger;
  sessionStore: OnboardingSessionStore;
  config: Config;
  gmailStore: GmailOAuthStore;
  s3: S3Client;
  kv: KeyValueStore;
}) {
  const router = Router();

  router.get("/health", (_req, res: Response) => {
    res.json({ status: "ok" });
  });

  router.post("/gmail/oauth/start", async (req, res) => {
    const auth = (req as MaybeAuthRequest).auth;
    if (!auth) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const gmail = requireGmailConfig(deps.config);
    const { stateId } = await deps.gmailStore.createOauthState({
      tenantId: auth.tenantId,
      userId: auth.sub,
      returnTo: req.body?.returnTo,
    });

    const redirectUri = `${deps.config.onboardingApiOrigin}/api/onboarding/gmail/oauth/callback`;
    const authUrl = buildGmailAuthUrl({
      clientId: gmail.clientId,
      clientSecret: gmail.clientSecret,
      redirectUri,
      state: stateId,
    });

    res.json({ authUrl });
  });

  router.get("/gmail/status", async (req, res) => {
    const auth = (req as MaybeAuthRequest).auth;
    if (!auth) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const configured = Boolean(
      deps.config.googleClientId
      && deps.config.googleClientSecret
      && deps.config.onboardingTokenEncryptionKey,
    );
    if (!configured) {
      res.json({ configured: false, connected: false });
      return;
    }

    const tokens = await deps.gmailStore.getTokens({
      tenantId: auth.tenantId,
      userId: auth.sub,
    });
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

    try {
      const gmail = requireGmailConfig(deps.config);
      const refreshed = await refreshAccessToken({
        refreshToken: tokens.refreshToken,
        clientId: gmail.clientId,
        clientSecret: gmail.clientSecret,
      });

      await deps.gmailStore.setTokens({
        tenantId: auth.tenantId,
        userId: auth.sub,
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

  router.post("/sessions", async (req, res: Response) => {
    try {
      const auth = (req as MaybeAuthRequest).auth;
      if (!auth) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const { sub, tenantId } = auth;
      const created = await deps.sessionStore.createSession({
        tenantId,
        userId: sub,
      });
      deps.logger.info(
        { sessionId: created.sessionId, tenantId, userId: sub },
        "Onboarding session created",
      );
      res.json({
        sessionId: created.sessionId,
        mobileBarcodeUrl: created.mobileBarcodeUrl,
        mobilePhotoUrl: created.mobilePhotoUrl,
      });
    } catch (err) {
      if (err instanceof ApiError) return mapApiErrorToAdHocResponse(res, err);
      throw err;
    }
  });

  router.post("/session/images/upload-url", async (req, res: Response) => {
    try {
      const auth = (req as MaybeAuthRequest).auth;
      if (!auth) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const body = (req.body ?? null) as { fileName?: unknown; contentType?: unknown } | null;
      const fileName = typeof body?.fileName === "string" ? body?.fileName : "";
      const contentType = typeof body?.contentType === "string" ? body?.contentType : "";

      const result = await createImageUploadUrl({
        s3: deps.s3,
        bucket: deps.config.onboardingImageUploadBucket,
        prefix: deps.config.onboardingImageUploadPrefix,
        expiresInSeconds: deps.config.onboardingImageUploadUrlExpiresInSeconds,
        tenantId: auth.tenantId,
        userId: auth.sub,
        fileName,
        contentType,
      });

      res.json(result);
    } catch (err) {
      if (err instanceof ApiError) return mapApiErrorToAdHocResponse(res, err);
      throw err;
    }
  });

  router.get("/barcode/lookup", async (req, res: Response) => {
    if (!(req as MaybeAuthRequest).auth) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const code = validateBarcodeLookupCode(req.query?.code);
    const product = await lookupProductByBarcode(code, {
      kv: deps.kv,
      timeoutMs: 5000,
    });

    if (!product) {
      throw new ApiError(404, "NOT_FOUND", "Barcode not found");
    }

    res.json({ product });
  });

  router.post("/url/scrape", async (req, res: Response) => {
    if (!(req as MaybeAuthRequest).auth) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const body = (req.body ?? null) as { urls?: unknown } | null;
    const urls = body?.urls;
    if (!Array.isArray(urls)) {
      throw new ApiError(422, "VALIDATION_ERROR", "urls must be an array of strings");
    }

    const response = await scrapeUrls(urls as any);
    res.json(response);
  });

  router.get("/scan-sessions/:sessionId/barcodes", async (req, res: Response) => {
    const sessionId = req.params.sessionId;
    try {
      const access = await requireSessionAccess({
        req: req as MaybeAuthRequest,
        res,
        store: deps.sessionStore,
        sessionId,
      });
      if (!access) return;

      const barcodes = await deps.sessionStore.listBarcodes(sessionId);
      res.json({
        barcodes,
        sessionCreatedAt: access.createdAt,
        totalCount: barcodes.length,
      });
    } catch (err) {
      if (err instanceof ApiError) return mapApiErrorToAdHocResponse(res, err);
      throw err;
    }
  });

  router.post("/scan-sessions/:sessionId/barcodes", async (req, res: Response) => {
    const sessionId = req.params.sessionId;
    try {
      const access = await requireSessionAccess({
        req: req as MaybeAuthRequest,
        res,
        store: deps.sessionStore,
        sessionId,
      });
      if (!access) return;

      const body = (req.body ?? null) as { barcode?: unknown } | null;
      const barcode = body?.barcode as ScannedBarcode | undefined;
      if (!barcode?.barcode || typeof barcode.barcode !== "string") {
        res.status(400).json({ error: "barcode is required" });
        return;
      }

      const result = await deps.sessionStore.addBarcode(sessionId, barcode);
      res.json({ success: true, duplicate: result.duplicate || undefined, barcode: result.barcode });
    } catch (err) {
      if (err instanceof ApiError) return mapApiErrorToAdHocResponse(res, err);
      throw err;
    }
  });

  router.put(
    "/scan-sessions/:sessionId/barcodes/:barcodeId",
    async (req, res: Response) => {
      const { sessionId, barcodeId } = req.params;
      try {
        const access = await requireSessionAccess({
          req: req as MaybeAuthRequest,
          res,
          store: deps.sessionStore,
          sessionId,
        });
        if (!access) return;

        const patch = (req.body ?? null) as Partial<ScannedBarcode> | null;
        const next = await deps.sessionStore.updateBarcode(sessionId, barcodeId, patch ?? {});
        res.json({ success: true, barcode: next });
      } catch (err) {
        if (err instanceof ApiError) return mapApiErrorToAdHocResponse(res, err);
        throw err;
      }
    },
  );

  router.get("/photo-sessions/:sessionId/photos", async (req, res: Response) => {
    const sessionId = req.params.sessionId;
    try {
      const access = await requireSessionAccess({
        req: req as MaybeAuthRequest,
        res,
        store: deps.sessionStore,
        sessionId,
      });
      if (!access) return;

      const photos = await deps.sessionStore.listPhotos(sessionId);
      res.json({
        photos,
        sessionCreatedAt: access.createdAt,
        totalCount: photos.length,
      });
    } catch (err) {
      if (err instanceof ApiError) return mapApiErrorToAdHocResponse(res, err);
      throw err;
    }
  });

  router.post("/photo-sessions/:sessionId/photos", async (req, res: Response) => {
    const sessionId = req.params.sessionId;
    try {
      const access = await requireSessionAccess({
        req: req as MaybeAuthRequest,
        res,
        store: deps.sessionStore,
        sessionId,
      });
      if (!access) return;

      const body = (req.body ?? null) as { photo?: unknown } | null;
      const photo = body?.photo as CapturedPhoto | undefined;
      if (!photo?.imageData || typeof photo.imageData !== "string") {
        res.status(400).json({ error: "photo.imageData is required" });
        return;
      }

      const saved = await deps.sessionStore.addPhoto(sessionId, photo);
      res.json({ success: true, photo: saved });
    } catch (err) {
      if (err instanceof ApiError) return mapApiErrorToAdHocResponse(res, err);
      throw err;
    }
  });

  router.get(
    "/photo-sessions/:sessionId/photos/:photoId",
    async (req, res: Response) => {
      const { sessionId, photoId } = req.params;
      try {
        const access = await requireSessionAccess({
          req: req as MaybeAuthRequest,
          res,
          store: deps.sessionStore,
          sessionId,
        });
        if (!access) return;

        const photo = await deps.sessionStore.getPhoto(sessionId, photoId);
        res.json({ photo });
      } catch (err) {
        if (err instanceof ApiError) return mapApiErrorToAdHocResponse(res, err);
        throw err;
      }
    },
  );

  router.put(
    "/photo-sessions/:sessionId/photos/:photoId/metadata",
    async (req, res: Response) => {
      const { sessionId, photoId } = req.params;
      try {
        const access = await requireSessionAccess({
          req: req as MaybeAuthRequest,
          res,
          store: deps.sessionStore,
          sessionId,
        });
        if (!access) return;

        const patch = (req.body ?? null) as Partial<CapturedPhoto> | null;
        const next = await deps.sessionStore.updatePhotoMetadata(sessionId, photoId, patch ?? {});
        res.json({ success: true, photo: next });
      } catch (err) {
        if (err instanceof ApiError) return mapApiErrorToAdHocResponse(res, err);
        throw err;
      }
    },
  );

  return router;
}
