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

function appendUrlsWithLimit(existingRaw: string, incoming: string[], limit: number): { nextRaw: string; added: number; truncated: boolean } {
  const existing = parseUrls(existingRaw);
  const seen = new Set(existing);

  const next: string[] = [...existing];
  let added = 0;

  for (const url of incoming) {
    const trimmed = url.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    if (next.length >= limit) {
      return { nextRaw: next.join('\n'), added, truncated: true };
    }
    next.push(trimmed);
    seen.add(trimmed);
    added += 1;
  }

  return { nextRaw: next.join('\n'), added, truncated: false };
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
    && (item.imageUrl ?? '') === (imported.imageUrl ?? '')
    && (item.description ?? '') === (imported.description ?? '')
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
  const [listingUrlInput, setListingUrlInput] = useState('');
  const [isExtractingListing, setIsExtractingListing] = useState(false);
  const [listingMessage, setListingMessage] = useState<string | null>(null);
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

  const handleToggleApproval = (sourceUrl: string, approved: boolean) => {
    setRows(previousRows => previousRows.map(row => (
      row.sourceUrl === sourceUrl ? { ...row, approved } : row
    )));
  };

  const handleScrape = async () => {
    if (parsedUrls.length === 0 || overLimit || isScraping) {
      return;
    }

    setIsScraping(true);
    setError(null);
    setListingMessage(null);

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

  const handleExtractListingUrls = async () => {
    const listingUrl = listingUrlInput.trim();
    if (!listingUrl || isExtractingListing) return;

    setIsExtractingListing(true);
    setError(null);
    setListingMessage(null);

    try {
      const response = await urlIngestionApi.scrapeListingUrl(listingUrl, MAX_URLS);
      if (!response.productUrls || response.productUrls.length === 0) {
        setListingMessage(response.message || 'No product links found.');
        return;
      }

      const { nextRaw, added, truncated } = appendUrlsWithLimit(urlInput, response.productUrls, MAX_URLS);
      setUrlInput(nextRaw);
      setListingMessage(
        truncated
          ? `Added ${added} product link${added === 1 ? '' : 's'} (truncated to ${MAX_URLS} total).`
          : `Added ${added} product link${added === 1 ? '' : 's'}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to extract product links');
    } finally {
      setIsExtractingListing(false);
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

  const handleAddRowToMasterList = (sourceUrl: string) => {
    const row = rows.find(entry => entry.sourceUrl === sourceUrl);
    if (!row) return;

    handleToggleApproval(sourceUrl, true);
    onImportItems([row.item]);
    setImportMessage('Added 1 item to the Master List.');
  };

  const handleAddAllToMasterList = () => {
    const eligible = rows.filter(row => row.status === 'success' || row.status === 'partial');
    if (eligible.length === 0) {
      setImportMessage('No successful or partial rows to add.');
      return;
    }

    setRows(previousRows => previousRows.map(row => (
      row.status === 'success' || row.status === 'partial'
        ? { ...row, approved: true }
        : row
    )));

    const toImport = eligible
      .filter(row => !isImportedRowSynced(row, importedBySource.get(row.sourceUrl)))
      .map(row => row.item);

    if (toImport.length === 0) {
      setImportMessage('All eligible rows are already added to the Master List.');
      return;
    }

    onImportItems(toImport);
    setImportMessage(`Added ${toImport.length} item${toImport.length === 1 ? '' : 's'} to the Master List.`);
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

        <div className="mt-4 rounded-xl border border-arda-border p-3 bg-arda-bg-secondary">
          <div className="text-sm font-medium text-arda-text-primary">Listing / search URL</div>
          <p className="text-xs text-arda-text-secondary mt-1">
            Paste a category/search results page and extract product links (first page only).
          </p>
          <div className="mt-2 flex flex-col sm:flex-row gap-2">
            <input
              value={listingUrlInput}
              onChange={(event) => setListingUrlInput(event.target.value)}
              placeholder="https://www.mcmaster.com/products/..."
              className="flex-1 rounded-xl border border-arda-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-arda-accent/30"
            />
            <button
              type="button"
              onClick={() => void handleExtractListingUrls()}
              disabled={!listingUrlInput.trim() || isExtractingListing}
              className="btn-arda-outline text-sm py-2 px-4 disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              {isExtractingListing ? <Icons.Loader2 className="w-4 h-4 animate-spin" /> : <Icons.Link className="w-4 h-4" />}
              Extract product links
            </button>
          </div>

          {listingMessage && (
            <p className="mt-2 text-xs text-arda-text-secondary">{listingMessage}</p>
          )}
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
              <span className="text-arda-text-muted">→</span>
              <span className="font-medium text-arda-text-secondary">Master List</span>
              <span className="text-green-600">{successCount} success</span>
              <span className="text-orange-600">{partialCount} partial</span>
              <span className="text-red-600">{failedCount} failed</span>
              <span className="text-arda-text-secondary">{approvedCount} approved</span>
              <span className="text-arda-text-muted">{pendingCount} pending review</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleAddAllToMasterList}
                disabled={rows.length === 0}
                className="btn-arda-primary text-sm py-1.5 inline-flex items-center gap-2 disabled:opacity-50"
              >
                <Icons.ArrowRight className="w-4 h-4" />
                Add all → Import list
              </button>
              <button
                type="button"
                onClick={handleImport}
                disabled={rows.length === 0}
                className="btn-arda-outline text-sm py-1.5 inline-flex items-center gap-2 disabled:opacity-50"
              >
                <Icons.Download className="w-4 h-4" />
                Import approved
              </button>
            </div>
          </div>

          <div className="max-h-[520px] overflow-auto space-y-3 rounded-xl border border-arda-border bg-arda-bg-secondary/30 p-3">
            {rows.map(row => {
              const statusColor = row.status === 'success'
                ? 'text-green-600 bg-green-50 border-green-100'
                : row.status === 'partial'
                  ? 'text-orange-600 bg-orange-50 border-orange-100'
                  : 'text-red-600 bg-red-50 border-red-100';

              const isSynced = isImportedRowSynced(row, importedBySource.get(row.sourceUrl));
              const productHref = row.item.productUrl || row.sourceUrl;

              return (
                <div
                  key={row.sourceUrl}
                  className="rounded-xl border border-arda-border bg-white shadow-sm p-3"
                >
                  <div className="grid grid-cols-1 md:grid-cols-[96px_1fr_auto] gap-3 items-start">
                    <div className="w-full">
                      {row.item.imageUrl ? (
                        <img
                          src={row.item.imageUrl}
                          alt={row.item.itemName || 'Product image'}
                          className="w-24 h-24 rounded-lg object-contain border border-arda-border bg-white"
                          loading="lazy"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-24 h-24 rounded-lg border border-arda-border bg-arda-bg-tertiary flex items-center justify-center text-arda-text-muted">
                          <Icons.Image className="w-6 h-6" />
                        </div>
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <label className="inline-flex items-center gap-2 text-xs text-arda-text-secondary">
                          <input
                            type="checkbox"
                            checked={row.approved}
                            onChange={(event) => handleToggleApproval(row.sourceUrl, event.target.checked)}
                            aria-label={`Approve ${row.sourceUrl}`}
                          />
                          <span>Reviewed</span>
                        </label>

                        <span className={`text-[11px] px-2 py-0.5 rounded-full border ${statusColor}`}>
                          {row.status}
                        </span>

                        <a
                          href={row.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-arda-text-muted underline break-all"
                        >
                          {row.sourceUrl}
                        </a>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        <div>
                          <div className="text-[11px] text-arda-text-muted mb-1">Item name</div>
                          <input
                            value={row.item.itemName ?? ''}
                            onChange={(event) => handleFieldChange(row.sourceUrl, 'itemName', event.target.value)}
                            placeholder="Item name"
                            aria-label={`Item name for ${row.sourceUrl}`}
                            className="w-full rounded-lg border border-arda-border px-2 py-1 text-xs"
                          />
                        </div>

                        <div>
                          <div className="text-[11px] text-arda-text-muted mb-1">Supplier</div>
                          <input
                            value={row.item.supplier ?? ''}
                            onChange={(event) => handleFieldChange(row.sourceUrl, 'supplier', event.target.value)}
                            placeholder="Supplier"
                            aria-label={`Supplier for ${row.sourceUrl}`}
                            className="w-full rounded-lg border border-arda-border px-2 py-1 text-xs"
                          />
                        </div>

                        <div>
                          <div className="text-[11px] text-arda-text-muted mb-1">SKU</div>
                          <input
                            value={row.item.vendorSku ?? ''}
                            onChange={(event) => handleFieldChange(row.sourceUrl, 'vendorSku', event.target.value)}
                            placeholder="SKU"
                            aria-label={`SKU for ${row.sourceUrl}`}
                            className="w-full rounded-lg border border-arda-border px-2 py-1 text-xs"
                          />
                        </div>

                        <div>
                          <div className="text-[11px] text-arda-text-muted mb-1">Price</div>
                          <input
                            type="number"
                            step="0.01"
                            value={row.item.price ?? ''}
                            onChange={(event) => handlePriceChange(row.sourceUrl, event.target.value)}
                            placeholder="0.00"
                            aria-label={`Price for ${row.sourceUrl}`}
                            className="w-full rounded-lg border border-arda-border px-2 py-1 text-xs"
                          />
                        </div>

                        <div>
                          <div className="text-[11px] text-arda-text-muted mb-1">ASIN</div>
                          <input
                            value={row.item.asin ?? ''}
                            onChange={(event) => handleFieldChange(row.sourceUrl, 'asin', event.target.value)}
                            placeholder="ASIN"
                            aria-label={`ASIN for ${row.sourceUrl}`}
                            className="w-full rounded-lg border border-arda-border px-2 py-1 text-xs"
                          />
                        </div>
                      </div>

                      <div className="mt-2 text-xs text-arda-text-muted">
                        {row.message || '—'}
                      </div>
                    </div>

                    <div className="flex md:flex-col flex-row items-center md:items-end gap-2 justify-end">
                      <a
                        href={productHref}
                        target="_blank"
                        rel="noreferrer"
                        className="btn-arda-outline text-xs py-1 px-2 inline-flex items-center gap-1"
                        aria-label={`Open product page for ${row.sourceUrl}`}
                      >
                        <Icons.ExternalLink className="w-3.5 h-3.5" />
                        Link
                      </a>

                      <button
                        type="button"
                        onClick={() => handleAddRowToMasterList(row.sourceUrl)}
                        disabled={isSynced}
                        className={isSynced
                          ? 'btn-arda-outline text-xs py-1 px-2 inline-flex items-center gap-1 opacity-60 cursor-not-allowed'
                          : 'btn-arda-primary text-xs py-1 px-2 inline-flex items-center gap-1'
                        }
                        aria-label={isSynced ? `Added ${row.sourceUrl}` : `Add ${row.sourceUrl} to Master List`}
                      >
                        {isSynced ? <Icons.Check className="w-3.5 h-3.5" /> : <Icons.ArrowRight className="w-3.5 h-3.5" />}
                        {isSynced ? 'Added' : 'Add → Master List'}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteRow(row.sourceUrl)}
                        className="text-red-600 hover:text-red-700 inline-flex items-center gap-1 text-xs"
                        aria-label={`Delete ${row.sourceUrl}`}
                      >
                        <Icons.Trash2 className="w-3.5 h-3.5" />
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
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
