import { describe, it, expect, beforeEach, vi } from "vitest";
import { OnboardingSessionStore } from "../lib/onboarding-session-store";

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

  async expire(key: string, seconds: number): Promise<number | boolean> {
    this.pruneKey(key);
    const expiresAtMs =
      seconds > 0 ? Date.now() + seconds * 1000 : undefined;

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

describe("OnboardingSessionStore", () => {
  let redis: FakeRedis;
  let store: OnboardingSessionStore;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-25T12:00:00.000Z"));
    redis = new FakeRedis();
    store = new OnboardingSessionStore(redis as any, {
      ttlSeconds: 60,
      frontendOrigin: "https://example.com",
    });
  });

  it("creates a session and validates token until TTL", async () => {
    const created = await store.createSession({
      tenantId: "t1",
      userId: "u1",
    });

    expect(created.sessionId).toMatch(/^[a-f0-9]{32}$/);
    expect(created.mobileBarcodeUrl).toContain(
      `/onboarding/scan/${created.sessionId}?token=`,
    );
    expect(created.mobilePhotoUrl).toContain(
      `/onboarding/photo/${created.sessionId}?token=`,
    );

    await expect(store.validateToken(created.sessionId, created.token)).resolves.toBe(
      "ok",
    );
    await expect(store.validateToken(created.sessionId, "wrong")).resolves.toBe(
      "invalid",
    );

    vi.advanceTimersByTime(61_000);
    await expect(store.validateToken(created.sessionId, created.token)).resolves.toBe(
      "expired",
    );
  });

  it("dedupes barcodes by cleaned barcode value", async () => {
    const created = await store.createSession({ tenantId: "t1", userId: "u1" });

    const first = await store.addBarcode(created.sessionId, {
      id: "b1",
      barcode: " 123456789012 ",
      barcodeType: "UPC-A",
      scannedAt: new Date().toISOString(),
      source: "mobile",
    });
    expect(first.duplicate).toBe(false);
    expect(first.barcode.barcode).toBe("123456789012");

    const second = await store.addBarcode(created.sessionId, {
      id: "b2",
      barcode: "123456789012",
      scannedAt: new Date().toISOString(),
      source: "desktop",
    });
    expect(second.duplicate).toBe(true);
    expect(second.barcode.id).toBe("b1");

    const list = await store.listBarcodes(created.sessionId);
    expect(list).toHaveLength(1);
    expect(list[0].barcode).toBe("123456789012");
  });

  it("stores photos by id and updates metadata without mutating immutable fields", async () => {
    const created = await store.createSession({ tenantId: "t1", userId: "u1" });

    const saved = await store.addPhoto(created.sessionId, {
      id: "p1",
      capturedAt: "2026-02-25T12:00:00.000Z",
      source: "mobile",
      imageData: "data:image/png;base64,AAAA",
      analyzed: false,
    });
    expect(saved.id).toBe("p1");

    const updated = await store.updatePhotoMetadata(created.sessionId, "p1", {
      suggestedName: "Widget",
      imageData: "should-be-ignored",
      source: "desktop",
    } as any);

    expect(updated.id).toBe("p1");
    expect(updated.source).toBe("mobile");
    expect(updated.imageData).toBe("data:image/png;base64,AAAA");
    expect(updated.suggestedName).toBe("Widget");
  });
});

