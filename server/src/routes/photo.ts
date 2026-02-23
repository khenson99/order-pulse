import { Router, Request, Response, NextFunction } from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import redisClient from '../utils/redisClient.js';
import { requireRedis } from '../config.js';
import { appLogger } from '../middleware/requestLogger.js';

const router = Router();

// Constants
const SESSION_TTL = 24 * 60 * 60; // 24 hours in seconds
const IMAGE_TTL = 30 * 24 * 60 * 60; // 30 days for uploaded images
const MAX_PHOTOS_PER_SESSION = 100;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const REDIS_PREFIX = 'photo:session:';
const PHOTO_DATA_PREFIX = 'photo:data:';
const IMAGE_UPLOAD_PREFIX = 'image:upload:';

// Initialize Gemini with error handling
let genAI: GoogleGenerativeAI | null = null;
if (process.env.GEMINI_API_KEY) {
  genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
} else {
  appLogger.warn('GEMINI_API_KEY not set - photo analysis will be disabled');
}

// Types
interface PhotoMetadata {
  id: string;
  capturedAt: string;
  source: 'desktop' | 'mobile';
  extractedText?: string[];
  detectedBarcodes?: string[];
  suggestedName?: string;
  suggestedSupplier?: string;
  isInternalItem?: boolean;
  analyzed: boolean;
  imageSizeBytes?: number;
  manualEditsAt?: string;
}

// CapturedPhoto interface extends PhotoMetadata with image data
// interface CapturedPhoto extends PhotoMetadata {
//   imageData: string; // Base64 data URL
// }

interface PhotoSession {
  photoIds: string[]; // Just store IDs, actual data stored separately
  metadata: Record<string, PhotoMetadata>;
  createdAt: string;
  lastActivity: string;
  userId?: string;
}

// In-memory fallback
const memoryStore = new Map<string, PhotoSession>();
const memoryPhotoData = new Map<string, string>();

// Validate session ID format
const isValidSessionId = (sessionId: string): boolean => {
  return /^[a-zA-Z0-9-_]{10,64}$/.test(sessionId);
};

// Validate image data
const isValidImageData = (data: string): { valid: boolean; sizeBytes: number; error?: string } => {
  if (!data || typeof data !== 'string') {
    return { valid: false, sizeBytes: 0, error: 'Image data is required' };
  }
  
  if (!data.startsWith('data:image/')) {
    return { valid: false, sizeBytes: 0, error: 'Invalid image format - must be data URL' };
  }
  
  // Estimate base64 size
  const base64Part = data.split(',')[1];
  if (!base64Part) {
    return { valid: false, sizeBytes: 0, error: 'Invalid data URL format' };
  }
  
  const sizeBytes = Math.ceil(base64Part.length * 0.75);
  if (sizeBytes > MAX_IMAGE_SIZE) {
    return { valid: false, sizeBytes, error: `Image too large (${Math.round(sizeBytes / 1024 / 1024)}MB, max ${MAX_IMAGE_SIZE / 1024 / 1024}MB)` };
  }
  
  return { valid: true, sizeBytes };
};

const sanitizeOptionalText = (value: unknown, maxLength: number): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
};

const sanitizeOptionalStringArray = (
  value: unknown,
  maxItems: number,
  maxItemLength: number,
): string[] | undefined => {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) return undefined;

  const cleaned = value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : String(entry).trim()))
    .filter(Boolean)
    .slice(0, maxItems)
    .map((entry) => entry.slice(0, maxItemLength));

  return cleaned.length > 0 ? cleaned : undefined;
};

// Get session from Redis or memory
const getSession = async (sessionId: string): Promise<PhotoSession> => {
  if (redisClient) {
    try {
      const data = await redisClient.get(`${REDIS_PREFIX}${sessionId}`);
      if (data) {
        return JSON.parse(data);
      }
    } catch (error) {
      appLogger.error({ err: error }, 'Redis get session error');
    }
  }
  
  const session = memoryStore.get(sessionId);
  if (session) return session;
  
  return {
    photoIds: [],
    metadata: {},
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
  };
};

// Save session to Redis or memory
const saveSession = async (sessionId: string, session: PhotoSession): Promise<void> => {
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
      appLogger.error({ err: error }, 'Redis set session error');
    }
  }
  
  memoryStore.set(sessionId, session);
};

