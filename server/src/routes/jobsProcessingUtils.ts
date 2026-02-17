import { ProcessedOrder } from '../services/jobManager.js';
import { ConsolidatedOrder, RawOrderData } from '../utils/orderConsolidation.js';

type OrderLike = Pick<
  RawOrderData | ConsolidatedOrder,
  'id' | 'supplier' | 'orderDate' | 'totalAmount' | 'items' | 'confidence'
>;

export interface OrderSnapshot {
  orders: ProcessedOrder[];
  success: number;
}

export function toProcessedOrder(order: OrderLike): ProcessedOrder {
  return {
    id: order.id,
    supplier: order.supplier,
    orderDate: order.orderDate,
    totalAmount: order.totalAmount || 0,
    items: order.items.map(item => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unitPrice || 0,
      asin: item.asin,
      sku: item.sku,
      productUrl: item.productUrl,
      imageUrl: item.imageUrl,
      amazonEnriched: item.amazonEnriched,
    })),
    confidence: order.confidence,
  };
}

export function buildLiveOrderSnapshot(rawOrders: RawOrderData[]): OrderSnapshot {
  const orders = rawOrders.map(toProcessedOrder);
  return {
    orders,
    success: orders.length,
  };
}

export function buildFinalOrderSnapshot(consolidatedOrders: ConsolidatedOrder[]): OrderSnapshot {
  const orders = consolidatedOrders.map(toProcessedOrder);
  return {
    orders,
    success: orders.length,
  };
}
