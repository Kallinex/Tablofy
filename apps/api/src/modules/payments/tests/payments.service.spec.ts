import { Test, TestingModule } from '@nestjs/testing';
import { createHmac } from 'crypto';
import { PaymentsService } from '../payments.service';
import { StripeProvider } from '../providers/stripe.provider';
import { PaymobProvider } from '../providers/paymob.provider';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { MetricsService } from '../../../common/metrics/metrics.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PaymentStatus, PaymentMethod, Prisma } from '@prisma/client';
import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
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
    amountRefunded: 0,
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

    it('should reject charge when the order version CAS conflicts (concurrent update)', async () => {
      prisma.order.findFirst.mockResolvedValue(mockOrder);
      prisma.$transaction.mockImplementation(
        async (cb: (tx: Record<string, unknown>) => unknown) => {
          const tx = {
            order: {
              updateMany: jest.fn().mockResolvedValue({ count: 0 }),
              update: jest.fn(),
            },
            payment: { create: jest.fn().mockResolvedValue(mockPayment) },
            orderStatusHistory: { create: jest.fn() },
          };
          return cb(tx);
        },
      );

      const dto: CreatePaymentDto = {
        orderId: 'order-1',
        method: PaymentMethod.CASH,
        amount: 50,
      };

      await expect(service.charge('order-1', dto, 'tenant-1', 'user-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('should replay the existing payment when a unique-violation race surfaces (P2002)', async () => {
      prisma.order.findFirst.mockResolvedValue(mockOrder);
      prisma.$transaction.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed on the fields: (`tenantId`,`idempotencyKey`)',
          {
            code: 'P2002',
            clientVersion: 'test',
            meta: { target: ['tenantId', 'idempotencyKey'] },
          },
        ),
      );
      prisma.payment.findFirst.mockResolvedValue({
        ...mockPayment,
        orderId: 'order-1',
        method: PaymentMethod.CASH,
        status: PaymentStatus.COMPLETED,
        idempotencyKey: 'idem-1',
      });

      const dto: CreatePaymentDto = {
        orderId: 'order-1',
        method: PaymentMethod.CASH,
        amount: 50,
        idempotencyKey: 'idem-1',
      };

      const result = await service.charge('order-1', dto, 'tenant-1', 'user-1');
      expect(result.status).toBe(PaymentStatus.COMPLETED);
      expect(result.orderId).toBe('order-1');
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('should reject a P2002 replay whose idempotency key maps to a different order', async () => {
      prisma.order.findFirst.mockResolvedValue(mockOrder);
      prisma.$transaction.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      prisma.payment.findFirst.mockResolvedValue({
        ...mockPayment,
        orderId: 'order-2',
        idempotencyKey: 'idem-1',
      });

      const dto: CreatePaymentDto = {
        orderId: 'order-1',
        method: PaymentMethod.CASH,
        amount: 50,
        idempotencyKey: 'idem-1',
      };

      await expect(service.charge('order-1', dto, 'tenant-1', 'user-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('refund', () => {
    it('should process full refund', async () => {
      prisma.payment.findFirst.mockResolvedValue(mockPayment);
      prisma.$transaction.mockImplementation(
        async (cb: (tx: Record<string, unknown>) => unknown) => {
          const tx = {
            payment: {
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              findUnique: jest
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

    it('should reject a full refund when a partial refund already exists (D2)', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        ...mockPayment,
        amount: 100,
        amountRefunded: 40,
        status: PaymentStatus.PARTIALLY_REFUNDED,
      });

      await expect(service.refund('payment-1', 'tenant-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should set amountRefunded to the full amount on refund (D2)', async () => {
      prisma.payment.findFirst.mockResolvedValue(mockPayment);
      let updateData: Record<string, unknown> | undefined;
      prisma.$transaction.mockImplementation(
        async (cb: (tx: Record<string, unknown>) => unknown) => {
          const updateMany = jest.fn().mockImplementation(({ data }) => {
            updateData = data;
            return { count: 1 };
          });
          const tx = {
            payment: {
              updateMany,
              findUnique: jest.fn().mockResolvedValue({
                ...mockPayment,
                status: PaymentStatus.REFUNDED,
              }),
            },
            order: { update: jest.fn().mockResolvedValue({}) },
          };
          return cb(tx);
        },
      );

      await service.refund('payment-1', 'tenant-1', 'user-1');

      expect(updateData).toMatchObject({
        status: PaymentStatus.REFUNDED,
        amountRefunded: 50,
      });
    });

    it('should let only one of two concurrent full refunds win the CAS (P1-01)', async () => {
      prisma.payment.findFirst.mockResolvedValue(mockPayment);
      const release: Array<() => void> = [];
      const barrier = new Promise<void>((resolve) => {
        release.push(resolve);
        release.push(resolve);
      });
      let claimCount = 0;
      let updateWhere: Record<string, unknown> | undefined;
      prisma.$transaction.mockImplementation(
        async (cb: (tx: Record<string, unknown>) => unknown) => {
          await barrier;
          const winner = ++claimCount === 1;
          const updateMany = jest.fn().mockImplementation(({ where }) => {
            updateWhere = where;
            return { count: winner ? 1 : 0 };
          });
          const tx = {
            payment: {
              updateMany,
              findUnique: jest.fn().mockResolvedValue({
                ...mockPayment,
                status: PaymentStatus.REFUNDED,
              }),
            },
            order: { update: jest.fn().mockResolvedValue({}) },
          };
          return cb(tx);
        },
      );

      const first = service.refund('payment-1', 'tenant-1', 'user-1');
      const second = service.refund('payment-1', 'tenant-1', 'user-1');
      release.forEach((r) => r());
      const results = await Promise.allSettled([first, second]);

      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      const fulfilled = results.filter((r) => r.status === 'fulfilled');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(ConflictException);
      expect(claimCount).toBe(2);
      expect(updateWhere).toMatchObject({
        id: 'payment-1',
        amountRefunded: 0,
        status: { in: [PaymentStatus.COMPLETED, PaymentStatus.PARTIALLY_REFUNDED] },
      });
    });
  });

  describe('partialRefund', () => {
    it('should process partial refund', async () => {
      prisma.payment.findFirst.mockResolvedValue(mockPayment);
      prisma.$transaction.mockImplementation(
        async (cb: (tx: Record<string, unknown>) => unknown) => {
          const tx = {
            payment: {
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              findUnique: jest.fn().mockResolvedValue({
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

    it('should reject cumulative refund exceeding remaining balance (D2)', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        ...mockPayment,
        amount: 100,
        amountRefunded: 60,
      });

      const dto: PartialRefundDto = { amount: 50, reason: 'Over refund' };
      await expect(service.partialRefund('payment-1', dto, 'tenant-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should allow a refund equal to the remaining balance', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        ...mockPayment,
        amount: 100,
        amountRefunded: 60,
      });
      prisma.$transaction.mockImplementation(
        async (cb: (tx: Record<string, unknown>) => unknown) => {
          const tx = {
            payment: {
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              findUnique: jest.fn().mockResolvedValue({
                ...mockPayment,
                amount: 100,
                amountRefunded: 100,
                status: PaymentStatus.PARTIALLY_REFUNDED,
              }),
            },
            order: { update: jest.fn().mockResolvedValue({}) },
          };
          return cb(tx);
        },
      );

      const dto: PartialRefundDto = { amount: 40, reason: 'Remaining' };
      await expect(
        service.partialRefund('payment-1', dto, 'tenant-1', 'user-1'),
      ).resolves.toBeDefined();
    });

    it('should enforce the cumulative cap inside the transaction (D2)', async () => {
      prisma.payment.findFirst.mockResolvedValue({ ...mockPayment, amount: 100 });
      let updateWhere: Record<string, unknown> | undefined;
      prisma.$transaction.mockImplementation(
        async (cb: (tx: Record<string, unknown>) => unknown) => {
          const updateMany = jest.fn().mockImplementation(({ where }) => {
            updateWhere = where;
            return { count: 1 };
          });
          const tx = {
            payment: {
              updateMany,
              findUnique: jest.fn().mockResolvedValue({
                ...mockPayment,
                amount: 100,
                status: PaymentStatus.PARTIALLY_REFUNDED,
              }),
            },
            order: { update: jest.fn().mockResolvedValue({}) },
          };
          return cb(tx);
        },
      );

      await service.partialRefund('payment-1', { amount: 20 }, 'tenant-1', 'user-1');

      expect(updateWhere).toMatchObject({
        id: 'payment-1',
        amountRefunded: { lte: 80 },
        status: { in: [PaymentStatus.COMPLETED, PaymentStatus.PARTIALLY_REFUNDED] },
      });
    });

    it('should allow a partial refund equal to the remaining balance after prior partials (D3 fix)', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        ...mockPayment,
        amount: 100,
        amountRefunded: 60,
      });
      let updateWhere: Record<string, unknown> | undefined;
      prisma.$transaction.mockImplementation(
        async (cb: (tx: Record<string, unknown>) => unknown) => {
          const updateMany = jest.fn().mockImplementation(({ where }) => {
            updateWhere = where;
            return { count: 1 };
          });
          const tx = {
            payment: {
              updateMany,
              findUnique: jest.fn().mockResolvedValue({
                ...mockPayment,
                amount: 100,
                amountRefunded: 100,
                status: PaymentStatus.PARTIALLY_REFUNDED,
              }),
            },
            order: { update: jest.fn().mockResolvedValue({}) },
          };
          return cb(tx);
        },
      );

      await service.partialRefund('payment-1', { amount: 40 }, 'tenant-1', 'user-1');

      expect(updateWhere).toMatchObject({
        id: 'payment-1',
        amountRefunded: { lte: 60 },
      });
    });

    it('should conflict when a concurrent refund already consumed the balance (D2)', async () => {
      prisma.payment.findFirst.mockResolvedValue({ ...mockPayment, amount: 100 });
      prisma.$transaction.mockImplementation(
        async (cb: (tx: Record<string, unknown>) => unknown) => {
          const tx = {
            payment: {
              updateMany: jest.fn().mockResolvedValue({ count: 0 }),
              findUnique: jest.fn(),
            },
            order: { update: jest.fn().mockResolvedValue({}) },
          };
          return cb(tx);
        },
      );

      await expect(
        service.partialRefund('payment-1', { amount: 60 }, 'tenant-1', 'user-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('should increment amountRefunded instead of leaving it stale (D2)', async () => {
      prisma.payment.findFirst.mockResolvedValue(mockPayment);
      let updateData: Record<string, unknown> | undefined;
      prisma.$transaction.mockImplementation(
        async (cb: (tx: Record<string, unknown>) => unknown) => {
          const updateMany = jest.fn().mockImplementation(({ data }) => {
            updateData = data;
            return { count: 1 };
          });
          const tx = {
            payment: {
              updateMany,
              findUnique: jest.fn().mockResolvedValue({
                ...mockPayment,
                amountRefunded: 20,
                status: PaymentStatus.PARTIALLY_REFUNDED,
              }),
            },
            order: { update: jest.fn().mockResolvedValue({}) },
          };
          return cb(tx);
        },
      );

      await service.partialRefund('payment-1', { amount: 20 }, 'tenant-1', 'user-1');

      expect(updateData).toMatchObject({
        status: PaymentStatus.PARTIALLY_REFUNDED,
        amountRefunded: { increment: 20 },
      });
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
    function stubSplitProvider(behavior: {
      create?: { success: boolean; data?: { id: string; status: string }; error?: string };
      confirm?: {
        success: boolean;
        data?: { status: string; transactionId?: string };
        error?: string;
      };
    }) {
      (service as unknown as { providerRegistry: Map<string, unknown> }).providerRegistry.set(
        'stripe',
        {
          mode: 'mock',
          initialize: async () => undefined,
          createPaymentIntent: jest.fn().mockResolvedValue(
            behavior.create ?? {
              success: true,
              data: { id: 'pi_split_1', status: 'requires_confirmation' },
            },
          ),
          confirmPayment: jest.fn().mockResolvedValue(
            behavior.confirm ?? {
              success: true,
              data: { status: 'succeeded', transactionId: 'txn_split_1' },
            },
          ),
        },
      );
    }

    function mockCreateTx(payments: Array<Record<string, unknown>>) {
      const create = jest.fn();
      payments.forEach((p) => create.mockResolvedValueOnce(p));
      return {
        order: {
          findFirst: jest.fn().mockResolvedValue(mockOrder),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          update: jest.fn().mockResolvedValue({}),
        },
        payment: {
          create,
          update: jest.fn().mockResolvedValue(payments[0]),
        },
        orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
      };
    }

    function mockFinalizeTx(completedRows: Array<Record<string, unknown>>) {
      return {
        order: {
          findFirst: jest.fn().mockResolvedValue(mockOrder),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          update: jest.fn().mockResolvedValue({}),
        },
        payment: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findMany: jest.fn().mockResolvedValue(completedRows),
        },
        orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
      };
    }

    function cashSplit() {
      return { ...mockPayment, id: 'payment-2', method: PaymentMethod.CASH, amount: 30 };
    }

    function cardSplitPending() {
      return {
        ...mockPayment,
        id: 'payment-3',
        method: PaymentMethod.CREDIT_CARD,
        amount: 70,
        status: PaymentStatus.PENDING,
        idempotencyKey: 'idem-3',
      };
    }

    it('should split across methods, completing cash in-tx and card via provider out-of-tx (P1-10)', async () => {
      prisma.order.findFirst.mockResolvedValue(mockOrder);
      stubSplitProvider({});
      prisma.$transaction
        .mockImplementationOnce(async (cb) => cb(mockCreateTx([cashSplit(), cardSplitPending()])))
        .mockImplementationOnce(async (cb) =>
          cb(
            mockFinalizeTx([
              {
                ...cardSplitPending(),
                status: PaymentStatus.COMPLETED,
                gatewayRef: 'txn_split_1',
              },
            ]),
          ),
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
      expect(results.map((r) => r.status)).toEqual(
        expect.arrayContaining([PaymentStatus.COMPLETED, PaymentStatus.COMPLETED]),
      );
      expect(metrics.incrementPaymentsCompleted).toHaveBeenCalledTimes(2);
    });

    it('should mark provider split FAILED without crediting the order when gateway rejects (P1-10)', async () => {
      prisma.order.findFirst.mockResolvedValue(mockOrder);
      stubSplitProvider({ create: { success: false, error: 'Gateway rejected payment' } });
      prisma.$transaction
        .mockImplementationOnce(async (cb) => cb(mockCreateTx([cashSplit(), cardSplitPending()])))
        .mockImplementationOnce(async (cb) => {
          const order = {
            findFirst: jest.fn(),
            updateMany: jest.fn(),
            update: jest.fn(),
          };
          const result = cb({
            order,
            payment: {
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              findMany: jest.fn().mockResolvedValue([
                {
                  ...cardSplitPending(),
                  status: PaymentStatus.FAILED,
                },
              ]),
            },
            orderStatusHistory: { create: jest.fn() },
          });
          expect(order.updateMany).not.toHaveBeenCalled();
          expect(order.update).not.toHaveBeenCalled();
          return result;
        });

      const dto: SplitPaymentDto = {
        orderId: 'order-1',
        splits: [
          { method: PaymentMethod.CASH, amount: 30 },
          { method: PaymentMethod.CREDIT_CARD, amount: 70 },
        ],
      };

      const results = await service.splitPayment('order-1', dto, 'tenant-1', 'user-1');
      expect(results.find((r) => r.id === 'payment-3')?.status).toBe(PaymentStatus.FAILED);
      expect(metrics.incrementPaymentsFailed).toHaveBeenCalledTimes(1);
      expect(metrics.incrementPaymentsCompleted).toHaveBeenCalledTimes(1);
    });

    it('should keep provider split PENDING and attach gatewayRef on async confirmation (P1-10)', async () => {
      prisma.order.findFirst.mockResolvedValue(mockOrder);
      stubSplitProvider({ confirm: { success: true, data: { status: 'pending' } } });
      prisma.$transaction
        .mockImplementationOnce(async (cb) => cb(mockCreateTx([cashSplit(), cardSplitPending()])))
        .mockImplementationOnce(async (cb) =>
          cb(
            mockFinalizeTx([
              {
                ...cardSplitPending(),
                status: PaymentStatus.PENDING,
                gatewayRef: 'pi_split_1',
              },
            ]),
          ),
        );

      const dto: SplitPaymentDto = {
        orderId: 'order-1',
        splits: [
          { method: PaymentMethod.CASH, amount: 30 },
          { method: PaymentMethod.CREDIT_CARD, amount: 70 },
        ],
      };

      const results = await service.splitPayment('order-1', dto, 'tenant-1', 'user-1');
      expect(results.find((r) => r.id === 'payment-3')?.status).toBe(PaymentStatus.PENDING);
      expect(metrics.incrementPaymentsCompleted).toHaveBeenCalledTimes(1);
      expect(metrics.incrementPaymentsFailed).not.toHaveBeenCalled();
    });

    it('should pass the payment idempotency key to the gateway for safe retries (P1-10)', async () => {
      prisma.order.findFirst.mockResolvedValue(mockOrder);
      stubSplitProvider({});
      prisma.$transaction
        .mockImplementationOnce(async (cb) => cb(mockCreateTx([cashSplit(), cardSplitPending()])))
        .mockImplementationOnce(async (cb) =>
          cb(mockFinalizeTx([{ ...cardSplitPending(), status: PaymentStatus.COMPLETED }])),
        );

      const dto: SplitPaymentDto = {
        orderId: 'order-1',
        splits: [
          { method: PaymentMethod.CASH, amount: 30 },
          { method: PaymentMethod.CREDIT_CARD, amount: 70 },
        ],
      };

      await service.splitPayment('order-1', dto, 'tenant-1', 'user-1');
      const provider = (
        service as unknown as { providerRegistry: Map<string, unknown> }
      ).providerRegistry.get('stripe') as {
        createPaymentIntent: jest.Mock;
        confirmPayment: jest.Mock;
      };
      expect(provider.createPaymentIntent).toHaveBeenCalledWith(expect.any(Object), 'idem-3');
      expect(provider.confirmPayment).toHaveBeenCalledWith(expect.any(String), 'idem-3');
    });

    it('should credit the order only once when two split payments race on the version CAS (P1-10)', async () => {
      prisma.order.findFirst.mockResolvedValue(mockOrder);
      const release: Array<() => void> = [];
      const barrier = new Promise<void>((resolve) => {
        release.push(resolve);
        release.push(resolve);
      });
      let claimCount = 0;
      prisma.$transaction.mockImplementation(
        async (cb: (tx: Record<string, unknown>) => unknown) => {
          await barrier;
          const winner = ++claimCount === 1;
          return cb({
            order: {
              findFirst: jest.fn().mockResolvedValue(mockOrder),
              updateMany: jest.fn().mockResolvedValue({ count: winner ? 1 : 0 }),
              update: jest.fn().mockResolvedValue({}),
            },
            payment: {
              create: jest.fn().mockResolvedValue({
                ...mockPayment,
                id: 'payment-x',
                method: PaymentMethod.CASH,
                amount: 50,
              }),
              update: jest.fn().mockResolvedValue({
                ...mockPayment,
                id: 'payment-x',
                method: PaymentMethod.CASH,
                amount: 50,
                status: PaymentStatus.COMPLETED,
              }),
              findMany: jest.fn().mockResolvedValue([]),
            },
            orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
          });
        },
      );

      const dto: SplitPaymentDto = {
        orderId: 'order-1',
        splits: [{ method: PaymentMethod.CASH, amount: 50 }],
      };
      const first = service.splitPayment('order-1', dto, 'tenant-1', 'user-1');
      const second = service.splitPayment('order-1', dto, 'tenant-1', 'user-1');
      release.forEach((r) => r());
      const results = await Promise.allSettled([first, second]);

      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(ConflictException);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    });

    it('should credit a provider split only once when finalized concurrently (P1-10)', async () => {
      const pending = {
        ...mockPayment,
        id: 'payment-9',
        method: PaymentMethod.CREDIT_CARD,
        amount: 40,
        status: PaymentStatus.PENDING,
        idempotencyKey: 'idem-9',
      };
      const release: Array<() => void> = [];
      const barrier = new Promise<void>((resolve) => {
        release.push(resolve);
        release.push(resolve);
      });
      let claimCount = 0;
      let orderCredits = 0;
      prisma.$transaction.mockImplementation(
        async (cb: (tx: Record<string, unknown>) => unknown) => {
          await barrier;
          const winner = ++claimCount === 1;
          return cb({
            order: {
              findFirst: jest.fn().mockResolvedValue(mockOrder),
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              update: jest.fn().mockImplementation(() => {
                orderCredits += 1;
                return {};
              }),
            },
            payment: {
              updateMany: jest.fn().mockResolvedValue({ count: winner ? 1 : 0 }),
              findMany: jest
                .fn()
                .mockResolvedValue([
                  { ...pending, status: PaymentStatus.COMPLETED, gatewayRef: 'txn_9' },
                ]),
            },
            orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
          });
        },
      );

      const svc = service as unknown as {
        finalizeProviderSplitPayments: (
          orderId: string,
          tenantId: string,
          userId: string,
          outcomes: Array<{
            paymentId: string;
            outcome: 'completed';
            gatewayRef: string | null;
            gatewayData: unknown;
          }>,
          createdPayments: Array<Record<string, unknown>>,
        ) => Promise<Array<Record<string, unknown>>>;
      };

      const outcome = {
        paymentId: 'payment-9',
        outcome: 'completed' as const,
        gatewayRef: 'txn_9',
        gatewayData: {},
      };
      const first = svc.finalizeProviderSplitPayments(
        'order-1',
        'tenant-1',
        'user-1',
        [outcome],
        [pending],
      );
      const second = svc.finalizeProviderSplitPayments(
        'order-1',
        'tenant-1',
        'user-1',
        [outcome],
        [pending],
      );
      release.forEach((r) => r());
      await Promise.all([first, second]);

      expect(orderCredits).toBe(1);
      expect(claimCount).toBe(2);
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
    function stubStatusProvider(behavior: { mode?: string; getPaymentStatus?: unknown }) {
      (service as unknown as { providerRegistry: Map<string, unknown> }).providerRegistry.set(
        'stripe',
        {
          mode: behavior.mode ?? 'live',
          initialize: async () => undefined,
          getPaymentStatus:
            behavior.getPaymentStatus ??
            jest.fn().mockResolvedValue({
              success: true,
              data: { status: 'succeeded', amount: 5000, currency: 'usd' },
            }),
        },
      );
    }

    it('should return reconciliation report', async () => {
      prisma.payment.findMany.mockResolvedValue([mockPayment]);

      const result = await service.reconcile('tenant-1', '2025-01-01', '2025-12-31');
      expect(result.localPayments).toBe(1);
      expect(result.mismatches).toBe(0);
    });

    it('should be strictly read-only: no database writes during reconciliation', async () => {
      prisma.payment.findMany.mockResolvedValue([mockPayment]);

      await service.reconcile('tenant-1', '2025-01-01', '2025-12-31');
      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(prisma.payment.update).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should scope the report to the tenant (tenant isolation)', async () => {
      prisma.payment.findMany.mockResolvedValue([]);

      await service.reconcile('tenant-9', '2025-01-01', '2025-12-31');
      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: 'tenant-9' }),
        }),
      );
    });

    it('should count payments without a gateway reference as matched', async () => {
      prisma.payment.findMany.mockResolvedValue([
        { ...mockPayment, method: PaymentMethod.CREDIT_CARD, gatewayRef: null },
      ]);
      stubStatusProvider({});

      const result = await service.reconcile('tenant-1', '2025-01-01', '2025-12-31');
      expect(result.providerMatches).toBe(1);
      expect(result.mismatches).toBe(0);
    });

    it('should count gateway payments handled by a mock provider as matched', async () => {
      prisma.payment.findMany.mockResolvedValue([
        { ...mockPayment, method: PaymentMethod.CREDIT_CARD, gatewayRef: 'pi_1' },
      ]);
      stubStatusProvider({ mode: 'mock' });

      const result = await service.reconcile('tenant-1', '2025-01-01', '2025-12-31');
      expect(result.providerMatches).toBe(1);
      expect(result.mismatches).toBe(0);
    });

    it('should match when provider succeeded and local status is COMPLETED', async () => {
      prisma.payment.findMany.mockResolvedValue([
        {
          ...mockPayment,
          method: PaymentMethod.CREDIT_CARD,
          gatewayRef: 'pi_1',
          status: PaymentStatus.COMPLETED,
        },
      ]);
      stubStatusProvider({});

      const result = await service.reconcile('tenant-1', '2025-01-01', '2025-12-31');
      expect(result.providerMatches).toBe(1);
      expect(result.mismatches).toBe(0);
    });

    it('should flag a mismatch when provider succeeded but local status is PENDING', async () => {
      prisma.payment.findMany.mockResolvedValue([
        {
          ...mockPayment,
          method: PaymentMethod.CREDIT_CARD,
          gatewayRef: 'pi_1',
          status: PaymentStatus.PENDING,
        },
      ]);
      stubStatusProvider({});

      const result = await service.reconcile('tenant-1', '2025-01-01', '2025-12-31');
      expect(result.mismatches).toBe(1);
      expect(result.providerMatches).toBe(0);
    });

    it('should flag a mismatch when provider failed but local status is COMPLETED', async () => {
      prisma.payment.findMany.mockResolvedValue([
        {
          ...mockPayment,
          method: PaymentMethod.CREDIT_CARD,
          gatewayRef: 'pi_1',
          status: PaymentStatus.COMPLETED,
        },
      ]);
      stubStatusProvider({
        getPaymentStatus: jest.fn().mockResolvedValue({
          success: true,
          data: { status: 'failed', amount: 0, currency: 'usd' },
        }),
      });

      const result = await service.reconcile('tenant-1', '2025-01-01', '2025-12-31');
      expect(result.mismatches).toBe(1);
      expect(result.providerMatches).toBe(0);
    });

    it('should match when provider failed and local status is FAILED or PENDING', async () => {
      prisma.payment.findMany.mockResolvedValue([
        {
          ...mockPayment,
          method: PaymentMethod.CREDIT_CARD,
          gatewayRef: 'pi_1',
          status: PaymentStatus.FAILED,
        },
        {
          ...mockPayment,
          id: 'payment-2',
          method: PaymentMethod.CREDIT_CARD,
          gatewayRef: 'pi_2',
          status: PaymentStatus.PENDING,
        },
      ]);
      stubStatusProvider({
        getPaymentStatus: jest.fn().mockResolvedValue({
          success: true,
          data: { status: 'failed', amount: 0, currency: 'usd' },
        }),
      });

      const result = await service.reconcile('tenant-1', '2025-01-01', '2025-12-31');
      expect(result.providerMatches).toBe(2);
      expect(result.mismatches).toBe(0);
    });

    it('should flag a mismatch when the provider lookup fails', async () => {
      prisma.payment.findMany.mockResolvedValue([
        {
          ...mockPayment,
          method: PaymentMethod.CREDIT_CARD,
          gatewayRef: 'pi_1',
          status: PaymentStatus.COMPLETED,
        },
      ]);
      stubStatusProvider({
        getPaymentStatus: jest
          .fn()
          .mockResolvedValue({ success: false, error: 'Upstream error', statusCode: 502 }),
      });

      const result = await service.reconcile('tenant-1', '2025-01-01', '2025-12-31');
      expect(result.mismatches).toBe(1);
      expect(result.providerMatches).toBe(0);
    });

    it('should flag a mismatch when the provider lookup throws', async () => {
      prisma.payment.findMany.mockResolvedValue([
        {
          ...mockPayment,
          method: PaymentMethod.CREDIT_CARD,
          gatewayRef: 'pi_1',
          status: PaymentStatus.COMPLETED,
        },
      ]);
      stubStatusProvider({
        getPaymentStatus: jest.fn().mockRejectedValue(new Error('network down')),
      });

      const result = await service.reconcile('tenant-1', '2025-01-01', '2025-12-31');
      expect(result.mismatches).toBe(1);
      expect(result.providerMatches).toBe(0);
    });

    it('should report counts that always sum to the number of local payments', async () => {
      prisma.payment.findMany.mockResolvedValue([
        mockPayment,
        {
          ...mockPayment,
          id: 'payment-2',
          method: PaymentMethod.CREDIT_CARD,
          gatewayRef: 'pi_2',
          status: PaymentStatus.PENDING,
        },
      ]);
      stubStatusProvider({});

      const result = await service.reconcile('tenant-1', '2025-01-01', '2025-12-31');
      expect(result.localPayments).toBe(2);
      expect(result.providerMatches + result.mismatches).toBe(2);
    });
  });

  describe('charge (gateway methods)', () => {
    const pendingCardPayment = {
      ...mockPayment,
      method: PaymentMethod.CREDIT_CARD,
      status: PaymentStatus.PENDING,
    };

    function mockIntentTx(created: Record<string, unknown> = pendingCardPayment) {
      prisma.$transaction.mockImplementation(
        async (cb: (tx: Record<string, unknown>) => unknown) => {
          const tx = {
            order: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
            payment: { create: jest.fn().mockResolvedValue(created) },
          };
          return cb(tx);
        },
      );
    }

    function stubProvider(behavior: {
      create?: { success: boolean; data?: { id: string; status: string }; error?: string };
      confirm?: {
        success: boolean;
        data?: { status: string; transactionId?: string };
        error?: string;
      };
    }) {
      (service as unknown as { providerRegistry: Map<string, unknown> }).providerRegistry.set(
        'stripe',
        {
          mode: 'mock',
          initialize: async () => undefined,
          createPaymentIntent: jest.fn().mockResolvedValue(
            behavior.create ?? {
              success: true,
              data: { id: 'pi_stub_1', status: 'requires_confirmation' },
            },
          ),
          confirmPayment: jest.fn().mockResolvedValue(
            behavior.confirm ?? {
              success: true,
              data: { status: 'succeeded', transactionId: 'txn_stub_1' },
            },
          ),
        },
      );
    }

    it('should complete payment only when the gateway confirms succeeded', async () => {
      prisma.order.findFirst.mockResolvedValue(mockOrder);

      prisma.$transaction.mockImplementationOnce(
        async (cb: (tx: Record<string, unknown>) => unknown) => {
          const tx = {
            order: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
            payment: { create: jest.fn().mockResolvedValue(pendingCardPayment) },
          };
          return cb(tx);
        },
      );
      prisma.$transaction.mockImplementationOnce(
        async (cb: (tx: Record<string, unknown>) => unknown) => {
          const tx = {
            order: {
              findFirst: jest.fn().mockResolvedValue(mockOrder),
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              update: jest.fn().mockResolvedValue({}),
            },
            payment: {
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              findUnique: jest.fn().mockResolvedValue({
                ...mockPayment,
                method: PaymentMethod.CREDIT_CARD,
                status: PaymentStatus.COMPLETED,
              }),
            },
            orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
          };
          return cb(tx);
        },
      );

      const dto: CreatePaymentDto = {
        orderId: 'order-1',
        method: PaymentMethod.CREDIT_CARD,
        amount: 50,
      };

      const result = await service.charge('order-1', dto, 'tenant-1', 'user-1');
      expect(result.status).toBe(PaymentStatus.COMPLETED);
      expect(metrics.incrementPaymentsCompleted).toHaveBeenCalled();
    });

    it('should keep payment PENDING when gateway requires async confirmation', async () => {
      prisma.order.findFirst.mockResolvedValue(mockOrder);
      mockIntentTx();
      stubProvider({ confirm: { success: true, data: { status: 'pending' } } });
      prisma.payment.update.mockResolvedValue({
        ...pendingCardPayment,
        gatewayRef: 'pi_stub_1',
        gatewayData: {},
      });

      const dto: CreatePaymentDto = {
        orderId: 'order-1',
        method: PaymentMethod.CREDIT_CARD,
        amount: 50,
      };

      const result = await service.charge('order-1', dto, 'tenant-1', 'user-1');
      expect(result.status).toBe(PaymentStatus.PENDING);
      expect(metrics.incrementPaymentsCompleted).not.toHaveBeenCalled();
      expect(metrics.incrementPaymentsFailed).not.toHaveBeenCalled();
    });

    it('should mark payment FAILED when the gateway rejects', async () => {
      prisma.order.findFirst.mockResolvedValue(mockOrder);
      mockIntentTx();
      stubProvider({ create: { success: false, error: 'Gateway rejected payment' } });
      prisma.payment.update.mockResolvedValue({
        ...pendingCardPayment,
        status: PaymentStatus.FAILED,
      });

      const dto: CreatePaymentDto = {
        orderId: 'order-1',
        method: PaymentMethod.CREDIT_CARD,
        amount: 50,
      };

      const result = await service.charge('order-1', dto, 'tenant-1', 'user-1');
      expect(result.status).toBe(PaymentStatus.FAILED);
      expect(metrics.incrementPaymentsFailed).toHaveBeenCalled();
    });

    it('should refuse mock gateway in production', async () => {
      (
        service as unknown as { configService: { get: (k: string) => string | undefined } }
      ).configService = { get: (k: string) => (k === 'app.nodeEnv' ? 'production' : undefined) };
      prisma.order.findFirst.mockResolvedValue(mockOrder);

      const dto: CreatePaymentDto = {
        orderId: 'order-1',
        method: PaymentMethod.CREDIT_CARD,
        amount: 50,
      };

      await expect(service.charge('order-1', dto, 'tenant-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should replay an existing payment for the same idempotency key', async () => {
      prisma.order.findFirst.mockResolvedValue(mockOrder);
      prisma.payment.findFirst.mockResolvedValue({
        ...mockPayment,
        method: PaymentMethod.CREDIT_CARD,
        status: PaymentStatus.COMPLETED,
        idempotencyKey: 'idem-1',
      });

      const dto: CreatePaymentDto = {
        orderId: 'order-1',
        method: PaymentMethod.CREDIT_CARD,
        amount: 50,
        idempotencyKey: 'idem-1',
      };

      const result = await service.charge('order-1', dto, 'tenant-1', 'user-1');
      expect(result.status).toBe(PaymentStatus.COMPLETED);
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('should reject reuse of an idempotency key for a different order', async () => {
      prisma.order.findFirst.mockResolvedValue(mockOrder);
      prisma.payment.findFirst.mockResolvedValue({
        ...mockPayment,
        orderId: 'order-2',
        method: PaymentMethod.CREDIT_CARD,
        status: PaymentStatus.COMPLETED,
        idempotencyKey: 'idem-1',
      });

      const dto: CreatePaymentDto = {
        orderId: 'order-1',
        method: PaymentMethod.CREDIT_CARD,
        amount: 50,
        idempotencyKey: 'idem-1',
      };

      await expect(service.charge('order-1', dto, 'tenant-1', 'user-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('handleGatewayWebhook', () => {
    let webhookService: PaymentsService;
    let webhookPrisma: Record<string, jest.Mock>;

    const pendingGatewayPayment = {
      ...mockPayment,
      id: 'payment-webhook-1',
      method: PaymentMethod.CREDIT_CARD,
      status: PaymentStatus.PENDING,
      gatewayRef: 'pi_webhook_1',
      amount: 50,
    };

    const completedGatewayPayment = {
      ...pendingGatewayPayment,
      status: PaymentStatus.COMPLETED,
      processedAt: new Date(),
    };

    beforeEach(async () => {
      webhookPrisma = {
        order: {
          findFirst: jest.fn(),
          findUnique: jest.fn(),
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

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PaymentsService,
          {
            provide: StripeProvider,
            useValue: new StripeProvider({
              mode: 'live',
              secretKey: 'sk_live_123',
              webhookSecret: 'whsec_test',
            }),
          },
          { provide: PaymobProvider, useValue: new PaymobProvider() },
          { provide: PrismaService, useValue: webhookPrisma },
          { provide: AuditLogsService, useValue: { log: jest.fn() } },
          { provide: MetricsService, useValue: metrics },
          { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        ],
      }).compile();

      webhookService = module.get<PaymentsService>(PaymentsService);
      await webhookService.onModuleInit();
    });

    function validStripeSignature(payload: string): string {
      const timestamp = '1700000000';
      const digest = createHmac('sha256', 'whsec_test')
        .update(`${timestamp}.${payload}`)
        .digest('hex');
      return `t=${timestamp},v1=${digest}`;
    }

    it('should reject an invalid signature', async () => {
      await expect(
        webhookService.handleGatewayWebhook(
          'stripe',
          JSON.stringify({ type: 'payment_intent.succeeded' }),
          't=1,v1=bad',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should complete a pending payment on payment_intent.succeeded', async () => {
      webhookPrisma.payment.findFirst.mockResolvedValue(pendingGatewayPayment);
      webhookPrisma.order.findUnique.mockResolvedValue(mockOrder);
      webhookPrisma.$transaction.mockImplementation(
        async (cb: (tx: Record<string, unknown>) => unknown) => {
          const tx = {
            order: {
              findFirst: jest.fn().mockResolvedValue(mockOrder),
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              update: jest.fn().mockResolvedValue({}),
            },
            payment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
            orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
          };
          return cb(tx);
        },
      );

      const payload = JSON.stringify({
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_webhook_1', amount: 5000, currency: 'usd' } },
      });

      const result = await webhookService.handleGatewayWebhook(
        'stripe',
        payload,
        validStripeSignature(payload),
      );
      expect(result.type).toBe('payment.succeeded');
      expect(metrics.incrementPaymentsCompleted).toHaveBeenCalled();
    });

    it('creates OrderStatusHistory with a system actor and null userId (FK-safe)', async () => {
      webhookPrisma.payment.findFirst.mockResolvedValue(pendingGatewayPayment);
      webhookPrisma.order.findUnique.mockResolvedValue(mockOrder);
      const historyCreate = jest.fn().mockResolvedValue({});
      webhookPrisma.$transaction.mockImplementation(
        async (cb: (tx: Record<string, unknown>) => unknown) => {
          const tx = {
            order: {
              findFirst: jest.fn().mockResolvedValue({ ...mockOrder, total: 50 }),
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              update: jest.fn().mockResolvedValue({}),
            },
            payment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
            orderStatusHistory: { create: historyCreate },
          };
          return cb(tx);
        },
      );

      const payload = JSON.stringify({
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_webhook_1', amount: 5000, currency: 'usd' } },
      });

      await webhookService.handleGatewayWebhook('stripe', payload, validStripeSignature(payload));
      expect(historyCreate).toHaveBeenCalledTimes(1);
      const data = historyCreate.mock.calls[0][0].data;
      expect(data.changedByUserId).toBeNull();
      expect(data.changedBy).toBe('system');
      expect(data.orderId).toBe('order-1');
      expect(data.tenantId).toBe('tenant-1');
      expect(data.toStatus).toBe('COMPLETED');
    });

    it('scopes webhook completion to the tenant owning the payment', async () => {
      webhookPrisma.payment.findFirst.mockResolvedValue(pendingGatewayPayment);
      webhookPrisma.order.findUnique.mockResolvedValue(mockOrder);
      let capturedWhere: unknown;
      webhookPrisma.$transaction.mockImplementation(
        async (cb: (tx: Record<string, unknown>) => unknown) => {
          const tx = {
            order: {
              findFirst: jest.fn().mockImplementation((args: { where: unknown }) => {
                capturedWhere = args.where;
                return Promise.resolve(mockOrder);
              }),
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              update: jest.fn().mockResolvedValue({}),
            },
            payment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
            orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
          };
          return cb(tx);
        },
      );

      const payload = JSON.stringify({
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_webhook_1', amount: 5000, currency: 'usd' } },
      });

      await webhookService.handleGatewayWebhook('stripe', payload, validStripeSignature(payload));
      expect(capturedWhere).toEqual({ id: 'order-1', tenantId: 'tenant-1', deletedAt: null });
    });

    it('concurrent webhook deliveries only claim and credit the payment once', async () => {
      webhookPrisma.payment.findFirst.mockResolvedValue(pendingGatewayPayment);
      webhookPrisma.order.findUnique.mockResolvedValue(mockOrder);
      let claimCount = 0;
      const historyCreate = jest.fn().mockResolvedValue({});
      webhookPrisma.$transaction.mockImplementation(
        async (cb: (tx: Record<string, unknown>) => unknown) => {
          claimCount += 1;
          const tx = {
            order: {
              findFirst: jest.fn().mockResolvedValue({ ...mockOrder, total: 50 }),
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              update: jest.fn().mockResolvedValue({}),
            },
            payment: {
              updateMany: jest
                .fn()
                .mockResolvedValue(claimCount === 1 ? { count: 1 } : { count: 0 }),
            },
            orderStatusHistory: { create: historyCreate },
          };
          return cb(tx);
        },
      );

      const payload = JSON.stringify({
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_webhook_1', amount: 5000, currency: 'usd' } },
      });

      await webhookService.handleGatewayWebhook('stripe', payload, validStripeSignature(payload));
      await webhookService.handleGatewayWebhook('stripe', payload, validStripeSignature(payload));
      expect(historyCreate).toHaveBeenCalledTimes(1);
      expect(metrics.incrementPaymentsCompleted).toHaveBeenCalledTimes(1);
    });

    it('does not re-credit on duplicate sequential webhook delivery', async () => {
      webhookPrisma.payment.findFirst
        .mockResolvedValueOnce(pendingGatewayPayment)
        .mockResolvedValueOnce(completedGatewayPayment);
      webhookPrisma.order.findUnique.mockResolvedValue(mockOrder);
      webhookPrisma.$transaction.mockImplementation(
        async (cb: (tx: Record<string, unknown>) => unknown) => {
          const tx = {
            order: {
              findFirst: jest.fn().mockResolvedValue(mockOrder),
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              update: jest.fn().mockResolvedValue({}),
            },
            payment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
            orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
          };
          return cb(tx);
        },
      );

      const payload = JSON.stringify({
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_webhook_1', amount: 5000, currency: 'usd' } },
      });

      await webhookService.handleGatewayWebhook('stripe', payload, validStripeSignature(payload));
      await webhookService.handleGatewayWebhook('stripe', payload, validStripeSignature(payload));
      expect(webhookPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(metrics.incrementPaymentsCompleted).toHaveBeenCalledTimes(1);
    });

    it('rethrows and records no metrics when the webhook transaction fails (rollback)', async () => {
      webhookPrisma.payment.findFirst.mockResolvedValue(pendingGatewayPayment);
      webhookPrisma.order.findUnique.mockResolvedValue(mockOrder);
      webhookPrisma.$transaction.mockImplementation(
        async (cb: (tx: Record<string, unknown>) => unknown) => {
          const tx = {
            order: {
              findFirst: jest.fn().mockResolvedValue(mockOrder),
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              update: jest.fn().mockRejectedValue(new Error('db failure')),
            },
            payment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
            orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
          };
          return cb(tx);
        },
      );

      const payload = JSON.stringify({
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_webhook_1', amount: 5000, currency: 'usd' } },
      });

      await expect(
        webhookService.handleGatewayWebhook('stripe', payload, validStripeSignature(payload)),
      ).rejects.toThrow('db failure');
      expect(metrics.incrementPaymentsCompleted).not.toHaveBeenCalled();
    });

    it('should ignore webhook for an already completed payment', async () => {
      webhookPrisma.payment.findFirst.mockResolvedValue(completedGatewayPayment);

      const payload = JSON.stringify({
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_webhook_1', amount: 5000, currency: 'usd' } },
      });

      const result = await webhookService.handleGatewayWebhook(
        'stripe',
        payload,
        validStripeSignature(payload),
      );
      expect(result.type).toBe('payment.succeeded');
      expect(webhookPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should mark a pending payment FAILED on payment_intent.payment_failed', async () => {
      webhookPrisma.payment.findFirst.mockResolvedValue(pendingGatewayPayment);
      webhookPrisma.payment.update.mockResolvedValue({
        ...pendingGatewayPayment,
        status: PaymentStatus.FAILED,
      });

      const payload = JSON.stringify({
        type: 'payment_intent.payment_failed',
        data: { object: { id: 'pi_webhook_1' } },
      });

      const result = await webhookService.handleGatewayWebhook(
        'stripe',
        payload,
        validStripeSignature(payload),
      );
      expect(result.type).toBe('payment.failed');
      expect(metrics.incrementPaymentsFailed).toHaveBeenCalled();
    });

    it('full charge.refunded sets amountRefunded and decrements paidAmount once (D3/D4 fix)', async () => {
      webhookPrisma.payment.findFirst.mockResolvedValue(completedGatewayPayment);
      let paymentUpdateData: Record<string, unknown> | undefined;
      let orderUpdateData: Record<string, unknown> | undefined;
      webhookPrisma.$transaction.mockImplementation(
        async (cb: (tx: Record<string, unknown>) => unknown) => {
          const tx = {
            payment: {
              updateMany: jest.fn().mockImplementation(({ data }) => {
                paymentUpdateData = data;
                return { count: 1 };
              }),
            },
            order: {
              update: jest.fn().mockImplementation(({ data }) => {
                orderUpdateData = data;
                return {};
              }),
            },
          };
          return cb(tx);
        },
      );

      const payload = JSON.stringify({
        type: 'charge.refunded',
        data: {
          object: {
            id: 'ch_1',
            payment_intent: 'pi_webhook_1',
            amount: 5000,
            amount_refunded: 5000,
          },
        },
      });

      const result = await webhookService.handleGatewayWebhook(
        'stripe',
        payload,
        validStripeSignature(payload),
      );
      expect(result.type).toBe('refund.succeeded');
      expect(paymentUpdateData).toMatchObject({
        status: PaymentStatus.REFUNDED,
        amountRefunded: 50,
      });
      expect(orderUpdateData).toMatchObject({
        paidAmount: { decrement: 50 },
      });
      expect(metrics.incrementPaymentsRefunded).toHaveBeenCalledTimes(1);
    });

    it('partial charge.refunded does not double-decrement on replay (D4 fix)', async () => {
      webhookPrisma.payment.findFirst
        .mockResolvedValueOnce(completedGatewayPayment)
        .mockResolvedValueOnce({
          ...completedGatewayPayment,
          status: PaymentStatus.PARTIALLY_REFUNDED,
          amountRefunded: 20,
        });
      let paymentUpdateData: Record<string, unknown> | undefined;
      let orderUpdateData: Record<string, unknown> | undefined;
      webhookPrisma.$transaction.mockImplementation(
        async (cb: (tx: Record<string, unknown>) => unknown) => {
          const tx = {
            payment: {
              updateMany: jest.fn().mockImplementation(({ data }) => {
                paymentUpdateData = data;
                return { count: 1 };
              }),
            },
            order: {
              update: jest.fn().mockImplementation(({ data }) => {
                orderUpdateData = data;
                return {};
              }),
            },
          };
          return cb(tx);
        },
      );

      const payload = JSON.stringify({
        type: 'charge.refunded',
        data: {
          object: {
            id: 'ch_1',
            payment_intent: 'pi_webhook_1',
            amount: 5000,
            amount_refunded: 2000,
          },
        },
      });

      const first = await webhookService.handleGatewayWebhook(
        'stripe',
        payload,
        validStripeSignature(payload),
      );
      expect(first.type).toBe('refund.partial');
      expect(paymentUpdateData).toMatchObject({
        status: PaymentStatus.PARTIALLY_REFUNDED,
        amountRefunded: 20,
      });
      expect(orderUpdateData).toMatchObject({
        paidAmount: { decrement: 20 },
      });

      webhookPrisma.$transaction.mockClear();

      const replay = await webhookService.handleGatewayWebhook(
        'stripe',
        payload,
        validStripeSignature(payload),
      );
      expect(replay.type).toBe('refund.partial');
      expect(webhookPrisma.$transaction).not.toHaveBeenCalled();
      expect(metrics.incrementPaymentsRefunded).toHaveBeenCalledTimes(1);
    });
  });

  describe('clientSecret exposure', () => {
    const basePayment = {
      id: 'payment-1',
      orderId: 'order-1',
      tenantId: 'tenant-1',
      method: PaymentMethod.CREDIT_CARD,
      amount: 50,
      tip: 0,
      reference: null,
      gatewayRef: 'pi_1',
      processedAt: null,
      refundedAt: null,
      refundReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('should return the clientSecret for a PENDING provider payment', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        ...basePayment,
        status: PaymentStatus.PENDING,
        gatewayData: { id: 'pi_1', clientSecret: 'secret_stripe_1', status: 'pending' },
      });

      const result = await service.findOne('payment-1', 'tenant-1');

      expect(result.clientSecret).toBe('secret_stripe_1');
    });

    it('should not return the clientSecret for a COMPLETED payment', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        ...basePayment,
        status: PaymentStatus.COMPLETED,
        gatewayData: { id: 'pi_1', clientSecret: 'secret_stripe_1', status: 'succeeded' },
      });

      const result = await service.findOne('payment-1', 'tenant-1');

      expect(result.clientSecret).toBeUndefined();
    });

    it('should not return the clientSecret for a FAILED payment', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        ...basePayment,
        status: PaymentStatus.FAILED,
        gatewayData: { id: 'pi_1', clientSecret: 'secret_stripe_1', status: 'failed' },
      });

      const result = await service.findOne('payment-1', 'tenant-1');

      expect(result.clientSecret).toBeUndefined();
    });

    it('should omit the clientSecret when gatewayData has none', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        ...basePayment,
        status: PaymentStatus.PENDING,
        gatewayData: { id: 'pi_1', status: 'pending' },
      });

      const result = await service.findOne('payment-1', 'tenant-1');

      expect(result.clientSecret).toBeUndefined();
    });

    it('should omit the clientSecret when gatewayData is null', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        ...basePayment,
        status: PaymentStatus.PENDING,
        gatewayData: null,
      });

      const result = await service.findOne('payment-1', 'tenant-1');

      expect(result.clientSecret).toBeUndefined();
    });
  });
});
