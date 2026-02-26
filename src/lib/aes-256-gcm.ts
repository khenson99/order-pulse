import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ApiError } from "../types";

type EncryptedPayloadV1 = {
  v: 1;
  alg: "aes-256-gcm";
  ivB64: string;
  tagB64: string;
  ciphertextB64: string;
};

export function encryptJsonAes256Gcm(params: {
  key: Buffer;
  plaintext: unknown;
}): string {
  if (params.key.length !== 32) {
    throw new ApiError(500, "INTERNAL_ERROR", "Invalid encryption key length");
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", params.key, iv);

  const cleartext = Buffer.from(JSON.stringify(params.plaintext), "utf8");
  const ciphertext = Buffer.concat([cipher.update(cleartext), cipher.final()]);
  const tag = cipher.getAuthTag();

  const payload: EncryptedPayloadV1 = {
    v: 1,
    alg: "aes-256-gcm",
    ivB64: iv.toString("base64"),
    tagB64: tag.toString("base64"),
    ciphertextB64: ciphertext.toString("base64"),
  };

  return JSON.stringify(payload);
}

export function decryptJsonAes256Gcm<T>(params: {
  key: Buffer;
  encrypted: string;
}): T {
  if (params.key.length !== 32) {
    throw new ApiError(500, "INTERNAL_ERROR", "Invalid encryption key length");
  }

  let parsed: EncryptedPayloadV1;
  try {
    parsed = JSON.parse(params.encrypted) as EncryptedPayloadV1;
  } catch {
    throw new ApiError(500, "INTERNAL_ERROR", "Corrupt encrypted payload");
  }

  if (parsed?.v !== 1 || parsed?.alg !== "aes-256-gcm") {
    throw new ApiError(500, "INTERNAL_ERROR", "Unsupported encrypted payload version");
  }

  try {
    const iv = Buffer.from(parsed.ivB64, "base64");
    const tag = Buffer.from(parsed.tagB64, "base64");
    const ciphertext = Buffer.from(parsed.ciphertextB64, "base64");

    const decipher = createDecipheriv("aes-256-gcm", params.key, iv);
    decipher.setAuthTag(tag);
    const clear = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    return JSON.parse(clear.toString("utf8")) as T;
  } catch {
    throw new ApiError(500, "INTERNAL_ERROR", "Failed to decrypt payload");
  }
}

