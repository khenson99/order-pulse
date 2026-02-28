export function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function cleanUrlCandidate(raw: string): string | null {
  const value = (raw || '')
    .trim()
    .replace(/&amp;/g, '&')
    .replace(/&#x2F;/g, '/')
    .replace(/&#47;/g, '/')
    .replace(/&#x3D;/g, '=')
    .replace(/&#61;/g, '=')
    .replace(/[)\],.;]+$/g, '');

  if (!/^https?:\/\//i.test(value)) {
    return null;
  }

  try {
    const parsed = new URL(value);
    stripTrackingParams(parsed);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

export function resolveUrlCandidate(raw: string, baseUrl: string): string | null {
  const value = (raw || '')
    .trim()
    .replace(/&amp;/g, '&')
    .replace(/&#x2F;/g, '/')
    .replace(/&#47;/g, '/')
    .replace(/&#x3D;/g, '=')
    .replace(/&#61;/g, '=')
    .replace(/[)\],.;]+$/g, '');

  if (!value) return null;

  if (/^https?:\/\//i.test(value)) {
    return cleanUrlCandidate(value);
  }

  try {
    const base = new URL(baseUrl);

    if (value.startsWith('//')) {
      return cleanUrlCandidate(`${base.protocol}${value}`);
    }

    const resolved = new URL(value, base);
    return cleanUrlCandidate(resolved.toString());
  } catch {
    return null;
  }
}

function stripTrackingParams(url: URL): void {
  const trackingKeys = new Set(['gclid', 'fbclid', 'mc_cid', 'mc_eid']);
  for (const key of Array.from(url.searchParams.keys())) {
    const normalized = key.toLowerCase();
    if (normalized.startsWith('utm_') || trackingKeys.has(normalized)) {
      url.searchParams.delete(key);
    }
  }
}

export function extractUrlsFromText(text: string): string[] {
  if (!text) return [];
  const re = /\bhttps?:\/\/[^\s"'<>]+/gi;
  const matches = Array.from(text.matchAll(re)).map(m => m[0]);
  const cleaned = matches.map(cleanUrlCandidate).filter((u): u is string => Boolean(u));
  return uniqueStrings(cleaned);
}

export function extractUrlsFromHtml(html: string, baseUrl?: string): string[] {
  if (!html) return [];
  const hrefs = Array.from(html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)).map(m => m[1]);
  const candidates = [...hrefs, ...extractUrlsFromText(html)];
  const cleaned = candidates
    .map(candidate => (
      baseUrl ? resolveUrlCandidate(candidate, baseUrl) : cleanUrlCandidate(candidate)
    ))
    .filter((u): u is string => Boolean(u));
  return uniqueStrings(cleaned);
}

export function extractImageUrlsFromHtml(html: string, baseUrl?: string): string[] {
  if (!html) return [];

  const imgSrcs = Array.from(html.matchAll(/<img[^>]*\ssrc\s*=\s*["']([^"']+)["']/gi)).map(m => m[1]);
  const ogImages = Array.from(
    html.matchAll(/<meta[^>]*property\s*=\s*["']og:image["'][^>]*content\s*=\s*["']([^"']+)["']/gi)
  ).map(m => m[1]);
  const twitterImages = Array.from(
    html.matchAll(/<meta[^>]*(?:name|property)\s*=\s*["']twitter:image["'][^>]*content\s*=\s*["']([^"']+)["']/gi)
  ).map(m => m[1]);

  const textUrls = extractUrlsFromText(html).filter(looksLikeImageUrl);
  const candidates = [...imgSrcs, ...ogImages, ...twitterImages, ...textUrls];
  const cleaned = candidates
    .map(candidate => (
      baseUrl ? resolveUrlCandidate(candidate, baseUrl) : cleanUrlCandidate(candidate)
    ))
    .filter((u): u is string => Boolean(u));
  return uniqueStrings(cleaned);
}

export function looksLikeImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();
    return /\.(png|jpe?g|webp|gif|svg|avif)$/.test(pathname);
  } catch {
    return false;
  }
}

export function isJunkUrl(url: string): boolean {
  const lower = url.toLowerCase();
  const junkFragments = [
    'unsubscribe',
    'preferences',
    'privacy',
    'terms',
    'support',
    'help',
    'account',
    'login',
    'signup',
    'doubleclick',
    'mailchimp',
    'mandrillapp',
    'sendgrid',
    'constantcontact',
    'campaign-archive',
  ];

  return junkFragments.some(fragment => lower.includes(fragment));
}

interface BestProductUrlParams {
  vendorDomain?: string;
  itemName: string;
  sku?: string;
}

export function pickBestProductUrlForItem(params: BestProductUrlParams, urls: string[]): string | undefined {
  if (urls.length === 0) return undefined;

  const vendorDomain = (params.vendorDomain || '').toLowerCase();
  const vendorUrls = vendorDomain && vendorDomain !== 'unknown'
    ? urls.filter(url => url.toLowerCase().includes(vendorDomain))
    : urls;
  const pool = vendorUrls.length > 0 ? vendorUrls : urls;

  const sku = params.sku?.trim();
  if (sku) {
    const skuMatch = pool.find(url => url.toLowerCase().includes(sku.toLowerCase()));
    if (skuMatch) return skuMatch;
  }

  const tokens = params.itemName
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(token => token.length >= 4)
    .slice(0, 3);

  for (const token of tokens) {
    const tokenMatch = pool.find(url => url.toLowerCase().includes(token));
    if (tokenMatch) return tokenMatch;
  }

  const nonRoot = pool.find(url => {
    try {
      const parsed = new URL(url);
      return parsed.pathname && parsed.pathname !== '/';
    } catch {
      return false;
    }
  });

  return nonRoot || pool[0];
}

export function pickBestImageUrlForItem(
  params: { vendorDomain?: string },
  urls: string[]
): string | undefined {
  if (urls.length === 0) return undefined;

  const vendorDomain = (params.vendorDomain || '').toLowerCase();
  const vendorUrls = vendorDomain && vendorDomain !== 'unknown'
    ? urls.filter(url => url.toLowerCase().includes(vendorDomain))
    : urls;
  const pool = vendorUrls.length > 0 ? vendorUrls : urls;

  const imageLike = pool.filter(looksLikeImageUrl);
  if (imageLike.length > 0) return imageLike[0];

  return pool[0];
}
