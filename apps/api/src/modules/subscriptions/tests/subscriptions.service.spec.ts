import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SubscriptionsService } from '../subscriptions.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { PlanLimitsService } from '../../../common/services/plan-limits.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { testTenantId, testUserId } from '../../../test/fixtures/auth.fixture';

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;
  let prisma: MockPrisma;
  let auditLogs: MockAuditLogs;
  let planLimits: {
    getPlanUsage: jest.Mock;
    getResourceCounts: jest.Mock;
  };

  const baseSubscription = {
    id: 'sub-1',
    tenantId: testTenantId,
    plan: 'FREE',
    status: 'ACTIVE',
    startDate: new Date('2025-01-01'),
    endDate: null,
    trialEndsAt: null,
    maxUsers: 5,
    maxProducts: 100,
    maxTables: 10,
    maxBranches: 1,
    monthlyPrice: 0,
    createdAt: new Date('2025-01-01'),
    deletedAt: null,
    updatedAt: new Date('2025-01-01'),
  };

  beforeAll(async () => {
    planLimits = {
      getPlanUsage: jest.fn().mockResolvedValue({}),
      getResourceCounts: jest
        .fn()
        .mockResolvedValue({ users: 0, products: 0, tables: 0, branches: 1 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: PlanLimitsService, useValue: planLimits },
      ],
    }).compile();

    service = module.get<SubscriptionsService>(SubscriptionsService);
    prisma = module.get(PrismaService) as MockPrisma;
    auditLogs = module.get(AuditLogsService) as MockAuditLogs;
  });

  beforeEach(() => {
    prisma.reset();
    auditLogs.reset();
    planLimits.getPlanUsage.mockClear().mockResolvedValue({});
    planLimits.getResourceCounts.mockClear().mockResolvedValue({
      users: 0,
      products: 0,
      tables: 0,
      branches: 1,
    });
  });

  function mockTxWith(subscriptionResult: unknown) {
    prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      const tx = {
        subscription: { update: jest.fn().mockResolvedValue(subscriptionResult) },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
      };
      return cb(tx);
    });
  }

  describe('getPlans', () => {
    it('should return all plan tiers with limits and prices', () => {
      const plans = service.getPlans();

      expect(plans).toHaveLength(5);
      expect(plans.map((p) => p.plan)).toEqual([
        'FREE',
        'BASIC',
        'STANDARD',
        'PREMIUM',
        'ENTERPRISE',
      ]);
      const free = plans.find((p) => p.plan === 'FREE');
      expect(free).toEqual({
        plan: 'FREE',
        maxUsers: 5,
        maxProducts: 100,
        maxTables: 10,
        maxBranches: 1,
        monthlyPrice: 0,
      });
      const enterprise = plans.find((p) => p.plan === 'ENTERPRISE');
      expect(enterprise?.maxBranches).toBe(-1);
    });
  });

  describe('getCurrent', () => {
    it('should return subscription with usage', async () => {
      prisma.subscription.findUnique.mockResolvedValue(baseSubscription);
      planLimits.getPlanUsage.mockResolvedValue({
        users: { current: 2, limit: 5 },
        products: { current: 10, limit: 100 },
      });

      const result = await service.getCurrent(testTenantId);

      expect(result.id).toBe('sub-1');
      expect(result.usage).toEqual({
        users: { current: 2, limit: 5 },
        products: { current: 10, limit: 100 },
      });
    });

    it('should throw NotFoundException when subscription does not exist', async () => {
      prisma.subscription.findUnique.mockResolvedValue(null);

      await expect(service.getCurrent(testTenantId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('changePlan', () => {
    it('should upgrade the plan in a transaction with audit', async () => {
      prisma.subscription.findUnique.mockResolvedValue(baseSubscription);
      const upgraded = { ...baseSubscription, plan: 'BASIC' };
      mockTxWith(upgraded);

      const result = await service.changePlan(testTenantId, { plan: 'BASIC' }, testUserId);

      expect(result.plan).toBe('BASIC');
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('should reject switching to the current plan', async () => {
      prisma.subscription.findUnique.mockResolvedValue(baseSubscription);

      await expect(service.changePlan(testTenantId, { plan: 'FREE' }, testUserId)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when subscription does not exist', async () => {
      prisma.subscription.findUnique.mockResolvedValue(null);

      await expect(service.changePlan(testTenantId, { plan: 'BASIC' }, testUserId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should block a downgrade when current usage exceeds target limits', async () => {
      prisma.subscription.findUnique.mockResolvedValue({ ...baseSubscription, plan: 'BASIC' });
      planLimits.getResourceCounts.mockResolvedValue({
        users: 30,
        products: 100,
        tables: 40,
        branches: 4,
      });

      await expect(service.changePlan(testTenantId, { plan: 'FREE' }, testUserId)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should allow a downgrade when current usage fits target limits', async () => {
      prisma.subscription.findUnique.mockResolvedValue({ ...baseSubscription, plan: 'BASIC' });
      planLimits.getResourceCounts.mockResolvedValue({
        users: 2,
        products: 10,
        tables: 4,
        branches: 1,
      });
      const downgraded = { ...baseSubscription, plan: 'FREE' };
      mockTxWith(downgraded);

      const result = await service.changePlan(testTenantId, { plan: 'FREE' }, testUserId);

      expect(result.plan).toBe('FREE');
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('should reactivate a canceled subscription on plan change', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        ...baseSubscription,
        plan: 'FREE',
        status: 'CANCELED',
        endDate: new Date(),
      });
      const reactivated = { ...baseSubscription, plan: 'BASIC', status: 'ACTIVE', endDate: null };
      mockTxWith(reactivated);

      const result = await service.changePlan(testTenantId, { plan: 'BASIC' }, testUserId);

      expect(result.status).toBe('ACTIVE');
      expect(result.endDate).toBeNull();
    });
  });

  describe('cancel', () => {
    it('should cancel the subscription with an end date and audit', async () => {
      prisma.subscription.findUnique.mockResolvedValue(baseSubscription);
      const canceled = { ...baseSubscription, status: 'CANCELED', endDate: new Date() };
      mockTxWith(canceled);

      const result = await service.cancel(testTenantId, testUserId);

      expect(result.status).toBe('CANCELED');
      expect(result.endDate).toBeInstanceOf(Date);
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SUBSCRIPTION_CANCELED_NOTIFIED' }),
      );
    });

    it('should throw when already canceled', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        ...baseSubscription,
        status: 'CANCELED',
      });

      await expect(service.cancel(testTenantId, testUserId)).rejects.toThrow(BadRequestException);
    });
  });

  describe('reactivate', () => {
    it('should reactivate a canceled subscription', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        ...baseSubscription,
        status: 'CANCELED',
        endDate: new Date(),
      });
      const active = { ...baseSubscription, status: 'ACTIVE', endDate: null };
      mockTxWith(active);

      const result = await service.reactivate(testTenantId, testUserId);

      expect(result.status).toBe('ACTIVE');
      expect(result.endDate).toBeNull();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SUBSCRIPTION_REACTIVATED_NOTIFIED' }),
      );
    });

    it('should throw when subscription is not canceled', async () => {
      prisma.subscription.findUnique.mockResolvedValue(baseSubscription);

      await expect(service.reactivate(testTenantId, testUserId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
