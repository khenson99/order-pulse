import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InventoryView } from '../InventoryView';
import type { InventoryItem } from '../../types';

const exportItemsToCSV = vi.fn();

vi.mock('../../utils/exportUtils', () => ({
  exportItemsToCSV: (...args: unknown[]) => exportItemsToCSV(...args),
}));

const buildItem = (overrides: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'inv-1',
  name: 'Shop Towels',
  supplier: 'Warehouse Supply',
  totalQuantityOrdered: 20,
  orderCount: 3,
  firstOrderDate: '2025-01-01T00:00:00.000Z',
  lastOrderDate: '2025-02-01T00:00:00.000Z',
  averageCadenceDays: 10,
  dailyBurnRate: 2,
  recommendedMin: 12,
  recommendedOrderQty: 24,
  lastPrice: 20,
  history: [{ date: '2025-02-01T00:00:00.000Z', quantity: 10 }],
  ...overrides,
});

describe('InventoryView tenant resolution', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    exportItemsToCSV.mockReset();
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  it('auto-attempts create_new and retries bulk sync on TENANT_REQUIRED', async () => {
    const user = userEvent.setup();
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const confirmSpy = vi.spyOn(window, 'confirm');

    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: false,
            code: 'TENANT_REQUIRED',
            details: {
              canCreateTenant: true,
              message: 'No tenant mapping found.',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            tenantId: 'tenant-new',
            author: 'author-new',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            summary: { total: 1, successful: 1, failed: 0 },
            results: [{ item: 'Shop Towels', status: 'fulfilled' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

    render(<InventoryView inventory={[buildItem()]} />);

    await user.click(screen.getByRole('button', { name: 'Sync All to Arda' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const resolveCall = fetchMock.mock.calls[1];
    expect(String(resolveCall?.[0])).toContain('/api/arda/tenant/resolve');
    const resolveBody = JSON.parse(((resolveCall?.[1] as RequestInit)?.body as string) || '{}') as { action?: string };
    expect(resolveBody.action).toBe('create_new');
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('falls back to CSV when tenant cannot be auto-provisioned', async () => {
    const user = userEvent.setup();
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          code: 'TENANT_REQUIRED',
          error: 'Tenant required for Arda sync',
          details: {
            canCreateTenant: false,
            autoProvisionAttempted: true,
            autoProvisionSucceeded: false,
            autoProvisionError: 'Automatic tenant provisioning failed.',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    render(<InventoryView inventory={[buildItem()]} />);

    await user.click(screen.getByRole('button', { name: 'Sync All to Arda' }));

    await screen.findByText(/Exported items to CSV/i);
    expect(exportItemsToCSV).toHaveBeenCalledTimes(1);
    expect(exportItemsToCSV).toHaveBeenCalledWith(
      expect.any(Array),
      'inventory-tenant-unresolved',
    );
  });
});
