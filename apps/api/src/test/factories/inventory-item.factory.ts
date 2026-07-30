export interface TestInventoryItem {
  id: string;
  name: string;
  sku: string;
  quantity: number;
  minQuantity: number;
  unit: string;
  unitCost: number;
  tenantId: string;
  branchId: string;
  categoryId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

let counter = 0;

export function buildInventoryItem(overrides: Partial<TestInventoryItem> = {}): TestInventoryItem {
  counter += 1;
  return {
    id: `inv-item-${counter}`,
    name: `Inventory Item ${counter}`,
    sku: `INV-SKU-${counter}`,
    quantity: 100,
    minQuantity: 10,
    unit: 'pcs',
    unitCost: 2.5,
    tenantId: 'tenant-1',
    branchId: 'branch-1',
    categoryId: null,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    deletedAt: null,
    ...overrides,
  };
}
