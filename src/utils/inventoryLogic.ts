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
 * - Product codes in parentheses/brackets
 * - Size/quantity patterns
 * - Common abbreviations
 */
export const normalizeItemName = (name: string): string => {
  let normalized = name
    .toLowerCase()
    .trim()
    // Normalize dashes and underscores to spaces
    .replace(/[-_]/g, ' ')
    // Normalize multiple spaces to single space
    .replace(/\s+/g, ' ')
    // Remove common prefixes
    .replace(/^(the|a|an)\s+/i, '')
    // Remove product codes in parentheses or brackets (e.g., "Item (SKU-12345)", "Item [ABC-123]")
    .replace(/\s*[\(\[][^)\]]*[\)\]]\s*/g, '')
    // Remove common size/quantity patterns (e.g., "100 pack", "box of 50", "50ct", "12pk")
    .replace(/\b\d+\s*(pack|box|case|bag|ct|pk|count|each|ea|unit|units|pcs|pieces)\b/gi, '')
    .replace(/\b(box|case|pack|bag)\s+of\s+\d+\b/gi, '')
    // Normalize common abbreviations
    .replace(/\bea\.?\b/gi, 'ea')
    .replace(/\bpkg\.?\b/gi, 'pack')
    .replace(/\bpcs?\.?\b/gi, 'pieces')
    .replace(/\bct\.?\b/gi, 'count')
    .replace(/\bpk\.?\b/gi, 'pack')
    // Remove common suffixes
    .replace(/\s*[-–]\s*(pack|box|case|bag|each|ea|pk|ct|count|unit|units)\s*$/i, '')
    // Remove trailing punctuation
    .replace(/[.,;:!?]+$/g, '')
    // Final whitespace normalization
    .replace(/\s+/g, ' ')
    .trim();
  
  return normalized;
};

/**
 * Calculate simple string similarity using Levenshtein-like distance
 * Returns a value between 0 (identical) and 1 (completely different)
 */
const calculateSimilarity = (str1: string, str2: string): number => {
  const len1 = str1.length;
  const len2 = str2.length;
  
  // If one string is empty, return 0 if both empty, 1 otherwise
  if (len1 === 0) return len2 === 0 ? 0 : 1;
  if (len2 === 0) return 1;
  
  // If strings are identical, return 0
  if (str1 === str2) return 0;
  
  // Check prefix match (first 3+ characters)
  const prefixLen = Math.min(3, Math.min(len1, len2));
  if (prefixLen >= 3 && str1.substring(0, prefixLen) === str2.substring(0, prefixLen)) {
    // If prefix matches, use a simpler comparison
    const longer = Math.max(len1, len2);
    const shorter = Math.min(len1, len2);
    const diff = longer - shorter;
    
    // Count character differences in overlapping portion
    let differences = 0;
    for (let i = 0; i < shorter; i++) {
      if (str1[i] !== str2[i]) differences++;
    }
    
    // Normalize: differences + length difference
    return (differences + diff) / longer;
  }
  
  // Simple Levenshtein distance calculation
  const matrix: number[][] = [];
  
  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost  // substitution
      );
    }
  }
  
  const distance = matrix[len1][len2];
  const maxLen = Math.max(len1, len2);
  return maxLen === 0 ? 0 : distance / maxLen;
};

/**
 * Find similar items using fuzzy matching
 * Returns profiles with normalized names similar to the given normalized name
 * Uses string similarity and prefix matching
 */
