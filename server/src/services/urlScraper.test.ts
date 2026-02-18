import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  extractAsinFromUrl: vi.fn(),
  enrichItemWithAmazon: vi.fn(),
  createAffiliateUrl: vi.fn((asin: string) => `https://www.amazon.com/dp/${asin}`),
}));

vi.mock('./amazon.js', () => ({
  amazonService: {
    extractAsinFromUrl: mocks.extractAsinFromUrl,
    enrichItemWithAmazon: mocks.enrichItemWithAmazon,
  },
  createAffiliateUrl: mocks.createAffiliateUrl,
}));

import { createUrlScraper, validatePublicHttpUrl } from './urlScraper.js';

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

describe('urlScraper', () => {
  beforeEach(() => {
    mocks.extractAsinFromUrl.mockReset();
    mocks.enrichItemWithAmazon.mockReset();
  });

  it('uses Amazon PAAPI enrichment for valid ASIN URLs', async () => {
    mocks.extractAsinFromUrl.mockReturnValue('B012345678');
    mocks.enrichItemWithAmazon.mockResolvedValue({
      ASIN: 'B012345678',
      ItemName: 'Shop Towels',
      Price: '$19.99',
      UnitPrice: 19.99,
      ImageURL: 'https://images.amazon.com/towel.jpg',
      AmazonURL: 'https://www.amazon.com/dp/B012345678?tag=arda06-20',
      UPC: '123456789012',
    });

    const scraper = createUrlScraper({
      fetchFn: vi.fn(async () => mockResponse({
        body: '<html><title>Amazon</title></html>',
        url: 'https://www.amazon.com/dp/B012345678',
      })) as unknown as typeof fetch,
      createModel: () => null as any,
    });

    const result = await scraper.scrapeUrls(['https://www.amazon.com/dp/B012345678']);

    expect(result.processed).toBe(1);
    expect(result.results[0].status).toBe('success');
    expect(result.results[0].item.asin).toBe('B012345678');
    expect(result.results[0].item.itemName).toBe('Shop Towels');
    expect(result.results[0].item.extractionSource).toBe('amazon-paapi');
  });

  it('resolves redirected Amazon short links before ASIN extraction', async () => {
    mocks.extractAsinFromUrl.mockImplementation((url: string) => (
      url.includes('/dp/B099999999') ? 'B099999999' : null
    ));
    mocks.enrichItemWithAmazon.mockResolvedValue({
      ASIN: 'B099999999',
      ItemName: 'Cordless Drill',
      UnitPrice: 129.0,
      AmazonURL: 'https://www.amazon.com/dp/B099999999?tag=arda06-20',
      ImageURL: 'https://images.amazon.com/drill.jpg',
    });

    const scraper = createUrlScraper({
      fetchFn: vi.fn(async () => mockResponse({
        body: '<html></html>',
        url: 'https://www.amazon.com/dp/B099999999',
      })) as unknown as typeof fetch,
      createModel: () => null as any,
    });

    const result = await scraper.scrapeUrls(['https://amzn.to/abc']);

    expect(result.results[0].item.asin).toBe('B099999999');
    expect(result.results[0].status).toBe('success');
  });

  it('extracts non-Amazon product data from JSON-LD without AI fallback', async () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Product",
              "name": "Industrial Gloves",
              "description": "Heavy duty nitrile gloves",
              "sku": "GLV-100",
              "brand": { "@type": "Brand", "name": "SafeCo" },
              "image": "https://example.com/glove.jpg",
              "offers": { "@type": "Offer", "price": "24.50", "priceCurrency": "USD" }
            }
          </script>
        </head>
        <body><h1>Industrial Gloves</h1></body>
      </html>
    `;

    const scraper = createUrlScraper({
      fetchFn: vi.fn(async () => mockResponse({
        body: html,
        url: 'https://example.com/products/gloves',
      })) as unknown as typeof fetch,
      createModel: () => ({
        generateContent: vi.fn(async () => ({ response: { text: () => '{}' } })),
      }),
    });

    const result = await scraper.scrapeUrls(['https://example.com/products/gloves']);
    const item = result.results[0].item;

    expect(item.itemName).toBe('Industrial Gloves');
    expect(item.supplier).toBe('SafeCo');
    expect(item.price).toBe(24.5);
    expect(item.vendorSku).toBe('GLV-100');
    expect(result.results[0].extractionSource).toBe('html-metadata');
  });

  it('uses AI fallback when deterministic extraction is missing key fields', async () => {
    const model = {
      generateContent: vi.fn(async () => ({
        response: {
          text: () => JSON.stringify({
            itemName: 'AI Parsed Item',
            supplier: 'Acme Corp',
            price: 89.99,
            currency: 'USD',
            description: 'AI description',
            vendorSku: 'ACME-99',
            imageUrl: 'https://example.com/ai-image.jpg',
          }),
        },
      })),
    };

    const scraper = createUrlScraper({
      fetchFn: vi.fn(async () => mockResponse({
        body: '<html><head><title>Product page</title></head><body>Minimal content</body></html>',
        url: 'https://supplier.com/item/99',
      })) as unknown as typeof fetch,
      createModel: () => model,
    });

    const result = await scraper.scrapeUrls(['https://supplier.com/item/99']);

    expect(model.generateContent).toHaveBeenCalled();
    expect(result.results[0].item.itemName).toBe('AI Parsed Item');
    expect(result.results[0].item.vendorSku).toBe('ACME-99');
    expect(result.results[0].extractionSource).toBe('hybrid-ai');
  });

  it('returns per-URL failures without failing the whole batch', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('bad.example')) {
        throw new Error('timeout');
      }
      return mockResponse({
        body: '<html><head><meta property="og:title" content="Good Item"/></head></html>',
        url,
      });
    }) as unknown as typeof fetch;

    const scraper = createUrlScraper({
      fetchFn,
      createModel: () => null as any,
    });

    const result = await scraper.scrapeUrls([
      'https://bad.example/item',
      'https://good.example/item',
    ]);

    expect(result.processed).toBe(2);
    expect(result.results.some(entry => entry.status === 'failed')).toBe(true);
    expect(result.results.some(entry => entry.status !== 'failed')).toBe(true);
  });

  it('rejects local/private URLs via validation guard', () => {
    expect(validatePublicHttpUrl('http://127.0.0.1:8080').valid).toBe(false);
    expect(validatePublicHttpUrl('http://localhost/test').valid).toBe(false);
    expect(validatePublicHttpUrl('https://192.168.1.2').valid).toBe(false);
    expect(validatePublicHttpUrl('https://example.com').valid).toBe(true);
  });
});
