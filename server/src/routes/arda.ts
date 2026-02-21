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
import { cognitoService, type TenantDomainSuggestion } from '../services/cognito.js';
import { getUserEmail } from './auth.js';
import { ensureHostedUrl, isDataUrl } from '../services/imageUpload.js';
import {
  getArdaSyncStatus,
  recordArdaSyncEvent,
  type ArdaSyncOperation,
} from '../services/ardaSyncStatus.js';

const router = Router();

// Extend session types
declare module 'express-session' {
  interface SessionData {
    userId: string;
    ardaTenantIdOverride?: string;
    ardaAuthorOverride?: string;
    authProvider?: 'google' | 'local';
  }
}

type TenantResolutionAction = 'create_new' | 'use_suggested';
type TenantResolutionMode = 'mapped' | 'override' | 'provisioned' | 'unresolved';

interface TenantResolutionDetails {
  canCreateTenant: boolean;
  suggestedTenant: TenantDomainSuggestion | null;
  autoProvisionAttempted?: boolean;
  autoProvisionSucceeded?: boolean;
  autoProvisionError?: string;
  resolutionMode?: TenantResolutionMode;
}

interface UserCredentials {
  email: string;
  tenantId: string | null;
  author: string | null;
  isAuthenticated: boolean;
  resolution: TenantResolutionDetails;
}

interface TrackArdaSyncInput {
  operation: ArdaSyncOperation;
  success: boolean;
  requested?: number;
  successful?: number;
  failed?: number;
  error?: string;
  actor?: ArdaActor;
}

interface ActorResolutionResult {
  credentials: UserCredentials;
  actor?: ArdaActor;
  error?: { status: number; body: unknown };
}

// Get user credentials from session - returns email, tenantId, and author (sub).
async function getUserCredentials(req: Request): Promise<UserCredentials> {
  const isAuthenticated = Boolean(req.session?.userId);
  let email = '';
  
  // Try to get from session first
  if (isAuthenticated) {
    const sessionEmail = await getUserEmail(req.session.userId!);
    if (sessionEmail) email = sessionEmail;
  }

  // Look up user in Cognito
  let cognitoUser = email ? cognitoService.getUserByEmail(email) : null;
  const sessionTenantOverride = req.session?.ardaTenantIdOverride || null;
  const sessionAuthorOverride = req.session?.ardaAuthorOverride || null;

  let tenantId = cognitoUser?.tenantId || sessionTenantOverride || null;
  let author = cognitoUser?.sub || sessionAuthorOverride || null;

  if (isAuthenticated && email && !tenantId) {
    const refreshed = await cognitoService.syncUsersOnDemand('missing-tenant');
    if (refreshed) {
      cognitoUser = cognitoService.getUserByEmail(email);
      tenantId = cognitoUser?.tenantId || sessionTenantOverride || null;
      author = cognitoUser?.sub || sessionAuthorOverride || null;
    }
  }

  const usingSessionOverride = (
    (!cognitoUser?.tenantId && Boolean(sessionTenantOverride))
    || (!cognitoUser?.sub && Boolean(sessionAuthorOverride))
  );
  const resolutionMode: TenantResolutionMode = (
    tenantId && author
      ? (usingSessionOverride ? 'override' : 'mapped')
      : 'unresolved'
  );

  const suggestedTenant = (
    isAuthenticated && email && !tenantId
      ? cognitoService.findTenantSuggestionForEmail(email)
      : null
  );
  
  return {
    email,
    tenantId,
    author,
    isAuthenticated,
    resolution: {
      canCreateTenant: isAuthenticated && Boolean(email),
      suggestedTenant,
      resolutionMode,
    },
  };
}

function updateCredentialResolution(
  credentials: UserCredentials,
  updates: Partial<TenantResolutionDetails>
): UserCredentials {
  return {
    ...credentials,
    resolution: {
      ...credentials.resolution,
      ...updates,
    },
  };
}

