import { Router, Request, Response, NextFunction } from 'express';
import { urlScraper } from '../services/urlScraper.js';
import { scrapeListingUrl } from '../services/listingScraper.js';

const router = Router();

async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

router.post('/scrape', requireAuth, async (req: Request, res: Response) => {
  try {
    const { urls } = req.body as { urls?: unknown };

    if (!Array.isArray(urls)) {
      return res.status(400).json({ error: 'urls must be an array of strings' });
    }

    const deduped = Array.from(
      new Set(
        urls
          .filter((url): url is string => typeof url === 'string')
          .map(url => url.trim())
          .filter(Boolean)
      )
    );

    if (deduped.length === 0) {
      return res.status(400).json({ error: 'At least one URL is required' });
    }

    if (deduped.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 URLs are allowed per request' });
    }

    const scraped = await urlScraper.scrapeUrls(deduped);
    res.json(scraped);
  } catch (error) {
    console.error('URL scraping error:', error);
    res.status(500).json({ error: 'Failed to scrape URLs' });
  }
});

router.post('/scrape-listing', requireAuth, async (req: Request, res: Response) => {
  try {
    const { url, maxUrls } = req.body as { url?: unknown; maxUrls?: unknown };
    if (typeof url !== 'string' || !url.trim()) {
      return res.status(400).json({ error: 'url must be a non-empty string' });
    }

    const parsedMax = typeof maxUrls === 'number' ? maxUrls : Number.parseInt(String(maxUrls || ''), 10);
    const effectiveMax = Number.isFinite(parsedMax) ? parsedMax : undefined;

    const result = await scrapeListingUrl(fetch, url.trim(), { maxUrls: effectiveMax });
    res.json(result);
  } catch (error) {
    console.error('Listing scraping error:', error);
    res.status(500).json({ error: 'Failed to scrape listing URL' });
  }
});

export { router as urlIngestionRouter };
