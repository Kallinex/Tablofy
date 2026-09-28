import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GiftCardsService } from '../gift-cards.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { I18nService } from '../../../common/i18n/i18n.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';

describe('GiftCardsService', () => {
  let service: GiftCardsService;
  let prisma: MockPrisma;

  const fakeGiftCard = (overrides: Record<string, unknown> = {}) => ({
    id: 'gc-1',
    tenantId: testTenantId,
    code: 'GC-ABC123',
    initialBalance: 100,
    currentBalance: 100,
    currency: 'USD',
    status: 'ACTIVE',
    issueType: 'MANUAL',
    expiresAt: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const buildTx = (
    overrides: {
      findFirstResult?: unknown;
      updateManyResult?: unknown;
    } = {},
  ) => {
    const tx = {
      giftCard: {
        findFirst: jest.fn().mockResolvedValue(overrides.findFirstResult ?? null),
        updateMany: jest.fn().mockResolvedValue(overrides.updateManyResult ?? { count: 1 }),
      },
      giftCardTransaction: {
        create: jest.fn().mockResolvedValue({ id: 'tx-1' }),
      },
    };
    prisma.$transaction.mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx));
    return tx;
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GiftCardsService,
        { provide: PrismaService, useValue: createMockPrisma() },
        {
          provide: I18nService,
          useValue: { t: jest.fn((key: string) => key) },
        },
      ],
    }).compile();

    service = module.get<GiftCardsService>(GiftCardsService);
    prisma = module.get(PrismaService) as MockPrisma;
  });

  beforeEach(() => {
    prisma.reset();
    jest.clearAllMocks();
  });

  describe('redeem', () => {
    const dto = { amount: 30, referenceId: 'order-1', referenceType: 'ORDER' };

    it('should redeem atomically with a conditional balance decrement', async () => {
      const card = fakeGiftCard({ currentBalance: 100 });
      const tx = buildTx({ findFirstResult: card });

      const result = await service.redeem(testTenantId, 'gc-1', dto as never, 'en', 'user-1');

      expect(tx.giftCard.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'gc-1',
            tenantId: testTenantId,
            status: 'ACTIVE',
            currentBalance: { gte: 30 },
          },
          data: { currentBalance: { decrement: 30 } },
        }),
      );
      expect(tx.giftCardTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          giftCardId: 'gc-1',
          tenantId: testTenantId,
          type: 'REDEEM',
          amount: 30,
          balanceBefore: 100,
          balanceAfter: 70,
          referenceId: 'order-1',
          performedById: 'user-1',
        }),
      });
      expect(result).toEqual(expect.objectContaining({ id: 'gc-1', currentBalance: 70 }));
    });

    it('should reject when balance is insufficient (concurrent double-redeem is serialized)', async () => {
      buildTx({
        findFirstResult: fakeGiftCard({ currentBalance: 20 }),
        updateManyResult: { count: 0 },
      });

      await expect(
        service.redeem(testTenantId, 'gc-1', { amount: 30 } as never, 'en'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject redeeming a deactivated card', async () => {
      buildTx({ findFirstResult: fakeGiftCard({ status: 'DEACTIVATED' }) });

      await expect(
        service.redeem(testTenantId, 'gc-1', { amount: 10 } as never, 'en'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject redeeming an expired card', async () => {
      buildTx({
        findFirstResult: fakeGiftCard({ expiresAt: new Date(Date.now() - 1000) }),
      });

      await expect(
        service.redeem(testTenantId, 'gc-1', { amount: 10 } as never, 'en'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFound when card does not exist in tenant (cross-tenant blocked)', async () => {
      buildTx({ findFirstResult: null });

      await expect(
        service.redeem(testTenantId, 'gc-other-tenant', { amount: 10 } as never, 'en'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('recharge', () => {
    function buildRechargeTx(
      opts: {
        card?: Record<string, unknown>;
        after?: Record<string, unknown>;
        updateManyCount?: number;
        notFound?: boolean;
      } = {},
    ) {
      const card = opts.card ?? fakeGiftCard({ currentBalance: 100 });
      const after = opts.after ?? fakeGiftCard({ currentBalance: 130 });
      const tx = {
        giftCard: {
          // First call is the in-transaction status/expiry gate, the second is
          // the authoritative re-read after the credit.
          findFirst: opts.notFound
            ? jest.fn().mockResolvedValue(null)
            : jest.fn().mockResolvedValueOnce(card).mockResolvedValueOnce(after),
          updateMany: jest.fn().mockResolvedValue({ count: opts.updateManyCount ?? 1 }),
        },
        giftCardTransaction: {
          create: jest.fn().mockResolvedValue({ id: 'tx-1' }),
        },
      };
      prisma.$transaction.mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx));
      return tx;
    }

    it('should credit the balance conditionally on ACTIVE inside the transaction', async () => {
      const tx = buildRechargeTx();

      const result = await service.recharge(testTenantId, 'gc-1', { amount: 30 }, 'en');

      expect(tx.giftCard.updateMany).toHaveBeenCalledWith({
        where: { id: 'gc-1', tenantId: testTenantId, status: 'ACTIVE' },
        data: { currentBalance: { increment: 30 } },
      });
      expect(tx.giftCardTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'RECHARGE',
            amount: 30,
            balanceBefore: 100,
            balanceAfter: 130,
          }),
        }),
      );
      expect(result.currentBalance).toBe(130);
    });

    it('should record consecutive concurrent recharges without lost updates', async () => {
      const balances = [130, 160];
      // gate-read / after-read for the first recharge, then for the second.
      const reads = [100, 130, 130, 160];
      let call = 0;
      const tx = {
        giftCard: {
          findFirst: jest.fn().mockImplementation(() => {
            const current = reads[call] ?? 160;
            call += 1;
            return Promise.resolve(fakeGiftCard({ currentBalance: current }));
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        giftCardTransaction: {
          create: jest.fn().mockResolvedValue({ id: 'tx-1' }),
        },
      };
      prisma.$transaction.mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx));

      const first = await service.recharge(testTenantId, 'gc-1', { amount: 30 }, 'en');
      const second = await service.recharge(testTenantId, 'gc-1', { amount: 30 }, 'en');

      expect(first.currentBalance).toBe(balances[0]);
      expect(second.currentBalance).toBe(balances[1]);
      const increments = tx.giftCard.updateMany.mock.calls.map((c) => c[0].data.currentBalance);
      expect(increments).toEqual([{ increment: 30 }, { increment: 30 }]);
    });

    it('should refuse the credit when the card is deactivated between the gate and the write', async () => {
      const tx = buildRechargeTx({ updateManyCount: 0 });

      await expect(service.recharge(testTenantId, 'gc-1', { amount: 30 }, 'en')).rejects.toThrow(
        BadRequestException,
      );
      expect(tx.giftCardTransaction.create).not.toHaveBeenCalled();
    });

    it('should reject recharging a card of another tenant', async () => {
      const tx = buildRechargeTx({ notFound: true });

      await expect(service.recharge('other-tenant', 'gc-1', { amount: 30 }, 'en')).rejects.toThrow(
        NotFoundException,
      );
      expect(tx.giftCard.updateMany).not.toHaveBeenCalled();
    });

    it('should reject recharging a deactivated card', async () => {
      const tx = buildRechargeTx({
        card: fakeGiftCard({ currentBalance: 100, status: 'DEACTIVATED' }),
      });

      await expect(service.recharge(testTenantId, 'gc-1', { amount: 30 }, 'en')).rejects.toThrow(
        BadRequestException,
      );
      expect(tx.giftCard.updateMany).not.toHaveBeenCalled();
      expect(tx.giftCardTransaction.create).not.toHaveBeenCalled();
    });

    it('should reject recharging an expired card', async () => {
      const tx = buildRechargeTx({
        card: fakeGiftCard({
          currentBalance: 100,
          expiresAt: new Date(Date.now() - 1000),
        }),
      });

      await expect(service.recharge(testTenantId, 'gc-1', { amount: 30 }, 'en')).rejects.toThrow(
        BadRequestException,
      );
      expect(tx.giftCard.updateMany).not.toHaveBeenCalled();
      expect(tx.giftCardTransaction.create).not.toHaveBeenCalled();
    });
  });
});
