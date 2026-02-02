import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Icons } from '../components/Icons';
import { ScannedBarcode, CapturedPhoto } from './OnboardingFlow';
import { CSVItem } from './CSVUploadStep';

// Simple email item from onboarding
interface EmailItem {
  id: string;
  name: string;
  supplier: string;
  asin?: string;
  imageUrl?: string;
  lastPrice?: number;
  quantity?: number;
  location?: string;
  recommendedMin?: number;
  recommendedOrderQty?: number;
}

// Master list item - unified from all sources
export interface MasterListItem {
  id: string;
  source: 'email' | 'barcode' | 'photo' | 'csv';
  // Core fields
  name: string;
  description?: string;
  supplier?: string;
  location?: string;
  // Identifiers
  barcode?: string;
  sku?: string;
  asin?: string;
  // Quantities
  minQty?: number;
  orderQty?: number;
  currentQty?: number;
  // Pricing
  unitPrice?: number;
  // Media
  imageUrl?: string;
  // Color for Arda
  color?: string;
  // Status
  isEditing?: boolean;
  isVerified: boolean;
  needsAttention: boolean;
  validationErrors?: string[];
}

interface MasterListStepProps {
  emailItems: EmailItem[];
  scannedBarcodes: ScannedBarcode[];
  capturedPhotos: CapturedPhoto[];
  csvItems: CSVItem[];
  onComplete: (items: MasterListItem[]) => void;
  onBack: () => void;
}

// Editable cell component for spreadsheet-like editing
interface EditableCellProps {
  value: string | number | undefined;
  onChange: (value: string) => void;
  type?: 'text' | 'number';
  placeholder?: string;
  className?: string;
}

const EditableCell: React.FC<EditableCellProps> = ({ 
  value, 
  onChange, 
  type = 'text', 
  placeholder = '',
  className = ''
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [localValue, setLocalValue] = useState(String(value ?? ''));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLocalValue(String(value ?? ''));
  }, [value]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleBlur = () => {
    setIsEditing(false);
    if (localValue !== String(value ?? '')) {
      onChange(localValue);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleBlur();
    } else if (e.key === 'Escape') {
      setLocalValue(String(value ?? ''));
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type={type}
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className={`w-full px-2 py-1 text-sm border border-arda-accent rounded bg-white focus:outline-none focus:ring-2 focus:ring-arda-accent/30 ${className}`}
        placeholder={placeholder}
      />
    );
  }

  return (
    <div
      onClick={() => setIsEditing(true)}
      className={`px-2 py-1 text-sm cursor-text hover:bg-orange-50 rounded min-h-[28px] ${className} ${!value ? 'text-arda-text-muted italic' : ''}`}
    >
      {value !== undefined && value !== '' ? (type === 'number' ? value : value) : placeholder || '—'}
    </div>
  );
};

