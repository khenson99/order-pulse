export const MAX_HTML_BYTES = 2_000_000;

export const SCRAPER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

export function timeoutSignal(ms: number): AbortSignal {
  const timeoutFn = (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }).timeout;
  if (typeof timeoutFn === 'function') {
    return timeoutFn(ms);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  controller.signal.addEventListener('abort', () => clearTimeout(timeout), { once: true });
  return controller.signal;
}

export function looksBlocked(status: number, body: string): boolean {
  if ([403, 429, 503].includes(status)) return true;
  const sample = (body || '').slice(0, 6000).toLowerCase();
  return (
    sample.includes('access denied')
    || sample.includes('request blocked')
    || sample.includes('captcha')
    || sample.includes('bot detection')
    || sample.includes('cloudflare')
    || sample.includes('verify you are human')
  );
}

export function buildJinaUrl(url: string): string {
  return `https://r.jina.ai/${url}`;
}
