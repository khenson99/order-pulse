// Arda API Routes - Proxy endpoints for frontend
import { Router, Request, Response } from 'express';
import { 
  ardaService, 
  ArdaActor,
  ItemInput, 
  KanbanCardInput, 
  OrderHeaderInput,
  createItemFromVelocity,
  syncVelocityToArda,
  ItemVelocityProfileInput
} from '../services/arda.js';
import { cognitoService } from '../services/cognito.js';
import { getUserEmail } from './auth.js';
import { ensureHostedUrl, isDataUrl } from '../services/imageUpload.js';

const router = Router();

// Extend session types
declare module 'express-session' {
  interface SessionData {
    userId: string;
  }
}

// Get user credentials from session - returns email, tenantId, and author (sub)
// Falls back to demo user only when unauthenticated and mock mode is enabled.
async function getUserCredentials(req: Request): Promise<{
  email: string;
  tenantId: string | null;
  author: string | null;
  isAuthenticated: boolean;
  autoProvisioned?: boolean;
}> {
  const isAuthenticated = Boolean(req.session?.userId);
  let email = '';
  
  // Try to get from session first
  if (isAuthenticated) {
    const sessionEmail = await getUserEmail(req.session.userId!);
    if (sessionEmail) email = sessionEmail;
  }

  // Look up user in Cognito
  let cognitoUser = email ? cognitoService.getUserByEmail(email) : null;

  // Authenticated user missing in Cognito cache: attempt account auto-provision in Arda.
  if (isAuthenticated && email && !cognitoUser) {
    const provisionedActor = await ardaService.provisionUserForEmail(email);
    if (provisionedActor?.tenantId && provisionedActor.author) {
      return {
        email,
        tenantId: provisionedActor.tenantId,
        author: provisionedActor.author,
        isAuthenticated,
        autoProvisioned: true,
      };
    }
  }
  
  // Fallback only for unauthenticated demo requests in mock mode
  if (!cognitoUser && !isAuthenticated && process.env.ARDA_MOCK_MODE === 'true') {
    const fallbackEmail = 'kyle@arda.cards';
    cognitoUser = cognitoService.getUserByEmail(fallbackEmail);
    if (cognitoUser) {
      email = fallbackEmail;
      console.log(`🎭 Using fallback user ${fallbackEmail} for demo mode`);
    }
  }
  
  return {
    email,
    tenantId: cognitoUser?.tenantId || null,
    author: cognitoUser?.sub || null,
    isAuthenticated,
    autoProvisioned: false,
  };
}

function credentialFailureResponse(credentials: {
  email: string;
  tenantId: string | null;
  author: string | null;
  isAuthenticated: boolean;
}) {
  const cognitoStatus = cognitoService.getSyncStatus();

  if (credentials.isAuthenticated) {
    return {
      status: 400,
      body: {
        success: false,
        error: 'Missing Cognito credentials for authenticated Arda sync',
        details: {
          email: credentials.email,
          authorFound: !!credentials.author,
          tenantIdFound: !!credentials.tenantId,
          cognitoUsersLoaded: cognitoStatus.userCount,
          message: credentials.email
            ? `No Cognito mapping found for logged-in email ${credentials.email}. Ensure the user exists in Arda and run POST /api/cognito/sync.`
            : 'Authenticated session has no email. Re-authenticate with Google and retry.',
        },
      },
    };
  }

  return {
    status: 400,
    body: {
      success: false,
      error: 'Missing credentials for Arda sync',
      details: {
        email: credentials.email,
        authorFound: !!credentials.author,
        tenantIdFound: !!credentials.tenantId,
        cognitoUsersLoaded: cognitoStatus.userCount,
        message: 'Provide author credentials, configure ARDA_TENANT_ID, or enable ARDA_MOCK_MODE for demo usage.',
      },
    },
  };
}

