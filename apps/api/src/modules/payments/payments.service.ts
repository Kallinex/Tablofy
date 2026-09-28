import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { MetricsService } from '../../common/metrics/metrics.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  Prisma,
  PaymentStatus,
  PaymentMethod,
  OrderStatus,
  OrderStatus as PrismaOrderStatus,
} from '@prisma/client';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PartialRefundDto } from './dto/partial-refund.dto';
import { VoidPaymentDto } from './dto/void-payment.dto';
import { SplitPaymentDto } from './dto/split-payment.dto';
import { ReconcileQueryDto } from './dto/reconcile-query.dto';
import { PaymentResponseDto } from './dto/payment-response.dto';
import {
  isRefundableStatus,
  isVoidableStatus,
  validatePaymentTransition,
} from './payment-state-machine';
import { canTransition } from '../orders/order-state-machine';
import { StripeProvider } from './providers/stripe.provider';
import { PaymobProvider } from './providers/paymob.provider';
import { PaymentProvider } from '../integrations/interfaces/payment-provider.interface';
import { IntegrationProviderType } from '@tablofy/shared/types';

type ProviderLike = StripeProvider | PaymobProvider;

class PaymentAlreadyFinalizedError extends Error {
  constructor() {
    super('Payment already finalized by a concurrent confirmation');
    this.name = 'PaymentAlreadyFinalizedError';
  }
}

class PaymentAmountMismatchError extends Error {
  constructor(expected: string, reported: string) {
    super(`Webhook amount mismatch: gateway reported ${reported}, expected ${expected}`);
    this.name = 'PaymentAmountMismatchError';
  }
}

