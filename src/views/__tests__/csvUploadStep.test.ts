import { describe, expect, it } from 'vitest';
import { detectColumnMapping } from '../csvUploadUtils';

describe('detectColumnMapping', () => {
  it('auto-maps common inventory headers', () => {
    const headers = ['Item Name', 'SKU', 'Vendor', 'Min Qty', 'Order Qty', 'Price', 'Barcode'];
    const mapping = detectColumnMapping(headers);

    expect(mapping.name).toBe('Item Name');
    expect(mapping.sku).toBe('SKU');
    expect(mapping.supplier).toBe('Vendor');
    expect(mapping.minQty).toBe('Min Qty');
    expect(mapping.orderQty).toBe('Order Qty');
    expect(mapping.unitPrice).toBe('Price');
    expect(mapping.barcode).toBe('Barcode');
  });

  it('handles alternative spellings and URLs', () => {
    const headers = ['description', 'colour', 'product page', 'image url'];
    const mapping = detectColumnMapping(headers);

    expect(mapping.name).toBe('description');
    expect(mapping.color).toBe('colour');
    expect(mapping.productUrl).toBe('product page');
    expect(mapping.imageUrl).toBe('image url');
  });
});
