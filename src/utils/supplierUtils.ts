import { DiscoveredSupplier } from '../services/api';

export function mergeSuppliers(
  prioritySuppliers: DiscoveredSupplier[],
  discoveredSuppliers: DiscoveredSupplier[],
): DiscoveredSupplier[] {
  const merged = new Map<string, DiscoveredSupplier>();

  prioritySuppliers.forEach((supplier) => {
    merged.set(supplier.domain, { ...supplier });
  });

  discoveredSuppliers
    .filter((supplier) => !supplier.domain.includes('amazon'))
    .forEach((supplier) => {
      if (merged.has(supplier.domain)) {
        const existing = merged.get(supplier.domain)!;
        merged.set(supplier.domain, {
          ...existing,
          emailCount: supplier.emailCount,
          sampleSubjects: supplier.sampleSubjects,
        });
      } else {
        merged.set(supplier.domain, supplier);
      }
    });

  return Array.from(merged.values()).sort((a, b) => {
    const aPriority = prioritySuppliers.some((p) => p.domain === a.domain);
    const bPriority = prioritySuppliers.some((p) => p.domain === b.domain);
    if (aPriority && !bPriority) return -1;
    if (!aPriority && bPriority) return 1;
    return b.score - a.score;
  });
}