function credentialFailureResponse(credentials: UserCredentials) {
  const cognitoStatus = cognitoService.getSyncStatus();

  if (credentials.isAuthenticated) {
    const tenantRequired = !credentials.tenantId && !!credentials.email;
    const canUseSuggested = Boolean(credentials.author && credentials.resolution.suggestedTenant);
    const suggestionMessage = credentials.resolution.suggestedTenant
      ? `A tenant was found from your company domain (${credentials.resolution.suggestedTenant.domain}) via ${credentials.resolution.suggestedTenant.matchedEmail}.`
      : 'No same-domain tenant suggestion is available.';
    const emailMessage = credentials.email
      ? `No tenant mapping found for logged-in email ${credentials.email}.`
      : 'Authenticated session has no email. Re-authenticate with Google and retry.';

    return {
      status: 400,
      body: {
        success: false,
        code: tenantRequired ? 'TENANT_REQUIRED' : 'MISSING_COGNITO_CREDENTIALS',
        error: tenantRequired
          ? 'Tenant required for Arda sync'
          : 'Missing Cognito credentials for authenticated Arda sync',
        details: {
          email: credentials.email,
          authorFound: !!credentials.author,
          tenantIdFound: !!credentials.tenantId,
          cognitoUsersLoaded: cognitoStatus.userCount,
          canUseSuggestedTenant: canUseSuggested,
          canCreateTenant: credentials.resolution.canCreateTenant,
          suggestedTenant: credentials.resolution.suggestedTenant,
          autoProvisionAttempted: credentials.resolution.autoProvisionAttempted,
          autoProvisionSucceeded: credentials.resolution.autoProvisionSucceeded,
          autoProvisionError: credentials.resolution.autoProvisionError,
          resolutionMode: credentials.resolution.resolutionMode || 'unresolved',
          message: tenantRequired
            ? `${emailMessage} ${suggestionMessage}`
            : emailMessage,
        },
      },
    };
  }

  return {
    status: 401,
    body: {
      success: false,
      error: 'Authentication required for Arda sync',
      details: {
        email: credentials.email,
        authorFound: !!credentials.author,
        tenantIdFound: !!credentials.tenantId,
        cognitoUsersLoaded: cognitoStatus.userCount,
        message: 'Sign in and sync to your account tenant, or export items to CSV.',
      },
    },
  };
}

function buildActor(
  credentials: UserCredentials,
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

  return { error: credentialFailureResponse(credentials) };
}

