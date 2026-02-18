import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icons } from '../components/Icons';
import {
  IntegrationConnection,
  IntegrationSyncRun,
  integrationsApi,
  isSessionExpiredError,
} from '../services/api';

interface Integration {
  name: string;
  category: 'erp' | 'inventory';
  description: string;
}

const INTEGRATIONS: Integration[] = [
  {
    name: 'NetSuite',
    category: 'erp',
    description: 'Cloud ERP for finance, operations, and supply chain.',
  },
  {
    name: 'Odoo',
    category: 'erp',
    description: 'Modular ERP platform for inventory, purchasing, and manufacturing.',
  },
  {
    name: 'Katana',
    category: 'inventory',
    description: 'Cloud inventory and manufacturing planning.',
  },
  {
    name: 'Fishbowl',
    category: 'inventory',
    description: 'Inventory and warehouse management with operations workflows.',
  },
  {
    name: 'Cin7',
    category: 'inventory',
    description: 'Multi-channel inventory and order orchestration.',
  },
  {
    name: 'Finale Inventory',
    category: 'inventory',
    description: 'Warehouse and inventory control with barcode operations.',
  },
  {
    name: 'SOS Inventory',
    category: 'inventory',
    description: 'Inventory and order management focused on SMB operations.',
  },
  {
    name: 'Sortly',
    category: 'inventory',
    description: 'Simple inventory tracking with mobile-first workflows.',
  },
];

const CATEGORY_CONFIG = {
  erp: {
    title: 'Cloud ERP',
    icon: Icons.Building2,
  },
  inventory: {
    title: 'Inventory Solutions',
    icon: Icons.Package,
  },
} as const;

const SESSION_EXPIRED_MESSAGE = 'Session expired. Please sign in again.';

