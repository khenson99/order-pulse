import { Router, Request, Response, NextFunction } from 'express';
import redisClient from '../utils/redisClient.js';
import { requireRedis } from '../config.js';
import { appLogger } from '../middleware/requestLogger.js';
import { lookupProductByBarcode } from '../services/barcodeLookup.js';

const router = Router();

// Constants
const SESSION_TTL = 24 * 60 * 60; // 24 hours in seconds
const MAX_BARCODES_PER_SESSION = 500;
const MAX_BARCODE_LENGTH = 50;
const REDIS_PREFIX = 'scan:session:';

// Types
interface ScannedBarcode {
  id: string;
  barcode: string;
  barcodeType: string;
  scannedAt: string;
  source: 'desktop' | 'mobile';
  productName?: string;
  brand?: string;
  imageUrl?: string;
  category?: string;
}

interface ScanSession {
  barcodes: ScannedBarcode[];
  createdAt: string;
  lastActivity: string;
  userId?: string;
}

// In-memory fallback when Redis is not available
const memoryStore = new Map<string, ScanSession>();

// Validate session ID format (alphanumeric with dashes)
const isValidSessionId = (sessionId: string): boolean => {
  return /^[a-zA-Z0-9-_]{10,64}$/.test(sessionId);
};

// Validate barcode format
const isValidBarcode = (barcode: string): boolean => {
  if (!barcode || typeof barcode !== 'string') return false;
  if (barcode.length > MAX_BARCODE_LENGTH) return false;
  // Allow alphanumeric barcodes
  return /^[a-zA-Z0-9-]+$/.test(barcode);
};

// Get session from Redis or memory
const getSession = async (sessionId: string): Promise<ScanSession> => {
  if (redisClient) {
    try {
      const data = await redisClient.get(`${REDIS_PREFIX}${sessionId}`);
      if (data) {
        return JSON.parse(data);
      }
    } catch (error) {
      appLogger.error({ err: error }, 'Redis get error');
    }
  }
  
  // Fallback to memory
  const session = memoryStore.get(sessionId);
  if (session) return session;
  
  // Create new session
  const newSession: ScanSession = {
    barcodes: [],
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
  };
  
  return newSession;
};

// Save session to Redis or memory
const saveSession = async (sessionId: string, session: ScanSession): Promise<void> => {
  session.lastActivity = new Date().toISOString();
  
  if (redisClient) {
    try {
      await redisClient.setex(
        `${REDIS_PREFIX}${sessionId}`,
        SESSION_TTL,
        JSON.stringify(session)
      );
      return;
    } catch (error) {
      appLogger.error({ err: error }, 'Redis set error');
    }
  }
  
  // Fallback to memory
  memoryStore.set(sessionId, session);
  
  // Clean up old memory sessions periodically
  if (memoryStore.size > 1000) {
    const now = Date.now();
    for (const [id, sess] of memoryStore.entries()) {
      if (now - new Date(sess.lastActivity).getTime() > SESSION_TTL * 1000) {
        memoryStore.delete(id);
      }
    }
  }
};

// Session ID validation middleware
const validateSessionId = (req: Request, res: Response, next: NextFunction) => {
  const { sessionId } = req.params;
  if (!isValidSessionId(sessionId)) {
    return res.status(400).json({ error: 'Invalid session ID format' });
  }
  next();
};

const ensureRedis = (res: Response): boolean => {
  if (requireRedis && !redisClient) {
    res.status(503).json({ error: 'Redis unavailable; scanning sessions require persistent storage' });
    return false;
  }
  return true;
};

/**
 * GET /api/scan/session/:sessionId/barcodes
 * Get all barcodes for a session (used by desktop to poll for mobile scans)
 */
