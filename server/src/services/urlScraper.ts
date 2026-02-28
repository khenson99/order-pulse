import { isIP } from 'node:net';
import {
  createAffiliateUrl,
  amazonService,
} from './amazon.js';
import { createGeminiExtractionModel } from './emailExtraction.js';
import {
  cleanUrlCandidate,
  extractImageUrlsFromHtml,
  resolveUrlCandidate,
  looksLikeImageUrl,
} from '../utils/urlExtraction.js';

const MAX_HTML_BYTES = 2_000_000;
const FETCH_TIMEOUT_MS = 10_000;
const CONCURRENCY_LIMIT = 5;

export type UrlExtractionSource = 'amazon-paapi' | 'html-metadata' | 'hybrid-ai' | 'error';

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
  asin?: string;
  needsReview: boolean;
  extractionSource: UrlExtractionSource;
  confidence: number;
}

export interface UrlScrapeResult {
  sourceUrl: string;
  normalizedUrl?: string;
  status: 'success' | 'partial' | 'failed';
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
  createModel?: () => AiModel | null;
}

export interface AiModel {
  generateContent: (prompt: string) => Promise<{ response: { text: () => string } }>;
}

interface PageFetchResult {
  finalUrl: string;
  html: string;
  contentType: string;
  status: number;
  usedJina?: boolean;
}

interface DeterministicExtraction {
  productUrl?: string;
  imageUrl?: string;
  itemName?: string;
  supplier?: string;
  price?: number;
  currency?: string;
  description?: string;
  vendorSku?: string;
  extractionSource: UrlExtractionSource;
}

const AI_FALLBACK_PROMPT = `You extract ecommerce product details from webpage text and metadata.

Return strict JSON only with this exact shape:
{
  "itemName": string | null,
  "supplier": string | null,
  "price": number | null,
  "currency": string | null,
  "description": string | null,
  "vendorSku": string | null,
  "imageUrl": string | null
}

Rules:
- Do not invent information.
- If unknown, return null for that field.
- price must be numeric only (no symbols).
- supplier should be the brand/manufacturer/vendor name if present.`;

function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  controller.signal.addEventListener('abort', () => clearTimeout(timeout), { once: true });
  return controller.signal;
}

function titleCaseWord(word: string): string {
  if (!word) return word;
  return `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`;
}

function inferSupplierFromUrl(url: string): string | undefined {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./i, '');
    const root = hostname.split('.')[0] || '';
    if (!root) return undefined;
    return root
      .split(/[-_]+/g)
      .filter(Boolean)
      .map(titleCaseWord)
      .join(' ');
  } catch {
    return undefined;
  }
}

