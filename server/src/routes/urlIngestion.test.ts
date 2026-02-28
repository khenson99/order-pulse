import express from 'express';
import { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockScrapeUrls = vi.fn();
const mockScrapeListingUrl = vi.fn();

vi.mock('../services/urlScraper.js', () => ({
  urlScraper: {
    scrapeUrls: mockScrapeUrls,
  },
}));

vi.mock('../services/listingScraper.js', () => ({
  scrapeListingUrl: mockScrapeListingUrl,
}));

async function startServer(sessionUserId?: string): Promise<{ server: Server; baseUrl: string }> {
  const { urlIngestionRouter } = await import('./urlIngestion.js');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = sessionUserId ? { userId: sessionUserId } : {};
    next();
  });
  app.use('/api/url-ingestion', urlIngestionRouter);

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

describe('urlIngestion routes', () => {
  let server: Server | null = null;
  let baseUrl = '';

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    ({ server, baseUrl } = await startServer('user-1'));
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((err) => (err ? reject(err) : resolve()));
      });
      server = null;
    }
  });

  it('requires authentication', async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((err) => (err ? reject(err) : resolve()));
      });
    }

    ({ server, baseUrl } = await startServer(undefined));

    const response = await fetch(`${baseUrl}/api/url-ingestion/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: ['https://example.com'] }),
    });

    expect(response.status).toBe(401);
  });

  it('rejects invalid request body', async () => {
    const response = await fetch(`${baseUrl}/api/url-ingestion/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: 'https://example.com' }),
    });

    expect(response.status).toBe(400);
    expect(mockScrapeUrls).not.toHaveBeenCalled();
  });

  it('enforces max URL limit of 50', async () => {
    const urls = Array.from({ length: 51 }, (_, idx) => `https://example.com/${idx}`);

    const response = await fetch(`${baseUrl}/api/url-ingestion/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls }),
    });

    expect(response.status).toBe(400);
    expect(mockScrapeUrls).not.toHaveBeenCalled();
  });

  it('returns mixed scrape results and normalized items', async () => {
    mockScrapeUrls.mockResolvedValue({
      requested: 2,
      processed: 2,
      results: [
        {
          sourceUrl: 'https://example.com/a',
          status: 'success',
          extractionSource: 'html-metadata',
          item: {
            sourceUrl: 'https://example.com/a',
            productUrl: 'https://example.com/a',
            itemName: 'Item A',
            supplier: 'Vendor A',
            needsReview: false,
            extractionSource: 'html-metadata',
            confidence: 0.7,
          },
        },
        {
          sourceUrl: 'https://example.com/b',
          status: 'failed',
          extractionSource: 'error',
          item: {
            sourceUrl: 'https://example.com/b',
            needsReview: true,
            extractionSource: 'error',
            confidence: 0,
          },
        },
      ],
      items: [
        {
          sourceUrl: 'https://example.com/a',
          productUrl: 'https://example.com/a',
          itemName: 'Item A',
          supplier: 'Vendor A',
          needsReview: false,
          extractionSource: 'html-metadata',
          confidence: 0.7,
        },
        {
          sourceUrl: 'https://example.com/b',
          needsReview: true,
          extractionSource: 'error',
          confidence: 0,
        },
      ],
    });

    const response = await fetch(`${baseUrl}/api/url-ingestion/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        urls: ['https://example.com/a', 'https://example.com/a', 'https://example.com/b'],
      }),
    });

    expect(response.status).toBe(200);
    expect(mockScrapeUrls).toHaveBeenCalledWith(['https://example.com/a', 'https://example.com/b']);

    const payload = await response.json() as {
      requested: number;
      processed: number;
      results: unknown[];
      items: unknown[];
    };

    expect(payload.requested).toBe(2);
    expect(payload.results).toHaveLength(2);
    expect(payload.items).toHaveLength(2);
  });

  it('scrapes product links from listing URLs', async () => {
    mockScrapeListingUrl.mockResolvedValue({
      listingUrl: 'https://example.com/list',
      normalizedUrl: 'https://example.com/list',
      status: 'success',
      productUrls: ['https://example.com/p/1', 'https://example.com/p/2'],
    });

    const response = await fetch(`${baseUrl}/api/url-ingestion/scrape-listing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/list', maxUrls: 25 }),
    });

    expect(response.status).toBe(200);
    expect(mockScrapeListingUrl).toHaveBeenCalledWith(expect.any(Function), 'https://example.com/list', { maxUrls: 25 });

    const payload = await response.json() as { productUrls: string[] };
    expect(payload.productUrls).toHaveLength(2);
  });

  it('validates listing scrape request body', async () => {
    const response = await fetch(`${baseUrl}/api/url-ingestion/scrape-listing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: '' }),
    });

    expect(response.status).toBe(400);
    expect(mockScrapeListingUrl).not.toHaveBeenCalled();
  });

  it('rejects non-positive maxUrls for listing scrape', async () => {
    const response = await fetch(`${baseUrl}/api/url-ingestion/scrape-listing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/list', maxUrls: 0 }),
    });

    expect(response.status).toBe(400);
    expect(mockScrapeListingUrl).not.toHaveBeenCalled();
  });
});