function buildActor(
  credentials: {
    email: string;
    tenantId: string | null;
    author: string | null;
    isAuthenticated: boolean;
  },
  providedAuthor?: string | null
): { actor?: ArdaActor; error?: { status: number; body: unknown } } {
  if (providedAuthor !== undefined && providedAuthor !== null && typeof providedAuthor !== 'string') {
    return {
      error: {
        status: 400,
        body: { success: false, error: 'author must be a string when provided' },
      },
    };
  }

  if (credentials.isAuthenticated) {
    if (!credentials.author || !credentials.tenantId || !credentials.email) {
      return { error: credentialFailureResponse(credentials) };
    }

    if (providedAuthor && providedAuthor !== credentials.author) {
      return {
        error: {
          status: 400,
          body: {
            success: false,
            error: 'Provided author does not match authenticated user',
            details: {
              providedAuthor,
              authenticatedAuthor: credentials.author,
              email: credentials.email,
            },
          },
        },
      };
    }

    return {
      actor: {
        author: credentials.author,
        email: credentials.email,
        tenantId: credentials.tenantId,
      },
    };
  }

  const author = providedAuthor || credentials.author;
  if (!author) {
    return { error: credentialFailureResponse(credentials) };
  }

  const actor: ArdaActor = { author };
  if (credentials.email) actor.email = credentials.email;
  if (credentials.tenantId) actor.tenantId = credentials.tenantId;
  return { actor };
}

// Check if Arda is configured
router.get('/status', (req: Request, res: Response) => {
  res.json({
    configured: ardaService.isConfigured(),
    message: ardaService.isConfigured()
      ? 'Arda API is configured'
      : 'Missing ARDA_API_KEY or ARDA_TENANT_ID environment variables',
  });
});

// Debug: Look up tenant ID from email (public for testing)
router.get('/lookup-tenant', async (req: Request, res: Response) => {
  try {
    // Accept email from query param or session
    let email = req.query.email as string;
    if (!email && req.session?.userId) {
      email = (await getUserCredentials(req)).email;
    }
    
    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email required. Pass ?email=your@email.com'
      });
    }
    
    console.log(`🔍 Looking up tenant for email: ${email}`);
    
    const tenantId = await ardaService.getTenantByEmail(email);
    
    if (tenantId) {
      res.json({
        success: true,
        email,
        tenantId,
        message: `Found tenant ID! Add this to your .env: ARDA_TENANT_ID=${tenantId}`
      });
    } else {
      res.json({
        success: false,
        email,
        tenantId: null,
        message: `No tenant found for email: ${email}. Make sure this email is registered in Arda.`
      });
    }
  } catch (error) {
    console.error('Tenant lookup error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to lookup tenant',
    });
  }
});

// Create item in Arda
router.post('/items', async (req: Request, res: Response) => {
  try {
    const credentials = await getUserCredentials(req);
    const actorResult = buildActor(credentials);
    if (actorResult.error) {
      return res.status(actorResult.error.status).json(actorResult.error.body);
    }

    const itemData: Omit<ItemInput, 'externalGuid'> = req.body;

    // Validate required fields
    if (!itemData.name || !itemData.primarySupplier) {
      return res.status(400).json({
        error: 'Missing required fields: name and primarySupplier are required',
      });
    }

    // If imageUrl is a data URL (base64), upload it to get a hosted URL
    let hostedImageUrl = itemData.imageUrl;
    if (itemData.imageUrl && isDataUrl(itemData.imageUrl)) {
      console.log('📸 Uploading captured photo to cloud storage...');
      hostedImageUrl = await ensureHostedUrl(itemData.imageUrl, 'order-pulse/items');
      if (hostedImageUrl) {
        console.log('✅ Photo uploaded:', hostedImageUrl);
      } else {
        console.warn('⚠️ Photo upload failed - image will be omitted from Arda');
      }
    }

    // Set defaults and pass all available fields
    const item: ItemInput = {
      name: itemData.name,
      description: (itemData as any).description,
      primarySupplier: itemData.primarySupplier,
      orderMechanism: itemData.orderMechanism || 'email',
      minQty: itemData.minQty || 1,
      minQtyUnit: itemData.minQtyUnit || 'each',
      orderQty: itemData.orderQty || 1,
      orderQtyUnit: itemData.orderQtyUnit || 'each',
      location: itemData.location,
      primarySupplierLink: itemData.primarySupplierLink,
      imageUrl: hostedImageUrl, // Use hosted URL instead of data URL
      sku: (itemData as any).sku || (itemData as any).barcode,
      color: (itemData as any).color,
    };

    const result = await ardaService.createItem(item, actorResult.actor!);
    res.json({ success: true, record: result });
  } catch (error) {
    console.error('Arda create item error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to create item in Arda',
    });
  }
});