export const findSimilarItems = (
  normalizedName: string,
  profiles: Map<string, ItemVelocityProfile>
): ItemVelocityProfile[] => {
  const similar: Array<{ profile: ItemVelocityProfile; similarity: number }> = [];
  const threshold = 0.3; // Consider items similar if similarity score <= 0.3 (70%+ match)
  
  profiles.forEach((profile, key) => {
    // Skip exact matches
    if (key === normalizedName) return;
    
    const similarity = calculateSimilarity(normalizedName, key);
    
    if (similarity <= threshold) {
      similar.push({ profile, similarity });
    }
  });
  
  // Sort by similarity (most similar first)
  similar.sort((a, b) => a.similarity - b.similarity);
  
  return similar.map(item => item.profile);
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
      const amazonData = item.amazonEnriched;
      
      // Use humanized name > enriched name > original name
      const displayName = amazonData?.humanizedName || amazonData?.itemName || item.name;
      
      if (!profileMap.has(normalizedName)) {
        profileMap.set(normalizedName, {
          normalizedName,
          displayName,
          supplier: order.supplier,
          sku: item.sku,
          // Amazon enrichment
          asin: item.asin,
          imageUrl: amazonData?.imageUrl,
          amazonUrl: amazonData?.amazonUrl,
          // Initialize other fields
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
      } else {
        // Update Amazon data if we have it now but didn't before
        const profile = profileMap.get(normalizedName)!;
        if (!profile.imageUrl && amazonData?.imageUrl) {
          profile.imageUrl = amazonData.imageUrl;
        }
        if (!profile.amazonUrl && amazonData?.amazonUrl) {
          profile.amazonUrl = amazonData.amazonUrl;
        }
        if (!profile.asin && item.asin) {
          profile.asin = item.asin;
        }
        // Update displayName - prefer humanized > enriched
        if (amazonData?.humanizedName && profile.displayName !== amazonData.humanizedName) {
          profile.displayName = amazonData.humanizedName;
        } else if (amazonData?.itemName && !amazonData.humanizedName && profile.displayName !== amazonData.itemName) {
          profile.displayName = amazonData.itemName;
        }
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
            
            const displayName = item.amazonEnriched?.itemName || item.name;
            const unitPrice = item.unitPrice;
            const totalPrice = unitPrice ? unitPrice * item.quantity : undefined;
            const lineItemNode: JourneyNode = {
              id: item.id || `${order.id}-item-${idx}`,
              type: 'lineItem',
              label: displayName,
              subtitle: `Qty: ${item.quantity} ${item.unit}${unitPrice ? ` • $${unitPrice.toFixed(2)}/ea` : ''}${totalPrice ? ` • $${totalPrice.toFixed(2)} total` : ''}`,
              isExpanded: false,
              data: {
                lineItemId: item.id || `${order.id}-item-${idx}`,
                orderId: order.id,
                emailId: order.originalEmailId,
                name: displayName,
                normalizedName,
                quantity: item.quantity,
                unit: item.unit,
                unitPrice: unitPrice,
                sku: item.sku,
                asin: item.asin,
                supplier: order.supplier,
                orderDate: order.orderDate,
                totalPrice,
                amazonEnriched: item.amazonEnriched,
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
      const key = lineItem.normalizedName || lineItem.name.trim().toLowerCase();
      
      // Use humanized name > Amazon enriched name > original name
      const amazonData = lineItem.amazonEnriched;
      const displayName = amazonData?.humanizedName || amazonData?.itemName || lineItem.name;
      const originalName = amazonData?.itemName || lineItem.name;
      
      if (!itemMap.has(key)) {
        itemMap.set(key, {
          id: key,
          name: displayName,
          originalName: originalName !== displayName ? originalName : undefined,
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
          // Amazon enrichment fields
          imageUrl: amazonData?.imageUrl,
          productUrl: amazonData?.amazonUrl,
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
      
      // Update Amazon enrichment if we have it now but didn't before
      if (!entry.imageUrl && amazonData?.imageUrl) {
        entry.imageUrl = amazonData.imageUrl;
      }
      if (!entry.productUrl && amazonData?.amazonUrl) {
        entry.productUrl = amazonData.amazonUrl;
      }
      // Update names - prefer humanized > enriched > original
      if (amazonData?.humanizedName && entry.name !== amazonData.humanizedName) {
        entry.originalName = entry.name;
        entry.name = amazonData.humanizedName;
      } else if (amazonData?.itemName && entry.name !== amazonData.itemName && !amazonData.humanizedName) {
        entry.name = amazonData.itemName;
      }

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

