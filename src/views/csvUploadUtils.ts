// CSV Upload utility types and functions
// Separated from component to enable fast refresh

// Allowed colors for CSV import (Coda-style color names)
export type CSVItemColor = 'blue' | 'green' | 'orange' | 'yellow' | 'red' | 'link' | 'purple' | 'gray';

export const CSV_ITEM_COLORS: readonly CSVItemColor[] = [
  'blue',
  'green',
  'orange',
  'yellow',
  'red',
  'link',
  'purple',
  'gray',
] as const;

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
  // Optional enrichment
  imageUrl?: string;
  productUrl?: string;
  color?: CSVItemColor;
  // Approval status
  isApproved: boolean;
  isRejected: boolean;
  // Original row data for reference
  rawData: Record<string, string>;
}

// Column mapping configuration
export interface ColumnMapping {
  name?: string;
  sku?: string;
  barcode?: string;
  supplier?: string;
  location?: string;
  minQty?: string;
  orderQty?: string;
  unitPrice?: string;
  imageUrl?: string;
  productUrl?: string;
  color?: string;
}

// Infer column mapping from headers for a better first-pass UX
export function detectColumnMapping(headers: string[]): ColumnMapping {
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
    if (h.includes('image') || h.includes('img') || h.includes('photo') || h.includes('picture')) {
      mapping.imageUrl = mapping.imageUrl || header;
    }
    // Product URL / link / website (avoid auto-mapping image URLs)
    if (
      !h.includes('image') &&
      !h.includes('img') &&
      !h.includes('photo') &&
      !h.includes('picture') &&
      (h.includes('url') || h.includes('link') || h.includes('website') || (h.includes('product') && h.includes('page')))
    ) {
      mapping.productUrl = mapping.productUrl || header;
    }
    if (h.includes('color') || h.includes('colour') || h.includes('label')) {
      mapping.color = mapping.color || header;
    }
  });
  return mapping;
}

export function normalizeCSVColor(value: string | undefined): CSVItemColor | undefined {
  const v = (value ?? '').trim().toLowerCase();
  if (!v) return undefined;
  if (v === 'grey') return 'gray';
  if ((CSV_ITEM_COLORS as readonly string[]).includes(v)) return v as CSVItemColor;
  return undefined;
}
