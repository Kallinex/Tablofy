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
import { Prisma, PaymentStatus, PaymentMethod, OrderStatus } from '@prisma/client';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PartialRefundDto } from './dto/partial-refund.dto';
import { VoidPaymentDto } from './dto/void-payment.dto';
import { SplitPaymentDto } from './dto/split-payment.dto';
import { ReconcileQueryDto } from './dto/reconcile-query.dto';
import { PaymentResponseDto } from './dto/payment-response.dto';
import { isRefundableStatus, isVoidableStatus } from './payment-state-machine';
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

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.REFUNDED,
          refundedAt: new Date(),
          refundReason: reason || null,
        },
      });

      await tx.order.update({
        where: { id: payment.orderId },
        data: {
          paidAmount: { decrement: payment.amount },
          tip: { decrement: payment.tip || 0 },
        },
      });

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
    });

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

    if (dto.amount > Number(payment.amount)) {
      throw new BadRequestException('Refund amount exceeds original payment amount');
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

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.PARTIALLY_REFUNDED,
          refundedAt: new Date(),
          refundReason: dto.reason || null,
        },
      });

      await tx.order.update({
        where: { id: payment.orderId },
        data: {
          paidAmount: { decrement: dto.amount },
        },
      });

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

    const results = await this.prisma.$transaction(async (tx) => {
      const createdPayments: Prisma.PaymentGetPayload<Record<string, never>>[] = [];
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
            idempotencyKey,
            status: PaymentStatus.PENDING,
          },
        });

        if (!provider) {
          payment = await tx.payment.update({
            where: { id: payment.id },
            data: { status: PaymentStatus.COMPLETED, processedAt: new Date() },
          });
          completedAmount += split.amount;
          createdPayments.push(payment);
          continue;
        }

        this.assertNotMockInProduction(provider);
        const intentResult = await provider.createPaymentIntent(
          {
            amount: Math.round(split.amount * 100),
            currency: 'usd',
            description: `Split payment for order ${order.orderNumber}`,
            metadata: { orderId, tenantId, paymentId: payment.id },
          },
          idempotencyKey,
        );

        if (!this.isProviderSuccess(intentResult)) {
          payment = await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: PaymentStatus.FAILED,
              gatewayData: { error: intentResult?.error ?? 'Gateway rejected payment' },
            },
          });
          createdPayments.push(payment);
          continue;
        }

        const confirmResult = await provider.confirmPayment(intentResult.data.id, idempotencyKey);

        if (confirmResult.success && confirmResult.data?.status === 'succeeded') {
          const claimed = await tx.payment.updateMany({
            where: { id: payment.id, status: PaymentStatus.PENDING },
            data: {
              status: PaymentStatus.COMPLETED,
              gatewayRef: confirmResult.data.transactionId ?? intentResult.data.id,
              gatewayData: intentResult.data as unknown as Prisma.InputJsonValue,
              processedAt: new Date(),
            },
          });
          if (claimed.count === 1) {
            completedAmount += split.amount;
          }
          const finalized = await tx.payment.findUnique({ where: { id: payment.id } });
          if (finalized) {
            payment = finalized;
          }
        } else if (confirmResult.success && confirmResult.data?.status === 'failed') {
          payment = await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: PaymentStatus.FAILED,
              gatewayRef: intentResult.data.id,
              gatewayData: intentResult.data as unknown as Prisma.InputJsonValue,
            },
          });
        } else if (confirmResult.success) {
          payment = await tx.payment.update({
            where: { id: payment.id },
            data: {
              gatewayRef: intentResult.data.id,
              gatewayData: intentResult.data as unknown as Prisma.InputJsonValue,
            },
          });
        } else {
          payment = await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: PaymentStatus.FAILED,
              gatewayRef: intentResult.data.id,
              gatewayData: {
                error: confirmResult.error ?? 'Gateway confirmation failed',
                intent: intentResult.data,
              },
            },
          });
        }
        createdPayments.push(payment);
      }

      if (completedAmount > 0) {
        const newTotalPaid = Number(order.paidAmount) + completedAmount;
        await tx.order.update({
          where: { id: orderId },
          data: {
            paidAmount: newTotalPaid,
            ...(newTotalPaid >= Number(order.total)
              ? { status: 'COMPLETED' as OrderStatus, completedAt: new Date() }
              : {}),
          },
        });

        if (newTotalPaid >= Number(order.total)) {
          await tx.orderStatusHistory.create({
            data: {
              orderId,
              tenantId,
              fromStatus: order.status as OrderStatus,
              toStatus: 'COMPLETED' as OrderStatus,
              changedByUserId: userId,
              reason: 'Split payment completed',
            },
          });
        }
      }

      return createdPayments;
    });

    for (const payment of results) {
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

    return results.map((p) => this.toResponseDto(p));
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
        await this.applyWebhookRefunded(event.reference, event.refundedAmount);
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
              changedByUserId: 'system',
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

  private async applyWebhookRefunded(reference: string, refundedAmount?: number): Promise<void> {
    const payment = await this.prisma.payment.findFirst({
      where: { gatewayRef: reference },
    });
    if (!payment || payment.status !== PaymentStatus.COMPLETED) {
      return;
    }
    const refunded = refundedAmount && refundedAmount > 0 ? refundedAmount : Number(payment.amount);
    const isFull = refunded >= Number(payment.amount);

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: isFull ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED,
          refundedAt: new Date(),
          refundReason: 'Gateway refund',
        },
      });
      await tx.order.update({
        where: { id: payment.orderId },
        data: {
          paidAmount: { decrement: refunded },
          tip: { decrement: isFull ? Number(payment.tip || 0) : 0 },
        },
      });
    });

    this.metricsService.incrementPaymentsRefunded();
    this.eventEmitter.emit('payments.refunded', {
      tenantId: payment.tenantId,
      orderId: payment.orderId,
      paymentId: payment.id,
    });
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
    return {
      id: payment.id,
      orderId: payment.orderId,
      tenantId: payment.tenantId,
      method: payment.method,
      status: payment.status,
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
}
