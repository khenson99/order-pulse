import { describe, it, expect, vi } from "vitest";
import { ApiError } from "../types";
import { cleanUrlCandidate, extractUrlMetadata, scrapeUrls } from "../lib/url-scraper";

describe("url scraper", () => {
  it("rejects localhost URLs", () => {
    expect(() => cleanUrlCandidate("http://localhost/test")).toThrow(ApiError);
  });

  it("extracts basic metadata from HTML", () => {
    const html = `
      <html>
        <head>
          <title>Example Product</title>
          <meta property="og:image" content="https://example.com/img.png" />
          <meta name="description" content="A great product" />
          <link rel="canonical" href="https://shop.example.com/p/123" />
        </head>
        <body>
          <h1>Example Product Name</h1>
        </body>
      </html>
    `;

    const item = extractUrlMetadata(html, "https://shop.example.com/p/123?ref=abc");
    expect(item.itemName).toBeTruthy();
    expect(item.productUrl).toBe("https://shop.example.com/p/123");
    expect(item.imageUrl).toBe("https://example.com/img.png");
    expect(item.needsReview).toBeTypeOf("boolean");
    expect(item.confidence).toBeGreaterThan(0);
  });

  it("enforces 50 URL max", async () => {
    const urls = Array.from({ length: 51 }, (_, i) => `https://example.com/${i}`);
    await expect(scrapeUrls(urls)).rejects.toBeInstanceOf(ApiError);
  });

  it("scrapes via injected fetchFn", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        `<html><head><title>One</title></head><body><h1>One</h1></body></html>`,
        { status: 200, headers: { "content-type": "text/html" } },
      ),
    );

    const result = await scrapeUrls(["https://example.com/p/1"], { fetchFn });
    expect(result.processed).toBe(1);
    expect(result.results[0]?.status).not.toBe("failed");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

