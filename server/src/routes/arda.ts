// Arda API Routes - Proxy endpoints for frontend
import { Router, Request, Response, NextFunction } from 'express';
import { 
  ardaService, 
  ItemInput, 
  KanbanCardInput, 
  OrderHeaderInput,
  createItemFromVelocity,
  syncVelocityToArda,
  ItemVelocityProfileInput
} from '../services/arda.js';
import { cognitoService } from '../services/cognito.js';
import { getUserEmail } from './auth.js';

const router = Router();

// Extend session types
declare module 'express-session' {
  interface SessionData {
    userId: string;
  }
}

// Get user credentials from session - returns email, tenantId, and author (sub)
// Falls back to first Cognito user for demo mode when not authenticated
function getUserCredentials(req: Request): { email: string; tenantId: string | null; author: string | null } {
  let email = '';
  
  // Try to get from session first
  if (req.session?.userId) {
    const sessionEmail = getUserEmail(req.session.userId);
    if (sessionEmail) email = sessionEmail;
  }

  // Look up user in Cognito
  let cognitoUser = email ? cognitoService.getUserByEmail(email) : null;
  
  // Fallback: use kyle@arda.cards for demo mode if no session
  if (!cognitoUser) {
    const fallbackEmail = 'kyle@arda.cards';
    cognitoUser = cognitoService.getUserByEmail(fallbackEmail);
    if (cognitoUser) {
      email = fallbackEmail;
      console.log(`🎭 Using fallback user ${fallbackEmail} for demo mode`);
    }
  }
  
  return {
    email,
    tenantId: cognitoUser?.tenantId || process.env.ARDA_TENANT_ID || null,
    author: cognitoUser?.sub || null,
  };
}

// Middleware to check if user is authenticated
const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
};

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
      email = getUserCredentials(req).email;
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
router.post('/items', requireAuth, async (req: Request, res: Response) => {
  try {
    const credentials = getUserCredentials(req);
    if (!credentials.author) {
      return res.status(400).json({ success: false, error: `User ${credentials.email} not found in Cognito` });
    }
    const itemData: Omit<ItemInput, 'externalGuid'> = req.body;

    // Validate required fields
    if (!itemData.name || !itemData.primarySupplier) {
      return res.status(400).json({
        error: 'Missing required fields: name and primarySupplier are required',
      });
    }

    // Set defaults for required fields
    const item: Omit<ItemInput, 'externalGuid'> = {
      name: itemData.name,
      orderMechanism: itemData.orderMechanism || 'email',
      minQty: itemData.minQty || 1,
      minQtyUnit: itemData.minQtyUnit || 'each',
      primarySupplier: itemData.primarySupplier,
      location: itemData.location,
      orderQty: itemData.orderQty,
      orderQtyUnit: itemData.orderQtyUnit,
      primarySupplierLink: itemData.primarySupplierLink,
      imageUrl: itemData.imageUrl,
    };

    const result = await ardaService.createItem(item, credentials.author!);
    res.json({ success: true, record: result });
  } catch (error) {
    console.error('Arda create item error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to create item in Arda',
    });
  }
});

// Create Kanban card in Arda
router.post('/kanban-cards', requireAuth, async (req: Request, res: Response) => {
  try {
    const credentials = getUserCredentials(req);
    if (!credentials.author) {
      return res.status(400).json({ success: false, error: `User ${credentials.email} not found in Cognito` });
    }
    const cardData: KanbanCardInput = req.body;

    // Validate required fields
    if (!cardData.item || !cardData.quantity) {
      return res.status(400).json({
        error: 'Missing required fields: item and quantity are required',
      });
    }

    const result = await ardaService.createKanbanCard(cardData, credentials.author!);
    res.json({ success: true, record: result });
  } catch (error) {
    console.error('Arda create kanban card error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to create Kanban card in Arda',
    });
  }
});

