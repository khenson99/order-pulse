import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { exchangeCodeForTokens, refreshAccessToken } from "../lib/google-oauth";
import { ApiError } from "../types";

function mockFetchOnce(payload: unknown, ok = true, status = 200) {
  const json = vi.fn().mockResolvedValue(payload);
  const response = { ok, status, json } as any;
  (globalThis.fetch as any).mockResolvedValueOnce(response);
}

describe("google oauth helpers", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exchanges code for tokens", async () => {
    mockFetchOnce({ access_token: "acc", refresh_token: "ref", expires_in: 3600 });

    const result = await exchangeCodeForTokens({
      code: "code-1",
      clientId: "cid",
      clientSecret: "sec",
      redirectUri: "https://api.example.com/callback",
    });

    expect(result.accessToken).toBe("acc");
    expect(result.refreshToken).toBe("ref");
    expect(result.expiryDateMs).toBeTypeOf("number");
  });

  it("throws ApiError when token endpoint fails", async () => {
    mockFetchOnce({ error: "invalid_grant" }, false, 400);

    await expect(
      exchangeCodeForTokens({
        code: "bad",
        clientId: "cid",
        clientSecret: "sec",
        redirectUri: "https://api.example.com/callback",
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("refreshes access token", async () => {
    mockFetchOnce({ access_token: "acc2", expires_in: 1800 });

    const result = await refreshAccessToken({
      refreshToken: "ref",
      clientId: "cid",
      clientSecret: "sec",
    });

    expect(result.accessToken).toBe("acc2");
    expect(result.expiryDateMs).toBeTypeOf("number");
  });
});

