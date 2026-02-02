import { Router, Request, Response } from 'express';
import { google } from 'googleapis';
import rateLimit from 'express-rate-limit';
import redisClient from '../utils/redisClient.js';
import { corsOrigin, isProduction, requireRedis } from '../config.js';
import { saveUser, getUserById, deleteUser, getUserEmail as getUserEmailFromStore, StoredUser } from '../services/userStore.js';

const router = Router();
type CachedUser = StoredUser & { _cachedAt?: number };

// Rate limit only OAuth endpoints (not /me which is called frequently)
const oauthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 OAuth attempts per 15 min
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many authentication attempts. Please try again later.',
});

// In-memory storage (for development without PostgreSQL)
const users = new Map<string, CachedUser>(); // local cache for dev

export async function getUserEmail(userId: string): Promise<string | null> {
  return getUserEmailFromStore(userId);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderAuthErrorPage(title: string, details: string[], meta?: Record<string, string>) {
  const metaRows = meta
    ? Object.entries(meta)
        .map(([k, v]) => `<div><strong>${escapeHtml(k)}:</strong> <code>${escapeHtml(v)}</code></div>`)
        .join('')
    : '';
  const detailLis = details.map(d => `<li>${escapeHtml(d)}</li>`).join('');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OrderPulse Auth Error</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; background: #0b1220; color: #e5e7eb; padding: 24px; }
      .card { max-width: 820px; margin: 0 auto; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; padding: 20px; }
      h1 { font-size: 20px; margin: 0 0 10px; }
      ul { margin: 10px 0 0 18px; }
      code { background: rgba(255,255,255,0.08); padding: 2px 6px; border-radius: 6px; }
      .muted { color: #9ca3af; font-size: 13px; margin-top: 12px; line-height: 1.4; }
      a { color: #fb923c; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${escapeHtml(title)}</h1>
      ${metaRows ? `<div class="muted">${metaRows}</div>` : ''}
      <ul>${detailLis}</ul>
      <div class="muted">
        Fix by setting server env vars (recommended: copy <code>order-pulse/server/.env.example</code> to <code>order-pulse/server/.env</code>).<br/>
        Make sure Google OAuth “Authorized redirect URIs” includes <code>BACKEND_URL/auth/google/callback</code>.
      </div>
    </div>
  </body>
</html>`;
}

function ensureRedis(res: Response): boolean {
  if (requireRedis && !redisClient) {
    res.status(503).send(
      renderAuthErrorPage(
        'Redis unavailable',
        [
          'Authentication persistence is required in this environment.',
          'Set REDIS_URL, or set ALLOW_INMEMORY_STORAGE=true for demo-only usage.',
        ],
        {
          NODE_ENV: process.env.NODE_ENV || 'development',
          requireRedis: String(requireRedis),
        }
      )
    );
    return false;
  }
  return true;
}

function baseUrlFromRequest(req: Request): string | null {
  const forwardedProto =
    typeof req.headers['x-forwarded-proto'] === 'string'
      ? req.headers['x-forwarded-proto'].split(',')[0]?.trim()
      : undefined;
  const proto = forwardedProto || req.protocol;
  const host = req.get('host');
  if (!host) return null;
  return `${proto}://${host}`;
}

function getBackendUrl(req?: Request): string | null {
  const envUrl = typeof process.env.BACKEND_URL === 'string' ? process.env.BACKEND_URL.trim() : '';
  if (envUrl) return envUrl.replace(/\/+$/, '');
  if (!req) return null;
  return baseUrlFromRequest(req);
}

function getFrontendUrl(): string {
  const envUrl = typeof process.env.FRONTEND_URL === 'string' ? process.env.FRONTEND_URL.trim() : '';
  const url = envUrl || corsOrigin || 'http://localhost:5173';
  return url.replace(/\/+$/, '');
}

// Create OAuth2 client lazily (after env vars are loaded)
function getOAuth2Client(req?: Request) {
  const clientId = typeof process.env.GOOGLE_CLIENT_ID === 'string' ? process.env.GOOGLE_CLIENT_ID.trim() : '';
  const clientSecret =
    typeof process.env.GOOGLE_CLIENT_SECRET === 'string' ? process.env.GOOGLE_CLIENT_SECRET.trim() : '';
  const backendUrl = getBackendUrl(req);

  const missing: string[] = [];
  if (!clientId) missing.push('GOOGLE_CLIENT_ID');
  if (!clientSecret) missing.push('GOOGLE_CLIENT_SECRET');
  if (!backendUrl) missing.push('BACKEND_URL');

  if (missing.length > 0) {
    throw new Error(`Missing required OAuth config: ${missing.join(', ')}`);
  }

  const redirectUri = `${backendUrl}/auth/google/callback`;
  return new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri
  );
}

// Scopes for Gmail access
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
];

// Extend session type
declare module 'express-session' {
  interface SessionData {
    userId: string;
  }
}

// Initiate Google OAuth flow (rate limited)
router.get('/google', oauthLimiter, (req: Request, res: Response) => {
  try {
    const oauth2Client = getOAuth2Client(req);
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      // Faster repeat logins: only force account picker, skip full consent when already granted
      prompt: 'select_account',
    });
    console.log('🔗 Redirecting to:', authUrl.substring(0, 140) + '...');
    res.redirect(authUrl);
  } catch (error: any) {
    const frontendUrl = getFrontendUrl();
    const backendUrl = getBackendUrl(req) || '(derived: unavailable)';
    const message = error?.message || String(error);
    res.status(500).send(
      renderAuthErrorPage(
        'OAuth is not configured',
        [
          message,
          `Frontend URL: ${frontendUrl}`,
          `Backend URL: ${backendUrl}`,
        ],
        {
          NODE_ENV: process.env.NODE_ENV || 'development',
        }
      )
    );
  }
});

