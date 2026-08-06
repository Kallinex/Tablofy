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
});
