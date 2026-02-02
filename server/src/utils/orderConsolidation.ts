/**
 * Order Consolidation Utility
 * 
 * Deduplicates orders from the same vendor by:
 * 1. Detecting order numbers across multiple emails
 * 2. Matching items across emails from the same supplier
 * 3. Identifying email types (order, shipped, delivered)
 * 4. Calculating lead times from order to delivery
 */

export type OrderEmailType = 'order' | 'shipped' | 'delivered' | 'unknown';

export interface OrderEmail {
  emailId: string;
  emailType: OrderEmailType;
  date: string;
  subject: string;
}

export interface RawOrderData {
  id: string;
  emailId: string;
  subject: string;
  supplier: string;
  orderNumber?: string;
  orderDate: string;
  totalAmount?: number;
  items: Array<{
    id: string;
    name: string;
    normalizedName?: string;
    quantity: number;
    unit: string;
    unitPrice?: number;
    asin?: string;
    sku?: string;
    amazonEnriched?: any;
  }>;
  confidence: number;
}

export interface ConsolidatedOrder {
  id: string;
  originalEmailId: string;
  supplier: string;
  orderNumber?: string;
  orderDate: string;
  shippedDate?: string;
  deliveredDate?: string;
  leadTimeDays?: number;
  totalAmount?: number;
  items: Array<{
    id: string;
    name: string;
    normalizedName?: string;
    quantity: number;
    unit: string;
    unitPrice?: number;
    asin?: string;
    sku?: string;
    amazonEnriched?: any;
  }>;
  confidence: number;
  relatedEmails: OrderEmail[];
}

/**
 * Detect email type from subject line
 */
export function detectEmailType(subject: string): OrderEmailType {
  const lowerSubject = subject.toLowerCase();
  
  // Delivery keywords (check first as they're most specific)
  if (
    lowerSubject.includes('delivered') ||
    lowerSubject.includes('delivery confirmation') ||
    lowerSubject.includes('has arrived') ||
    lowerSubject.includes('was delivered') ||
    lowerSubject.includes('package delivered')
  ) {
    return 'delivered';
  }
  
  // Shipping keywords
  if (
    lowerSubject.includes('shipped') ||
    lowerSubject.includes('shipment') ||
    lowerSubject.includes('on its way') ||
    lowerSubject.includes('out for delivery') ||
    lowerSubject.includes('tracking') ||
    lowerSubject.includes('dispatched') ||
    lowerSubject.includes('in transit')
  ) {
    return 'shipped';
  }
  
  // Order confirmation keywords
  if (
    lowerSubject.includes('order confirmation') ||
    lowerSubject.includes('order received') ||
    lowerSubject.includes('order placed') ||
    lowerSubject.includes('thank you for your order') ||
    lowerSubject.includes('order #') ||
    lowerSubject.includes('purchase confirmation') ||
    lowerSubject.includes('invoice') ||
    lowerSubject.includes('receipt')
  ) {
    return 'order';
  }
  
  return 'unknown';
}

/**
 * Extract order number from email subject or body
 */
export function extractOrderNumber(subject: string, body?: string): string | undefined {
  const text = `${subject} ${body || ''}`;
  
  // Common order number patterns
  const patterns = [
    // Amazon: 123-1234567-1234567
    /(?:order|confirmation)\s*#?\s*:?\s*(\d{3}-\d{7}-\d{7})/i,
    // Generic: Order #12345 or Order: 12345
    /(?:order|confirmation|invoice)\s*#?\s*:?\s*([A-Z0-9-]{5,20})/i,
    // PO number: PO-12345 or PO#12345
    /(?:po|purchase\s*order)\s*#?\s*:?\s*([A-Z0-9-]{4,15})/i,
    // Reference number
    /(?:reference|ref)\s*#?\s*:?\s*([A-Z0-9-]{5,15})/i,
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  
  return undefined;
}

/**
 * Normalize item name for matching
 */
export function normalizeItemName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '') // Remove special characters
    .replace(/\s+/g, ' ')         // Normalize whitespace
    .trim()
    .substring(0, 50);            // Limit length for comparison
}

