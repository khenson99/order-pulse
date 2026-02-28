import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { ApiError } from "../types";

export interface SessionMeta {
  sessionId: string;
  createdAt: string;
  lastActivity: string;
  expiresAtMs: number;
  tenantId: string;
  userId: string;
  tokenHashHex: string;
}

export interface ScannedBarcode {
  id: string;
  barcode: string;
  barcodeType?: string;
  scannedAt: string;
  source: "mobile" | "desktop";
  productName?: string;
  brand?: string;
  imageUrl?: string;
  category?: string;
  [key: string]: unknown;
}

export interface CapturedPhoto {
  id: string;
  capturedAt: string;
  source: "mobile" | "desktop";
  imageData: string;
  analyzed: boolean;
  suggestedName?: string;
  suggestedSupplier?: string;
  [key: string]: unknown;
}

export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<string | null>;
  expire(key: string, seconds: number): Promise<number | boolean>;
  hGetAll(key: string): Promise<Record<string, string>>;
  hGet(key: string, field: string): Promise<string | null>;
  hSet(key: string, field: string, value: string): Promise<number>;
  hLen(key: string): Promise<number>;
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "hex");
  const bBuf = Buffer.from(b, "hex");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function metaKey(sessionId: string) {
  return `onboarding:session:${sessionId}:meta`;
}

function barcodesKey(sessionId: string) {
  return `onboarding:session:${sessionId}:barcodes`;
}

function photosKey(sessionId: string) {
  return `onboarding:session:${sessionId}:photos`;
}

export interface CreateSessionResult {
  sessionId: string;
  token: string;
  mobileBarcodeUrl: string;
  mobilePhotoUrl: string;
}

export class OnboardingSessionStore {
  constructor(
    private readonly redis: RedisLike,
    private readonly opts: {
      ttlSeconds: number;
      frontendOrigin: string;
      maxBarcodesPerSession?: number;
      maxPhotosPerSession?: number;
    },
  ) {}

  private async setSlidingExpiry(sessionId: string) {
    const ttl = this.opts.ttlSeconds;
    await Promise.all([
      this.redis.expire(metaKey(sessionId), ttl),
      this.redis.expire(barcodesKey(sessionId), ttl),
      this.redis.expire(photosKey(sessionId), ttl),
    ]).catch(() => {
      // Best-effort. If expire fails, the session still works; it just may not extend TTL.
    });
  }

