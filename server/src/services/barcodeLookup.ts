import redisClient from '../utils/redisClient.js';
import { appLogger } from '../middleware/requestLogger.js';

// Cache TTLs (match previous route behavior)
const CACHE_FOUND_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const CACHE_NOT_FOUND_TTL_SECONDS = 60 * 60; // 1 hour

export type BarcodeLookupSource = 'barcodelookup' | 'openfoodfacts' | 'upcitemdb';

export interface BarcodeProductInfo {
  name: string;
  brand?: string;
  imageUrl?: string;
  category?: string;
  // Optional metadata (safe for frontend to ignore)
  source?: BarcodeLookupSource;
  normalizedBarcode?: string;
}

type CachePayload = BarcodeProductInfo | { notFound: true };

type LookupResult =
  | { status: 'found'; product: BarcodeProductInfo }
  | { status: 'not_found' }
  | { status: 'error' };

export interface BarcodeLookupOptions {
  timeoutMs?: number;
}

function deadlineFromNow(timeoutMs: number): number {
  const safe = Number.isFinite(timeoutMs) ? Math.max(0, Number(timeoutMs)) : 0;
  return Date.now() + safe;
}

function msUntil(deadlineMs: number): number {
  return Math.max(0, deadlineMs - Date.now());
}

async function promiseWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Timeout');
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Timeout')), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function isAllDigits(s: string): boolean {
  return /^[0-9]+$/.test(s);
}

