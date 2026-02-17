import { describe, expect, it } from 'vitest';
import { DiscoveredSupplier } from '../../services/api';
import {
  buildSupplierGridItems,
  calculateProgressPercent,
  canonicalizePrioritySupplierDomain,
  getPrioritySummaryText,
  getMilestoneMessage,
  isPrioritySupplierDomain,
  PRIORITY_SUPPLIER_SCAN_DOMAINS,
} from '../supplierSetupUtils';

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

  it('recognizes and canonicalizes priority supplier aliases', () => {
    expect(canonicalizePrioritySupplierDomain('mcmaster-carr.com')).toBe('mcmaster.com');
    expect(canonicalizePrioritySupplierDomain('Mcmaster.com')).toBe('mcmaster.com');
    expect(canonicalizePrioritySupplierDomain('uline.com')).toBe('uline.com');

    expect(isPrioritySupplierDomain('mcmaster.com')).toBe(true);
    expect(isPrioritySupplierDomain('mcmaster-carr.com')).toBe(true);
    expect(isPrioritySupplierDomain('uline.com')).toBe(true);
    expect(isPrioritySupplierDomain('example.com')).toBe(false);

    expect(PRIORITY_SUPPLIER_SCAN_DOMAINS).toEqual(
      expect.arrayContaining(['mcmaster.com', 'mcmaster-carr.com', 'uline.com']),
    );
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

  it('builds industrial card status text for running, complete, empty, and error states', () => {
    expect(
      getPrioritySummaryText({
        error: null,
        isComplete: false,
        processedEmails: 3,
        totalEmails: 12,
        orderCount: 2,
        itemCount: 7,
      }),
    ).toContain('Analyzing 3/12 emails');

    expect(
      getPrioritySummaryText({
        error: null,
        isComplete: true,
        processedEmails: 12,
        totalEmails: 12,
        orderCount: 4,
        itemCount: 9,
      }),
    ).toBe('9 items from 4 orders');

    expect(
      getPrioritySummaryText({
        error: null,
        isComplete: true,
        processedEmails: 12,
        totalEmails: 12,
        orderCount: 0,
        itemCount: 0,
      }),
    ).toContain('no line items extracted');

    expect(
      getPrioritySummaryText({
        error: 'Boom',
        isComplete: false,
        processedEmails: 0,
        totalEmails: 0,
        orderCount: 0,
        itemCount: 0,
      }),
    ).toBe('Boom');
  });
});
