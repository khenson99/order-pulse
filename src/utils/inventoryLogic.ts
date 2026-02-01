import { 
  ExtractedOrder, 
  InventoryItem, 
  ItemVelocityProfile,
  JourneyNode,
  RawEmail,
  LineItem
} from '../types';

// ============================================
// ITEM NAME NORMALIZATION SERVICE
// ============================================

/**
 * Normalizes item names for cross-order matching
 * Handles common variations like:
 * - Case differences
 * - Extra whitespace
 * - Common suffixes/prefixes
 * - Part number variations
 */
export const normalizeItemName = (name: string): string => {
  let normalized = name
    .toLowerCase()
    .trim()
    // Remove common filler words
    .replace(/\b(the|a|an)\b/gi, '')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    // Remove common suffixes
    .replace(/\s*[-–]\s*(pack|box|case|bag|each|ea|pk|ct|count)$/i, '')
    // Normalize units in parentheses
    .replace(/\s*\([^)]*\)\s*$/, '')
    // Remove trailing punctuation
    .replace(/[.,;:!?]+$/, '')
    .trim();
  
  return normalized;
};

/**
 * Extract SKU/part number from item name if present
 */
export const extractSku = (name: string): string | undefined => {
  // Common SKU patterns: alphanumeric codes, often with dashes
  const skuPatterns = [
    /\b([A-Z]{2,4}[-]?\d{4,})\b/i,  // e.g., MCM-12345, AB1234
    /\b(\d{5,}[-A-Z]*)\b/,          // e.g., 91255A123
    /\b([A-Z]\d{2}[-]\d{4})\b/i,    // e.g., M10-1234
    /#\s*(\w+)/,                     // e.g., #12345
  ];
  
  for (const pattern of skuPatterns) {
    const match = name.match(pattern);
    if (match) {
      return match[1].toUpperCase();
    }
  }
  return undefined;
};

/**
 * Enrich line items with IDs, normalized names, and source tracking
 */
export const enrichLineItems = (
  orders: ExtractedOrder[]
): ExtractedOrder[] => {
  return orders.map(order => ({
    ...order,
    items: order.items.map((item, idx) => ({
      ...item,
      id: item.id || `${order.id}-item-${idx}`,
      sourceEmailId: order.originalEmailId,
      sourceOrderId: order.id,
      normalizedName: item.normalizedName || normalizeItemName(item.name),
      sku: item.sku || extractSku(item.name),
    })),
  }));
};

// ============================================
// VELOCITY PROFILE CALCULATION
// ============================================

/**
 * Build velocity profiles for all unique items across orders
 */
