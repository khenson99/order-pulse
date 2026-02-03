import { Router, Request, Response } from 'express';
import { google } from 'googleapis';
import redisClient from '../utils/redisClient.js';
import { requireRedis } from '../config.js';
import { saveUser, getUserById, deleteUser, getUserEmail as getUserEmailFromStore, StoredUser } from '../services/userStore.js';

const router = Router();

// In-memory storage (for development without PostgreSQL)
const users = new Map<string, StoredUser>(); // local cache for dev

// Short-lived auth tokens for cross-origin authentication
// Token -> { userId, expiresAt }
const authTokens = new Map<string, { userId: string; expiresAt: Date }>();

function generateAuthToken(userId: string): string {
  const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
  // Token expires in 60 seconds (just enough for the redirect)
  authTokens.set(token, { userId, expiresAt: new Date(Date.now() + 60000) });
  return token;
}

function consumeAuthToken(token: string): string | null {
  const data = authTokens.get(token);
  if (!data) return null;
  authTokens.delete(token); // One-time use
  if (data.expiresAt < new Date()) return null;
  return data.userId;
}

export async function getUserEmail(userId: string): Promise<string | null> {
  return getUserEmailFromStore(userId);
}

function ensureRedis(res: Response): boolean {
  if (requireRedis && !redisClient) {
    res.status(503).json({ error: 'Redis unavailable; authentication persistence is required in production' });
    return false;
  }
  return true;
}

// Create OAuth2 client lazily (after env vars are loaded)
function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.BACKEND_URL}/auth/google/callback`
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

// Initiate Google OAuth flow
router.get('/google', (req: Request, res: Response) => {
  const oauth2Client = getOAuth2Client();
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });
  console.log('🔗 Redirecting to:', authUrl.substring(0, 100) + '...');
  res.redirect(authUrl);
});

// OAuth callback handler
router.get('/google/callback', async (req: Request, res: Response) => {
  const { code } = req.query;
  
  if (!code || typeof code !== 'string') {
    return res.redirect(`${process.env.FRONTEND_URL}?error=no_code`);
  }

  try {
    if (!ensureRedis(res)) return;
    const oauth2Client = getOAuth2Client();
    
    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get user info
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();

    if (!userInfo.id || !userInfo.email) {
      throw new Error('Missing user info from Google');
    }

    // Store user
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
    
    await saveUser(userData);
    console.log(`✅ User authenticated: ${userData.name} (${userData.email})`);

    // Generate a short-lived auth token for cross-origin cookie setting
    const authToken = generateAuthToken(userId);

    // Set session (for same-origin requests)
    req.session.userId = userId;

    // Redirect to frontend with auth token
    res.redirect(`${process.env.FRONTEND_URL}?auth=success&token=${authToken}`);
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.redirect(`${process.env.FRONTEND_URL}?error=auth_failed`);
  }
});

// Token exchange endpoint - converts short-lived token to session cookie
// This is called by the frontend to establish the session in a same-origin context
router.get('/token-exchange', async (req: Request, res: Response) => {
  const { token } = req.query;
  
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Missing token' });
  }

  const userId = consumeAuthToken(token);
  if (!userId) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const user = await getUserById(userId);
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }

  // Set session
  req.session.userId = userId;
  console.log(`🔄 Token exchange successful for ${user.email}`);

  res.json({ 
    success: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      picture_url: user.picture,
    }
  });
});

// Get current user
router.get('/me', async (req: Request, res: Response) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const user = await getUserById(req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'User not found' });
  }

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
