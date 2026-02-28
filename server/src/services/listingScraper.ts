import { extractUrlsFromHtml, isJunkUrl } from '../utils/urlExtraction.js';
import { validatePublicHttpUrl } from './urlScraper.js';

const FETCH_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_URLS = 50;
const MAX_MAX_URLS = 200;

export interface ListingScrapeResponse {
  listingUrl: string;
  normalizedUrl?: string;
  status: 'success' | 'partial' | 'failed';
  message?: string;
  productUrls: string[];
  usedJina?: boolean;
}

function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  controller.signal.addEventListener('abort', () => clearTimeout(timeout), { once: true });
  return controller.signal;
}

function looksBlocked(status: number, body: string): boolean {
  if ([403, 429, 503].includes(status)) return true;
  const sample = (body || '').slice(0, 5000).toLowerCase();
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

function normalizeHost(hostname: string): string {
  return hostname.replace(/^www\./i, '').toLowerCase();
}

function isSameHost(url: string, host: string): boolean {
  try {
    return normalizeHost(new URL(url).hostname) === host;
  } catch {
    return false;
  }
}

function looksLikeNonProductPath(pathname: string): boolean {
  const p = pathname.toLowerCase();
  const badPrefixes = [
    '/account',
    '/login',
    '/signup',
    '/register',
    '/cart',
    '/checkout',
    '/help',
    '/support',
    '/privacy',
    '/terms',
    '/returns',
    '/orders',
    '/wishlist',
    '/contact',
    '/store',
    '/stores',
  ];
  return badPrefixes.some(prefix => p.startsWith(prefix));
}

function scoreProductUrl(url: string, rootHost: string): number {
  let score = 0;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return -999;
  }

  const host = normalizeHost(parsed.hostname);
  if (host !== rootHost) return -100;
  if (parsed.pathname === '/' || parsed.pathname === '') score -= 50;
  if (looksLikeNonProductPath(parsed.pathname)) score -= 25;

  const pathname = parsed.pathname.toLowerCase();
  const segments = pathname.split('/').filter(Boolean);
  score += Math.min(segments.length, 6);

  if (/\d{4,}/.test(pathname)) score += 4;
  if (/[a-z]{2,}\d{2,}/i.test(pathname)) score += 2;
  if (pathname.includes('product')) score += 6;

  if (rootHost.endsWith('uline.com')) {
    if (pathname.includes('/product/detail/')) score += 25;
  }
  if (rootHost.includes('mcmaster')) {
    if (/\/[0-9]{3,}[a-z]{1,}\d*\/?$/i.test(pathname)) score += 18;
    if (segments.length === 1 && segments[0]?.length >= 5) score += 10;
  }
  if (rootHost.endsWith('homedepot.com') && pathname.includes('/p/')) score += 18;
  if (rootHost.endsWith('lowes.com') && pathname.includes('/pd/')) score += 18;
  if (rootHost.endsWith('walmart.com') && pathname.includes('/ip/')) score += 18;
  if (rootHost.includes('digikey') && pathname.includes('/en/products/detail/')) score += 20;
  if (rootHost.includes('grainger') && pathname.includes('/product/')) score += 16;
  if (rootHost.includes('fastenal') && pathname.includes('/products/details/')) score += 16;
  if (rootHost.includes('delcity') && pathname.includes('/p/')) score += 12;
  if (rootHost.includes('ferguson') && pathname.includes('/product/')) score += 12;
  if (rootHost.includes('airgas') && pathname.includes('/product/')) score += 12;
  if ((rootHost.includes('mscdirect') || rootHost === 'msc.com') && pathname.includes('/product/details/')) score += 12;
  if (rootHost.includes('wurth') && pathname.includes('/product/')) score += 10;
  if (rootHost.includes('winsupply') && pathname.includes('/product/')) score += 10;
  if (rootHost.includes('wesco') && pathname.includes('/product/')) score += 10;

  if (pathname.includes('/dp/')) score += 8;
  if (pathname.includes('/pd/')) score += 5;
  if (pathname.includes('/ip/')) score += 5;
  if (/\/p\/[^/]+/i.test(pathname)) score += 5;

  score -= Math.min(parsed.searchParams.toString().length / 50, 6);
  return score;
}

async function fetchText(fetchFn: typeof fetch, url: string): Promise<{ status: number; body: string }> {
  const response = await fetchFn(url, {
    method: 'GET',
    redirect: 'follow',
    signal: timeoutSignal(FETCH_TIMEOUT_MS),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  return { status: response.status, body: await response.text() };
}

export async function scrapeListingUrl(
  fetchFn: typeof fetch,
  listingUrl: string,
  options?: { maxUrls?: number },
): Promise<ListingScrapeResponse> {
  const validation = validatePublicHttpUrl(listingUrl);
  if (!validation.valid) {
    return {
      listingUrl,
      status: 'failed',
      message: validation.reason,
      productUrls: [],
    };
  }

  const normalizedUrl = validation.normalized;
  const requestedMax = Number.isFinite(options?.maxUrls) ? Number(options?.maxUrls) : DEFAULT_MAX_URLS;
  const maxUrls = Math.max(1, Math.min(requestedMax, MAX_MAX_URLS));

  let usedJina = false;
  let body = '';
  let status = 0;

  try {
    const primary = await fetchText(fetchFn, normalizedUrl);
    body = primary.body;
    status = primary.status;
    if (!body || looksBlocked(status, body)) {
      usedJina = true;
      const fallback = await fetchText(fetchFn, buildJinaUrl(normalizedUrl));
      body = fallback.body;
      status = fallback.status;
    }
  } catch (err) {
    try {
      usedJina = true;
      const fallback = await fetchText(fetchFn, buildJinaUrl(normalizedUrl));
      body = fallback.body;
      status = fallback.status;
    } catch (fallbackErr) {
      return {
        listingUrl,
        normalizedUrl,
        status: 'failed',
        message: fallbackErr instanceof Error ? fallbackErr.message : 'Failed to fetch listing URL',
        productUrls: [],
        usedJina,
      };
    }
  }

  if (status < 200 || status >= 400) {
    return {
      listingUrl,
      normalizedUrl,
      status: 'failed',
      message: `Fetch failed with status ${status}`,
      productUrls: [],
      usedJina,
    };
  }

  const rootHost = normalizeHost(new URL(normalizedUrl).hostname);
  const candidates = extractUrlsFromHtml(body, normalizedUrl)
    .filter(url => isSameHost(url, rootHost))
    .filter(url => !isJunkUrl(url))
    .filter(url => {
      try {
        const parsed = new URL(url);
        return !looksLikeNonProductPath(parsed.pathname);
      } catch {
        return false;
      }
    });

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const url of candidates) {
    if (seen.has(url)) continue;
    seen.add(url);
    deduped.push(url);
  }

  const productUrls = deduped
    .map(url => ({ url, score: scoreProductUrl(url, rootHost) }))
    .filter(entry => entry.score > -50)
    .sort((a, b) => b.score - a.score)
    .map(entry => entry.url)
    .slice(0, maxUrls);

  const responseStatus: ListingScrapeResponse['status'] = productUrls.length > 0 ? 'success' : 'failed';
  const message = productUrls.length > 0
    ? (usedJina ? 'Extracted product links using Jina fallback.' : undefined)
    : (usedJina ? 'No product links found (Jina fallback used).' : 'No product links found.');

  return {
    listingUrl,
    normalizedUrl,
    status: responseStatus,
    message,
    productUrls,
    usedJina,
  };
}

