import redisClient from '../utils/redisClient.js';
import { cognitoService } from './cognito.js';

const LOCK_KEY = 'orderpulse:cognito:lock';
const LOCK_TTL = 1000 * 60 * 60 * 3; // 3 hours
let syncTimeout: ReturnType<typeof setTimeout> | null = null;

function shouldRunCognitoSync(): boolean {
  if (process.env.ENABLE_COGNITO_SYNC === 'false') {
    console.log('⚠️ Cognito sync disabled via ENABLE_COGNITO_SYNC=false');
    return false;
  }
  if (!redisClient) {
    console.warn('⚠️ Redis unavailable; skipping scheduled Cognito sync');
    return false;
  }
  return true;
}

function getNextRunDelay(hour: number): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

async function runCognitoSync() {
  if (!redisClient) return;
  const lock = await redisClient.set(LOCK_KEY, 'locked', 'NX', 'PX', LOCK_TTL);
  if (!lock) {
    console.log('⏳ Cognito sync already running on another instance');
    return;
  }

  try {
    console.log('🔄 Running scheduled Cognito sync...');
    await cognitoService.syncUsersFromGitHub();
    console.log('✅ Scheduled Cognito sync completed');
  } catch (error) {
    console.error('❌ Scheduled Cognito sync failed:', error);
  } finally {
    await redisClient.del(LOCK_KEY).catch((err: Error) => {
      console.error('Failed to release Cognito sync lock:', err);
    });
  }
}

export function startCognitoSyncScheduler(): void {
  if (syncTimeout) return; // already scheduled
  if (!shouldRunCognitoSync()) return;

  const syncHour = Number(process.env.COGNITO_SYNC_HOUR ?? '2');

  const scheduleNext = () => {
    const delay = getNextRunDelay(syncHour);
    console.log(`⏰ Next Cognito sync scheduled in ${Math.round(delay / 1000 / 60)} minutes`);
    syncTimeout = setTimeout(async () => {
      await runCognitoSync();
      scheduleNext();
    }, delay);
  };

  scheduleNext();
}

export function stopCognitoSyncScheduler(): void {
  if (syncTimeout) {
    clearTimeout(syncTimeout);
    syncTimeout = null;
  }
}
