import { render, screen, waitFor } from '@testing-library/react';
import { SupplierSetup } from '../views/SupplierSetup';
import { vi } from 'vitest';
import type { ExtractedOrder } from '../types';
import { jobsApi } from '../services/api';

vi.mock('../services/api', () => ({
  discoverApi: {
    discoverSuppliers: vi.fn().mockResolvedValue({ suppliers: [] }),
    startJobWithFilter: vi.fn().mockResolvedValue({ jobId: 'discovery-job' }),
  },
  jobsApi: {
    startAmazon: vi.fn().mockResolvedValue({ jobId: 'amazon-job' }),
    startJob: vi.fn().mockResolvedValue({ jobId: 'priority-job' }),
    getStatus: vi.fn().mockResolvedValue({
      hasJob: true,
      status: 'running',
      progress: { total: 1, processed: 0, success: 0, failed: 0, currentTask: 'Starting...' },
      logs: [],
    }),
  },
  JobStatus: {},
  DiscoveredSupplier: {},
}));

describe('SupplierSetup', () => {
  it('renders header and starts priority processes', async () => {
    const onScanComplete = vi.fn<(orders: ExtractedOrder[]) => void>();
    const onSkip = vi.fn();

    render(<SupplierSetup onScanComplete={onScanComplete} onSkip={onSkip} />);

    await waitFor(() => {
      expect(jobsApi.startAmazon).toHaveBeenCalled();
      expect(jobsApi.startJob).toHaveBeenCalled();
    });

    expect(screen.getByRole('heading', { name: /Import Orders/i })).toBeInTheDocument();
    expect(
      screen.getByText((content) =>
        /Priority suppliers processed/i.test(content) ||
        /Processing Amazon, McMaster-Carr, and Uline automatically/i.test(content),
      ),
    ).toBeInTheDocument();
  });
});
