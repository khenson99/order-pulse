import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { OnboardingSessionStore } from "../lib/onboarding-session-store";
import type { Config } from "../config";
import type { KeyValueStore } from "../lib/gmail-oauth-store";

class FakeRedis {
  private strings = new Map<string, { value: string; expiresAtMs?: number }>();
  private hashes = new Map<
    string,
    { fields: Map<string, string>; expiresAtMs?: number }
  >();

  private isExpired(expiresAtMs?: number) {
    return typeof expiresAtMs === "number" && Date.now() >= expiresAtMs;
  }

  private pruneKey(key: string) {
    const s = this.strings.get(key);
    if (s && this.isExpired(s.expiresAtMs)) this.strings.delete(key);
    const h = this.hashes.get(key);
    if (h && this.isExpired(h.expiresAtMs)) this.hashes.delete(key);
  }

  async get(key: string): Promise<string | null> {
    this.pruneKey(key);
    return this.strings.get(key)?.value ?? null;
  }

  async set(
    key: string,
    value: string,
    options?: { EX?: number },
  ): Promise<string | null> {
    const expiresAtMs =
      options?.EX && options.EX > 0 ? Date.now() + options.EX * 1000 : undefined;
    this.strings.set(key, { value, expiresAtMs });
    return "OK";
  }

  async del(key: string): Promise<number> {
    const hadString = this.strings.delete(key);
    const hadHash = this.hashes.delete(key);
    return Number(hadString || hadHash);
  }

  async expire(key: string, seconds: number): Promise<number | boolean> {
    this.pruneKey(key);
    const expiresAtMs = seconds > 0 ? Date.now() + seconds * 1000 : undefined;

    const s = this.strings.get(key);
    if (s) {
      s.expiresAtMs = expiresAtMs;
      return 1;
    }
    const h = this.hashes.get(key);
    if (h) {
      h.expiresAtMs = expiresAtMs;
      return 1;
    }
    return 0;
  }

  async hGetAll(key: string): Promise<Record<string, string>> {
    this.pruneKey(key);
    const h = this.hashes.get(key);
    if (!h) return {};
    const out: Record<string, string> = {};
    for (const [field, value] of h.fields.entries()) out[field] = value;
    return out;
  }

  async hGet(key: string, field: string): Promise<string | null> {
    this.pruneKey(key);
    const h = this.hashes.get(key);
    return h?.fields.get(field) ?? null;
  }

  async hSet(key: string, field: string, value: string): Promise<number> {
    this.pruneKey(key);
    const h = this.hashes.get(key) ?? { fields: new Map<string, string>() };
    const existed = h.fields.has(field);
    h.fields.set(field, value);
    this.hashes.set(key, h);
    return existed ? 0 : 1;
  }

  async hLen(key: string): Promise<number> {
    this.pruneKey(key);
    return this.hashes.get(key)?.fields.size ?? 0;
  }
}

class FakeKv implements KeyValueStore {
  private map = new Map<string, { value: string; expiresAtMs?: number }>();

  private isExpired(expiresAtMs?: number) {
    return typeof expiresAtMs === "number" && Date.now() >= expiresAtMs;
  }

  async get(key: string): Promise<string | null> {
    const hit = this.map.get(key);
    if (!hit) return null;
    if (this.isExpired(hit.expiresAtMs)) {
      this.map.delete(key);
      return null;
    }
    return hit.value;
  }

  async set(
    key: string,
    value: string,
    options?: { EX?: number },
  ): Promise<string | null> {
    const expiresAtMs =
      options?.EX && options.EX > 0 ? Date.now() + options.EX * 1000 : undefined;
    this.map.set(key, { value, expiresAtMs });
    return "OK";
  }

  async del(key: string): Promise<number> {
    return Number(this.map.delete(key));
  }
}

function tokenFromMobileUrl(url: string): string {
  const parsed = new URL(url);
  const token = parsed.searchParams.get("token");
  if (!token) throw new Error("missing token");
  return token;
}

function makeConfig(): Config {
  return {
    cognitoUserPoolId: "us-east-1_TEST",
    cognitoClientId: "client",
    awsRegion: "us-east-1",
    redisUrl: "redis://localhost:6379/0",
    onboardingApiOrigin: "https://api.example.com",
    onboardingFrontendOrigin: "https://example.com",
    onboardingSessionTtlSeconds: 60,
    onboardingTokenEncryptionKey: null,
    googleClientId: null,
    googleClientSecret: null,
    geminiApiKey: null,
    onboardingImageUploadBucket: "bucket",
    onboardingImageUploadPrefix: "onboarding",
    onboardingImageUploadUrlExpiresInSeconds: 900,
    onboardingImageMaxBytes: 5242880,
    onboardingImagePublicBaseUrl: null,
    port: 3002,
    logLevel: "silent",
    nodeEnv: "test",
  };
}

