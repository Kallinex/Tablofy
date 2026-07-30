export interface TestProduct {
  id: string;
  name: string;
  description: string | null;
  sku: string;
  price: number;
  costPrice: number | null;
  categoryId: string | null;
  tenantId: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

let counter = 0;

export function buildProduct(overrides: Partial<TestProduct> = {}): TestProduct {
  counter += 1;
  return {
    id: `product-${counter}`,
    name: `Test Product ${counter}`,
    description: `Description for product ${counter}`,
    sku: `SKU-${counter}`,
    price: 9.99,
    costPrice: 4.99,
    categoryId: null,
    tenantId: 'tenant-1',
    isActive: true,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    deletedAt: null,
    ...overrides,
  };
}
