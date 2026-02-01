import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let redisClient: any = null;

if (redisUrl) {
  // @ts-ignore - ioredis ESM/CJS compat
  redisClient = new Redis(redisUrl);
  redisClient.on('error', (error: Error) => {
    console.error('Redis connection error:', error);
  });
  redisClient.on('connect', () => {
    console.log('✅ Connected to Redis');
  });
} else if (process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT) {
  throw new Error('REDIS_URL is required in production');
} else {
  console.warn('⚠️ Redis not configured; falling back to in-memory storage');
}

export default redisClient;