function computeGtinCheckDigit(dataWithoutCheckDigit: string): number {
  // GS1 Mod10 algorithm used by GTIN-8/12/13/14.
  let sum = 0;
  let weight = 3;
  for (let i = dataWithoutCheckDigit.length - 1; i >= 0; i--) {
    const digit = Number(dataWithoutCheckDigit[i]);
    sum += digit * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return (10 - (sum % 10)) % 10;
}

function isValidGtin(gtin: string): boolean {
  if (!isAllDigits(gtin)) return false;
  if (![8, 12, 13, 14].includes(gtin.length)) return false;
  const expected = computeGtinCheckDigit(gtin.slice(0, -1));
  return expected === Number(gtin[gtin.length - 1]);
}

function expandUpcEToUpcA(upcE: string): string | null {
  // UPC-E is 8 digits: number system (0/1), 6-digit UPC-E payload, check digit.
  if (!isAllDigits(upcE) || upcE.length !== 8) return null;
  const numberSystem = upcE[0];
  if (numberSystem !== '0' && numberSystem !== '1') return null;

  const x1 = upcE[1];
  const x2 = upcE[2];
  const x3 = upcE[3];
  const x4 = upcE[4];
  const x5 = upcE[5];
  const x6 = upcE[6];
  const check = upcE[7];

  let upcA = '';
  if (x6 === '0' || x6 === '1' || x6 === '2') {
    // N X1 X2 X6 0000 X3 X4 X5 C
    upcA = `${numberSystem}${x1}${x2}${x6}0000${x3}${x4}${x5}${check}`;
  } else if (x6 === '3') {
    // N X1 X2 X3 00000 X4 X5 C
    upcA = `${numberSystem}${x1}${x2}${x3}00000${x4}${x5}${check}`;
  } else if (x6 === '4') {
    // N X1 X2 X3 X4 00000 X5 C
    upcA = `${numberSystem}${x1}${x2}${x3}${x4}00000${x5}${check}`;
  } else {
    // N X1 X2 X3 X4 X5 0000 X6 C
    upcA = `${numberSystem}${x1}${x2}${x3}${x4}${x5}0000${x6}${check}`;
  }

  // Validate check digit after expansion; if it fails, still return it (some scanners misreport)
  return upcA.length === 12 ? upcA : null;
}

function normalizeBarcodeForLookup(raw: string): string {
  const trimmed = raw.trim();
  // Some scanners can prefix an AIM symbology identifier like "]C1"
  if (trimmed.startsWith(']') && trimmed.length > 3) {
    return trimmed.slice(3).trim();
  }
  return trimmed;
}

function uniqueKeepOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function getGtinCandidates(rawBarcode: string): string[] {
  const normalized = normalizeBarcodeForLookup(rawBarcode);
  const digits = normalized.replace(/\D/g, '');
  if (!digits) return [];

  const candidates: string[] = [];

  // Start with the raw digits if it looks like a GTIN length.
  if ([8, 12, 13, 14].includes(digits.length)) {
    candidates.push(digits);
  }

  // Common normalization: UPC-A (12) is often represented as EAN-13 with a leading 0.
  if (digits.length === 13 && digits.startsWith('0')) {
    candidates.unshift(digits.slice(1)); // Prefer UPC-A form first for broader lookup coverage
  } else if (digits.length === 12) {
    candidates.push(`0${digits}`);
  }

  // GTIN-14 often includes leading zeros; try trimming to GTIN-13/12 forms.
  if (digits.length === 14 && digits.startsWith('0')) {
    const gtin13 = digits.slice(1);
    candidates.push(gtin13);
    if (gtin13.startsWith('0')) {
      candidates.push(gtin13.slice(1));
    }
  }

  // UPC-E can appear as 8 digits; expand to UPC-A.
  if (digits.length === 8) {
    const upcA = expandUpcEToUpcA(digits);
    if (upcA) {
      candidates.push(upcA);
      candidates.push(`0${upcA}`); // EAN-13 representation
    }
  }

  // Prefer candidates with valid check digits first.
  const uniq = uniqueKeepOrder(candidates);
  const validFirst = uniq.sort((a, b) => Number(isValidGtin(b)) - Number(isValidGtin(a)));
  return validFirst;
}

async function getCached(code: string, maxWaitMs?: number): Promise<CachePayload | null> {
  if (!redisClient) return null;
  if (Number.isFinite(maxWaitMs) && Number(maxWaitMs) <= 0) return null;
  try {
    const getPromise = redisClient.get(`barcode:lookup:${code}`) as Promise<string | null>;
    const cached = Number.isFinite(maxWaitMs)
      ? await promiseWithTimeout(getPromise, Number(maxWaitMs))
      : await getPromise;
    if (!cached) return null;
    return JSON.parse(cached) as CachePayload;
  } catch (err) {
    appLogger.warn({ err }, 'Barcode lookup cache read failed');
    return null;
  }
}

async function setCached(code: string, payload: CachePayload, ttlSeconds: number, maxWaitMs?: number): Promise<void> {
  if (!redisClient) return;
  if (Number.isFinite(maxWaitMs) && Number(maxWaitMs) <= 0) return;
  try {
    const setPromise = redisClient.setEx(
      `barcode:lookup:${code}`,
      ttlSeconds,
      JSON.stringify(payload)
    ) as Promise<unknown>;
    if (Number.isFinite(maxWaitMs)) {
      await promiseWithTimeout(setPromise, Number(maxWaitMs));
    } else {
      await setPromise;
    }
  } catch (err) {
    appLogger.warn({ err }, 'Barcode lookup cache write failed');
  }
}

async function lookupFromBarcodeLookup(code: string, timeoutMs: number): Promise<LookupResult> {
  const apiKey = process.env.BARCODE_LOOKUP_API_KEY;
  if (!apiKey) return { status: 'not_found' }; // Provider disabled

  const url = `https://api.barcodelookup.com/v3/products?barcode=${encodeURIComponent(code)}&key=${encodeURIComponent(apiKey)}`;

  try {
    const response = await fetchWithTimeout(url, {
      headers: {
        Accept: 'application/json',
      },
    }, timeoutMs);

    if (!response.ok) {
      // 404 and 400 mean "not found / invalid" for our purposes.
      if (response.status === 404 || response.status === 400) return { status: 'not_found' };
      appLogger.warn({ status: response.status }, 'BarcodeLookup API non-OK response');
      return { status: 'error' };
    }

    const data = await response.json() as {
      products?: Array<{
        title?: string;
        brand?: string;
        category?: string;
        images?: string[];
      }>;
    };

    const first = data.products?.[0];
    const name = first?.title?.trim();
    if (!name) return { status: 'not_found' };

    return {
      status: 'found',
      product: {
        name,
        brand: first?.brand?.trim() || undefined,
        category: first?.category?.trim() || undefined,
        imageUrl: first?.images?.[0],
        source: 'barcodelookup',
        normalizedBarcode: code,
      },
    };
  } catch (err) {
    appLogger.warn({ err }, 'BarcodeLookup API request failed');
    return { status: 'error' };
  }
}

async function lookupFromOpenFoodFacts(code: string, timeoutMs: number): Promise<LookupResult> {
  // Open Food Facts is free and requires no API key.
  const url = `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(code)}.json`;
  const userAgent = process.env.BARCODE_LOOKUP_USER_AGENT || 'OrderPulse/1.0 (barcode lookup)';

  try {
    const response = await fetchWithTimeout(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': userAgent,
      },
    }, timeoutMs);

    if (!response.ok) {
      if (response.status === 404) return { status: 'not_found' };
      return { status: 'error' };
    }

    const data = await response.json() as {
      status?: number;
      product?: {
        product_name?: string;
        product_name_en?: string;
        brands?: string;
        image_url?: string;
        image_front_url?: string;
        categories?: string;
      };
    };

    if (data.status !== 1 || !data.product) return { status: 'not_found' };

    const product = data.product;
    const name = (product.product_name || product.product_name_en || '').trim();
    if (!name) return { status: 'not_found' };

    return {
      status: 'found',
      product: {
        name,
        brand: product.brands?.trim() || undefined,
        imageUrl: product.image_url || product.image_front_url,
        category: product.categories?.split(',')[0]?.trim() || undefined,
        source: 'openfoodfacts',
        normalizedBarcode: code,
      },
    };
  } catch (err) {
    appLogger.warn({ err }, 'Open Food Facts request failed');
    return { status: 'error' };
  }
}

