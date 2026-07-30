import { BadRequestException } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';

const validTransitions: Record<PaymentStatus, PaymentStatus[]> = {
  [PaymentStatus.PENDING]: [PaymentStatus.COMPLETED, PaymentStatus.FAILED],
  [PaymentStatus.COMPLETED]: [PaymentStatus.REFUNDED, PaymentStatus.PARTIALLY_REFUNDED],
  [PaymentStatus.FAILED]: [],
  [PaymentStatus.REFUNDED]: [],
  [PaymentStatus.PARTIALLY_REFUNDED]: [PaymentStatus.REFUNDED],
};

export function validatePaymentTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (from === to) {
    throw new BadRequestException(`Payment is already in ${from} status`);
  }

  const allowed = validTransitions[from];
  if (!allowed || !allowed.includes(to)) {
    throw new BadRequestException(`Cannot transition payment from ${from} to ${to}`);
  }
}

export function isRefundableStatus(status: PaymentStatus): boolean {
  return status === PaymentStatus.COMPLETED || status === PaymentStatus.PARTIALLY_REFUNDED;
}

export function isVoidableStatus(status: PaymentStatus): boolean {
  return status === PaymentStatus.PENDING;
}

export function isTerminalPaymentStatus(status: PaymentStatus): boolean {
  const terminalStatuses: PaymentStatus[] = [PaymentStatus.FAILED, PaymentStatus.REFUNDED];
  return terminalStatuses.includes(status);
}
