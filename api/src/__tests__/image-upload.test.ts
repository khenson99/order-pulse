import { describe, it, expect, vi } from "vitest";

vi.mock("@aws-sdk/s3-request-presigner", () => {
  return {
    getSignedUrl: vi.fn().mockResolvedValue("https://signed.example/upload"),
  };
});

import { S3Client } from "@aws-sdk/client-s3";
import { createImageUploadUrl } from "../lib/image-upload";
import { ApiError } from "../types";

describe("createImageUploadUrl", () => {
  it("returns a presigned uploadUrl and deterministic key parts", async () => {
    const s3 = new S3Client({ region: "us-east-1" });
    const result = await createImageUploadUrl({
      s3,
      bucket: "bucket-1",
      prefix: "onboarding",
      expiresInSeconds: 900,
      tenantId: "tenant-a",
      userId: "user-b",
      fileName: "photo.png",
      contentType: "image/png",
    });

    expect(result.uploadUrl).toBe("https://signed.example/upload");
    expect(result.expiresInSeconds).toBe(900);
    expect(result.s3Key).toMatch(
      /^onboarding\/tenant-a\/user-b\/[0-9a-f-]{36}\.png$/,
    );
  });

  it("rejects invalid contentType with VALIDATION_ERROR", async () => {
    const s3 = new S3Client({ region: "us-east-1" });
    await expect(
      createImageUploadUrl({
        s3,
        bucket: "bucket-1",
        prefix: "onboarding",
        expiresInSeconds: 900,
        tenantId: "tenant-a",
        userId: "user-b",
        fileName: "photo.gif",
        contentType: "image/gif",
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "ApiError",
        code: "VALIDATION_ERROR",
        statusCode: 422,
      } satisfies Partial<ApiError>),
    );
  });
});

