import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException } from '@nestjs/common';
import { PaymentMethod, PaymentStatus, Prisma } from '@prisma/client';
import { PaymentsService } from '../payments.service';
import { StripeProvider } from '../providers/stripe.provider';
import { PaymobProvider } from '../providers/paymob.provider';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { MetricsService } from '../../../common/metrics/metrics.service';

describe('PaymentsService gift card redemption', () => {
  let service: PaymentsService;
  let tx: Record<string, Record<string, jest.Mock>>;
  let prisma: {
    order: { findFirst: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
    payment: { findFirst: jest.Mock; findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
    orderStatusHistory: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let metrics: Record<string, jest.Mock>;

  const order = {
    id: 'order-1',
    tenantId: 'tenant-1',
    status: 'CONFIRMED',
    total: 100,
    paidAmount: 0,
    tip: 0,
    version: 1,
    orderNumber: 1001,
  };

  const activeCard = {
    id: 'gc-1',
    tenantId: 'tenant-1',
    code: 'GC-123',
    status: 'ACTIVE',
    currentBalance: 60,
    expiresAt: null as Date | null,
  };

  function giftCardCharge(reference: string | undefined, amount = 60) {
    return service.charge(
      'order-1',
      { method: PaymentMethod.GIFT_CARD, amount, reference } as never,
      'tenant-1',
      'user-1',
    );
  }

  beforeEach(async () => {
    tx = {
      order: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      payment: {
        create: jest.fn().mockResolvedValue({
          id: 'payment-1',
          orderId: 'order-1',
          tenantId: 'tenant-1',
          method: PaymentMethod.GIFT_CARD,
          amount: 60,
          tip: 0,
          status: PaymentStatus.COMPLETED,
          amountRefunded: 0,
          reference: 'GC-123',
          gatewayRef: null,
          gatewayData: null,
          processedAt: new Date(),
          refundedAt: null,
          refundReason: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      },
      giftCard: {
        findFirst: jest.fn().mockResolvedValue(activeCard),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      giftCardTransaction: {
        create: jest.fn().mockResolvedValue({}),
      },
      orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    };

    prisma = {
      order: {
        findFirst: jest.fn(({ where }: { where: { tenantId: string } }) =>
          where.tenantId === 'tenant-1' ? order : null,
        ),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      payment: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      orderStatusHistory: { create: jest.fn() },
      $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
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

  it('redeems the card balance and records the gift card ledger entry', async () => {
    const result = await giftCardCharge('GC-123');

    expect(tx.giftCard.findFirst).toHaveBeenCalledWith({
      where: { code: 'GC-123', tenantId: 'tenant-1' },
    });
    expect(tx.giftCard.updateMany).toHaveBeenCalledWith({
      where: { id: 'gc-1', tenantId: 'tenant-1', status: 'ACTIVE', currentBalance: { gte: 60 } },
      data: { currentBalance: { decrement: 60 } },
    });
    expect(tx.giftCardTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        giftCardId: 'gc-1',
        type: 'REDEEM',
        amount: 60,
        balanceBefore: 60,
        balanceAfter: 0,
        referenceId: 'order-1',
        referenceType: 'ORDER',
      }),
    });
    expect(result.status).toBe(PaymentStatus.COMPLETED);
  });

  it('keeps the order open while the gift card leaves a balance', async () => {
    await giftCardCharge('GC-123');

    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: expect.objectContaining({ paidAmount: 60 }),
    });
    expect(tx.order.update.mock.calls[0][0].data.status).toBeUndefined();
    expect(tx.orderStatusHistory.create).not.toHaveBeenCalled();
  });

  it('completes the order when the gift card covers the remaining balance', async () => {
    tx.giftCard.findFirst.mockResolvedValue({ ...activeCard, currentBalance: 100 });

    await giftCardCharge('GC-123', 100);

    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: expect.objectContaining({ paidAmount: 100, status: 'COMPLETED' }),
    });
    expect(tx.orderStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'order-1',
        tenantId: 'tenant-1',
        fromStatus: 'CONFIRMED',
        toStatus: 'COMPLETED',
        changedByUserId: 'user-1',
      }),
    });
  });

  it('refuses a gift card charge larger than the order balance', async () => {
    await expect(giftCardCharge('GC-123', 500)).rejects.toThrow(
      'Payment amount exceeds remaining balance',
    );
    expect(tx.giftCard.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a gift card payment without a code', async () => {
    await expect(giftCardCharge(undefined)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.giftCard.updateMany).not.toHaveBeenCalled();
  });

  it('rejects an unknown gift card code', async () => {
    tx.giftCard.findFirst.mockResolvedValue(null);

    await expect(giftCardCharge('NOPE')).rejects.toThrow('Gift card not found');
  });

  it('rejects a gift card that is not active', async () => {
    tx.giftCard.findFirst.mockResolvedValue({ ...activeCard, status: 'EXPIRED' });

    await expect(giftCardCharge('GC-123')).rejects.toThrow('Gift card is not active');
    expect(tx.giftCard.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a gift card whose expiry has passed', async () => {
    tx.giftCard.findFirst.mockResolvedValue({
      ...activeCard,
      expiresAt: new Date(Date.now() - 86_400_000),
    });

    await expect(giftCardCharge('GC-123')).rejects.toThrow('Gift card has expired');
  });

  it('accepts a gift card that expires in the future', async () => {
    tx.giftCard.findFirst.mockResolvedValue({
      ...activeCard,
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    await expect(giftCardCharge('GC-123')).resolves.toEqual(
      expect.objectContaining({ status: PaymentStatus.COMPLETED }),
    );
  });

  it('rejects when the concurrent decrement matches no row', async () => {
    tx.giftCard.updateMany.mockResolvedValue({ count: 0 });

    await expect(giftCardCharge('GC-123')).rejects.toThrow('Gift card has insufficient balance');
    expect(tx.giftCardTransaction.create).not.toHaveBeenCalled();
  });

  it('guards the decrement with the balance so concurrent charges cannot overdraw', async () => {
    await giftCardCharge('GC-123', 60);

    const args = tx.giftCard.updateMany.mock.calls[0][0];
    expect(args.where.currentBalance).toEqual({ gte: 60 });
    expect(args.where.status).toBe('ACTIVE');
  });

  it('does not redeem a gift card from another tenant', async () => {
    tx.giftCard.findFirst.mockResolvedValue(null);

    await expect(
      service.charge(
        'order-1',
        { method: PaymentMethod.GIFT_CARD, amount: 60, reference: 'GC-123' } as never,
        'tenant-2',
        'user-1',
      ),
    ).rejects.toThrow('Order not found');
    expect(tx.giftCard.findFirst).not.toHaveBeenCalled();
  });

  it('never calls a payment provider for a gift card', async () => {
    const providerSpy = jest.spyOn(
      service as unknown as { getProviderForMethod: (m: PaymentMethod) => unknown },
      'getProviderForMethod',
    );

    await giftCardCharge('GC-123');

    expect(providerSpy).toHaveBeenCalledWith(PaymentMethod.GIFT_CARD);
    expect(providerSpy.mock.results[0].value).toBeNull();
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('rejects a wallet payment that bypasses the wallet spend flow', async () => {
    await expect(
      service.charge(
        'order-1',
        { method: PaymentMethod.WALLET, amount: 10 } as never,
        'tenant-1',
        'user-1',
      ),
    ).rejects.toThrow('WALLET payments must be processed through the customer wallet spend flow');
  });

  describe('getProviderForTenant', () => {
    it('resolves the configured stripe provider', async () => {
      await expect(service.getProviderForTenant('tenant-1')).resolves.toEqual(
        expect.objectContaining({ name: expect.any(String) }),
      );
    });
  });

  describe('getPaymentStatus', () => {
    function setStripeProvider(provider: unknown) {
      const registry = (service as unknown as { providerRegistry: Map<string, unknown> })
        .providerRegistry;
      if (provider === null) registry.delete('stripe');
      else registry.set('stripe', provider);
    }

    it('returns the gateway status for a provider reference', async () => {
      const provider = {
        getPaymentStatus: jest.fn().mockResolvedValue({
          success: true,
          data: { status: 'succeeded', amount: 1000, currency: 'usd' },
        }),
      };
      setStripeProvider(provider);

      await expect(service.getPaymentStatus('pi_1')).resolves.toEqual({
        status: 'succeeded',
        amount: 1000,
        currency: 'usd',
      });
      expect(provider.getPaymentStatus).toHaveBeenCalledWith('pi_1');
    });

    it('fails when no provider is configured', async () => {
      setStripeProvider(null);

      await expect(service.getPaymentStatus('pi_1')).rejects.toThrow(
        'No payment provider available',
      );
    });

    it('surfaces the provider error message', async () => {
      setStripeProvider({
        getPaymentStatus: jest
          .fn()
          .mockResolvedValue({ success: false, error: 'Unknown reference' }),
      });

      await expect(service.getPaymentStatus('pi_1')).rejects.toThrow('Unknown reference');
    });

    it('falls back to a generic message when the provider omits an error', async () => {
      setStripeProvider({ getPaymentStatus: jest.fn().mockResolvedValue({ success: false }) });

      await expect(service.getPaymentStatus('pi_1')).rejects.toThrow(
        'Failed to get payment status',
      );
    });
  });

  describe('findPaymentByGatewayRef', () => {
    it('refuses to guess when the reference matches payments in several tenants', async () => {
      const logger = (service as unknown as { logger: { error: (...a: unknown[]) => void } })
        .logger;
      const errorLog = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
      prisma.payment.findFirst.mockResolvedValue(null);
      Object.assign(prisma.payment, {
        findMany: jest.fn().mockResolvedValue([
          { id: 'p-1', tenantId: 'tenant-1', status: PaymentStatus.PENDING },
          { id: 'p-2', tenantId: 'tenant-2', status: PaymentStatus.PENDING },
        ]),
        update: jest.fn().mockResolvedValue({}),
      });

      const found = await (
        service as unknown as {
          findPaymentByGatewayRef: (ref: string, ctx: string) => Promise<unknown>;
        }
      ).findPaymentByGatewayRef('dup_ref', 'Webhook payment.succeeded');

      expect(found).toBeNull();
      expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('refusing to guess'));
      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'p-1' } }),
      );
    });

    it('still refuses to guess when recording the ambiguity marker fails', async () => {
      const logger = (service as unknown as { logger: { error: (...a: unknown[]) => void } })
        .logger;
      jest.spyOn(logger, 'error').mockImplementation(() => undefined);
      Object.assign(prisma.payment, {
        findMany: jest.fn().mockResolvedValue([
          { id: 'p-1', tenantId: 'tenant-1', status: PaymentStatus.PENDING },
          { id: 'p-2', tenantId: 'tenant-2', status: PaymentStatus.PENDING },
        ]),
      });
      jest
        .spyOn(
          service as unknown as {
            recordReconcileAttempt: (paymentId: string, note: string) => Promise<void>;
          },
          'recordReconcileAttempt',
        )
        .mockRejectedValue(new Error('write failed'));

      const found = await (
        service as unknown as {
          findPaymentByGatewayRef: (ref: string, ctx: string) => Promise<unknown>;
        }
      ).findPaymentByGatewayRef('dup_ref', 'Webhook payment.succeeded');

      expect(found).toBeNull();
    });

    it('returns the single matching payment', async () => {
      Object.assign(prisma.payment, {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'p-1', tenantId: 'tenant-1', status: PaymentStatus.PENDING }]),
      });

      const found = await (
        service as unknown as {
          findPaymentByGatewayRef: (ref: string, ctx: string) => Promise<unknown>;
        }
      ).findPaymentByGatewayRef('uniq_ref', 'Webhook payment.succeeded');

      expect(found).toEqual(expect.objectContaining({ id: 'p-1' }));
    });

    it('returns null when nothing matches', async () => {
      Object.assign(prisma.payment, { findMany: jest.fn().mockResolvedValue([]) });

      const found = await (
        service as unknown as {
          findPaymentByGatewayRef: (ref: string, ctx: string) => Promise<unknown>;
        }
      ).findPaymentByGatewayRef('missing_ref', 'Webhook payment.succeeded');

      expect(found).toBeNull();
    });
  });

  it('does not treat a domain error as a unique constraint violation', () => {
    const isUnique = (
      service as unknown as { isUniqueViolation: (e: unknown) => boolean }
    ).isUniqueViolation.bind(service);

    expect(isUnique(new BadRequestException('nope'))).toBe(false);
    expect(
      isUnique(
        new Prisma.PrismaClientKnownRequestError('boom', {
          code: 'P2002',
          clientVersion: '5.0.0',
        }),
      ),
    ).toBe(true);
  });
});
