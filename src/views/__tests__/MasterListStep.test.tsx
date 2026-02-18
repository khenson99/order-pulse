import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MasterListStep } from '../MasterListStep';

describe('MasterListStep URL items', () => {
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
});
