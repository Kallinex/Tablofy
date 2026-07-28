import { BadRequestException } from '@nestjs/common';

export enum OrderStatus {
  DRAFT = 'DRAFT',
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  IN_PREPARATION = 'IN_PREPARATION',
  READY = 'READY',
  SERVED = 'SERVED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED',
  VOIDED = 'VOIDED',
}

export enum KitchenStatus {
  PENDING = 'PENDING',
  PREPARING = 'PREPARING',
  READY = 'READY',
  SERVED = 'SERVED',
  CANCELLED = 'CANCELLED',
}

const validTransitions: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.DRAFT]: [OrderStatus.PENDING, OrderStatus.CANCELLED, OrderStatus.VOIDED],
  [OrderStatus.PENDING]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]: [OrderStatus.IN_PREPARATION, OrderStatus.CANCELLED, OrderStatus.VOIDED],
  [OrderStatus.IN_PREPARATION]: [OrderStatus.READY, OrderStatus.CANCELLED, OrderStatus.VOIDED],
  [OrderStatus.READY]: [OrderStatus.SERVED, OrderStatus.CANCELLED, OrderStatus.VOIDED],
  [OrderStatus.SERVED]: [OrderStatus.COMPLETED, OrderStatus.REFUNDED],
  [OrderStatus.COMPLETED]: [OrderStatus.REFUNDED],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.REFUNDED]: [],
  [OrderStatus.VOIDED]: [],
};

export function validateTransition(from: string, to: string): void {
  const fromStatus = from as OrderStatus;
  const toStatus = to as OrderStatus;

  if (!Object.values(OrderStatus).includes(fromStatus)) {
    throw new BadRequestException(`Invalid source status: ${from}`);
  }

  if (!Object.values(OrderStatus).includes(toStatus)) {
    throw new BadRequestException(`Invalid target status: ${to}`);
  }

  if (fromStatus === toStatus) {
    throw new BadRequestException(`Order is already in ${from} status`);
  }

  const allowed = validTransitions[fromStatus];
  if (!allowed || !allowed.includes(toStatus)) {
    throw new BadRequestException(
      `Cannot transition order from ${from} to ${to}`,
    );
  }
}

export function isTerminalStatus(status: string): boolean {
  return [OrderStatus.CANCELLED, OrderStatus.REFUNDED, OrderStatus.VOIDED].includes(status as OrderStatus);
}

export function isPayableStatus(status: string): boolean {
  return [OrderStatus.CONFIRMED, OrderStatus.IN_PREPARATION, OrderStatus.READY, OrderStatus.SERVED].includes(status as OrderStatus);
}

export function isKitchenTracked(status: string): boolean {
  return [OrderStatus.CONFIRMED, OrderStatus.IN_PREPARATION, OrderStatus.READY].includes(status as OrderStatus);
}
