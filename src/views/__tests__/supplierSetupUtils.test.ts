import { describe, expect, it } from 'vitest';
import { DiscoveredSupplier } from '../../services/api';
import { buildSupplierGridItems, calculateProgressPercent, getMilestoneMessage } from '../supplierSetupUtils';

describe('supplierSetupUtils', () => {
  it('marks enabled suppliers correctly', () => {
    const suppliers: DiscoveredSupplier[] = [
      {
        domain: 'foo.com',
        displayName: 'Foo',
        emailCount: 1,
        score: 80,
        category: 'retail',
        sampleSubjects: [],
        isRecommended: false,
      },
      {
        domain: 'bar.com',
        displayName: 'Bar',
        emailCount: 1,
        score: 70,
        category: 'office',
        sampleSubjects: [],
        isRecommended: false,
      },
      {
        domain: 'unknown.com',
        displayName: 'Unknown',
        emailCount: 0,
        score: 10,
        category: 'unknown',
        sampleSubjects: [],
        isRecommended: false,
      },
    ];
    const enabledSuppliers = new Set(['foo.com']);

    const grid = buildSupplierGridItems(suppliers, enabledSuppliers);

    expect(grid).toHaveLength(3);
    expect(grid[0].isEnabled).toBe(true);
    expect(grid[1].isEnabled).toBe(false);
    expect(grid[0].colors).toHaveProperty('bg');
    expect(grid[2].colors.icon).toBe('📦'); // falls back to unknown color set
  });

  it('calculates progress percentage within bounds', () => {
    expect(calculateProgressPercent(undefined)).toBe(0);
    expect(calculateProgressPercent({ total: 0, processed: 0, success: 0, failed: 0, currentTask: '' })).toBe(0);
    expect(calculateProgressPercent({ total: 2, processed: 1, success: 1, failed: 0, currentTask: '' })).toBe(50);
    expect(calculateProgressPercent({ total: 5, processed: 10, success: 0, failed: 0, currentTask: '' })).toBe(100);
    expect(calculateProgressPercent({ total: 4, processed: -2, success: 0, failed: 0, currentTask: '' })).toBe(0);
    expect(calculateProgressPercent({ total: 4, processed: Number.POSITIVE_INFINITY, success: 0, failed: 0, currentTask: '' })).toBe(0);
  });

  it('returns milestone metadata for known milestones and fallback for unknown', () => {
    const firstItem = getMilestoneMessage('firstItem');
    expect(firstItem.title).toMatch(/First Item/);
    const tenItems = getMilestoneMessage('tenItems');
    expect(tenItems.emoji).toBe('🚀');
    const fiftyItems = getMilestoneMessage('fiftyItems');
    expect(fiftyItems.title).toMatch(/50/);
    const hundredItems = getMilestoneMessage('hundredItems');
    expect(hundredItems.title).toMatch(/100/);

    const unknown = getMilestoneMessage('not-real');
    expect(unknown.title).toMatch(/Milestone/);
  });
});