function normalizeAsNumber(input: unknown): number | undefined {
  if (typeof input === 'number' && Number.isFinite(input)) {
    return input;
  }

  if (typeof input !== 'string') return undefined;
  const match = input.match(/-?\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const value = Number.parseFloat(match[0]);
  return Number.isFinite(value) ? value : undefined;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function stripHtmlTags(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
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
  return decodeHtmlEntities(match[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function readMetaContent(html: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]*property=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]*name=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']${escaped}["'][^>]*>`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return decodeHtmlEntities(match[1]).trim();
    }
  }
  return undefined;
}

function readCanonicalUrl(html: string, baseUrl: string): string | undefined {
  const match = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i)
    || html.match(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["'][^>]*>/i);
  if (!match?.[1]) return undefined;
  return resolveUrlCandidate(match[1], baseUrl) || cleanUrlCandidate(match[1]) || undefined;
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
    return node.flatMap(entry => normalizeJsonLdNode(entry));
  }

  if (typeof node !== 'object') return [];

  const obj = node as Record<string, unknown>;
  if (Array.isArray(obj['@graph'])) {
    return normalizeJsonLdNode(obj['@graph']);
  }

  return [obj];
}

function isProductNode(node: Record<string, unknown>): boolean {
  const t = node['@type'];
  if (typeof t === 'string') {
    return t.toLowerCase().includes('product');
  }
  if (Array.isArray(t)) {
    return t.some(entry => typeof entry === 'string' && entry.toLowerCase().includes('product'));
  }
  return false;
}

function firstString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string' && entry.trim()) return entry.trim();
      if (entry && typeof entry === 'object') {
        const nested = firstString((entry as Record<string, unknown>).url);
        if (nested) return nested;
      }
    }
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const nested = firstString(obj.url) || firstString(obj.contentUrl);
    if (nested) return nested;
  }
  return undefined;
}

function normalizeCurrency(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
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

function extractJsonLdProduct(html: string, baseUrl: string): Partial<DeterministicExtraction> {
  const scripts = Array.from(
    html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
  ).map(match => match[1]?.trim()).filter(Boolean) as string[];

  for (const scriptContent of scripts) {
    const parsed = parseJson<unknown>(scriptContent);
    if (!parsed) continue;

    const nodes = normalizeJsonLdNode(parsed);
    const productNode = nodes.find(node => {
      if (!node || typeof node !== 'object') return false;
      return isProductNode(node as Record<string, unknown>);
    }) as Record<string, unknown> | undefined;

    if (!productNode) continue;

    const offersRaw = productNode.offers;
    const offers = Array.isArray(offersRaw)
      ? (offersRaw[0] as Record<string, unknown> | undefined)
      : (offersRaw as Record<string, unknown> | undefined);

    const brand = productNode.brand;
    const brandName = typeof brand === 'string'
      ? brand
      : typeof brand === 'object' && brand !== null
        ? firstString((brand as Record<string, unknown>).name)
        : undefined;

    const supplier = brandName
      || firstString(productNode.manufacturer)
      || firstString(productNode.seller)
      || firstString(productNode.vendor);

    const productUrlRaw = firstString(productNode.url) || '';
    const imageUrlRaw = firstString(productNode.image) || '';

    return {
      itemName: firstString(productNode.name),
      description: firstString(productNode.description),
      vendorSku: firstString(productNode.sku) || firstString(productNode.mpn) || firstString(productNode.productID),
      supplier,
      productUrl: resolveUrlCandidate(productUrlRaw, baseUrl) || cleanUrlCandidate(productUrlRaw) || undefined,
      imageUrl: resolveUrlCandidate(imageUrlRaw, baseUrl) || cleanUrlCandidate(imageUrlRaw) || undefined,
      price: normalizeAsNumber(offers?.price),
      currency: normalizeCurrency(offers?.priceCurrency),
    };
  }

  return {};
}

function mergeDeterministicData(html: string, baseUrl: string): DeterministicExtraction {
  const jsonLd = extractJsonLdProduct(html, baseUrl);

  const ogTitle = readMetaContent(html, 'og:title');
  const ogDescription = readMetaContent(html, 'og:description') || readMetaContent(html, 'description');
  const ogImage = readMetaContent(html, 'og:image') || readMetaContent(html, 'twitter:image');
  const ogPrice = readMetaContent(html, 'product:price:amount') || readMetaContent(html, 'og:price:amount');
  const ogCurrency = readMetaContent(html, 'product:price:currency') || readMetaContent(html, 'og:price:currency');
  const title = extractTitle(html);
  const h1 = extractH1(html);

  const imageCandidates = extractImageUrlsFromHtml(html, baseUrl);
  const imageFromMeta = ogImage ? (resolveUrlCandidate(ogImage, baseUrl) || cleanUrlCandidate(ogImage)) : null;
  const imageUrl = jsonLd.imageUrl
    || imageFromMeta
    || imageCandidates.find(looksLikeImageUrl)
    || imageCandidates[0];

  const productUrl = jsonLd.productUrl
    || readCanonicalUrl(html, baseUrl)
    || cleanUrlCandidate(baseUrl)
    || baseUrl;

  const itemName = jsonLd.itemName || ogTitle || h1 || title;
  const description = jsonLd.description || ogDescription;
  const price = jsonLd.price ?? normalizeAsNumber(ogPrice) ?? extractPriceFromText(stripHtmlTags(html));
  const currency = jsonLd.currency || normalizeCurrency(ogCurrency);

  return {
    productUrl,
    imageUrl,
    itemName,
    supplier: jsonLd.supplier || inferSupplierFromUrl(baseUrl),
    price,
    currency,
    description,
    vendorSku: jsonLd.vendorSku,
    extractionSource: 'html-metadata',
  };
}

function parseAiJson(raw: string): Partial<DeterministicExtraction> {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return {};

  const parsed = parseJson<Record<string, unknown>>(jsonMatch[0]);
  if (!parsed) return {};

  return {
    itemName: firstString(parsed.itemName),
    supplier: firstString(parsed.supplier),
    price: normalizeAsNumber(parsed.price),
    currency: normalizeCurrency(parsed.currency),
    description: firstString(parsed.description),
    vendorSku: firstString(parsed.vendorSku),
    imageUrl: cleanUrlCandidate(firstString(parsed.imageUrl) || '') || undefined,
  };
}

async function maybeFillWithAi(
  model: AiModel | null,
  html: string,
  finalUrl: string,
  deterministic: DeterministicExtraction
): Promise<Partial<DeterministicExtraction>> {
  if (!model) return {};

  const missingFields = [
    !deterministic.itemName,
    !deterministic.supplier,
    deterministic.price === undefined,
    !deterministic.description,
    !deterministic.vendorSku,
    !deterministic.imageUrl,
  ].some(Boolean);

  if (!missingFields) return {};

  const prompt = `${AI_FALLBACK_PROMPT}\n\nURL: ${finalUrl}\n\nDeterministic metadata:\n${JSON.stringify(deterministic)}\n\nPage text:\n${stripHtmlTags(html).slice(0, 5000)}`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    return parseAiJson(text);
  } catch {
    return {};
  }
}

async function fetchPage(fetchFn: typeof fetch, rawUrl: string): Promise<PageFetchResult> {
  const response = await fetchFn(rawUrl, {
    method: 'GET',
    redirect: 'follow',
    signal: timeoutSignal(FETCH_TIMEOUT_MS),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  const contentLength = Number.parseInt(response.headers.get('content-length') || '0', 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_HTML_BYTES) {
    throw new Error('Page exceeds maximum size');
  }

  const html = await response.text();
  if (html.length > MAX_HTML_BYTES) {
    throw new Error('Page exceeds maximum size');
  }

  return {
    finalUrl: response.url || rawUrl,
    html,
    contentType: response.headers.get('content-type') || '',
    status: response.status,
  };
}

function isAmazonLikeHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return lower.includes('amazon.') || lower === 'amzn.to' || lower === 'a.co';
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map(segment => Number.parseInt(segment, 10));
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;

  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isPrivateIpv6(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === '::1') return true;
  if (lower.startsWith('fe80:')) return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  return false;
}

export function validatePublicHttpUrl(rawUrl: string): { valid: true; normalized: string } | { valid: false; reason: string } {
  const normalized = cleanUrlCandidate(rawUrl || '');
  if (!normalized) {
    return { valid: false, reason: 'URL must be a valid http/https URL' };
  }

  try {
    const parsed = new URL(normalized);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { valid: false, reason: 'URL must use http or https' };
    }

    const hostname = parsed.hostname.toLowerCase();
    if (!hostname) {
      return { valid: false, reason: 'URL hostname is missing' };
    }

    if (
      hostname === 'localhost'
      || hostname.endsWith('.local')
      || hostname === '0.0.0.0'
      || hostname === '::1'
    ) {
      return { valid: false, reason: 'Local and loopback hosts are not allowed' };
    }

    const ipVersion = isIP(hostname);
    if (ipVersion === 4 && isPrivateIpv4(hostname)) {
      return { valid: false, reason: 'Private-network hosts are not allowed' };
    }
    if (ipVersion === 6 && isPrivateIpv6(hostname)) {
      return { valid: false, reason: 'Private-network hosts are not allowed' };
    }

    return { valid: true, normalized };
  } catch {
    return { valid: false, reason: 'Invalid URL' };
  }
}

function buildFailureItem(sourceUrl: string, normalizedUrl: string | undefined, supplier?: string): UrlScrapedItem {
  return {
    sourceUrl,
    productUrl: normalizedUrl || sourceUrl,
    itemName: supplier ? `${supplier} Product` : undefined,
    supplier,
    needsReview: true,
    extractionSource: 'error',
    confidence: 0,
  };
}

function toResultStatus(item: UrlScrapedItem): 'success' | 'partial' | 'failed' {
  const hasCore = Boolean(item.itemName && item.supplier && item.productUrl);
  const hasDetails = item.price !== undefined || Boolean(item.imageUrl || item.description || item.vendorSku);
  if (hasCore && hasDetails && !item.needsReview) return 'success';
  if (hasCore || hasDetails) return 'partial';
  return 'failed';
}

function looksBlocked(status: number, html: string): boolean {
  if ([403, 429, 503].includes(status)) return true;
  const sample = (html || '').slice(0, 6000).toLowerCase();
  return (
    sample.includes('access denied')
    || sample.includes('request blocked')
    || sample.includes('captcha')
    || sample.includes('bot detection')
    || sample.includes('cloudflare')
    || sample.includes('verify you are human')
  );
}

function buildJinaUrl(url: string): string {
  return `https://r.jina.ai/${url}`;
}

async function scrapeOneUrl(
  fetchFn: typeof fetch,
  model: AiModel | null,
  sourceUrl: string
): Promise<UrlScrapeResult> {
  const validation = validatePublicHttpUrl(sourceUrl);
  if (!validation.valid) {
    const item = buildFailureItem(sourceUrl, undefined, undefined);
    return {
      sourceUrl,
      status: 'failed',
      message: validation.reason,
      extractionSource: 'error',
      item,
    };
  }

  const normalizedUrl = validation.normalized;

  try {
    let fetched: PageFetchResult | null = null;
    let usedJina = false;

    try {
      fetched = await fetchPage(fetchFn, normalizedUrl);
    } catch {
      fetched = null;
    }

    const primaryFinalUrl = fetched?.finalUrl ? (cleanUrlCandidate(fetched.finalUrl) || normalizedUrl) : normalizedUrl;
    const primaryLooksBlocked = fetched ? looksBlocked(fetched.status, fetched.html) : true;

    if (!fetched || !fetched.html || primaryLooksBlocked || !String(fetched.contentType || '').toLowerCase().includes('html')) {
      try {
        const jinaFetched = await fetchPage(fetchFn, buildJinaUrl(normalizedUrl));
        fetched = {
          ...jinaFetched,
          finalUrl: primaryFinalUrl,
          usedJina: true,
        };
        usedJina = true;
      } catch {
        // Keep primary fetch if it exists.
      }
    }

    if (!fetched) {
      throw new Error('Failed to fetch URL');
    }

    if (fetched.status < 200 || fetched.status >= 400) {
      throw new Error(`Fetch failed with status ${fetched.status}`);
    }

    const finalUrl = cleanUrlCandidate(fetched.finalUrl) || normalizedUrl;

    const finalHost = new URL(finalUrl).hostname;
    if (isAmazonLikeHost(finalHost)) {
      const asin = amazonService.extractAsinFromUrl(finalUrl) || amazonService.extractAsinFromUrl(normalizedUrl);
      if (!asin) {
        const supplier = inferSupplierFromUrl(finalUrl) || 'Amazon';
        const item: UrlScrapedItem = {
          ...buildFailureItem(sourceUrl, finalUrl, supplier),
          extractionSource: 'amazon-paapi',
          confidence: 0.45,
        };
        return {
          sourceUrl,
          normalizedUrl,
          status: 'partial',
          message: 'Amazon URL detected but ASIN was not found',
          extractionSource: 'amazon-paapi',
          item,
        };
      }

      const enriched = await amazonService.enrichItemWithAmazon(asin);
      const price = enriched?.UnitPrice ?? normalizeAsNumber(enriched?.Price);
      const productUrl = enriched?.AmazonURL || createAffiliateUrl(asin);
      const item: UrlScrapedItem = {
        sourceUrl,
        productUrl,
        imageUrl: enriched?.ImageURL,
        itemName: enriched?.ItemName || `Amazon Item ${asin}`,
        supplier: 'Amazon',
        price,
        currency: 'USD',
        description: undefined,
        vendorSku: enriched?.UPC,
        asin,
        needsReview: !(enriched?.ItemName && price !== undefined && enriched?.ImageURL),
        extractionSource: 'amazon-paapi',
        confidence: enriched ? 0.95 : 0.7,
      };

      return {
        sourceUrl,
        normalizedUrl,
        status: toResultStatus(item),
        extractionSource: 'amazon-paapi',
        item,
      };
    }

    const deterministic = mergeDeterministicData(fetched.html, finalUrl);
    const aiFill = await maybeFillWithAi(model, fetched.html, finalUrl, deterministic);

    const finalExtraction: DeterministicExtraction = {
      ...deterministic,
      ...Object.fromEntries(
        Object.entries(aiFill).filter(([, value]) => value !== undefined)
      ),
      extractionSource: Object.keys(aiFill).length > 0 ? 'hybrid-ai' : 'html-metadata',
    };

    const supplier = finalExtraction.supplier || inferSupplierFromUrl(finalUrl);
    const item: UrlScrapedItem = {
      sourceUrl,
      productUrl: finalExtraction.productUrl || finalUrl,
      imageUrl: finalExtraction.imageUrl,
      itemName: finalExtraction.itemName,
      supplier,
      price: finalExtraction.price,
      currency: finalExtraction.currency,
      description: finalExtraction.description,
      vendorSku: finalExtraction.vendorSku,
      needsReview: !(
        finalExtraction.itemName
        && supplier
        && finalExtraction.price !== undefined
        && finalExtraction.imageUrl
      ),
      extractionSource: finalExtraction.extractionSource,
      confidence: finalExtraction.extractionSource === 'hybrid-ai' ? 0.72 : 0.64,
    };

    return {
      sourceUrl,
      normalizedUrl,
      status: toResultStatus(item),
      extractionSource: finalExtraction.extractionSource,
      item,
      message: usedJina
        ? 'Used Jina fallback due to bot protection.'
        : (fetched.contentType && !fetched.contentType.toLowerCase().includes('html')
          ? `Non-HTML content type: ${fetched.contentType}`
          : undefined),
    };
  } catch (error) {
    const supplier = inferSupplierFromUrl(normalizedUrl);
    const item: UrlScrapedItem = {
      ...buildFailureItem(sourceUrl, normalizedUrl, supplier),
      extractionSource: 'error',
      confidence: 0,
    };

    return {
      sourceUrl,
      normalizedUrl,
      status: 'failed',
      message: error instanceof Error ? error.message : 'Failed to scrape URL',
      extractionSource: 'error',
      item,
    };
  }
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(concurrency, values.length) }).map(async () => {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= values.length) {
        return;
      }
      results[current] = await mapper(values[current], current);
    }
  });

  await Promise.all(workers);
  return results;
}

export function createUrlScraper(deps: UrlScraperDeps = {}) {
  const fetchFn = deps.fetchFn || fetch;
  const createModel = deps.createModel || (() => {
    if (!process.env.GEMINI_API_KEY) return null;
    return createGeminiExtractionModel();
  });

  async function scrapeUrls(urls: string[]): Promise<UrlScrapeResponse> {
    const model = createModel ? createModel() : null;
    const results = await mapWithConcurrency(urls, CONCURRENCY_LIMIT, async (url) => (
      scrapeOneUrl(fetchFn, model, url)
    ));

    return {
      requested: urls.length,
      processed: results.length,
      results,
      items: results.map(result => result.item),
    };
  }

  return { scrapeUrls };
}

export const urlScraper = createUrlScraper();