export const IntegrationsStep: React.FC = () => {
  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  const [runsByConnection, setRunsByConnection] = useState<Record<string, IntegrationSyncRun | undefined>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [actionKey, setActionKey] = useState<string | null>(null);

  const getErrorMessage = useCallback((input: unknown, fallback: string): string => {
    if (isSessionExpiredError(input)) {
      return SESSION_EXPIRED_MESSAGE;
    }
    return input instanceof Error && input.message ? input.message : fallback;
  }, []);

  const loadConnections = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const { connections: loadedConnections } = await integrationsApi.listConnections();
      setConnections(loadedConnections);

      const runPairs = await Promise.all(
        loadedConnections.map(async (connection) => {
          try {
            const { runs } = await integrationsApi.getConnectionRuns(connection.id);
            return [connection.id, runs[0]] as const;
          } catch {
            return [connection.id, undefined] as const;
          }
        }),
      );

      const nextRuns: Record<string, IntegrationSyncRun | undefined> = {};
      runPairs.forEach(([connectionId, run]) => {
        nextRuns[connectionId] = run;
      });
      setRunsByConnection(nextRuns);
    } catch (loadError) {
      const message = getErrorMessage(loadError, 'Failed to load accounting integrations.');
      if (!message.toLowerCase().includes('disabled')) {
        setError(message);
      }
      setConnections([]);
      setRunsByConnection({});
    } finally {
      setIsLoading(false);
    }
  }, [getErrorMessage]);

  const handleConnect = useCallback(async (provider: 'quickbooks' | 'xero') => {
    setActionKey(`connect:${provider}`);
    setError(null);
    setNotice(null);
    try {
      const { authUrl } = await integrationsApi.connectProvider(provider);
      window.location.assign(authUrl);
    } catch (connectError) {
      setError(getErrorMessage(connectError, `Failed to connect ${provider}.`));
    } finally {
      setActionKey(null);
    }
  }, [getErrorMessage]);

  const handleSync = useCallback(async (connectionId: string) => {
    setActionKey(`sync:${connectionId}`);
    setError(null);
    try {
      await integrationsApi.syncConnection(connectionId);
      setNotice('Sync started. Refreshing status shortly...');
      window.setTimeout(() => {
        void loadConnections();
      }, 2500);
    } catch (syncError) {
      setError(getErrorMessage(syncError, 'Failed to start provider sync.'));
    } finally {
      setActionKey(null);
    }
  }, [getErrorMessage, loadConnections]);

  const handleDisconnect = useCallback(async (connectionId: string) => {
    setActionKey(`disconnect:${connectionId}`);
    setError(null);
    try {
      await integrationsApi.disconnectConnection(connectionId);
      setNotice('Integration disconnected.');
      await loadConnections();
    } catch (disconnectError) {
      setError(getErrorMessage(disconnectError, 'Failed to disconnect integration.'));
    } finally {
      setActionKey(null);
    }
  }, [getErrorMessage, loadConnections]);

  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const provider = params.get('integration_provider');
    const status = params.get('integration_status');
    const reason = params.get('integration_reason');

    if (!provider || !status) return;

    if (status === 'connected') {
      setNotice(`${provider === 'quickbooks' ? 'QuickBooks' : 'Xero'} connected. Initial backfill started.`);
    } else {
      setError(reason || `Failed to connect ${provider}.`);
    }

    params.delete('integration_provider');
    params.delete('integration_status');
    params.delete('integration_reason');
    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash || ''}`;
    window.history.replaceState({}, document.title, nextUrl);
  }, []);

  const connectionByProvider = useMemo(() => {
    const map = new Map<'quickbooks' | 'xero', IntegrationConnection>();
    for (const connection of connections) {
      if (connection.provider === 'quickbooks' || connection.provider === 'xero') {
        map.set(connection.provider, connection);
      }
    }
    return map;
  }, [connections]);

  const grouped = useMemo(() => ({
    erp: INTEGRATIONS.filter(integration => integration.category === 'erp'),
    inventory: INTEGRATIONS.filter(integration => integration.category === 'inventory'),
  }), []);

  return (
    <div className="space-y-6">
      <section className="arda-glass rounded-2xl p-6 border border-arda-border/80">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-50 border border-orange-100 flex items-center justify-center text-arda-accent">
            <Icons.Zap className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-arda-text-primary">Integrations</h2>
            <p className="text-sm text-arda-text-secondary mt-1 max-w-3xl">
              Connect accounting platforms here. Step 1 now focuses only on email discovery.
            </p>
          </div>
        </div>
      </section>

      <section className="border-2 border-emerald-200 bg-emerald-50 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xl font-bold text-arda-text-primary">Accounting Integrations</h3>
            <p className="text-sm text-arda-text-secondary">
              Import purchase orders from QuickBooks and Xero into Orders.
            </p>
          </div>
          {isLoading && (
            <div className="flex items-center gap-2 text-emerald-700 text-sm">
              <Icons.Loader2 className="w-4 h-4 animate-spin" />
              Refreshing
            </div>
          )}
        </div>

        {notice && (
          <div className="bg-emerald-100 border border-emerald-300 rounded-lg px-3 py-2 text-sm text-emerald-800">
            {notice}
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(['quickbooks', 'xero'] as const).map(provider => {
            const connection = connectionByProvider.get(provider);
            const latestRun = connection ? (runsByConnection[connection.id] || connection.lastRun) : undefined;
            const providerLabel = provider === 'quickbooks' ? 'QuickBooks' : 'Xero';
            const isConnected = Boolean(connection && connection.status === 'connected');
            const statusText = !connection
              ? 'Not connected'
              : connection.status === 'connected'
                ? `Connected${connection.tenantName ? ` • ${connection.tenantName}` : ''}`
                : connection.status === 'reauth_required'
                  ? 'Reconnect required'
                  : connection.status;
            const runSummary = latestRun
              ? latestRun.status === 'failed'
                ? latestRun.error || 'Last sync failed'
                : latestRun.status === 'running'
                  ? 'Sync in progress'
                  : (() => {
                    const orders = typeof (latestRun as any).ordersUpserted === 'number' ? (latestRun as any).ordersUpserted : undefined;
                    const items = typeof (latestRun as any).itemsUpserted === 'number' ? (latestRun as any).itemsUpserted : undefined;
                    if (orders !== undefined || items !== undefined) {
                      return `Last sync: ${orders ?? 0} orders, ${items ?? 0} items`;
                    }
                    return 'Last sync completed';
                  })()
              : 'No sync runs yet';

            const connectActionKey = `connect:${provider}`;
            const syncActionKey = connection ? `sync:${connection.id}` : '';
            const disconnectActionKey = connection ? `disconnect:${connection.id}` : '';

            return (
              <div key={provider} className="bg-white border border-emerald-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icons.Link className="w-4 h-4 text-emerald-700" />
                    <span className="font-semibold text-arda-text-primary">{providerLabel}</span>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    isConnected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {statusText}
                  </span>
                </div>

                <p className="text-xs text-arda-text-secondary">{runSummary}</p>

                <div className="flex items-center gap-2">
                  {!isConnected ? (
                    <button
                      type="button"
                      onClick={() => void handleConnect(provider)}
                      disabled={actionKey !== null}
                      className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {actionKey === connectActionKey ? 'Connecting...' : connection?.status === 'reauth_required' ? `Reconnect ${providerLabel}` : `Connect ${providerLabel}`}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => connection && void handleSync(connection.id)}
                        disabled={actionKey !== null}
                        className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1"
                      >
                        <Icons.RefreshCw className={`w-3.5 h-3.5 ${actionKey === syncActionKey ? 'animate-spin' : ''}`} />
                        {actionKey === syncActionKey ? 'Syncing...' : 'Sync now'}
                      </button>
                      <button
                        type="button"
                        onClick={() => connection && void handleDisconnect(connection.id)}
                        disabled={actionKey !== null}
                        className="px-3 py-2 rounded-lg border border-gray-300 text-sm font-medium text-arda-text-secondary hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {actionKey === disconnectActionKey ? 'Disconnecting...' : 'Disconnect'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {(Object.keys(grouped) as Array<keyof typeof grouped>).map(category => {
        const config = CATEGORY_CONFIG[category];
        const CategoryIcon = config.icon;

        return (
          <section key={category} className="bg-white border border-arda-border rounded-2xl p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <CategoryIcon className="w-4 h-4 text-arda-accent" />
              <h3 className="text-sm font-semibold text-arda-text-primary">{config.title}</h3>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {grouped[category].map(integration => (
                <article
                  key={integration.name}
                  className="rounded-xl border border-arda-border bg-arda-bg-secondary/30 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-sm text-arda-text-primary">{integration.name}</p>
                    <span className="text-[11px] font-medium rounded-full border border-arda-border px-2 py-0.5 text-arda-text-muted">
                      Coming soon
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-arda-text-secondary leading-relaxed">
                    {integration.description}
                  </p>
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
};
