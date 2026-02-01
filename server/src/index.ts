import './utils/loadEnv.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import session from 'express-session';
import connectRedis from 'connect-redis';
import * as Sentry from '@sentry/node';
import redisClient from './utils/redisClient.js';
import { authRouter } from './routes/auth.js';
import { gmailRouter } from './routes/gmail.js';
import { analysisRouter } from './routes/analysis.js';
import { ordersRouter } from './routes/orders.js';
import { jobsRouter } from './routes/jobs.js';
import { discoverRouter } from './routes/discover.js';
import { amazonRouter } from './routes/amazon.js';
import ardaRouter from './routes/arda.js';
import cognitoRouter from './routes/cognito.js';
import { cognitoService } from './services/cognito.js';
import { initializeJobManager } from './services/jobManager.js';
import { startCognitoSyncScheduler } from './services/cognitoScheduler.js';

// Debug: Log OAuth config status
console.log('🔐 OAuth Config:', {
  clientId: process.env.GOOGLE_CLIENT_ID ? `${process.env.GOOGLE_CLIENT_ID.substring(0, 20)}...` : '❌ MISSING',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET ? '✓ Set' : '❌ MISSING',
  geminiKey: process.env.GEMINI_API_KEY ? '✓ Set' : '❌ MISSING',
  ardaTenant: process.env.ARDA_TENANT_ID ? '✓ Set' : '❌ MISSING',
});

const app = express();
const sentryDsn = process.env.SENTRY_DSN;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE) || 0.1,
  });
}
const PORT = process.env.PORT || 3001;
const isProduction = process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT === 'production';
const requiredSecrets = [
  'SESSION_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GEMINI_API_KEY',
  'ARDA_TENANT_ID',
];
for (const key of requiredSecrets) {
  if (!process.env[key]) {
    const message = `${key} is recommended to run OrderPulse`;
    if (isProduction) {
      throw new Error(`${key} is required in production`);
    }
    console.warn(`⚠️ ${message}`);
  }
}
if (isProduction && !process.env.REDIS_URL) {
  throw new Error('REDIS_URL is required in production');
}

// Trust proxy for Railway (required for secure cookies behind reverse proxy)
if (isProduction) {
  app.set('trust proxy', 1);
}

const sessionSecret = process.env.SESSION_SECRET || 'dev-secret-change-in-production';
const RedisSessionStore = connectRedis(session);
const sessionStore = redisClient ? new RedisSessionStore({ client: redisClient }) : undefined;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
// Increase body parser limit for large email payloads (500 emails can be ~10MB)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Session configuration
app.use(session({
  store: sessionStore,
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProduction,
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: isProduction ? 'none' : 'lax',
  },
}));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/auth', authRouter);
app.use('/api/gmail', gmailRouter);
app.use('/api/analyze', analysisRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/arda', ardaRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/cognito', cognitoRouter);
app.use('/api/discover', discoverRouter);
app.use('/api/amazon', amazonRouter);

// Error handler

app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Server error:', err);
  if (sentryDsn) {
    Sentry.captureException(err);
  }
  res.status(500).json({ error: 'Internal server error' });
});

async function startServer() {
  await initializeJobManager();

  app.listen(PORT, () => {
    console.log(`🚀 OrderPulse API running on http://localhost:${PORT}`);
    console.log(`📧 Frontend URL: ${process.env.FRONTEND_URL}`);
    
    startCognitoSyncScheduler();
    
    const status = cognitoService.getSyncStatus();
    console.log(`👥 Cognito users: ${status.userCount} loaded`);
  });
}

startServer().catch((error) => {
  console.error('Failed to start OrderPulse API:', error);
  process.exit(1);
});

export default app;
