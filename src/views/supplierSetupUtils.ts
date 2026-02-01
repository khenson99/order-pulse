import { JobProgress, DiscoveredSupplier } from '../services/api';

export const OTHER_PRIORITY_SUPPLIERS: DiscoveredSupplier[] = [
  {
    domain: 'mcmaster.com',
    displayName: 'McMaster-Carr',
    emailCount: 0,
    score: 100,
    category: 'industrial',
    sampleSubjects: [],
    isRecommended: true,
  },
  {
    domain: 'uline.com',
    displayName: 'Uline',
    emailCount: 0,
    score: 100,
    category: 'industrial',
    sampleSubjects: [],
    isRecommended: true,
  },
];

export const PRIORITY_SUPPLIER_DOMAINS = new Set(['mcmaster.com', 'uline.com']);

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