describe("onboarding routes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-25T12:00:00.000Z"));
  });

  it("supports mobile token flow for barcode session writes/reads", async () => {
    const redis = new FakeRedis();
    const config = makeConfig();
    const store = new OnboardingSessionStore(redis as any, {
      ttlSeconds: 60,
      frontendOrigin: config.onboardingFrontendOrigin,
    });

    const accessTokenVerifier = { verify: vi.fn().mockResolvedValue({ sub: "u1", token_use: "access" }) };
    const idTokenVerifier = {
      verify: vi.fn().mockResolvedValue({ sub: "u1", email: "u1@example.com", "custom:tenant": "t1" }),
    };

    const app = createApp({
      auth: { accessTokenVerifier, idTokenVerifier, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
      config,
      kv: new FakeKv(),
      sessionStore: store,
      s3: {} as any,
    });

    const sessionRes = await request(app)
      .post("/api/onboarding/sessions")
      .set("Authorization", "Bearer test-access")
      .set("X-ID-Token", "test-id")
      .send({});

    expect(sessionRes.status).toBe(200);
    expect(sessionRes.body.sessionId).toMatch(/^[a-f0-9]{32}$/);
    expect(sessionRes.body.mobileBarcodeUrl).toContain(`/onboarding/scan/${sessionRes.body.sessionId}?token=`);

    const token = tokenFromMobileUrl(sessionRes.body.mobileBarcodeUrl);
    const sessionId = sessionRes.body.sessionId as string;

    const addRes = await request(app)
      .post(`/api/onboarding/scan-sessions/${encodeURIComponent(sessionId)}/barcodes?token=${encodeURIComponent(token)}`)
      .send({
        barcode: {
          id: "b1",
          barcode: "123456789012",
          barcodeType: "UPC-A",
          scannedAt: new Date().toISOString(),
          source: "mobile",
        },
      });

    expect(addRes.status).toBe(200);
    expect(addRes.body).toMatchObject({
      success: true,
      barcode: { barcode: "123456789012" },
    });

    const listRes = await request(app)
      .get(`/api/onboarding/scan-sessions/${encodeURIComponent(sessionId)}/barcodes?token=${encodeURIComponent(token)}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.totalCount).toBe(1);
    expect(listRes.body.barcodes).toHaveLength(1);
  });

  it("returns stable error shape for invalid mobile token", async () => {
    const redis = new FakeRedis();
    const config = makeConfig();
    const store = new OnboardingSessionStore(redis as any, {
      ttlSeconds: 60,
      frontendOrigin: config.onboardingFrontendOrigin,
    });

    const accessTokenVerifier = { verify: vi.fn().mockResolvedValue({ sub: "u1", token_use: "access" }) };
    const idTokenVerifier = {
      verify: vi.fn().mockResolvedValue({ sub: "u1", email: "u1@example.com", "custom:tenant": "t1" }),
    };

    const app = createApp({
      auth: { accessTokenVerifier, idTokenVerifier, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
      config,
      kv: new FakeKv(),
      sessionStore: store,
      s3: {} as any,
    });

    const sessionRes = await request(app)
      .post("/api/onboarding/sessions")
      .set("Authorization", "Bearer test-access")
      .set("X-ID-Token", "test-id")
      .send({});

    const sessionId = sessionRes.body.sessionId as string;
    const res = await request(app)
      .get(`/api/onboarding/scan-sessions/${encodeURIComponent(sessionId)}/barcodes?token=bad-token`);

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      error: { code: "INVALID_SESSION_TOKEN", message: expect.any(String), requestId: expect.any(String) },
    });
  });

  it("returns stable error shape for expired mobile token", async () => {
    const redis = new FakeRedis();
    const config = makeConfig();
    const store = new OnboardingSessionStore(redis as any, {
      ttlSeconds: 1,
      frontendOrigin: config.onboardingFrontendOrigin,
    });

    const accessTokenVerifier = { verify: vi.fn().mockResolvedValue({ sub: "u1", token_use: "access" }) };
    const idTokenVerifier = {
      verify: vi.fn().mockResolvedValue({ sub: "u1", email: "u1@example.com", "custom:tenant": "t1" }),
    };

    const app = createApp({
      auth: { accessTokenVerifier, idTokenVerifier, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
      config,
      kv: new FakeKv(),
      sessionStore: store,
      s3: {} as any,
    });

    const sessionRes = await request(app)
      .post("/api/onboarding/sessions")
      .set("Authorization", "Bearer test-access")
      .set("X-ID-Token", "test-id")
      .send({});

    const token = tokenFromMobileUrl(sessionRes.body.mobileBarcodeUrl);
    const sessionId = sessionRes.body.sessionId as string;

    vi.advanceTimersByTime(2000);

    const res = await request(app)
      .get(`/api/onboarding/scan-sessions/${encodeURIComponent(sessionId)}/barcodes?token=${encodeURIComponent(token)}`);

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      error: { code: "SESSION_EXPIRED", message: expect.any(String), requestId: expect.any(String) },
    });
  });

  it("uploads images server-side with stable success response", async () => {
    const redis = new FakeRedis();
    const config = makeConfig();
    const store = new OnboardingSessionStore(redis as any, {
      ttlSeconds: 60,
      frontendOrigin: config.onboardingFrontendOrigin,
    });

    const accessTokenVerifier = { verify: vi.fn().mockResolvedValue({ sub: "u1", token_use: "access" }) };
    const idTokenVerifier = {
      verify: vi.fn().mockResolvedValue({ sub: "u1", email: "u1@example.com", "custom:tenant": "t1" }),
    };

    const s3 = { send: vi.fn().mockResolvedValue({}) };
    const app = createApp({
      auth: { accessTokenVerifier, idTokenVerifier, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
      config,
      kv: new FakeKv(),
      sessionStore: store,
      s3: s3 as any,
    });

    const imageData = `data:image/png;base64,${Buffer.from("hello").toString("base64")}`;
    const res = await request(app)
      .post("/api/onboarding/images/upload")
      .set("Authorization", "Bearer test-access")
      .set("X-ID-Token", "test-id")
      .send({ imageData });

    expect(res.status).toBe(200);
    expect(res.body.imageUrl).toMatch(
      /^https:\/\/bucket\.s3\.amazonaws\.com\/onboarding\/t1\/u1\/[0-9a-f-]{36}\.png$/,
    );
    expect(s3.send).toHaveBeenCalledTimes(1);
  });
});
