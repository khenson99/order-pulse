import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().optional(),
  FRONTEND_URL: z.string().url().optional(),
  BACKEND_URL: z.string().url().optional(),
  SESSION_SECRET: z.string().min(10).optional(),
  ENCRYPTION_KEY: z.string().min(16).optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  ARDA_TENANT_ID: z.string().optional(),
  ARDA_API_KEY: z.string().optional(),
  ARDA_BASE_URL: z.string().url().optional(),
  ARDA_MOCK_MODE: z.enum(['true', 'false']).optional(),
  REDIS_URL: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().optional(),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().optional(),
  RATE_LIMIT_MAX: z.coerce.number().optional(),
  ENABLE_COGNITO_SYNC: z.enum(['true', 'false']).optional(),
  COGNITO_SYNC_HOUR: z.coerce.number().min(0).max(23).optional(),
  GITHUB_COGNITO_TOKEN: z.string().optional(),
  AMAZON_ACCESS_KEY: z.string().optional(),
  AMAZON_SECRET_KEY: z.string().optional(),
  AMAZON_PARTNER_TAG: z.string().optional(),
  BARCODE_LOOKUP_API_KEY: z.string().optional(),
  BARCODE_LOOKUP_USER_AGENT: z.string().optional(),
  UPCITEMDB_USER_KEY: z.string().optional(),
  UPCITEMDB_KEY_TYPE: z.enum(['3scale', 'rapidapi', 'rapidapi-free']).optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment configuration', parsed.error.format());
  throw new Error('Invalid environment configuration');
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === 'production';
export const allowInMemoryStorage = env.NODE_ENV !== 'production' || process.env.ALLOW_INMEMORY_STORAGE === 'true';
export const port = env.PORT || 3001;
export const corsOrigin = env.FRONTEND_URL || 'http://localhost:5173';

export const rateLimitConfig = {
  windowMs: env.RATE_LIMIT_WINDOW_MS ?? 60_000, // default 1 minute
  max: env.RATE_LIMIT_MAX ?? 120, // 120 req/min per IP
};

export const requireRedis = isProduction && !allowInMemoryStorage;
