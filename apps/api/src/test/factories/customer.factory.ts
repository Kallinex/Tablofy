export interface TestCustomer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  tenantId: string;
  totalVisits: number;
  totalSpent: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

let counter = 0;

export function buildCustomer(overrides: Partial<TestCustomer> = {}): TestCustomer {
  counter += 1;
  return {
    id: `customer-${counter}`,
    name: `Customer ${counter}`,
    email: `customer${counter}@test.com`,
    phone: `+1-555-${counter.toString().padStart(4, '0')}`,
    tenantId: 'tenant-1',
    totalVisits: 5,
    totalSpent: 150.0,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    deletedAt: null,
    ...overrides,
  };
}
