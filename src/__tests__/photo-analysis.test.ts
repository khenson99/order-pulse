import { describe, it, expect } from "vitest";
import { ApiError } from "../types";
import { analyzePhoto, extractFirstJsonObject, parseImageDataUrl } from "../lib/photo-analysis";

const TINY_PNG_DATA_URL = "data:image/png;base64,YQ==";

describe("photo analysis helpers", () => {
  it("validates image data URLs", () => {
    expect(() => parseImageDataUrl("not-a-data-url")).toThrow(ApiError);
    expect(() => parseImageDataUrl("data:image/gif;base64,YQ==")).toThrow(ApiError);
    expect(() => parseImageDataUrl(TINY_PNG_DATA_URL)).not.toThrow();
  });

  it("extracts JSON objects from fenced output", () => {
    const json = extractFirstJsonObject("```json\n{\"a\":1}\n```");
    expect(json).toEqual({ a: 1 });
  });
});

describe("analyzePhoto", () => {
  it("throws 503 when GEMINI_API_KEY is missing", async () => {
    await expect(
      analyzePhoto({
        imageData: TINY_PNG_DATA_URL,
        geminiApiKey: null,
        minIntervalMs: 0,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "ApiError",
        statusCode: 503,
        code: "INTERNAL_ERROR",
      } satisfies Partial<ApiError>),
    );
  });

  it("sanitizes model output to stable fields", async () => {
    const analysis = await analyzePhoto({
      imageData: TINY_PNG_DATA_URL,
      geminiApiKey: "test-key",
      minIntervalMs: 0,
      generateTextFn: async () =>
        "```json\n{\n  \"suggestedName\": \"  Foo\\nBar  \",\n  \"suggestedSupplier\": 123,\n  \"confidence\": \"0.7\",\n  \"notes\": \"ok\",\n  \"extra\": true\n}\n```",
    });

    expect(analysis).toEqual({
      suggestedName: "Foo Bar",
      suggestedSupplier: null,
      confidence: 0.7,
      notes: "ok",
    });
  });

  it("rate-limits repeated calls when configured", async () => {
    const generateTextFn = async () => "{\"suggestedName\":null,\"suggestedSupplier\":null,\"confidence\":0,\"notes\":null}";

    await analyzePhoto({
      imageData: TINY_PNG_DATA_URL,
      geminiApiKey: "k",
      now: () => 1000,
      minIntervalMs: 1000,
      generateTextFn,
    });

    await expect(
      analyzePhoto({
        imageData: TINY_PNG_DATA_URL,
        geminiApiKey: "k",
        now: () => 1500,
        minIntervalMs: 1000,
        generateTextFn,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "ApiError",
        statusCode: 429,
        code: "VALIDATION_ERROR",
      } satisfies Partial<ApiError>),
    );
  });
});