// Get photo data from Redis or memory
const getPhotoData = async (photoId: string): Promise<string | null> => {
  if (redisClient) {
    try {
      return await redisClient.get(`${PHOTO_DATA_PREFIX}${photoId}`);
    } catch (error) {
      appLogger.error({ err: error }, 'Redis get photo error');
    }
  }
  return memoryPhotoData.get(photoId) || null;
};

// Save photo data to Redis or memory
const savePhotoData = async (photoId: string, imageData: string): Promise<void> => {
  if (redisClient) {
    try {
      await redisClient.setex(
        `${PHOTO_DATA_PREFIX}${photoId}`,
        SESSION_TTL,
        imageData
      );
      return;
    } catch (error) {
      appLogger.error({ err: error }, 'Redis set photo error');
    }
  }
  
  memoryPhotoData.set(photoId, imageData);
  
  // Cleanup old photos from memory if too many
  if (memoryPhotoData.size > 500) {
    const keys = Array.from(memoryPhotoData.keys());
    for (let i = 0; i < 100; i++) {
      memoryPhotoData.delete(keys[i]);
    }
  }
};

const ensureRedis = (res: Response): boolean => {
  if (requireRedis && !redisClient) {
    res.status(503).json({ error: 'Redis unavailable; photo sessions require persistent storage' });
    return false;
  }
  return true;
};

// Session ID validation middleware
const validateSessionId = (req: Request, res: Response, next: NextFunction) => {
  const { sessionId } = req.params;
  if (!isValidSessionId(sessionId)) {
    return res.status(400).json({ error: 'Invalid session ID format' });
  }
  next();
};

/**
 * GET /api/photo/session/:sessionId/photos
 * Get all photos for a session (used by desktop to poll for mobile captures)
 */
router.get('/session/:sessionId/photos', validateSessionId, async (req: Request, res: Response) => {
  try {
    if (!ensureRedis(res)) return;
    const { sessionId } = req.params;
    const { since } = req.query;
    
    const session = await getSession(sessionId);
    
    let photoMetadata = Object.values(session.metadata);
    
    // Filter by timestamp if provided
    if (since && typeof since === 'string') {
      const sinceDate = new Date(since);
      if (!isNaN(sinceDate.getTime())) {
        photoMetadata = photoMetadata.filter(p => new Date(p.capturedAt) > sinceDate);
      }
    }
    
    // Return metadata only (no image data) for listing
    const photos = photoMetadata.map(p => ({
      ...p,
      hasFullImage: true,
    }));
    
    res.json({ 
      photos,
      sessionCreatedAt: session.createdAt,
      totalCount: session.photoIds.length,
    });
  } catch (error) {
    appLogger.error({ err: error }, 'Get photos error');
    res.status(500).json({ error: 'Failed to retrieve photos' });
  }
});

/**
 * GET /api/photo/session/:sessionId/photo/:photoId
 * Get full photo data by ID
 */
router.get('/session/:sessionId/photo/:photoId', validateSessionId, async (req: Request, res: Response) => {
  try {
    if (!ensureRedis(res)) return;
    const { sessionId, photoId } = req.params;
    
    const session = await getSession(sessionId);
    const metadata = session.metadata[photoId];
    
    if (!metadata) {
      return res.status(404).json({ error: 'Photo not found' });
    }
    
    const imageData = await getPhotoData(photoId);
    if (!imageData) {
      return res.status(404).json({ error: 'Photo data not found' });
    }
    
    res.json({ 
      photo: {
        ...metadata,
        imageData,
      }
    });
  } catch (error) {
    appLogger.error({ err: error }, 'Get photo error');
    res.status(500).json({ error: 'Failed to retrieve photo' });
  }
});

/**
 * POST /api/photo/session/:sessionId/photo
 * Add a photo to a session (used by mobile capture)
 */