async function resolveActorForWrite(
  req: Request,
  providedAuthor?: string | null
): Promise<ActorResolutionResult> {
  const requestId = req.get('x-request-id') || 'n/a';
  let credentials = await getUserCredentials(req);

  if (providedAuthor !== undefined && providedAuthor !== null && typeof providedAuthor !== 'string') {
    return {
      credentials,
      error: {
        status: 400,
        body: { success: false, error: 'author must be a string when provided' },
      },
    };
  }

  let actorResult = buildActor(credentials, providedAuthor);
  if (actorResult.actor || !credentials.isAuthenticated || credentials.tenantId) {
    return {
      credentials,
      ...actorResult,
    };
  }

  if (!credentials.email || !credentials.resolution.canCreateTenant) {
    return {
      credentials,
      error: credentialFailureResponse(credentials),
    };
  }

  credentials = updateCredentialResolution(credentials, {
    autoProvisionAttempted: true,
    autoProvisionSucceeded: false,
    resolutionMode: 'unresolved',
  });

  console.info('Arda auto-provision attempt', {
    email: credentials.email,
    path: req.path,
    requestId,
  });

  if (!ardaService.isConfigured()) {
    const autoProvisionError = 'ARDA_API_KEY is not configured; auto-provisioning unavailable.';
    console.warn('Arda auto-provision failed', {
      email: credentials.email,
      path: req.path,
      requestId,
      reason: autoProvisionError,
      code: 'ARDA_NOT_CONFIGURED',
    });
    credentials = updateCredentialResolution(credentials, {
      autoProvisionSucceeded: false,
      autoProvisionError,
      resolutionMode: 'unresolved',
    });
    return {
      credentials,
      error: credentialFailureResponse(credentials),
    };
  }

  try {
    const provisioned = await ardaService.provisionUserForEmail(credentials.email);
    if (!provisioned?.tenantId || !provisioned.author) {
      const autoProvisionError = 'Automatic tenant provisioning did not return tenant credentials.';
      console.warn('Arda auto-provision failed', {
        email: credentials.email,
        path: req.path,
        requestId,
        reason: autoProvisionError,
        code: 'TENANT_PROVISION_FAILED',
      });
      credentials = updateCredentialResolution(credentials, {
        autoProvisionSucceeded: false,
        autoProvisionError,
        resolutionMode: 'unresolved',
      });
      return {
        credentials,
        error: credentialFailureResponse(credentials),
      };
    }

    req.session.ardaTenantIdOverride = provisioned.tenantId;
    req.session.ardaAuthorOverride = provisioned.author;

    console.info('Arda auto-provision success', {
      email: credentials.email,
      path: req.path,
      requestId,
      tenantId: provisioned.tenantId,
      authorSource: 'provisioned',
    });

    try {
      await cognitoService.ensureUserMappingForEmail(
        credentials.email,
        provisioned.tenantId,
        { role: 'User', suppressMessage: true }
      );
      console.info('Arda auto-provision Cognito mapping updated', {
        email: credentials.email,
        path: req.path,
        requestId,
        tenantId: provisioned.tenantId,
      });
    } catch (error) {
      console.warn('Arda auto-provision Cognito mapping update failed', {
        email: credentials.email,
        path: req.path,
        requestId,
        tenantId: provisioned.tenantId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    credentials = updateCredentialResolution(
      {
        ...credentials,
        tenantId: provisioned.tenantId,
        author: provisioned.author,
      },
      {
        autoProvisionSucceeded: true,
        autoProvisionError: undefined,
        resolutionMode: 'provisioned',
      }
    );

    actorResult = buildActor(credentials, providedAuthor);
    return {
      credentials,
      ...actorResult,
    };
  } catch (error) {
    const autoProvisionError = error instanceof Error ? error.message : String(error);
    console.warn('Arda auto-provision failed', {
      email: credentials.email,
      path: req.path,
      requestId,
      reason: autoProvisionError,
      code: 'TENANT_PROVISION_FAILED',
    });
    credentials = updateCredentialResolution(credentials, {
      autoProvisionSucceeded: false,
      autoProvisionError,
      resolutionMode: 'unresolved',
    });
    return {
      credentials,
      error: credentialFailureResponse(credentials),
    };
  }
}

function getSyncStatusUserKey(req: Request, credentials?: UserCredentials): string {
  if (req.session?.userId) {
    return `user:${req.session.userId}`;
  }
  if (credentials?.email) {
    return `email:${credentials.email.toLowerCase()}`;
  }
  return 'anonymous';
}

function extractSyncErrorMessage(payload: unknown): string {
  if (typeof payload === 'string') {
    return payload;
  }

  if (!payload || typeof payload !== 'object') {
    return 'Unknown sync error';
  }

  const candidate = payload as {
    error?: unknown;
    code?: unknown;
    details?: { message?: unknown };
  };

  if (typeof candidate.error === 'string' && candidate.error.trim()) {
    return candidate.error;
  }

  if (typeof candidate.details?.message === 'string' && candidate.details.message.trim()) {
    return candidate.details.message;
  }

  if (typeof candidate.code === 'string' && candidate.code.trim()) {
    return candidate.code;
  }

  return 'Sync request failed';
}

async function trackArdaSync(
  req: Request,
  credentials: UserCredentials | undefined,
  input: TrackArdaSyncInput
): Promise<void> {
  try {
    await recordArdaSyncEvent(
      getSyncStatusUserKey(req, credentials),
      {
        ...input,
        email: input.actor?.email || credentials?.email || undefined,
        tenantId: input.actor?.tenantId || credentials?.tenantId || undefined,
      }
    );
  } catch (error) {
    console.warn('⚠️ Failed to record Arda sync status:', error);
  }
}

// Check if Arda is configured
router.get('/status', (req: Request, res: Response) => {
  res.json({
    configured: ardaService.isConfigured(),
    message: ardaService.isConfigured()
      ? 'Arda API is configured'
      : 'Missing ARDA_API_KEY environment variable',
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
        message: `Found tenant ID for ${email}`
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

router.post('/tenant/resolve', async (req: Request, res: Response) => {
  try {
    const credentials = await getUserCredentials(req);
    if (!credentials.isAuthenticated || !credentials.email) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required to resolve tenant',
      });
    }

    const action = req.body?.action as TenantResolutionAction | undefined;
    if (action !== 'create_new' && action !== 'use_suggested') {
      return res.status(400).json({
        success: false,
        error: 'action must be one of: create_new, use_suggested',
      });
    }

    if (credentials.tenantId && credentials.author) {
      return res.json({
        success: true,
        action,
        tenantId: credentials.tenantId,
        author: credentials.author,
      });
    }

    if (action === 'create_new') {
      if (!ardaService.isConfigured()) {
        return res.status(503).json({
          success: false,
          code: 'ARDA_NOT_CONFIGURED',
          error: 'Tenant auto-provisioning is unavailable: ARDA_API_KEY is not configured.',
        });
      }

      const provisioned = await ardaService.provisionUserForEmail(credentials.email);
      if (!provisioned?.tenantId || !provisioned.author) {
        return res.status(502).json({
          success: false,
          code: 'TENANT_PROVISION_FAILED',
          error: 'Unable to create tenant for this email. Automatic provisioning failed; please contact support.',
          details: {
            email: credentials.email,
            message: 'Server logs contain endpoint/status details under "Auto-provision failed".',
          },
        });
      }

      try {
        await cognitoService.ensureUserMappingForEmail(
          credentials.email,
          provisioned.tenantId,
          { role: 'User', suppressMessage: true }
        );
      } catch (error) {
        console.warn(
          `⚠️ Failed to update Cognito mapping for ${credentials.email}:`,
          error instanceof Error ? error.message : error
        );
      }

      req.session.ardaTenantIdOverride = provisioned.tenantId;
      req.session.ardaAuthorOverride = provisioned.author;

      return res.json({
        success: true,
        action,
        tenantId: provisioned.tenantId,
        author: provisioned.author,
      });
    }

    const suggestion = cognitoService.findTenantSuggestionForEmail(credentials.email);
    if (!suggestion) {
      return res.status(404).json({
        success: false,
        error: 'No suggested tenant found for this email domain',
      });
    }

    if (!credentials.author) {
      return res.status(400).json({
        success: false,
        error: 'No Cognito author found for this email. Create a new tenant instead.',
      });
    }

    req.session.ardaTenantIdOverride = suggestion.tenantId;
    req.session.ardaAuthorOverride = credentials.author;

    return res.json({
      success: true,
      action,
      tenantId: suggestion.tenantId,
      author: credentials.author,
      suggestedTenant: suggestion,
    });
  } catch (error) {
    console.error('Arda tenant resolve error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to resolve tenant',
    });
  }
});

router.get('/tenant/status', async (req: Request, res: Response) => {
  try {
    const credentials = await getUserCredentials(req);
    if (!credentials.isAuthenticated) {
      const error = credentialFailureResponse(credentials);
      return res.status(error.status).json(error.body);
    }

    if (credentials.email && credentials.author && credentials.tenantId) {
      return res.json({
        success: true,
        resolved: true,
        details: {
          email: credentials.email,
          authorFound: true,
          tenantIdFound: true,
          tenantId: credentials.tenantId,
          resolutionMode: credentials.resolution.resolutionMode || 'mapped',
        },
      });
    }

    const error = credentialFailureResponse(credentials);
    return res.status(error.status).json({
      ...(error.body as Record<string, unknown>),
      resolved: false,
    });
  } catch (error) {
    console.error('Arda tenant status error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to check tenant status',
    });
  }
});

// Create item in Arda
router.post('/items', async (req: Request, res: Response) => {
  let credentials: UserCredentials | undefined;
  let actor: ArdaActor | undefined;
  try {
    const actorResult = await resolveActorForWrite(req);
    credentials = actorResult.credentials;
    if (actorResult.error) {
      await trackArdaSync(req, credentials, {
        operation: 'item_create',
        success: false,
        error: extractSyncErrorMessage(actorResult.error.body),
      });
      return res.status(actorResult.error.status).json(actorResult.error.body);
    }
    actor = actorResult.actor;

    const itemData: Omit<ItemInput, 'externalGuid'> = req.body;

    // Validate required fields
    if (!itemData.name || !itemData.primarySupplier) {
      await trackArdaSync(req, credentials, {
        operation: 'item_create',
        success: false,
        error: 'Missing required fields: name and primarySupplier are required',
      });
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
      minQtyUnit: itemData.minQtyUnit || 'EA',
      orderQty: itemData.orderQty || 1,
      orderQtyUnit: itemData.orderQtyUnit || 'EA',
      location: itemData.location,
      primarySupplierLink: itemData.primarySupplierLink,
      imageUrl: hostedImageUrl, // Use hosted URL instead of data URL
      sku: (itemData as any).sku || (itemData as any).barcode,
      color: (itemData as any).color,
    };

    const result = await ardaService.createItem(item, actor!);
    await trackArdaSync(req, credentials, {
      operation: 'item_create',
      success: true,
      requested: 1,
      successful: 1,
      failed: 0,
      actor,
    });
    res.json({ success: true, record: result });
  } catch (error) {
    console.error('Arda create item error:', error);
    await trackArdaSync(req, credentials, {
      operation: 'item_create',
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create item in Arda',
      actor,
    });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to create item in Arda',
    });
  }
});

