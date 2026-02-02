import { useState, useRef, useCallback, useDeferredValue, useMemo, memo } from 'react';
import Papa from 'papaparse';
import type { ParseError } from 'papaparse';
import { Icons } from '../components/Icons';
import {
  type CSVItem,
  type ColumnMapping,
  detectColumnMapping,
  normalizeCSVColor,
} from './csvUploadUtils';

function trimOrUndefined(value: string | undefined): string | undefined {
  const v = (value ?? '').trim();
  return v ? v : undefined;
}

function parseOptionalNumber(value: string): number | undefined {
  const v = (value ?? '').trim();
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

interface CSVUploadStepProps {
  onComplete: (approvedItems: CSVItem[]) => void;
  onBack?: () => void;
}

export const CSVUploadStep: React.FC<CSVUploadStepProps> = ({
  onComplete,
}) => {
  // CSV parsing state
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvData, setCsvData] = useState<Record<string, string>[]>([]);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>({});
  const [showMappingModal, setShowMappingModal] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  
  // Items after mapping
  const [items, setItems] = useState<CSVItem[]>([]);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  
  // Filter state
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearch = useDeferredValue(searchQuery);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Parse CSV file with robust handling (quoted fields, BOM, commas in text)
  const parseCSV = useCallback((text: string) => {
    setParseError(null);
    setIsParsing(true);
    setItems([]);
    setSelectedItems(new Set());

    const result = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (header: string) => header.trim(),
    });

    const { data, errors, meta } = result;

    const fatalError = errors.find((e: ParseError) => e.fatal);
    if (fatalError) {
      setIsParsing(false);
      const rowNum = typeof fatalError.row === 'number' ? fatalError.row + 1 : '?';
      setParseError(`Parse error on row ${rowNum}: ${fatalError.message}`);
      setCsvData([]);
      setCsvHeaders([]);
      return;
    }

    if (!meta.fields || meta.fields.length === 0) {
      setIsParsing(false);
      setParseError('No headers detected. Please include a header row in your CSV.');
      setCsvData([]);
      setCsvHeaders([]);
      return;
    }

    if (data.length === 0) {
      setIsParsing(false);
      setParseError('No data rows found. Please provide at least one row of items.');
      setCsvData([]);
      setCsvHeaders([]);
      return;
    }

    if (data.length > 5000) {
      setIsParsing(false);
      setParseError('CSV is too large (over 5,000 rows). Please split the file and try again.');
      setCsvData([]);
      setCsvHeaders([]);
      return;
    }

    setCsvHeaders(meta.fields);
    setCsvData(data);
    setColumnMapping(detectColumnMapping(meta.fields));
    setShowMappingModal(true);
    setIsParsing(false);
  }, []);

  // Handle file upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const maxSizeBytes = 5 * 1024 * 1024; // 5MB safeguard for frontend parsing
    if (file.size > maxSizeBytes) {
      setParseError('File is too large. Please upload a CSV smaller than 5MB.');
      e.target.value = '';
      return;
    }
    
    setFileName(file.name);
    setParseError(null);
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      parseCSV(text);
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset for re-selection
  };

  // Apply column mapping and create items
  const applyMapping = () => {
    const newItems: CSVItem[] = csvData.map((row, index) => ({
      id: `csv-${Date.now()}-${index}`,
      rowIndex: index + 2, // +2 for 1-indexed and header row
      name: row[columnMapping.name || ''] || `Row ${index + 2}`,
      sku: row[columnMapping.sku || ''],
      barcode: row[columnMapping.barcode || ''],
      supplier: row[columnMapping.supplier || ''],
      location: row[columnMapping.location || ''],
      minQty: columnMapping.minQty ? parseFloat(row[columnMapping.minQty]) || undefined : undefined,
      orderQty: columnMapping.orderQty ? parseFloat(row[columnMapping.orderQty]) || undefined : undefined,
      unitPrice: columnMapping.unitPrice ? parseFloat(row[columnMapping.unitPrice]) || undefined : undefined,
      imageUrl: trimOrUndefined(row[columnMapping.imageUrl || '']),
      productUrl: trimOrUndefined(row[columnMapping.productUrl || '']),
      color: columnMapping.color ? normalizeCSVColor(row[columnMapping.color]) : undefined,
      isApproved: false,
      isRejected: false,
      rawData: row,
    }));
    
    setItems(newItems);
    setShowMappingModal(false);
  };

  // Approval actions
  const approveItem = useCallback((id: string) => {
    setItems(prev => prev.map(item => 
      item.id === id ? { ...item, isApproved: true, isRejected: false } : item
    ));
  }, []);

  const rejectItem = useCallback((id: string) => {
    setItems(prev => prev.map(item => 
      item.id === id ? { ...item, isApproved: false, isRejected: true } : item
    ));
  }, []);

  const approveSelected = useCallback(() => {
    setItems(prev => prev.map(item => 
      selectedItems.has(item.id) ? { ...item, isApproved: true, isRejected: false } : item
    ));
    setSelectedItems(new Set());
  }, [selectedItems]);

  const approveAll = useCallback(() => {
    setItems(prev => prev.map(item => ({ ...item, isApproved: true, isRejected: false })));
  }, []);

  const rejectSelected = useCallback(() => {
    setItems(prev => prev.map(item => 
      selectedItems.has(item.id) ? { ...item, isApproved: false, isRejected: true } : item
    ));
    setSelectedItems(new Set());
  }, [selectedItems]);

  const updateItemFields = useCallback((id: string, updates: Partial<CSVItem>) => {
    setItems(prev => prev.map(item => (item.id === id ? { ...item, ...updates } : item)));
  }, []);

  // Toggle selection
  const toggleSelection = useCallback((id: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Filter items (must be defined before toggleSelectAll which uses it)
  const filteredItems = useMemo(() => items.filter(item => {
    // Filter by status
    if (filter === 'pending' && (item.isApproved || item.isRejected)) return false;
    if (filter === 'approved' && !item.isApproved) return false;
    if (filter === 'rejected' && !item.isRejected) return false;
    
    // Filter by search
    if (deferredSearch) {
      const query = deferredSearch.toLowerCase();
      return (
        item.name.toLowerCase().includes(query) ||
        item.sku?.toLowerCase().includes(query) ||
        item.barcode?.toLowerCase().includes(query) ||
        item.supplier?.toLowerCase().includes(query)
      );
    }
    return true;
  }), [items, filter, deferredSearch]);

  const toggleSelectAll = useCallback(() => {
    if (selectedItems.size === filteredItems.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(filteredItems.map(item => item.id)));
    }
  }, [filteredItems, selectedItems.size]);

  // Stats
  const stats = useMemo(() => ({
    total: items.length,
    pending: items.filter(i => !i.isApproved && !i.isRejected).length,
    approved: items.filter(i => i.isApproved).length,
    rejected: items.filter(i => i.isRejected).length,
  }), [items]);

  // Handle completion
  const handleComplete = () => {
    const approvedItems = items.filter(item => item.isApproved);
    onComplete(approvedItems);
  };

  // Memoized row component to minimize rerenders on big CSVs
  const CSVRow = memo(({ item, selected }: { item: CSVItem; selected: boolean }) => (
    <tr 
      key={item.id} 
      className={`
        hover:bg-arda-bg-tertiary transition-colors
        ${item.isApproved ? 'bg-green-50' : ''}
        ${item.isRejected ? 'bg-red-50 opacity-60' : ''}
      `}
    >
      <td className="px-4 py-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => toggleSelection(item.id)}
          className="rounded border-gray-300"
          aria-label={`Select ${item.name}`}
          title={`Select ${item.name}`}
        />
      </td>
      <td className="px-4 py-3">
        <input
          type="text"
          value={item.name}
          onChange={(e) => updateItemFields(item.id, { name: e.target.value })}
          className="w-full bg-transparent border border-transparent rounded-md px-2 py-1 text-sm font-semibold text-arda-text-primary focus:bg-white focus:border-arda-border focus:ring-2 focus:ring-arda-accent"
          aria-label={`Item name (row ${item.rowIndex})`}
          title={`Item name (row ${item.rowIndex})`}
        />
        {(item.imageUrl || item.productUrl || item.color) && (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {item.productUrl && (
              <a
                href={item.productUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-arda-accent hover:underline"
              >
                <Icons.ExternalLink className="w-3 h-3" />
                Product link
              </a>
            )}
            {item.imageUrl && (
              <span className="inline-flex items-center gap-1 text-xs text-arda-text-secondary bg-arda-bg-tertiary border border-arda-border rounded-lg px-2 py-0.5">
                <Icons.Camera className="w-3 h-3" />
                Image
              </span>
            )}
            {item.color && (
              <span className="inline-flex items-center gap-1 text-xs text-arda-text-secondary bg-arda-bg-tertiary border border-arda-border rounded-lg px-2 py-0.5">
                <span className="w-2 h-2 rounded-full bg-arda-accent" aria-hidden="true" />
                {item.color}
              </span>
            )}
          </div>
        )}
        <div className="text-xs text-arda-text-muted">Row {item.rowIndex}</div>
      </td>
      <td className="px-4 py-3">
        <div className="space-y-1">
          <input
            type="text"
            value={item.sku ?? ''}
            onChange={(e) => updateItemFields(item.id, { sku: trimOrUndefined(e.target.value) })}
            className="w-full bg-transparent border border-transparent rounded-md px-2 py-1 text-sm text-arda-text-primary focus:bg-white focus:border-arda-border focus:ring-2 focus:ring-arda-accent"
            placeholder="SKU"
            aria-label={`SKU (row ${item.rowIndex})`}
            title={`SKU (row ${item.rowIndex})`}
          />
          <input
            type="text"
            value={item.barcode ?? ''}
            onChange={(e) => updateItemFields(item.id, { barcode: trimOrUndefined(e.target.value) })}
            className="w-full bg-transparent border border-transparent rounded-md px-2 py-1 text-sm text-arda-text-primary focus:bg-white focus:border-arda-border focus:ring-2 focus:ring-arda-accent font-mono"
            placeholder="Barcode"
            aria-label={`Barcode (row ${item.rowIndex})`}
            title={`Barcode (row ${item.rowIndex})`}
          />
        </div>
      </td>
      <td className="px-4 py-3">
        <input
          type="text"
          value={item.supplier ?? ''}
          onChange={(e) => updateItemFields(item.id, { supplier: trimOrUndefined(e.target.value) })}
          className="w-full bg-transparent border border-transparent rounded-md px-2 py-1 text-sm text-arda-text-primary focus:bg-white focus:border-arda-border focus:ring-2 focus:ring-arda-accent"
          placeholder="Supplier"
          aria-label={`Supplier (row ${item.rowIndex})`}
          title={`Supplier (row ${item.rowIndex})`}
        />
      </td>
      <td className="px-4 py-3">
        <input
          type="text"
          value={item.location ?? ''}
          onChange={(e) => updateItemFields(item.id, { location: trimOrUndefined(e.target.value) })}
          className="w-full bg-transparent border border-transparent rounded-md px-2 py-1 text-sm text-arda-text-primary focus:bg-white focus:border-arda-border focus:ring-2 focus:ring-arda-accent"
          placeholder="Location"
          aria-label={`Location (row ${item.rowIndex})`}
          title={`Location (row ${item.rowIndex})`}
        />
      </td>
      <td className="px-4 py-3">
        <div className="grid grid-cols-1 gap-1">
          <input
            type="number"
            inputMode="numeric"
            value={item.minQty ?? ''}
            onChange={(e) => updateItemFields(item.id, { minQty: parseOptionalNumber(e.target.value) })}
            className="w-full bg-transparent border border-transparent rounded-md px-2 py-1 text-sm text-arda-text-primary focus:bg-white focus:border-arda-border focus:ring-2 focus:ring-arda-accent"
            placeholder="Min"
            aria-label={`Min qty (row ${item.rowIndex})`}
            title={`Min qty (row ${item.rowIndex})`}
          />
          <input
            type="number"
            inputMode="numeric"
            value={item.orderQty ?? ''}
            onChange={(e) => updateItemFields(item.id, { orderQty: parseOptionalNumber(e.target.value) })}
            className="w-full bg-transparent border border-transparent rounded-md px-2 py-1 text-sm text-arda-text-primary focus:bg-white focus:border-arda-border focus:ring-2 focus:ring-arda-accent"
            placeholder="Order"
            aria-label={`Order qty (row ${item.rowIndex})`}
            title={`Order qty (row ${item.rowIndex})`}
          />
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            value={item.unitPrice ?? ''}
            onChange={(e) => updateItemFields(item.id, { unitPrice: parseOptionalNumber(e.target.value) })}
            className="w-full bg-transparent border border-transparent rounded-md px-2 py-1 text-sm text-arda-text-primary focus:bg-white focus:border-arda-border focus:ring-2 focus:ring-arda-accent"
            placeholder="Price"
            aria-label={`Unit price (row ${item.rowIndex})`}
            title={`Unit price (row ${item.rowIndex})`}
          />
        </div>
      </td>
      <td className="px-4 py-3">
        {item.isApproved && (
          <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
            Approved
          </span>
        )}
        {item.isRejected && (
          <span className="px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs font-medium">
            Rejected
          </span>
        )}
        {!item.isApproved && !item.isRejected && (
          <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded-full text-xs font-medium">
            Pending
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={() => approveItem(item.id)}
            className={`p-1.5 rounded transition-colors ${
              item.isApproved 
                ? 'bg-green-100 text-green-600' 
                : 'hover:bg-green-100 text-gray-400 hover:text-green-600'
            }`}
            title="Approve"
          >
            <Icons.Check className="w-4 h-4" />
          </button>
          <button
            onClick={() => rejectItem(item.id)}
            className={`p-1.5 rounded transition-colors ${
              item.isRejected 
                ? 'bg-red-100 text-red-600' 
                : 'hover:bg-red-100 text-gray-400 hover:text-red-600'
            }`}
            title="Reject"
          >
            <Icons.X className="w-4 h-4" />
          </button>
        </div>
      </td>
    </tr>
  ), (prev, next) => prev.item === next.item && prev.selected === next.selected);

  return (
    <div className="space-y-6">
      {/* Actions (footer Continue is hidden on this step) */}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => onComplete([])}
          className="btn-arda-outline"
        >
          Skip CSV
        </button>
        <button
          type="button"
          onClick={handleComplete}
          disabled={stats.approved === 0}
          className={[
            'flex items-center gap-2 px-4 py-2 rounded-arda font-semibold text-sm transition-colors',
            stats.approved > 0
              ? 'bg-green-600 text-white hover:bg-green-700'
              : 'bg-arda-border text-arda-text-muted cursor-not-allowed',
          ].join(' ')}
        >
          <Icons.ArrowRight className="w-4 h-4" />
          Add {stats.approved} Item{stats.approved === 1 ? '' : 's'} to Arda
        </button>
      </div>

      {/* Parse errors */}
      {parseError && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-arda-lg px-4 py-3 text-sm">
          {parseError}
        </div>
      )}

      {/* Upload area or items list */}
      {items.length === 0 ? (
        <div className="bg-white rounded-arda-lg border-2 border-dashed border-arda-border p-12 shadow-arda">
          <div className="text-center">
            <Icons.FileSpreadsheet className="w-16 h-16 mx-auto text-arda-text-muted mb-4 opacity-70" />
            <h3 className="text-lg font-semibold text-arda-text-primary mb-2">
              Upload a CSV File
            </h3>
            <p className="text-arda-text-secondary mb-6 max-w-md mx-auto">
              Import your inventory, supplier catalog, or item list. We'll help you map the columns.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              className="hidden"
              aria-label="Upload CSV file"
              title="Upload CSV file"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="btn-arda-primary inline-flex items-center gap-2 px-6 py-3 rounded-xl"
            >
              <Icons.Upload className="w-5 h-5" />
              Select CSV File
            </button>
            <p className="text-sm text-arda-text-muted mt-4">
              Supports: .csv files with headers{isParsing ? ' — parsing…' : ''}
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Stats bar */}
          <div className="card-arda p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <Icons.FileSpreadsheet className="w-5 h-5 text-arda-text-muted" />
                  <span className="font-medium text-arda-text-primary">{fileName}</span>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-arda-text-secondary">{stats.total} items</span>
                  <span className="text-yellow-600">{stats.pending} pending</span>
                  <span className="text-green-600">{stats.approved} approved</span>
                  <span className="text-red-600">{stats.rejected} rejected</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="btn-arda-outline px-3 py-1.5 text-sm"
                >
                  Upload Different File
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleFileUpload}
                  className="hidden"
                  aria-label="Upload CSV file"
                  title="Upload CSV file"
                />
              </div>
            </div>
          </div>

          {/* Filter bar */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {(['all', 'pending', 'approved', 'rejected'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={[
                    'px-3 py-1.5 rounded-arda text-sm font-medium transition-colors border',
                    filter === f
                      ? 'bg-arda-accent text-white border-orange-600'
                      : 'bg-white/70 text-arda-text-secondary border-arda-border hover:bg-arda-bg-tertiary',
                  ].join(' ')}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <Icons.Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-arda-text-muted" />
                <input
                  type="text"
                  placeholder="Search items..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="input-arda pl-9 pr-4 py-2 text-sm bg-white"
                />
              </div>
            </div>
          </div>

          {/* Bulk actions */}
          {selectedItems.size > 0 && (
            <div className="bg-orange-50 border border-orange-200 rounded-arda-lg p-4 flex items-center justify-between">
              <span className="text-orange-800 font-medium">
                {selectedItems.size} items selected
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={approveSelected}
                  className="px-4 py-2 bg-green-600 text-white rounded-arda text-sm font-medium hover:bg-green-700 transition-colors"
                >
                  Approve Selected
                </button>
                <button
                  onClick={rejectSelected}
                  className="px-4 py-2 bg-red-600 text-white rounded-arda text-sm font-medium hover:bg-red-700 transition-colors"
                >
                  Reject Selected
                </button>
              </div>
            </div>
          )}

          {/* Items table */}
          <div className="card-arda overflow-hidden">
            <table className="table-arda">
              <thead className="bg-arda-bg-secondary border-b border-arda-border">
                <tr>
                  <th className="px-4 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={selectedItems.size === filteredItems.length && filteredItems.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded border-gray-300"
                      aria-label="Select all items"
                      title="Select all items"
                    />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-arda-text-secondary uppercase tracking-wider">
                    Item
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-arda-text-secondary uppercase tracking-wider">
                    SKU / Barcode
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-arda-text-secondary uppercase tracking-wider">
                    Supplier
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-arda-text-secondary uppercase tracking-wider">
                    Location
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-arda-text-secondary uppercase tracking-wider">
                    Min / Order / Price
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-arda-text-secondary uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-arda-text-secondary uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-arda-border">
                {filteredItems.map(item => (
                  <CSVRow key={item.id} item={item} selected={selectedItems.has(item.id)} />
                ))}
              </tbody>
            </table>
            
            {filteredItems.length === 0 && (
              <div className="p-12 text-center text-arda-text-muted">
                <Icons.Search className="w-12 h-12 mx-auto mb-3 opacity-40" />
                <p>No items match your filter</p>
              </div>
            )}
          </div>

          {/* Quick actions */}
          <div className="flex items-center justify-between">
            <button
              onClick={approveAll}
              className="px-4 py-2 bg-green-100 text-green-800 rounded-arda font-medium hover:bg-green-200 transition-colors"
            >
              Approve All Items
            </button>
            <div className="text-sm text-arda-text-secondary">
              {stats.approved} of {stats.total} items will be added to your master list
            </div>
          </div>
        </>
      )}

      {/* Column mapping modal */}
      {showMappingModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="arda-glass rounded-2xl w-full max-w-2xl max-h-[80vh] overflow-auto">
            <div className="p-6 border-b border-arda-border/70">
              <h3 className="text-lg font-semibold text-arda-text-primary">Map CSV Columns</h3>
              <p className="text-sm text-arda-text-secondary mt-1">
                Tell us which columns contain which data. We've made some guesses.
              </p>
            </div>
            
            <div className="p-6 space-y-4">
              {/* Core fields */}
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-arda-text-muted">
                  Core fields
                </div>
                <div className="mt-3 space-y-3">
                  {[
                    { key: 'name', label: 'Item Name', required: true },
                    { key: 'sku', label: 'SKU / Part Number' },
                    { key: 'barcode', label: 'Barcode (UPC/EAN)' },
                    { key: 'supplier', label: 'Supplier' },
                    { key: 'location', label: 'Location / Bin' },
                    { key: 'minQty', label: 'Minimum Quantity' },
                    { key: 'orderQty', label: 'Order Quantity' },
                    { key: 'unitPrice', label: 'Unit Price' },
                  ].map(({ key, label, required }) => {
                    const selectId = `csv-map-${key}`;
                    return (
                      <div key={key} className="flex items-center gap-4">
                        <label htmlFor={selectId} className="w-40 text-sm font-medium text-arda-text-secondary">
                          {label} {required && <span className="text-red-500">*</span>}
                        </label>
                        <select
                          id={selectId}
                          value={columnMapping[key as keyof ColumnMapping] || ''}
                          onChange={(e) => setColumnMapping(prev => ({ 
                            ...prev, 
                            [key]: e.target.value || undefined 
                          }))}
                          className="input-arda flex-1 text-sm bg-white"
                          aria-label={label}
                          title={label}
                        >
                          <option value="">— Select column —</option>
                          {csvHeaders.map(header => (
                            <option key={header} value={header}>{header}</option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Optional fields */}
              <div className="pt-4 mt-4 border-t border-arda-border/70">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-arda-text-muted">
                    Optional enrichment
                  </div>
                  <span className="text-xs text-arda-text-muted">
                    (Image URL, Product URL, Color)
                  </span>
                </div>
                <div className="mt-3 space-y-3">
                  {[
                    { key: 'imageUrl', label: 'Image URL' },
                    { key: 'productUrl', label: 'Product URL (link / website / product page)' },
                    { key: 'color', label: 'Color (blue, green, orange, yellow, red, link, purple, gray)' },
                  ].map(({ key, label }) => {
                    const selectId = `csv-map-${key}`;
                    return (
                      <div key={key} className="flex items-center gap-4">
                        <label htmlFor={selectId} className="w-40 text-sm font-medium text-arda-text-secondary">
                          {label}
                        </label>
                        <select
                          id={selectId}
                          value={columnMapping[key as keyof ColumnMapping] || ''}
                          onChange={(e) => setColumnMapping(prev => ({ 
                            ...prev, 
                            [key]: e.target.value || undefined 
                          }))}
                          className="input-arda flex-1 text-sm bg-white"
                          aria-label={label}
                          title={label}
                        >
                          <option value="">— Select column —</option>
                          {csvHeaders.map(header => (
                            <option key={header} value={header}>{header}</option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>
              
              {/* Preview */}
              <div className="mt-6 pt-6 border-t border-arda-border/70">
                <h4 className="text-sm font-medium text-arda-text-primary mb-3">Preview (first 3 rows)</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-arda-bg-secondary">
                      <tr>
                        <th className="px-2 py-1 text-left">Name</th>
                        <th className="px-2 py-1 text-left">SKU</th>
                        <th className="px-2 py-1 text-left">Supplier</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvData.slice(0, 3).map((row, i) => (
                        <tr key={i} className="border-t border-gray-100">
                          <td className="px-2 py-1">{row[columnMapping.name || ''] || '—'}</td>
                          <td className="px-2 py-1">{row[columnMapping.sku || ''] || '—'}</td>
                          <td className="px-2 py-1">{row[columnMapping.supplier || ''] || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {(columnMapping.imageUrl || columnMapping.productUrl || columnMapping.color) && (
                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="bg-white/70 border border-arda-border rounded-arda p-3">
                      <div className="text-xs text-arda-text-muted">Image URL</div>
                      <div className="text-xs text-arda-text-secondary mt-1">
                        {columnMapping.imageUrl ? 'Mapped' : 'Not mapped'}
                      </div>
                    </div>
                    <div className="bg-white/70 border border-arda-border rounded-arda p-3">
                      <div className="text-xs text-arda-text-muted">Product URL</div>
                      <div className="text-xs text-arda-text-secondary mt-1">
                        {columnMapping.productUrl ? 'Mapped' : 'Not mapped'}
                      </div>
                    </div>
                    <div className="bg-white/70 border border-arda-border rounded-arda p-3">
                      <div className="text-xs text-arda-text-muted">Color</div>
                      <div className="text-xs text-arda-text-secondary mt-1">
                        {columnMapping.color ? 'Mapped' : 'Not mapped'}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            <div className="p-6 border-t border-arda-border/70 flex items-center justify-end gap-3">
              <button
                onClick={() => {
                  setShowMappingModal(false);
                  setCsvData([]);
                  setCsvHeaders([]);
                }}
                className="btn-arda-outline"
              >
                Cancel
              </button>
              <button
                onClick={applyMapping}
                disabled={!columnMapping.name || isParsing}
                className={[
                  'px-6 py-2 rounded-arda font-semibold text-sm transition-colors',
                  columnMapping.name && !isParsing
                    ? 'bg-arda-accent text-white hover:bg-arda-accent-hover'
                    : 'bg-arda-border text-arda-text-muted cursor-not-allowed',
                ].join(' ')}
              >
                Apply Mapping
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
