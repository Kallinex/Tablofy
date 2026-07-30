import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsService } from '../payments.service';
import { StripeProvider } from '../providers/stripe.provider';
import { PaymobProvider } from '../providers/paymob.provider';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { MetricsService } from '../../../common/metrics/metrics.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PaymentStatus, PaymentMethod } from '@prisma/client';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { CreatePaymentDto } from '../dto/create-payment.dto';
import { PartialRefundDto } from '../dto/partial-refund.dto';
import { VoidPaymentDto } from '../dto/void-payment.dto';
import { SplitPaymentDto } from '../dto/split-payment.dto';

describe('PaymentsService', () => {
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

  const mockPayment = {
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

  describe('charge', () => {
    it('should successfully process a payment', async () => {
      prisma.order.findFirst.mockResolvedValue(mockOrder);
      prisma.$transaction.mockImplementation(
        async (cb: (tx: Record<string, unknown>) => unknown) => {
          const tx = {
            order: {
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              update: jest.fn().mockResolvedValue({}),
            },
            payment: {
              create: jest.fn().mockResolvedValue(mockPayment),
              update: jest.fn().mockResolvedValue(mockPayment),
              findUnique: jest.fn().mockResolvedValue(mockPayment),
            },
            orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
          };
          return cb(tx);
        },
      );

      const dto: CreatePaymentDto = {
        orderId: 'order-1',
        method: PaymentMethod.CASH,
        amount: 50,
        tip: 5,
      };

      const result = await service.charge('order-1', dto, 'tenant-1', 'user-1');
      expect(result.status).toBe(PaymentStatus.COMPLETED);
      expect(metrics.incrementPaymentsCompleted).toHaveBeenCalled();
    });

    it('should reject non-payable order status', async () => {
      prisma.order.findFirst.mockResolvedValue({ ...mockOrder, status: 'DRAFT' });

      const dto: CreatePaymentDto = {
        orderId: 'order-1',
        method: PaymentMethod.CASH,
        amount: 50,
      };

      await expect(service.charge('order-1', dto, 'tenant-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject amount exceeding balance', async () => {
      prisma.order.findFirst.mockResolvedValue(mockOrder);

      const dto: CreatePaymentDto = {
        orderId: 'order-1',
        method: PaymentMethod.CASH,
        amount: 150,
      };

      await expect(service.charge('order-1', dto, 'tenant-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should handle order not found', async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      const dto: CreatePaymentDto = {
        orderId: 'order-1',
        method: PaymentMethod.CASH,
        amount: 50,
      };

      await expect(service.charge('order-1', dto, 'tenant-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should auto-complete order on full payment', async () => {
      prisma.order.findFirst.mockResolvedValue(mockOrder);
      prisma.$transaction.mockImplementation(
        async (cb: (tx: Record<string, unknown>) => unknown) => {
          const tx = {
            order: {
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              update: jest.fn().mockResolvedValue({}),
            },
            payment: {
              create: jest.fn().mockResolvedValue({ ...mockPayment, amount: 100 }),
              update: jest.fn().mockResolvedValue({ ...mockPayment, amount: 100 }),
              findUnique: jest.fn().mockResolvedValue({ ...mockPayment, amount: 100 }),
            },
            orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
          };
          return cb(tx);
        },
      );

      const dto: CreatePaymentDto = {
        orderId: 'order-1',
        method: PaymentMethod.CASH,
        amount: 100,
      };

      const result = await service.charge('order-1', dto, 'tenant-1', 'user-1');
      expect(result).toBeDefined();
      expect(metrics.incrementPaymentsCompleted).toHaveBeenCalled();
    });
  });

  describe('refund', () => {
    it('should process full refund', async () => {
      prisma.payment.findFirst.mockResolvedValue(mockPayment);
      prisma.$transaction.mockImplementation(
        async (cb: (tx: Record<string, unknown>) => unknown) => {
          const tx = {
            payment: {
              update: jest
                .fn()
                .mockResolvedValue({ ...mockPayment, status: PaymentStatus.REFUNDED }),
            },
            order: {
              update: jest.fn().mockResolvedValue({}),
            },
          };
          return cb(tx);
        },
      );

      const result = await service.refund('payment-1', 'tenant-1', 'user-1');
      expect(result.status).toBe(PaymentStatus.REFUNDED);
      expect(metrics.incrementPaymentsRefunded).toHaveBeenCalled();
    });

    it('should reject already refunded payment', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        ...mockPayment,
        status: PaymentStatus.REFUNDED,
      });

      await expect(service.refund('payment-1', 'tenant-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject not-found payment', async () => {
      prisma.payment.findFirst.mockResolvedValue(null);

      await expect(service.refund('payment-1', 'tenant-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('partialRefund', () => {
    it('should process partial refund', async () => {
      prisma.payment.findFirst.mockResolvedValue(mockPayment);
      prisma.$transaction.mockImplementation(
        async (cb: (tx: Record<string, unknown>) => unknown) => {
          const tx = {
            payment: {
              update: jest.fn().mockResolvedValue({
                ...mockPayment,
                status: PaymentStatus.PARTIALLY_REFUNDED,
              }),
            },
            order: {
              update: jest.fn().mockResolvedValue({}),
            },
          };
          return cb(tx);
        },
      );

      const dto: PartialRefundDto = { amount: 20, reason: 'Partial refund' };
      const result = await service.partialRefund('payment-1', dto, 'tenant-1', 'user-1');
      expect(result.status).toBe(PaymentStatus.PARTIALLY_REFUNDED);
    });

    it('should reject amount exceeding original', async () => {
      prisma.payment.findFirst.mockResolvedValue(mockPayment);

      const dto: PartialRefundDto = { amount: 100, reason: 'Too much' };
      await expect(service.partialRefund('payment-1', dto, 'tenant-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('voidPayment', () => {
    it('should void pending payment', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        ...mockPayment,
        status: PaymentStatus.PENDING,
      });
      prisma.payment.update.mockResolvedValue({
        ...mockPayment,
        status: PaymentStatus.FAILED,
      });

      const dto: VoidPaymentDto = { reason: 'Test void' };
      const result = await service.voidPayment('payment-1', dto, 'tenant-1', 'user-1');
      expect(result.status).toBe(PaymentStatus.FAILED);
    });

    it('should reject completed payment void', async () => {
      prisma.payment.findFirst.mockResolvedValue(mockPayment);

      const dto: VoidPaymentDto = { reason: 'Test void' };
      await expect(service.voidPayment('payment-1', dto, 'tenant-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('splitPayment', () => {
    it('should split across methods', async () => {
      prisma.order.findFirst.mockResolvedValue(mockOrder);
      prisma.$transaction.mockImplementation(
        async (cb: (tx: Record<string, unknown>) => unknown) => {
          const tx = {
            payment: {
              create: jest
                .fn()
                .mockResolvedValueOnce({
                  ...mockPayment,
                  id: 'payment-2',
                  method: PaymentMethod.CASH,
                  amount: 30,
                })
                .mockResolvedValueOnce({
                  ...mockPayment,
                  id: 'payment-3',
                  method: PaymentMethod.CREDIT_CARD,
                  amount: 70,
                }),
            },
            order: {
              update: jest.fn().mockResolvedValue({}),
            },
            orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
          };
          return cb(tx);
        },
      );

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

    it('should reject split total exceeding balance', async () => {
      prisma.order.findFirst.mockResolvedValue(mockOrder);

      const dto: SplitPaymentDto = {
        orderId: 'order-1',
        splits: [
          { method: PaymentMethod.CASH, amount: 60 },
          { method: PaymentMethod.CREDIT_CARD, amount: 60 },
        ],
      };

      await expect(service.splitPayment('order-1', dto, 'tenant-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('findAll', () => {
    it('should return paginated payments', async () => {
      prisma.payment.findMany.mockResolvedValue([mockPayment]);
      prisma.payment.count.mockResolvedValue(1);

      const result = await service.findAll('tenant-1', {});
      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    it('should filter by date range', async () => {
      prisma.payment.findMany.mockResolvedValue([mockPayment]);
      prisma.payment.count.mockResolvedValue(1);

      const result = await service.findAll('tenant-1', {
        fromDate: '2025-01-01',
        toDate: '2025-12-31',
      });
      expect(result.data).toHaveLength(1);
    });

    it('should enforce tenant isolation', async () => {
      prisma.payment.findMany.mockResolvedValue([]);
      prisma.payment.count.mockResolvedValue(0);

      const result = await service.findAll('tenant-2', {});
      expect(result.data).toHaveLength(0);
      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: 'tenant-2' }),
        }),
      );
    });
  });

  describe('findOne', () => {
    it('should return payment with relations', async () => {
      prisma.payment.findFirst.mockResolvedValue(mockPayment);

      const result = await service.findOne('payment-1', 'tenant-1');
      expect(result.id).toBe('payment-1');
    });

    it('should enforce tenant isolation', async () => {
      prisma.payment.findFirst.mockResolvedValue(null);

      await expect(service.findOne('payment-1', 'tenant-2')).rejects.toThrow(NotFoundException);
    });
  });

  describe('reconcile', () => {
    it('should return reconciliation report', async () => {
      prisma.payment.findMany.mockResolvedValue([mockPayment]);

      const result = await service.reconcile('tenant-1', '2025-01-01', '2025-12-31');
      expect(result.localPayments).toBe(1);
      expect(result.mismatches).toBe(0);
    });
  });
});
