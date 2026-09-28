import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CampaignsService } from '../campaigns.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { QueueService } from '../../queues/queue.service';

function future(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

function past(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

/**
 * Structural stand-in for a Prisma model delegate. The shared `MockPrisma` type
 * does not expose model delegates, so naming the shape here keeps this spec
 * type-clean without depending on that broken type.
 */
type PrismaMock = {
  promotion: { findFirst: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
  promotionUsage: { count: jest.Mock; create: jest.Mock };
  $transaction: jest.Mock;
};

const percentagePromotion = {
  id: 'promo-1',
  tenantId: 'tenant-1',
  code: 'SAVE10',
  type: 'PERCENTAGE',
  value: 10,
  maxDiscount: null,
  minOrderAmount: null,
  usageLimit: null,
  usedCount: 0,
  usagePerCustomer: null,
  usagePerTenant: null,
  status: 'ACTIVE',
  startsAt: past(60),
  endsAt: future(60),
  deletedAt: null,
};

describe('CampaignsService promotion validation and redemption', () => {
  let service: CampaignsService;
  // Typed as a loose record on purpose: `tsconfig.spec.json` typecheck is
  // currently broken repo-wide because the shared Prisma mock type does not
  // expose model delegates, and a new spec file should not add to that debt.
  let prisma: PrismaMock;

  const cacheService = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
  const queueService = { add: jest.fn() };
  const auditLogsService = { log: jest.fn() };
  const eventEmitter = { emit: jest.fn() };

  beforeEach(async () => {
    prisma = {
      promotion: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      promotionUsage: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(({ data }) => ({ id: 'usage-1', ...data })),
      },
      $transaction: jest.fn(),
    };

    // Default: a pass-through transaction client, so the assertions in each test
    // are about the real query sequence rather than the transaction plumbing.
    prisma.$transaction.mockImplementation(async (arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: unknown) => Promise<unknown>)(prisma)
        : Promise.resolve(arg),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CampaignsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogsService, useValue: auditLogsService },
        { provide: CacheService, useValue: cacheService },
        { provide: QueueService, useValue: queueService },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get<CampaignsService>(CampaignsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validatePromotion', () => {
    it('rejects a missing code instead of resolving an arbitrary promotion', async () => {
      // `code` is a nullable column and the endpoint binds it with @Body('code'),
      // so the omitted case used to drop the filter and return any promotion.
      await expect(
        service.validatePromotion(undefined as unknown as string, 'tenant-1', 'customer-1', 50),
      ).rejects.toThrow(BadRequestException);
      await expect(service.validatePromotion('   ', 'tenant-1', 'customer-1', 50)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.promotion.findFirst).not.toHaveBeenCalled();
    });

    it('rejects a blank or differently-cased code rather than accepting a loose match', async () => {
      prisma.promotion.findFirst.mockResolvedValue({ ...percentagePromotion, code: null });

      await expect(
        service.validatePromotion('SAVE10', 'tenant-1', 'customer-1', 50),
      ).rejects.toThrow(NotFoundException);
    });

    it('trims surrounding whitespace on a valid code', async () => {
      prisma.promotion.findFirst.mockResolvedValue(percentagePromotion);

      const result = await service.validatePromotion('  SAVE10  ', 'tenant-1', 'customer-1', 50);

      expect(result.valid).toBe(true);
      expect(prisma.promotion.findFirst).toHaveBeenCalledWith({
        where: { code: 'SAVE10', deletedAt: null, tenantId: 'tenant-1' },
      });
    });

    it('enforces usagePerTenant, which used to be a no-op', async () => {
      prisma.promotion.findFirst.mockResolvedValue({
        ...percentagePromotion,
        usagePerTenant: 2,
      });
      prisma.promotionUsage.count.mockResolvedValue(2);

      const result = await service.validatePromotion('SAVE10', 'tenant-1', 'customer-1', 50);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Per-tenant usage limit reached');
      expect(prisma.promotionUsage.count).toHaveBeenCalledWith({
        where: { promotionId: 'promo-1', tenantId: 'tenant-1' },
      });
    });

    it('reports inactive and expired promotions', async () => {
      prisma.promotion.findFirst.mockResolvedValue({
        ...percentagePromotion,
        status: 'PAUSED',
        endsAt: past(1),
      });

      const result = await service.validatePromotion('SAVE10', 'tenant-1', 'customer-1', 50);

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining(['Promotion is not active', 'Promotion has expired']),
      );
    });
  });

  describe('usePromotion', () => {
    beforeEach(() => {
      prisma.promotion.findFirst.mockResolvedValue(percentagePromotion);
    });

    it('rounds the discount to money precision and never exceeds the order', async () => {
      prisma.promotion.findFirst.mockResolvedValue({
        ...percentagePromotion,
        type: 'PERCENTAGE',
        value: 33.333,
      });

      const result = await service.usePromotion(
        'SAVE10',
        'customer-1',
        10.1,
        'tenant-1',
        'order-1',
      );

      // 33.333% of 10.10 is 3.3663... -> 3.37, and the total stays a clean money value.
      expect(result.discountAmount).toBe(3.37);
      expect(result.finalAmount).toBe(6.73);
      expect(prisma.promotionUsage.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ discountAmount: 3.37 }) }),
      );
    });

    it('caps a FIXED discount at the order amount so finalAmount cannot go negative', async () => {
      prisma.promotion.findFirst.mockResolvedValue({
        ...percentagePromotion,
        type: 'FIXED',
        value: 50,
      });

      const result = await service.usePromotion(
        'SAVE10',
        'customer-1',
        12.5,
        'tenant-1',
        'order-1',
      );

      expect(result.discountAmount).toBe(12.5);
      expect(result.finalAmount).toBe(0);
    });

    it('claims the last usage slot with a compare-and-set and rejects the loser', async () => {
      prisma.promotion.findFirst.mockResolvedValue({
        ...percentagePromotion,
        usageLimit: 1,
        usedCount: 0,
      });
      prisma.promotion.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.usePromotion('SAVE10', 'customer-1', 50, 'tenant-1', 'order-1'),
      ).rejects.toThrow('Promotion usage limit reached');
      expect(prisma.promotionUsage.create).not.toHaveBeenCalled();
    });

    it('increments usedCount and version under the usage cap', async () => {
      prisma.promotion.findFirst.mockResolvedValue({
        ...percentagePromotion,
        usageLimit: 5,
        usedCount: 1,
      });

      await service.usePromotion('SAVE10', 'customer-1', 50, 'tenant-1', 'order-1');

      expect(prisma.promotion.updateMany).toHaveBeenCalledWith({
        where: { id: 'promo-1', deletedAt: null, usedCount: { lt: 5 } },
        data: { usedCount: { increment: 1 }, version: { increment: 1 } },
      });
    });

    it('re-checks the per-customer cap inside the transaction', async () => {
      prisma.promotion.findFirst.mockResolvedValue({ ...percentagePromotion, usagePerCustomer: 1 });
      prisma.promotionUsage.count.mockResolvedValue(1);

      await expect(
        service.usePromotion('SAVE10', 'customer-1', 50, 'tenant-1', 'order-1'),
      ).rejects.toThrow('Per-customer usage limit reached');
      expect(prisma.promotionUsage.create).not.toHaveBeenCalled();
    });

    it('re-checks the per-tenant cap inside the transaction', async () => {
      prisma.promotion.findFirst.mockResolvedValue({ ...percentagePromotion, usagePerTenant: 1 });
      prisma.promotionUsage.count.mockResolvedValue(1);

      await expect(
        service.usePromotion('SAVE10', 'customer-1', 50, 'tenant-1', 'order-1'),
      ).rejects.toThrow('Per-tenant usage limit reached');
      expect(prisma.promotionUsage.create).not.toHaveBeenCalled();
    });

    it('honours maxDiscount on a percentage promotion', async () => {
      prisma.promotion.findFirst.mockResolvedValue({
        ...percentagePromotion,
        type: 'PERCENTAGE',
        value: 50,
        maxDiscount: 8,
      });

      const result = await service.usePromotion('SAVE10', 'customer-1', 100, 'tenant-1', 'order-1');

      expect(result.discountAmount).toBe(8);
      expect(result.finalAmount).toBe(92);
    });

    it('records the usage row and emits the domain event', async () => {
      await service.usePromotion('SAVE10', 'customer-1', 50, 'tenant-1', 'order-1');

      expect(prisma.promotionUsage.create).toHaveBeenCalledWith({
        data: {
          promotionId: 'promo-1',
          customerId: 'customer-1',
          orderId: 'order-1',
          tenantId: 'tenant-1',
          discountAmount: 5,
        },
      });
      expect(auditLogsService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PROMOTION_USED', tenantId: 'tenant-1' }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'promotion.used',
        expect.objectContaining({ promotionId: 'promo-1', discountAmount: 5 }),
      );
    });
  });
});
