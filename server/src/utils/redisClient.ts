import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let redisClient: any = null;

if (redisUrl) {
  try {
    // @ts-ignore - ioredis ESM/CJS compat
    redisClient = new Redis(redisUrl);
    redisClient.on('error', (error: Error) => {
      console.error('Redis connection error:', error);
    });
    redisClient.on('connect', () => {
      console.log('✅ Connected to Redis');
    });
  } catch (error) {
    console.warn('⚠️ Failed to connect to Redis:', error);
    redisClient = null;
  }
} else {
  // Redis is optional - app will use in-memory storage
  console.warn('⚠️ REDIS_URL not set; using in-memory storage (data will not persist across restarts)');
}

export default redisClient;
