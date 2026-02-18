import { Router, Request, Response } from 'express';
import {
  analyzeEmailWithRetry,
  createGeminiExtractionModel,
  delay,
  EmailExtractionInput,
} from '../services/emailExtraction.js';

const router = Router();

// Middleware to require authentication
function requireAuth(req: Request, res: Response, next: Function) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

// Analyze email with Gemini AI
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { emails } = req.body;

    if (!Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ error: 'Missing emails array' });
    }

    console.log(`🧠 Analyzing ${emails.length} emails with Gemini AI...`);

    const model = createGeminiExtractionModel();

    // Process emails sequentially to avoid rate limits
    const results: unknown[] = [];
    for (let i = 0; i < emails.length; i++) {
      const email = emails[i] as EmailExtractionInput;
      const result = await analyzeEmailWithRetry(model as any, email);
      results.push(result);

      // Small delay between requests to avoid rate limiting
      if (i < emails.length - 1) {
        await delay(100);
      }
    }

    console.log(`✅ Analyzed ${results.length} emails`);
    res.json({ results });
  } catch (error: any) {
    console.error('Gemini analysis error:', error);
    res.status(500).json({ error: 'Failed to analyze emails' });
  }
});

export { router as analysisRouter };
