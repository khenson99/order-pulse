import { Router, Request, Response } from 'express';
import { google } from 'googleapis';
import redisClient from '../utils/redisClient.js';
import { requireRedis } from '../config.js';
import bcrypt from 'bcryptjs';
import {
  saveUser,
  getUserById,
  getUserEmail as getUserEmailFromStore,
  getUserByEmail,
  getUserByGoogleId,
  mergeUsers,
  StoredUser,
} from '../services/userStore.js';

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

export async function getUserAuthProvider(userId: string): Promise<'google' | 'local' | null> {
  const user = await getUserById(userId);
  if (!user) return null;
  return user.googleId ? 'google' : user.passwordHash ? 'local' : null;
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
    authProvider?: 'google' | 'local';
  }
}

// Initiate Google OAuth flow
router.get('/google', (req: Request, res: Response) => {
  const oauth2Client = getOAuth2Client();
  const returnTo = typeof req.query.returnTo === 'string' ? req.query.returnTo : '';
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    state: returnTo || undefined,
  });
  console.log('🔗 Redirecting to:', authUrl.substring(0, 100) + '...');
  res.redirect(authUrl);
});

// OAuth callback handler
router.get('/google/callback', async (req: Request, res: Response) => {
  const { code, state } = req.query;
  
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

    const returnTo = typeof state === 'string' && state.length > 0 ? state : '';

    const accessToken = tokens.access_token || '';
    const refreshToken = tokens.refresh_token || '';
    const expiresAt = tokens.expiry_date ? new Date(tokens.expiry_date) : new Date(Date.now() + 3600 * 1000);

    // If user already logged in, link Google account to existing user.
    if (req.session.userId) {
      const sessionUser = await getUserById(req.session.userId);
      if (!sessionUser) {
        return res.redirect(`${process.env.FRONTEND_URL}?error=auth_failed`);
      }

      if (sessionUser.googleId && sessionUser.googleId !== userInfo.id) {
        // User selected a different Google account than the one on the active session.
        // Reset the session and continue with a normal Google login to avoid auth loops.
        await new Promise<void>((resolve, reject) => {
          req.session.regenerate((err) => (err ? reject(err) : resolve()));
        });
      } else {
        const existingGoogleUser = await getUserByGoogleId(userInfo.id);
        if (existingGoogleUser && existingGoogleUser.id !== sessionUser.id) {
          await mergeUsers(existingGoogleUser.id, sessionUser.id);
        }

        const linkedUser: StoredUser = {
          ...sessionUser,
          googleId: userInfo.id,
          googleEmail: userInfo.email,
          accessToken,
          refreshToken: refreshToken || sessionUser.refreshToken,
          expiresAt,
          name: sessionUser.name || userInfo.name || '',
          picture: sessionUser.picture || userInfo.picture || '',
        };

        await saveUser(linkedUser);
        console.log(`✅ Gmail linked for user ${linkedUser.id} (${linkedUser.email})`);

        const authToken = generateAuthToken(linkedUser.id);
      req.session.userId = linkedUser.id;
      req.session.authProvider = linkedUser.googleId ? 'google' : 'local';

        const redirectTarget = `${process.env.FRONTEND_URL}?auth=success&token=${authToken}${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ''}`;
        return res.redirect(redirectTarget);
      }
    }

    // No existing session: login / create by Google account
    let user = await getUserByGoogleId(userInfo.id);
    if (!user) {
      const existingByEmail = await getUserByEmail(userInfo.email);
      if (existingByEmail) {
        user = {
          ...existingByEmail,
          googleId: userInfo.id,
          googleEmail: userInfo.email,
          accessToken,
          refreshToken: refreshToken || existingByEmail.refreshToken,
          expiresAt,
          name: existingByEmail.name || userInfo.name || '',
          picture: existingByEmail.picture || userInfo.picture || '',
        };
      } else {
        user = {
          id: userInfo.id,
          googleId: userInfo.id,
          googleEmail: userInfo.email,
          email: userInfo.email,
          name: userInfo.name || '',
          picture: userInfo.picture || '',
          accessToken,
          refreshToken,
          expiresAt,
        };
      }
    } else {
      user = {
        ...user,
        googleEmail: userInfo.email,
        accessToken,
        refreshToken: refreshToken || user.refreshToken,
        expiresAt,
        name: user.name || userInfo.name || '',
        picture: user.picture || userInfo.picture || '',
      };
    }

    await saveUser(user);
    console.log(`✅ User authenticated: ${user.name} (${user.email})`);

    // Generate a short-lived auth token for cross-origin cookie setting
    const authToken = generateAuthToken(user.id);

    // Set session (for same-origin requests)
    req.session.userId = user.id;
    req.session.authProvider = user.googleId ? 'google' : 'local';

    // Redirect to frontend with auth token
    const redirectTarget = `${process.env.FRONTEND_URL}?auth=success&token=${authToken}${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ''}`;
    res.redirect(redirectTarget);
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.redirect(`${process.env.FRONTEND_URL}?error=auth_failed`);
  }
});

router.post('/local/signup', async (req: Request, res: Response) => {
  const { email, password, name } = req.body as { email?: string; password?: string; name?: string };

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    if (!ensureRedis(res)) return;

    const existingUser = await getUserByEmail(normalizedEmail);
    if (existingUser && existingUser.passwordHash) {
      return res.status(409).json({ error: 'Account already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const userId = existingUser?.id || `local-${Math.random().toString(36).slice(2)}`;

    const userData: StoredUser = {
      id: userId,
      googleId: existingUser?.googleId || null,
      googleEmail: existingUser?.googleEmail || null,
      email: normalizedEmail,
      name: name || existingUser?.name || '',
      picture: existingUser?.picture || '',
      accessToken: existingUser?.accessToken || '',
      refreshToken: existingUser?.refreshToken || '',
      expiresAt: existingUser?.expiresAt || new Date(Date.now() + 3600 * 1000),
      passwordHash,
    };

    await saveUser(userData);
    req.session.userId = userId;
    req.session.authProvider = userData.googleId ? 'google' : 'local';

    res.json({
      success: true,
      user: {
        id: userData.id,
        email: userData.email,
        name: userData.name,
        picture_url: userData.picture,
      },
    });
  } catch (error) {
    console.error('Local signup error:', error);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

router.post('/local/login', async (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    if (!ensureRedis(res)) return;

    const user = await getUserByEmail(normalizedEmail);
    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    req.session.userId = user.id;
    req.session.authProvider = user.googleId ? 'google' : 'local';

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        picture_url: user.picture,
      },
    });
  } catch (error) {
    console.error('Local login error:', error);
    res.status(500).json({ error: 'Failed to sign in' });
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
  try {
    const user = await getUserById(userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Set session
    req.session.userId = userId;
    req.session.authProvider = 'google';
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
  } catch (error) {
    console.error('Token exchange error:', error);
    res.status(500).json({ error: 'Failed to establish session' });
  }
});

// Get current user
router.get('/me', async (req: Request, res: Response) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  try {
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
  } catch (error) {
    console.error('Auth me error:', error);
    res.status(500).json({ error: 'Failed to fetch current user' });
  }
});

// Logout
router.post('/logout', async (req: Request, res: Response) => {
  if (req.session.userId) {
    users.delete(req.session.userId);
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
