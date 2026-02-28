import { describe, expect, it, vi } from 'vitest';
import { scrapeListingUrl } from './listingScraper.js';

function mockResponse(options: {
  body: string;
  url: string;
  status?: number;
  headers?: Record<string, string>;
}) {
  const headers = new Headers(options.headers || { 'content-type': 'text/html' });
  return {
    ok: (options.status || 200) >= 200 && (options.status || 200) < 300,
    status: options.status || 200,
    url: options.url,
    headers,
    text: async () => options.body,
  } as unknown as Response;
}

describe('listingScraper', () => {
  it('extracts and ranks product URLs from a listing page', async () => {
    const listingUrl = 'https://www.uline.com/Search/?query=tape';
    const html = `
      <html>
        <body>
          <a href="/Product/Detail/S-200/Carton-Sealing-Tape/Uline-Industrial-Tape">Tape</a>
          <a href="/account/login">Login</a>
          <a href="https://www.uline.com/Product/Detail/H-123/Boxes/Box">Box</a>
          <a href="https://other.com/p/1">Other</a>
        </body>
      </html>
    `;

    const fetchFn = vi.fn(async (url: string) => mockResponse({ body: html, url })) as unknown as typeof fetch;

    const result = await scrapeListingUrl(fetchFn, listingUrl, { maxUrls: 10 });

    expect(result.status).toBe('success');
    expect(result.productUrls.some(url => url.includes('/Product/Detail/S-200/'))).toBe(true);
    expect(result.productUrls.some(url => url.includes('/Product/Detail/H-123/'))).toBe(true);
    expect(result.productUrls.some(url => url.includes('/account/login'))).toBe(false);
    expect(result.productUrls.some(url => url.includes('other.com'))).toBe(false);
  });

  it('uses Jina fallback when the primary fetch is blocked', async () => {
    const listingUrl = 'https://www.uline.com/Search/?query=boxes';

    const fetchFn = vi.fn(async (url: string) => {
      if (url.startsWith('https://r.jina.ai/')) {
        return mockResponse({
          body: `<html><body><a href="/Product/Detail/H-999/Boxes/Test-Box">Test</a></body></html>`,
          url,
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }

      return mockResponse({
        body: '<html>captcha</html>',
        url,
        status: 403,
        headers: { 'content-type': 'text/html' },
      });
    }) as unknown as typeof fetch;

    const result = await scrapeListingUrl(fetchFn, listingUrl, { maxUrls: 10 });

    expect(result.usedJina).toBe(true);
    expect(result.message).toMatch(/Jina/i);
    expect(result.productUrls[0]).toContain('uline.com/Product/Detail/H-999');
  });
});

