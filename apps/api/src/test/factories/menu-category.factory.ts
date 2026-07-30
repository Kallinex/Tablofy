export interface TestMenuCategory {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  tenantId: string;
  restaurantId: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

let counter = 0;

export function buildMenuCategory(overrides: Partial<TestMenuCategory> = {}): TestMenuCategory {
  counter += 1;
  return {
    id: `category-${counter}`,
    name: `Category ${counter}`,
    description: `Description for category ${counter}`,
    sortOrder: counter,
    tenantId: 'tenant-1',
    restaurantId: 'restaurant-1',
    isActive: true,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    deletedAt: null,
    ...overrides,
  };
}
