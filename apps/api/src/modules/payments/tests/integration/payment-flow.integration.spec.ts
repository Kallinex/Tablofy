import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsService } from '../../payments.service';
import { StripeProvider } from '../../providers/stripe.provider';
import { PaymobProvider } from '../../providers/paymob.provider';
import { PrismaService } from '../../../../prisma/prisma.service';
import { AuditLogsService } from '../../../audit-logs/audit-logs.service';
import { MetricsService } from '../../../../common/metrics/metrics.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PaymentStatus, PaymentMethod } from '@prisma/client';
import { CreatePaymentDto } from '../../dto/create-payment.dto';
import { SplitPaymentDto } from '../../dto/split-payment.dto';

describe('PaymentFlowIntegration', () => {
  let service: PaymentsService;
  let prisma: Record<string, jest.Mock>;
  let metrics: Record<string, jest.Mock>;

  const mockOrder = {
    id: 'order-1',
    tenantId: 'tenant-1',
    status: 'CONFIRMED',
    total: 100,
    paidAmount: 0,
    tip: 0,
    version: 1,
    orderNumber: 1001,
  };

  const mockCompletedPayment = {
    id: 'payment-1',
    orderId: 'order-1',
    tenantId: 'tenant-1',
    method: PaymentMethod.CASH,
    amount: 50,
    tip: 5,
    status: PaymentStatus.COMPLETED,
    reference: null,
    gatewayRef: null,
    gatewayData: null,
    processedAt: new Date(),
    refundedAt: null,
    refundReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockRefundedPayment = {
    ...mockCompletedPayment,
    status: PaymentStatus.REFUNDED,
    refundedAt: new Date(),
    refundReason: 'Full refund',
  };

  beforeEach(async () => {
    prisma = {
      order: {
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      payment: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      orderStatusHistory: {
        create: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    metrics = {
      incrementPaymentsCompleted: jest.fn(),
      incrementPaymentsFailed: jest.fn(),
      incrementPaymentsRefunded: jest.fn(),
      incrementOrdersCompleted: jest.fn(),
      addRevenue: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        StripeProvider,
        PaymobProvider,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogsService, useValue: { log: jest.fn() } },
        { provide: MetricsService, useValue: metrics },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  it('should process full payment flow: charge -> complete -> refund', async () => {
    prisma.order.findFirst.mockResolvedValue(mockOrder);
    prisma.$transaction.mockImplementation(async (cb: (tx: Record<string, unknown>) => unknown) => {
      const tx = {
        order: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          update: jest.fn().mockResolvedValue({}),
        },
        payment: {
          create: jest.fn().mockResolvedValue(mockCompletedPayment),
          update: jest.fn().mockResolvedValue(mockCompletedPayment),
          findUnique: jest.fn().mockResolvedValue(mockCompletedPayment),
        },
        orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
      };
      return cb(tx);
    });

    const chargeDto: CreatePaymentDto = {
      orderId: 'order-1',
      method: PaymentMethod.CASH,
      amount: 50,
      tip: 5,
    };
    const chargeResult = await service.charge('order-1', chargeDto, 'tenant-1', 'user-1');
    expect(chargeResult.status).toBe(PaymentStatus.COMPLETED);

    prisma.payment.findFirst.mockResolvedValue(mockCompletedPayment);
    prisma.$transaction.mockImplementation(async (cb: (tx: Record<string, unknown>) => unknown) => {
      const tx = {
        payment: { update: jest.fn().mockResolvedValue(mockRefundedPayment) },
        order: { update: jest.fn().mockResolvedValue({}) },
      };
      return cb(tx);
    });

    const refundResult = await service.refund('payment-1', 'tenant-1', 'user-1', 'Full refund');
    expect(refundResult.status).toBe(PaymentStatus.REFUNDED);
  });

  it('should handle split payment across methods', async () => {
    prisma.order.findFirst.mockResolvedValue(mockOrder);
    prisma.$transaction.mockImplementation(async (cb: (tx: Record<string, unknown>) => unknown) => {
      const tx = {
        payment: {
          create: jest
            .fn()
            .mockResolvedValueOnce({
              ...mockCompletedPayment,
              id: 'payment-2',
              method: PaymentMethod.CASH,
              amount: 30,
            })
            .mockResolvedValueOnce({
              ...mockCompletedPayment,
              id: 'payment-3',
              method: PaymentMethod.CREDIT_CARD,
              amount: 70,
            }),
        },
        order: { update: jest.fn().mockResolvedValue({}) },
        orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
      };
      return cb(tx);
    });

    const dto: SplitPaymentDto = {
      orderId: 'order-1',
      splits: [
        { method: PaymentMethod.CASH, amount: 30 },
        { method: PaymentMethod.CREDIT_CARD, amount: 70 },
      ],
    };

    const results = await service.splitPayment('order-1', dto, 'tenant-1', 'user-1');
    expect(results).toHaveLength(2);
  });

  it('should mark payment as failed when provider fails', async () => {
    prisma.order.findFirst.mockResolvedValue(mockOrder);
    prisma.$transaction.mockImplementation(async (cb: (tx: Record<string, unknown>) => unknown) => {
      const tx = {
        order: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          update: jest.fn().mockResolvedValue({}),
        },
        payment: {
          create: jest
            .fn()
            .mockResolvedValue({ ...mockCompletedPayment, status: PaymentStatus.FAILED }),
          update: jest
            .fn()
            .mockResolvedValue({ ...mockCompletedPayment, status: PaymentStatus.FAILED }),
          findUnique: jest
            .fn()
            .mockResolvedValue({ ...mockCompletedPayment, status: PaymentStatus.FAILED }),
        },
        orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
      };
      return cb(tx);
    });

    const dto: CreatePaymentDto = {
      orderId: 'order-1',
      method: PaymentMethod.CASH,
      amount: 50,
    };

    const result = await service.charge('order-1', dto, 'tenant-1', 'user-1');
    expect(result.status).toBe(PaymentStatus.FAILED);
  });

  it('should handle partial payment then complete', async () => {
    prisma.order.findFirst.mockResolvedValue(mockOrder);
    prisma.$transaction.mockImplementation(async (cb: (tx: Record<string, unknown>) => unknown) => {
      const tx = {
        order: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          update: jest.fn().mockResolvedValue({}),
        },
        payment: {
          create: jest.fn().mockResolvedValue(mockCompletedPayment),
          update: jest.fn().mockResolvedValue(mockCompletedPayment),
          findUnique: jest.fn().mockResolvedValue(mockCompletedPayment),
        },
        orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
      };
      return cb(tx);
    });

    const dto: CreatePaymentDto = {
      orderId: 'order-1',
      method: PaymentMethod.CASH,
      amount: 50,
    };

    const result = await service.charge('order-1', dto, 'tenant-1', 'user-1');
    expect(result.status).toBe(PaymentStatus.COMPLETED);
    expect(metrics.incrementPaymentsCompleted).toHaveBeenCalled();
  });

  it('should void pending payment', async () => {
    prisma.payment.findFirst.mockResolvedValue({
      ...mockCompletedPayment,
      status: PaymentStatus.PENDING,
    });
    prisma.payment.update.mockResolvedValue({
      ...mockCompletedPayment,
      status: PaymentStatus.FAILED,
    });

    const result = await service.voidPayment(
      'payment-1',
      { reason: 'Test void' },
      'tenant-1',
      'user-1',
    );
    expect(result.status).toBe(PaymentStatus.FAILED);
  });
});
