import { Router, Request, Response, NextFunction } from 'express';
import { urlScraper } from '../services/urlScraper.js';

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

export { router as urlIngestionRouter };