// Create Kanban card in Arda
router.post('/kanban-cards', async (req: Request, res: Response) => {
  try {
    const credentials = await getUserCredentials(req);
    const actorResult = buildActor(credentials);
    if (actorResult.error) {
      return res.status(actorResult.error.status).json(actorResult.error.body);
    }

    const cardData: KanbanCardInput = req.body;

    // Validate required fields
    if (!cardData.item || !cardData.quantity) {
      return res.status(400).json({
        error: 'Missing required fields: item and quantity are required',
      });
    }

    const result = await ardaService.createKanbanCard(cardData, actorResult.actor!);
    res.json({ success: true, record: result });
  } catch (error) {
    console.error('Arda create kanban card error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to create Kanban card in Arda',
    });
  }
});

// Create order in Arda
router.post('/orders', async (req: Request, res: Response) => {
  try {
    const credentials = await getUserCredentials(req);
    const actorResult = buildActor(credentials);
    if (actorResult.error) {
      return res.status(actorResult.error.status).json(actorResult.error.body);
    }

    const orderData = req.body;

    // Map OrderPulse order to Arda OrderHeaderInput
    const order: OrderHeaderInput = {
      orderDate: {
        utcTimestamp: orderData.orderDate
          ? new Date(orderData.orderDate).getTime()
          : Date.now(),
      },
      allowPartial: orderData.allowPartial ?? false,
      expedite: orderData.expedite ?? false,
      supplierName: orderData.supplier || orderData.supplierName,
      notes: orderData.notes,
      taxesAndFees: orderData.taxesAndFees || {},
    };

    if (orderData.deliverBy) {
      order.deliverBy = { utcTimestamp: new Date(orderData.deliverBy).getTime() };
    }

    const result = await ardaService.createOrder(order, actorResult.actor!);
    res.json({ success: true, record: result });
  } catch (error) {
    console.error('Arda create order error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to create order in Arda',
    });
  }
});

// Bulk sync items to Arda (no auth required for demo)
router.post('/items/bulk', async (req: Request, res: Response) => {
  try {
    const credentials = await getUserCredentials(req);
    const actorResult = buildActor(credentials);
    if (actorResult.error) {
      return res.status(actorResult.error.status).json(actorResult.error.body);
    }

    const items: Array<Omit<ItemInput, 'externalGuid'>> = req.body.items;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ 
        success: false,
        error: 'items array is required',
        debug: { email: credentials.email }
      });
    }

    console.log(`📤 Syncing ${items.length} items to Arda for user ${credentials.email}`);
    console.log(`   Author: ${actorResult.actor?.author}, Tenant: ${actorResult.actor?.tenantId}`);

    // Sync each item with proper author from Cognito
    const results = await Promise.allSettled(
      items.map((item) => ardaService.createItem(item, actorResult.actor!))
    );

    const successful = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    res.json({
      success: failed === 0,
      credentials: {
        email: credentials.email,
        author: actorResult.actor?.author,
        tenantId: actorResult.actor?.tenantId || null,
      },
      summary: { total: items.length, successful, failed },
      results: results.map((r, i) => ({
        item: items[i].name,
        status: r.status,
        error: r.status === 'rejected' ? (r.reason as Error).message : undefined,
        record: r.status === 'fulfilled' ? (r as PromiseFulfilledResult<unknown>).value : undefined,
      })),
    });
  } catch (error) {
    console.error('Arda bulk sync error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to bulk sync items',
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
});

