import { isIP } from "node:net";
import { ApiError } from "../types";

const MAX_HTML_BYTES = 2_000_000;
const FETCH_TIMEOUT_MS = 10_000;
const CONCURRENCY_LIMIT = 5;
const MAX_REDIRECTS = 5;

export type UrlExtractionSource = "html-metadata" | "error";

export interface UrlScrapedItem {
  sourceUrl: string;
  productUrl?: string;
  imageUrl?: string;
  itemName?: string;
  supplier?: string;
  price?: number;
  currency?: string;
  description?: string;
  vendorSku?: string;
  needsReview: boolean;
  extractionSource: UrlExtractionSource;
  confidence: number;
}

export interface UrlScrapeResult {
  sourceUrl: string;
  normalizedUrl?: string;
  status: "success" | "partial" | "failed";
  message?: string;
  extractionSource: UrlExtractionSource;
  item: UrlScrapedItem;
}

export interface UrlScrapeResponse {
  requested: number;
  processed: number;
  results: UrlScrapeResult[];
  items: UrlScrapedItem[];
}

export interface UrlScraperDeps {
  fetchFn?: typeof fetch;
}

function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  controller.signal.addEventListener("abort", () => clearTimeout(timeout), { once: true });
  return controller.signal;
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p))) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1") return true;
  // Unique local addresses fc00::/7
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  // Link-local fe80::/10
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) {
    return true;
  }
  return false;
}

function assertSafeUrl(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ApiError(422, "VALIDATION_ERROR", "Only http/https URLs are supported");
  }

  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local")) {
    throw new ApiError(422, "VALIDATION_ERROR", "Localhost URLs are not allowed");
  }

  const ipType = isIP(host);
  if (ipType === 4 && isPrivateIpv4(host)) {
    throw new ApiError(422, "VALIDATION_ERROR", "Private IP URLs are not allowed");
  }
  if (ipType === 6 && isPrivateIpv6(host)) {
    throw new ApiError(422, "VALIDATION_ERROR", "Private IP URLs are not allowed");
  }
}

export function cleanUrlCandidate(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new ApiError(422, "VALIDATION_ERROR", "URL is required");

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ApiError(422, "VALIDATION_ERROR", "Invalid URL");
  }

  assertSafeUrl(url);

  // Strip fragments (don’t affect fetch or product identity).
  url.hash = "";
  return url.toString();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function stripHtmlTags(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " "),
  ).trim();
}

function extractTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match?.[1]) return undefined;
  return decodeHtmlEntities(match[1]).trim();
}

