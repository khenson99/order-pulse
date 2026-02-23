import type { MasterListItem } from '../components/ItemsTable/types';
import { DEFAULT_ORDER_METHOD_BY_SOURCE } from '../components/ItemsTable/types';
import type { EmailItem } from '../components/ItemsTable/types';
import type { UrlScrapedItem } from '../services/api';
import type { ScannedBarcode, CapturedPhoto } from '../views/OnboardingFlow';
import type { CSVItem } from '../views/CSVUploadStep';

export function buildMasterListItems(
  emailItems: EmailItem[],
  urlItems: UrlScrapedItem[],
  scannedBarcodes: ScannedBarcode[],
  capturedPhotos: CapturedPhoto[],
  csvItems: CSVItem[],
): MasterListItem[] {
  const items: MasterListItem[] = [];

  emailItems.forEach(item => {
    items.push({
      id: item.id,
      source: 'email',
      orderMethod: DEFAULT_ORDER_METHOD_BY_SOURCE.email,
      name: item.name,
      supplier: item.supplier,
      location: item.location,
      asin: item.asin,
      minQty: item.recommendedMin,
      orderQty: item.recommendedOrderQty,
      unitPrice: item.lastPrice,
      imageUrl: item.imageUrl,
      productUrl: item.productUrl,
      needsAttention: !item.name || item.name.includes('Unknown'),
    });
  });

  urlItems.forEach((item) => {
    items.push({
      id: `url-${item.sourceUrl}`,
      source: 'url',
      orderMethod: DEFAULT_ORDER_METHOD_BY_SOURCE.url,
      name: item.itemName || 'Unknown item',
      description: item.description,
      supplier: item.supplier,
      sku: item.vendorSku,
      asin: item.asin,
      unitPrice: item.price,
      imageUrl: item.imageUrl,
      productUrl: item.productUrl || item.sourceUrl,
      needsAttention: item.needsReview || !item.itemName || !item.supplier,
    });
  });

  scannedBarcodes.forEach(barcode => {
    const existingByBarcode = items.find(i => i.barcode === barcode.barcode);
    if (!existingByBarcode) {
      items.push({
        id: `barcode-${barcode.id}`,
        source: 'barcode',
        orderMethod: DEFAULT_ORDER_METHOD_BY_SOURCE.barcode,
        name: barcode.productName || `Unknown (${barcode.barcode})`,
        barcode: barcode.barcode,
        imageUrl: barcode.imageUrl,
        needsAttention: !barcode.productName,
      });
    }
  });

  capturedPhotos.forEach(photo => {
    items.push({
      id: `photo-${photo.id}`,
      source: 'photo',
      orderMethod: DEFAULT_ORDER_METHOD_BY_SOURCE.photo,
      name: photo.suggestedName || 'Captured Item (analyzing...)',
      supplier: photo.suggestedSupplier,
      imageUrl: photo.imageData,
      needsAttention: !photo.suggestedName,
    });
  });

  csvItems.forEach(csvItem => {
    items.push({
      id: csvItem.id,
      source: 'csv',
      orderMethod: DEFAULT_ORDER_METHOD_BY_SOURCE.csv,
      name: csvItem.name,
      supplier: csvItem.supplier,
      location: csvItem.location,
      barcode: csvItem.barcode,
      sku: csvItem.sku,
      minQty: csvItem.minQty,
      orderQty: csvItem.orderQty,
      unitPrice: csvItem.unitPrice,
      productUrl: csvItem.productUrl,
      imageUrl: csvItem.imageUrl,
      color: csvItem.color,
      needsAttention: false,
    });
  });

  return items;
}

export function mergeMasterListItems(
  existing: MasterListItem[],
  incoming: MasterListItem[],
): MasterListItem[] {
  const newItems = [...existing];
  let hasChanges = false;

  for (const newItem of incoming) {
    const existingIndex = newItems.findIndex(i => i.id === newItem.id);
    if (existingIndex === -1) {
      newItems.push(newItem);
      hasChanges = true;
    } else {
      const existingItem = newItems[existingIndex];
      if (
        (!existingItem.name || existingItem.name.includes('analyzing'))
        && newItem.name && !newItem.name.includes('analyzing')
      ) {
        newItems[existingIndex] = {
          ...existingItem,
          name: newItem.name,
          supplier: newItem.supplier || existingItem.supplier,
          needsAttention: false,
        };
        hasChanges = true;
      }
    }
  }

  return hasChanges ? newItems : existing;
}