// Sync velocity profiles to Arda
router.post('/sync-velocity', async (req: Request, res: Response) => {
  try {
    const credentials = await getUserCredentials(req);
    const { profiles, author } = req.body;

    // Validate request body
    if (!Array.isArray(profiles) || profiles.length === 0) {
      return res.status(400).json({
        error: 'profiles array is required and must not be empty',
      });
    }

    const actorResult = buildActor(credentials, author);
    if (actorResult.error) {
      return res.status(actorResult.error.status).json(actorResult.error.body);
    }

    // Validate each profile
    for (const profile of profiles) {
      if (!profile.displayName || !profile.supplier) {
        return res.status(400).json({
          error: 'Each profile must have displayName and supplier',
        });
      }
    }

    console.log(`📤 Syncing ${profiles.length} velocity profiles to Arda for user ${credentials.email}`);

    const results = await syncVelocityToArda(profiles, actorResult.actor!);

    res.json({ results });
  } catch (error) {
    console.error('Arda sync velocity error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to sync velocity profiles to Arda',
    });
  }
});

// Push velocity items to Arda
router.post('/push-velocity', async (req: Request, res: Response) => {
  try {
    const credentials = await getUserCredentials(req);
    const actorResult = buildActor(credentials);
    if (actorResult.error) {
      return res.status(actorResult.error.status).json(actorResult.error.body);
    }

    const { items } = req.body;

    // Validate request body
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'items array is required and must not be empty',
      });
    }

    // Validate each item
    for (const item of items) {
      if (!item.displayName || !item.supplier) {
        return res.status(400).json({
          success: false,
          error: 'Each item must have displayName and supplier',
        });
      }
    }

    console.log(`📤 Pushing ${items.length} velocity items to Arda for user ${credentials.email}`);
    console.log(`   Author: ${actorResult.actor?.author}, Tenant: ${actorResult.actor?.tenantId}`);

    const results = await ardaService.syncVelocityToArda(items, actorResult.actor!);

    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    res.json({
      success: failed === 0,
      summary: { total: items.length, successful, failed },
      results,
    });
  } catch (error) {
    console.error('Arda push velocity error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to push velocity items to Arda',
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
});

// Sync a single item from velocity data
router.post('/sync-item', async (req: Request, res: Response) => {
  try {
    const credentials = await getUserCredentials(req);
    const { author, ...profileData } = req.body;

    // Validate required fields
    if (!profileData.displayName || !profileData.supplier) {
      return res.status(400).json({
        error: 'Missing required fields: displayName and supplier are required',
      });
    }

    const actorResult = buildActor(credentials, author);
    if (actorResult.error) {
      return res.status(actorResult.error.status).json(actorResult.error.body);
    }

    console.log(`📤 Syncing item "${profileData.displayName}" to Arda for user ${credentials.email}`);

    const result = await createItemFromVelocity(profileData as ItemVelocityProfileInput, actorResult.actor!);
    res.json({ success: true, record: result });
  } catch (error) {
    console.error('Arda sync item error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to sync item from velocity data',
    });
  }
});

// Get sync status (returns basic status since tracking is not yet implemented)
router.get('/sync-status', async (req: Request, res: Response) => {
  try {
    const credentials = await getUserCredentials(req);
    
    // Since sync status tracking is not yet implemented, return basic status
    res.json({
      success: true,
      message: 'Sync status tracking is not yet implemented',
      user: credentials.email,
      ardaConfigured: ardaService.isConfigured(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Arda sync status error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get sync status',
    });
  }
});

export default router;
