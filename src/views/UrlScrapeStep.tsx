import { useEffect, useMemo, useState } from 'react';
import { Icons } from '../components/Icons';
import { urlIngestionApi, UrlScrapeResult, UrlScrapedItem } from '../services/api';

interface UrlScrapeStepProps {
  importedItems: UrlScrapedItem[];
  onImportItems: (items: UrlScrapedItem[]) => void;
  onDeleteImportedItem?: (sourceUrl: string) => void;
  onReviewStateChange?: (state: UrlReviewState) => void;
}

interface UrlReviewState {
  pendingReviewCount: number;
  unimportedApprovedCount: number;
  totalRows: number;
  canContinue: boolean;
}

interface EditableScrapeRow {
  sourceUrl: string;
  status: UrlScrapeResult['status'];
  message?: string;
  item: UrlScrapedItem;
  approved: boolean;
}

const MAX_URLS = 50;

function parseUrls(raw: string): string[] {
  const tokens = raw
    .split(/[\n,]/g)
    .map(token => token.trim())
    .filter(Boolean);

  return Array.from(new Set(tokens));
}

function isImportedRowSynced(row: EditableScrapeRow, imported?: UrlScrapedItem): boolean {
  if (!imported) return false;
  const item = row.item;
  return (
    (item.itemName ?? '') === (imported.itemName ?? '')
    && (item.supplier ?? '') === (imported.supplier ?? '')
    && (item.vendorSku ?? '') === (imported.vendorSku ?? '')
    && (item.asin ?? '') === (imported.asin ?? '')
    && (item.productUrl ?? '') === (imported.productUrl ?? '')
    && (item.price ?? null) === (imported.price ?? null)
  );
}

