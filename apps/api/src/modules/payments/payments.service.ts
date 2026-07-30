import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
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
import { IntegrationProviderType } from '@tablofy/shared/types';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly providerRegistry = new Map<
    IntegrationProviderType,
    StripeProvider | PaymobProvider
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly metricsService: MetricsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly stripeProvider: StripeProvider,
    private readonly paymobProvider: PaymobProvider,
  ) {
    this.providerRegistry.set('stripe', this.stripeProvider);
    this.providerRegistry.set('paymob', this.paymobProvider);
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

    const result = await this.prisma.$transaction(async (tx) => {
      const verResult = await tx.order.updateMany({
        where: { id: orderId, version: order.version },
        data: { version: { increment: 1 } },
      });
      if (verResult.count === 0) {
        throw new ConflictException('Order was modified by another user. Please retry.');
      }

      const payment = await tx.payment.create({
        data: {
          orderId,
          tenantId,
          method: dto.method,
          amount: dto.amount,
          tip: dto.tip || 0,
          reference: dto.reference || null,
          status: PaymentStatus.PENDING,
        },
      });

      const provider = this.getProviderForMethod(dto.method);
      if (provider) {
        try {
          const providerResult = await provider.createPaymentIntent({
            amount: Math.round(dto.amount * 100),
            currency: 'usd',
            description: `Payment for order ${order.orderNumber}`,
          });

          if (providerResult.success && providerResult.data) {
            const confirmResult = await provider.confirmPayment(providerResult.data.id);

            const updatedStatus = confirmResult.success
              ? PaymentStatus.COMPLETED
              : PaymentStatus.FAILED;

            await tx.payment.update({
              where: { id: payment.id },
              data: {
                status: updatedStatus,
                gatewayRef: confirmResult.data?.transactionId || null,
                gatewayData: providerResult.data as unknown as Prisma.InputJsonValue,
                processedAt: confirmResult.success ? new Date() : null,
              },
            });

            if (confirmResult.success) {
              await tx.order.update({
                where: { id: orderId },
                data: {
                  paidAmount: totalPaid,
                  tip: { increment: dto.tip || 0 },
                  ...(totalPaid >= orderTotal
                    ? { status: 'COMPLETED', completedAt: new Date() }
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
            }

            return tx.payment.findUnique({ where: { id: payment.id } });
          }
        } catch {
          await tx.payment.update({
            where: { id: payment.id },
            data: { status: PaymentStatus.FAILED },
          });

          return tx.payment.findUnique({ where: { id: payment.id } });
        }
      }

      await tx.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.COMPLETED, processedAt: new Date() },
      });

      await tx.order.update({
        where: { id: orderId },
        data: {
          paidAmount: totalPaid,
          tip: { increment: dto.tip || 0 },
          ...(totalPaid >= orderTotal ? { status: 'COMPLETED', completedAt: new Date() } : {}),
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

      return tx.payment.findUnique({ where: { id: payment.id } });
    });

    const paymentResult = result!;

    await this.auditLogsService.log({
      action: 'PAYMENT_ADDED',
      resource: 'Payment',
      resourceId: paymentResult.id,
      userId,
      tenantId,
      newValues: { method: dto.method, amount: dto.amount, tip: dto.tip },
    });

    if (paymentResult.status === PaymentStatus.COMPLETED) {
      this.metricsService.incrementPaymentsCompleted();
      this.metricsService.incrementOrdersCompleted();
      this.metricsService.addRevenue(Math.round(Number(paymentResult.amount) * 100));
      this.eventEmitter.emit('payments.completed', {
        tenantId,
        orderId,
        paymentId: paymentResult.id,
      });
    } else if (paymentResult.status === PaymentStatus.FAILED) {
      this.metricsService.incrementPaymentsFailed();
      this.eventEmitter.emit('payments.failed', {
        tenantId,
        orderId,
        paymentId: paymentResult.id,
      });
    }

    return this.toResponseDto(paymentResult);
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

      for (const split of dto.splits) {
        const payment = await tx.payment.create({
          data: {
            orderId,
            tenantId,
            method: split.method,
            amount: split.amount,
            tip: split.tip || 0,
            status: PaymentStatus.COMPLETED,
            processedAt: new Date(),
          },
        });
        createdPayments.push(payment);
      }

      const newTotalPaid = Number(order.paidAmount) + totalSplitAmount;
      await tx.order.update({
        where: { id: orderId },
        data: {
          paidAmount: newTotalPaid,
          ...(newTotalPaid >= Number(order.total)
            ? { status: 'COMPLETED', completedAt: new Date() }
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

      return createdPayments;
    });

    for (const payment of results) {
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

    return {
      localPayments: payments.length,
      providerMatches: payments.length,
      mismatches: 0,
    };
  }

  async getProviderForTenant(_tenantId: string): Promise<StripeProvider | PaymobProvider | null> {
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

  private getProviderForMethod(method: PaymentMethod): StripeProvider | PaymobProvider | null {
    if (method === PaymentMethod.CREDIT_CARD || method === PaymentMethod.DEBIT_CARD) {
      return this.providerRegistry.get('stripe') || null;
    }
    if (method === PaymentMethod.MOBILE_PAYMENT) {
      return this.providerRegistry.get('paymob') || null;
    }
    return null;
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
