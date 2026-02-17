import { JobProgress, DiscoveredSupplier } from '../services/api';

const PRIORITY_SUPPLIER_CONFIG = [
  {
    canonicalDomain: 'mcmaster.com',
    aliases: ['mcmaster.com', 'mcmaster-carr.com'],
    displayName: 'McMaster-Carr',
  },
  {
    canonicalDomain: 'uline.com',
    aliases: ['uline.com'],
    displayName: 'Uline',
  },
] as const;

const PRIORITY_SUPPLIER_ALIAS_TO_CANONICAL: Record<string, string> = PRIORITY_SUPPLIER_CONFIG
  .flatMap(({ canonicalDomain, aliases }) => aliases.map((alias) => [alias, canonicalDomain] as const))
  .reduce<Record<string, string>>((map, [alias, canonicalDomain]) => {
    map[alias] = canonicalDomain;
    return map;
  }, {});

export const PRIORITY_SUPPLIER_SCAN_DOMAINS = Array.from(
  new Set(PRIORITY_SUPPLIER_CONFIG.flatMap(({ aliases }) => aliases)),
);

// Contains both canonical domains and aliases.
export const PRIORITY_SUPPLIER_DOMAINS = new Set<string>(PRIORITY_SUPPLIER_SCAN_DOMAINS);

export const OTHER_PRIORITY_SUPPLIERS: DiscoveredSupplier[] = PRIORITY_SUPPLIER_CONFIG.map(
  ({ canonicalDomain, displayName }) => ({
    domain: canonicalDomain,
    displayName,
    emailCount: 0,
    score: 100,
    category: 'industrial',
    sampleSubjects: [],
    isRecommended: true,
  }),
);

export function canonicalizePrioritySupplierDomain(domain: string): string {
  const normalized = domain.trim().toLowerCase();
  return PRIORITY_SUPPLIER_ALIAS_TO_CANONICAL[normalized] || normalized;
}

export function isPrioritySupplierDomain(domain: string): boolean {
  const normalized = domain.trim().toLowerCase();
  return PRIORITY_SUPPLIER_DOMAINS.has(normalized);
}

export const CATEGORY_COLORS: Record<string, { bg: string; text: string; icon: string }> = {
  industrial: { bg: 'bg-blue-50', text: 'text-blue-600', icon: '🏭' },
  retail: { bg: 'bg-green-50', text: 'text-green-600', icon: '🛒' },
  electronics: { bg: 'bg-cyan-50', text: 'text-cyan-600', icon: '⚡' },
  office: { bg: 'bg-purple-50', text: 'text-purple-600', icon: '📎' },
  food: { bg: 'bg-orange-50', text: 'text-orange-600', icon: '🍽️' },
  unknown: { bg: 'bg-gray-50', text: 'text-gray-600', icon: '📦' },
};

export const MILESTONES = {
  firstItem: 1,
  tenItems: 10,
  fiftyItems: 50,
  hundredItems: 100,
  firstOrder: 1,
  tenOrders: 10,
} as const;

export interface SupplierGridItem {
  supplier: DiscoveredSupplier;
  colors: { bg: string; text: string; icon: string };
  isEnabled: boolean;
}

export function buildSupplierGridItems(
  suppliers: DiscoveredSupplier[],
  enabledSuppliers: Set<string>,
): SupplierGridItem[] {
  return suppliers.map(supplier => {
    const colors = CATEGORY_COLORS[supplier.category] || CATEGORY_COLORS.unknown;
    return {
      supplier,
      colors,
      isEnabled: enabledSuppliers.has(supplier.domain),
    };
  });
}

export function getMilestoneMessage(milestone: keyof typeof MILESTONES | string) {
  switch (milestone) {
    case 'firstItem':
      return { title: 'First Item Found!', subtitle: 'Your inventory is coming to life', emoji: '🎉' };
    case 'tenItems':
      return { title: '10 Items Discovered!', subtitle: 'Arda is learning your supply chain', emoji: '🚀' };
    case 'fiftyItems':
      return { title: '50 Items!', subtitle: 'Your replenishment patterns are emerging', emoji: '⚡' };
    case 'hundredItems':
      return { title: '100 Items!', subtitle: "You're building a powerful inventory system", emoji: '💪' };
    default:
      return { title: 'Milestone!', subtitle: '', emoji: '🎯' };
  }
}

export function calculateProgressPercent(progress?: JobProgress | null): number {
  if (!progress || progress.total <= 0) {
    return 0;
  }
  const percent = (progress.processed / Math.max(progress.total, 1)) * 100;
  if (!Number.isFinite(percent)) {
    return 0;
  }
  return Math.min(100, Math.max(0, percent));
}

interface PrioritySummaryParams {
  error: string | null;
  isComplete: boolean;
  processedEmails: number;
  totalEmails: number;
  orderCount: number;
  itemCount: number;
}

export function getPrioritySummaryText({
  error,
  isComplete,
  processedEmails,
  totalEmails,
  orderCount,
  itemCount,
}: PrioritySummaryParams): string {
  if (error) {
    return error;
  }
  if (!isComplete) {
    return `Analyzing ${processedEmails}/${totalEmails} emails • found ${itemCount} items across ${orderCount} orders`;
  }
  if (itemCount === 0) {
    return `Analyzed ${processedEmails}/${totalEmails} emails, no line items extracted.`;
  }
  return `${itemCount} items from ${orderCount} orders`;
}
