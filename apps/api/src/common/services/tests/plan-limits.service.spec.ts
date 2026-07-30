import { Test, TestingModule } from '@nestjs/testing';
import { PlanLimitsService } from '../plan-limits.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';

describe('PlanLimitsService', () => {
  let service: PlanLimitsService;
  let prisma: MockPrisma;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PlanLimitsService, { provide: PrismaService, useValue: createMockPrisma() }],
    }).compile();

    service = module.get<PlanLimitsService>(PlanLimitsService);
    prisma = module.get(PrismaService) as MockPrisma;
  });

  beforeEach(() => {
    prisma.reset();
    jest.clearAllMocks();
  });

  describe('checkLimit', () => {
    it('should allow when under limit', async () => {
      prisma.subscription.findUnique.mockResolvedValue({ plan: 'FREE' });
      prisma.user.count.mockResolvedValue(0);

      const result = await service.checkLimit('tenant-1', 'users');

      expect(result.allowed).toBe(true);
      expect(result.current).toBe(0);
    });

    it('should deny when over limit', async () => {
      prisma.subscription.findUnique.mockResolvedValue({ plan: 'FREE' });
      prisma.user.count.mockResolvedValue(999);

      const result = await service.checkLimit('tenant-1', 'users');

      expect(result.allowed).toBe(false);
    });

    it('should allow unlimited for ENTERPRISE', async () => {
      prisma.subscription.findUnique.mockResolvedValue({ plan: 'ENTERPRISE' });

      const result = await service.checkLimit('tenant-1', 'branches');

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(-1);
    });

    it('should throw when no subscription found', async () => {
      prisma.subscription.findUnique.mockResolvedValue(null);

      await expect(service.checkLimit('tenant-1', 'users')).rejects.toThrow(
        'No subscription found for tenant',
      );
    });
  });

  describe('getResourceCounts', () => {
    it('should return counts for all resources', async () => {
      prisma.user.count.mockResolvedValue(5);
      prisma.product.count.mockResolvedValue(20);
      prisma.table.count.mockResolvedValue(10);
      prisma.branch.count.mockResolvedValue(1);

      const result = await service.getResourceCounts('tenant-1');

      expect(result).toEqual({ users: 5, products: 20, tables: 10, branches: 1 });
    });
  });

  describe('getPlanUsage', () => {
    it('should return usage for all resources', async () => {
      prisma.subscription.findUnique.mockResolvedValue({ plan: 'FREE' });
      prisma.user.count.mockResolvedValue(1);
      prisma.product.count.mockResolvedValue(5);
      prisma.table.count.mockResolvedValue(3);
      prisma.branch.count.mockResolvedValue(1);

      const result = await service.getPlanUsage('tenant-1');

      expect(result).toHaveProperty('users');
      expect(result).toHaveProperty('products');
      expect(result).toHaveProperty('tables');
      expect(result).toHaveProperty('branches');
      expect(result.users.current).toBe(1);
    });

    it('should return empty when no subscription', async () => {
      prisma.subscription.findUnique.mockResolvedValue(null);

      const result = await service.getPlanUsage('tenant-1');

      expect(result).toEqual({});
    });
  });
});
