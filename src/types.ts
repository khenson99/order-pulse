export interface LineItem {
  id?: string;  // Unique identifier for tracking
  name: string;
  quantity: number;
  unit: string;
  unitPrice?: number;
  totalPrice?: number;
  // Source tracking fields
  sourceEmailId?: string;
  sourceOrderId?: string;
  normalizedName?: string;  // For matching across orders
  sku?: string;  // Part number/SKU if available
}

// Cross-order item tracking for velocity analysis
export interface ItemVelocityProfile {
  normalizedName: string;
  displayName: string;
  supplier: string;
  sku?: string;
  orders: {
    orderId: string;
    emailId: string;
    date: string;
    quantity: number;
    unitPrice?: number;
  }[];
  // Calculated fields
  totalQuantityOrdered: number;
  orderCount: number;
  averageCadenceDays: number;
  dailyBurnRate: number;
  firstOrderDate: string;
  lastOrderDate: string;
  nextPredictedOrder?: string;
  // Recommendations
  recommendedMin: number;
  recommendedOrderQty: number;
}

// Tree view node types for the Order Journey
export type JourneyNodeType = 'email' | 'order' | 'lineItem' | 'velocity';

export interface JourneyNode {
  id: string;
  type: JourneyNodeType;
  label: string;
  subtitle?: string;
  children?: JourneyNode[];
  data?: EmailNodeData | OrderNodeData | LineItemNodeData | VelocityNodeData;
  isExpanded?: boolean;
  isNew?: boolean;
}

export interface EmailNodeData {
  emailId: string;
  sender: string;
  subject: string;
  date: string;
}

export interface OrderNodeData {
  orderId: string;
  emailId: string;
  supplier: string;
  orderDate: string;
  totalAmount?: number;
  itemCount: number;
  confidence: number;
}

export interface LineItemNodeData {
  lineItemId: string;
  orderId: string;
  emailId: string;
  name: string;
  normalizedName: string;
  quantity: number;
  unit: string;
  unitPrice?: number;
  sku?: string;
}

export interface VelocityNodeData {
  normalizedName: string;
  dailyBurnRate: number;
  averageCadenceDays: number;
  orderCount: number;
  nextPredictedOrder?: string;
}

export interface ExtractedOrder {
  id: string;
  originalEmailId: string;
  supplier: string;
  orderDate: string; // ISO String
  totalAmount?: number;
  items: LineItem[];
  confidence: number;
}

export type ItemColor = 'Red' | 'Orange' | 'Yellow' | 'Green' | 'Blue' | 'Gray' | 'Pink' | 'Purple';

export interface InventoryItem {
  id: string;
  name: string;
  supplier: string;
  totalQuantityOrdered: number;
  orderCount: number;
  firstOrderDate: string;
  lastOrderDate: string;
  averageCadenceDays: number; // Days between orders
  dailyBurnRate: number; // Estimated daily usage
  recommendedMin: number; // Reorder point
  recommendedOrderQty: number; // EOQ
  lastPrice: number;
  history: { date: string; quantity: number }[];
  // New fields for table view
  imageUrl?: string;
  productUrl?: string;
  color?: ItemColor;
  isDraft?: boolean; // True for items from email that haven't been saved
}

export interface ProcessingStatus {
  total: number;
  processed: number;
  success: number;
  failed: number;
  currentTask: string;
}

export interface RawEmail {
  id: string;
  subject: string;
  sender: string;
  date: string;
  snippet: string;
  body: string; // HTML or Text content
}

export interface GoogleUserProfile {
  id: string;
  email: string;
  name: string;
  given_name?: string;
  family_name?: string;
  picture: string;
}