// Create Kanban card in Arda
router.post('/kanban-cards', async (req: Request, res: Response) => {
  let credentials: UserCredentials | undefined;
  let actor: ArdaActor | undefined;
  try {
    const actorResult = await resolveActorForWrite(req);
    credentials = actorResult.credentials;
    if (actorResult.error) {
      await trackArdaSync(req, credentials, {
        operation: 'kanban_card_create',
        success: false,
        error: extractSyncErrorMessage(actorResult.error.body),
      });
      return res.status(actorResult.error.status).json(actorResult.error.body);
    }
    actor = actorResult.actor;

    const cardData: KanbanCardInput = req.body;

    // Validate required fields
    if (!cardData.item || !cardData.quantity) {
      await trackArdaSync(req, credentials, {
        operation: 'kanban_card_create',
        success: false,
        error: 'Missing required fields: item and quantity are required',
      });
      return res.status(400).json({
        error: 'Missing required fields: item and quantity are required',
      });
    }

    const result = await ardaService.createKanbanCard(cardData, actor!);
    await trackArdaSync(req, credentials, {
      operation: 'kanban_card_create',
      success: true,
      requested: 1,
      successful: 1,
      failed: 0,
      actor,
    });
    res.json({ success: true, record: result });
  } catch (error) {
    console.error('Arda create kanban card error:', error);
    await trackArdaSync(req, credentials, {
      operation: 'kanban_card_create',
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create Kanban card in Arda',
      actor,
    });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to create Kanban card in Arda',
    });
  }
});

