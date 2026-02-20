import { useMemo, useState } from 'react';
import { Icons } from '../components/Icons';
import { InstructionCard } from '../components/InstructionCard';
import { urlIngestionApi, UrlScrapeResult, UrlScrapedItem } from '../services/api';

interface UrlScrapeStepProps {
  importedItems: UrlScrapedItem[];
  onImportItems: (items: UrlScrapedItem[]) => void;
}

const MAX_URLS = 50;

function parseUrls(raw: string): string[] {
  const tokens = raw
    .split(/[\n,]/g)
    .map(token => token.trim())
    .filter(Boolean);

  return Array.from(new Set(tokens));
}

export const UrlScrapeStep: React.FC<UrlScrapeStepProps> = ({
  importedItems,
  onImportItems,
}) => {
  const [urlInput, setUrlInput] = useState('');
  const [isScraping, setIsScraping] = useState(false);
  const [results, setResults] = useState<UrlScrapeResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const parsedUrls = useMemo(() => parseUrls(urlInput), [urlInput]);
  const overLimit = parsedUrls.length > MAX_URLS;

  const handleScrape = async () => {
    if (parsedUrls.length === 0 || overLimit || isScraping) {
      return;
    }

    setIsScraping(true);
    setError(null);

    try {
      const response = await urlIngestionApi.scrapeUrls(parsedUrls);
      setResults(response.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to scrape URLs');
      setResults([]);
    } finally {
      setIsScraping(false);
    }
  };

  const handleImport = () => {
    if (results.length === 0) return;
    onImportItems(results.map(result => result.item));
  };

  const successCount = results.filter(result => result.status === 'success').length;
  const partialCount = results.filter(result => result.status === 'partial').length;
  const failedCount = results.filter(result => result.status === 'failed').length;

  return (
    <div className="space-y-4">
      <InstructionCard
        title="What to do"
        icon="Link"
        steps={[
          'Paste up to 50 product links.',
          'Click “Scrape URLs.”',
          'Import results to the master list.',
        ]}
      />

      <div className="bg-white rounded-2xl border border-arda-border p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-arda-text-primary">Paste Product URLs</h2>
            <p className="text-sm text-arda-text-secondary mt-1">
              Add up to 50 links. Amazon URLs use ASIN enrichment, other URLs use metadata + AI fallback. McMaster-Carr
              sometimes blocks automated requests, so you may get partial details (supplier + SKU) to review.
            </p>
          </div>
          <span className="text-xs text-arda-text-muted bg-arda-bg-tertiary rounded-full px-3 py-1">
            Optional step
          </span>
        </div>

        <textarea
          value={urlInput}
          onChange={(event) => setUrlInput(event.target.value)}
          placeholder="https://www.amazon.com/dp/B08...
https://supplier.com/products/part-123"
          className="mt-4 w-full min-h-[150px] rounded-xl border border-arda-border p-3 text-sm focus:outline-none focus:ring-2 focus:ring-arda-accent/30"
        />

        <div className="mt-3 flex items-center justify-between text-xs">
          <span className={overLimit ? 'text-red-600 font-medium' : 'text-arda-text-muted'}>
            {parsedUrls.length} unique URL{parsedUrls.length === 1 ? '' : 's'}
            {overLimit ? ` (max ${MAX_URLS})` : ''}
          </span>
          <button
            type="button"
            onClick={() => void handleScrape()}
            disabled={parsedUrls.length === 0 || overLimit || isScraping}
            className="btn-arda-primary text-sm py-2 px-4 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {isScraping ? <Icons.Loader2 className="w-4 h-4 animate-spin" /> : <Icons.Search className="w-4 h-4" />}
            Scrape URLs
          </button>
        </div>

        {error && (
          <p className="mt-3 text-sm text-red-600">{error}</p>
        )}
      </div>

      {(results.length > 0 || importedItems.length > 0) && (
        <div className="bg-white rounded-2xl border border-arda-border p-6 shadow-sm">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-3 text-sm">
              <span className="font-semibold text-arda-text-primary">Scrape Results</span>
              <span className="text-green-600">{successCount} success</span>
              <span className="text-orange-600">{partialCount} partial</span>
              <span className="text-red-600">{failedCount} failed</span>
            </div>
            <button
              type="button"
              onClick={handleImport}
              disabled={results.length === 0}
              className="btn-arda-outline text-sm py-1.5 inline-flex items-center gap-2 disabled:opacity-50"
            >
              <Icons.Download className="w-4 h-4" />
              Import To Master List
            </button>
          </div>

          <div className="space-y-2 max-h-[360px] overflow-auto">
            {results.map((result, index) => {
              const statusColor = result.status === 'success'
                ? 'text-green-600 bg-green-50 border-green-100'
                : result.status === 'partial'
                  ? 'text-orange-600 bg-orange-50 border-orange-100'
                  : 'text-red-600 bg-red-50 border-red-100';

              return (
                <div
                  key={`${result.sourceUrl}-${index}`}
                  className="border border-arda-border rounded-xl p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs text-arda-text-muted truncate">{result.sourceUrl}</div>
                      <div className="font-medium text-sm text-arda-text-primary truncate">
                        {result.item.itemName || 'Unknown item'}
                      </div>
                    </div>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full border ${statusColor}`}>
                      {result.status}
                    </span>
                  </div>

                  <div className="mt-2 text-xs text-arda-text-secondary grid grid-cols-2 gap-x-3 gap-y-1">
                    <span>Supplier: {result.item.supplier || '—'}</span>
                    <span>Price: {result.item.price !== undefined ? `$${result.item.price.toFixed(2)}` : '—'}</span>
                    <span>SKU: {result.item.vendorSku || '—'}</span>
                    <span>ASIN: {result.item.asin || '—'}</span>
                  </div>

                  {result.message && (
                    <p className="mt-2 text-xs text-arda-text-muted">{result.message}</p>
                  )}
                </div>
              );
            })}
          </div>

          <p className="mt-4 text-xs text-arda-text-muted">
            Imported rows: {importedItems.length}. You can still edit everything in the Review step.
          </p>
        </div>
      )}
    </div>
  );
};