// Create order in Arda
router.post('/orders', requireAuth, async (req: Request, res: Response) => {
  try {
    const credentials = getUserCredentials(req);
    if (!credentials.author) {
      return res.status(400).json({ success: false, error: `User ${credentials.email} not found in Cognito` });
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

    const result = await ardaService.createOrder(order, credentials.author!);
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
    const credentials = getUserCredentials(req);
    const items: Array<Omit<ItemInput, 'externalGuid'>> = req.body.items;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ 
        success: false,
        error: 'items array is required',
        debug: { email: credentials.email }
      });
    }

    // Check if we have valid Cognito credentials
    if (!credentials.author || !credentials.tenantId) {
      // Try to provide helpful error message
      const cognitoStatus = cognitoService.getSyncStatus();
      return res.status(400).json({
        success: false,
        error: 'Missing Cognito credentials for Arda sync',
        details: {
          email: credentials.email,
          authorFound: !!credentials.author,
          tenantIdFound: !!credentials.tenantId,
          cognitoUsersLoaded: cognitoStatus.userCount,
          message: !credentials.author 
            ? `User ${credentials.email} not found in Cognito cache. Ensure user is in Arda and run POST /api/cognito/sync.`
            : `Tenant ID not found. Set ARDA_TENANT_ID in env or ensure user has tenant in Cognito.`
        }
      });
    }

    console.log(`📤 Syncing ${items.length} items to Arda for user ${credentials.email}`);
    console.log(`   Author: ${credentials.author}, Tenant: ${credentials.tenantId}`);

    // Sync each item with proper author from Cognito
    const results = await Promise.allSettled(
      items.map((item) => ardaService.createItem(item, credentials.author!))
    );

    const successful = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    res.json({
      success: failed === 0,
      credentials: {
        email: credentials.email,
        author: credentials.author,
        tenantId: credentials.tenantId,
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
router.post('/sync-velocity', requireAuth, async (req: Request, res: Response) => {
  try {
    const credentials = getUserCredentials(req);
    if (!credentials.author) {
      return res.status(400).json({ success: false, error: `User ${credentials.email} not found in Cognito` });
    }

    const { profiles, author } = req.body;

    // Validate request body
    if (!Array.isArray(profiles) || profiles.length === 0) {
      return res.status(400).json({
        error: 'profiles array is required and must not be empty',
      });
    }

    if (!author || typeof author !== 'string') {
      return res.status(400).json({
        error: 'author string is required',
      });
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

    // Use the provided author or fall back to credentials author
    const syncAuthor = author || credentials.author!;
    const results = await syncVelocityToArda(profiles, syncAuthor);

    res.json({ results });
  } catch (error) {
    console.error('Arda sync velocity error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to sync velocity profiles to Arda',
    });
  }
});

// Push velocity items to Arda
router.post('/push-velocity', requireAuth, async (req: Request, res: Response) => {
  try {
    const credentials = getUserCredentials(req);
    if (!credentials.author) {
      return res.status(400).json({ success: false, error: `User ${credentials.email} not found in Cognito` });
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
    console.log(`   Author: ${credentials.author}, Tenant: ${credentials.tenantId}`);

    // Call syncVelocityToArda with items and credentials author
    const results = await ardaService.syncVelocityToArda(items, credentials.author);

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
router.post('/sync-item', requireAuth, async (req: Request, res: Response) => {
  try {
    const credentials = getUserCredentials(req);
    if (!credentials.author) {
      return res.status(400).json({ success: false, error: `User ${credentials.email} not found in Cognito` });
    }

    const { author, ...profileData } = req.body;

    // Validate required fields
    if (!profileData.displayName || !profileData.supplier) {
      return res.status(400).json({
        error: 'Missing required fields: displayName and supplier are required',
      });
    }

    // Use the provided author or fall back to credentials author
    const syncAuthor = author || credentials.author!;

    console.log(`📤 Syncing item "${profileData.displayName}" to Arda for user ${credentials.email}`);

    const result = await createItemFromVelocity(profileData as ItemVelocityProfileInput, syncAuthor);
    res.json({ success: true, record: result });
  } catch (error) {
    console.error('Arda sync item error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to sync item from velocity data',
    });
  }
});

// Get sync status (returns basic status since tracking is not yet implemented)
router.get('/sync-status', requireAuth, async (req: Request, res: Response) => {
  try {
    const credentials = getUserCredentials(req);
    
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
