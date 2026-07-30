export interface TestTenant {
  id: string;
  name: string;
  slug: string;
  plan: string;
  isActive: boolean;
  settings: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

let counter = 0;

export function buildTenant(overrides: Partial<TestTenant> = {}): TestTenant {
  counter += 1;
  return {
    id: `tenant-${counter}`,
    name: `Test Tenant ${counter}`,
    slug: `test-tenant-${counter}`,
    plan: 'ENTERPRISE',
    isActive: true,
    settings: {
      locale: 'en',
      timezone: 'America/New_York',
      currency: 'USD',
    },
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  };
}