router.get('/session/:sessionId/barcodes', validateSessionId, async (req: Request, res: Response) => {
  try {
    if (!ensureRedis(res)) return;
    const { sessionId } = req.params;
    const { since } = req.query;
    
    const session = await getSession(sessionId);
    let barcodes = session.barcodes;
    
    // Filter by timestamp if provided
    if (since && typeof since === 'string') {
      const sinceDate = new Date(since);
      if (!isNaN(sinceDate.getTime())) {
        barcodes = barcodes.filter(b => new Date(b.scannedAt) > sinceDate);
      }
    }
    
    res.json({ 
      barcodes,
      sessionCreatedAt: session.createdAt,
      totalCount: session.barcodes.length,
    });
  } catch (error) {
    appLogger.error({ err: error }, 'Get barcodes error');
    res.status(500).json({ error: 'Failed to retrieve barcodes' });
  }
});

/**
 * POST /api/scan/session/:sessionId/barcode
 * Add a barcode to a session (used by mobile scanner)
 */
router.post('/session/:sessionId/barcode', validateSessionId, async (req: Request, res: Response) => {
  try {
    if (!ensureRedis(res)) return;
    const { sessionId } = req.params;
    const { id, data, timestamp, barcodeType } = req.body;
    
    // Validate input
    if (!data || typeof data !== 'string') {
      return res.status(400).json({ error: 'Barcode data is required' });
    }
    
    const cleanBarcode = data.trim();
    if (!isValidBarcode(cleanBarcode)) {
      return res.status(400).json({ error: 'Invalid barcode format' });
    }
    
    const session = await getSession(sessionId);
    
    // Check session limits
    if (session.barcodes.length >= MAX_BARCODES_PER_SESSION) {
      return res.status(429).json({ 
        error: 'Session barcode limit reached',
        limit: MAX_BARCODES_PER_SESSION,
      });
    }
    
    // Check for duplicates
    if (session.barcodes.some(b => b.barcode === cleanBarcode)) {
      return res.json({ success: true, duplicate: true });
    }
    
    // Look up product info (cached, with timeout)
    const productInfo = await lookupProductByBarcode(cleanBarcode, { timeoutMs: 5000 });
    
    const barcode: ScannedBarcode = {
      id: id || `scan-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      barcode: cleanBarcode,
      barcodeType: barcodeType || detectBarcodeType(cleanBarcode),
      scannedAt: timestamp || new Date().toISOString(),
      source: 'mobile',
      productName: productInfo?.name,
      brand: productInfo?.brand,
      imageUrl: productInfo?.imageUrl,
      category: productInfo?.category,
    };
    
    session.barcodes.push(barcode);
    await saveSession(sessionId, session);
    
    appLogger.info(`Barcode scanned: ${cleanBarcode} in session ${sessionId.substring(0, 8)}...`);
    
    res.json({ success: true, barcode });
  } catch (error) {
    appLogger.error({ err: error }, 'Add barcode error');
    res.status(500).json({ error: 'Failed to save barcode' });
  }
});

/**
 * GET /api/barcode/lookup
 * Look up product information from a barcode
 */
router.get('/lookup', async (req: Request, res: Response) => {
  const { code } = req.query;
  
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Barcode code is required' });
  }
  
  const cleanCode = code.trim();
  if (!isValidBarcode(cleanCode)) {
    return res.status(400).json({ error: 'Invalid barcode format' });
  }
  
  try {
    const productInfo = await lookupProductByBarcode(cleanCode, { timeoutMs: 5000 });
    if (productInfo?.name) return res.json(productInfo);
    return res.status(404).json({ error: 'Product not found' });
  } catch (error) {
    appLogger.error({ err: error }, 'Barcode lookup error');
    res.status(500).json({ error: 'Lookup failed' });
  }
});

/**
 * Detect barcode type from string
 */
function detectBarcodeType(barcode: string): string {
  const digits = barcode.replace(/\D/g, '');
  if (digits.length === 12) return 'UPC-A';
  if (digits.length === 13) return 'EAN-13';
  if (digits.length === 8) return 'EAN-8';
  if (digits.length === 14) return 'GTIN-14';
  return 'unknown';
}

export default router;
