import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  scrapeUrls: vi.fn(),
}));

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return {
    ...actual,
    urlIngestionApi: {
      scrapeUrls: mocks.scrapeUrls,
    },
  };
});

import { UrlScrapeStep } from '../UrlScrapeStep';

describe('UrlScrapeStep', () => {
  beforeEach(() => {
    mocks.scrapeUrls.mockReset();
  });

  it('parses and deduplicates URLs before scraping', async () => {
    const user = userEvent.setup();
    mocks.scrapeUrls.mockResolvedValue({
      requested: 2,
      processed: 2,
      results: [],
      items: [],
    });

    render(<UrlScrapeStep importedItems={[]} onImportItems={vi.fn()} />);

    await user.type(
      screen.getByPlaceholderText(/https:\/\/www\.amazon\.com/i),
      'https://example.com/a, https://example.com/a\nhttps://example.com/b',
    );

    await user.click(screen.getByRole('button', { name: /Scrape URLs/i }));

    await waitFor(() => {
      expect(mocks.scrapeUrls).toHaveBeenCalledWith([
        'https://example.com/a',
        'https://example.com/b',
      ]);
    });
  });

  it('disables scraping when URL count exceeds the limit', async () => {
    const user = userEvent.setup();

    render(<UrlScrapeStep importedItems={[]} onImportItems={vi.fn()} />);

    const urls = Array.from({ length: 51 }, (_, idx) => `https://example.com/${idx}`).join('\n');
    await user.type(screen.getByPlaceholderText(/https:\/\/www\.amazon\.com/i), urls);

    expect(screen.getByText(/max 50/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Scrape URLs/i })).toBeDisabled();
  });

  it('imports only approved rows and preserves manual edits', async () => {
    const user = userEvent.setup();
    const onImportItems = vi.fn();

    mocks.scrapeUrls.mockResolvedValue({
      requested: 2,
      processed: 2,
      results: [
        {
          sourceUrl: 'https://example.com/a',
          status: 'success',
          extractionSource: 'html-metadata',
          item: {
            sourceUrl: 'https://example.com/a',
            productUrl: 'https://example.com/a',
            itemName: 'Widget A',
            supplier: 'Acme',
            needsReview: false,
            extractionSource: 'html-metadata',
            confidence: 0.8,
          },
        },
        {
          sourceUrl: 'https://example.com/b',
          status: 'partial',
          extractionSource: 'error',
          message: 'Timeout',
          item: {
            sourceUrl: 'https://example.com/b',
            productUrl: 'https://example.com/b',
            itemName: 'Unknown item',
            needsReview: true,
            extractionSource: 'error',
            confidence: 0,
          },
        },
      ],
      items: [],
    });

    render(<UrlScrapeStep importedItems={[]} onImportItems={onImportItems} />);

    await user.type(screen.getByPlaceholderText(/https:\/\/www\.amazon\.com/i), 'https://example.com/a\nhttps://example.com/b');
    await user.click(screen.getByRole('button', { name: /Scrape URLs/i }));

    expect(await screen.findByLabelText('Item name for https://example.com/a')).toHaveValue('Widget A');
    expect(screen.getByText(/1 success/i)).toBeInTheDocument();
    expect(screen.getByText(/1 partial/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Import Approved To Master List/i }));
    expect(screen.getByText(/approve at least one row/i)).toBeInTheDocument();
    expect(onImportItems).not.toHaveBeenCalled();

    await user.click(screen.getByLabelText('Approve https://example.com/a'));
    const supplierInput = screen.getByLabelText('Supplier for https://example.com/a');
    await user.clear(supplierInput);
    await user.type(supplierInput, 'Acme Updated');
    await user.click(screen.getByRole('button', { name: /Import Approved To Master List/i }));

    expect(onImportItems).toHaveBeenCalledTimes(1);
    expect(onImportItems.mock.calls[0][0]).toHaveLength(1);
    expect(onImportItems.mock.calls[0][0][0]).toMatchObject({
      sourceUrl: 'https://example.com/a',
      supplier: 'Acme Updated',
    });
  });

  it('appends new scraped rows instead of replacing previous results', async () => {
    const user = userEvent.setup();

    mocks.scrapeUrls
      .mockResolvedValueOnce({
        requested: 1,
        processed: 1,
        results: [
          {
            sourceUrl: 'https://example.com/a',
            status: 'success',
            extractionSource: 'html-metadata',
            item: {
              sourceUrl: 'https://example.com/a',
              productUrl: 'https://example.com/a',
              itemName: 'Widget A',
              needsReview: false,
              extractionSource: 'html-metadata',
              confidence: 0.8,
            },
          },
        ],
        items: [],
      })
      .mockResolvedValueOnce({
        requested: 1,
        processed: 1,
        results: [
          {
            sourceUrl: 'https://example.com/b',
            status: 'success',
            extractionSource: 'html-metadata',
            item: {
              sourceUrl: 'https://example.com/b',
              productUrl: 'https://example.com/b',
              itemName: 'Widget B',
              needsReview: false,
              extractionSource: 'html-metadata',
              confidence: 0.8,
            },
          },
        ],
        items: [],
      });

    render(<UrlScrapeStep importedItems={[]} onImportItems={vi.fn()} />);

    const textarea = screen.getByPlaceholderText(/https:\/\/www\.amazon\.com/i);
    await user.type(textarea, 'https://example.com/a');
    await user.click(screen.getByRole('button', { name: /Scrape URLs/i }));
    expect(await screen.findByLabelText('Item name for https://example.com/a')).toHaveValue('Widget A');

    await user.clear(textarea);
    await user.type(textarea, 'https://example.com/b');
    await user.click(screen.getByRole('button', { name: /Scrape URLs/i }));

    expect(await screen.findByLabelText('Item name for https://example.com/a')).toHaveValue('Widget A');
    expect(screen.getByLabelText('Item name for https://example.com/b')).toHaveValue('Widget B');
  });

  it('removes imported URL item when a row is deleted', async () => {
    const user = userEvent.setup();
    const onDeleteImportedItem = vi.fn();

    mocks.scrapeUrls.mockResolvedValue({
      requested: 1,
      processed: 1,
      results: [
        {
          sourceUrl: 'https://example.com/a',
          status: 'success',
          extractionSource: 'html-metadata',
          item: {
            sourceUrl: 'https://example.com/a',
            productUrl: 'https://example.com/a',
            itemName: 'Widget A',
            needsReview: false,
            extractionSource: 'html-metadata',
            confidence: 0.8,
          },
        },
      ],
      items: [],
    });

    render(
      <UrlScrapeStep
        importedItems={[
          {
            sourceUrl: 'https://example.com/a',
            productUrl: 'https://example.com/a',
            itemName: 'Widget A',
            needsReview: false,
            extractionSource: 'html-metadata',
            confidence: 0.8,
          },
        ]}
        onImportItems={vi.fn()}
        onDeleteImportedItem={onDeleteImportedItem}
      />,
    );

    await user.type(screen.getByPlaceholderText(/https:\/\/www\.amazon\.com/i), 'https://example.com/a');
    await user.click(screen.getByRole('button', { name: /Scrape URLs/i }));

    await user.click(await screen.findByRole('button', { name: 'Delete https://example.com/a' }));
    expect(onDeleteImportedItem).toHaveBeenCalledWith('https://example.com/a');
  });
});