// OAuth callback handler (rate limited)
router.get('/google/callback', oauthLimiter, async (req: Request, res: Response) => {
  const frontendUrl = getFrontendUrl();
  const backendUrl = getBackendUrl(req) || process.env.BACKEND_URL || '';
  const redirectParams = new URLSearchParams();

  const oauthError = typeof req.query.error === 'string' ? req.query.error : null;
  const oauthErrorDescription = typeof req.query.error_description === 'string' ? req.query.error_description : null;
  if (oauthError) {
    redirectParams.set('error', oauthError);
    if (oauthErrorDescription) redirectParams.set('error_description', oauthErrorDescription);
    return res.redirect(`${frontendUrl}?${redirectParams.toString()}`);
  }

  const { code } = req.query;
  
  if (!code || typeof code !== 'string') {
    redirectParams.set('error', 'no_code');
    redirectParams.set('error_description', 'Google did not return an authorization code.');
    return res.redirect(`${frontendUrl}?${redirectParams.toString()}`);
  }

  try {
    // Skip Redis check - we can use in-memory session store for dev
    const oauth2Client = getOAuth2Client(req);
    
    // Exchange code for tokens
    console.log('🔄 Exchanging code for tokens...');
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get user info (run in parallel with nothing else, but keep it simple)
    console.log('👤 Fetching user info...');
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();

    if (!userInfo.id || !userInfo.email) {
      throw new Error('Missing user info from Google');
    }

    // Store user (fast - uses memory if DB unavailable)
    const userId = userInfo.id;
    const userData: StoredUser = {
      id: userId,
      googleId: userInfo.id,
      email: userInfo.email,
      name: userInfo.name || '',
      picture: userInfo.picture || '',
      accessToken: tokens.access_token || '',
      refreshToken: tokens.refresh_token || '',
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : new Date(Date.now() + 3600 * 1000),
    };
    
    // Don't await - save in background
    saveUser(userData).catch((err) => console.error('Failed to persist user:', err));
    
    // Also store in local memory for immediate access
    users.set(userId, userData);
    
    console.log(`✅ User authenticated: ${userData.name} (${userData.email})`);

    // Set session
    req.session.userId = userId;

    // Redirect to frontend immediately
    redirectParams.set('auth', 'success');
    res.redirect(`${frontendUrl}?${redirectParams.toString()}`);
  } catch (error) {
    console.error('OAuth callback error:', error);
    redirectParams.set('error', 'auth_failed');
    if (!isProduction) {
      const msg = (error as any)?.message ? String((error as any).message) : String(error);
      redirectParams.set('message', msg.slice(0, 220));
      if (backendUrl) redirectParams.set('backend', backendUrl.toString().slice(0, 120));
    }
    res.redirect(`${frontendUrl}?${redirectParams.toString()}`);
  }
});

// Get current user
router.get('/me', async (req: Request, res: Response) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // Fast path: check local memory first (with TTL)
  const cacheTtlMs = 60_000; // 60 seconds
  const cached = users.get(req.session.userId);
  if (cached && cached._cachedAt && Date.now() - cached._cachedAt <= cacheTtlMs) {
    return res.json({ 
      user: {
        id: cached.id,
        email: cached.email,
        name: cached.name,
        picture_url: cached.picture,
      }
    });
  }

  let user = (cached as StoredUser | undefined) || null;
  
  // Fall back to persistent store
  if (!user) {
    user = await getUserById(req.session.userId);
  }
  
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'User not found' });
  }

  // Cache locally for future requests
  const now = Date.now();
  users.set(user.id, { ...user, _cachedAt: now });

  res.json({ 
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      picture_url: user.picture,
    }
  });
});

// Logout
router.post('/logout', async (req: Request, res: Response) => {
  if (req.session.userId) {
    users.delete(req.session.userId);
    await deleteUser(req.session.userId);
    req.session.destroy((err) => {
      if (err) {
        console.error('Session destroy error:', err);
      }
    });
  }
  res.json({ success: true });
});

// Get valid access token (with auto-refresh)
export async function getValidAccessToken(userId: string): Promise<string | null> {
  const user = await getUserById(userId);
  if (!user) {
    return null;
  }

  // Check if token is expired (with 5 min buffer)
  const isExpired = user.expiresAt.getTime() < Date.now() + 5 * 60 * 1000;

  if (!isExpired) {
    return user.accessToken;
  }

  // Refresh the token
  try {
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({ refresh_token: user.refreshToken });
    const { credentials } = await oauth2Client.refreshAccessToken();

    // Update stored tokens
    user.accessToken = credentials.access_token || '';
    user.expiresAt = credentials.expiry_date 
      ? new Date(credentials.expiry_date) 
      : new Date(Date.now() + 3600 * 1000);

    console.log(`🔄 Token refreshed for ${user.email}`);
    return user.accessToken;
  } catch (error) {
    console.error('Token refresh error:', error);
    return null;
  }
}

export { router as authRouter };
