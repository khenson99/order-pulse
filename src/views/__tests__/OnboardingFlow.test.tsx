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
  UrlScrapeStep: ({
    onReviewStateChange,
  }: {
    onReviewStateChange?: (state: {
      pendingReviewCount: number;
      unimportedApprovedCount: number;
      totalRows: number;
      canContinue: boolean;
    }) => void;
  }) => (
    <div>
      <div>url-scrape-step</div>
      <button
        type="button"
        onClick={() => onReviewStateChange?.({
          pendingReviewCount: 1,
          unimportedApprovedCount: 0,
          totalRows: 1,
          canContinue: false,
        })}
      >
        block-url-continue
      </button>
      <button
        type="button"
        onClick={() => onReviewStateChange?.({
          pendingReviewCount: 0,
          unimportedApprovedCount: 0,
          totalRows: 1,
          canContinue: true,
        })}
      >
        allow-url-continue
      </button>
    </div>
  ),
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

  it('blocks continue on URL step until review state allows it', async () => {
    const user = userEvent.setup();

    render(<OnboardingFlow onComplete={vi.fn()} onSkip={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'start-email-sync' }));
    await user.click(screen.getByRole('button', { name: 'enable-email-continue' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByText('url-scrape-step')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'block-url-continue' }));

    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    expect(screen.getByText(/review every scraped row before continuing/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'allow-url-continue' }));
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  it('starts on integrations step when OAuth callback params are present', () => {
    window.history.pushState({}, '', '/?integration_provider=quickbooks&integration_status=connected');

    render(<OnboardingFlow onComplete={vi.fn()} onSkip={vi.fn()} />);

    expect(screen.getByText('integrations-step')).toBeInTheDocument();
    expect(screen.getAllByText('Step 3 of 8').length).toBeGreaterThan(0);
  });

  it('shows step tips in the header popover', async () => {
    const user = userEvent.setup();

    render(<OnboardingFlow onComplete={vi.fn()} onSkip={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'start-email-sync' }));
    await user.click(screen.getByRole('button', { name: 'enable-email-continue' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByText('integrations-step')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /tips/i }));

    expect(
      screen.getByText('Connect QuickBooks or Xero if you want PO data.'),
    ).toBeInTheDocument();
  });

  it('closes the tips popover when advancing steps', async () => {
    const user = userEvent.setup();

    render(<OnboardingFlow onComplete={vi.fn()} onSkip={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'start-email-sync' }));
    await user.click(screen.getByRole('button', { name: 'enable-email-continue' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByText('integrations-step')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /tips/i }));
    expect(screen.getByText('Connect QuickBooks or Xero if you want PO data.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('url-scrape-step')).toBeInTheDocument();
    expect(screen.queryByText('Connect QuickBooks or Xero if you want PO data.')).not.toBeInTheDocument();
  });

  it('renders footer navigation buttons on non-welcome steps', async () => {
    const user = userEvent.setup();

    render(<OnboardingFlow onComplete={vi.fn()} onSkip={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'start-email-sync' }));
    await user.click(screen.getByRole('button', { name: 'enable-email-continue' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByText('integrations-step')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  it('allows skipping a step even when Continue is disabled', async () => {
    const user = userEvent.setup();

    render(<OnboardingFlow onComplete={vi.fn()} onSkip={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'start-email-sync' }));
    await user.click(screen.getByRole('button', { name: 'enable-email-continue' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByText('url-scrape-step')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'block-url-continue' }));

    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Skip' }));

    expect(screen.getByText('barcode-step')).toBeInTheDocument();
  });
});
