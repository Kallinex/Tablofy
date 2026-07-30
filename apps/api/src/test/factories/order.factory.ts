export interface TestOrder {
  id: string;
  orderNumber: string;
  tenantId: string;
  restaurantId: string;
  branchId: string;
  tableId: string | null;
  userId: string;
  customerId: string | null;
  status: string;
  orderType: string;
  subtotal: number;
  taxTotal: number;
  serviceChargeTotal: number;
  discountTotal: number;
  total: number;
  paidAmount: number;
  paymentStatus: string;
  kitchenStatus: string;
  notes: string | null;
  deliveryAddress: string | null;
  deliveryFee: number | null;
  deliveryStatus: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface TestCreateOrderDto {
  restaurantId: string;
  branchId: string;
  tableId?: string;
  customerId?: string;
  orderType: string;
  items: TestOrderItemDto[];
  notes?: string;
  discountAmount?: number;
  discountReason?: string;
  serviceChargeId?: string;
  taxRateIds?: string[];
}

export interface TestOrderItemDto {
  productId: string;
  variantId?: string;
  quantity: number;
  unitPrice: number;
  modifierIds?: string[];
  notes?: string;
}

let counter = 0;

export function buildOrder(overrides: Partial<TestOrder> = {}): TestOrder {
  counter += 1;
  return {
    id: `order-${counter}`,
    orderNumber: `ORD-${counter.toString().padStart(6, '0')}`,
    tenantId: 'tenant-1',
    restaurantId: 'restaurant-1',
    branchId: 'branch-1',
    tableId: null,
    userId: 'user-1',
    customerId: null,
    status: 'PENDING',
    orderType: 'DINE_IN',
    subtotal: 0,
    taxTotal: 0,
    serviceChargeTotal: 0,
    discountTotal: 0,
    total: 0,
    paidAmount: 0,
    paymentStatus: 'PENDING',
    kitchenStatus: 'PENDING',
    notes: null,
    deliveryAddress: null,
    deliveryFee: null,
    deliveryStatus: null,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    deletedAt: null,
    ...overrides,
  };
}

export function buildCreateOrderDto(
  overrides: Partial<TestCreateOrderDto> = {},
): TestCreateOrderDto {
  return {
    restaurantId: 'restaurant-1',
    branchId: 'branch-1',
    orderType: 'DINE_IN',
    items: [
      {
        productId: 'product-1',
        quantity: 2,
        unitPrice: 10.99,
      },
    ],
    ...overrides,
  };
}
