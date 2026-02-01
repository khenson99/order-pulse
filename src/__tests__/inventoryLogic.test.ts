import {
  normalizeItemName,
  findSimilarItems,
  extractSku,
  enrichLineItems,
  buildVelocityProfiles,
  buildJourneyTree,
  processOrdersToInventory,
} from '../utils/inventoryLogic';
import type { ExtractedOrder, RawEmail, ItemVelocityProfile } from '../types';

const sampleOrders: ExtractedOrder[] = [
  {
    id: 'order-1',
    originalEmailId: 'email-1',
    supplier: 'McMaster-Carr',
    orderDate: '2024-11-01T00:00:00.000Z',
    totalAmount: 200,
    confidence: 0.91,
    items: [
      {
        name: 'Widget A (MCM-12345)',
        quantity: 10,
        unit: 'EA',
        unitPrice: 5,
      },
    ],
  },
  {
    id: 'order-2',
    originalEmailId: 'email-1',
    supplier: 'McMaster-Carr',
    orderDate: '2024-11-15T00:00:00.000Z',
    totalAmount: 210,
    confidence: 0.92,
    items: [
      {
        name: 'Widget A (MCM-12345)',
        quantity: 12,
        unit: 'EA',
        unitPrice: 5.5,
      },
      {
        name: 'Cable 10ft',
        quantity: 3,
        unit: 'EA',
        unitPrice: 12,
      },
    ],
  },
  {
    id: 'order-3',
    originalEmailId: 'email-2',
    supplier: 'Supplier B',
    orderDate: '2024-11-10T00:00:00.000Z',
    totalAmount: 30,
    confidence: 0.82,
    items: [
      {
        name: 'Bolt 1/4"',
        quantity: 4,
        unit: 'EA',
        unitPrice: 0.75,
      },
    ],
  },
];

const sampleEmails: RawEmail[] = [
  {
    id: 'email-1',
    subject: 'McMaster-Carr order confirmation',
    sender: 'ops@mcmaster.com',
    date: '2024-11-15',
    snippet: '',
    body: '',
  },
  {
    id: 'email-2',
    subject: 'Supplier B order',
    sender: 'orders@supplierb.com',
    date: '2024-11-10',
    snippet: '',
    body: '',
  },
];

describe('inventoryLogic utilities', () => {
  it('normalizes spiky item names into friendly keys', () => {
    const normalized = normalizeItemName('  The Widget A pack of 12 (SKU-9876) ');
    expect(normalized).toBe('widget a');
  });

  it('extracts SKUs that match common patterns', () => {
    expect(extractSku('Widget MCM-12345 Kit')).toBe('MCM-12345');
    expect(extractSku('# 91255A123')).toBe('91255A123');
  });

  it('finds related velocity profiles via similarity', () => {
    const profileMap = new Map<string, ItemVelocityProfile>([
      [
        'widget a',
        {
          normalizedName: 'widget a',
          displayName: 'Widget A',
          supplier: 'McMaster-Carr',
          orders: [],
          totalQuantityOrdered: 1,
          orderCount: 1,
          averageCadenceDays: 30,
          dailyBurnRate: 0.5,
          firstOrderDate: '2024-01-01',
          lastOrderDate: '2024-01-01',
          recommendedMin: 1,
          recommendedOrderQty: 1,
        },
      ],
      [
        'widget alpha',
        {
          normalizedName: 'widget alpha',
          displayName: 'Widget Alpha',
          supplier: 'McMaster-Carr',
          orders: [],
          totalQuantityOrdered: 1,
          orderCount: 1,
          averageCadenceDays: 30,
          dailyBurnRate: 0.4,
          firstOrderDate: '2024-01-01',
          lastOrderDate: '2024-01-01',
          recommendedMin: 1,
          recommendedOrderQty: 1,
        },
      ],
      [
        'bolt',
        {
          normalizedName: 'bolt',
          displayName: 'Bolt',
          supplier: 'Supplier B',
          orders: [],
          totalQuantityOrdered: 1,
          orderCount: 1,
          averageCadenceDays: 30,
          dailyBurnRate: 0.2,
          firstOrderDate: '2024-01-01',
          lastOrderDate: '2024-01-01',
          recommendedMin: 1,
          recommendedOrderQty: 1,
        },
      ],
    ]);

    const similar = findSimilarItems('widget a', profileMap);
    const normalizedNames = similar.map((profile) => profile.normalizedName);
    expect(normalizedNames).toContain('widget alpha');
    expect(normalizedNames).not.toContain('widget a');
  });

  it('enriches line items with ids, normalized names, and skus', () => {
    const enriched = enrichLineItems(sampleOrders);
    const firstItem = enriched[0].items[0];
    expect(firstItem.normalizedName).toBe('widget a');
    expect(firstItem.sku).toBe('MCM-12345');
    expect(firstItem.sourceEmailId).toBe(sampleOrders[0].originalEmailId);
    expect(firstItem.sourceOrderId).toBe(sampleOrders[0].id);
    expect(firstItem.id).toBeDefined();
  });

  it('builds velocity profiles with cadence, burn rate, and predictions', () => {
    const profiles = buildVelocityProfiles(sampleOrders);
    const widgetProfile = profiles.get('widget a');
    expect(widgetProfile).toBeDefined();
    expect(widgetProfile?.orderCount).toBe(2);
    expect(widgetProfile?.recommendedMin).toBeGreaterThan(0);
    expect(widgetProfile?.nextPredictedOrder).toBe('2024-11-29');
  });

  it('constructs a journey tree grouped by emails', () => {
    const tree = buildJourneyTree(sampleOrders, sampleEmails);
    expect(tree.length).toBe(2);
    expect(tree[0].data?.emailId).toBe('email-1');
    const emailOneNode = tree.find((node) => node.data?.emailId === 'email-1');
    expect(emailOneNode?.children?.length).toBe(2);

    const firstOrderNode = emailOneNode?.children?.[0];
    const lineItemNode = firstOrderNode?.children?.find((n) => n.type === 'lineItem');
    expect(lineItemNode?.children?.[0]?.type).toBe('velocity');
  });

  it('aggregates orders into inventory items with analytics', () => {
    const inventory = processOrdersToInventory(sampleOrders);
    expect(inventory.length).toBe(3);

    const widgetEntry = inventory.find((item) => item.id === 'widget a (mcm-12345)');
    expect(widgetEntry?.orderCount).toBe(2);
    expect(widgetEntry?.history.length).toBe(2);
    expect(widgetEntry?.recommendedOrderQty).toBeGreaterThan(widgetEntry?.recommendedMin ?? 0);
  });
});
