import { PaymentMethod, PaymentStatus } from '@prisma/client';

export class PaymentResponseDto {
  id!: string;
  orderId!: string;
  tenantId!: string;
  method!: PaymentMethod;
  status!: PaymentStatus;
  amount!: number;
  tip!: number;
  reference!: string | null;
  gatewayRef!: string | null;
  processedAt!: Date | null;
  refundedAt!: Date | null;
  refundReason!: string | null;
  createdAt!: Date;
  updatedAt!: Date;
}
