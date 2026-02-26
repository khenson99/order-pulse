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

