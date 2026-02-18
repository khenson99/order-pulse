import redisClient from '../../utils/redisClient.js';
import { accountingSyncIntervalMinutes, enableAccountingConnectors } from '../../config.js';
import { appLogger } from '../../middleware/requestLogger.js';
import { listActiveProviderConnections } from './store.js';
import { enqueueProviderSync } from './syncOrchestrator.js';

const LOCK_KEY = 'orderpulse:integrations:sync:lock';
const LOCK_TTL_MS = 1000 * 60 * 10;

let intervalHandle: ReturnType<typeof setInterval> | null = null;

async function runScheduledSyncTick(): Promise<void> {
  if (!redisClient) {
    appLogger.warn('Redis unavailable; skipping scheduled accounting sync tick');
    return;
  }

  const lock = await redisClient.set(LOCK_KEY, 'locked', 'PX', LOCK_TTL_MS, 'NX');
  if (!lock) {
    appLogger.debug('Accounting sync tick skipped because another instance holds the lock');
    return;
  }

  try {
    const connections = await listActiveProviderConnections();
    for (const connection of connections) {
      try {
        await enqueueProviderSync(connection.id, connection.userId, 'scheduled');
      } catch (error) {
        appLogger.error(
          { err: error, connectionId: connection.id, provider: connection.provider },
          'Failed to enqueue scheduled provider sync',
        );
      }
    }
  } finally {
    await redisClient.del(LOCK_KEY).catch((error: Error) => {
      appLogger.error({ err: error }, 'Failed to release accounting sync lock');
    });
  }
}

export function startProviderSyncScheduler(): void {
  if (intervalHandle) return;
  if (!enableAccountingConnectors) {
    appLogger.info('Accounting connector scheduler disabled via ENABLE_ACCOUNTING_CONNECTORS=false');
    return;
  }

  const intervalMs = Math.max(1, accountingSyncIntervalMinutes) * 60 * 1000;
  appLogger.info({ intervalMinutes: accountingSyncIntervalMinutes }, 'Starting accounting provider sync scheduler');

  intervalHandle = setInterval(() => {
    void runScheduledSyncTick();
  }, intervalMs);

  void runScheduledSyncTick();
}

export function stopProviderSyncScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
