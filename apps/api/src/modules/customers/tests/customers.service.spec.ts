import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CustomersService } from '../customers.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { QueueService } from '../../queues/queue.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CustomersGateway } from '../customers.gateway';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockCache, MockCache } from '../../../test/mocks/cache.mock';
import { createMockQueue } from '../../../test/mocks/queue.mock';
import { createMockEventEmitter, MockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId, testUserId } from '../../../test/fixtures/auth.fixture';

describe('CustomersService', () => {
  let service: CustomersService;
  let prisma: MockPrisma;
  let auditLogs: MockAuditLogs;
  let cache: MockCache;
  let eventEmitter: MockEventEmitter;

  const mockGateway = {
    broadcastCustomerUpdate: jest.fn(),
    broadcastLoyaltyUpdate: jest.fn(),
    broadcastWalletUpdate: jest.fn(),
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: CacheService, useValue: createMockCache() },
        { provide: QueueService, useValue: createMockQueue() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
        { provide: CustomersGateway, useValue: mockGateway },
      ],
    }).compile();

    service = module.get<CustomersService>(CustomersService);
    prisma = module.get(PrismaService) as MockPrisma;
    auditLogs = module.get(AuditLogsService) as MockAuditLogs;
    cache = module.get(CacheService) as MockCache;
    eventEmitter = module.get(EventEmitter2) as MockEventEmitter;
  });

  beforeEach(() => {
    prisma.reset();
    auditLogs.reset();
    cache.reset();
    eventEmitter.reset();
    jest.clearAllMocks();
  });

  describe('create', () => {
    const dto = {
      restaurantId: 'restaurant-1',
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@test.com',
      phone: '+1234567890',
    };

    it('should create customer successfully', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);
      const fakeCustomer = { id: 'cust-1', ...dto, tenantId: testTenantId };
      prisma.customer.create.mockResolvedValue(fakeCustomer);
      prisma.membership.findUnique.mockResolvedValue(null);
      prisma.membership.create.mockResolvedValue({});
      prisma.wallet.findUnique.mockResolvedValue(null);
      prisma.wallet.create.mockResolvedValue({});
      cache.get.mockResolvedValue(null);
      prisma.customer.findFirst.mockResolvedValue({
        ...fakeCustomer,
        memberships: [],
        wallets: [],
        addresses: [],
        preferences: [],
        visitHistory: [],
        rewards: [],
        referralsMade: [],
        analytics: [],
        segmentAssignments: [],
      });

      const result = await service.create(dto as never, testTenantId, testUserId);

      expect(result.id).toBe('cust-1');
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CUSTOMER_CREATED' }),
      );
      expect(mockGateway.broadcastCustomerUpdate).toHaveBeenCalled();
    });

    it('should throw ConflictException for duplicate email', async () => {
      prisma.customer.findUnique.mockResolvedValue({ id: 'existing', deletedAt: null });

      await expect(service.create(dto as never, testTenantId, testUserId)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('findAll', () => {
    it('should return paginated customers', async () => {
      prisma.customer.findMany.mockResolvedValue([{ id: 'cust-1' }]);
      prisma.customer.count.mockResolvedValue(1);
      cache.get.mockResolvedValue(null);

      const result = (await service.findAll(
        { page: 1, limit: 20 } as never,
        testTenantId as never,
      )) as { data: unknown[] };

      expect(result.data).toHaveLength(1);
    });
  });

  describe('findById', () => {
    it('should return customer by id', async () => {
      cache.get.mockResolvedValue(null);
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1', tenantId: testTenantId });

      const result = await service.findById('cust-1', testTenantId);

      expect(result).toBeDefined();
    });

    it('should throw NotFoundException when not found', async () => {
      cache.get.mockResolvedValue(null);
      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(service.findById('nonexist', testTenantId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update customer', async () => {
      const fakeCustomer = { id: 'cust-1', tenantId: testTenantId };
      prisma.customer.findFirst.mockResolvedValue(fakeCustomer);
      prisma.customer.update.mockResolvedValue(fakeCustomer);

      const result = await service.update(
        'cust-1',
        { firstName: 'Jane' },
        testTenantId,
        testUserId,
      );

      expect(result).toBeDefined();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CUSTOMER_UPDATED' }),
      );
    });
  });

  describe('softDelete', () => {
    it('should soft delete customer', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1', tenantId: testTenantId });
      prisma.customer.update.mockResolvedValue({ id: 'cust-1', deletedAt: new Date() });

      await service.softDelete('cust-1', testTenantId, testUserId);

      expect(prisma.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      );
    });
  });

  describe('loyalty points', () => {
    it('should earn points', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1', tenantId: testTenantId });
      prisma.membership.findFirst.mockResolvedValue({
        id: 'mem-1',
        points: 100,
        tier: 'BRONZE',
        customerId: 'cust-1',
        tenantId: testTenantId,
      });
      prisma.membership.findUnique
        .mockResolvedValueOnce({
          id: 'mem-1',
          points: 100,
          tier: 'BRONZE',
          customerId: 'cust-1',
          tenantId: testTenantId,
        })
        .mockResolvedValue({
          id: 'mem-1',
          points: 150,
          tier: 'BRONZE',
          customerId: 'cust-1',
          tenantId: testTenantId,
        });
      prisma.$transaction.mockImplementation(async (fn: (tx: MockPrisma) => Promise<unknown>) =>
        fn(prisma as unknown as MockPrisma),
      );
      prisma.membership.updateMany.mockResolvedValue({ count: 1 });
      prisma.loyaltyTier.findMany.mockResolvedValue([]);
      prisma.loyaltyPointsTransaction.create.mockResolvedValue({ id: 'txn-1', balanceAfter: 150 });
      prisma.membership.update.mockResolvedValue({ id: 'mem-1', points: 150 });

      const result = await service.earnPoints(
        'cust-1',
        { points: 50, reason: 'Purchase' } as never,
        testTenantId,
        testUserId,
      );

      expect(result).toBeDefined();
      expect(prisma.membership.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ customerId: 'cust-1', tenantId: testTenantId }),
          data: expect.objectContaining({
            points: { increment: 50 },
            lifetimePoints: { increment: 50 },
          }),
        }),
      );
      expect(prisma.loyaltyPointsTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ balanceAfter: 150, type: 'EARNED' }),
        }),
      );
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'LOYALTY_POINTS_EARNED' }),
      );
    });

    it('should not lose points when two concurrent earns race (P1-07)', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1', tenantId: testTenantId });
      prisma.membership.findFirst.mockResolvedValue({
        id: 'mem-1',
        points: 100,
        tier: 'BRONZE',
        customerId: 'cust-1',
        tenantId: testTenantId,
      });
      prisma.$transaction.mockImplementation(async (fn: (tx: MockPrisma) => Promise<unknown>) =>
        fn(prisma as unknown as MockPrisma),
      );
      prisma.loyaltyTier.findMany.mockResolvedValue([]);

      const release: Array<() => void> = [];
      const barrier = new Promise<void>((resolve) => {
        release.push(resolve);
        release.push(resolve);
      });
      let claims = 0;
      prisma.membership.updateMany.mockImplementation(async () => {
        await barrier;
        claims += 1;
        return { count: 1 };
      });
      let findUniqueCalls = 0;
      prisma.membership.findUnique.mockImplementation(async () => {
        findUniqueCalls += 1;
        const points = findUniqueCalls <= 2 ? 100 : findUniqueCalls === 3 ? 150 : 200;
        return {
          id: 'mem-1',
          points,
          tier: 'BRONZE',
          customerId: 'cust-1',
          tenantId: testTenantId,
        };
      });
      prisma.loyaltyPointsTransaction.create.mockImplementation(
        (args: { data: { balanceAfter: number } }) =>
          Promise.resolve({ id: 'txn', balanceAfter: args.data.balanceAfter }),
      );

      const dto = { points: 50, reason: 'Purchase' };
      const first = service.earnPoints('cust-1', dto, testTenantId, testUserId);
      const second = service.earnPoints('cust-1', dto, testTenantId, testUserId);
      release.forEach((r) => r());
      const results = await Promise.allSettled([first, second]);

      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      expect(claims).toBe(2);
      const balanceAfters = prisma.loyaltyPointsTransaction.create.mock.calls
        .map((c) => c[0].data.balanceAfter)
        .sort((a, b) => a - b);
      expect(balanceAfters).toEqual([150, 200]);
    });

    it('should redeem points', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1', tenantId: testTenantId });
      prisma.membership.findUnique
        .mockResolvedValueOnce({
          id: 'mem-1',
          points: 200,
          tier: 'BRONZE',
          customerId: 'cust-1',
          tenantId: testTenantId,
        })
        .mockResolvedValueOnce({
          id: 'mem-1',
          points: 100,
          tier: 'BRONZE',
          customerId: 'cust-1',
          tenantId: testTenantId,
        });
      prisma.membership.updateMany.mockResolvedValue({ count: 1 });
      prisma.$transaction.mockImplementation(async (fn: (tx: MockPrisma) => Promise<unknown>) =>
        fn(prisma as unknown as MockPrisma),
      );
      prisma.loyaltyPointsTransaction.create.mockResolvedValue({
        id: 'txn-2',
        balanceAfter: 100,
      });

      const result = await service.redeemPoints(
        'cust-1',
        { points: 100 },
        testTenantId,
        testUserId,
      );

      expect(result).toBeDefined();
      expect(prisma.membership.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            customerId: 'cust-1',
            points: { gte: 100 },
          }),
          data: expect.objectContaining({ points: { decrement: 100 } }),
        }),
      );
    });

    it('should throw BadRequestException when insufficient points', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1', tenantId: testTenantId });
      prisma.membership.findUnique.mockResolvedValue({
        id: 'mem-1',
        points: 10,
        tier: 'BRONZE',
        customerId: 'cust-1',
        tenantId: testTenantId,
      });
      prisma.membership.updateMany.mockResolvedValue({ count: 0 });
      prisma.$transaction.mockImplementation(async (fn: (tx: MockPrisma) => Promise<unknown>) =>
        fn(prisma as unknown as MockPrisma),
      );

      await expect(
        service.redeemPoints('cust-1', { points: 100 }, testTenantId, testUserId),
      ).rejects.toThrow('Insufficient');

      expect(prisma.loyaltyPointsTransaction.create).not.toHaveBeenCalled();
    });

    it('should fail atomically when two concurrent redeems overspend the balance', async () => {
      prisma.membership.findUnique.mockResolvedValue({
        id: 'mem-1',
        points: 50,
        tier: 'BRONZE',
        customerId: 'cust-1',
        tenantId: testTenantId,
      });
      prisma.membership.updateMany.mockResolvedValue({ count: 0 });
      prisma.$transaction.mockImplementation(async (fn: (tx: MockPrisma) => Promise<unknown>) =>
        fn(prisma as unknown as MockPrisma),
      );

      await expect(
        service.redeemPoints('cust-1', { points: 100 }, testTenantId, testUserId),
      ).rejects.toThrow('Insufficient');

      expect(prisma.membership.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.loyaltyPointsTransaction.create).not.toHaveBeenCalled();
    });

    it('should throw ConflictException when the reference already exists (P2002)', async () => {
      prisma.membership.findUnique.mockResolvedValue({
        id: 'mem-1',
        points: 200,
        tier: 'BRONZE',
        customerId: 'cust-1',
        tenantId: testTenantId,
      });
      prisma.membership.updateMany.mockResolvedValue({ count: 1 });
      prisma.$transaction.mockImplementation(async (fn: (tx: MockPrisma) => Promise<unknown>) =>
        fn(prisma as unknown as MockPrisma),
      );
      prisma.loyaltyPointsTransaction.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.redeemPoints(
          'cust-1',
          { points: 100, referenceId: 'order-1', referenceType: 'ORDER' },
          testTenantId,
          testUserId,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('wallet', () => {
    const wallet = {
      id: 'wallet-1',
      customerId: 'cust-1',
      tenantId: testTenantId,
      balance: 100,
      currency: 'USD',
      isActive: true,
      version: 1,
      createdAt: new Date(),
      deletedAt: null,
      updatedAt: new Date(),
    };

    function mockTransactionForWallet() {
      const txWalletState = { ...wallet };
      const tx = {
        wallet: {
          update: jest.fn((args: { data: Record<string, unknown> }) => {
            const balance = args.data.balance as { increment?: number; decrement?: number };
            if (balance.increment !== undefined) txWalletState.balance += balance.increment;
            if (balance.decrement !== undefined) txWalletState.balance -= balance.decrement;
            const version = args.data.version as { increment?: number };
            if (version.increment) txWalletState.version += 1;
            return Promise.resolve({ ...txWalletState });
          }),
          updateMany: jest.fn(
            (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
              const balance = args.data.balance as { decrement: number };
              const where = args.where as { id: string; balance?: { gte?: number } };
              const current = txWalletState.balance;
              if (where.balance?.gte !== undefined && current < where.balance.gte) {
                return Promise.resolve({ count: 0 });
              }
              txWalletState.balance = current - balance.decrement;
              txWalletState.version += 1;
              return Promise.resolve({ count: 1 });
            },
          ),
          findUnique: jest.fn(() => Promise.resolve({ ...txWalletState })),
        },
        walletTransaction: {
          create: jest.fn((args: { data: Record<string, unknown> }) =>
            Promise.resolve({ id: 'txn-1', ...args.data }),
          ),
        },
      };
      prisma.$transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx));
      return { tx, state: txWalletState };
    }

    beforeEach(() => {
      prisma.wallet.findUnique.mockResolvedValue(wallet);
    });

    it('should spend with a guarded atomic conditional update (CAS)', async () => {
      const { tx } = mockTransactionForWallet();

      const result = await service.spendWallet(
        'cust-1',
        { amount: 30, description: 'Pay' },
        testTenantId,
        testUserId,
      );

      expect(tx.wallet.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'wallet-1', balance: { gte: 30 } },
          data: { balance: { decrement: 30 }, version: { increment: 1 } },
        }),
      );
      expect(result.wallet.balance).toBe(70);
      expect(tx.walletTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amount: -30, balanceBefore: 100, balanceAfter: 70 }),
        }),
      );
    });

    it('should allow spending the exact balance', async () => {
      const { tx, state } = mockTransactionForWallet();

      const result = await service.spendWallet('cust-1', { amount: 100 }, testTenantId, testUserId);

      expect(result.wallet.balance).toBe(0);
      expect(state.balance).toBe(0);
      expect(tx.walletTransaction.create).toHaveBeenCalled();
    });

    it('should reject insufficient balance and not create a transaction', async () => {
      const { tx } = mockTransactionForWallet();

      await expect(
        service.spendWallet('cust-1', { amount: 130 }, testTenantId, testUserId),
      ).rejects.toThrow(BadRequestException);

      expect(tx.walletTransaction.create).not.toHaveBeenCalled();
    });

    it('should throw ConflictException when a duplicate reference is replayed (P2002)', async () => {
      const { tx } = mockTransactionForWallet();
      tx.walletTransaction.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.spendWallet(
          'cust-1',
          { amount: 30, referenceId: 'order-1', referenceType: 'ORDER' },
          testTenantId,
          testUserId,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should reject repeated spends once the balance is exhausted', async () => {
      const { tx } = mockTransactionForWallet();

      await service.spendWallet('cust-1', { amount: 40 }, testTenantId, testUserId);
      await service.spendWallet('cust-1', { amount: 40 }, testTenantId, testUserId);
      await expect(
        service.spendWallet('cust-1', { amount: 40 }, testTenantId, testUserId),
      ).rejects.toThrow(BadRequestException);

      expect(tx.walletTransaction.create).toHaveBeenCalledTimes(2);
    });

    it('should not allow concurrent spends to double-spend the same balance', async () => {
      const { state } = mockTransactionForWallet();

      const results = await Promise.allSettled([
        service.spendWallet('cust-1', { amount: 80 }, testTenantId, testUserId),
        service.spendWallet('cust-1', { amount: 80 }, testTenantId, testUserId),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(BadRequestException);
      expect(state.balance).toBe(20);
    });

    it('should not allow concurrent exact-balance spends to overdraw', async () => {
      const { state } = mockTransactionForWallet();

      const results = await Promise.allSettled([
        service.spendWallet('cust-1', { amount: 100 }, testTenantId, testUserId),
        service.spendWallet('cust-1', { amount: 100 }, testTenantId, testUserId),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(state.balance).toBe(0);
    });

    it('should rollback within the transaction on failure', async () => {
      const { tx, state } = mockTransactionForWallet();
      prisma.$transaction.mockImplementation(async (cb: (t: unknown) => unknown) => {
        try {
          return await cb(tx);
        } catch (error) {
          state.balance = 100;
          throw error;
        }
      });

      await expect(
        service.spendWallet('cust-1', { amount: 500 }, testTenantId, testUserId),
      ).rejects.toThrow(BadRequestException);

      expect(state.balance).toBe(100);
    });

    it('should recharge with a decimal amount and record the transaction', async () => {
      const { tx } = mockTransactionForWallet();

      const result = await service.rechargeWallet(
        'cust-1',
        { amount: 0.1, description: 'Top up' },
        testTenantId,
        testUserId,
      );

      expect(tx.wallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { balance: { increment: 0.1 }, version: { increment: 1 } },
        }),
      );
      expect(result.wallet.balance).toBe(100.1);
      expect(tx.walletTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'RECHARGE', amount: 0.1, balanceAfter: 100.1 }),
        }),
      );
    });

    it('should refund with a decimal amount and record the transaction', async () => {
      const { tx } = mockTransactionForWallet();

      const result = await service.refundWallet(
        'cust-1',
        { amount: 25.5, description: 'Refund' },
        testTenantId,
        testUserId,
      );

      expect(result.wallet.balance).toBe(125.5);
      expect(tx.walletTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'REFUND', amount: 25.5, balanceAfter: 125.5 }),
        }),
      );
    });

    it('should look up the wallet scoped to the customer and tenant', async () => {
      mockTransactionForWallet();

      await service.spendWallet('cust-1', { amount: 10 }, testTenantId, testUserId);

      expect(prisma.wallet.findUnique).toHaveBeenCalledWith({
        where: {
          customerId_tenantId: { customerId: 'cust-1', tenantId: testTenantId },
        },
      });
    });
  });

  describe('getCustomerAnalytics', () => {
    it('should scope the analytics lookup to the customer tenant', async () => {
      const analytics = { id: 'analytics-1', customerId: 'cust-1', tenantId: testTenantId };
      prisma.customerAnalytics.findFirst.mockResolvedValue(analytics);

      const result = await service.getCustomerAnalytics('cust-1', testTenantId);

      expect(prisma.customerAnalytics.findFirst).toHaveBeenCalledWith({
        where: { customerId: 'cust-1', tenantId: testTenantId, deletedAt: null },
      });
      expect(result).toEqual(analytics);
    });

    it('should return a zeroed analytics object when no row exists for the tenant', async () => {
      prisma.customerAnalytics.findFirst.mockResolvedValue(null);

      const result = await service.getCustomerAnalytics('cust-1', testTenantId);

      expect(result.lifetimeValue).toBe(0);
      expect(result.totalSpend).toBe(0);
      expect(prisma.customerAnalytics.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('recomputeAnalytics', () => {
    it('should reject recomputation for a customer that does not belong to the tenant', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(service.recomputeAnalytics('cust-foreign', testTenantId)).rejects.toThrow(
        NotFoundException,
      );

      expect(prisma.customer.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cust-foreign', tenantId: testTenantId, deletedAt: null },
        }),
      );
      expect(prisma.customerAnalytics.upsert).not.toHaveBeenCalled();
    });

    it('should recompute analytics only after verifying the customer belongs to the tenant', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1', tenantId: testTenantId });
      prisma.visitHistory.findMany.mockResolvedValue([
        { orderId: 'order-1', visitedAt: new Date(), totalSpent: 42 },
      ]);
      prisma.loyaltyPointsTransaction.aggregate
        .mockResolvedValueOnce({ _sum: { points: 5 } })
        .mockResolvedValueOnce({ _sum: { points: 2 } });
      prisma.reward.count.mockResolvedValue(0);
      const upserted = {
        id: 'analytics-1',
        customerId: 'cust-1',
        tenantId: testTenantId,
        totalSpend: 42,
      };
      prisma.customerAnalytics.upsert.mockResolvedValue(upserted);

      const result = await service.recomputeAnalytics('cust-1', testTenantId);

      expect(prisma.customerAnalytics.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { customerId: 'cust-1' },
          create: expect.objectContaining({ tenantId: testTenantId }),
        }),
      );
      expect(result).toEqual(upserted);
    });
  });

  describe('adjustPoints', () => {
    beforeEach(() => {
      prisma.$transaction.mockImplementation(async (fn: (tx: MockPrisma) => Promise<unknown>) =>
        fn(prisma as unknown as MockPrisma),
      );
      prisma.membership.findUnique.mockResolvedValue({
        customerId: 'cust-1',
        tenantId: testTenantId,
        points: 100,
        tier: 'BRONZE',
      });
    });

    it('should apply the adjustment as an atomic increment inside a transaction', async () => {
      prisma.membership.updateMany.mockResolvedValue({ count: 1 });
      prisma.loyaltyPointsTransaction.create.mockImplementation(
        ({ data }: { data: { points: number } }) =>
          Promise.resolve({ id: 'lp-1', balanceAfter: 100 + data.points }),
      );

      await service.adjustPoints(
        'cust-1',
        { points: 50, reason: 'goodwill' },
        testTenantId,
        testUserId,
      );

      // The regression guard: an absolute `points: 150` computed from a
      // pre-transaction read loses a concurrent adjustment.
      expect(prisma.membership.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { customerId: 'cust-1', tenantId: testTenantId },
          data: expect.objectContaining({ points: { increment: 50 } }),
        }),
      );
      expect(prisma.membership.update).not.toHaveBeenCalled();
    });

    it('should record balanceAfter from the balance read inside the transaction', async () => {
      prisma.membership.updateMany.mockResolvedValue({ count: 1 });
      // The in-transaction re-read is authoritative, so it must reflect the
      // increment; a pre-transaction read would still return 100 here.
      prisma.membership.findUnique
        .mockResolvedValueOnce({
          customerId: 'cust-1',
          tenantId: testTenantId,
          points: 100,
          tier: 'BRONZE',
        })
        .mockResolvedValueOnce({
          customerId: 'cust-1',
          tenantId: testTenantId,
          points: 150,
          tier: 'BRONZE',
        });
      prisma.loyaltyPointsTransaction.create.mockResolvedValue({ id: 'lp-2', balanceAfter: 150 });

      const txn = await service.adjustPoints(
        'cust-1',
        { points: 50, reason: 'goodwill' },
        testTenantId,
        testUserId,
      );

      // The in-transaction read is authoritative, not the pre-transaction value.
      expect(prisma.loyaltyPointsTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ points: 50, balanceAfter: 150 }),
        }),
      );
      expect(txn.balanceAfter).toBe(150);
    });

    it('should throw NotFoundException when the membership update affects no row', async () => {
      prisma.membership.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.adjustPoints('cust-1', { points: 50, reason: 'x' }, testTenantId, testUserId),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.loyaltyPointsTransaction.create).not.toHaveBeenCalled();
    });

    it('should not create a ledger entry when the update is rejected', async () => {
      prisma.membership.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.adjustPoints('cust-1', { points: -50, reason: 'x' }, testTenantId, testUserId),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.loyaltyPointsTransaction.create).not.toHaveBeenCalled();
    });

    it('should surface a duplicate reference as a ConflictException', async () => {
      prisma.membership.updateMany.mockResolvedValue({ count: 1 });
      prisma.loyaltyPointsTransaction.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.adjustPoints(
          'cust-1',
          { points: 50, reason: 'x', referenceId: 'ref-1' },
          testTenantId,
          testUserId,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });
});