router.post('/session/:sessionId/photo', validateSessionId, async (req: Request, res: Response) => {
  try {
    if (!ensureRedis(res)) return;
    const { sessionId } = req.params;
    const { id, data, timestamp, source } = req.body;
    
    // Validate image data
    const validation = isValidImageData(data);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }
    
    const session = await getSession(sessionId);
    
    // Check session limits
    if (session.photoIds.length >= MAX_PHOTOS_PER_SESSION) {
      return res.status(429).json({ 
        error: 'Session photo limit reached',
        limit: MAX_PHOTOS_PER_SESSION,
      });
    }
    
    const photoId = id || `photo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Create metadata entry
    const metadata: PhotoMetadata = {
      id: photoId,
      capturedAt: timestamp || new Date().toISOString(),
      source: source === 'desktop' ? 'desktop' : 'mobile',
      analyzed: false,
      imageSizeBytes: validation.sizeBytes,
    };
    
    // Store photo data separately
    await savePhotoData(photoId, data);
    
    // Update session
    session.photoIds.push(photoId);
    session.metadata[photoId] = metadata;
    await saveSession(sessionId, session);
    
    appLogger.info(`Photo captured: ${photoId} in session ${sessionId.substring(0, 8)}... (${Math.round(validation.sizeBytes / 1024)}KB)`);
    
    // Analyze in background
    analyzePhotoAsync(sessionId, photoId, data).catch(error => {
      appLogger.error('Background photo analysis failed:', error);
    });
    
    res.json({ success: true, photoId });
  } catch (error) {
    appLogger.error({ err: error }, 'Add photo error');
    res.status(500).json({ error: 'Failed to save photo' });
  }
});

/**
 * PUT /api/photo/session/:sessionId/photo/:photoId
 * Update analyzed metadata fields for a photo
 */
router.put('/session/:sessionId/photo/:photoId', validateSessionId, async (req: Request, res: Response) => {
  try {
    if (!ensureRedis(res)) return;
    const { sessionId, photoId } = req.params;
    const session = await getSession(sessionId);
    const metadata = session.metadata[photoId];

    if (!metadata) {
      return res.status(404).json({ error: 'Photo not found' });
    }

    const nextMetadata: PhotoMetadata = { ...metadata };
    const hasSuggestedName = Object.prototype.hasOwnProperty.call(req.body, 'suggestedName');
    const hasSuggestedSupplier = Object.prototype.hasOwnProperty.call(req.body, 'suggestedSupplier');
    const hasDetectedBarcodes = Object.prototype.hasOwnProperty.call(req.body, 'detectedBarcodes');
    const hasExtractedText = Object.prototype.hasOwnProperty.call(req.body, 'extractedText');
    const hasInternalItem = Object.prototype.hasOwnProperty.call(req.body, 'isInternalItem');

    if (hasSuggestedName) {
      nextMetadata.suggestedName = sanitizeOptionalText(req.body.suggestedName, 100);
    }
    if (hasSuggestedSupplier) {
      nextMetadata.suggestedSupplier = sanitizeOptionalText(req.body.suggestedSupplier, 100);
    }
    if (hasDetectedBarcodes) {
      nextMetadata.detectedBarcodes = sanitizeOptionalStringArray(req.body.detectedBarcodes, 20, 50);
    }
    if (hasExtractedText) {
      nextMetadata.extractedText = sanitizeOptionalStringArray(req.body.extractedText, 30, 200);
    }
    if (hasInternalItem) {
      if (req.body.isInternalItem === null || req.body.isInternalItem === undefined) {
        nextMetadata.isInternalItem = undefined;
      } else if (typeof req.body.isInternalItem === 'boolean') {
        nextMetadata.isInternalItem = req.body.isInternalItem;
      } else {
        return res.status(400).json({ error: 'isInternalItem must be a boolean or null' });
      }
    }

    nextMetadata.analyzed = true;
    nextMetadata.manualEditsAt = new Date().toISOString();
    session.metadata[photoId] = nextMetadata;
    await saveSession(sessionId, session);

    res.json({ success: true, photo: nextMetadata });
  } catch (error) {
    appLogger.error({ err: error }, 'Update photo metadata error');
    res.status(500).json({ error: 'Failed to update photo metadata' });
  }
});

/**
 * POST /api/photo/analyze
 * Analyze an image to extract text, barcodes, and suggest product info
 */
router.post('/analyze', async (req: Request, res: Response) => {
  const { imageData } = req.body;
  
  // Validate image data
  const validation = isValidImageData(imageData);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }
  
  if (!genAI) {
    return res.status(503).json({ error: 'Image analysis service not configured' });
  }
  
  try {
    const analysis = await analyzeImage(imageData);
    res.json(analysis);
  } catch (error) {
    appLogger.error({ err: error }, 'Image analysis error');
    res.status(500).json({ error: 'Analysis failed' });
  }
});

/**
 * Analyze photo asynchronously and update the stored session metadata
 */
async function analyzePhotoAsync(sessionId: string, photoId: string, imageData: string): Promise<void> {
  if (!genAI) {
    appLogger.warn('Skipping photo analysis - Gemini not configured');
    try {
      const session = await getSession(sessionId);
      const existing = session.metadata[photoId];
      if (existing && !existing.analyzed) {
        session.metadata[photoId] = {
          ...existing,
          analyzed: true,
        };
        await saveSession(sessionId, session);
      }
    } catch (error) {
      appLogger.error({ err: error }, 'Failed to mark photo analyzed');
    }
    return;
  }
  
  try {
    const analysis = await analyzeImage(imageData);
    
    // Update session metadata with analysis results
    const session = await getSession(sessionId);
    if (session.metadata[photoId]) {
      const existing = session.metadata[photoId];
      const hasManualEdits = Boolean(existing.manualEditsAt);
      session.metadata[photoId] = {
        ...existing,
        extractedText: hasManualEdits ? (existing.extractedText ?? analysis.extractedText) : analysis.extractedText,
        detectedBarcodes: hasManualEdits ? (existing.detectedBarcodes ?? analysis.detectedBarcodes) : analysis.detectedBarcodes,
        suggestedName: hasManualEdits ? (existing.suggestedName ?? analysis.suggestedName) : analysis.suggestedName,
        suggestedSupplier: hasManualEdits ? (existing.suggestedSupplier ?? analysis.suggestedSupplier) : analysis.suggestedSupplier,
        isInternalItem: hasManualEdits ? (existing.isInternalItem ?? analysis.isInternalItem) : analysis.isInternalItem,
        analyzed: true,
      };
      await saveSession(sessionId, session);
      appLogger.info(`Photo analyzed: ${photoId} - "${analysis.suggestedName || 'unknown'}"`);
    }
  } catch (error) {
    appLogger.error({ err: error }, 'Async photo analysis error');
    try {
      const session = await getSession(sessionId);
      const existing = session.metadata[photoId];
      if (existing && !existing.analyzed) {
        session.metadata[photoId] = {
          ...existing,
          analyzed: true,
        };
        await saveSession(sessionId, session);
      }
    } catch (markError) {
      appLogger.error({ err: markError }, 'Failed to mark photo analyzed after analysis error');
    }
  }
}

// Analysis result type
interface AnalysisResult {
  extractedText?: string[];
  detectedBarcodes?: string[];
  suggestedName?: string;
  suggestedSupplier?: string;
  isInternalItem?: boolean;
}

// Rate limiting for Gemini API
let lastAnalysisTime = 0;
const MIN_ANALYSIS_INTERVAL = 500; // ms between calls

/**
 * Analyze an image using Gemini Vision
 */
async function analyzeImage(imageData: string): Promise<AnalysisResult> {
  if (!genAI) {
    throw new Error('Gemini API not configured');
  }
  
  // Simple rate limiting
  const now = Date.now();
  const timeSinceLastCall = now - lastAnalysisTime;
  if (timeSinceLastCall < MIN_ANALYSIS_INTERVAL) {
    await new Promise(resolve => setTimeout(resolve, MIN_ANALYSIS_INTERVAL - timeSinceLastCall));
  }
  lastAnalysisTime = Date.now();
  
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    
    // Extract base64 data from data URL
    const base64Match = imageData.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!base64Match) {
      throw new Error('Invalid image data format');
    }
    
    const imageType = base64Match[1];
    const base64Data = base64Match[2];
    const mimeType = `image/${imageType}`;
    
    const prompt = `Analyze this image of a product or item for inventory management. Extract:

1. **Visible Text**: All readable text on packaging, labels, or product
2. **Barcodes**: Any UPC, EAN, or other barcodes (numbers only if readable)
3. **Product Name**: A concise, shop-floor friendly name (max 50 chars, no brand)
4. **Supplier/Brand**: The manufacturer, brand, or supplier name
5. **Item Type**: Is this:
   - "external" (commercially purchased with retail packaging)
   - "internal" (internally produced, handwritten labels, custom markings)

Respond ONLY with valid JSON:
{
  "extractedText": ["text1", "text2"],
  "detectedBarcodes": ["123456789012"],
  "suggestedName": "Concise Product Name",
  "suggestedSupplier": "Brand Name",
  "isInternalItem": false
}

Omit fields that cannot be determined.`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType,
          data: base64Data,
        },
      },
    ]);

    const response = result.response;
    const text = response.text();
    
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        
        // Sanitize and validate response
        return {
          extractedText: Array.isArray(parsed.extractedText) 
            ? parsed.extractedText.slice(0, 20).map((t: unknown) => String(t).substring(0, 200))
            : undefined,
          detectedBarcodes: Array.isArray(parsed.detectedBarcodes)
            ? parsed.detectedBarcodes.slice(0, 10).map((b: unknown) => String(b).replace(/\D/g, '').substring(0, 20))
            : undefined,
          suggestedName: typeof parsed.suggestedName === 'string' 
            ? parsed.suggestedName.substring(0, 100) 
            : undefined,
          suggestedSupplier: typeof parsed.suggestedSupplier === 'string'
            ? parsed.suggestedSupplier.substring(0, 100)
            : undefined,
          isInternalItem: typeof parsed.isInternalItem === 'boolean' 
            ? parsed.isInternalItem 
            : undefined,
        };
      } catch {
        appLogger.warn({ responseText: text.substring(0, 200) }, 'Failed to parse Gemini response JSON');
        return {};
      }
    }
    
    appLogger.warn({ responseText: text.substring(0, 200) }, 'No JSON found in Gemini response');
    return {};
  } catch (error: any) {
    // Check for rate limiting
    if (error?.status === 429 || error?.message?.includes('rate')) {
      appLogger.warn('Gemini rate limited, will retry later');
      throw new Error('Analysis rate limited, please try again');
    }
    
    appLogger.error('Gemini analysis error:', error?.message || error);
    throw new Error('Image analysis failed');
  }
}

/**
 * POST /api/photo/upload
 * Upload a base64 image and get a URL back
 * Used for syncing images to Arda - converts data URLs to hosted URLs
 */
router.post('/upload', async (req: Request, res: Response) => {
  try {
    const { imageData } = req.body;
    
    // Validate image data
    const validation = isValidImageData(imageData);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }
    
    // Generate unique image ID
    const imageId = `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Store image data
    if (redisClient) {
      try {
        await redisClient.setex(
          `${IMAGE_UPLOAD_PREFIX}${imageId}`,
          IMAGE_TTL,
          imageData
        );
      } catch (error) {
        appLogger.error({ err: error }, 'Redis set image error');
        return res.status(500).json({ error: 'Failed to store image' });
      }
    } else {
      // In-memory fallback (not recommended for production)
      memoryPhotoData.set(`upload-${imageId}`, imageData);
    }
    
    // Build the URL for this image
    const baseUrl = process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`;
    const imageUrl = `${baseUrl}/api/photo/image/${imageId}`;
    
    appLogger.info(`Image uploaded: ${imageId} (${Math.round(validation.sizeBytes / 1024)}KB)`);
    
    res.json({ 
      success: true, 
      imageId,
      imageUrl,
    });
  } catch (error) {
    appLogger.error({ err: error }, 'Image upload error');
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

/**
 * GET /api/photo/image/:imageId
 * Serve a stored image by ID
 */
router.get('/image/:imageId', async (req: Request, res: Response) => {
  try {
    const { imageId } = req.params;
    
    // Validate image ID format
    if (!/^img-\d+-[a-z0-9]+$/.test(imageId)) {
      return res.status(400).json({ error: 'Invalid image ID format' });
    }
    
    // Retrieve image data
    let imageData: string | null = null;
    
    if (redisClient) {
      try {
        imageData = await redisClient.get(`${IMAGE_UPLOAD_PREFIX}${imageId}`);
      } catch (error) {
        appLogger.error({ err: error }, 'Redis get image error');
      }
    }
    
    // Fallback to memory
    if (!imageData) {
      imageData = memoryPhotoData.get(`upload-${imageId}`) || null;
    }
    
    if (!imageData) {
      return res.status(404).json({ error: 'Image not found' });
    }
    
    // Parse the data URL
    const match = imageData.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!match) {
      return res.status(500).json({ error: 'Invalid image data format' });
    }
    
    const imageType = match[1];
    const base64Data = match[2];
    const buffer = Buffer.from(base64Data, 'base64');
    
    // Set appropriate headers and send image
    res.set({
      'Content-Type': `image/${imageType}`,
      'Content-Length': buffer.length,
      'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
    });
    
    res.send(buffer);
  } catch (error) {
    appLogger.error({ err: error }, 'Image serve error');
    res.status(500).json({ error: 'Failed to serve image' });
  }
});

export default router;
