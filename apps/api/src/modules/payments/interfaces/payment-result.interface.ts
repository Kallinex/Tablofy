import { PaymentStatus } from '@prisma/client';

export interface PaymentResult {
  id: string;
  orderId: string;
  tenantId: string;
  method: string;
  status: PaymentStatus;
  amount: number;
  tip: number;
  reference: string | null;
  gatewayRef: string | null;
  gatewayData: Record<string, unknown> | null;
  processedAt: Date | null;
  refundedAt: Date | null;
  refundReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}