/**
 * Check if two items are likely the same
 */
function areItemsSimilar(item1: RawOrderData['items'][0], item2: RawOrderData['items'][0]): boolean {
  // Match by ASIN (most reliable for Amazon)
  if (item1.asin && item2.asin && item1.asin === item2.asin) {
    return true;
  }
  
  // Match by SKU
  if (item1.sku && item2.sku && item1.sku === item2.sku) {
    return true;
  }
  
  // Match by normalized name
  const name1 = item1.normalizedName || normalizeItemName(item1.name);
  const name2 = item2.normalizedName || normalizeItemName(item2.name);
  
  if (name1 === name2) {
    return true;
  }
  
  // Fuzzy match: check if one name contains the other (for partial matches)
  if (name1.length > 10 && name2.length > 10) {
    if (name1.includes(name2) || name2.includes(name1)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if two orders are related (same order from different emails)
 */
function areOrdersRelated(order1: RawOrderData, order2: RawOrderData): boolean {
  // Different suppliers = not related
  if (order1.supplier.toLowerCase() !== order2.supplier.toLowerCase()) {
    return false;
  }
  
  // Same order number = definitely related
  if (order1.orderNumber && order2.orderNumber && order1.orderNumber === order2.orderNumber) {
    return true;
  }
  
  // Check if items match (at least 50% overlap)
  const items1 = order1.items;
  const items2 = order2.items;
  
  if (items1.length === 0 || items2.length === 0) {
    return false;
  }
  
  let matchCount = 0;
  for (const item1 of items1) {
    for (const item2 of items2) {
      if (areItemsSimilar(item1, item2)) {
        matchCount++;
        break;
      }
    }
  }
  
  const overlapRatio = matchCount / Math.min(items1.length, items2.length);
  return overlapRatio >= 0.5;
}

/**
 * Calculate lead time in days between two dates
 */
function calculateLeadTime(orderDate: string, deliveryDate: string): number {
  const order = new Date(orderDate);
  const delivery = new Date(deliveryDate);
  
  if (isNaN(order.getTime()) || isNaN(delivery.getTime())) {
    return 0;
  }
  
  const diffMs = delivery.getTime() - order.getTime();
  return Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
}

/**
 * Consolidate orders from the same vendor
 * Deduplicates and calculates lead times
 */
export function consolidateOrders(orders: RawOrderData[]): ConsolidatedOrder[] {
  if (orders.length === 0) return [];
  
  // Group orders by supplier
  const ordersBySupplier = new Map<string, RawOrderData[]>();
  for (const order of orders) {
    const key = order.supplier.toLowerCase();
    const existing = ordersBySupplier.get(key) || [];
    existing.push(order);
    ordersBySupplier.set(key, existing);
  }
  
  const consolidatedOrders: ConsolidatedOrder[] = [];
  
  for (const [_supplier, supplierOrders] of ordersBySupplier) {
    // Sort by date (oldest first)
    supplierOrders.sort((a, b) => new Date(a.orderDate).getTime() - new Date(b.orderDate).getTime());
    
    // Track which orders have been merged
    const merged = new Set<string>();
    
    for (let i = 0; i < supplierOrders.length; i++) {
      const order = supplierOrders[i];
      if (merged.has(order.id)) continue;
      
      const emailType = detectEmailType(order.subject);
      
      // Find related orders
      const relatedOrders: RawOrderData[] = [];
      for (let j = i + 1; j < supplierOrders.length; j++) {
        const otherOrder = supplierOrders[j];
        if (merged.has(otherOrder.id)) continue;
        
        if (areOrdersRelated(order, otherOrder)) {
          relatedOrders.push(otherOrder);
          merged.add(otherOrder.id);
        }
      }
      
      // Collect all related emails
      const relatedEmails: OrderEmail[] = [
        {
          emailId: order.emailId,
          emailType,
          date: order.orderDate,
          subject: order.subject,
        },
      ];
      
      // Merge items from related orders (deduplicate)
      const mergedItems: Map<string, RawOrderData['items'][0]> = new Map();
      
      // Add items from primary order
      for (const item of order.items) {
        const key = item.asin || item.sku || normalizeItemName(item.name);
        if (!mergedItems.has(key)) {
          mergedItems.set(key, { ...item });
        }
      }
      
      // Track dates for lead time calculation
      let orderDate = order.orderDate;
      let shippedDate: string | undefined;
      let deliveredDate: string | undefined;
      
      if (emailType === 'order') {
        orderDate = order.orderDate;
      } else if (emailType === 'shipped') {
        shippedDate = order.orderDate;
      } else if (emailType === 'delivered') {
        deliveredDate = order.orderDate;
      }
      
      // Process related orders
      for (const relatedOrder of relatedOrders) {
        const relatedEmailType = detectEmailType(relatedOrder.subject);
        
        relatedEmails.push({
          emailId: relatedOrder.emailId,
          emailType: relatedEmailType,
          date: relatedOrder.orderDate,
          subject: relatedOrder.subject,
        });
        
        // Update dates based on email type
        if (relatedEmailType === 'order' && !orderDate) {
          orderDate = relatedOrder.orderDate;
        } else if (relatedEmailType === 'shipped') {
          if (!shippedDate || new Date(relatedOrder.orderDate) < new Date(shippedDate)) {
            shippedDate = relatedOrder.orderDate;
          }
        } else if (relatedEmailType === 'delivered') {
          if (!deliveredDate || new Date(relatedOrder.orderDate) > new Date(deliveredDate)) {
            deliveredDate = relatedOrder.orderDate;
          }
        }
        
        // Merge items (prefer items with more data)
        for (const item of relatedOrder.items) {
          const key = item.asin || item.sku || normalizeItemName(item.name);
          const existing = mergedItems.get(key);
          
          if (!existing) {
            mergedItems.set(key, { ...item });
          } else {
            // Merge: keep the item with more data
            if (item.amazonEnriched && !existing.amazonEnriched) {
              mergedItems.set(key, { ...item });
            } else if (item.unitPrice && !existing.unitPrice) {
              existing.unitPrice = item.unitPrice;
            }
          }
        }
      }
      
      // Calculate lead time
      let leadTimeDays: number | undefined;
      if (orderDate && deliveredDate) {
        leadTimeDays = calculateLeadTime(orderDate, deliveredDate);
      }
      
      // Create consolidated order
      const consolidated: ConsolidatedOrder = {
        id: order.id,
        originalEmailId: order.emailId,
        supplier: order.supplier,
        orderNumber: order.orderNumber || relatedOrders.find(r => r.orderNumber)?.orderNumber,
        orderDate,
        shippedDate,
        deliveredDate,
        leadTimeDays,
        totalAmount: order.totalAmount || relatedOrders.reduce((sum, r) => sum + (r.totalAmount || 0), 0),
        items: Array.from(mergedItems.values()),
        confidence: Math.max(order.confidence, ...relatedOrders.map(r => r.confidence)),
        relatedEmails,
      };
      
      consolidatedOrders.push(consolidated);
    }
  }
  
  return consolidatedOrders;
}

/**
 * Log consolidation summary for debugging
 */
export function logConsolidationSummary(
  originalCount: number,
  consolidatedOrders: ConsolidatedOrder[]
): void {
  const deduped = originalCount - consolidatedOrders.length;
  const withLeadTime = consolidatedOrders.filter(o => o.leadTimeDays !== undefined).length;
  const avgLeadTime = consolidatedOrders
    .filter(o => o.leadTimeDays !== undefined)
    .reduce((sum, o) => sum + (o.leadTimeDays || 0), 0) / (withLeadTime || 1);
  
  console.log(`📊 Order Consolidation:`);
  console.log(`   Original: ${originalCount} orders`);
  console.log(`   Consolidated: ${consolidatedOrders.length} orders (${deduped} duplicates removed)`);
  console.log(`   With lead time: ${withLeadTime} orders (avg ${avgLeadTime.toFixed(1)} days)`);
}