  private async readMeta(sessionId: string): Promise<SessionMeta | null> {
    const raw = await this.redis.get(metaKey(sessionId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SessionMeta;
    } catch {
      throw new ApiError(500, "INTERNAL_ERROR", "Corrupt session metadata");
    }
  }

  private async writeMeta(meta: SessionMeta) {
    await this.redis.set(metaKey(meta.sessionId), JSON.stringify(meta), {
      EX: this.opts.ttlSeconds,
    });
  }

  async getMeta(sessionId: string): Promise<SessionMeta | null> {
    return this.readMeta(sessionId);
  }

  async validateToken(sessionId: string, token: string): Promise<"ok" | "expired" | "invalid"> {
    const meta = await this.readMeta(sessionId);
    if (!meta) return "expired";
    const tokenHashHex = sha256Hex(token);
    if (!safeEqualHex(meta.tokenHashHex, tokenHashHex)) return "invalid";
    return "ok";
  }

  async createSession(params: { tenantId: string; userId: string }): Promise<CreateSessionResult> {
    const sessionId = randomBytes(16).toString("hex");
    const token = randomBytes(32).toString("base64url");

    const nowMs = Date.now();
    const createdAt = new Date(nowMs).toISOString();
    const meta: SessionMeta = {
      sessionId,
      createdAt,
      lastActivity: createdAt,
      expiresAtMs: nowMs + this.opts.ttlSeconds * 1000,
      tenantId: params.tenantId,
      userId: params.userId,
      tokenHashHex: sha256Hex(token),
    };

    await this.writeMeta(meta);
    await this.setSlidingExpiry(sessionId);

    const origin = this.opts.frontendOrigin;
    const mobileBarcodeUrl = `${origin}/onboarding/scan/${encodeURIComponent(sessionId)}?token=${encodeURIComponent(token)}`;
    const mobilePhotoUrl = `${origin}/onboarding/photo/${encodeURIComponent(sessionId)}?token=${encodeURIComponent(token)}`;

    return { sessionId, token, mobileBarcodeUrl, mobilePhotoUrl };
  }

  async listBarcodes(sessionId: string): Promise<ScannedBarcode[]> {
    const raw = await this.redis.hGetAll(barcodesKey(sessionId));
    const entries: ScannedBarcode[] = [];
    for (const value of Object.values(raw)) {
      try {
        entries.push(JSON.parse(value) as ScannedBarcode);
      } catch {
        // Skip corrupt entries rather than failing the whole session.
      }
    }
    entries.sort((a, b) => {
      const aTime = Date.parse(a.scannedAt) || 0;
      const bTime = Date.parse(b.scannedAt) || 0;
      if (aTime !== bTime) return aTime - bTime;
      return a.id.localeCompare(b.id);
    });
    return entries;
  }

  async addBarcode(sessionId: string, barcode: ScannedBarcode): Promise<{ barcode: ScannedBarcode; duplicate: boolean }> {
    const max = this.opts.maxBarcodesPerSession ?? 500;
    const count = await this.redis.hLen(barcodesKey(sessionId));
    if (count >= max) {
      throw new ApiError(429, "VALIDATION_ERROR", "Session barcode limit reached");
    }

    const cleaned = barcode.barcode.trim();
    if (!cleaned) {
      throw new ApiError(422, "VALIDATION_ERROR", "barcode is required");
    }

    const existingRaw = await this.redis.hGet(barcodesKey(sessionId), cleaned);
    if (existingRaw) {
      try {
        const existing = JSON.parse(existingRaw) as ScannedBarcode;
        await this.setSlidingExpiry(sessionId);
        return { barcode: existing, duplicate: true };
      } catch {
        // Fall through to overwrite corrupt record.
      }
    }

    const saved: ScannedBarcode = {
      ...barcode,
      barcode: cleaned,
      id: barcode.id || `scan-${Date.now()}`,
      scannedAt: barcode.scannedAt || new Date().toISOString(),
      source: barcode.source === "desktop" ? "desktop" : "mobile",
    };

    await this.redis.hSet(barcodesKey(sessionId), cleaned, JSON.stringify(saved));

    const meta = await this.readMeta(sessionId);
    if (meta) {
      meta.lastActivity = new Date().toISOString();
      meta.expiresAtMs = Date.now() + this.opts.ttlSeconds * 1000;
      await this.writeMeta(meta);
    }
    await this.setSlidingExpiry(sessionId);

    return { barcode: saved, duplicate: false };
  }

  async updateBarcode(sessionId: string, barcodeId: string, patch: Partial<ScannedBarcode>): Promise<ScannedBarcode> {
    const all = await this.redis.hGetAll(barcodesKey(sessionId));
    const matchEntry = Object.entries(all).find(([, v]) => {
      try {
        const parsed = JSON.parse(v) as ScannedBarcode;
        return parsed.id === barcodeId;
      } catch {
        return false;
      }
    });

    if (!matchEntry) {
      throw new ApiError(404, "NOT_FOUND", "Barcode not found");
    }

    const [field, raw] = matchEntry;
    const existing = JSON.parse(raw) as ScannedBarcode;
    const next: ScannedBarcode = {
      ...existing,
      ...patch,
      id: existing.id,
      source: existing.source,
      scannedAt: existing.scannedAt,
      barcode: existing.barcode,
    };

    await this.redis.hSet(barcodesKey(sessionId), field, JSON.stringify(next));
    await this.setSlidingExpiry(sessionId);
    return next;
  }

  async listPhotos(sessionId: string): Promise<CapturedPhoto[]> {
    const raw = await this.redis.hGetAll(photosKey(sessionId));
    const entries: CapturedPhoto[] = [];
    for (const value of Object.values(raw)) {
      try {
        entries.push(JSON.parse(value) as CapturedPhoto);
      } catch {
        // Skip corrupt entries rather than failing the whole session.
      }
    }
    entries.sort((a, b) => {
      const aTime = Date.parse(a.capturedAt) || 0;
      const bTime = Date.parse(b.capturedAt) || 0;
      if (aTime !== bTime) return aTime - bTime;
      return a.id.localeCompare(b.id);
    });
    return entries;
  }

  async addPhoto(sessionId: string, photo: CapturedPhoto): Promise<CapturedPhoto> {
    const max = this.opts.maxPhotosPerSession ?? 100;
    const count = await this.redis.hLen(photosKey(sessionId));
    if (count >= max) {
      throw new ApiError(429, "VALIDATION_ERROR", "Session photo limit reached");
    }

    if (!photo.imageData || typeof photo.imageData !== "string") {
      throw new ApiError(422, "VALIDATION_ERROR", "photo.imageData is required");
    }

    const saved: CapturedPhoto = {
      ...photo,
      id: photo.id || `photo-${Date.now()}`,
      capturedAt: photo.capturedAt || new Date().toISOString(),
      source: photo.source === "desktop" ? "desktop" : "mobile",
      analyzed: Boolean(photo.analyzed),
    };

    await this.redis.hSet(photosKey(sessionId), saved.id, JSON.stringify(saved));

    const meta = await this.readMeta(sessionId);
    if (meta) {
      meta.lastActivity = new Date().toISOString();
      meta.expiresAtMs = Date.now() + this.opts.ttlSeconds * 1000;
      await this.writeMeta(meta);
    }
    await this.setSlidingExpiry(sessionId);

    return saved;
  }

  async getPhoto(sessionId: string, photoId: string): Promise<CapturedPhoto> {
    const raw = await this.redis.hGet(photosKey(sessionId), photoId);
    if (!raw) {
      throw new ApiError(404, "NOT_FOUND", "Photo not found");
    }
    try {
      return JSON.parse(raw) as CapturedPhoto;
    } catch {
      throw new ApiError(500, "INTERNAL_ERROR", "Corrupt photo record");
    }
  }

  async updatePhotoMetadata(sessionId: string, photoId: string, patch: Partial<CapturedPhoto>): Promise<CapturedPhoto> {
    const existing = await this.getPhoto(sessionId, photoId);
    const next: CapturedPhoto = {
      ...existing,
      ...patch,
      id: existing.id,
      source: existing.source,
      capturedAt: existing.capturedAt,
      imageData: existing.imageData,
    };
    await this.redis.hSet(photosKey(sessionId), photoId, JSON.stringify(next));
    await this.setSlidingExpiry(sessionId);
    return next;
  }
}
