import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsService } from '../payments.service';
import { StripeProvider } from '../providers/stripe.provider';
import { PaymobProvider } from '../providers/paymob.provider';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { MetricsService } from '../../../common/metrics/metrics.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PaymentStatus, PaymentMethod } from '@prisma/client';

describe('PaymentsService — reconcilePendingPayments (P1-02)', () => {
  let service: PaymentsService;
  let prisma: {
    payment: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      updateMany: jest.Mock;
      update: jest.Mock;
    };
    order: { findFirst: jest.Mock };
    $transaction: jest.Mock;
  };
  let metrics: { [k: string]: jest.Mock };
  let auditLogs: { log: jest.Mock };
  let emitter: { emit: jest.Mock };
  let stripeProvider: StripeProvider;
  let paymobProvider: PaymobProvider;

  const pendingPayment = (overrides: Record<string, unknown> = {}) => ({
    id: 'payment-1',
    orderId: 'order-1',
    tenantId: 'tenant-1',
    method: PaymentMethod.CREDIT_CARD,
    amount: 50,
    tip: 5,
    status: PaymentStatus.PENDING,
    amountRefunded: 0,
    reference: null,
    gatewayRef: 'pi_123',
    gatewayData: null,
    processedAt: null,
    refundedAt: null,
    refundReason: null,
    createdAt: new Date(Date.now() - 60 * 60 * 1000),
    updatedAt: new Date(Date.now() - 60 * 60 * 1000),
    ...overrides,
  });

  const freshOrder = {
    id: 'order-1',
    tenantId: 'tenant-1',
    status: 'SERVED',
    total: 100,
    paidAmount: 0,
    version: 1,
  };

  const successTx = () => ({
    payment: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue(pendingPayment()),
    },
    order: {
      findFirst: jest.fn().mockResolvedValue(freshOrder),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
  });

  beforeEach(async () => {
    prisma = {
      payment: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      order: { findFirst: jest.fn() },
      $transaction: jest.fn(),
    };

    metrics = {
      incrementPaymentsCompleted: jest.fn(),
      incrementPaymentsFailed: jest.fn(),
      incrementOrdersCompleted: jest.fn(),
      addRevenue: jest.fn(),
    };
    auditLogs = { log: jest.fn().mockResolvedValue(undefined) };
    emitter = { emit: jest.fn() };

    stripeProvider = new StripeProvider({
      mode: 'live' as const,
      secretKey: 'sk_test',
      webhookSecret: 'whsec_test',
      apiBase: 'https://api.stripe.example',
    });
    paymobProvider = new PaymobProvider({
      mode: 'live' as const,
      apiKey: 'api_key',
      integrationId: 1,
      webhookSecret: 'whsec_test',
      apiBase: 'https://accept.paymob.example',
    });

    stripeProvider.getPaymentStatus = jest.fn();
    paymobProvider.getPaymentStatus = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogsService, useValue: auditLogs },
        { provide: MetricsService, useValue: metrics },
        { provide: EventEmitter2, useValue: emitter },
        { provide: StripeProvider, useValue: stripeProvider },
        { provide: PaymobProvider, useValue: paymobProvider },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  describe('candidate selection', () => {
    it('only queries stale PENDING payments that carry a gateway reference', async () => {
      prisma.payment.findMany.mockResolvedValue([]);

      const result = await service.reconcilePendingPayments({
        max: 25,
        staleAfterMs: 60_000,
      });

      const where = prisma.payment.findMany.mock.calls[0][0].where;
      expect(where.status).toBe(PaymentStatus.PENDING);
      expect(where.gatewayRef).toEqual({ not: null });
      expect(where.createdAt.lte).toBeInstanceOf(Date);
      expect(where.createdAt.lte.getTime()).toBeGreaterThan(Date.now() - 120_000);
      expect(prisma.payment.findMany.mock.calls[0][0].take).toBe(25);
      expect(result).toEqual({
        scanned: 0,
        completed: 0,
        failed: 0,
        mismatched: 0,
        keptPending: 0,
        errored: 0,
      });
    });

    it('does not touch payments that have no gateway provider (CASH, GIFT_CARD)', async () => {
      prisma.payment.findMany.mockResolvedValue([
        pendingPayment({ id: 'p-cash', method: PaymentMethod.CASH, gatewayRef: null }),
        pendingPayment({ id: 'p-gc', method: PaymentMethod.GIFT_CARD, gatewayRef: null }),
      ]);

      const result = await service.reconcilePendingPayments();

      expect(result.keptPending).toBe(2);
      expect(stripeProvider.getPaymentStatus).not.toHaveBeenCalled();
      expect(paymobProvider.getPaymentStatus).not.toHaveBeenCalled();
      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('does not touch payments when the provider runs in mock mode', async () => {
      const mockStripe = new StripeProvider({ mode: 'mock' });
      const mockPaymob = new PaymobProvider({ mode: 'mock' });
      mockStripe.getPaymentStatus = jest.fn();
      mockPaymob.getPaymentStatus = jest.fn();

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PaymentsService,
          { provide: PrismaService, useValue: prisma },
          { provide: AuditLogsService, useValue: auditLogs },
          { provide: MetricsService, useValue: metrics },
          { provide: EventEmitter2, useValue: emitter },
          { provide: StripeProvider, useValue: mockStripe },
          { provide: PaymobProvider, useValue: mockPaymob },
        ],
      }).compile();
      const mockService = module.get<PaymentsService>(PaymentsService);

      prisma.payment.findMany.mockResolvedValue([
        pendingPayment({ id: 'p-cc', method: PaymentMethod.CREDIT_CARD }),
        pendingPayment({ id: 'p-mobile', method: PaymentMethod.MOBILE_PAYMENT }),
      ]);

      const result = await mockService.reconcilePendingPayments();

      expect(result.keptPending).toBe(2);
      expect(mockStripe.getPaymentStatus).not.toHaveBeenCalled();
      expect(mockPaymob.getPaymentStatus).not.toHaveBeenCalled();
      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('gateway succeeded', () => {
    it('credits the order through the existing CAS finalize path when the amount matches', async () => {
      prisma.payment.findMany.mockResolvedValue([pendingPayment()]);
      prisma.order.findFirst.mockResolvedValue(freshOrder);
      stripeProvider.getPaymentStatus.mockResolvedValue({
        success: true,
        data: { status: 'succeeded', amount: 5000, currency: 'USD' },
      });
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
        cb(successTx()),
      );

      const result = await service.reconcilePendingPayments();

      expect(result.completed).toBe(1);
      expect(prisma.order.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'order-1', tenantId: 'tenant-1', deletedAt: null },
        }),
      );
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PAYMENT_RECONCILE_COMPLETED' }),
      );
      expect(metrics.incrementPaymentsCompleted).toHaveBeenCalled();
      expect(emitter.emit).toHaveBeenCalledWith(
        'payments.completed',
        expect.objectContaining({ tenantId: 'tenant-1', orderId: 'order-1' }),
      );
    });

    it('performs the gateway lookup strictly before any database transaction', async () => {
      prisma.payment.findMany.mockResolvedValue([pendingPayment()]);
      prisma.order.findFirst.mockResolvedValue(freshOrder);
      stripeProvider.getPaymentStatus.mockResolvedValue({
        success: true,
        data: { status: 'succeeded', amount: 5000, currency: 'USD' },
      });
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
        cb(successTx()),
      );

      await service.reconcilePendingPayments();

      expect(stripeProvider.getPaymentStatus.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.$transaction.mock.invocationCallOrder[0],
      );
    });

    it('does NOT credit when the gateway amount differs from the local amount', async () => {
      prisma.payment.findMany.mockResolvedValue([pendingPayment()]);
      stripeProvider.getPaymentStatus.mockResolvedValue({
        success: true,
        data: { status: 'succeeded', amount: 9999, currency: 'USD' },
      });

      const result = await service.reconcilePendingPayments();

      expect(result.mismatched).toBe(1);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PAYMENT_RECONCILE_MISMATCH' }),
      );
      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'payment-1' },
          data: {
            gatewayData: expect.objectContaining({
              reconcileAttempts: 1,
              lastReconcileNote: 'amount-mismatch',
            }),
          },
        }),
      );
      expect(metrics.incrementPaymentsCompleted).not.toHaveBeenCalled();
    });

    it('reuses the paymob major-unit amount convention when verifying the amount', async () => {
      prisma.payment.findMany.mockResolvedValue([
        pendingPayment({
          id: 'p-paymob',
          method: PaymentMethod.MOBILE_PAYMENT,
          gatewayRef: 'txn_1',
          amount: 50,
        }),
      ]);
      prisma.order.findFirst.mockResolvedValue(freshOrder);
      paymobProvider.getPaymentStatus.mockResolvedValue({
        success: true,
        data: { status: 'succeeded', amount: 50, currency: 'EGP' },
      });
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
        cb(successTx()),
      );

      const result = await service.reconcilePendingPayments();

      expect(result.completed).toBe(1);
      expect(result.mismatched).toBe(0);
    });

    it('does not double-credit when a concurrent path already finalized the payment', async () => {
      prisma.payment.findMany.mockResolvedValue([pendingPayment()]);
      prisma.order.findFirst.mockResolvedValue(freshOrder);
      stripeProvider.getPaymentStatus.mockResolvedValue({
        success: true,
        data: { status: 'succeeded', amount: 5000, currency: 'USD' },
      });

      const concurrentTx = successTx();
      concurrentTx.payment.updateMany.mockResolvedValue({ count: 0 });

      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
        cb(concurrentTx),
      );

      const result = await service.reconcilePendingPayments();

      expect(result.keptPending).toBe(1);
      expect(result.completed).toBe(0);
      expect(metrics.incrementPaymentsCompleted).not.toHaveBeenCalled();
    });

    it('does not credit when the order is missing', async () => {
      prisma.payment.findMany.mockResolvedValue([pendingPayment()]);
      prisma.order.findFirst.mockResolvedValue(null);
      stripeProvider.getPaymentStatus.mockResolvedValue({
        success: true,
        data: { status: 'succeeded', amount: 5000, currency: 'USD' },
      });

      const result = await service.reconcilePendingPayments();

      expect(result.errored).toBe(1);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { gatewayData: expect.objectContaining({ lastReconcileNote: 'order-not-found' }) },
        }),
      );
    });
  });

  describe('gateway failed / pending / errors', () => {
    it('marks a payment FAILED only when the gateway reports an explicit failure', async () => {
      prisma.payment.findMany.mockResolvedValue([pendingPayment()]);
      stripeProvider.getPaymentStatus.mockResolvedValue({
        success: true,
        data: { status: 'failed', amount: 0, currency: 'USD' },
      });
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.reconcilePendingPayments();

      expect(result.failed).toBe(1);
      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'payment-1', status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.FAILED },
      });
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PAYMENT_RECONCILE_FAILED' }),
      );
      expect(metrics.incrementPaymentsFailed).toHaveBeenCalled();
      expect(emitter.emit).toHaveBeenCalledWith(
        'payments.failed',
        expect.objectContaining({ paymentId: 'payment-1' }),
      );
    });

    it('leaves a payment PENDING when the gateway says it is still processing', async () => {
      prisma.payment.findMany.mockResolvedValue([pendingPayment()]);
      stripeProvider.getPaymentStatus.mockResolvedValue({
        success: true,
        data: { status: 'processing', amount: 5000, currency: 'USD' },
      });

      const result = await service.reconcilePendingPayments();

      expect(result.keptPending).toBe(1);
      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            gatewayData: expect.objectContaining({
              lastReconcileNote: 'gateway-status:processing',
            }),
          },
        }),
      );
      expect(stripeProvider.getPaymentStatus).toHaveBeenCalledWith('pi_123');
    });

    it('does not auto-fail on network/timeout errors; keeps PENDING and records the attempt', async () => {
      prisma.payment.findMany.mockResolvedValue([pendingPayment()]);
      stripeProvider.getPaymentStatus.mockResolvedValue({
        success: false,
        error: 'Upstream timeout',
      });

      const result = await service.reconcilePendingPayments();

      expect(result.errored).toBe(1);
      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { gatewayData: expect.objectContaining({ lastReconcileNote: 'Upstream timeout' }) },
        }),
      );
    });

    it('handles thrown gateway exceptions like other network errors', async () => {
      prisma.payment.findMany.mockResolvedValue([pendingPayment()]);
      stripeProvider.getPaymentStatus.mockRejectedValue(new Error('ECONNRESET'));

      const result = await service.reconcilePendingPayments();

      expect(result.errored).toBe(1);
      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            gatewayData: expect.objectContaining({ lastReconcileNote: 'status-lookup-error' }),
          },
        }),
      );
    });
  });
});