function extractH1(html: string): string | undefined {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!match?.[1]) return undefined;
  return decodeHtmlEntities(match[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function readMetaContent(html: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]*property=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]*name=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']${escaped}["'][^>]*>`, "i"),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtmlEntities(match[1]).trim();
  }
  return undefined;
}

function readCanonicalUrl(html: string): string | undefined {
  const match = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i)
    || html.match(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["'][^>]*>/i);
  if (!match?.[1]) return undefined;
  try {
    return cleanUrlCandidate(match[1]) || undefined;
  } catch {
    return undefined;
  }
}

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function normalizeJsonLdNode(node: unknown): unknown[] {
  if (!node) return [];
  if (Array.isArray(node)) {
    return node.flatMap((entry) => normalizeJsonLdNode(entry));
  }
  if (typeof node !== "object") return [];

  const obj = node as Record<string, unknown>;
  if (Array.isArray(obj["@graph"])) {
    return normalizeJsonLdNode(obj["@graph"]);
  }
  return [obj];
}

function isProductNode(node: Record<string, unknown>): boolean {
  const t = node["@type"];
  if (typeof t === "string") return t.toLowerCase().includes("product");
  if (Array.isArray(t)) {
    return t.some((entry) => typeof entry === "string" && entry.toLowerCase().includes("product"));
  }
  return false;
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string" && entry.trim()) return entry.trim();
      if (entry && typeof entry === "object") {
        const nested = firstString((entry as Record<string, unknown>).url);
        if (nested) return nested;
      }
    }
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const nested = firstString(obj.url) || firstString(obj.contentUrl);
    if (nested) return nested;
  }
  return undefined;
}

function normalizeAsNumber(input: unknown): number | undefined {
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input !== "string") return undefined;
  const match = input.match(/-?\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const value = Number.parseFloat(match[0]);
  return Number.isFinite(value) ? value : undefined;
}

function normalizeCurrency(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= 5) return trimmed.toUpperCase();
  return trimmed;
}

function extractPriceFromText(text: string): number | undefined {
  const match = text.match(/(?:\$|USD\s*)\s*(\d{1,6}(?:\.\d{1,2})?)/i);
  if (!match?.[1]) return undefined;
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

function inferSupplierFromUrl(url: string): string | undefined {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./i, "");
    const root = hostname.split(".")[0] || "";
    if (!root) return undefined;
    return root
      .split(/[-_]+/g)
      .filter(Boolean)
      .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
      .join(" ");
  } catch {
    return undefined;
  }
}

function extractJsonLdProduct(html: string): Partial<UrlScrapedItem> {
  const scripts = Array.from(
    html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
  ).map((match) => match[1]?.trim()).filter(Boolean) as string[];

  for (const scriptContent of scripts) {
    const parsed = parseJson<unknown>(scriptContent);
    if (!parsed) continue;

    const nodes = normalizeJsonLdNode(parsed);
    const productNode = nodes.find((node) => node && typeof node === "object" && isProductNode(node as any)) as Record<string, unknown> | undefined;
    if (!productNode) continue;

    const offersRaw = productNode.offers;
    const offers = Array.isArray(offersRaw)
      ? (offersRaw[0] as Record<string, unknown> | undefined)
      : (offersRaw as Record<string, unknown> | undefined);

    const brand = productNode.brand;
    const brandName = typeof brand === "string"
      ? brand
      : typeof brand === "object" && brand !== null
        ? firstString((brand as Record<string, unknown>).name)
        : undefined;

    const supplier = brandName
      || firstString(productNode.manufacturer)
      || firstString(productNode.seller)
      || firstString(productNode.vendor);

    return {
      itemName: firstString(productNode.name),
      description: firstString(productNode.description),
      vendorSku: firstString(productNode.sku) || firstString(productNode.mpn) || firstString(productNode.productID),
      supplier,
      productUrl: firstString(productNode.url),
      imageUrl: firstString(productNode.image),
      price: normalizeAsNumber(offers?.price),
      currency: normalizeCurrency(offers?.priceCurrency),
    };
  }

  return {};
}

async function readTextWithLimit(res: Response, maxBytes: number): Promise<string> {
  const lengthHeader = res.headers.get("content-length");
  if (lengthHeader) {
    const parsed = Number(lengthHeader);
    if (Number.isFinite(parsed) && parsed > maxBytes) {
      throw new ApiError(422, "VALIDATION_ERROR", "Response too large");
    }
  }

  const reader = res.body?.getReader();
  if (!reader) {
    return await res.text();
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      total += value.length;
      if (total > maxBytes) {
        throw new ApiError(422, "VALIDATION_ERROR", "Response too large");
      }
      chunks.push(value);
    }
  }

  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

async function fetchPage(url: string, deps: UrlScraperDeps): Promise<{ finalUrl: string; html: string; contentType: string }> {
  const fetchFn = deps.fetchFn ?? fetch;
  const signal = timeoutSignal(FETCH_TIMEOUT_MS);
  const res = await fetchFn(url, {
    method: "GET",
    redirect: "follow",
    signal,
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent": "onboarding-api/1.0 (url scrape)",
    },
  } as any);

  // Best-effort redirect bound: rely on Node fetch built-in policy; detect excessive redirects via header.
  const redirectCount = Number(res.headers.get("x-fetch-redirect-count") || "0");
  if (Number.isFinite(redirectCount) && redirectCount > MAX_REDIRECTS) {
    throw new ApiError(422, "VALIDATION_ERROR", "Too many redirects");
  }

  if (!res.ok) {
    throw new ApiError(422, "VALIDATION_ERROR", `Fetch failed (${res.status})`);
  }

  const contentType = res.headers.get("content-type") || "";
  const html = await readTextWithLimit(res, MAX_HTML_BYTES);
  return { finalUrl: res.url || url, html, contentType };
}

export function extractUrlMetadata(html: string, finalUrl: string): UrlScrapedItem {
  const jsonLd = extractJsonLdProduct(html);
  const ogTitle = readMetaContent(html, "og:title");
  const ogDescription = readMetaContent(html, "og:description") || readMetaContent(html, "description");
  const ogImage = readMetaContent(html, "og:image") || readMetaContent(html, "twitter:image");
  const ogPrice = readMetaContent(html, "product:price:amount") || readMetaContent(html, "og:price:amount");
  const ogCurrency = readMetaContent(html, "product:price:currency") || readMetaContent(html, "og:price:currency");
  const title = extractTitle(html);
  const h1 = extractH1(html);
  const canonical = readCanonicalUrl(html);

  const productUrl = canonical || jsonLd.productUrl || finalUrl;
  const imageUrl = jsonLd.imageUrl || ogImage;
  const itemName = jsonLd.itemName || ogTitle || h1 || title;
  const description = jsonLd.description || ogDescription;
  const price = jsonLd.price ?? normalizeAsNumber(ogPrice) ?? extractPriceFromText(stripHtmlTags(html));
  const currency = jsonLd.currency || normalizeCurrency(ogCurrency);
  const supplier = jsonLd.supplier || inferSupplierFromUrl(productUrl);

  const signals = [
    Boolean(itemName),
    Boolean(imageUrl),
    Boolean(price),
    Boolean(supplier),
    Boolean(description),
  ].filter(Boolean).length;

  const confidence = Math.min(1, 0.25 + signals * 0.15);
  const needsReview = confidence < 0.75;

  return {
    sourceUrl: finalUrl,
    productUrl,
    imageUrl: imageUrl || undefined,
    itemName: itemName || undefined,
    supplier,
    price,
    currency,
    description: description || undefined,
    vendorSku: jsonLd.vendorSku || undefined,
    needsReview,
    extractionSource: "html-metadata",
    confidence,
  };
}

async function scrapeOne(sourceUrl: string, deps: UrlScraperDeps): Promise<UrlScrapeResult> {
  let normalizedUrl: string | undefined;
  try {
    normalizedUrl = cleanUrlCandidate(sourceUrl);
    const page = await fetchPage(normalizedUrl, deps);
    const item = extractUrlMetadata(page.html, page.finalUrl);

    const status: UrlScrapeResult["status"] = item.itemName || item.imageUrl ? "success" : "partial";
    const message = status === "partial" ? "Missing key metadata; review required" : undefined;

    return {
      sourceUrl,
      normalizedUrl,
      status,
      message,
      extractionSource: item.extractionSource,
      item: { ...item, sourceUrl },
    };
  } catch (err) {
    const message =
      err instanceof ApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Unknown error";
    const item: UrlScrapedItem = {
      sourceUrl,
      needsReview: true,
      extractionSource: "error",
      confidence: 0,
    };
    return {
      sourceUrl,
      normalizedUrl,
      status: "failed",
      message,
      extractionSource: "error",
      item,
    };
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function scrapeUrls(urls: string[], deps: UrlScraperDeps = {}): Promise<UrlScrapeResponse> {
  const cleaned = urls
    .filter((u): u is string => typeof u === "string")
    .map((u) => u.trim())
    .filter(Boolean);

  const deduped = Array.from(new Set(cleaned));
  if (deduped.length === 0) {
    throw new ApiError(422, "VALIDATION_ERROR", "At least one URL is required");
  }
  if (deduped.length > 50) {
    throw new ApiError(422, "VALIDATION_ERROR", "Maximum 50 URLs are allowed per request");
  }

  const results = await mapLimit(deduped, CONCURRENCY_LIMIT, (u) => scrapeOne(u, deps));
  const items = results
    .filter((r) => r.status !== "failed")
    .map((r) => r.item);

  return {
    requested: urls.length,
    processed: results.length,
    results,
    items,
  };
}

