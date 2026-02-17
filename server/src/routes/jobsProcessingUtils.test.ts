import { describe, expect, it } from 'vitest';
import { buildFinalOrderSnapshot, buildLiveOrderSnapshot, toProcessedOrder } from './jobsProcessingUtils.js';
import { ConsolidatedOrder, RawOrderData } from '../utils/orderConsolidation.js';

describe('jobsProcessingUtils', () => {
  it('converts raw order data into API processed order shape', () => {
    const rawOrder: RawOrderData = {
      id: 'raw-1',
      emailId: 'email-1',
      subject: 'Order confirmation',
      supplier: 'McMaster-Carr',
      orderDate: '2026-01-05',
      totalAmount: 42.5,
      confidence: 0.88,
      items: [{
        id: 'item-1',
        name: 'Bolt',
        quantity: 2,
        unit: 'ea',
        unitPrice: 21.25,
        sku: 'SKU-1',
      }],
    };

    const processed = toProcessedOrder(rawOrder);
    expect(processed.id).toBe('raw-1');
    expect(processed.totalAmount).toBe(42.5);
    expect(processed.items[0].name).toBe('Bolt');
    expect(processed.items[0].unitPrice).toBe(21.25);
  });

  it('builds live snapshot with success count matching extracted raw orders', () => {
    const rawOrders: RawOrderData[] = [
      {
        id: 'raw-1',
        emailId: 'e1',
        subject: 'A',
        supplier: 'Uline',
        orderDate: '2026-01-01',
        confidence: 0.9,
        items: [{ id: 'i1', name: 'Tape', quantity: 1, unit: 'ea' }],
      },
      {
        id: 'raw-2',
        emailId: 'e2',
        subject: 'B',
        supplier: 'McMaster-Carr',
        orderDate: '2026-01-02',
        confidence: 0.9,
        items: [{ id: 'i2', name: 'Gloves', quantity: 1, unit: 'ea' }],
      },
    ];

    const snapshot = buildLiveOrderSnapshot(rawOrders);
    expect(snapshot.success).toBe(2);
    expect(snapshot.orders).toHaveLength(2);
    expect(snapshot.orders.map(order => order.supplier)).toEqual(['Uline', 'McMaster-Carr']);
  });

  it('builds final snapshot from consolidated orders', () => {
    const consolidated: ConsolidatedOrder[] = [{
      id: 'final-1',
      originalEmailId: 'e1',
      supplier: 'Uline',
      orderDate: '2026-01-01',
      confidence: 0.95,
      items: [{ id: 'i1', name: 'Box Cutter', quantity: 1, unit: 'ea' }],
      relatedEmails: [],
    }];

    const snapshot = buildFinalOrderSnapshot(consolidated);
    expect(snapshot.success).toBe(1);
    expect(snapshot.orders[0].id).toBe('final-1');
    expect(snapshot.orders[0].items[0].name).toBe('Box Cutter');
  });
});
