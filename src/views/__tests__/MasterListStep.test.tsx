import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { MasterListStep } from '../MasterListStep';
import { resetSessionExpiredSignalForTests, SESSION_EXPIRED_EVENT } from '../../services/api';

describe('MasterListStep URL items', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetSessionExpiredSignalForTests();
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('merges URL-derived items and marks incomplete rows as needs attention', () => {
    render(
      <MasterListStep
        emailItems={[
          {
            id: 'email-1',
            name: 'Email Item',
            supplier: 'Email Vendor',
          },
        ]}
        urlItems={[
          {
            sourceUrl: 'https://example.com/item-a',
            productUrl: 'https://example.com/item-a',
            itemName: 'URL Item',
            supplier: undefined,
            needsReview: true,
            extractionSource: 'error',
            confidence: 0,
          },
        ]}
        scannedBarcodes={[]}
        capturedPhotos={[]}
        csvItems={[]}
        onComplete={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByText('URL Item')).toBeInTheDocument();
    expect(screen.getByText('Email Item')).toBeInTheDocument();
    expect(screen.getByText(/1 need attention/i)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /URL \(1\)/i })).toBeInTheDocument();
  });

  it('supports filtering by URL source', async () => {
    const user = userEvent.setup();

    render(
      <MasterListStep
        emailItems={[
          {
            id: 'email-1',
            name: 'Email Item',
            supplier: 'Email Vendor',
          },
        ]}
        urlItems={[
          {
            sourceUrl: 'https://example.com/item-a',
            productUrl: 'https://example.com/item-a',
            itemName: 'URL Item',
            supplier: 'Web Vendor',
            needsReview: false,
            extractionSource: 'html-metadata',
            confidence: 0.8,
          },
        ]}
        scannedBarcodes={[]}
        capturedPhotos={[]}
        csvItems={[]}
        onComplete={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    await user.selectOptions(screen.getByLabelText('Filter by source'), 'url');

    expect(screen.getByText('URL Item')).toBeInTheDocument();
    expect(screen.queryByText('Email Item')).not.toBeInTheDocument();
  });

  it('defaults order method by source and allows changing it', async () => {
    const user = userEvent.setup();

    render(
      <MasterListStep
        emailItems={[
          {
            id: 'email-1',
            name: 'Email Item',
            supplier: 'Email Vendor',
          },
        ]}
        urlItems={[
          {
            sourceUrl: 'https://example.com/item-a',
            productUrl: 'https://example.com/item-a',
            itemName: 'URL Item',
            supplier: 'Web Vendor',
            needsReview: false,
            extractionSource: 'html-metadata',
            confidence: 0.8,
          },
        ]}
        scannedBarcodes={[
          {
            id: 'barcode-1',
            barcode: '12345',
            barcodeType: 'UPC',
            scannedAt: new Date().toISOString(),
            source: 'desktop',
            productName: 'Barcode Item',
          },
        ]}
        capturedPhotos={[
          {
            id: 'photo-1',
            imageData: 'data:image/png;base64,abc',
            capturedAt: new Date().toISOString(),
            source: 'desktop',
            suggestedName: 'Photo Item',
          },
        ]}
        csvItems={[
          {
            id: 'csv-1',
            rowIndex: 1,
            name: 'CSV Item',
            isApproved: true,
            isRejected: false,
            rawData: {},
          },
        ]}
        onComplete={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    expect((screen.getByLabelText('Order method for Email Item') as HTMLSelectElement).value).toBe('online');
    expect((screen.getByLabelText('Order method for URL Item') as HTMLSelectElement).value).toBe('online');
    expect((screen.getByLabelText('Order method for Barcode Item') as HTMLSelectElement).value).toBe('shopping');
    expect((screen.getByLabelText('Order method for Photo Item') as HTMLSelectElement).value).toBe('production');
    expect((screen.getByLabelText('Order method for CSV Item') as HTMLSelectElement).value).toBe('purchase_order');

    await user.selectOptions(screen.getByLabelText('Order method for Email Item'), 'email');
    expect((screen.getByLabelText('Order method for Email Item') as HTMLSelectElement).value).toBe('email');
  });

  it('sends selected order method in line-level sync payload', async () => {
    const user = userEvent.setup();
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ record: { rId: 'item-1' } }),
    });

    render(
      <MasterListStep
        emailItems={[
          {
            id: 'email-1',
            name: 'Email Item',
            supplier: 'Email Vendor',
          },
        ]}
        urlItems={[]}
        scannedBarcodes={[]}
        capturedPhotos={[]}
        csvItems={[]}
        onComplete={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    await user.selectOptions(screen.getByLabelText('Order method for Email Item'), 'purchase_order');
    await user.click(screen.getByRole('button', { name: 'Sync' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string) as { orderMechanism: string };
    expect(body.orderMechanism).toBe('purchase_order');
  });

  it('auto-attempts create_new on TENANT_REQUIRED without confirmation prompts', async () => {
    const user = userEvent.setup();
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const confirmSpy = vi.spyOn(window, 'confirm');

    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: false,
            code: 'TENANT_REQUIRED',
            error: 'Tenant required for Arda sync',
            details: {
              canCreateTenant: true,
              message: 'No tenant mapping found.',
            },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, tenantId: 'tenant-new', author: 'author-new' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, record: { rId: 'item-1' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

    render(
      <MasterListStep
        emailItems={[
          {
            id: 'email-1',
            name: 'Email Item',
            supplier: 'Email Vendor',
          },
        ]}
        urlItems={[]}
        scannedBarcodes={[]}
        capturedPhotos={[]}
        csvItems={[]}
        onComplete={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Sync' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const resolveCall = fetchMock.mock.calls[1];
    expect(String(resolveCall?.[0])).toContain('/api/arda/tenant/resolve');
    const resolveBody = JSON.parse(((resolveCall?.[1] as RequestInit)?.body as string) || '{}') as { action?: string };
    expect(resolveBody.action).toBe('create_new');
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('emits session-expired when sync returns 401', async () => {
    const user = userEvent.setup();
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const onExpired = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);

    render(
      <MasterListStep
        emailItems={[
          {
            id: 'email-1',
            name: 'Email Item',
            supplier: 'Email Vendor',
          },
        ]}
        urlItems={[]}
        scannedBarcodes={[]}
        capturedPhotos={[]}
        csvItems={[]}
        onComplete={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Sync' }));

    await waitFor(() => expect(onExpired).toHaveBeenCalledTimes(1));
    window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  });

  it('shows floating CTA when the table is scrollable and scrolled', async () => {
    render(
      <MasterListStep
        emailItems={[
          {
            id: 'email-1',
            name: 'Email Item',
            supplier: 'Email Vendor',
          },
        ]}
        urlItems={[]}
        scannedBarcodes={[]}
        capturedPhotos={[]}
        csvItems={[]}
        onComplete={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    const scrollEl = screen.getByTestId('masterlist-table-scroll');
    Object.defineProperty(scrollEl, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(scrollEl, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(scrollEl, 'scrollTop', { value: 200, writable: true, configurable: true });

    fireEvent.scroll(scrollEl);

    await waitFor(() => {
      expect(screen.getByTestId('masterlist-floating-cta')).toBeInTheDocument();
    });
  });
});