// Color picker dropdown
const ColorPicker: React.FC<{ value?: string; onChange: (color: string) => void }> = ({ value, onChange }) => {
  const colors = [
    { id: 'BLUE', label: 'Blue', bg: 'bg-blue-500' },
    { id: 'GREEN', label: 'Green', bg: 'bg-green-500' },
    { id: 'YELLOW', label: 'Yellow', bg: 'bg-yellow-400' },
    { id: 'ORANGE', label: 'Orange', bg: 'bg-orange-500' },
    { id: 'RED', label: 'Red', bg: 'bg-red-500' },
    { id: 'PINK', label: 'Pink', bg: 'bg-pink-400' },
    { id: 'PURPLE', label: 'Purple', bg: 'bg-purple-500' },
    { id: 'GRAY', label: 'Gray', bg: 'bg-gray-400' },
  ];

  const [isOpen, setIsOpen] = useState(false);
  const selected = colors.find(c => c.id === value?.toUpperCase());

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-2 py-1 text-sm hover:bg-orange-50 rounded min-h-[28px] w-full"
      >
        {selected ? (
          <>
            <span className={`w-4 h-4 rounded ${selected.bg}`} />
            <span>{selected.label}</span>
          </>
        ) : (
          <span className="text-arda-text-muted italic">Select color</span>
        )}
      </button>
      {isOpen && (
        <div className="absolute z-10 mt-1 bg-white border border-arda-border rounded-lg shadow-lg p-2 grid grid-cols-4 gap-1">
          {colors.map(color => (
            <button
              key={color.id}
              onClick={() => { onChange(color.id); setIsOpen(false); }}
              className={`w-8 h-8 rounded ${color.bg} hover:ring-2 ring-offset-1 ring-arda-accent ${value?.toUpperCase() === color.id ? 'ring-2' : ''}`}
              title={color.label}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const MasterListStep: React.FC<MasterListStepProps> = ({
  emailItems,
  scannedBarcodes,
  capturedPhotos,
  csvItems,
  onComplete,
  onBack,
}) => {
  // Build initial master list from all sources
  const initialItems = useMemo(() => {
    const items: MasterListItem[] = [];
    
    // Add email items
    emailItems.forEach(item => {
      items.push({
        id: item.id,
        source: 'email',
        name: item.name,
        supplier: item.supplier,
        location: item.location,
        asin: item.asin,
        minQty: item.recommendedMin,
        orderQty: item.recommendedOrderQty,
        unitPrice: item.lastPrice,
        imageUrl: item.imageUrl,
        isVerified: false,
        needsAttention: !item.name || item.name.includes('Unknown'),
      });
    });
    
    // Add scanned barcodes (that aren't duplicates of email items)
    scannedBarcodes.forEach(barcode => {
      const existingByBarcode = items.find(i => i.barcode === barcode.barcode);
      if (!existingByBarcode) {
        items.push({
          id: `barcode-${barcode.id}`,
          source: 'barcode',
          name: barcode.productName || `Unknown (${barcode.barcode})`,
          barcode: barcode.barcode,
          imageUrl: barcode.imageUrl,
          isVerified: false,
          needsAttention: !barcode.productName,
        });
      }
    });
    
    // Add photo-captured items
    capturedPhotos.forEach(photo => {
      if (photo.suggestedName) {
        items.push({
          id: `photo-${photo.id}`,
          source: 'photo',
          name: photo.suggestedName,
          supplier: photo.suggestedSupplier,
          imageUrl: photo.imageData,
          isVerified: false,
          needsAttention: false,
        });
      }
    });
    
    // Add CSV items
    csvItems.forEach(csvItem => {
      items.push({
        id: csvItem.id,
        source: 'csv',
        name: csvItem.name,
        supplier: csvItem.supplier,
        location: csvItem.location,
        barcode: csvItem.barcode,
        sku: csvItem.sku,
        minQty: csvItem.minQty,
        orderQty: csvItem.orderQty,
        unitPrice: csvItem.unitPrice,
        isVerified: false,
        needsAttention: false,
      });
    });
    
    return items;
  }, [emailItems, scannedBarcodes, capturedPhotos, csvItems]);

  const [items, setItems] = useState<MasterListItem[]>(initialItems);
  const [filter, setFilter] = useState<'all' | 'needs_attention' | 'verified'>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'email' | 'barcode' | 'photo' | 'csv'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Update a field on an item
  const updateItem = useCallback((id: string, field: keyof MasterListItem, value: string | number | undefined) => {
    setItems(prev => prev.map(item => {
      if (item.id === id) {
        const updated = { ...item, [field]: value };
        // Clear needsAttention if name is now set
        if (field === 'name' && value && !String(value).includes('Unknown')) {
          updated.needsAttention = false;
        }
        return updated;
      }
      return item;
    }));
  }, []);

  // Mark item as verified
  const verifyItem = useCallback((id: string) => {
    setItems(prev => prev.map(item => 
      item.id === id ? { ...item, isVerified: true, needsAttention: false } : item
    ));
  }, []);

  // Remove item from list
  const removeItem = useCallback((id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
  }, []);

  // Verify all items
  const verifyAll = useCallback(() => {
    setItems(prev => prev.map(item => ({ ...item, isVerified: true, needsAttention: false })));
  }, []);

  // Filter items
  const filteredItems = useMemo(() => {
    return items.filter(item => {
      if (filter === 'needs_attention' && !item.needsAttention) return false;
      if (filter === 'verified' && !item.isVerified) return false;
      if (sourceFilter !== 'all' && item.source !== sourceFilter) return false;
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
  }, [items, filter, sourceFilter, searchQuery]);

  // Stats
  const stats = useMemo(() => ({
    total: items.length,
    verified: items.filter(i => i.isVerified).length,
    needsAttention: items.filter(i => i.needsAttention).length,
    bySource: {
      email: items.filter(i => i.source === 'email').length,
      barcode: items.filter(i => i.source === 'barcode').length,
      photo: items.filter(i => i.source === 'photo').length,
      csv: items.filter(i => i.source === 'csv').length,
    },
  }), [items]);

  // Source icon
  const getSourceIcon = (source: MasterListItem['source']) => {
    switch (source) {
      case 'email': return <Icons.Mail className="w-3 h-3" />;
      case 'barcode': return <Icons.Barcode className="w-3 h-3" />;
      case 'photo': return <Icons.Camera className="w-3 h-3" />;
      case 'csv': return <Icons.FileSpreadsheet className="w-3 h-3" />;
    }
  };

  const handleComplete = useCallback(() => {
    onComplete(items);
  }, [items, onComplete]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 text-sm">
          <span className="font-medium">{stats.total} items</span>
          <span className="text-green-600">{stats.verified} verified</span>
          {stats.needsAttention > 0 && (
            <span className="text-orange-600">{stats.needsAttention} need attention</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={verifyAll} className="btn-arda-outline text-sm py-1.5">
            Verify All
          </button>
          <button
            onClick={handleComplete}
            disabled={items.length === 0}
            className="btn-arda-primary text-sm py-1.5 flex items-center gap-2"
          >
            <Icons.ArrowRight className="w-4 h-4" />
            Sync to Arda ({items.length})
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center justify-between bg-white rounded-lg border border-arda-border p-2">
        <div className="flex items-center gap-2">
          {(['all', 'needs_attention', 'verified'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded text-sm ${filter === f ? 'bg-arda-accent text-white' : 'hover:bg-gray-100'}`}
            >
              {f === 'needs_attention' ? 'Needs Attention' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <div className="relative">
          <Icons.Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 pr-3 py-1 text-sm border border-arda-border rounded focus:outline-none focus:ring-1 focus:ring-arda-accent"
          />
        </div>
      </div>

      {/* Spreadsheet table */}
      <div className="bg-white rounded-lg border border-arda-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-arda-border">
              <tr>
                <th className="px-2 py-2 text-left font-medium text-gray-600 w-8"></th>
                <th className="px-2 py-2 text-left font-medium text-gray-600 w-10">Img</th>
                <th className="px-2 py-2 text-left font-medium text-gray-600 min-w-[200px]">Name</th>
                <th className="px-2 py-2 text-left font-medium text-gray-600 min-w-[120px]">Supplier</th>
                <th className="px-2 py-2 text-left font-medium text-gray-600 w-24">Location</th>
                <th className="px-2 py-2 text-left font-medium text-gray-600 w-24">SKU</th>
                <th className="px-2 py-2 text-right font-medium text-gray-600 w-16">Min</th>
                <th className="px-2 py-2 text-right font-medium text-gray-600 w-16">Order</th>
                <th className="px-2 py-2 text-right font-medium text-gray-600 w-20">Price</th>
                <th className="px-2 py-2 text-left font-medium text-gray-600 w-24">Color</th>
                <th className="px-2 py-2 text-center font-medium text-gray-600 w-20">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredItems.map(item => (
                <tr 
                  key={item.id} 
                  className={`hover:bg-gray-50 ${item.needsAttention ? 'bg-orange-50' : ''} ${item.isVerified ? 'bg-green-50' : ''}`}
                >
                  {/* Source icon */}
                  <td className="px-2 py-1">
                    <span className="p-1 rounded bg-gray-100 text-gray-500 inline-flex">
                      {getSourceIcon(item.source)}
                    </span>
                  </td>
                  
                  {/* Image */}
                  <td className="px-2 py-1">
                    {item.imageUrl ? (
                      <img 
                        src={item.imageUrl} 
                        alt="" 
                        className="w-8 h-8 rounded object-cover"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded bg-gray-100 flex items-center justify-center">
                        <Icons.Package className="w-4 h-4 text-gray-400" />
                      </div>
                    )}
                  </td>
                  
                  {/* Name */}
                  <td className="px-1 py-1">
                    <EditableCell
                      value={item.name}
                      onChange={(v) => updateItem(item.id, 'name', v)}
                      placeholder="Item name"
                    />
                  </td>
                  
                  {/* Supplier */}
                  <td className="px-1 py-1">
                    <EditableCell
                      value={item.supplier}
                      onChange={(v) => updateItem(item.id, 'supplier', v)}
                      placeholder="Supplier"
                    />
                  </td>
                  
                  {/* Location */}
                  <td className="px-1 py-1">
                    <EditableCell
                      value={item.location}
                      onChange={(v) => updateItem(item.id, 'location', v)}
                      placeholder="Location"
                    />
                  </td>
                  
                  {/* SKU */}
                  <td className="px-1 py-1">
                    <EditableCell
                      value={item.sku}
                      onChange={(v) => updateItem(item.id, 'sku', v)}
                      placeholder="SKU"
                    />
                  </td>
                  
                  {/* Min Qty */}
                  <td className="px-1 py-1 text-right">
                    <EditableCell
                      value={item.minQty}
                      onChange={(v) => updateItem(item.id, 'minQty', v ? parseFloat(v) : undefined)}
                      type="number"
                      placeholder="0"
                      className="text-right"
                    />
                  </td>
                  
                  {/* Order Qty */}
                  <td className="px-1 py-1 text-right">
                    <EditableCell
                      value={item.orderQty}
                      onChange={(v) => updateItem(item.id, 'orderQty', v ? parseFloat(v) : undefined)}
                      type="number"
                      placeholder="0"
                      className="text-right"
                    />
                  </td>
                  
                  {/* Price */}
                  <td className="px-1 py-1 text-right">
                    <EditableCell
                      value={item.unitPrice !== undefined ? item.unitPrice.toFixed(2) : ''}
                      onChange={(v) => updateItem(item.id, 'unitPrice', v ? parseFloat(v) : undefined)}
                      type="number"
                      placeholder="0.00"
                      className="text-right"
                    />
                  </td>
                  
                  {/* Color */}
                  <td className="px-1 py-1">
                    <ColorPicker
                      value={item.color}
                      onChange={(v) => updateItem(item.id, 'color', v)}
                    />
                  </td>
                  
                  {/* Actions */}
                  <td className="px-2 py-1">
                    <div className="flex items-center justify-center gap-1">
                      {!item.isVerified && (
                        <button
                          onClick={() => verifyItem(item.id)}
                          className="p-1 hover:bg-green-100 rounded text-gray-400 hover:text-green-600"
                          title="Verify"
                        >
                          <Icons.Check className="w-4 h-4" />
                        </button>
                      )}
                      {item.isVerified && (
                        <Icons.CheckCircle2 className="w-4 h-4 text-green-500" />
                      )}
                      <button
                        onClick={() => removeItem(item.id)}
                        className="p-1 hover:bg-red-100 rounded text-gray-400 hover:text-red-600"
                        title="Remove"
                      >
                        <Icons.Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {filteredItems.length === 0 && (
          <div className="p-8 text-center text-gray-500">
            <Icons.Package className="w-10 h-10 mx-auto mb-2 opacity-50" />
            <p>No items to display</p>
          </div>
        )}
      </div>
      
      {/* Keyboard hint */}
      <div className="text-xs text-gray-400 text-center">
        Click any cell to edit. Press Enter to save, Escape to cancel.
      </div>
    </div>
  );
};