interface SplitProviderOutcome {
  paymentId: string;
  outcome: 'completed' | 'failed' | 'pending';
  gatewayRef: string | null;
  gatewayData: Prisma.InputJsonValue;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly providerRegistry = new Map<IntegrationProviderType, ProviderLike>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly metricsService: MetricsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly stripeProvider: StripeProvider,
    private readonly paymobProvider: PaymobProvider,
    @Optional() private readonly configService?: ConfigService,
  ) {
    this.providerRegistry.set('stripe', this.stripeProvider);
    this.providerRegistry.set('paymob', this.paymobProvider);
  }

  async onModuleInit(): Promise<void> {
    for (const provider of this.providerRegistry.values()) {
      await provider.initialize({ tenantId: 'system', settings: {} });
    }
  }

  private assertNotMockInProduction(provider: ProviderLike): void {
    if (
      this.configService?.get<string>('app.nodeEnv') === 'production' &&
      provider.mode === 'mock'
    ) {
      throw new BadRequestException(
        'PAYMENTS_MODE=mock is forbidden in production. Configure PAYMENTS_MODE=live with gateway credentials.',
      );
    }
  }

  private isProviderSuccess(
    result: Awaited<ReturnType<PaymentProvider['createPaymentIntent']>> | undefined,
  ): result is { success: true; data: { id: string; clientSecret?: string; status: string } } {
    return Boolean(result?.success && result.data?.id);
  }

  private async createPaymentForProvider(
    tx: Prisma.TransactionClient,
    orderId: string,
    tenantId: string,
    method: PaymentMethod,
    amount: number,
    tip: number,
    reference: string | null | undefined,
    idempotencyKey: string,
  ) {
    return tx.payment.create({
      data: {
        orderId,
        tenantId,
        method,
        amount,
        tip: tip || 0,
        reference: reference || null,
        idempotencyKey,
        status: PaymentStatus.PENDING,
      },
    });
  }

  private async finalizeSucceededPayment(
    tx: Prisma.TransactionClient,
    orderId: string,
    tenantId: string,
    orderStatus: OrderStatus,
    paymentId: string,
    amount: number,
    tip: number,
    gatewayRef: string | null,
    gatewayData: Prisma.InputJsonValue | null,
    userId: string,
  ) {
    const claimed = await tx.payment.updateMany({
      where: { id: paymentId, status: PaymentStatus.PENDING },
      data: {
        status: PaymentStatus.COMPLETED,
        gatewayRef,
        gatewayData: gatewayData ?? undefined,
        processedAt: new Date(),
      },
    });
    if (claimed.count === 0) {
      throw new PaymentAlreadyFinalizedError();
    }

    const freshOrder = await tx.order.findFirst({
      where: { id: orderId, tenantId, deletedAt: null },
    });
    if (!freshOrder) {
      throw new NotFoundException('Order not found');
    }
    const verResult = await tx.order.updateMany({
      where: { id: orderId, version: freshOrder.version },
      data: { version: { increment: 1 } },
    });
    if (verResult.count === 0) {
      throw new ConflictException('Order was modified by another user. Please retry.');
    }

    const totalPaid = Number(freshOrder.paidAmount) + amount;
    const orderTotal = Number(freshOrder.total);

    await tx.order.update({
      where: { id: orderId },
      data: {
        paidAmount: totalPaid,
        tip: { increment: tip || 0 },
        ...(totalPaid >= orderTotal
          ? { status: 'COMPLETED' as OrderStatus, completedAt: new Date() }
          : {}),
      },
    });

    if (totalPaid >= orderTotal) {
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          tenantId,
          fromStatus: orderStatus,
          toStatus: 'COMPLETED' as OrderStatus,
          changedByUserId: userId,
          reason: 'Payment completed',
        },
      });
    }

    return tx.payment.findUnique({ where: { id: paymentId } });
  }

  private async redeemGiftCardForPayment(
    tx: Prisma.TransactionClient,
    code: string | null | undefined,
    amount: number,
    tenantId: string,
    orderId: string,
  ): Promise<void> {
    if (!code) {
      throw new BadRequestException(
        'Gift card code (reference) is required for GIFT_CARD payments',
      );
    }
    const card = await tx.giftCard.findFirst({ where: { code, tenantId } });
    if (!card) {
      throw new BadRequestException('Gift card not found');
    }
    if (card.status !== 'ACTIVE') {
      throw new BadRequestException('Gift card is not active');
    }
    if (card.expiresAt && new Date() > card.expiresAt) {
      throw new BadRequestException('Gift card has expired');
    }

    const result = await tx.giftCard.updateMany({
      where: { id: card.id, tenantId, status: 'ACTIVE', currentBalance: { gte: amount } },
      data: { currentBalance: { decrement: amount } },
    });
    if (result.count === 0) {
      throw new BadRequestException('Gift card has insufficient balance');
    }

    const balanceBefore = Number(card.currentBalance);
    await tx.giftCardTransaction.create({
      data: {
        giftCardId: card.id,
        tenantId,
        type: 'REDEEM',
        amount,
        balanceBefore,
        balanceAfter: balanceBefore - amount,
        referenceId: orderId,
        referenceType: 'ORDER',
        description: 'Payment for order',
      },
    });
  }

  private async redeemNonProviderPayment(
    tx: Prisma.TransactionClient,
    method: PaymentMethod,
    reference: string | null | undefined,
    amount: number,
    tenantId: string,
    orderId: string,
  ): Promise<void> {
    if (method === PaymentMethod.GIFT_CARD) {
      await this.redeemGiftCardForPayment(tx, reference, amount, tenantId, orderId);
      return;
    }
    if (method === PaymentMethod.WALLET) {
      throw new BadRequestException(
        'WALLET payments must be processed through the customer wallet spend flow',
      );
    }
  }

  async charge(
    orderId: string,
    dto: CreatePaymentDto,
    tenantId: string,
    userId: string,
  ): Promise<PaymentResponseDto> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId, deletedAt: null },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const payableStatuses = ['CONFIRMED', 'IN_PREPARATION', 'READY', 'SERVED'];
    if (!payableStatuses.includes(order.status)) {
      throw new BadRequestException(`Cannot add payment to order in ${order.status} status`);
    }

    const totalPaid = Number(order.paidAmount) + dto.amount;
    const orderTotal = Number(order.total);

    if (totalPaid > orderTotal) {
      throw new BadRequestException('Payment amount exceeds remaining balance');
    }

    const idempotencyKey = dto.idempotencyKey ?? randomUUID();

    const existing = await this.prisma.payment.findFirst({
      where: { tenantId, idempotencyKey },
    });
    if (existing) {
      if (existing.orderId !== orderId) {
        throw new ConflictException('Idempotency key was already used for a different order');
      }
      return this.toResponseDto(existing);
    }

    const provider = this.getProviderForMethod(dto.method);
    if (provider) {
      this.assertNotMockInProduction(provider);
    }

    let payment: Prisma.PaymentGetPayload<Record<string, never>>;
    try {
      payment = await this.prisma.$transaction(async (tx) => {
        const verResult = await tx.order.updateMany({
          where: { id: orderId, version: order.version },
          data: { version: { increment: 1 } },
        });
        if (verResult.count === 0) {
          throw new ConflictException('Order was modified by another user. Please retry.');
        }

        if (!provider) {
          await this.redeemNonProviderPayment(
            tx,
            dto.method,
            dto.reference,
            dto.amount,
            tenantId,
            orderId,
          );

          const created = await tx.payment.create({
            data: {
              orderId,
              tenantId,
              method: dto.method,
              amount: dto.amount,
              tip: dto.tip || 0,
              reference: dto.reference || null,
              idempotencyKey,
              status: PaymentStatus.COMPLETED,
              processedAt: new Date(),
            },
          });

          await tx.order.update({
            where: { id: orderId },
            data: {
              paidAmount: Number(order.paidAmount) + dto.amount,
              tip: { increment: dto.tip || 0 },
              ...(totalPaid >= orderTotal
                ? { status: 'COMPLETED' as OrderStatus, completedAt: new Date() }
                : {}),
            },
          });

          if (totalPaid >= orderTotal) {
            await tx.orderStatusHistory.create({
              data: {
                orderId,
                tenantId,
                fromStatus: order.status as OrderStatus,
                toStatus: 'COMPLETED' as OrderStatus,
                changedByUserId: userId,
                reason: 'Payment completed',
              },
            });
          }

          return created;
        }

        return this.createPaymentForProvider(
          tx,
          orderId,
          tenantId,
          dto.method,
          dto.amount,
          dto.tip || 0,
          dto.reference,
          idempotencyKey,
        );
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const replay = await this.prisma.payment.findFirst({
          where: { tenantId, idempotencyKey },
        });
        if (replay) {
          if (replay.orderId !== orderId) {
            throw new ConflictException('Idempotency key was already used for a different order');
          }
          return this.toResponseDto(replay);
        }
      }
      throw error;
    }

    if (provider) {
      const intentResult = await provider.createPaymentIntent(
        {
          amount: Math.round(dto.amount * 100),
          currency: 'usd',
          description: `Payment for order ${order.orderNumber}`,
          metadata: { orderId, tenantId, paymentId: payment.id },
        },
        idempotencyKey,
      );

      if (!this.isProviderSuccess(intentResult)) {
        validatePaymentTransition(payment.status, PaymentStatus.FAILED);
        payment = await this.prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.FAILED,
            gatewayData: { error: intentResult?.error ?? 'Gateway rejected payment' },
          },
        });
        return this.emitResult(payment, dto, userId);
      }

      const gatewayRef = intentResult.data.id;
      const confirmResult = await provider.confirmPayment(gatewayRef, idempotencyKey);

      if (!confirmResult.success || !confirmResult.data) {
        validatePaymentTransition(payment.status, PaymentStatus.FAILED);
        payment = await this.prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.FAILED,
            gatewayRef,
            gatewayData: {
              error: confirmResult.error ?? 'Gateway confirmation failed',
              intent: intentResult.data,
            },
          },
        });
        return this.emitResult(payment, dto, userId);
      }

      const confirmed = confirmResult.data;

      if (confirmed.status === 'succeeded') {
        let finalizedLocally = true;
        try {
          payment = await this.prisma.$transaction(async (tx) => {
            const finalized = await this.finalizeSucceededPayment(
              tx,
              orderId,
              tenantId,
              order.status as OrderStatus,
              payment.id,
              dto.amount,
              dto.tip || 0,
              confirmed.transactionId ?? gatewayRef,
              intentResult.data as unknown as Prisma.InputJsonValue,
              userId,
            );
            if (!finalized) {
              throw new NotFoundException('Payment not found');
            }
            return finalized;
          });
        } catch (error) {
          if (error instanceof PaymentAlreadyFinalizedError) {
            finalizedLocally = false;
            const existing = await this.prisma.payment.findUnique({
              where: { id: payment.id },
            });
            if (!existing) {
              throw new NotFoundException('Payment not found');
            }
            payment = existing;
          } else {
            throw error;
          }
        }
        if (!finalizedLocally) {
          return this.toResponseDto(payment);
        }
        return this.emitResult(payment, dto, userId);
      }

      if (confirmed.status === 'failed') {
        payment = await this.prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.FAILED,
            gatewayRef,
            gatewayData: intentResult.data as unknown as Prisma.InputJsonValue,
          },
        });
        return this.emitResult(payment, dto, userId);
      }

      if (confirmed.status === 'pending') {
        payment = await this.prisma.payment.update({
          where: { id: payment.id },
          data: {
            gatewayRef,
            gatewayData: intentResult.data as unknown as Prisma.InputJsonValue,
          },
        });
        return this.emitResult(payment, dto, userId);
      }
    }

    return this.emitResult(payment, dto, userId);
  }

  private async emitResult(
    payment: Prisma.PaymentGetPayload<Record<string, never>>,
    dto: Pick<CreatePaymentDto, 'method' | 'amount' | 'tip'>,
    userId: string,
  ): Promise<PaymentResponseDto> {
    await this.auditLogsService.log({
      action: 'PAYMENT_ADDED',
      resource: 'Payment',
      resourceId: payment.id,
      userId,
      tenantId: payment.tenantId,
      newValues: { method: dto.method, amount: dto.amount, tip: dto.tip },
    });

    if (payment.status === PaymentStatus.COMPLETED) {
      this.metricsService.incrementPaymentsCompleted();
      this.metricsService.incrementOrdersCompleted();
      this.metricsService.addRevenue(Math.round(Number(payment.amount) * 100));
      this.eventEmitter.emit('payments.completed', {
        tenantId: payment.tenantId,
        orderId: payment.orderId,
        paymentId: payment.id,
      });
    } else if (payment.status === PaymentStatus.FAILED) {
      this.metricsService.incrementPaymentsFailed();
      this.eventEmitter.emit('payments.failed', {
        tenantId: payment.tenantId,
        orderId: payment.orderId,
        paymentId: payment.id,
      });
    }

    return this.toResponseDto(payment);
  }

  async refund(
    paymentId: string,
    tenantId: string,
    userId: string,
    reason?: string,
  ): Promise<PaymentResponseDto> {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, tenantId },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (!isRefundableStatus(payment.status)) {
      throw new BadRequestException(`Payment in ${payment.status} status cannot be refunded`);
    }

    if (Number(payment.amountRefunded ?? 0) > 0) {
      throw new BadRequestException(
        'Payment has been partially refunded; it cannot be fully refunded. Use partial refund for the remaining balance.',
      );
    }

    if (payment.gatewayRef) {
      const provider = this.getProviderForMethod(payment.method);
      if (provider) {
        this.assertNotMockInProduction(provider);
        const refundResult = await provider.refundPayment(
          { transactionId: payment.gatewayRef, reason },
          `refund_${payment.id}`,
        );
        if (!refundResult.success) {
          throw new BadRequestException(refundResult.error || 'Gateway refund failed');
        }
      }
    }

    let orderRefunded = false;
    const result = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.payment.updateMany({
        where: {
          id: paymentId,
          status: { in: [PaymentStatus.COMPLETED, PaymentStatus.PARTIALLY_REFUNDED] },
          amountRefunded: 0,
        },
        data: {
          status: PaymentStatus.REFUNDED,
          amountRefunded: payment.amount,
          refundedAt: new Date(),
          refundReason: reason || null,
        },
      });
      if (claimed.count === 0) {
        throw new ConflictException('Payment was already refunded by another operation');
      }

      const freshOrder = await tx.order.findFirst({
        where: { id: payment.orderId, tenantId, deletedAt: null },
      });
      if (!freshOrder) {
        throw new NotFoundException('Order not found');
      }
      const orderVerResult = await tx.order.updateMany({
        where: { id: payment.orderId, version: freshOrder.version },
        data: { version: { increment: 1 } },
      });
      if (orderVerResult.count === 0) {
        throw new ConflictException('Order was modified by another user. Please retry.');
      }

      // A full refund retires the order, but only when the documented state machine
      // actually allows it (SERVED/COMPLETED -> REFUNDED). Refunding a payment that was
      // collected before fulfilment (DRAFT/PENDING/CONFIRMED/IN_PREPARATION/READY) or on a
      // terminal order must still record the financial refund without forcing an illegal
      // order transition. The state machine stays the single source of truth.
      const shouldRefundOrder = canTransition(String(freshOrder.status), OrderStatus.REFUNDED);
      await tx.order.update({
        where: { id: payment.orderId },
        data: {
          paidAmount: { decrement: payment.amount },
          tip: { decrement: payment.tip || 0 },
          ...(shouldRefundOrder ? { status: OrderStatus.REFUNDED } : {}),
        },
      });

      if (shouldRefundOrder) {
        await tx.orderStatusHistory.create({
          data: {
            orderId: payment.orderId,
            tenantId,
            fromStatus: freshOrder.status as PrismaOrderStatus,
            toStatus: OrderStatus.REFUNDED as PrismaOrderStatus,
            changedByUserId: userId,
            reason: reason || 'Payment refunded',
          },
        });
        orderRefunded = true;
      }

      const updated = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!updated) {
        throw new NotFoundException('Payment not found');
      }
      return updated;
    });

    await this.auditLogsService.log({
      action: 'PAYMENT_REFUNDED',
      resource: 'Payment',
      resourceId: paymentId,
      userId,
      tenantId,
      oldValues: { status: payment.status },
      newValues: { status: PaymentStatus.REFUNDED, reason },
    });

    this.metricsService.incrementPaymentsRefunded();
    this.eventEmitter.emit('payments.refunded', {
      tenantId,
      orderId: payment.orderId,
      paymentId,
      amount: payment.amount,
      amountRefunded: payment.amount,
    });

    if (orderRefunded) {
      this.eventEmitter.emit('order.refunded', {
        tenantId,
        orderId: payment.orderId,
        paymentId,
      });
    }

    return this.toResponseDto(result);
  }

  async partialRefund(
    paymentId: string,
    dto: PartialRefundDto,
    tenantId: string,
    userId: string,
  ): Promise<PaymentResponseDto> {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, tenantId },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (!isRefundableStatus(payment.status)) {
      throw new BadRequestException(`Payment in ${payment.status} status cannot be refunded`);
    }

    const alreadyRefunded = Number(payment.amountRefunded ?? 0);
    const remaining = Number(payment.amount) - alreadyRefunded;

    if (dto.amount > remaining) {
      throw new BadRequestException(
        `Refund amount exceeds remaining refundable amount of ${remaining.toFixed(2)}`,
      );
    }

    if (payment.gatewayRef) {
      const provider = this.getProviderForMethod(payment.method);
      if (provider) {
        this.assertNotMockInProduction(provider);
        const refundResult = await provider.refundPayment(
          {
            transactionId: payment.gatewayRef,
            amount: Math.round(dto.amount * 100),
            reason: dto.reason,
          },
          `partial_refund_${payment.id}`,
        );
        if (!refundResult.success) {
          throw new BadRequestException(refundResult.error || 'Gateway refund failed');
        }
      }
    }

    const maxAllowedRefunded = Number(payment.amount) - dto.amount;

    // Authoritative cumulative refunded total, read back inside the same transaction that
    // claimed the increment. The pre-transaction snapshot (alreadyRefunded + dto.amount) is
    // not concurrency-safe: two partial refunds that both observe the same alreadyRefunded
    // would emit the same cumulative value, colliding on the COGS reversal dedupe key
    // (REFUND:<paymentId>:<cumulative>) and silently dropping one reversal.
    let committedCumulativeRefunded = 0;

    const result = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.payment.updateMany({
        where: {
          id: paymentId,
          status: { in: [PaymentStatus.COMPLETED, PaymentStatus.PARTIALLY_REFUNDED] },
          amountRefunded: { lte: maxAllowedRefunded },
        },
        data: {
          status: PaymentStatus.PARTIALLY_REFUNDED,
          amountRefunded: { increment: dto.amount },
          refundedAt: new Date(),
          refundReason: dto.reason || null,
        },
      });
      if (claimed.count === 0) {
        throw new ConflictException(
          'Refund exceeds remaining refundable amount (payment already refunded by another operation)',
        );
      }

      const freshOrder = await tx.order.findFirst({
        where: { id: payment.orderId, tenantId, deletedAt: null },
      });
      if (!freshOrder) {
        throw new NotFoundException('Order not found');
      }
      const orderVerResult = await tx.order.updateMany({
        where: { id: payment.orderId, version: freshOrder.version },
        data: { version: { increment: 1 } },
      });
      if (orderVerResult.count === 0) {
        throw new ConflictException('Order was modified by another user. Please retry.');
      }

      await tx.order.update({
        where: { id: payment.orderId },
        data: {
          paidAmount: { decrement: dto.amount },
        },
      });

      const updated = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!updated) {
        throw new NotFoundException('Payment not found');
      }
      committedCumulativeRefunded = Number(updated.amountRefunded);
      return updated;
    });

    await this.auditLogsService.log({
      action: 'PAYMENT_PARTIALLY_REFUNDED',
      resource: 'Payment',
      resourceId: paymentId,
      userId,
      tenantId,
      oldValues: { status: payment.status },
      newValues: {
        status: PaymentStatus.PARTIALLY_REFUNDED,
        amount: dto.amount,
        reason: dto.reason,
      },
    });

    this.metricsService.incrementPaymentsRefunded();
    this.eventEmitter.emit('payments.refunded', {
      tenantId,
      orderId: payment.orderId,
      paymentId,
      amount: dto.amount,
      amountRefunded: committedCumulativeRefunded,
    });

    return this.toResponseDto(result);
  }

  async voidPayment(
    paymentId: string,
    dto: VoidPaymentDto,
    tenantId: string,
    userId: string,
  ): Promise<PaymentResponseDto> {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, tenantId },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (!isVoidableStatus(payment.status)) {
      throw new BadRequestException(`Payment in ${payment.status} status cannot be voided`);
    }

    if (payment.gatewayRef) {
      const provider = this.getProviderForMethod(payment.method);
      if (provider) {
        this.assertNotMockInProduction(provider);
        const voidResult = await provider.voidPayment(payment.gatewayRef, `void_${payment.id}`);
        if (!voidResult.success) {
          throw new BadRequestException(voidResult.error || 'Gateway void failed');
        }
      }
    }

    const result = await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: PaymentStatus.FAILED,
        refundReason: dto.reason,
      },
    });

    await this.auditLogsService.log({
      action: 'PAYMENT_VOIDED',
      resource: 'Payment',
      resourceId: paymentId,
      userId,
      tenantId,
      oldValues: { status: payment.status },
      newValues: { status: PaymentStatus.FAILED, reason: dto.reason },
    });

    this.metricsService.incrementPaymentsFailed();
    this.eventEmitter.emit('payments.failed', {
      tenantId,
      orderId: payment.orderId,
      paymentId,
    });

    return this.toResponseDto(result);
  }

  async splitPayment(
    orderId: string,
    dto: SplitPaymentDto,
    tenantId: string,
    userId: string,
  ): Promise<PaymentResponseDto[]> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId, deletedAt: null },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const totalSplitAmount = dto.splits.reduce((sum, s) => sum + s.amount, 0);
    const remainingBalance = Number(order.total) - Number(order.paidAmount);

    if (totalSplitAmount > remainingBalance) {
      throw new BadRequestException('Split total exceeds remaining balance');
    }

    const providerSplits = dto.splits.filter((split) => this.getProviderForMethod(split.method));
    for (const split of providerSplits) {
      this.assertNotMockInProduction(this.getProviderForMethod(split.method)!);
    }

    const results = await this.prisma.$transaction(async (tx) => {
      const freshOrder = await tx.order.findFirst({
        where: { id: orderId, tenantId, deletedAt: null },
      });
      if (!freshOrder) {
        throw new NotFoundException('Order not found');
      }

      const payableStatuses = ['CONFIRMED', 'IN_PREPARATION', 'READY', 'SERVED'];
      if (!payableStatuses.includes(freshOrder.status)) {
        throw new BadRequestException(`Cannot add payment to order in ${freshOrder.status} status`);
      }
      if (totalSplitAmount > Number(freshOrder.total) - Number(freshOrder.paidAmount)) {
        throw new BadRequestException('Split total exceeds remaining balance');
      }

      const createdPayments: Prisma.PaymentGetPayload<Record<string, never>>[] = [];
      const pendingPayments: Prisma.PaymentGetPayload<Record<string, never>>[] = [];
      let completedAmount = 0;

      for (const split of dto.splits) {
        const provider = this.getProviderForMethod(split.method);
        const idempotencyKey = randomUUID();

        let payment = await tx.payment.create({
          data: {
            orderId,
            tenantId,
            method: split.method,
            amount: split.amount,
            tip: split.tip || 0,
            reference: split.reference || null,
            idempotencyKey,
            status: PaymentStatus.PENDING,
          },
        });

        if (!provider) {
          await this.redeemNonProviderPayment(
            tx,
            split.method,
            split.reference,
            split.amount,
            tenantId,
            orderId,
          );
          payment = await tx.payment.update({
            where: { id: payment.id },
            data: { status: PaymentStatus.COMPLETED, processedAt: new Date() },
          });
          completedAmount += split.amount;
        } else {
          pendingPayments.push(payment);
        }
        createdPayments.push(payment);
      }

      if (completedAmount > 0) {
        const verResult = await tx.order.updateMany({
          where: { id: orderId, version: freshOrder.version },
          data: { version: { increment: 1 } },
        });
        if (verResult.count === 0) {
          throw new ConflictException('Order was modified by another user. Please retry.');
        }

        const newTotalPaid = Number(freshOrder.paidAmount) + completedAmount;
        await tx.order.update({
          where: { id: orderId },
          data: {
            paidAmount: { increment: completedAmount },
            ...(newTotalPaid >= Number(freshOrder.total)
              ? { status: 'COMPLETED' as OrderStatus, completedAt: new Date() }
              : {}),
          },
        });

        if (newTotalPaid >= Number(freshOrder.total)) {
          await tx.orderStatusHistory.create({
            data: {
              orderId,
              tenantId,
              fromStatus: freshOrder.status as OrderStatus,
              toStatus: 'COMPLETED' as OrderStatus,
              changedByUserId: userId,
              reason: 'Split payment completed',
            },
          });
        }
      }

      return { createdPayments, pendingPayments };
    });

    const providerOutcomes = await this.executeProviderSplitPayments(
      order,
      tenantId,
      results.pendingPayments,
    );
    const finalized = await this.finalizeProviderSplitPayments(
      orderId,
      tenantId,
      userId,
      providerOutcomes,
      results.createdPayments,
    );

    for (const payment of finalized) {
      if (payment.status === PaymentStatus.COMPLETED) {
        await this.auditLogsService.log({
          action: 'PAYMENT_ADDED',
          resource: 'Payment',
          resourceId: payment.id,
          userId,
          tenantId,
          newValues: { method: payment.method, amount: Number(payment.amount) },
        });

        this.metricsService.incrementPaymentsCompleted();
        this.eventEmitter.emit('payments.completed', {
          tenantId,
          orderId,
          paymentId: payment.id,
        });
      } else if (payment.status === PaymentStatus.FAILED) {
        this.metricsService.incrementPaymentsFailed();
        this.eventEmitter.emit('payments.failed', {
          tenantId,
          orderId,
          paymentId: payment.id,
        });
      }
    }

    return finalized.map((p) => this.toResponseDto(p));
  }

  private async executeProviderSplitPayments(
    order: { orderNumber: number },
    tenantId: string,
    pendingPayments: Prisma.PaymentGetPayload<Record<string, never>>[],
  ): Promise<SplitProviderOutcome[]> {
    const outcomes: SplitProviderOutcome[] = [];
    for (const payment of pendingPayments) {
      const provider = this.getProviderForMethod(payment.method);
      if (!provider) {
        continue;
      }

      const intentResult = await provider.createPaymentIntent(
        {
          amount: Math.round(Number(payment.amount) * 100),
          currency: 'usd',
          description: `Split payment for order ${order.orderNumber}`,
          metadata: { orderId: payment.orderId, tenantId, paymentId: payment.id },
        },
        payment.idempotencyKey ?? undefined,
      );

      if (!this.isProviderSuccess(intentResult)) {
        outcomes.push({
          paymentId: payment.id,
          outcome: 'failed',
          gatewayRef: null,
          gatewayData: {
            error: intentResult?.error ?? 'Gateway rejected payment',
          } as Prisma.InputJsonValue,
        });
        continue;
      }

      const confirmResult = await provider.confirmPayment(
        intentResult.data.id,
        payment.idempotencyKey ?? undefined,
      );

      if (confirmResult.success && confirmResult.data?.status === 'succeeded') {
        outcomes.push({
          paymentId: payment.id,
          outcome: 'completed',
          gatewayRef: confirmResult.data.transactionId ?? intentResult.data.id,
          gatewayData: intentResult.data as unknown as Prisma.InputJsonValue,
        });
      } else if (confirmResult.success && confirmResult.data?.status === 'failed') {
        outcomes.push({
          paymentId: payment.id,
          outcome: 'failed',
          gatewayRef: intentResult.data.id,
          gatewayData: intentResult.data as unknown as Prisma.InputJsonValue,
        });
      } else if (confirmResult.success) {
        outcomes.push({
          paymentId: payment.id,
          outcome: 'pending',
          gatewayRef: intentResult.data.id,
          gatewayData: intentResult.data as unknown as Prisma.InputJsonValue,
        });
      } else {
        outcomes.push({
          paymentId: payment.id,
          outcome: 'failed',
          gatewayRef: intentResult.data.id,
          gatewayData: {
            error: confirmResult.error ?? 'Gateway confirmation failed',
            intent: intentResult.data,
          } as Prisma.InputJsonValue,
        });
      }
    }
    return outcomes;
  }

  private async finalizeProviderSplitPayments(
    orderId: string,
    tenantId: string,
    userId: string,
    outcomes: SplitProviderOutcome[],
    createdPayments: Prisma.PaymentGetPayload<Record<string, never>>[],
  ): Promise<Prisma.PaymentGetPayload<Record<string, never>>[]> {
    return this.prisma.$transaction(async (tx) => {
      let completedAmount = 0;
      for (const outcome of outcomes) {
        if (outcome.outcome === 'completed') {
          const claimed = await tx.payment.updateMany({
            where: { id: outcome.paymentId, status: PaymentStatus.PENDING },
            data: {
              status: PaymentStatus.COMPLETED,
              gatewayRef: outcome.gatewayRef,
              gatewayData: outcome.gatewayData,
              processedAt: new Date(),
            },
          });
          if (claimed.count === 1) {
            const payment = createdPayments.find((p) => p.id === outcome.paymentId);
            completedAmount += payment ? Number(payment.amount) : 0;
          }
        } else if (outcome.outcome === 'failed') {
          await tx.payment.updateMany({
            where: { id: outcome.paymentId, status: PaymentStatus.PENDING },
            data: {
              status: PaymentStatus.FAILED,
              gatewayRef: outcome.gatewayRef,
              gatewayData: outcome.gatewayData,
            },
          });
        } else {
          await tx.payment.updateMany({
            where: { id: outcome.paymentId, status: PaymentStatus.PENDING },
            data: {
              gatewayRef: outcome.gatewayRef,
              gatewayData: outcome.gatewayData,
            },
          });
        }
      }

      if (completedAmount > 0) {
        const fresh = await tx.order.findFirst({
          where: { id: orderId, tenantId, deletedAt: null },
        });
        if (!fresh) throw new NotFoundException('Order not found');
        const verResult = await tx.order.updateMany({
          where: { id: orderId, version: fresh.version },
          data: { version: { increment: 1 } },
        });
        if (verResult.count === 0) {
          throw new ConflictException('Order was modified by another user. Please retry.');
        }

        const newTotalPaid = Number(fresh.paidAmount) + completedAmount;
        await tx.order.update({
          where: { id: orderId },
          data: {
            paidAmount: { increment: completedAmount },
            ...(newTotalPaid >= Number(fresh.total)
              ? { status: 'COMPLETED' as OrderStatus, completedAt: new Date() }
              : {}),
          },
        });

        if (newTotalPaid >= Number(fresh.total)) {
          await tx.orderStatusHistory.create({
            data: {
              orderId,
              tenantId,
              fromStatus: fresh.status as OrderStatus,
              toStatus: 'COMPLETED' as OrderStatus,
              changedByUserId: userId,
              reason: 'Split payment completed',
            },
          });
        }
      }

      const finalizedIds = outcomes.map((o) => o.paymentId);
      const finalizedRows = await tx.payment.findMany({
        where: { id: { in: finalizedIds } },
      });
      return [...createdPayments.filter((p) => !finalizedIds.includes(p.id)), ...finalizedRows];
    });
  }

  async findAll(
    tenantId: string,
    query: ReconcileQueryDto,
  ): Promise<{
    data: PaymentResponseDto[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const where: Prisma.PaymentWhereInput = { tenantId };

    if (query.fromDate || query.toDate) {
      where.createdAt = {
        ...(query.fromDate ? { gte: new Date(query.fromDate) } : {}),
        ...(query.toDate ? { lte: new Date(query.toDate) } : {}),
      };
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.method) {
      where.method = query.method;
    }

    const [data, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        include: { order: { select: { id: true, orderNumber: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.payment.count({ where }),
    ]);

    return {
      data: data.map((p) => this.toResponseDto(p)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string, tenantId: string): Promise<PaymentResponseDto> {
    const payment = await this.prisma.payment.findFirst({
      where: { id, tenantId },
      include: {
        order: {
          select: { id: true, orderNumber: true, status: true, total: true, paidAmount: true },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    return this.toResponseDto(payment);
  }

  async reconcile(
    tenantId: string,
    fromDate: string,
    toDate: string,
  ): Promise<{ localPayments: number; providerMatches: number; mismatches: number }> {
    const payments = await this.prisma.payment.findMany({
      where: {
        tenantId,
        createdAt: {
          gte: new Date(fromDate),
          lte: new Date(toDate),
        },
      },
    });

    let providerMatches = 0;
    let mismatches = 0;

    for (const payment of payments) {
      if (!payment.gatewayRef) {
        providerMatches += 1;
        continue;
      }
      const provider = this.getProviderForMethod(payment.method);
      if (!provider || provider.mode === 'mock') {
        providerMatches += 1;
        continue;
      }
      try {
        const statusResult = await provider.getPaymentStatus(payment.gatewayRef);
        const localStatus = payment.status;
        const providerStatus = statusResult.data?.status;
        const isConsistent =
          providerStatus === 'succeeded'
            ? localStatus === PaymentStatus.COMPLETED
            : providerStatus === 'failed'
              ? localStatus === PaymentStatus.FAILED || localStatus === PaymentStatus.PENDING
              : true;
        if (statusResult.success && isConsistent) {
          providerMatches += 1;
        } else {
          mismatches += 1;
        }
      } catch {
        mismatches += 1;
      }
    }

    return {
      localPayments: payments.length,
      providerMatches,
      mismatches,
    };
  }

  /**
   * P1-02: Automatic reconciliation of payments stuck in PENDING.
   *
   * Gateway lookups (network I/O) happen strictly OUTSIDE any database
   * transaction. Only the outcome decided from the gateway response is written
   * inside a CAS-guarded transaction (reusing finalizeSucceededPayment), so a
   * concurrent webhook/charge finalization can never double-credit an order.
   *
   * Safe rules:
   * - gateway 'succeeded' + amount match  -> credit order (CAS on PENDING row)
   * - gateway 'succeeded' + amount mismatch -> DO NOT credit; leave PENDING and
   *   record the discrepancy so an operator can investigate
   * - gateway 'failed'                    -> mark FAILED
   * - gateway 'pending'/'processing'      -> leave PENDING, record attempt
   * - network/timeout/unknown             -> DO NOT auto-fail; leave PENDING and
   *   record attempt (retried on the next scheduled run)
   */
  async reconcilePendingPayments(options?: { max?: number; staleAfterMs?: number }): Promise<{
    scanned: number;
    completed: number;
    failed: number;
    mismatched: number;
    keptPending: number;
    errored: number;
  }> {
    const staleAfterMs = options?.staleAfterMs ?? 15 * 60 * 1000;
    const max = options?.max ?? 50;
    const cutoff = new Date(Date.now() - staleAfterMs);

    const candidates = await this.prisma.payment.findMany({
      where: {
        status: PaymentStatus.PENDING,
        createdAt: { lte: cutoff },
        gatewayRef: { not: null },
      },
      orderBy: { createdAt: 'asc' },
      take: max,
    });

    const summary = {
      scanned: candidates.length,
      completed: 0,
      failed: 0,
      mismatched: 0,
      keptPending: 0,
      errored: 0,
    };

    for (const payment of candidates) {
      const outcome = await this.resolvePendingPayment(payment);
      if (outcome === 'completed') summary.completed += 1;
      else if (outcome === 'failed') summary.failed += 1;
      else if (outcome === 'mismatched') summary.mismatched += 1;
      else if (outcome === 'errored') summary.errored += 1;
      else summary.keptPending += 1;
    }

    return summary;
  }

  private async resolvePendingPayment(
    payment: Prisma.PaymentGetPayload<Record<string, never>>,
  ): Promise<'completed' | 'failed' | 'mismatched' | 'errored' | 'kept'> {
    const provider = this.getProviderForMethod(payment.method);
    if (!provider || provider.mode === 'mock') {
      return 'kept';
    }

    let statusResult: Awaited<ReturnType<PaymentProvider['getPaymentStatus']>>;
    try {
      statusResult = await provider.getPaymentStatus(payment.gatewayRef as string);
    } catch (error) {
      this.logger.warn(
        `[Reconcile] status lookup error for payment ${payment.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.recordReconcileAttempt(payment.id, 'status-lookup-error');
      return 'errored';
    }

    if (!statusResult || !statusResult.success || !statusResult.data) {
      await this.recordReconcileAttempt(
        payment.id,
        statusResult?.error ? String(statusResult.error) : 'unknown-error',
      );
      return 'errored';
    }

    const gatewayStatus = statusResult.data.status;

    if (gatewayStatus === 'succeeded') {
      const expectedCents = Math.round(Number(payment.amount) * 100);
      const actualCents = this.gatewayAmountCents(Number(statusResult.data.amount ?? 0));
      if (Math.abs(actualCents - expectedCents) > 1) {
        this.logger.warn(
          `[Reconcile] amount mismatch for payment ${payment.id}: expected ${expectedCents} cents, gateway reports ${actualCents} cents`,
        );
        await this.auditLogsService.log({
          action: 'PAYMENT_RECONCILE_MISMATCH',
          resource: 'Payment',
          resourceId: payment.id,
          userId: 'system',
          tenantId: payment.tenantId,
          newValues: {
            expectedCents,
            gatewayCents: actualCents,
            gatewayRef: payment.gatewayRef,
          },
        });
        await this.recordReconcileAttempt(payment.id, 'amount-mismatch');
        return 'mismatched';
      }
      return this.resolveSucceededPayment(payment);
    }

    if (gatewayStatus === 'failed') {
      const claimed = await this.prisma.payment.updateMany({
        where: { id: payment.id, status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.FAILED },
      });
      if (claimed.count === 0) {
        return 'kept';
      }
      await this.auditLogsService.log({
        action: 'PAYMENT_RECONCILE_FAILED',
        resource: 'Payment',
        resourceId: payment.id,
        userId: 'system',
        tenantId: payment.tenantId,
        newValues: {
          status: PaymentStatus.FAILED,
          gatewayStatus,
          gatewayRef: payment.gatewayRef,
        },
      });
      this.metricsService.incrementPaymentsFailed();
      this.eventEmitter.emit('payments.failed', {
        tenantId: payment.tenantId,
        orderId: payment.orderId,
        paymentId: payment.id,
      });
      return 'failed';
    }

    await this.recordReconcileAttempt(payment.id, `gateway-status:${gatewayStatus}`);
    return 'kept';
  }

  private async resolveSucceededPayment(
    payment: Prisma.PaymentGetPayload<Record<string, never>>,
  ): Promise<'completed' | 'errored' | 'kept'> {
    const order = await this.prisma.order.findFirst({
      where: { id: payment.orderId, tenantId: payment.tenantId, deletedAt: null },
    });
    if (!order) {
      this.logger.warn(
        `[Reconcile] order ${payment.orderId} not found for payment ${payment.id}; not crediting`,
      );
      await this.recordReconcileAttempt(payment.id, 'order-not-found');
      return 'errored';
    }

    try {
      await this.prisma.$transaction((tx) =>
        this.finalizeSucceededPayment(
          tx,
          order.id,
          order.tenantId,
          order.status as OrderStatus,
          payment.id,
          Number(payment.amount),
          Number(payment.tip),
          payment.gatewayRef,
          payment.gatewayData as Prisma.InputJsonValue,
          'system',
        ),
      );
    } catch (error) {
      if (error instanceof PaymentAlreadyFinalizedError) {
        this.logger.warn(
          `[Reconcile] payment ${payment.id} already finalized concurrently; skipping`,
        );
        return 'kept';
      }
      if (error instanceof ConflictException || error instanceof NotFoundException) {
        this.logger.warn(
          `[Reconcile] could not finalize payment ${payment.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        await this.recordReconcileAttempt(payment.id, 'finalize-conflict');
        return 'kept';
      }
      throw error;
    }

    await this.auditLogsService.log({
      action: 'PAYMENT_RECONCILE_COMPLETED',
      resource: 'Payment',
      resourceId: payment.id,
      userId: 'system',
      tenantId: payment.tenantId,
      newValues: { status: PaymentStatus.COMPLETED, gatewayRef: payment.gatewayRef },
    });
    this.metricsService.incrementPaymentsCompleted();
    if (Number(order.paidAmount) + Number(payment.amount) >= Number(order.total)) {
      this.metricsService.incrementOrdersCompleted();
    }
    this.metricsService.addRevenue(Math.round(Number(payment.amount) * 100));
    this.eventEmitter.emit('payments.completed', {
      tenantId: payment.tenantId,
      orderId: payment.orderId,
      paymentId: payment.id,
    });
    return 'completed';
  }

  /**
   * Every PaymentProvider reports `getPaymentStatus().amount` in major units
   * (e.g. 50.00) and `parseWebhookEvent()` already normalised both providers
   * that way. Local payment amounts are major units too, so the only
   * conversion left is major -> cents for the reconciliation comparison.
   */
  private gatewayAmountCents(amount: number): number {
    return Math.round(amount * 100);
  }

  private async recordReconcileAttempt(paymentId: string, note: string): Promise<void> {
    try {
      const current = await this.prisma.payment.findUnique({
        where: { id: paymentId },
        select: { gatewayData: true },
      });
      const base =
        current?.gatewayData &&
        typeof current.gatewayData === 'object' &&
        !Array.isArray(current.gatewayData)
          ? (current.gatewayData as Record<string, unknown>)
          : {};
      const attempts = typeof base.reconcileAttempts === 'number' ? base.reconcileAttempts : 0;
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: {
          gatewayData: {
            ...base,
            reconcileAttempts: attempts + 1,
            lastReconcileAt: new Date().toISOString(),
            lastReconcileNote: note,
          } as Prisma.InputJsonObject,
        },
      });
    } catch (error) {
      this.logger.warn(
        `[Reconcile] failed to record attempt for payment ${paymentId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async getProviderForTenant(_tenantId: string): Promise<ProviderLike | null> {
    return this.providerRegistry.get('stripe') || null;
  }

  async getPaymentStatus(
    providerRef: string,
  ): Promise<{ status: string; amount: number; currency: string }> {
    const provider = this.providerRegistry.get('stripe');
    if (!provider) {
      throw new BadRequestException('No payment provider available');
    }
    const result = await provider.getPaymentStatus(providerRef);
    if (!result.success || !result.data) {
      throw new BadRequestException(result.error || 'Failed to get payment status');
    }
    return result.data;
  }

  async handleGatewayWebhook(
    providerType: IntegrationProviderType,
    rawBody: string,
    signature: string,
  ): Promise<{ received: boolean; type?: string }> {
    const provider = this.providerRegistry.get(providerType);
    if (!provider) {
      throw new BadRequestException('Unknown payment provider');
    }

    if (!provider.verifyWebhookSignature(rawBody, signature)) {
      throw new BadRequestException('Invalid webhook signature');
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw new BadRequestException('Invalid webhook payload');
    }

    const event = provider.parseWebhookEvent(payload);
    if (!event) {
      return { received: true };
    }

    switch (event.type) {
      case 'payment.succeeded':
        await this.applyWebhookSucceeded(event.reference, event.amount);
        break;
      case 'payment.failed':
        await this.applyWebhookFailed(event.reference);
        break;
      case 'refund.succeeded':
      case 'refund.partial':
        await this.applyWebhookRefunded(
          event.reference,
          event.refundedAmount,
          event.refundedAmountIsTotal,
        );
        break;
    }

    return { received: true, type: event.type };
  }

  private async applyWebhookSucceeded(reference: string, amount?: number): Promise<void> {
    const payment = await this.prisma.payment.findFirst({
      where: { gatewayRef: reference },
    });
    if (!payment) {
      this.logger.warn(`Webhook payment.succeeded: no payment for gatewayRef ${reference}`);
      return;
    }
    if (payment.status !== PaymentStatus.PENDING) {
      return;
    }

    const order = await this.prisma.order.findUnique({
      where: { id: payment.orderId },
    });
    if (!order) {
      this.logger.warn(`Webhook payment.succeeded: order ${payment.orderId} not found`);
      return;
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.payment.updateMany({
          where: { id: payment.id, status: PaymentStatus.PENDING },
          data: { status: PaymentStatus.COMPLETED, processedAt: new Date() },
        });
        if (claimed.count === 0) {
          throw new PaymentAlreadyFinalizedError();
        }
        const fresh = await tx.order.findFirst({
          where: { id: payment.orderId, tenantId: payment.tenantId, deletedAt: null },
        });
        if (!fresh) {
          throw new NotFoundException('Order not found');
        }
        const verResult = await tx.order.updateMany({
          where: { id: payment.orderId, version: fresh.version },
          data: { version: { increment: 1 } },
        });
        if (verResult.count === 0) {
          throw new ConflictException('Order was modified by another user. Please retry.');
        }
        const credited = amount && amount > 0 ? amount : Number(payment.amount);
        const expectedAmount = Number(payment.amount);
        if (Math.abs(credited - expectedAmount) > 0.02) {
          throw new PaymentAmountMismatchError(expectedAmount.toFixed(2), credited.toFixed(2));
        }
        const newTotalPaid = Number(fresh.paidAmount) + credited;
        const orderTotal = Number(fresh.total);

        await tx.order.update({
          where: { id: payment.orderId },
          data: {
            paidAmount: newTotalPaid,
            tip: { increment: Number(payment.tip || 0) },
            ...(newTotalPaid >= orderTotal
              ? { status: 'COMPLETED' as OrderStatus, completedAt: new Date() }
              : {}),
          },
        });

        if (newTotalPaid >= orderTotal) {
          await tx.orderStatusHistory.create({
            data: {
              orderId: payment.orderId,
              tenantId: payment.tenantId,
              fromStatus: order.status as OrderStatus,
              toStatus: 'COMPLETED' as OrderStatus,
              changedBy: 'system',
              changedByUserId: null,
              reason: 'Payment confirmed via gateway webhook',
            },
          });
        }
      });
    } catch (error) {
      if (error instanceof PaymentAlreadyFinalizedError) {
        this.logger.warn(
          `Webhook payment.succeeded: payment ${payment.id} already finalized; skipping`,
        );
        return;
      }
      if (error instanceof PaymentAmountMismatchError) {
        this.logger.error(`Webhook payment.succeeded: ${error.message}; refusing to credit`);
        await this.recordReconcileAttempt(payment.id, error.message);
        return;
      }
      throw error;
    }

    this.metricsService.incrementPaymentsCompleted();
    this.metricsService.incrementOrdersCompleted();
    this.metricsService.addRevenue(Math.round(Number(payment.amount) * 100));
    this.eventEmitter.emit('payments.completed', {
      tenantId: payment.tenantId,
      orderId: payment.orderId,
      paymentId: payment.id,
    });
  }

  private async applyWebhookFailed(reference: string): Promise<void> {
    const payment = await this.prisma.payment.findFirst({
      where: { gatewayRef: reference },
    });
    if (!payment || payment.status !== PaymentStatus.PENDING) {
      return;
    }
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.FAILED },
    });
    this.metricsService.incrementPaymentsFailed();
    this.eventEmitter.emit('payments.failed', {
      tenantId: payment.tenantId,
      orderId: payment.orderId,
      paymentId: payment.id,
    });
  }

  private async applyWebhookRefunded(
    reference: string,
    refundedAmount?: number,
    refundedAmountIsTotal = false,
  ): Promise<void> {
    const payment = await this.prisma.payment.findFirst({
      where: { gatewayRef: reference },
    });
    if (!payment) {
      this.logger.warn(`Webhook refund: no payment for gatewayRef ${reference}`);
      return;
    }
    if (!isRefundableStatus(payment.status)) {
      this.logger.warn(
        `Webhook refund: payment ${payment.id} not refundable (status ${payment.status}); skipping`,
      );
      return;
    }

    const paymentAmount = Number(payment.amount);
    const alreadyRefunded = Number(payment.amountRefunded ?? 0);
    const reported = refundedAmount && refundedAmount > 0 ? refundedAmount : paymentAmount;
    const newTotalRefunded = refundedAmountIsTotal
      ? Math.min(reported, paymentAmount)
      : Math.min(alreadyRefunded + reported, paymentAmount);
    const delta = newTotalRefunded - alreadyRefunded;
    if (delta <= 0) {
      this.logger.warn(
        `Webhook refund: payment ${payment.id} already refunded (amountRefunded ${alreadyRefunded}); skipping`,
      );
      return;
    }
    const isFull = newTotalRefunded >= paymentAmount;

    let claimedCount = 0;
    let orderRefunded = false;
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.payment.updateMany({
        where: {
          id: payment.id,
          status: { in: [PaymentStatus.COMPLETED, PaymentStatus.PARTIALLY_REFUNDED] },
          amountRefunded: alreadyRefunded,
        },
        data: {
          status: isFull ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED,
          amountRefunded: newTotalRefunded,
          refundedAt: new Date(),
          refundReason: 'Gateway refund',
        },
      });
      claimedCount = claimed.count;
      if (claimed.count === 0) {
        return;
      }
      const freshOrder = await tx.order.findFirst({
        where: { id: payment.orderId, tenantId: payment.tenantId, deletedAt: null },
      });
      if (!freshOrder) {
        throw new NotFoundException(
          `Webhook refund: order ${payment.orderId} not found for payment ${payment.id}`,
        );
      }
      const orderVerResult = await tx.order.updateMany({
        where: { id: payment.orderId, version: freshOrder.version },
        data: { version: { increment: 1 } },
      });
      if (orderVerResult.count === 0) {
        throw new ConflictException('Order was modified by another user. Please retry.');
      }

      // Only a cumulative full refund retires the order, and only when the state machine
      // permits it. A partial gateway refund must leave the order status untouched (same
      // rule as partialRefund()).
      const shouldRefundOrder =
        isFull && canTransition(String(freshOrder.status), OrderStatus.REFUNDED);
      await tx.order.update({
        where: { id: payment.orderId },
        data: {
          paidAmount: { decrement: delta },
          tip: { decrement: isFull ? Number(payment.tip || 0) : 0 },
          ...(shouldRefundOrder ? { status: OrderStatus.REFUNDED } : {}),
        },
      });
      if (shouldRefundOrder) {
        await tx.orderStatusHistory.create({
          data: {
            orderId: payment.orderId,
            tenantId: payment.tenantId,
            fromStatus: freshOrder.status as PrismaOrderStatus,
            toStatus: OrderStatus.REFUNDED as PrismaOrderStatus,
            changedByUserId: null,
            reason: 'Gateway refund (full)',
          },
        });
        orderRefunded = true;
      }
    });

    if (claimedCount === 0) {
      this.logger.warn(
        `Webhook refund: payment ${payment.id} could not be claimed (concurrent refund or replay); skipping`,
      );
      return;
    }

    this.metricsService.incrementPaymentsRefunded();
    this.eventEmitter.emit('payments.refunded', {
      tenantId: payment.tenantId,
      orderId: payment.orderId,
      paymentId: payment.id,
      amount: delta,
      amountRefunded: newTotalRefunded,
    });

    if (orderRefunded) {
      this.eventEmitter.emit('order.refunded', {
        tenantId: payment.tenantId,
        orderId: payment.orderId,
        paymentId: payment.id,
      });
    }
  }

  private getProviderForMethod(method: PaymentMethod): ProviderLike | null {
    if (method === PaymentMethod.CREDIT_CARD || method === PaymentMethod.DEBIT_CARD) {
      return this.providerRegistry.get('stripe') || null;
    }
    if (method === PaymentMethod.MOBILE_PAYMENT) {
      return this.providerRegistry.get('paymob') || null;
    }
    return null;
  }

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  private toResponseDto(
    payment:
      | Prisma.PaymentGetPayload<Record<string, never>>
      | (Prisma.PaymentGetPayload<Record<string, never>> & Record<string, unknown>),
  ): PaymentResponseDto {
    const clientSecret =
      payment.status === PaymentStatus.PENDING
        ? this.extractClientSecret(payment.gatewayData)
        : undefined;

    return {
      id: payment.id,
      orderId: payment.orderId,
      tenantId: payment.tenantId,
      method: payment.method,
      status: payment.status,
      clientSecret,
      amount: Number(payment.amount),
      tip: Number(payment.tip),
      reference: payment.reference,
      gatewayRef: payment.gatewayRef,
      processedAt: payment.processedAt,
      refundedAt: payment.refundedAt,
      refundReason: payment.refundReason,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
    };
  }

  private extractClientSecret(
    gatewayData: Prisma.JsonValue | null | undefined,
  ): string | undefined {
    if (!gatewayData || typeof gatewayData !== 'object' || Array.isArray(gatewayData)) {
      return undefined;
    }
    const secret = (gatewayData as { clientSecret?: unknown }).clientSecret;
    return typeof secret === 'string' && secret.length > 0 ? secret : undefined;
  }
}
