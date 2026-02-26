import { randomBytes } from "node:crypto";
import { ApiError } from "../types";
import { decryptJsonAes256Gcm, encryptJsonAes256Gcm } from "./aes-256-gcm";

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<string | null>;
  del(key: string): Promise<number>;
}

export interface GmailOAuthTokens {
  refreshToken: string;
  accessToken: string | null;
  expiryDateMs: number | null;
  updatedAt: string;
}

export interface GmailOAuthState {
  tenantId: string;
  userId: string;
  returnTo: string | null;
  createdAt: string;
}

function tokensKey(tenantId: string, userId: string) {
  return `onboarding:gmail:tokens:${tenantId}:${userId}`;
}

function stateKey(stateId: string) {
  return `onboarding:gmail:oauth_state:${stateId}`;
}

function safeReturnTo(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith("/")) return null;
  if (trimmed.startsWith("//")) return null;
  if (trimmed.includes("://")) return null;
  // Keep it reasonably bounded; it ends up in a redirect.
  return trimmed.slice(0, 500);
}

export class GmailOAuthStore {
  constructor(
    private readonly kv: KeyValueStore,
    private readonly encryptionKey: Buffer | null,
  ) {}

  async createOauthState(params: {
    tenantId: string;
    userId: string;
    returnTo?: unknown;
    ttlSeconds?: number;
  }): Promise<{ stateId: string; state: GmailOAuthState }> {
    const stateId = randomBytes(16).toString("hex");
    const ttlSeconds = Math.max(60, Math.min(params.ttlSeconds ?? 10 * 60, 60 * 60));

    const state: GmailOAuthState = {
      tenantId: params.tenantId,
      userId: params.userId,
      returnTo: safeReturnTo(params.returnTo),
      createdAt: new Date().toISOString(),
    };

    await this.kv.set(stateKey(stateId), JSON.stringify(state), { EX: ttlSeconds });
    return { stateId, state };
  }

  async consumeOauthState(stateId: string): Promise<GmailOAuthState | null> {
    const raw = await this.kv.get(stateKey(stateId));
    if (!raw) return null;
    await this.kv.del(stateKey(stateId));
    try {
      return JSON.parse(raw) as GmailOAuthState;
    } catch {
      throw new ApiError(500, "INTERNAL_ERROR", "Corrupt OAuth state");
    }
  }

  async getTokens(params: { tenantId: string; userId: string }): Promise<GmailOAuthTokens | null> {
    const raw = await this.kv.get(tokensKey(params.tenantId, params.userId));
    if (!raw) return null;

    let stored: { encrypted: string; updatedAt: string };
    try {
      stored = JSON.parse(raw) as { encrypted: string; updatedAt: string };
    } catch {
      throw new ApiError(500, "INTERNAL_ERROR", "Corrupt token record");
    }

    if (!this.encryptionKey) {
      throw new ApiError(503, "INTERNAL_ERROR", "Token encryption is not configured");
    }

    const decrypted = decryptJsonAes256Gcm<{
      refreshToken: string;
      accessToken?: string | null;
      expiryDateMs?: number | null;
    }>({
      key: this.encryptionKey,
      encrypted: stored.encrypted,
    });

    if (!decrypted?.refreshToken || typeof decrypted.refreshToken !== "string") {
      throw new ApiError(500, "INTERNAL_ERROR", "Token record missing refresh token");
    }

    return {
      refreshToken: decrypted.refreshToken,
      accessToken: decrypted.accessToken ?? null,
      expiryDateMs: decrypted.expiryDateMs ?? null,
      updatedAt: stored.updatedAt,
    };
  }

  async setTokens(params: {
    tenantId: string;
    userId: string;
    refreshToken: string;
    accessToken?: string | null;
    expiryDateMs?: number | null;
  }): Promise<void> {
    if (!this.encryptionKey) {
      throw new ApiError(503, "INTERNAL_ERROR", "Token encryption is not configured");
    }

    const encrypted = encryptJsonAes256Gcm({
      key: this.encryptionKey,
      plaintext: {
        refreshToken: params.refreshToken,
        accessToken: params.accessToken ?? null,
        expiryDateMs: params.expiryDateMs ?? null,
      },
    });

    const record = {
      encrypted,
      updatedAt: new Date().toISOString(),
    };

    await this.kv.set(tokensKey(params.tenantId, params.userId), JSON.stringify(record));
  }
}

