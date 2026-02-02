import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL;
let redisClient: Redis | null = null;

if (redisUrl) {
  try {
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

export async function closeRedisClient(): Promise<void> {
  if (!redisClient) return;
  try {
    await redisClient.quit();
  } catch (error) {
    console.error('Error closing Redis client:', error);
  }
}
