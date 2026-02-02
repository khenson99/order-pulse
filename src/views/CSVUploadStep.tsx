import { useState, useRef, useCallback } from 'react';
import { Icons } from '../components/Icons';

// CSV item with approval status
export interface CSVItem {
  id: string;
  rowIndex: number;
  // Core fields from CSV
  name: string;
  sku?: string;
  barcode?: string;
  supplier?: string;
  location?: string;
  minQty?: number;
  orderQty?: number;
  unitPrice?: number;
  // Approval status
  isApproved: boolean;
  isRejected: boolean;
  // Original row data for reference
  rawData: Record<string, string>;
}

// Column mapping configuration
interface ColumnMapping {
  name?: string;
  sku?: string;
  barcode?: string;
  supplier?: string;
  location?: string;
  minQty?: string;
  orderQty?: string;
  unitPrice?: string;
}

interface CSVUploadStepProps {
  onComplete: (approvedItems: CSVItem[]) => void;
  onBack: () => void;
}

export const CSVUploadStep: React.FC<CSVUploadStepProps> = ({
  onComplete,
  onBack,
}) => {
  // CSV parsing state
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvData, setCsvData] = useState<Record<string, string>[]>([]);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>({});
  const [showMappingModal, setShowMappingModal] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  
  // Items after mapping
  const [items, setItems] = useState<CSVItem[]>([]);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  
  // Filter state
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Parse CSV file
  const parseCSV = useCallback((text: string) => {
    const lines = text.split('\n').filter(line => line.trim());
    if (lines.length === 0) return;
    
    // Parse headers
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    setCsvHeaders(headers);
    
    // Parse data rows
    const data: Record<string, string>[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      const row: Record<string, string> = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });
      data.push(row);
    }
    
    setCsvData(data);
    
    // Auto-detect column mappings
    const mapping: ColumnMapping = {};
    headers.forEach(header => {
      const h = header.toLowerCase();
      if (h.includes('name') || h.includes('description') || h.includes('item')) {
        mapping.name = mapping.name || header;
      }
      if (h.includes('sku') || h.includes('part') || h.includes('number')) {
        mapping.sku = mapping.sku || header;
      }
      if (h.includes('barcode') || h.includes('upc') || h.includes('ean')) {
        mapping.barcode = mapping.barcode || header;
      }
      if (h.includes('supplier') || h.includes('vendor')) {
        mapping.supplier = mapping.supplier || header;
      }
      if (h.includes('location') || h.includes('bin') || h.includes('shelf')) {
        mapping.location = mapping.location || header;
      }
      if (h.includes('min') && (h.includes('qty') || h.includes('quantity'))) {
        mapping.minQty = mapping.minQty || header;
      }
      if (h.includes('order') && (h.includes('qty') || h.includes('quantity'))) {
        mapping.orderQty = mapping.orderQty || header;
      }
      if (h.includes('price') || h.includes('cost')) {
        mapping.unitPrice = mapping.unitPrice || header;
      }
    });
    
    setColumnMapping(mapping);
    setShowMappingModal(true);
  }, []);

  // Handle file upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setFileName(file.name);
    
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
      isApproved: false,
      isRejected: false,
      rawData: row,
    }));
    
    setItems(newItems);
    setShowMappingModal(false);
  };

  // Approval actions
  const approveItem = (id: string) => {
    setItems(prev => prev.map(item => 
      item.id === id ? { ...item, isApproved: true, isRejected: false } : item
    ));
  };

  const rejectItem = (id: string) => {
    setItems(prev => prev.map(item => 
      item.id === id ? { ...item, isApproved: false, isRejected: true } : item
    ));
  };

  const approveSelected = () => {
    setItems(prev => prev.map(item => 
      selectedItems.has(item.id) ? { ...item, isApproved: true, isRejected: false } : item
    ));
    setSelectedItems(new Set());
  };

  const approveAll = () => {
    setItems(prev => prev.map(item => ({ ...item, isApproved: true, isRejected: false })));
  };

  const rejectSelected = () => {
    setItems(prev => prev.map(item => 
      selectedItems.has(item.id) ? { ...item, isApproved: false, isRejected: true } : item
    ));
    setSelectedItems(new Set());
  };

  // Toggle selection
  const toggleSelection = (id: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedItems.size === filteredItems.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(filteredItems.map(item => item.id)));
    }
  };

  // Filter items
  const filteredItems = items.filter(item => {
    // Filter by status
    if (filter === 'pending' && (item.isApproved || item.isRejected)) return false;
    if (filter === 'approved' && !item.isApproved) return false;
    if (filter === 'rejected' && !item.isRejected) return false;
    
    // Filter by search
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        item.name.toLowerCase().includes(query) ||
        item.sku?.toLowerCase().includes(query) ||
        item.barcode?.toLowerCase().includes(query) ||
        item.supplier?.toLowerCase().includes(query)
      );
    }
    return true;
  });

  // Stats
  const stats = {
    total: items.length,
    pending: items.filter(i => !i.isApproved && !i.isRejected).length,
    approved: items.filter(i => i.isApproved).length,
    rejected: items.filter(i => i.isRejected).length,
  };

  // Handle completion
  const handleComplete = () => {
    const approvedItems = items.filter(item => item.isApproved);
    onComplete(approvedItems);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Upload CSV</h1>
          <p className="text-gray-500 mt-1">
            Import items from a CSV file and review before adding to your master list
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="px-4 py-2 text-gray-600 hover:text-gray-900 transition-colors"
          >
            Back
          </button>
          <button
            onClick={handleComplete}
            disabled={stats.approved === 0}
            className={`
              px-6 py-2 rounded-lg font-medium transition-colors flex items-center gap-2
              ${stats.approved > 0 
                ? 'bg-green-600 text-white hover:bg-green-700' 
                : 'bg-gray-200 text-gray-500 cursor-not-allowed'}
            `}
          >
            <Icons.Check className="w-4 h-4" />
            Add {stats.approved} Items to Master List
          </button>
        </div>
      </div>

      {/* Upload area or items list */}
      {items.length === 0 ? (
        <div className="bg-white rounded-xl border-2 border-dashed border-gray-300 p-12">
          <div className="text-center">
            <Icons.FileSpreadsheet className="w-16 h-16 mx-auto text-gray-400 mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Upload a CSV File
            </h3>
            <p className="text-gray-500 mb-6 max-w-md mx-auto">
              Import your inventory, supplier catalog, or item list. We'll help you map the columns.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors inline-flex items-center gap-2"
            >
              <Icons.Upload className="w-5 h-5" />
              Select CSV File
            </button>
            <p className="text-sm text-gray-400 mt-4">
              Supports: .csv files with headers
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Stats bar */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <Icons.FileSpreadsheet className="w-5 h-5 text-gray-400" />
                  <span className="font-medium">{fileName}</span>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-gray-500">{stats.total} items</span>
                  <span className="text-yellow-600">{stats.pending} pending</span>
                  <span className="text-green-600">{stats.approved} approved</span>
                  <span className="text-red-600">{stats.rejected} rejected</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors"
                >
                  Upload Different File
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleFileUpload}
                  className="hidden"
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
                  className={`
                    px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
                    ${filter === f 
                      ? 'bg-gray-900 text-white' 
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}
                  `}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <Icons.Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search items..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Bulk actions */}
          {selectedItems.size > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center justify-between">
              <span className="text-blue-700 font-medium">
                {selectedItems.size} items selected
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={approveSelected}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
                >
                  Approve Selected
                </button>
                <button
                  onClick={rejectSelected}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors"
                >
                  Reject Selected
                </button>
              </div>
            </div>
          )}

          {/* Items table */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={selectedItems.size === filteredItems.length && filteredItems.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded border-gray-300"
                    />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Item
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    SKU / Barcode
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Supplier
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Location
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Min Qty
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredItems.map(item => (
                  <tr 
                    key={item.id} 
                    className={`
                      hover:bg-gray-50 transition-colors
                      ${item.isApproved ? 'bg-green-50' : ''}
                      ${item.isRejected ? 'bg-red-50 opacity-60' : ''}
                    `}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedItems.has(item.id)}
                        onChange={() => toggleSelection(item.id)}
                        className="rounded border-gray-300"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{item.name}</div>
                      <div className="text-xs text-gray-400">Row {item.rowIndex}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {item.sku && <div>SKU: {item.sku}</div>}
                      {item.barcode && <div>Barcode: {item.barcode}</div>}
                      {!item.sku && !item.barcode && <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {item.supplier || <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {item.location || <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {item.minQty ?? <span className="text-gray-400">—</span>}
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
                ))}
              </tbody>
            </table>
            
            {filteredItems.length === 0 && (
              <div className="p-12 text-center text-gray-400">
                <Icons.Search className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No items match your filter</p>
              </div>
            )}
          </div>

          {/* Quick actions */}
          <div className="flex items-center justify-between">
            <button
              onClick={approveAll}
              className="px-4 py-2 bg-green-100 text-green-700 rounded-lg font-medium hover:bg-green-200 transition-colors"
            >
              Approve All Items
            </button>
            <div className="text-sm text-gray-500">
              {stats.approved} of {stats.total} items will be added to your master list
            </div>
          </div>
        </>
      )}

      {/* Column mapping modal */}
      {showMappingModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] overflow-auto">
            <div className="p-6 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Map CSV Columns</h3>
              <p className="text-sm text-gray-500 mt-1">
                Tell us which columns contain which data. We've made some guesses.
              </p>
            </div>
            
            <div className="p-6 space-y-4">
              {[
                { key: 'name', label: 'Item Name', required: true },
                { key: 'sku', label: 'SKU / Part Number' },
                { key: 'barcode', label: 'Barcode (UPC/EAN)' },
                { key: 'supplier', label: 'Supplier' },
                { key: 'location', label: 'Location / Bin' },
                { key: 'minQty', label: 'Minimum Quantity' },
                { key: 'orderQty', label: 'Order Quantity' },
                { key: 'unitPrice', label: 'Unit Price' },
              ].map(({ key, label, required }) => (
                <div key={key} className="flex items-center gap-4">
                  <label className="w-40 text-sm font-medium text-gray-700">
                    {label} {required && <span className="text-red-500">*</span>}
                  </label>
                  <select
                    value={columnMapping[key as keyof ColumnMapping] || ''}
                    onChange={(e) => setColumnMapping(prev => ({ 
                      ...prev, 
                      [key]: e.target.value || undefined 
                    }))}
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">— Select column —</option>
                    {csvHeaders.map(header => (
                      <option key={header} value={header}>{header}</option>
                    ))}
                  </select>
                </div>
              ))}
              
              {/* Preview */}
              <div className="mt-6 pt-6 border-t border-gray-200">
                <h4 className="text-sm font-medium text-gray-700 mb-3">Preview (first 3 rows)</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50">
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
              </div>
            </div>
            
            <div className="p-6 border-t border-gray-200 flex items-center justify-end gap-3">
              <button
                onClick={() => {
                  setShowMappingModal(false);
                  setCsvData([]);
                  setCsvHeaders([]);
                }}
                className="px-4 py-2 text-gray-600 hover:text-gray-900 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={applyMapping}
                disabled={!columnMapping.name}
                className={`
                  px-6 py-2 rounded-lg font-medium transition-colors
                  ${columnMapping.name 
                    ? 'bg-blue-600 text-white hover:bg-blue-700' 
                    : 'bg-gray-200 text-gray-500 cursor-not-allowed'}
                `}
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
