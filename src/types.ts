export interface LineItem {
  name: string;
  quantity: number;
  unit: string;
  unitPrice?: number;
  totalPrice?: number;
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
