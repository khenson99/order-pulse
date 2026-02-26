import { ApiError } from "../types";

export type PhotoAnalysisResult = {
  suggestedName: string | null;
  suggestedSupplier: string | null;
  confidence: number;
  notes: string | null;
};

type GeminiGenerateTextFn = (params: {
  prompt: string;
  base64Data: string;
  mimeType: string;
}) => Promise<string>;

const DEFAULT_MODEL = "gemini-1.5-flash";
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

let lastGeminiCallAtMs = 0;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function sanitizeText(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen - 1)}…` : trimmed;
}

export function parseImageDataUrl(imageData: string): {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  base64Data: string;
} {
  const trimmed = imageData.trim();
  const match = /^data:([^;]+);base64,([a-zA-Z0-9+/=]+)$/.exec(trimmed);
  if (!match) {
    throw new ApiError(422, "VALIDATION_ERROR", "imageData must be a base64 data URL");
  }

  const mimeType = match[1] ?? "";
  if (mimeType !== "image/jpeg" && mimeType !== "image/png" && mimeType !== "image/webp") {
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "imageData must be one of: image/jpeg, image/png, image/webp",
    );
  }

  const base64Data = match[2] ?? "";
  let buf: Buffer;
  try {
    buf = Buffer.from(base64Data, "base64");
  } catch {
    throw new ApiError(422, "VALIDATION_ERROR", "imageData base64 is invalid");
  }

  if (buf.length <= 0) {
    throw new ApiError(422, "VALIDATION_ERROR", "imageData base64 is invalid");
  }

  if (buf.length > MAX_IMAGE_BYTES) {
    throw new ApiError(422, "VALIDATION_ERROR", "imageData is too large");
  }

  return { mimeType, base64Data };
}

export function extractFirstJsonObject(text: string): unknown {
  const candidate = text.trim();
  if (!candidate) return null;

  const fenced = /```json\s*([\s\S]*?)```/i.exec(candidate);
  const source = fenced?.[1]?.trim() ?? candidate;

  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  const jsonText = source.slice(start, end + 1);
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

function promptForPhotoAnalysis(): string {
  return [
    "You are helping a business user capture a supplier item from a photo.",
    "Return ONLY a single JSON object with this exact schema:",
    "{",
    '  "suggestedName": string | null,',
    '  "suggestedSupplier": string | null,',
    '  "confidence": number,',
    '  "notes": string | null',
    "}",
    "",
    "Rules:",
    "- If you are unsure, use null for strings and set confidence low.",
    "- confidence must be between 0 and 1.",
    "- Do not include extra keys.",
  ].join("\n");
}

async function defaultGeminiGenerateText(params: {
  apiKey: string;
  model?: string;
  prompt: string;
  base64Data: string;
  mimeType: string;
}): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { GoogleGenerativeAI } = require("@google/generative-ai") as typeof import("@google/generative-ai");

  const genAi = new GoogleGenerativeAI(params.apiKey);
  const model = genAi.getGenerativeModel({ model: params.model ?? DEFAULT_MODEL });

  const result = await model.generateContent([
    params.prompt,
    {
      inlineData: {
        data: params.base64Data,
        mimeType: params.mimeType,
      },
    },
  ]);

  return result.response.text();
}

export async function analyzePhoto(params: {
  imageData: string;
  geminiApiKey: string | null;
  model?: string;
  minIntervalMs?: number;
  now?: () => number;
  generateTextFn?: GeminiGenerateTextFn;
}): Promise<PhotoAnalysisResult> {
  if (!params.geminiApiKey && !params.generateTextFn) {
    throw new ApiError(503, "INTERNAL_ERROR", "Photo analysis is not configured");
  }

  const now = params.now ?? (() => Date.now());
  const minIntervalMs = params.minIntervalMs ?? 750;
  if (minIntervalMs > 0) {
    const elapsed = now() - lastGeminiCallAtMs;
    if (elapsed >= 0 && elapsed < minIntervalMs) {
      throw new ApiError(429, "VALIDATION_ERROR", "Photo analysis rate limit exceeded");
    }
  }

  const { mimeType, base64Data } = parseImageDataUrl(params.imageData);

  const prompt = promptForPhotoAnalysis();
  const generateText =
    params.generateTextFn
    ?? ((p: { prompt: string; base64Data: string; mimeType: string }) => {
      if (!params.geminiApiKey) {
        throw new ApiError(503, "INTERNAL_ERROR", "Photo analysis is not configured");
      }
      return defaultGeminiGenerateText({
        apiKey: params.geminiApiKey,
        model: params.model,
        ...p,
      });
    });

  lastGeminiCallAtMs = now();

  let text: string;
  try {
    text = await generateText({ prompt, base64Data, mimeType });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(502, "INTERNAL_ERROR", "Gemini request failed");
  }

  const json = extractFirstJsonObject(text);
  const obj = (json && typeof json === "object") ? (json as Record<string, unknown>) : {};

  const suggestedName = sanitizeText(obj.suggestedName, 120);
  const suggestedSupplier = sanitizeText(obj.suggestedSupplier, 120);
  const notes = sanitizeText(obj.notes, 280);

  const confidence = clamp01(
    typeof obj.confidence === "number"
      ? obj.confidence
      : typeof obj.confidence === "string"
        ? Number(obj.confidence)
        : 0,
  );

  return {
    suggestedName,
    suggestedSupplier,
    notes,
    confidence,
  };
}
