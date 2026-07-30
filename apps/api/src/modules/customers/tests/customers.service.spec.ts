import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
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

      const result = await service.findAll({ page: 1, limit: 20 }, testTenantId);

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
      prisma.membership.findUnique.mockResolvedValue({
        id: 'mem-1',
        points: 100,
        tier: 'BRONZE',
        customerId: 'cust-1',
        tenantId: testTenantId,
      });
      prisma.loyaltyTier.findMany.mockResolvedValue([
        {
          id: 'tier-1',
          tier: 'SILVER',
          minPoints: 150,
          maxPoints: null,
          tenantId: testTenantId,
          multiplier: 1,
          benefits: {},
        },
      ]);
      prisma.loyaltyPointsTransaction.create.mockResolvedValue({ id: 'txn-1' });
      prisma.membership.update.mockResolvedValue({ id: 'mem-1', points: 150 });

      const result = await service.earnPoints(
        'cust-1',
        { points: 50, reason: 'Purchase' },
        testTenantId,
        testUserId,
      );

      expect(result).toBeDefined();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'LOYALTY_POINTS_EARNED' }),
      );
    });

    it('should redeem points', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1', tenantId: testTenantId });
      prisma.membership.findUnique.mockResolvedValue({
        id: 'mem-1',
        points: 200,
        tier: 'BRONZE',
        customerId: 'cust-1',
        tenantId: testTenantId,
      });
      prisma.loyaltyPointsTransaction.create.mockResolvedValue({ id: 'txn-2' });
      prisma.membership.update.mockResolvedValue({ id: 'mem-1', points: 100 });

      const result = await service.redeemPoints(
        'cust-1',
        { points: 100 },
        testTenantId,
        testUserId,
      );

      expect(result).toBeDefined();
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

      await expect(
        service.redeemPoints('cust-1', { points: 100 }, testTenantId, testUserId),
      ).rejects.toThrow('Insufficient');
    });
  });
});
