import { describe, expect, it } from "vitest";
import { ApiError } from "../types";
import { decryptJsonAes256Gcm, encryptJsonAes256Gcm } from "../lib/aes-256-gcm";

describe("aes-256-gcm helpers", () => {
  it("round-trips JSON payloads", () => {
    const key = Buffer.alloc(32, 7);
    const encrypted = encryptJsonAes256Gcm({
      key,
      plaintext: { hello: "world", n: 123, ok: true },
    });

    const decrypted = decryptJsonAes256Gcm<{ hello: string; n: number; ok: boolean }>({
      key,
      encrypted,
    });

    expect(decrypted).toEqual({ hello: "world", n: 123, ok: true });
  });

  it("fails to decrypt when payload is tampered", () => {
    const key = Buffer.alloc(32, 9);
    const encrypted = encryptJsonAes256Gcm({
      key,
      plaintext: { token: "secret" },
    });

    const parsed = JSON.parse(encrypted) as Record<string, string>;
    // Flip one byte in ciphertext (base64 string change).
    const last = parsed.ciphertextB64.slice(-1);
    parsed.ciphertextB64 =
      parsed.ciphertextB64.slice(0, -1) + (last === "A" ? "B" : "A");
    const tampered = JSON.stringify(parsed);

    expect(() => decryptJsonAes256Gcm({ key, encrypted: tampered })).toThrow(ApiError);
  });
});
