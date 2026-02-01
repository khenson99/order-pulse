import { mergeSuppliers } from '../utils/supplierUtils';

const prioritySuppliers = [
  {
    domain: 'mcmaster.com',
    displayName: 'McMaster-Carr',
    emailCount: 0,
    score: 90,
    category: 'industrial',
    sampleSubjects: [],
    isRecommended: true,
  },
];

const discoveredSuppliers = [
  {
    domain: 'mcmaster.com',
    displayName: 'McMaster-Carr',
    emailCount: 4,
    score: 95,
    category: 'industrial',
    sampleSubjects: ['Order #123'],
    isRecommended: true,
  },
  {
    domain: 'uline.com',
    displayName: 'Uline',
    emailCount: 2,
    score: 80,
    category: 'industrial',
    sampleSubjects: ['Purchase request'],
    isRecommended: true,
  },
  {
    domain: 'amazon.com',
    displayName: 'Amazon',
    emailCount: 5,
    score: 70,
    category: 'retail',
    sampleSubjects: ['Amazon order'],
    isRecommended: true,
  },
];

describe('mergeSuppliers', () => {
  it('combines priority and discovered suppliers without duplicates', () => {
    const merged = mergeSuppliers(prioritySuppliers, discoveredSuppliers);

    const mcMaster = merged.find((s) => s.domain === 'mcmaster.com');
    const uline = merged.find((s) => s.domain === 'uline.com');
    const amazon = merged.find((s) => s.domain === 'amazon.com');

    expect(mcMaster).toBeDefined();
    expect(mcMaster?.emailCount).toBe(4);
    expect(mcMaster?.sampleSubjects).toEqual(['Order #123']);

    expect(uline).toBeDefined();
    expect(uline?.score).toBe(80);

    expect(amazon).toBeUndefined(); // Amazon should be filtered out
  });

  it('orders priority suppliers first', () => {
    const merged = mergeSuppliers(prioritySuppliers, discoveredSuppliers);
    expect(merged[0].domain).toBe('mcmaster.com');
  });
});