async function lookupFromUpcItemDb(code: string, timeoutMs: number): Promise<LookupResult> {
  const userKey = process.env.UPCITEMDB_USER_KEY;
  const keyType = process.env.UPCITEMDB_KEY_TYPE || '3scale';
  const path = userKey ? 'v1' : 'trial';

  const url = `https://api.upcitemdb.com/prod/${path}/lookup?upc=${encodeURIComponent(code)}`;

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (userKey) {
    // Preserve underscore header names exactly (Node fetch will keep them as-is)
    headers['user_key'] = userKey;
    headers['key_type'] = keyType;
  }

  try {
    const response = await fetchWithTimeout(url, {
      headers,
    }, timeoutMs);

    if (!response.ok) {
      if (response.status === 404 || response.status === 400) return { status: 'not_found' };
      if (response.status === 429) {
        appLogger.warn({ status: 429 }, 'UPCitemdb rate limited');
      }
      return { status: 'error' };
    }

    const data = await response.json() as {
      items?: Array<{
        title?: string;
        brand?: string;
        images?: string[];
        category?: string;
      }>;
      code?: string;
      message?: string;
    };

    if (!data.items || data.items.length === 0) return { status: 'not_found' };
    const item = data.items[0];
    const name = item.title?.trim();
    if (!name) return { status: 'not_found' };

    return {
      status: 'found',
      product: {
        name,
        brand: item.brand?.trim() || undefined,
        imageUrl: item.images?.[0],
        category: item.category?.trim() || undefined,
        source: 'upcitemdb',
        normalizedBarcode: code,
      },
    };
  } catch (err) {
    appLogger.warn({ err }, 'UPCitemdb request failed');
    return { status: 'error' };
  }
}

async function lookupAcrossProviders(code: string, deadlineMs: number): Promise<{ product: BarcodeProductInfo | null; hadError: boolean }> {
  let hadError = false;

  // Provider order: use the most general catalog first (when configured), then free sources.
  const providers = [
    lookupFromBarcodeLookup,
    lookupFromOpenFoodFacts,
    lookupFromUpcItemDb,
  ];

  for (const provider of providers) {
    const remainingMs = msUntil(deadlineMs);
    if (remainingMs <= 0) {
      // Treat deadline exhaustion as an error to avoid caching "not found".
      return { product: null, hadError: true };
    }

    const result = await provider(code, remainingMs);
    if (result.status === 'found') return { product: result.product, hadError };
    if (result.status === 'error') hadError = true;
  }

  return { product: null, hadError };
}

/**
 * Look up a barcode and return a real product when possible.
 *
 * - Normalizes UPC/EAN/GTIN variants (UPC-A vs EAN-13 leading zero, UPC-E expansion)
 * - Uses Redis caching when available
 * - Tries multiple providers for better coverage
 */
export async function lookupProductByBarcode(rawBarcode: string, options: BarcodeLookupOptions = {}): Promise<BarcodeProductInfo | null> {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : 5000;
  const deadlineMs = deadlineFromNow(timeoutMs);
  const candidates = getGtinCandidates(rawBarcode);
  if (candidates.length === 0) return null;

  // Cache read across all candidate representations.
  for (const code of candidates) {
    const remainingMs = msUntil(deadlineMs);
    if (remainingMs <= 0) return null;

    const cached = await getCached(code, remainingMs);
    if (!cached) continue;
    if ('notFound' in cached) continue;
    if (cached.name) return cached;
  }

  for (const code of candidates) {
    const remainingMs = msUntil(deadlineMs);
    if (remainingMs <= 0) return null;

    const { product, hadError } = await lookupAcrossProviders(code, deadlineMs);
    if (product?.name) {
      await setCached(code, product, CACHE_FOUND_TTL_SECONDS, msUntil(deadlineMs));
      return product;
    }

    // Only cache "not found" when providers did not error (avoid locking in transient failures).
    if (!hadError) {
      await setCached(code, { notFound: true }, CACHE_NOT_FOUND_TTL_SECONDS, msUntil(deadlineMs));
    }
  }

  return null;
}