export const UrlScrapeStep: React.FC<UrlScrapeStepProps> = ({
  importedItems,
  onImportItems,
  onDeleteImportedItem,
  onReviewStateChange,
}) => {
  const [urlInput, setUrlInput] = useState('');
  const [isScraping, setIsScraping] = useState(false);
  const [rows, setRows] = useState<EditableScrapeRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  const parsedUrls = useMemo(() => parseUrls(urlInput), [urlInput]);
  const overLimit = parsedUrls.length > MAX_URLS;

  const importedBySource = useMemo(
    () => new Map(importedItems.map(item => [item.sourceUrl, item])),
    [importedItems],
  );

  const successCount = rows.filter(result => result.status === 'success').length;
  const partialCount = rows.filter(result => result.status === 'partial').length;
  const failedCount = rows.filter(result => result.status === 'failed').length;
  const approvedCount = rows.filter(row => row.approved).length;
  const pendingCount = rows.length - approvedCount;
  const unimportedApprovedCount = rows.filter(row => (
    row.approved && !isImportedRowSynced(row, importedBySource.get(row.sourceUrl))
  )).length;
  const canContinue = rows.length === 0 || (pendingCount === 0 && unimportedApprovedCount === 0);

  useEffect(() => {
    onReviewStateChange?.({
      pendingReviewCount: pendingCount,
      unimportedApprovedCount,
      totalRows: rows.length,
      canContinue,
    });
  }, [canContinue, onReviewStateChange, pendingCount, rows.length, unimportedApprovedCount]);

  const handleScrape = async () => {
    if (parsedUrls.length === 0 || overLimit || isScraping) {
      return;
    }

    setIsScraping(true);
    setError(null);

    try {
      const response = await urlIngestionApi.scrapeUrls(parsedUrls);
      setRows(previousRows => {
        const merged = new Map<string, EditableScrapeRow>();

        previousRows.forEach(row => {
          merged.set(row.sourceUrl, row);
        });

        response.results.forEach(result => {
          const existing = merged.get(result.sourceUrl);
          merged.set(result.sourceUrl, {
            sourceUrl: result.sourceUrl,
            status: result.status,
            message: result.message,
            item: {
              ...existing?.item,
              ...result.item,
              sourceUrl: result.item.sourceUrl || result.sourceUrl,
              productUrl: result.item.productUrl || result.sourceUrl,
            },
            approved: existing?.approved ?? false,
          });
        });

        return Array.from(merged.values());
      });
      setImportMessage(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to scrape URLs');
    } finally {
      setIsScraping(false);
    }
  };

  const handleImport = () => {
    const approvedRows = rows.filter(row => row.approved);
    if (approvedRows.length === 0) {
      setImportMessage('Approve at least one row before importing.');
      return;
    }

    onImportItems(approvedRows.map(row => row.item));
    setImportMessage(`Imported ${approvedRows.length} approved row${approvedRows.length === 1 ? '' : 's'}.`);
  };

  const handleToggleApproval = (sourceUrl: string, approved: boolean) => {
    setRows(previousRows => previousRows.map(row => (
      row.sourceUrl === sourceUrl ? { ...row, approved } : row
    )));
  };

  const handleDeleteRow = (sourceUrl: string) => {
    setRows(previousRows => previousRows.filter(row => row.sourceUrl !== sourceUrl));
    onDeleteImportedItem?.(sourceUrl);
  };

  const handleFieldChange = (
    sourceUrl: string,
    field: 'itemName' | 'supplier' | 'vendorSku' | 'asin' | 'productUrl',
    value: string,
  ) => {
    setRows(previousRows => previousRows.map(row => {
      if (row.sourceUrl !== sourceUrl) return row;
      return {
        ...row,
        item: {
          ...row.item,
          [field]: value.trim() ? value : undefined,
        },
      };
    }));
  };

  const handlePriceChange = (sourceUrl: string, value: string) => {
    setRows(previousRows => previousRows.map(row => {
      if (row.sourceUrl !== sourceUrl) return row;

      if (!value.trim()) {
        return {
          ...row,
          item: {
            ...row.item,
            price: undefined,
          },
        };
      }

      const parsedPrice = Number(value);
      if (!Number.isFinite(parsedPrice)) {
        return row;
      }

      return {
        ...row,
        item: {
          ...row.item,
          price: parsedPrice,
        },
      };
    }));
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-arda-border p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-arda-text-primary">Paste Product URLs</h2>
            <p className="text-sm text-arda-text-secondary mt-1">
              Add up to 50 links. Amazon URLs use ASIN enrichment, other URLs use metadata + AI fallback. McMaster-Carr
              sometimes blocks automated requests, so you may get partial details (supplier + SKU) to review. New
              scrapes append to the table below so you can build one running list.
            </p>
          </div>
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

      {(rows.length > 0 || importedItems.length > 0) && (
        <div className="bg-white rounded-2xl border border-arda-border p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-semibold text-arda-text-primary">Scrape Results</span>
              <span className="text-green-600">{successCount} success</span>
              <span className="text-orange-600">{partialCount} partial</span>
              <span className="text-red-600">{failedCount} failed</span>
              <span className="text-arda-text-secondary">{approvedCount} approved</span>
              <span className="text-arda-text-muted">{pendingCount} pending review</span>
            </div>
            <button
              type="button"
              onClick={handleImport}
              disabled={rows.length === 0}
              className="btn-arda-outline text-sm py-1.5 inline-flex items-center gap-2 disabled:opacity-50"
            >
              <Icons.Download className="w-4 h-4" />
              Import Approved To Master List
            </button>
          </div>

          <div className="max-h-[420px] overflow-auto rounded-xl border border-arda-border">
            <table className="w-full min-w-[1080px] text-xs">
              <thead className="bg-arda-bg-tertiary text-arda-text-secondary sticky top-0">
                <tr>
                  <th className="px-2 py-2 text-left font-medium w-20">Approve</th>
                  <th className="px-2 py-2 text-left font-medium min-w-[220px]">Source URL</th>
                  <th className="px-2 py-2 text-left font-medium min-w-[180px]">Item Name</th>
                  <th className="px-2 py-2 text-left font-medium min-w-[150px]">Supplier</th>
                  <th className="px-2 py-2 text-left font-medium min-w-[130px]">SKU</th>
                  <th className="px-2 py-2 text-left font-medium min-w-[120px]">Price</th>
                  <th className="px-2 py-2 text-left font-medium min-w-[130px]">ASIN</th>
                  <th className="px-2 py-2 text-left font-medium min-w-[220px]">Product URL</th>
                  <th className="px-2 py-2 text-left font-medium w-24">Status</th>
                  <th className="px-2 py-2 text-left font-medium min-w-[180px]">Message</th>
                  <th className="px-2 py-2 text-left font-medium w-20">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => {
                  const statusColor = row.status === 'success'
                    ? 'text-green-600 bg-green-50 border-green-100'
                    : row.status === 'partial'
                      ? 'text-orange-600 bg-orange-50 border-orange-100'
                      : 'text-red-600 bg-red-50 border-red-100';

                  return (
                    <tr key={row.sourceUrl} className="border-t border-arda-border align-top">
                      <td className="px-2 py-2">
                        <label className="inline-flex items-center gap-2 text-arda-text-secondary">
                          <input
                            type="checkbox"
                            checked={row.approved}
                            onChange={(event) => handleToggleApproval(row.sourceUrl, event.target.checked)}
                            aria-label={`Approve ${row.sourceUrl}`}
                          />
                          <span>Approve</span>
                        </label>
                      </td>
                      <td className="px-2 py-2">
                        <a
                          href={row.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-arda-accent underline break-all"
                        >
                          {row.sourceUrl}
                        </a>
                      </td>
                      <td className="px-2 py-2">
                        <input
                          value={row.item.itemName ?? ''}
                          onChange={(event) => handleFieldChange(row.sourceUrl, 'itemName', event.target.value)}
                          placeholder="Item name"
                          aria-label={`Item name for ${row.sourceUrl}`}
                          className="w-full rounded-lg border border-arda-border px-2 py-1 text-xs"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          value={row.item.supplier ?? ''}
                          onChange={(event) => handleFieldChange(row.sourceUrl, 'supplier', event.target.value)}
                          placeholder="Supplier"
                          aria-label={`Supplier for ${row.sourceUrl}`}
                          className="w-full rounded-lg border border-arda-border px-2 py-1 text-xs"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          value={row.item.vendorSku ?? ''}
                          onChange={(event) => handleFieldChange(row.sourceUrl, 'vendorSku', event.target.value)}
                          placeholder="SKU"
                          aria-label={`SKU for ${row.sourceUrl}`}
                          className="w-full rounded-lg border border-arda-border px-2 py-1 text-xs"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="number"
                          step="0.01"
                          value={row.item.price ?? ''}
                          onChange={(event) => handlePriceChange(row.sourceUrl, event.target.value)}
                          placeholder="0.00"
                          aria-label={`Price for ${row.sourceUrl}`}
                          className="w-full rounded-lg border border-arda-border px-2 py-1 text-xs"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          value={row.item.asin ?? ''}
                          onChange={(event) => handleFieldChange(row.sourceUrl, 'asin', event.target.value)}
                          placeholder="ASIN"
                          aria-label={`ASIN for ${row.sourceUrl}`}
                          className="w-full rounded-lg border border-arda-border px-2 py-1 text-xs"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          value={row.item.productUrl ?? ''}
                          onChange={(event) => handleFieldChange(row.sourceUrl, 'productUrl', event.target.value)}
                          placeholder="Product URL"
                          aria-label={`Product URL for ${row.sourceUrl}`}
                          className="w-full rounded-lg border border-arda-border px-2 py-1 text-xs"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <span className={`text-[11px] px-2 py-0.5 rounded-full border ${statusColor}`}>
                          {row.status}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-arda-text-muted">
                        {row.message || '—'}
                      </td>
                      <td className="px-2 py-2">
                        <button
                          type="button"
                          onClick={() => handleDeleteRow(row.sourceUrl)}
                          className="text-red-600 hover:text-red-700 inline-flex items-center gap-1"
                          aria-label={`Delete ${row.sourceUrl}`}
                        >
                          <Icons.Trash2 className="w-3.5 h-3.5" />
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {importMessage && (
            <p className="mt-3 text-xs text-arda-text-secondary">{importMessage}</p>
          )}

          <p className="mt-4 text-xs text-arda-text-muted">
            Imported rows: {importedItems.length}. You can still edit everything in the Review step.
          </p>
        </div>
      )}
    </div>
  );
};
