import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CustomersService } from '../customers.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { QueueService } from '../../queues/queue.service';
import { CustomersGateway } from '../customers.gateway';

const TENANT = 'tenant-1';
const USER = 'user-1';
const CUSTOMER_ID = 'cust-1';

const customerFixture = { id: CUSTOMER_ID, tenantId: TENANT, firstName: 'Ada' };

const membershipFixture = {
  id: 'mem-1',
  customerId: CUSTOMER_ID,
  tenantId: TENANT,
  tier: 'BRONZE',
  points: 120,
  lifetimePoints: 400,
  totalVisits: 3,
  totalSpent: 90,
};

describe('CustomersService loyalty, wallet and segment operations', () => {
  let service: CustomersService;
  let prisma: Record<string, Record<string, jest.Mock>>;
  let cacheService: { get: jest.Mock; set: jest.Mock; delete: jest.Mock };
  let auditLogs: { log: jest.Mock };
  let gateway: Record<string, jest.Mock>;

  const tx = {
    membership: {
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    loyaltyPointsTransaction: { create: jest.fn() },
    wallet: { findUnique: jest.fn(), update: jest.fn() },
    walletTransaction: { create: jest.fn() },
  };

  const program = {
    referrerPoints: 60,
    referredPoints: 30,
    pointsExpireDays: 90,
    tiers: [{ tier: 'BRONZE', minPoints: 0, maxPoints: 499, multiplier: 1 }],
  };

  const membershipTiers = [{ tier: 'BRONZE', minPoints: 0, maxPoints: 999, multiplier: 1 }];

  const primeTransaction = (balanceAfter = 120) => {
    tx.membership.updateMany.mockResolvedValue({ count: 1 });
    tx.membership.findUnique.mockResolvedValue({ points: balanceAfter });
    tx.loyaltyPointsTransaction.create.mockResolvedValue({
      id: 'txn-1',
      balanceAfter,
      points: 100,
    });
  };

  beforeEach(async () => {
    prisma = {
      customer: {
        findFirst: jest.fn().mockResolvedValue(customerFixture),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(customerFixture),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
      customerAddress: {
        findFirst: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'addr-1' }),
        update: jest.fn().mockResolvedValue({ id: 'addr-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        delete: jest.fn().mockResolvedValue({}),
      },
      customerPreference: {
        findUnique: jest.fn(),
        upsert: jest.fn().mockResolvedValue({ id: 'pref-1' }),
        delete: jest.fn().mockResolvedValue({}),
      },
      membership: {
        findUnique: jest.fn().mockResolvedValue(membershipFixture),
        create: jest.fn().mockResolvedValue(membershipFixture),
        update: jest.fn().mockResolvedValue({ ...membershipFixture, tier: 'SILVER' }),
        updateMany: jest.fn(),
      },
      membershipHistory: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({}),
      },
      loyaltyTier: { findMany: jest.fn().mockResolvedValue(membershipTiers) },
      loyaltyProgram: { findUnique: jest.fn().mockResolvedValue(program) },
      loyaltyPointsTransaction: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _sum: { points: 0 } }),
        create: jest.fn().mockResolvedValue({}),
      },
      reward: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'reward-1' }),
        update: jest.fn().mockResolvedValue({ id: 'reward-1', status: 'REDEEMED' }),
        count: jest.fn().mockResolvedValue(0),
      },
      wallet: {
        findUnique: jest.fn().mockResolvedValue({ id: 'wallet-1', customerId: CUSTOMER_ID }),
        create: jest.fn().mockResolvedValue({ id: 'wallet-1' }),
        update: jest.fn(),
      },
      walletTransaction: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
      },
      referral: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'ref-1' }),
        update: jest.fn().mockResolvedValue({ id: 'ref-1', status: 'REWARDED' }),
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _sum: { rewardPoints: 0 } }),
      },
      customerSegment: {
        findFirst: jest.fn().mockResolvedValue({ id: 'seg-1', tenantId: TENANT }),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'seg-1' }),
        update: jest.fn().mockResolvedValue({ id: 'seg-1' }),
        delete: jest.fn().mockResolvedValue({}),
      },
      customerSegmentAssignment: {
        findUnique: jest.fn(),
        upsert: jest.fn().mockResolvedValue({ id: 'asg-1' }),
        delete: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      visitHistory: {
        create: jest.fn().mockResolvedValue({ id: 'visit-1' }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      customerAnalytics: { upsert: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(),
    };

    tx.membership.updateMany.mockReset();
    tx.membership.findUnique.mockReset();
    tx.membership.update.mockReset();
    tx.loyaltyPointsTransaction.create.mockReset();
    prisma.$transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx));

    cacheService = {
      get: jest
        .fn()
        .mockImplementation((_tenant: string, key: string) =>
          Promise.resolve(key === `customer:${CUSTOMER_ID}` ? customerFixture : null),
        ),
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };

    auditLogs = { log: jest.fn().mockResolvedValue(undefined) };
    gateway = {
      broadcastCustomerUpdate: jest.fn(),
      broadcastLoyaltyUpdate: jest.fn(),
      broadcastWalletUpdate: jest.fn(),
      broadcastMembershipUpdate: jest.fn(),
      broadcastRewardUpdate: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogsService, useValue: auditLogs },
        { provide: CacheService, useValue: cacheService },
        { provide: QueueService, useValue: { add: jest.fn() } },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: CustomersGateway, useValue: gateway },
      ],
    }).compile();

    service = module.get<CustomersService>(CustomersService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('restore', () => {
    it('reactivates a soft deleted customer and broadcasts the change', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: CUSTOMER_ID, deletedAt: new Date() });

      await service.restore(CUSTOMER_ID, TENANT, USER);

      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: CUSTOMER_ID },
        data: { deletedAt: null, status: 'ACTIVE' },
      });
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CUSTOMER_RESTORED' }),
      );
      expect(gateway.broadcastCustomerUpdate).toHaveBeenCalledWith(TENANT, 'customer.restored', {
        id: CUSTOMER_ID,
      });
    });

    it('rejects restoring a customer that is not deleted', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(service.restore(CUSTOMER_ID, TENANT, USER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('addresses', () => {
    const dto = {
      label: 'Home',
      address: '1 Main St',
      city: 'Cairo',
      state: 'C',
      zipCode: '1000',
      country: 'EG',
    } as never;

    it('clears the previous default before creating a new default address', async () => {
      await service.createAddress(
        CUSTOMER_ID,
        { ...(dto as object), isDefault: true } as never,
        TENANT,
      );

      expect(prisma.customerAddress.updateMany).toHaveBeenCalledWith({
        where: { customerId: CUSTOMER_ID, isDefault: true },
        data: { isDefault: false },
      });
      expect(prisma.customerAddress.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isDefault: true }) }),
      );
    });

    it('defaults isDefault to false when the flag is omitted', async () => {
      await service.createAddress(CUSTOMER_ID, dto, TENANT);

      expect(prisma.customerAddress.updateMany).not.toHaveBeenCalled();
      expect(prisma.customerAddress.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isDefault: false }) }),
      );
    });

    it('rejects creating an address for a customer in another tenant', async () => {
      cacheService.get.mockResolvedValue(null);
      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(service.createAddress(CUSTOMER_ID, dto, TENANT)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('updates an address and clears the previous default', async () => {
      prisma.customerAddress.findFirst.mockResolvedValue({ id: 'addr-1', customerId: CUSTOMER_ID });

      await service.updateAddress(
        'addr-1',
        { ...(dto as object), isDefault: true } as never,
        TENANT,
      );

      expect(prisma.customerAddress.updateMany).toHaveBeenCalledWith({
        where: { customerId: CUSTOMER_ID, isDefault: true },
        data: { isDefault: false },
      });
      expect(prisma.customerAddress.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'addr-1' } }),
      );
    });

    it('updates an address without touching defaults', async () => {
      prisma.customerAddress.findFirst.mockResolvedValue({ id: 'addr-1', customerId: CUSTOMER_ID });

      await service.updateAddress('addr-1', { city: 'Giza' } as never, TENANT);

      expect(prisma.customerAddress.updateMany).not.toHaveBeenCalled();
    });

    it('rejects updating an address that belongs to another tenant', async () => {
      prisma.customerAddress.findFirst.mockResolvedValue(null);

      await expect(service.updateAddress('addr-1', dto, TENANT)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('deletes an address owned by the tenant', async () => {
      prisma.customerAddress.findFirst.mockResolvedValue({ id: 'addr-1' });

      await service.deleteAddress('addr-1', TENANT);

      expect(prisma.customerAddress.delete).toHaveBeenCalledWith({ where: { id: 'addr-1' } });
    });

    it('rejects deleting an address that does not exist', async () => {
      prisma.customerAddress.findFirst.mockResolvedValue(null);

      await expect(service.deleteAddress('addr-1', TENANT)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('preferences', () => {
    it('upserts the preference keyed by customer and key', async () => {
      await service.setPreference(CUSTOMER_ID, { key: 'language', value: 'ar' } as never, TENANT);

      expect(prisma.customerPreference.upsert).toHaveBeenCalledWith({
        where: { customerId_key: { customerId: CUSTOMER_ID, key: 'language' } },
        update: { value: 'ar' },
        create: { customerId: CUSTOMER_ID, tenantId: TENANT, key: 'language', value: 'ar' },
      });
    });

    it('deletes an existing preference', async () => {
      prisma.customerPreference.findUnique.mockResolvedValue({ id: 'pref-1' });

      await service.deletePreference(CUSTOMER_ID, 'language', TENANT);

      expect(prisma.customerPreference.delete).toHaveBeenCalledWith({
        where: { customerId_key: { customerId: CUSTOMER_ID, key: 'language' } },
      });
    });

    it('rejects deleting a preference that was never set', async () => {
      prisma.customerPreference.findUnique.mockResolvedValue(null);

      await expect(
        service.deletePreference(CUSTOMER_ID, 'language', TENANT),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('points history and balance', () => {
    it('paginates the points ledger', async () => {
      prisma.loyaltyPointsTransaction.count.mockResolvedValue(45);

      const result = await service.getPointHistory(CUSTOMER_ID, TENANT, 2, 20);

      expect(result.meta).toEqual({
        total: 45,
        page: 2,
        limit: 20,
        totalPages: 3,
        hasNext: true,
        hasPrevious: true,
      });
      expect(prisma.loyaltyPointsTransaction.findMany).toHaveBeenCalledWith({
        where: { customerId: CUSTOMER_ID, tenantId: TENANT },
        skip: 20,
        take: 20,
        orderBy: { createdAt: 'desc' },
      });
    });

    it('marks the last page as having no next page', async () => {
      prisma.loyaltyPointsTransaction.count.mockResolvedValue(40);

      const result = await service.getPointHistory(CUSTOMER_ID, TENANT, 2, 20);

      expect(result.meta.hasNext).toBe(false);
    });

    it('reads the points balance from the cache', async () => {
      cacheService.get.mockResolvedValue({ points: 5, tier: 'GOLD' });

      await expect(service.getPointsBalance(CUSTOMER_ID, TENANT)).resolves.toEqual({
        points: 5,
        tier: 'GOLD',
      });
      expect(prisma.membership.findUnique).not.toHaveBeenCalled();
    });

    it('returns a bronze starter balance when there is no membership', async () => {
      prisma.membership.findUnique.mockResolvedValue(null);

      await expect(service.getPointsBalance(CUSTOMER_ID, TENANT)).resolves.toEqual({
        points: 0,
        tier: 'BRONZE',
        lifetimePoints: 0,
      });
    });

    it('returns and caches the membership balance', async () => {
      const result = await service.getPointsBalance(CUSTOMER_ID, TENANT);

      expect(result).toEqual({
        points: 120,
        tier: 'BRONZE',
        lifetimePoints: 400,
      });
      expect(cacheService.set).toHaveBeenCalledWith(TENANT, `loyalty:${CUSTOMER_ID}`, result, 120);
    });

    it('applies the tier multiplier when earning points', async () => {
      primeTransaction();
      prisma.loyaltyProgram.findUnique.mockResolvedValue({
        ...program,
        tiers: [{ tier: 'BRONZE', minPoints: 0, maxPoints: 499, multiplier: 2 }],
      });

      await service.earnPoints(CUSTOMER_ID, { points: 50 } as never, TENANT, USER);

      expect(tx.loyaltyPointsTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ points: 100, balanceAfter: 120 }),
        }),
      );
    });
  });

  describe('membership', () => {
    it('returns the membership with its customer', async () => {
      await service.getMembership(CUSTOMER_ID, TENANT);

      expect(prisma.membership.findUnique).toHaveBeenCalledWith({
        where: { customerId_tenantId: { customerId: CUSTOMER_ID, tenantId: TENANT } },
        include: { customer: true },
      });
    });

    it('rejects when the customer has no membership', async () => {
      prisma.membership.findUnique.mockResolvedValue(null);

      await expect(service.getMembership(CUSTOMER_ID, TENANT)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('creates a bronze membership before upgrading', async () => {
      prisma.membership.findUnique.mockResolvedValueOnce(null).mockResolvedValue(membershipFixture);

      await service.upgradeMembership(CUSTOMER_ID, { tier: 'SILVER' } as never, TENANT, USER);

      expect(prisma.membership.create).toHaveBeenCalledWith({
        data: { customerId: CUSTOMER_ID, tenantId: TENANT, tier: 'BRONZE' },
      });
      expect(prisma.membershipHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          fromTier: 'BRONZE',
          toTier: 'SILVER',
          reason: 'Manual upgrade',
        }),
      });
    });

    it('records the supplied upgrade reason', async () => {
      await service.upgradeMembership(
        CUSTOMER_ID,
        { tier: 'SILVER', reason: 'Goodwill' } as never,
        TENANT,
        USER,
      );

      expect(prisma.membershipHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ reason: 'Goodwill' }),
      });
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'MEMBERSHIP_UPGRADED',
          oldValues: { tier: 'BRONZE' },
        }),
      );
      expect(gateway.broadcastMembershipUpdate).toHaveBeenCalledWith(TENANT, 'membership.changed', {
        customerId: CUSTOMER_ID,
        fromTier: 'BRONZE',
        toTier: 'SILVER',
      });
    });

    it('returns the fifty most recent membership changes', async () => {
      await service.getMembershipHistory(CUSTOMER_ID, TENANT);

      expect(prisma.membershipHistory.findMany).toHaveBeenCalledWith({
        where: { customerId: CUSTOMER_ID, tenantId: TENANT },
        orderBy: { changedAt: 'desc' },
        take: 50,
      });
    });

    it('lists the loyalty tiers ordered by their minimum points', async () => {
      await service.getAvailableTiers(TENANT);

      expect(prisma.loyaltyTier.findMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT },
        orderBy: { minPoints: 'asc' },
      });
    });
  });

  describe('rewards', () => {
    it('creates an active reward and audits it', async () => {
      await service.createReward(
        CUSTOMER_ID,
        { type: 'DISCOUNT', title: '10% off', code: 'SAVE10' } as never,
        TENANT,
        USER,
      );

      expect(prisma.reward.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'ACTIVE', code: 'SAVE10' }),
        }),
      );
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'REWARD_CREATED' }),
      );
    });

    it('redeems an active reward', async () => {
      prisma.reward.findFirst.mockResolvedValue({
        id: 'reward-1',
        status: 'ACTIVE',
        customerId: CUSTOMER_ID,
        expiredAt: null,
      });

      await service.redeemReward('reward-1', TENANT, USER);

      expect(prisma.reward.update).toHaveBeenCalledWith({
        where: { id: 'reward-1' },
        data: { status: 'REDEEMED', redeemedAt: expect.any(Date) },
      });
      expect(gateway.broadcastRewardUpdate).toHaveBeenCalledWith(TENANT, 'reward.redeemed', {
        rewardId: 'reward-1',
        customerId: CUSTOMER_ID,
      });
    });

    it('rejects redeeming a reward that is not active', async () => {
      prisma.reward.findFirst.mockResolvedValue({ id: 'reward-1', status: 'CANCELLED' });

      await expect(service.redeemReward('reward-1', TENANT, USER)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('marks an expired reward as expired and refuses redemption', async () => {
      prisma.reward.findFirst.mockResolvedValue({
        id: 'reward-1',
        status: 'ACTIVE',
        expiredAt: new Date(Date.now() - 1000),
      });

      await expect(service.redeemReward('reward-1', TENANT, USER)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.reward.update).toHaveBeenCalledWith({
        where: { id: 'reward-1' },
        data: { status: 'EXPIRED' },
      });
    });

    it('rejects redeeming a reward from another tenant', async () => {
      prisma.reward.findFirst.mockResolvedValue(null);

      await expect(service.redeemReward('reward-1', TENANT, USER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('cancels a reward', async () => {
      prisma.reward.findFirst.mockResolvedValue({ id: 'reward-1', customerId: CUSTOMER_ID });

      await service.cancelReward('reward-1', TENANT);

      expect(prisma.reward.update).toHaveBeenCalledWith({
        where: { id: 'reward-1' },
        data: { status: 'CANCELLED' },
      });
      expect(cacheService.delete).toHaveBeenCalledWith(TENANT, `customer:${CUSTOMER_ID}`);
    });

    it('rejects cancelling a reward that does not exist', async () => {
      prisma.reward.findFirst.mockResolvedValue(null);

      await expect(service.cancelReward('reward-1', TENANT)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('filters rewards by status when one is supplied', async () => {
      await service.getCustomerRewards(CUSTOMER_ID, TENANT, 'ACTIVE' as never);

      expect(prisma.reward.findMany).toHaveBeenCalledWith({
        where: { customerId: CUSTOMER_ID, tenantId: TENANT, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('returns every reward when no status filter is supplied', async () => {
      await service.getCustomerRewards(CUSTOMER_ID, TENANT);

      expect(prisma.reward.findMany).toHaveBeenCalledWith({
        where: { customerId: CUSTOMER_ID, tenantId: TENANT },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('wallet', () => {
    it('returns the wallet with its twenty most recent transactions', async () => {
      await service.getWallet(CUSTOMER_ID, TENANT);

      expect(prisma.wallet.findUnique).toHaveBeenCalledWith({
        where: { customerId_tenantId: { customerId: CUSTOMER_ID, tenantId: TENANT } },
        include: { transactions: { orderBy: { createdAt: 'desc' }, take: 20 } },
      });
    });

    it('rejects reading a wallet that does not exist', async () => {
      prisma.wallet.findUnique.mockResolvedValue(null);

      await expect(service.getWallet(CUSTOMER_ID, TENANT)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('paginates the wallet ledger', async () => {
      prisma.walletTransaction.count.mockResolvedValue(5);

      const result = await service.getWalletTransactions(CUSTOMER_ID, TENANT, 1, 5);

      expect(result.meta).toEqual({
        total: 5,
        page: 1,
        limit: 5,
        totalPages: 1,
        hasNext: false,
        hasPrevious: false,
      });
      expect(prisma.walletTransaction.findMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-1' },
        skip: 0,
        take: 5,
        orderBy: { createdAt: 'desc' },
      });
    });

    it('rejects paginating a wallet that does not exist', async () => {
      prisma.wallet.findUnique.mockResolvedValue(null);

      await expect(service.getWalletTransactions(CUSTOMER_ID, TENANT)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('referrals', () => {
    it('creates a pending referral', async () => {
      await service.createReferral(
        CUSTOMER_ID,
        { code: 'FRIEND10', referredEmail: 'f@x.com' } as never,
        TENANT,
        USER,
      );

      expect(prisma.referral.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING' }) }),
      );
    });

    it('rejects a duplicate referral code', async () => {
      prisma.referral.findUnique.mockResolvedValue({ id: 'ref-0' });

      await expect(
        service.createReferral(CUSTOMER_ID, { code: 'FRIEND10' } as never, TENANT, USER),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('awards both sides of the referral using the programme points', async () => {
      prisma.referral.findFirst.mockResolvedValue({
        id: 'ref-1',
        referrerId: CUSTOMER_ID,
        referredId: 'cust-2',
      });
      primeTransaction();

      await service.completeReferral('ref-1', TENANT);

      expect(tx.loyaltyPointsTransaction.create).toHaveBeenCalledTimes(2);
      expect(tx.loyaltyPointsTransaction.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ points: 30 }) }),
      );
      expect(prisma.referral.update).toHaveBeenCalledWith({
        where: { id: 'ref-1' },
        data: expect.objectContaining({ status: 'REWARDED', rewardGiven: true, rewardPoints: 60 }),
      });
    });

    it('falls back to the default points when the tenant has no programme', async () => {
      prisma.referral.findFirst.mockResolvedValue({
        id: 'ref-1',
        referrerId: CUSTOMER_ID,
        referredId: null,
      });
      prisma.loyaltyProgram.findUnique.mockResolvedValue(null);
      primeTransaction();

      await service.completeReferral('ref-1', TENANT);

      expect(tx.loyaltyPointsTransaction.create).toHaveBeenCalledTimes(1);
      expect(prisma.referral.update).toHaveBeenCalledWith({
        where: { id: 'ref-1' },
        data: expect.objectContaining({ rewardPoints: 50 }),
      });
    });

    it('rejects completing a referral from another tenant', async () => {
      prisma.referral.findFirst.mockResolvedValue(null);

      await expect(service.completeReferral('ref-1', TENANT)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('summarises referral counts and points', async () => {
      prisma.referral.count
        .mockResolvedValueOnce(4)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(2);
      prisma.referral.aggregate.mockResolvedValue({ _sum: { rewardPoints: 120 } });

      await expect(service.getReferralStats(CUSTOMER_ID, TENANT)).resolves.toEqual({
        total: 4,
        rewarded: 2,
        pending: 2,
        pointsEarned: 120,
      });
    });

    it('reports zero points when no referral was rewarded', async () => {
      prisma.referral.aggregate.mockResolvedValue({ _sum: { rewardPoints: null } });

      const result = await service.getReferralStats(CUSTOMER_ID, TENANT);

      expect(result.pointsEarned).toBe(0);
    });
  });

  describe('segments', () => {
    it('creates a custom segment with rules stored as JSON', async () => {
      await service.createSegment({ name: 'VIPs', rules: { minSpend: 100 } } as never, TENANT);

      expect(prisma.customerSegment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT,
          name: 'VIPs',
          type: 'CUSTOM',
          rules: { minSpend: 100 },
          isDynamic: false,
          isActive: true,
        }),
      });
    });

    it('falls back to a null rules value when none are supplied', async () => {
      await service.createSegment({ name: 'All' } as never, TENANT);

      const [args] = prisma.customerSegment.create.mock.calls[0];
      expect(args.data.type).toBe('CUSTOM');
    });

    it('updates a segment', async () => {
      await service.updateSegment('seg-1', { name: 'Renamed' } as never, TENANT);

      expect(prisma.customerSegment.update).toHaveBeenCalledWith({
        where: { id: 'seg-1' },
        data: expect.objectContaining({ name: 'Renamed' }),
      });
    });

    it('rejects updating a segment from another tenant', async () => {
      prisma.customerSegment.findFirst.mockResolvedValue(null);

      await expect(
        service.updateSegment('seg-1', { name: 'Renamed' } as never, TENANT),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('deletes a segment together with its assignments', async () => {
      await service.deleteSegment('seg-1', TENANT);

      expect(prisma.customerSegmentAssignment.deleteMany).toHaveBeenCalledWith({
        where: { segmentId: 'seg-1' },
      });
      expect(prisma.customerSegment.delete).toHaveBeenCalledWith({ where: { id: 'seg-1' } });
    });

    it('rejects deleting a segment that does not exist', async () => {
      prisma.customerSegment.findFirst.mockResolvedValue(null);

      await expect(service.deleteSegment('seg-1', TENANT)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('serves the segment list from cache', async () => {
      cacheService.get.mockResolvedValue([{ id: 'seg-1' }]);

      await expect(service.listSegments(TENANT)).resolves.toEqual([{ id: 'seg-1' }]);
      expect(prisma.customerSegment.findMany).not.toHaveBeenCalled();
    });

    it('loads and caches the segment list with assignment counts', async () => {
      prisma.customerSegment.findMany.mockResolvedValue([{ id: 'seg-1' }]);

      const result = await service.listSegments(TENANT);

      expect(prisma.customerSegment.findMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT },
        include: { _count: { select: { assignments: true } } },
        orderBy: { name: 'asc' },
      });
      expect(cacheService.set).toHaveBeenCalledWith(TENANT, 'segments:list', result, 300);
    });

    it('assigns a customer to a segment', async () => {
      await service.assignCustomerToSegment(CUSTOMER_ID, 'seg-1', TENANT);

      expect(prisma.customerSegmentAssignment.upsert).toHaveBeenCalledWith({
        where: { customerId_segmentId: { customerId: CUSTOMER_ID, segmentId: 'seg-1' } },
        update: {},
        create: { customerId: CUSTOMER_ID, segmentId: 'seg-1', tenantId: TENANT },
      });
      expect(cacheService.delete).toHaveBeenCalledWith(TENANT, 'segments:list');
    });

    it('rejects assigning a customer to a segment from another tenant', async () => {
      prisma.customerSegment.findFirst.mockResolvedValue(null);

      await expect(
        service.assignCustomerToSegment(CUSTOMER_ID, 'seg-1', TENANT),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('removes a customer from a segment', async () => {
      prisma.customerSegmentAssignment.findUnique.mockResolvedValue({ id: 'asg-1' });

      await service.removeCustomerFromSegment(CUSTOMER_ID, 'seg-1', TENANT);

      expect(prisma.customerSegmentAssignment.delete).toHaveBeenCalledWith({
        where: { customerId_segmentId: { customerId: CUSTOMER_ID, segmentId: 'seg-1' } },
      });
    });

    it('rejects removing an assignment that does not exist', async () => {
      prisma.customerSegmentAssignment.findUnique.mockResolvedValue(null);

      await expect(
        service.removeCustomerFromSegment(CUSTOMER_ID, 'seg-1', TENANT),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('bulk assigns and skips the customers that fail', async () => {
      prisma.customerSegmentAssignment.upsert
        .mockResolvedValueOnce({ id: 'asg-1' })
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ id: 'asg-3' });

      const result = await service.bulkAssignSegment(
        'seg-1',
        { customerIds: ['c1', 'c2', 'c3'] } as never,
        TENANT,
      );

      expect(result).toEqual([{ id: 'asg-1' }, { id: 'asg-3' }]);
      expect(cacheService.delete).toHaveBeenCalledWith(TENANT, 'segments:list');
    });

    it('rejects a bulk assign to a segment from another tenant', async () => {
      prisma.customerSegment.findFirst.mockResolvedValue(null);

      await expect(
        service.bulkAssignSegment('seg-1', { customerIds: ['c1'] } as never, TENANT),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('analytics recomputation', () => {
    it('aggregates visits, spend and reward usage', async () => {
      prisma.visitHistory.findMany.mockResolvedValue([
        {
          id: 'v1',
          orderId: 'o1',
          totalSpent: 30,
          visitedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        {
          id: 'v2',
          orderId: null,
          totalSpent: 10,
          visitedAt: new Date('2026-02-01T00:00:00.000Z'),
        },
      ]);
      prisma.loyaltyPointsTransaction.aggregate
        .mockResolvedValueOnce({ _sum: { points: 200 } })
        .mockResolvedValueOnce({ _sum: { points: -50 } });
      prisma.reward.count.mockResolvedValue(2);

      await service.recomputeAnalytics(CUSTOMER_ID, TENANT);

      const [args] = prisma.customerAnalytics.upsert.mock.calls[0];
      expect(args.create).toEqual(
        expect.objectContaining({
          totalVisits: 2,
          totalSpend: 40,
          totalOrders: 1,
          averageOrderValue: 40,
          lastVisitAt: new Date('2026-02-01T00:00:00.000Z'),
          rewardUsageCount: 2,
          rewardPointsEarned: 200,
          rewardPointsRedeemed: 50,
        }),
      );
    });

    it('reports zeroed analytics for a customer with no visits', async () => {
      await service.recomputeAnalytics(CUSTOMER_ID, TENANT);

      const [args] = prisma.customerAnalytics.upsert.mock.calls[0];
      expect(args.create).toEqual(
        expect.objectContaining({
          totalVisits: 0,
          totalSpend: 0,
          averageOrderValue: 0,
          lastVisitAt: null,
          daysSinceLastVisit: 0,
        }),
      );
    });

    it('rejects recomputing analytics for a deleted customer', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(service.recomputeAnalytics(CUSTOMER_ID, TENANT)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('visits', () => {
    it('records a visit and bumps the membership counters', async () => {
      await service.recordVisit(
        CUSTOMER_ID,
        { orderId: 'o1', totalSpent: 45, itemsCount: 3, branchId: 'b1' },
        TENANT,
      );

      expect(prisma.visitHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          customerId: CUSTOMER_ID,
          orderId: 'o1',
          totalSpent: 45,
          itemsCount: 3,
        }),
      });
      expect(prisma.membership.update).toHaveBeenCalledWith({
        where: { customerId_tenantId: { customerId: CUSTOMER_ID, tenantId: TENANT } },
        data: {
          totalVisits: { increment: 1 },
          totalSpent: { increment: 45 },
          lastActivityAt: expect.any(Date),
        },
      });
    });

    it('records a visit with zeroed totals when none are supplied', async () => {
      await service.recordVisit(CUSTOMER_ID, {}, TENANT);

      expect(prisma.visitHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ totalSpent: 0, itemsCount: 0 }),
      });
    });

    it('rejects recording a visit for an unknown customer', async () => {
      cacheService.get.mockResolvedValue(null);
      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(service.recordVisit(CUSTOMER_ID, {}, TENANT)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('paginates the visit history newest first', async () => {
      prisma.visitHistory.count.mockResolvedValue(21);

      const result = await service.getVisitHistory(CUSTOMER_ID, TENANT, 2, 20);

      expect(result.meta).toEqual({
        total: 21,
        page: 2,
        limit: 20,
        totalPages: 2,
        hasNext: false,
        hasPrevious: true,
      });
      expect(prisma.visitHistory.findMany).toHaveBeenCalledWith({
        where: { customerId: CUSTOMER_ID, tenantId: TENANT },
        skip: 20,
        take: 20,
        orderBy: { visitedAt: 'desc' },
      });
    });
  });

  describe('marketing lists and export', () => {
    it('returns active customers that have an email', async () => {
      await service.getEmailList(TENANT);

      const [args] = prisma.customer.findMany.mock.calls[0];
      expect(args.where).toEqual({
        tenantId: TENANT,
        deletedAt: null,
        email: { not: null },
        status: 'ACTIVE',
      });
      expect(args.select).toEqual({
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        language: true,
      });
    });

    it('narrows the email list to a segment', async () => {
      await service.getEmailList(TENANT, 'seg-1');

      const [args] = prisma.customer.findMany.mock.calls[0];
      expect(args.where.segmentAssignments).toEqual({ some: { segmentId: 'seg-1' } });
    });

    it('returns active customers that have a phone', async () => {
      await service.getSmsList(TENANT);

      const [args] = prisma.customer.findMany.mock.calls[0];
      expect(args.where).toEqual({
        tenantId: TENANT,
        deletedAt: null,
        phone: { not: null },
        status: 'ACTIVE',
      });
      expect(args.select).toEqual({ id: true, phone: true, firstName: true, lastName: true });
    });

    it('narrows the sms list to a segment', async () => {
      await service.getSmsList(TENANT, 'seg-1');

      const [args] = prisma.customer.findMany.mock.calls[0];
      expect(args.where.segmentAssignments).toEqual({ some: { segmentId: 'seg-1' } });
    });

    it('defaults the export to json rows', async () => {
      const rows = [{ id: 'c1' }];
      prisma.customer.findMany.mockResolvedValue(rows);

      await expect(service.exportCustomers(TENANT)).resolves.toEqual(rows);
      const [args] = prisma.customer.findMany.mock.calls[0];
      expect(args.where).toEqual({ tenantId: TENANT, deletedAt: null });
    });

    it('exports a csv with membership and analytics columns', async () => {
      prisma.customer.findMany.mockResolvedValue([
        {
          id: 'c1',
          firstName: 'Ada',
          lastName: 'Lovelace',
          email: 'ada@x.com',
          phone: null,
          status: 'ACTIVE',
          createdAt: new Date('2026-01-05T00:00:00.000Z'),
          memberships: [{ tier: 'GOLD', points: 900 }],
          analytics: {
            totalSpend: 250,
            totalVisits: 7,
            lastVisitAt: '2026-01-04T00:00:00.000Z',
          },
        },
      ]);

      const csv = await service.exportCustomers(TENANT, 'csv');
      const [header, row] = csv.split('\n');

      expect(header).toBe(
        'id,firstName,lastName,email,phone,status,tier,points,totalSpend,totalVisits,lastVisitAt,createdAt',
      );
      expect(row).toBe(
        '"c1","Ada","Lovelace","ada@x.com","","ACTIVE","GOLD",900,250,7,"2026-01-04T00:00:00.000Z","2026-01-05T00:00:00.000Z"',
      );
    });

    it('writes empty csv cells for a customer with no membership or analytics', async () => {
      prisma.customer.findMany.mockResolvedValue([
        {
          id: 'c2',
          firstName: 'Bob',
          lastName: null,
          email: null,
          phone: null,
          status: 'INACTIVE',
          createdAt: new Date('2026-02-05T00:00:00.000Z'),
          memberships: [],
          analytics: null,
        },
      ]);

      const [, row] = (await service.exportCustomers(TENANT, 'csv')).split('\n');

      expect(row).toBe('"c2","Bob","","","","INACTIVE","",0,0,0,"","2026-02-05T00:00:00.000Z"');
    });

    it('restricts the export to a segment when requested', async () => {
      await service.exportCustomers(TENANT, 'json', 'seg-1');

      const [args] = prisma.customer.findMany.mock.calls[0];
      expect(args.where.segmentAssignments).toEqual({ some: { segmentId: 'seg-1' } });
    });
  });
});
