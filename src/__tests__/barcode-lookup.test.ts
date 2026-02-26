import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { lookupProductByBarcode } from "../lib/barcode-lookup";
import type { KeyValueStore } from "../lib/gmail-oauth-store";

class MemoryKv implements KeyValueStore {
  private store = new Map<string, string>();

  async get(key: string) {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string, _options?: { EX?: number }) {
    this.store.set(key, value);
    return "OK";
  }

  async del(key: string) {
    const existed = this.store.delete(key);
    return existed ? 1 : 0;
  }

  keys() {
    return [...this.store.keys()];
  }
}

function mockFetchOnce(params: { ok: boolean; status: number; json: unknown }) {
  (globalThis.fetch as any).mockResolvedValueOnce({
    ok: params.ok,
    status: params.status,
    json: vi.fn().mockResolvedValue(params.json),
  });
}

describe("barcode lookup", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    delete process.env.BARCODE_LOOKUP_API_KEY;
    delete process.env.UPCITEMDB_USER_KEY;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("caches found products", async () => {
    const kv = new MemoryKv();

    // OpenFoodFacts hit: found
    mockFetchOnce({
      ok: true,
      status: 200,
      json: {
        status: 1,
        product: {
          product_name: "Test Product",
          brands: "BrandCo",
          image_url: "https://example.com/a.jpg",
          categories: "Cat1, Cat2",
        },
      },
    });

    const first = await lookupProductByBarcode("012345678905", { kv, timeoutMs: 5000 });
    expect(first?.name).toBe("Test Product");
    expect((globalThis.fetch as any).mock.calls.length).toBeGreaterThan(0);

    (globalThis.fetch as any).mockClear();
    const second = await lookupProductByBarcode("012345678905", { kv, timeoutMs: 5000 });
    expect(second?.name).toBe("Test Product");
    expect((globalThis.fetch as any).mock.calls.length).toBe(0);
  });

  it("does not cache notFound when a provider errors", async () => {
    const kv = new MemoryKv();

    // OpenFoodFacts error
    mockFetchOnce({ ok: false, status: 500, json: {} });
    // UPCitemdb not found
    mockFetchOnce({ ok: false, status: 404, json: {} });

    const result = await lookupProductByBarcode("012345678905", { kv, timeoutMs: 5000 });
    expect(result).toBeNull();
    expect(kv.keys().filter((k) => k.startsWith("barcode:lookup:"))).toHaveLength(0);
  });
});
