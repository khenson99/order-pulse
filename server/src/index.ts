import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import session from 'express-session';
import dotenv from 'dotenv';
import { authRouter } from './routes/auth.js';
import { gmailRouter } from './routes/gmail.js';
import { analysisRouter } from './routes/analysis.js';
import { ordersRouter } from './routes/orders.js';
import { jobsRouter } from './routes/jobs.js';
import { discoverRouter } from './routes/discover.js';
import ardaRouter from './routes/arda.js';
import cognitoRouter from './routes/cognito.js';
import { cognitoService } from './services/cognito.js';

// Load .env from server directory (npm run dev runs from server/)
dotenv.config();

// Debug: Log OAuth config status
console.log('🔐 OAuth Config:', {
  clientId: process.env.GOOGLE_CLIENT_ID ? `${process.env.GOOGLE_CLIENT_ID.substring(0, 20)}...` : '❌ MISSING',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET ? '✓ Set' : '❌ MISSING',
  geminiKey: process.env.GEMINI_API_KEY ? '✓ Set' : '❌ MISSING',
  ardaTenant: process.env.ARDA_TENANT_ID ? '✓ Set' : '❌ MISSING',
});

const app = express();
const PORT = process.env.PORT || 3001;
const isProduction = process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT === 'production';

// Trust proxy for Railway (required for secure cookies behind reverse proxy)
if (isProduction) {
  app.set('trust proxy', 1);
}

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
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
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

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Daily Cognito sync scheduler (runs at 2 AM every day)
function scheduleDailyCognitoSync() {
  const SYNC_HOUR = 2; // 2 AM
  
  function scheduleNext() {
    const now = new Date();
    const next = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + (now.getHours() >= SYNC_HOUR ? 1 : 0),
      SYNC_HOUR,
      0,
      0,
      0
    );
    
    const msUntilNext = next.getTime() - now.getTime();
    console.log(`⏰ Next Cognito sync scheduled for: ${next.toISOString()}`);
    
    setTimeout(async () => {
      console.log('🔄 Running scheduled Cognito sync...');
      try {
        await cognitoService.syncUsersFromGitHub();
        console.log('✅ Scheduled Cognito sync completed');
      } catch (error) {
        console.error('❌ Scheduled Cognito sync failed:', error);
      }
      scheduleNext(); // Schedule next day
    }, msUntilNext);
  }
  
  scheduleNext();
}

app.listen(PORT, () => {
  console.log(`🚀 OrderPulse API running on http://localhost:${PORT}`);
  console.log(`📧 Frontend URL: ${process.env.FRONTEND_URL}`);
  
  // Start daily sync scheduler
  scheduleDailyCognitoSync();
  
  // Log Cognito status
  const status = cognitoService.getSyncStatus();
  console.log(`👥 Cognito users: ${status.userCount} loaded`);
});

export default app;

