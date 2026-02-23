import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  discoverSuppliers: vi.fn(),
  startAmazon: vi.fn(),
  startJob: vi.fn(),
  getStatus: vi.fn(),
  getGmailStatus: vi.fn(),
  isSessionExpiredError: vi.fn(),
  listConnections: vi.fn(),
  getConnectionRuns: vi.fn(),
  connectProvider: vi.fn(),
  disconnectConnection: vi.fn(),
  syncConnection: vi.fn(),
}));

vi.mock('../../services/api', () => ({
  ApiRequestError: class ApiRequestError extends Error {
    code?: string;

    constructor(message: string, status = 400, code?: string, details?: unknown) {
      super(message);
      this.name = 'ApiRequestError';
      this.code = code;
      void status;
      void details;
    }
  },
  discoverApi: {
    discoverSuppliers: mocks.discoverSuppliers,
  },
  jobsApi: {
    startAmazon: mocks.startAmazon,
    startJob: mocks.startJob,
    getStatus: mocks.getStatus,
  },
  gmailApi: {
    getStatus: mocks.getGmailStatus,
  },
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

import { EmailScanState, SupplierSetup } from '../SupplierSetup';

const buildInitialState = (overrides: Partial<EmailScanState> = {}): EmailScanState => ({
  amazonOrders: [
    {
      id: 'amazon-order-1',
      originalEmailId: 'email-1',
      supplier: 'Amazon',
      orderDate: '2026-01-01',
      items: [],
      confidence: 1,
    },
  ],
  priorityOrders: [],
  otherOrders: [],
  isAmazonComplete: true,
  isPriorityComplete: true,
  discoveredSuppliers: [
    {
      domain: 'fastenal.com',
      displayName: 'Fastenal',
      emailCount: 4,
      score: 80,
      category: 'industrial',
      sampleSubjects: ['Order 1'],
      isRecommended: false,
    },
    {
      domain: 'grainger.com',
      displayName: 'Grainger',
      emailCount: 2,
      score: 70,
      category: 'industrial',
      sampleSubjects: ['Order 2'],
      isRecommended: false,
    },
  ],
  hasDiscovered: true,
  hasStartedOtherImport: false,
  selectedOtherSuppliers: [],
  ...overrides,
});

const getLastCanProceedValue = (onCanProceed: ReturnType<typeof vi.fn>) =>
  onCanProceed.mock.calls[onCanProceed.mock.calls.length - 1]?.[0];

describe('SupplierSetup supplier import behavior', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.discoverSuppliers.mockReset();
    mocks.startAmazon.mockReset();
    mocks.startJob.mockReset();
    mocks.getStatus.mockReset();
    mocks.getGmailStatus.mockReset();
    mocks.isSessionExpiredError.mockReset();
    mocks.listConnections.mockReset();
    mocks.getConnectionRuns.mockReset();
    mocks.connectProvider.mockReset();
    mocks.disconnectConnection.mockReset();
    mocks.syncConnection.mockReset();
    mocks.isSessionExpiredError.mockReturnValue(false);
    mocks.startJob.mockResolvedValue({ jobId: 'other-job-1' });
    mocks.getGmailStatus.mockResolvedValue({ connected: true, gmailEmail: 'test@example.com' });
    mocks.getStatus.mockResolvedValue({
      hasJob: true,
      status: 'running',
      progress: {
        processed: 0,
        total: 1,
        success: 0,
        failed: 0,
        currentTask: 'Scanning...',
      },
      orders: [],
    });
    mocks.listConnections.mockResolvedValue({ connections: [] });
    mocks.getConnectionRuns.mockResolvedValue({ runs: [] });
    mocks.connectProvider.mockResolvedValue({ authUrl: 'https://example.com' });
    mocks.disconnectConnection.mockResolvedValue({ success: true });
    mocks.syncConnection.mockResolvedValue({ success: true, runId: 'run-1' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not start other-supplier scan when only selecting a supplier tile', async () => {
    const user = userEvent.setup();
    const onCanProceed = vi.fn();

    render(
      <SupplierSetup
        onScanComplete={vi.fn()}
        onSkip={vi.fn()}
        onCanProceed={onCanProceed}
        initialState={buildInitialState()}
      />,
    );

    await waitFor(() => expect(getLastCanProceedValue(onCanProceed)).toBe(false));

    await user.click(screen.getByText('Fastenal'));

    expect(mocks.startJob).not.toHaveBeenCalled();
    await waitFor(() => expect(getLastCanProceedValue(onCanProceed)).toBe(false));
  });

  it('does not show the continue anytime popup by default', () => {
    render(
      <SupplierSetup
        onScanComplete={vi.fn()}
        onSkip={vi.fn()}
        onCanProceed={vi.fn()}
        initialState={buildInitialState()}
      />,
    );

    expect(screen.queryByRole('dialog', { name: 'Continue anytime' })).not.toBeInTheDocument();
  });

  it('starts other-supplier scan only when Import is clicked', async () => {
    const user = userEvent.setup();

    render(
      <SupplierSetup
        onScanComplete={vi.fn()}
        onSkip={vi.fn()}
        onCanProceed={vi.fn()}
        initialState={buildInitialState()}
      />,
    );

    await user.click(screen.getByText('Fastenal'));
    await user.click(screen.getByText('Grainger'));
    await user.click(screen.getByRole('button', { name: 'Import 2 Suppliers' }));

    expect(await screen.findByRole('dialog', { name: 'Continue anytime' })).toBeInTheDocument();
    await waitFor(() => expect(mocks.startJob).toHaveBeenCalledTimes(1));
    expect(mocks.startJob).toHaveBeenCalledWith(['fastenal.com', 'grainger.com'], 'other');
  });

  it('shows the continue anytime popup only once per page visit', async () => {
    const user = userEvent.setup();
    mocks.startJob.mockRejectedValueOnce(new Error('Failed to start selected supplier import.'));

    render(
      <SupplierSetup
        onScanComplete={vi.fn()}
        onSkip={vi.fn()}
        onCanProceed={vi.fn()}
        initialState={buildInitialState()}
      />,
    );

    await user.click(screen.getByText('Fastenal'));
    await user.click(screen.getByRole('button', { name: 'Import 1 Supplier' }));
    expect(await screen.findByRole('dialog', { name: 'Continue anytime' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('dialog', { name: 'Continue anytime' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Import 1 Supplier' }));
    await waitFor(() => expect(mocks.startJob).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('dialog', { name: 'Continue anytime' })).not.toBeInTheDocument();
  });

  it('renders batching callout between Industrial Suppliers and Other Suppliers', () => {
    render(
      <SupplierSetup
        onScanComplete={vi.fn()}
        onSkip={vi.fn()}
        onCanProceed={vi.fn()}
        initialState={buildInitialState()}
      />,
    );

    const industrialHeading = screen.getByRole('heading', { name: 'Industrial Suppliers' });
    const batchingCallout = screen.getByText('A word about batching...');
    const otherHeading = screen.getByRole('heading', { name: 'Other Suppliers' });

    expect(industrialHeading.compareDocumentPosition(batchingCallout) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(batchingCallout.compareDocumentPosition(otherHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps proceed disabled until other import is explicitly started', async () => {
    const user = userEvent.setup();
    const onCanProceed = vi.fn();

    render(
      <SupplierSetup
        onScanComplete={vi.fn()}
        onSkip={vi.fn()}
        onCanProceed={onCanProceed}
        initialState={buildInitialState()}
      />,
    );

    await waitFor(() => expect(getLastCanProceedValue(onCanProceed)).toBe(false));

    await user.click(screen.getByText('Fastenal'));
    await waitFor(() => expect(getLastCanProceedValue(onCanProceed)).toBe(false));

    await user.click(screen.getByRole('button', { name: 'Import 1 Supplier' }));
    await waitFor(() => expect(getLastCanProceedValue(onCanProceed)).toBe(true));
  });

  it('allows proceed when there are no additional suppliers to import', async () => {
    const onCanProceed = vi.fn();

    render(
      <SupplierSetup
        onScanComplete={vi.fn()}
        onSkip={vi.fn()}
        onCanProceed={onCanProceed}
        initialState={buildInitialState({ discoveredSuppliers: [] })}
      />,
    );

    await waitFor(() => expect(getLastCanProceedValue(onCanProceed)).toBe(true));
  });

  it('shows an error and keeps proceed disabled when import start fails', async () => {
    const user = userEvent.setup();
    const onCanProceed = vi.fn();
    mocks.startJob.mockRejectedValueOnce(new Error('Failed to start selected supplier import.'));

    render(
      <SupplierSetup
        onScanComplete={vi.fn()}
        onSkip={vi.fn()}
        onCanProceed={onCanProceed}
        initialState={buildInitialState()}
      />,
    );

    await user.click(screen.getByText('Fastenal'));
    await user.click(screen.getByRole('button', { name: 'Import 1 Supplier' }));

    expect(await screen.findByText('Failed to start selected supplier import.')).toBeInTheDocument();
    await waitFor(() => expect(getLastCanProceedValue(onCanProceed)).toBe(false));
  });

});
