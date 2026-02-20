import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../SupplierSetup', () => ({
  SupplierSetup: ({ onCanProceed }: { onCanProceed?: (canProceed: boolean) => void }) => (
    <div>
      <div>supplier-setup</div>
      <button type="button" onClick={() => onCanProceed?.(true)}>
        enable-email-continue
      </button>
    </div>
  ),
}));

vi.mock('../OnboardingWelcomeStep', () => ({
  OnboardingWelcomeStep: ({
    onStartEmailSync,
    onSkipEmail,
  }: {
    onStartEmailSync: () => void;
    onSkipEmail: () => void;
  }) => (
    <div>
      <div>welcome-step</div>
      <button type="button" onClick={onStartEmailSync}>
        start-email-sync
      </button>
      <button type="button" onClick={onSkipEmail}>
        skip-email-sync
      </button>
    </div>
  ),
}));

vi.mock('../BarcodeScanStep', () => ({
  BarcodeScanStep: () => <div>barcode-step</div>,
}));

vi.mock('../IntegrationsStep', () => ({
  IntegrationsStep: () => <div>integrations-step</div>,
}));

vi.mock('../UrlScrapeStep', () => ({
  UrlScrapeStep: () => <div>url-scrape-step</div>,
}));

vi.mock('../PhotoCaptureStep', () => ({
  PhotoCaptureStep: () => <div>photo-step</div>,
}));

vi.mock('../CSVUploadStep', () => ({
  CSVUploadStep: () => <div>csv-step</div>,
}));

vi.mock('../MasterListStep', () => ({
  MasterListStep: () => <div>masterlist-step</div>,
}));

import { OnboardingFlow } from '../OnboardingFlow';

describe('OnboardingFlow email continuation reminder', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('shows the reminder on the email step', async () => {
    const user = userEvent.setup();

    render(<OnboardingFlow onComplete={vi.fn()} onSkip={vi.fn()} />);

    expect(screen.getAllByText('Step 1 of 8').length).toBeGreaterThan(0);
    expect(screen.getByText('welcome-step')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'start-email-sync' }));

    expect(screen.getAllByText('Step 2 of 8').length).toBeGreaterThan(0);
    expect(
      screen.getByText('Continuing won’t stop email scanning. Import keeps running in the background.'),
    ).toBeInTheDocument();
  });

  it('hides the reminder after advancing to Integrations step', async () => {
    const user = userEvent.setup();

    render(<OnboardingFlow onComplete={vi.fn()} onSkip={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'start-email-sync' }));
    await user.click(screen.getByRole('button', { name: 'enable-email-continue' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByText('integrations-step')).toBeInTheDocument();
    expect(screen.getAllByText('Step 3 of 8').length).toBeGreaterThan(0);
    expect(
      screen.queryByText('Continuing won’t stop email scanning. Import keeps running in the background.'),
    ).not.toBeInTheDocument();
  });

  it('renders URL scrape as step 3 after integrations', async () => {
    const user = userEvent.setup();

    render(<OnboardingFlow onComplete={vi.fn()} onSkip={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'start-email-sync' }));
    await user.click(screen.getByRole('button', { name: 'enable-email-continue' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByText('url-scrape-step')).toBeInTheDocument();
    expect(screen.getAllByText('Step 4 of 8').length).toBeGreaterThan(0);
  });

  it('starts on integrations step when OAuth callback params are present', () => {
    window.history.pushState({}, '', '/?integration_provider=quickbooks&integration_status=connected');

    render(<OnboardingFlow onComplete={vi.fn()} onSkip={vi.fn()} />);

    expect(screen.getByText('integrations-step')).toBeInTheDocument();
    expect(screen.getAllByText('Step 3 of 8').length).toBeGreaterThan(0);
  });
});
