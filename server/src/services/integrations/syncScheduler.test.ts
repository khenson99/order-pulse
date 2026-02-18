import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface SchedulerTestSetup {
  redisClient: { set: ReturnType<typeof vi.fn>; del: ReturnType<typeof vi.fn> } | null;
  enableAccountingConnectors?: boolean;
  accountingSyncIntervalMinutes?: number;
  connections?: Array<{ id: string; userId: string; provider: 'quickbooks' | 'xero' }>;
  enqueueImpl?: (connectionId: string, userId: string, trigger: 'scheduled') => Promise<unknown>;
}

async function setupSchedulerTest(options: SchedulerTestSetup) {
  vi.resetModules();

  const listActiveProviderConnections = vi.fn().mockResolvedValue(options.connections || []);
  const enqueueProviderSync = vi.fn(
    options.enqueueImpl || (() => Promise.resolve({ runId: 'run-1' })),
  );

  const appLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  };

  vi.doMock('../../utils/redisClient.js', () => ({
    default: options.redisClient,
  }));

  vi.doMock('../../config.js', () => ({
    enableAccountingConnectors: options.enableAccountingConnectors ?? true,
    accountingSyncIntervalMinutes: options.accountingSyncIntervalMinutes ?? 15,
  }));

  vi.doMock('./store.js', () => ({
    listActiveProviderConnections,
  }));

  vi.doMock('./syncOrchestrator.js', () => ({
    enqueueProviderSync,
  }));

  vi.doMock('../../middleware/requestLogger.js', () => ({
    appLogger,
  }));

  const scheduler = await import('./syncScheduler.js');
  return {
    ...scheduler,
    listActiveProviderConnections,
    enqueueProviderSync,
    appLogger,
  };
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('syncScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('logs and exits when connectors are disabled', async () => {
    const scheduler = await setupSchedulerTest({
      redisClient: {
        set: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1),
      },
      enableAccountingConnectors: false,
    });

    scheduler.startProviderSyncScheduler();
    await flushAsyncWork();
    scheduler.stopProviderSyncScheduler();

    expect(scheduler.appLogger.info).toHaveBeenCalledWith(
      'Accounting connector scheduler disabled via ENABLE_ACCOUNTING_CONNECTORS=false',
    );
    expect(scheduler.listActiveProviderConnections).not.toHaveBeenCalled();
  });

  it('warns and skips when Redis is unavailable', async () => {
    const scheduler = await setupSchedulerTest({
      redisClient: null,
      enableAccountingConnectors: true,
    });

    scheduler.startProviderSyncScheduler();
    await flushAsyncWork();
    scheduler.stopProviderSyncScheduler();

    expect(scheduler.appLogger.warn).toHaveBeenCalledWith(
      'Redis unavailable; skipping scheduled accounting sync tick',
    );
    expect(scheduler.listActiveProviderConnections).not.toHaveBeenCalled();
  });

  it('skips tick when lock is not acquired', async () => {
    const redisClient = {
      set: vi.fn().mockResolvedValue(null),
      del: vi.fn().mockResolvedValue(1),
    };

    const scheduler = await setupSchedulerTest({
      redisClient,
      enableAccountingConnectors: true,
    });

    scheduler.startProviderSyncScheduler();
    await flushAsyncWork();
    scheduler.stopProviderSyncScheduler();

    expect(redisClient.set).toHaveBeenCalledTimes(1);
    expect(scheduler.appLogger.debug).toHaveBeenCalledWith(
      'Accounting sync tick skipped because another instance holds the lock',
    );
    expect(scheduler.listActiveProviderConnections).not.toHaveBeenCalled();
  });

  it('enqueues scheduled sync for active connections and releases lock', async () => {
    const redisClient = {
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
    };

    const scheduler = await setupSchedulerTest({
      redisClient,
      enableAccountingConnectors: true,
      connections: [
        { id: 'conn-1', userId: 'user-1', provider: 'quickbooks' },
        { id: 'conn-2', userId: 'user-2', provider: 'xero' },
      ],
    });

    scheduler.startProviderSyncScheduler();
    await flushAsyncWork();
    scheduler.stopProviderSyncScheduler();

    expect(scheduler.enqueueProviderSync).toHaveBeenCalledWith('conn-1', 'user-1', 'scheduled');
    expect(scheduler.enqueueProviderSync).toHaveBeenCalledWith('conn-2', 'user-2', 'scheduled');
    expect(redisClient.del).toHaveBeenCalledWith('orderpulse:integrations:sync:lock');
  });

  it('continues when a single enqueue fails and still releases lock', async () => {
    const redisClient = {
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
    };

    const scheduler = await setupSchedulerTest({
      redisClient,
      enableAccountingConnectors: true,
      connections: [
        { id: 'conn-1', userId: 'user-1', provider: 'quickbooks' },
        { id: 'conn-2', userId: 'user-2', provider: 'xero' },
      ],
      enqueueImpl: async (connectionId) => {
        if (connectionId === 'conn-1') {
          throw new Error('boom');
        }
        return { runId: 'run-2' };
      },
    });

    scheduler.startProviderSyncScheduler();
    await flushAsyncWork();
    scheduler.stopProviderSyncScheduler();

    expect(scheduler.enqueueProviderSync).toHaveBeenCalledTimes(2);
    expect(scheduler.appLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'conn-1',
        provider: 'quickbooks',
      }),
      'Failed to enqueue scheduled provider sync',
    );
    expect(redisClient.del).toHaveBeenCalledWith('orderpulse:integrations:sync:lock');
  });
});
