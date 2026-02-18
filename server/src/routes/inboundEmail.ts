import { Request, Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  enqueuePostmarkInboundReceipt,
  getInboundReceiptStatus,
  PostmarkInboundPayload,
} from '../services/inboundReceiptWorker.js';

const router = Router();

const inboundLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many inbound requests. Please retry shortly.' },
});

function parseBasicAuthHeader(authHeader: string): { username: string; password: string } | null {
  if (!authHeader.startsWith('Basic ')) return null;
  const encoded = authHeader.slice('Basic '.length);
  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    const separator = decoded.indexOf(':');
    if (separator === -1) return null;
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

function requireInboundAuth(req: Request, res: Response, next: () => void): void {
  const expectedUsername = process.env.POSTMARK_INBOUND_USERNAME;
  const expectedPassword = process.env.POSTMARK_INBOUND_PASSWORD;

  if (!expectedUsername || !expectedPassword) {
    res.status(503).json({ error: 'Inbound webhook credentials are not configured' });
    return;
  }

  const authHeader = req.headers.authorization || '';
  const parsed = parseBasicAuthHeader(authHeader);
  if (!parsed || parsed.username !== expectedUsername || parsed.password !== expectedPassword) {
    res.setHeader('WWW-Authenticate', 'Basic realm="orderpulse-inbound"');
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

router.post('/postmark', inboundLimiter, requireInboundAuth, async (req: Request, res: Response) => {
  try {
    const payload = req.body as PostmarkInboundPayload;
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    const result = await enqueuePostmarkInboundReceipt(payload);
    res.status(202).json({
      accepted: true,
      eventId: result.eventId,
      duplicate: result.duplicate,
      status: result.status,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to enqueue inbound receipt';
    if (message.toLowerCase().includes('invalid postmark payload')) {
      return res.status(400).json({ error: message });
    }
    console.error('Inbound webhook error:', error);
    res.status(500).json({ error: 'Failed to process inbound webhook' });
  }
});

router.get('/status/:eventId', requireInboundAuth, async (req: Request, res: Response) => {
  try {
    const status = await getInboundReceiptStatus(req.params.eventId);
    if (!status) {
      return res.status(404).json({ error: 'Inbound event not found' });
    }
    res.json(status);
  } catch (error) {
    console.error('Inbound status lookup error:', error);
    res.status(500).json({ error: 'Failed to load inbound event status' });
  }
});

export default router;
