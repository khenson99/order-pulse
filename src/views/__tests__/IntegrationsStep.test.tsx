import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listConnections: vi.fn(),
  getConnectionRuns: vi.fn(),
  connectProvider: vi.fn(),
  disconnectConnection: vi.fn(),
  syncConnection: vi.fn(),
  isSessionExpiredError: vi.fn(),
}));

vi.mock('../../services/api', () => ({
  integrationsApi: {
    listConnections: mocks.listConnections,
    getConnectionRuns: mocks.getConnectionRuns,
    connectProvider: mocks.connectProvider,
    disconnectConnection: mocks.disconnectConnection,
    syncConnection: mocks.syncConnection,
  },
  isSessionExpiredError: mocks.isSessionExpiredError,
}));

vi.mock('../../components/Icons', () => ({
  Icons: new Proxy(
    {},
    {
      get: () => () => null,
    },
  ),
}));

import { IntegrationsStep } from '../IntegrationsStep';

describe('IntegrationsStep accounting connectors', () => {
  beforeEach(() => {
    mocks.listConnections.mockReset();
    mocks.getConnectionRuns.mockReset();
    mocks.connectProvider.mockReset();
    mocks.disconnectConnection.mockReset();
    mocks.syncConnection.mockReset();
    mocks.isSessionExpiredError.mockReset();

    mocks.isSessionExpiredError.mockReturnValue(false);
    mocks.listConnections.mockResolvedValue({ connections: [] });
    mocks.getConnectionRuns.mockResolvedValue({ runs: [] });
    mocks.connectProvider.mockResolvedValue({ authUrl: 'https://example.com/connect' });
    mocks.disconnectConnection.mockResolvedValue({ success: true });
    mocks.syncConnection.mockResolvedValue({ success: true, runId: 'run-1' });
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('renders accounting controls on integrations step', async () => {
    render(<IntegrationsStep />);
    expect(await screen.findByRole('button', { name: 'Connect QuickBooks' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect Xero' })).toBeInTheDocument();
  });

  it('shows connected status and latest run metrics', async () => {
    mocks.listConnections.mockResolvedValueOnce({
      connections: [
        {
          id: 'conn-qb',
          provider: 'quickbooks',
          tenantId: 'realm-1',
          tenantName: 'Acme Books',
          status: 'connected',
          tokenExpiresAt: '2026-12-01T00:00:00.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    mocks.getConnectionRuns.mockResolvedValueOnce({
      runs: [
        {
          id: 'run-123',
          connectionId: 'conn-qb',
          trigger: 'manual',
          status: 'success',
          ordersUpserted: 3,
          ordersDeleted: 0,
          itemsUpserted: 12,
          apiCalls: 2,
          startedAt: '2026-01-01T00:00:00.000Z',
          finishedAt: '2026-01-01T00:01:00.000Z',
        },
      ],
    });

    render(<IntegrationsStep />);
    expect(await screen.findByText(/Connected.*Acme Books/)).toBeInTheDocument();
    expect(await screen.findByText('Last sync: 3 orders, 12 items')).toBeInTheDocument();
  });

  it('surfaces connect errors', async () => {
    const user = userEvent.setup();
    mocks.connectProvider.mockRejectedValueOnce(new Error('Connect failed'));

    render(<IntegrationsStep />);
    await user.click(await screen.findByRole('button', { name: 'Connect QuickBooks' }));

    expect(mocks.connectProvider).toHaveBeenCalledWith('quickbooks');
    expect(await screen.findByText('Connect failed')).toBeInTheDocument();
  });

  it('triggers manual sync and shows notice', async () => {
    const user = userEvent.setup();
    mocks.listConnections.mockResolvedValueOnce({
      connections: [
        {
          id: 'conn-qb',
          provider: 'quickbooks',
          tenantId: 'realm-1',
          status: 'connected',
          tokenExpiresAt: '2026-12-01T00:00:00.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    mocks.getConnectionRuns.mockResolvedValueOnce({ runs: [] });

    render(<IntegrationsStep />);
    await user.click(await screen.findByRole('button', { name: 'Sync now' }));

    expect(mocks.syncConnection).toHaveBeenCalledWith('conn-qb');
    expect(await screen.findByText('Sync started. Refreshing status shortly...')).toBeInTheDocument();
  });

  it('disconnects provider and reloads state', async () => {
    const user = userEvent.setup();
    mocks.listConnections
      .mockResolvedValueOnce({
        connections: [
          {
            id: 'conn-qb',
            provider: 'quickbooks',
            tenantId: 'realm-1',
            status: 'connected',
            tokenExpiresAt: '2026-12-01T00:00:00.000Z',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({ connections: [] });
    mocks.getConnectionRuns.mockResolvedValueOnce({ runs: [] });

    render(<IntegrationsStep />);
    await user.click(await screen.findByRole('button', { name: 'Disconnect' }));

    expect(mocks.disconnectConnection).toHaveBeenCalledWith('conn-qb');
    await waitFor(() => expect(mocks.listConnections).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Integration disconnected.')).toBeInTheDocument();
  });

  it('shows callback success message and clears query params', async () => {
    window.history.pushState({}, '', '/?integration_provider=quickbooks&integration_status=connected');

    render(<IntegrationsStep />);

    expect(await screen.findByText('QuickBooks connected. Initial backfill started.')).toBeInTheDocument();
    expect(window.location.search).toBe('');
  });
});
