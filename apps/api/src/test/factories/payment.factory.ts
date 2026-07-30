export interface TestPayment {
  id: string;
  orderId: string;
  tenantId: string;
  method: string;
  amount: number;
  tip: number;
  status: string;
  reference: string | null;
  gatewayRef: string | null;
  processedAt: Date;
  refundedAt: Date | null;
  refundReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

let counter = 0;

export function buildPayment(overrides: Partial<TestPayment> = {}): TestPayment {
  counter += 1;
  return {
    id: `payment-${counter}`,
    orderId: 'order-1',
    tenantId: 'tenant-1',
    method: 'CASH',
    amount: 25.0,
    tip: 3.0,
    status: 'COMPLETED',
    reference: null,
    gatewayRef: null,
    processedAt: new Date('2025-01-01'),
    refundedAt: null,
    refundReason: null,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  };
}