export const buildVelocityProfiles = (
  orders: ExtractedOrder[]
): Map<string, ItemVelocityProfile> => {
  const profileMap = new Map<string, ItemVelocityProfile>();
  
  // Enrich orders first
  const enrichedOrders = enrichLineItems(orders);
  
  enrichedOrders.forEach(order => {
    order.items.forEach(item => {
      const normalizedName = item.normalizedName || normalizeItemName(item.name);
      
      if (!profileMap.has(normalizedName)) {
        profileMap.set(normalizedName, {
          normalizedName,
          displayName: item.name,
          supplier: order.supplier,
          sku: item.sku,
          orders: [],
          totalQuantityOrdered: 0,
          orderCount: 0,
          averageCadenceDays: 0,
          dailyBurnRate: 0,
          firstOrderDate: order.orderDate,
          lastOrderDate: order.orderDate,
          recommendedMin: 0,
          recommendedOrderQty: 0,
        });
      }
      
      const profile = profileMap.get(normalizedName)!;
      
      // Add order occurrence
      profile.orders.push({
        orderId: order.id,
        emailId: order.originalEmailId,
        date: order.orderDate,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      });
      
      profile.totalQuantityOrdered += item.quantity;
      
      // Update dates
      if (new Date(order.orderDate) < new Date(profile.firstOrderDate)) {
        profile.firstOrderDate = order.orderDate;
      }
      if (new Date(order.orderDate) > new Date(profile.lastOrderDate)) {
        profile.lastOrderDate = order.orderDate;
      }
    });
  });
  
  // Calculate analytics for each profile
  profileMap.forEach(profile => {
    // Count unique orders (dedupe by orderId)
    const uniqueOrderIds = new Set(profile.orders.map(o => o.orderId));
    profile.orderCount = uniqueOrderIds.size;
    
    // Sort orders by date
    profile.orders.sort((a, b) => 
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    
    const firstDate = new Date(profile.firstOrderDate);
    const lastDate = new Date(profile.lastOrderDate);
    const daySpan = (lastDate.getTime() - firstDate.getTime()) / (1000 * 3600 * 24);
    
    // Calculate cadence
    if (profile.orderCount > 1 && daySpan > 0) {
      profile.averageCadenceDays = daySpan / (profile.orderCount - 1);
    } else {
      profile.averageCadenceDays = 30; // Default
    }
    
    // Calculate burn rate
    const effectiveSpan = daySpan === 0 ? 30 : daySpan;
    profile.dailyBurnRate = profile.totalQuantityOrdered / effectiveSpan;
    
    // Calculate recommendations
    const LEAD_TIME = 7;
    const SAFETY_FACTOR = 1.5;
    profile.recommendedMin = Math.ceil(profile.dailyBurnRate * LEAD_TIME * SAFETY_FACTOR);
    
    const targetDays = Math.max(profile.averageCadenceDays, 30);
    profile.recommendedOrderQty = Math.ceil(profile.dailyBurnRate * targetDays);
    
    // Predict next order date
    if (profile.orderCount >= 2) {
      const lastOrderDate = new Date(profile.lastOrderDate);
      const nextOrderDate = new Date(
        lastOrderDate.getTime() + profile.averageCadenceDays * 24 * 60 * 60 * 1000
      );
      profile.nextPredictedOrder = nextOrderDate.toISOString().split('T')[0];
    }
  });
  
  return profileMap;
};

// ============================================
// JOURNEY TREE BUILDER
// ============================================

/**
 * Build a hierarchical journey tree from emails and orders
 * Structure: Email -> Order -> LineItems -> Velocity
 */
export const buildJourneyTree = (
  orders: ExtractedOrder[],
  emails?: RawEmail[]
): JourneyNode[] => {
  const velocityProfiles = buildVelocityProfiles(orders);
  const enrichedOrders = enrichLineItems(orders);
  
  // Group orders by email
  const ordersByEmail = new Map<string, ExtractedOrder[]>();
  enrichedOrders.forEach(order => {
    const emailId = order.originalEmailId;
    if (!ordersByEmail.has(emailId)) {
      ordersByEmail.set(emailId, []);
    }
    ordersByEmail.get(emailId)!.push(order);
  });
  
  // Build tree nodes
  const tree: JourneyNode[] = [];
  
  ordersByEmail.forEach((ordersForEmail, emailId) => {
    // Find email info if available
    const email = emails?.find(e => e.id === emailId);
    const firstOrder = ordersForEmail[0];
    
    const emailNode: JourneyNode = {
      id: `email-${emailId}`,
      type: 'email',
      label: email?.sender || firstOrder?.supplier || 'Unknown Source',
      subtitle: email?.subject || `${ordersForEmail.length} order(s)`,
      isExpanded: true,
      data: {
        emailId,
        sender: email?.sender || firstOrder?.supplier || '',
        subject: email?.subject || '',
        date: email?.date || firstOrder?.orderDate || '',
      },
      children: ordersForEmail.map(order => {
        const orderNode: JourneyNode = {
          id: `order-${order.id}`,
          type: 'order',
          label: `Order from ${order.supplier}`,
          subtitle: `$${(order.totalAmount || 0).toFixed(2)} • ${order.items.length} items`,
          isExpanded: true,
          data: {
            orderId: order.id,
            emailId: order.originalEmailId,
            supplier: order.supplier,
            orderDate: order.orderDate,
            totalAmount: order.totalAmount,
            itemCount: order.items.length,
            confidence: order.confidence,
          },
          children: order.items.map((item, idx) => {
            const normalizedName = item.normalizedName || normalizeItemName(item.name);
            const velocityProfile = velocityProfiles.get(normalizedName);
            
            const lineItemNode: JourneyNode = {
              id: item.id || `${order.id}-item-${idx}`,
              type: 'lineItem',
              label: item.name,
              subtitle: `Qty: ${item.quantity} ${item.unit}${item.unitPrice ? ` • $${item.unitPrice.toFixed(2)}/ea` : ''}`,
              isExpanded: false,
              data: {
                lineItemId: item.id || `${order.id}-item-${idx}`,
                orderId: order.id,
                emailId: order.originalEmailId,
                name: item.name,
                normalizedName,
                quantity: item.quantity,
                unit: item.unit,
                unitPrice: item.unitPrice,
                sku: item.sku,
              },
              children: velocityProfile ? [{
                id: `velocity-${normalizedName}`,
                type: 'velocity',
                label: `${velocityProfile.dailyBurnRate.toFixed(1)}/day`,
                subtitle: `Cadence: ${Math.round(velocityProfile.averageCadenceDays)} days • ${velocityProfile.orderCount} orders`,
                data: {
                  normalizedName,
                  dailyBurnRate: velocityProfile.dailyBurnRate,
                  averageCadenceDays: velocityProfile.averageCadenceDays,
                  orderCount: velocityProfile.orderCount,
                  nextPredictedOrder: velocityProfile.nextPredictedOrder,
                },
              }] : [],
            };
            
            return lineItemNode;
          }),
        };
        
        return orderNode;
      }),
    };
    
    tree.push(emailNode);
  });
  
  // Sort by date (most recent first)
  tree.sort((a, b) => {
    const dateA = (a.data as any)?.date || '';
    const dateB = (b.data as any)?.date || '';
    return new Date(dateB).getTime() - new Date(dateA).getTime();
  });
  
  return tree;
};

// ============================================
// ORIGINAL INVENTORY PROCESSING (PRESERVED)
// ============================================

export const processOrdersToInventory = (orders: ExtractedOrder[]): InventoryItem[] => {
  const itemMap = new Map<string, InventoryItem & { orderIds: Set<string> }>();

  // 1. Group items by name, track unique orders
  orders.forEach(order => {
    order.items.forEach(lineItem => {
      // Normalize name (simple lowercasing and trimming for this demo)
      const key = lineItem.name.trim().toLowerCase();
      
      if (!itemMap.has(key)) {
        itemMap.set(key, {
          id: key,
          name: lineItem.name,
          supplier: order.supplier,
          totalQuantityOrdered: 0,
          orderCount: 0, // This will count unique ORDERS containing this item
          firstOrderDate: order.orderDate,
          lastOrderDate: order.orderDate,
          averageCadenceDays: 0,
          dailyBurnRate: 0,
          recommendedMin: 0,
          recommendedOrderQty: 0,
          lastPrice: lineItem.unitPrice || 0,
          history: [],
          orderIds: new Set<string>(), // Track unique order IDs
        });
      }

      const entry = itemMap.get(key)!;
      
      // Update basic stats
      entry.totalQuantityOrdered += lineItem.quantity;
      
      // Track unique orders - an item may appear multiple times in one order
      entry.orderIds.add(order.id);
      
      // Update dates
      if (new Date(order.orderDate) < new Date(entry.firstOrderDate)) entry.firstOrderDate = order.orderDate;
      if (new Date(order.orderDate) > new Date(entry.lastOrderDate)) entry.lastOrderDate = order.orderDate;
      
      // Update price
      if (lineItem.unitPrice) entry.lastPrice = lineItem.unitPrice;

      // Add to history (one entry per line item occurrence)
      entry.history.push({ date: order.orderDate, quantity: lineItem.quantity });
    });
  });

  // 2. Calculate Analytics
  return Array.from(itemMap.values()).map(item => {
    // Count unique orders containing this item
    item.orderCount = item.orderIds.size;
    
    // Sort history by date
    item.history.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const firstDate = new Date(item.firstOrderDate);
    const lastDate = new Date(item.lastOrderDate);
    const daySpan = (lastDate.getTime() - firstDate.getTime()) / (1000 * 3600 * 24);

    // Calc Cadence (Average days between orders)
    // Needs at least 2 orders to calculate cadence
    if (item.orderCount > 1 && daySpan > 0) {
      item.averageCadenceDays = daySpan / (item.orderCount - 1);
    } else {
      item.averageCadenceDays = 30; // Default assumption if not enough data
    }

    // Calc Burn Rate (Units per day)
    // If span is 0 (single day), assume 30 day usage for the total qty
    const effectiveSpan = daySpan === 0 ? 30 : daySpan;
    item.dailyBurnRate = item.totalQuantityOrdered / effectiveSpan;

    // Calc Recommendations
    // Min (Reorder Point) = Lead Time Demand + Safety Stock
    // Assume 7 day lead time, 50% safety stock factor
    const LEAD_TIME = 7;
    const SAFETY_FACTOR = 1.5;
    item.recommendedMin = Math.ceil(item.dailyBurnRate * LEAD_TIME * SAFETY_FACTOR);

    // Order Qty (EOQ-lite)
    // Just a heuristic: Order enough for the cadence duration or 1 month, whichever is larger
    const targetDays = Math.max(item.averageCadenceDays, 30);
    item.recommendedOrderQty = Math.ceil(item.dailyBurnRate * targetDays);

    // Clean up temp field before returning
    const { orderIds, ...cleanItem } = item;
    return cleanItem as InventoryItem;
  });
};

