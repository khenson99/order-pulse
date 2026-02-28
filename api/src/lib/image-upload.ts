import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { ApiError } from "../types";

const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function extForContentType(contentType: string): string {
  switch (contentType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return "bin";
  }
}

function normalizePrefix(prefix: string): string {
  const trimmed = prefix.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return trimmed.length > 0 ? trimmed : "onboarding";
}

function encodeS3KeyForUrl(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

function publicUrlForObject(params: {
  bucket: string;
  region: string;
  s3Key: string;
  publicBaseUrl?: string | null;
}): string {
  const encodedKey = encodeS3KeyForUrl(params.s3Key);

  if (params.publicBaseUrl && params.publicBaseUrl.trim().length > 0) {
    const base = params.publicBaseUrl.replace(/\/+$/, "");
    return `${base}/${encodedKey}`;
  }

  // Note: This assumes the object is publicly readable (or served via CloudFront with a public base URL).
  if (params.region === "us-east-1") {
    return `https://${params.bucket}.s3.amazonaws.com/${encodedKey}`;
  }
  return `https://${params.bucket}.s3.${params.region}.amazonaws.com/${encodedKey}`;
}

function parseBase64DataUrl(imageData: string): {
  contentType: string;
  base64: string;
} {
  const trimmed = imageData.trim();
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(trimmed);
  if (!match) {
    throw new ApiError(422, "VALIDATION_ERROR", "imageData must be a base64 data URL");
  }
  const contentType = match[1] ?? "";
  const base64 = match[2] ?? "";
  return { contentType, base64 };
}

export interface CreateImageUploadUrlParams {
  s3: S3Client;
  bucket: string;
  prefix: string;
  expiresInSeconds: number;
  tenantId: string;
  userId: string;
  fileName: string;
  contentType: string;
}

export interface ImageUploadUrlResult {
  uploadUrl: string;
  s3Key: string;
  expiresInSeconds: number;
}

export async function createImageUploadUrl(
  params: CreateImageUploadUrlParams,
): Promise<ImageUploadUrlResult> {
  const fileName = params.fileName.trim();
  if (!fileName) {
    throw new ApiError(422, "VALIDATION_ERROR", "fileName is required");
  }
  if (fileName.length > 250) {
    throw new ApiError(422, "VALIDATION_ERROR", "fileName is too long");
  }

  if (!ALLOWED_CONTENT_TYPES.has(params.contentType)) {
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "contentType must be one of: image/jpeg, image/png, image/webp",
    );
  }

  if (!params.bucket || params.bucket.trim().length === 0) {
    throw new ApiError(500, "INTERNAL_ERROR", "Image upload bucket is not configured");
  }

  const expiresInSeconds = Math.max(1, Math.min(params.expiresInSeconds, 3600));
  const prefix = normalizePrefix(params.prefix);
  const ext = extForContentType(params.contentType);

  const s3Key = `${prefix}/${params.tenantId}/${params.userId}/${randomUUID()}.${ext}`;

  const cmd = new PutObjectCommand({
    Bucket: params.bucket,
    Key: s3Key,
    ContentType: params.contentType,
    Metadata: {
      tenant: params.tenantId,
      user: params.userId,
      filename: fileName.slice(0, 200),
    },
  });

  const uploadUrl = await getSignedUrl(params.s3 as any, cmd, {
    expiresIn: expiresInSeconds,
  });

  return { uploadUrl, s3Key, expiresInSeconds };
}

export interface S3Like {
  send: (command: PutObjectCommand) => Promise<unknown>;
}

export interface UploadImageDataUrlParams {
  s3: S3Like;
  bucket: string;
  prefix: string;
  maxBytes: number;
  region: string;
  publicBaseUrl?: string | null;
  tenantId: string;
  userId: string;
  imageData: string;
}

export interface UploadImageDataUrlResult {
  imageUrl: string;
  s3Key: string;
  contentType: string;
  bytes: number;
}

export async function uploadImageDataUrl(
  params: UploadImageDataUrlParams,
): Promise<UploadImageDataUrlResult> {
  if (!params.bucket || params.bucket.trim().length === 0) {
    throw new ApiError(500, "INTERNAL_ERROR", "Image upload bucket is not configured");
  }

  const maxBytes = params.maxBytes;
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new ApiError(500, "INTERNAL_ERROR", "Invalid ONBOARDING_IMAGE_MAX_BYTES");
  }

  const { contentType, base64 } = parseBase64DataUrl(params.imageData);
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "imageData contentType must be one of: image/jpeg, image/png, image/webp",
    );
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(base64, "base64");
  } catch {
    throw new ApiError(422, "VALIDATION_ERROR", "imageData base64 is invalid");
  }

  if (bytes.length === 0) {
    throw new ApiError(422, "VALIDATION_ERROR", "imageData is empty");
  }
  if (bytes.length > maxBytes) {
    throw new ApiError(413, "VALIDATION_ERROR", `Image too large (max ${maxBytes} bytes)`);
  }

  const prefix = normalizePrefix(params.prefix);
  const ext = extForContentType(contentType);
  const s3Key = `${prefix}/${params.tenantId}/${params.userId}/${randomUUID()}.${ext}`;

  const cmd = new PutObjectCommand({
    Bucket: params.bucket,
    Key: s3Key,
    Body: bytes,
    ContentType: contentType,
    Metadata: {
      tenant: params.tenantId,
      user: params.userId,
    },
  });

  try {
    await params.s3.send(cmd);
  } catch {
    throw new ApiError(502, "INTERNAL_ERROR", "Image upload failed. Please try again.");
  }

  const imageUrl = publicUrlForObject({
    bucket: params.bucket,
    region: params.region,
    s3Key,
    publicBaseUrl: params.publicBaseUrl,
  });

  return { imageUrl, s3Key, contentType, bytes: bytes.length };
}
