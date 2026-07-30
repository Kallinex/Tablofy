export interface TestBranch {
  id: string;
  name: string;
  code: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  tenantId: string;
  restaurantId: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

let counter = 0;

export function buildBranch(overrides: Partial<TestBranch> = {}): TestBranch {
  counter += 1;
  return {
    id: `branch-${counter}`,
    name: `Branch ${counter}`,
    code: `BR-${counter}`,
    address: `${counter} Test Street`,
    city: 'Test City',
    phone: `+1-555-${counter.toString().padStart(4, '0')}`,
    tenantId: 'tenant-1',
    restaurantId: 'restaurant-1',
    isActive: true,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    deletedAt: null,
    ...overrides,
  };
}
