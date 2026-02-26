import { describe, expect, it } from "vitest";
import { GmailOAuthStore, type KeyValueStore } from "../lib/gmail-oauth-store";

class MemoryKv implements KeyValueStore {
  private store = new Map<string, string>();

  async get(key: string) {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string) {
    this.store.set(key, value);
    return "OK";
  }

  async del(key: string) {
    const existed = this.store.delete(key);
    return existed ? 1 : 0;
  }
}

describe("GmailOAuthStore", () => {
  it("creates and consumes OAuth state", async () => {
    const kv = new MemoryKv();
    const store = new GmailOAuthStore(kv, Buffer.alloc(32, 1));

    const { stateId, state } = await store.createOauthState({
      tenantId: "t1",
      userId: "u1",
      returnTo: "/onboarding/email",
      ttlSeconds: 120,
    });

    expect(stateId).toMatch(/^[a-f0-9]{32}$/);
    expect(state.tenantId).toBe("t1");
    expect(state.userId).toBe("u1");
    expect(state.returnTo).toBe("/onboarding/email");

    const consumed = await store.consumeOauthState(stateId);
    expect(consumed?.tenantId).toBe("t1");

    const consumedAgain = await store.consumeOauthState(stateId);
    expect(consumedAgain).toBeNull();
  });

  it("stores and loads encrypted tokens", async () => {
    const kv = new MemoryKv();
    const store = new GmailOAuthStore(kv, Buffer.alloc(32, 2));

    await store.setTokens({
      tenantId: "t1",
      userId: "u1",
      refreshToken: "refresh-123",
      accessToken: "access-abc",
      expiryDateMs: 123456789,
    });

    const tokens = await store.getTokens({ tenantId: "t1", userId: "u1" });
    expect(tokens).toBeTruthy();
    expect(tokens?.refreshToken).toBe("refresh-123");
    expect(tokens?.accessToken).toBe("access-abc");
    expect(tokens?.expiryDateMs).toBe(123456789);
    expect(tokens?.updatedAt).toMatch(/T/);
  });
});