// Create order in Arda
router.post('/orders', async (req: Request, res: Response) => {
  let credentials: UserCredentials | undefined;
  let actor: ArdaActor | undefined;
  try {
    const actorResult = await resolveActorForWrite(req);
    credentials = actorResult.credentials;
    if (actorResult.error) {
      await trackArdaSync(req, credentials, {
        operation: 'order_create',
        success: false,
        error: extractSyncErrorMessage(actorResult.error.body),
      });
      return res.status(actorResult.error.status).json(actorResult.error.body);
    }
    actor = actorResult.actor;

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

    const result = await ardaService.createOrder(order, actor!);
    await trackArdaSync(req, credentials, {
      operation: 'order_create',
      success: true,
      requested: 1,
      successful: 1,
      failed: 0,
      actor,
    });
    res.json({ success: true, record: result });
  } catch (error) {
    console.error('Arda create order error:', error);
    await trackArdaSync(req, credentials, {
      operation: 'order_create',
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create order in Arda',
      actor,
    });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to create order in Arda',
    });
  }
});

// Bulk sync items to Arda
router.post('/items/bulk', async (req: Request, res: Response) => {
  let credentials: UserCredentials | undefined;
  let actor: ArdaActor | undefined;
  try {
    const actorResult = await resolveActorForWrite(req);
    credentials = actorResult.credentials;
    if (actorResult.error) {
      await trackArdaSync(req, credentials, {
        operation: 'item_bulk_create',
        success: false,
        error: extractSyncErrorMessage(actorResult.error.body),
      });
      return res.status(actorResult.error.status).json(actorResult.error.body);
    }
    actor = actorResult.actor;

    const items: Array<Omit<ItemInput, 'externalGuid'>> = req.body.items;

    if (!Array.isArray(items) || items.length === 0) {
      await trackArdaSync(req, credentials, {
        operation: 'item_bulk_create',
        success: false,
        error: 'items array is required',
      });
      return res.status(400).json({ 
        success: false,
        error: 'items array is required',
        debug: { email: credentials.email }
      });
    }

    console.log(`📤 Syncing ${items.length} items to Arda for user ${credentials.email}`);
    console.log(`   Author: ${actor?.author}, Tenant: ${actor?.tenantId}`);

    // Sync each item with proper author from Cognito
    const results = await Promise.allSettled(
      items.map((item) => ardaService.createItem(item, actor!))
    );

    const successful = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;
    await trackArdaSync(req, credentials, {
      operation: 'item_bulk_create',
      success: failed === 0,
      requested: items.length,
      successful,
      failed,
      error: failed > 0 ? `${failed} items failed to sync` : undefined,
      actor,
    });

    res.json({
      success: failed === 0,
      credentials: {
        email: credentials.email,
        author: actor?.author,
        tenantId: actor?.tenantId || null,
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
    await trackArdaSync(req, credentials, {
      operation: 'item_bulk_create',
      success: false,
      error: error instanceof Error ? error.message : 'Failed to bulk sync items',
      actor,
    });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to bulk sync items',
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
});

// Sync velocity profiles to Arda
router.post('/sync-velocity', async (req: Request, res: Response) => {
  let credentials: UserCredentials | undefined;
  let actor: ArdaActor | undefined;
  try {
    credentials = await getUserCredentials(req);
    const { profiles, author } = req.body;

    // Validate request body
    if (!Array.isArray(profiles) || profiles.length === 0) {
      await trackArdaSync(req, credentials, {
        operation: 'velocity_sync',
        success: false,
        error: 'profiles array is required and must not be empty',
      });
      return res.status(400).json({
        error: 'profiles array is required and must not be empty',
      });
    }

    const actorResult = await resolveActorForWrite(req, author);
    credentials = actorResult.credentials;
    if (actorResult.error) {
      await trackArdaSync(req, credentials, {
        operation: 'velocity_sync',
        success: false,
        error: extractSyncErrorMessage(actorResult.error.body),
      });
      return res.status(actorResult.error.status).json(actorResult.error.body);
    }
    actor = actorResult.actor;

    // Validate each profile
    for (const profile of profiles) {
      if (!profile.displayName || !profile.supplier) {
        await trackArdaSync(req, credentials, {
          operation: 'velocity_sync',
          success: false,
          error: 'Each profile must have displayName and supplier',
        });
        return res.status(400).json({
          error: 'Each profile must have displayName and supplier',
        });
      }
    }

    console.log(`📤 Syncing ${profiles.length} velocity profiles to Arda for user ${credentials.email}`);

    const results = await syncVelocityToArda(profiles, actor!);
    const successful = results.filter((result) => result.success).length;
    const failed = results.length - successful;
    await trackArdaSync(req, credentials, {
      operation: 'velocity_sync',
      success: failed === 0,
      requested: profiles.length,
      successful,
      failed,
      error: failed > 0 ? `${failed} velocity profiles failed to sync` : undefined,
      actor,
    });

    res.json({ results });
  } catch (error) {
    console.error('Arda sync velocity error:', error);
    await trackArdaSync(req, credentials, {
      operation: 'velocity_sync',
      success: false,
      error: error instanceof Error ? error.message : 'Failed to sync velocity profiles to Arda',
      actor,
    });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to sync velocity profiles to Arda',
    });
  }
});

// Push velocity items to Arda
router.post('/push-velocity', async (req: Request, res: Response) => {
  let credentials: UserCredentials | undefined;
  let actor: ArdaActor | undefined;
  try {
    const actorResult = await resolveActorForWrite(req);
    credentials = actorResult.credentials;
    if (actorResult.error) {
      await trackArdaSync(req, credentials, {
        operation: 'velocity_push',
        success: false,
        error: extractSyncErrorMessage(actorResult.error.body),
      });
      return res.status(actorResult.error.status).json(actorResult.error.body);
    }
    actor = actorResult.actor;

    const { items } = req.body;

    // Validate request body
    if (!Array.isArray(items) || items.length === 0) {
      await trackArdaSync(req, credentials, {
        operation: 'velocity_push',
        success: false,
        error: 'items array is required and must not be empty',
      });
      return res.status(400).json({
        success: false,
        error: 'items array is required and must not be empty',
      });
    }

    // Validate each item
    for (const item of items) {
      if (!item.displayName || !item.supplier) {
        await trackArdaSync(req, credentials, {
          operation: 'velocity_push',
          success: false,
          error: 'Each item must have displayName and supplier',
        });
        return res.status(400).json({
          success: false,
          error: 'Each item must have displayName and supplier',
        });
      }
    }

    console.log(`📤 Pushing ${items.length} velocity items to Arda for user ${credentials.email}`);
    console.log(`   Author: ${actor?.author}, Tenant: ${actor?.tenantId}`);

    const results = await ardaService.syncVelocityToArda(items, actor!);

    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    await trackArdaSync(req, credentials, {
      operation: 'velocity_push',
      success: failed === 0,
      requested: items.length,
      successful,
      failed,
      error: failed > 0 ? `${failed} velocity items failed to sync` : undefined,
      actor,
    });

    res.json({
      success: failed === 0,
      summary: { total: items.length, successful, failed },
      results,
    });
  } catch (error) {
    console.error('Arda push velocity error:', error);
    await trackArdaSync(req, credentials, {
      operation: 'velocity_push',
      success: false,
      error: error instanceof Error ? error.message : 'Failed to push velocity items to Arda',
      actor,
    });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to push velocity items to Arda',
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
});

// Sync a single item from velocity data
router.post('/sync-item', async (req: Request, res: Response) => {
  let credentials: UserCredentials | undefined;
  let actor: ArdaActor | undefined;
  try {
    credentials = await getUserCredentials(req);
    const { author, ...profileData } = req.body;

    // Validate required fields
    if (!profileData.displayName || !profileData.supplier) {
      await trackArdaSync(req, credentials, {
        operation: 'velocity_item_sync',
        success: false,
        error: 'Missing required fields: displayName and supplier are required',
      });
      return res.status(400).json({
        error: 'Missing required fields: displayName and supplier are required',
      });
    }

    const actorResult = await resolveActorForWrite(req, author);
    credentials = actorResult.credentials;
    if (actorResult.error) {
      await trackArdaSync(req, credentials, {
        operation: 'velocity_item_sync',
        success: false,
        error: extractSyncErrorMessage(actorResult.error.body),
      });
      return res.status(actorResult.error.status).json(actorResult.error.body);
    }
    actor = actorResult.actor;

    console.log(`📤 Syncing item "${profileData.displayName}" to Arda for user ${credentials.email}`);

    const result = await createItemFromVelocity(profileData as ItemVelocityProfileInput, actor!);
    await trackArdaSync(req, credentials, {
      operation: 'velocity_item_sync',
      success: true,
      requested: 1,
      successful: 1,
      failed: 0,
      actor,
    });
    res.json({ success: true, record: result });
  } catch (error) {
    console.error('Arda sync item error:', error);
    await trackArdaSync(req, credentials, {
      operation: 'velocity_item_sync',
      success: false,
      error: error instanceof Error ? error.message : 'Failed to sync item from velocity data',
      actor,
    });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to sync item from velocity data',
    });
  }
});

// Get sync status for the current authenticated user/session.
router.get('/sync-status', async (req: Request, res: Response) => {
  try {
    const credentials = await getUserCredentials(req);
    const status = await getArdaSyncStatus(getSyncStatusUserKey(req, credentials));
    const hasAttempts = status.totalAttempts > 0;

    res.json({
      success: true,
      message: hasAttempts
        ? 'Sync status loaded'
        : 'No Arda sync attempts have been recorded for this session yet',
      user: credentials.email,
      ardaConfigured: ardaService.isConfigured(),
      ...status,
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
