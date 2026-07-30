import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { OrdersService } from '../orders.service';
import { validateTransition, isTerminalStatus, isPayableStatus } from '../order-state-machine';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PaymentsService } from '../../payments/payments.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockCache, MockCache } from '../../../test/mocks/cache.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockEventEmitter, MockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { buildOrder, buildCreateOrderDto } from '../../../test/factories/order.factory';
import { testTenantId, testUserId } from '../../../test/fixtures/auth.fixture';

describe('OrdersService', () => {
  let service: OrdersService;
  let prisma: MockPrisma;
  let auditLogs: MockAuditLogs;
  let cache: MockCache;
  let eventEmitter: MockEventEmitter;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: CacheService, useValue: createMockCache() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
        {
          provide: PaymentsService,
          useValue: {
            charge: jest.fn(),
            refund: jest.fn(),
            partialRefund: jest.fn(),
            voidPayment: jest.fn(),
            splitPayment: jest.fn(),
            findAll: jest.fn(),
            findOne: jest.fn(),
            reconcile: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
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
    const dto = buildCreateOrderDto();

    function setupValidateBusinessRules() {
      prisma.restaurant.findFirst.mockResolvedValue({
        id: 'restaurant-1',
        isActive: true,
        tenantId: testTenantId,
      });
      prisma.branch.findFirst.mockResolvedValue({
        id: 'branch-1',
        restaurantId: 'restaurant-1',
        tenantId: testTenantId,
      });
      prisma.product.findMany.mockResolvedValue([{ id: 'product-1' } as never]);
    }

    it('should create an order successfully', async () => {
      const fakeOrder = buildOrder({ id: 'order-1' });

      setupValidateBusinessRules();
      prisma.order.findFirst.mockResolvedValue(null);
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
        const tx = {
          order: {
            create: jest.fn().mockResolvedValue(fakeOrder),
            findUnique: jest.fn().mockResolvedValue(fakeOrder),
          },
          orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
          orderItem: { create: jest.fn().mockResolvedValue({}) },
        };
        return cb(tx);
      });

      const result = await service.create(dto, testTenantId, testUserId);

      expect(result).toBeDefined();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ORDER_CREATED' }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith('order.created', expect.any(Object));
      expect(cache.deletePattern).toHaveBeenCalledWith(testTenantId, expect.any(String));
    });

    it('should generate order number', async () => {
      const fakeOrder = buildOrder({ id: 'order-1', restaurantId: 'restaurant-1' });
      setupValidateBusinessRules();
      prisma.order.findFirst.mockResolvedValue(null);
      prisma.order.findFirst.mockResolvedValueOnce(null);

      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
        const tx = {
          order: {
            create: jest.fn().mockResolvedValue(fakeOrder),
            findUnique: jest.fn().mockResolvedValue(fakeOrder),
          },
          orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
          orderItem: { create: jest.fn().mockResolvedValue({}) },
        };
        return cb(tx);
      });

      const result = await service.create(dto, testTenantId, testUserId);
      expect(result).toBeDefined();
    });
  });

  describe('findAll', () => {
    it('should return cached list when available', async () => {
      const cachedData = { data: [{ id: 'order-1' }], meta: { total: 1, page: 1, limit: 20 } };
      cache.get.mockResolvedValue(cachedData);

      const result = await service.findAll({ page: 1, limit: 20 }, testTenantId);

      expect(result).toEqual(cachedData);
      expect(prisma.order.findMany).not.toHaveBeenCalled();
    });

    it('should query database on cache miss', async () => {
      cache.get.mockResolvedValue(null);
      prisma.order.findMany.mockResolvedValue([buildOrder()]);
      prisma.order.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 20 }, testTenantId);

      expect(result.data).toHaveLength(1);
      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: testTenantId, deletedAt: null }),
        }),
      );
    });

    it('should filter by status when provided', async () => {
      cache.get.mockResolvedValue(null);
      prisma.order.findMany.mockResolvedValue([]);
      prisma.order.count.mockResolvedValue(0);

      await service.findAll({ status: 'PENDING' }, testTenantId);

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'PENDING' }),
        }),
      );
    });

    it('should filter by date range when provided', async () => {
      cache.get.mockResolvedValue(null);
      prisma.order.findMany.mockResolvedValue([]);
      prisma.order.count.mockResolvedValue(0);

      const startDate = '2025-01-01T00:00:00Z';
      const endDate = '2025-01-31T23:59:59Z';

      await service.findAll({ startDate, endDate }, testTenantId);

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: expect.objectContaining({ gte: expect.any(Date), lte: expect.any(Date) }),
          }),
        }),
      );
    });
  });

  describe('findOne', () => {
    it('should return order by id', async () => {
      const fakeOrder = buildOrder({ id: 'order-1' });
      cache.get.mockResolvedValue(null);
      prisma.order.findFirst.mockResolvedValue(fakeOrder);

      const result = await service.findOne('order-1', testTenantId);

      expect(result).toEqual(fakeOrder);
      expect(prisma.order.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'order-1', tenantId: testTenantId, deletedAt: null },
        }),
      );
    });

    it('should return cached order when available', async () => {
      const fakeOrder = buildOrder({ id: 'order-1' });
      cache.get.mockResolvedValue(fakeOrder);

      const result = await service.findOne('order-1', testTenantId);

      expect(result).toEqual(fakeOrder);
      expect(prisma.order.findFirst).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when order not found', async () => {
      cache.get.mockResolvedValue(null);
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(service.findOne('nonexist', testTenantId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update order successfully', async () => {
      const fakeOrder = buildOrder({ id: 'order-1' });
      prisma.order.findFirst.mockResolvedValue(fakeOrder);
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
        const tx = {
          order: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            update: jest.fn().mockResolvedValue(fakeOrder),
            findUnique: jest.fn().mockResolvedValue(fakeOrder),
          },
          orderItem: {
            findMany: jest.fn().mockResolvedValue([]),
            update: jest.fn().mockResolvedValue({}),
          },
        };
        return cb(tx);
      });

      const result = await service.update(
        'order-1',
        { notes: 'Updated notes' },
        testTenantId,
        testUserId,
      );

      expect(result).toBeDefined();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ORDER_UPDATED' }),
      );
    });
  });

  describe('softDelete', () => {
    it('should soft delete order', async () => {
      const fakeOrder = buildOrder({ id: 'order-1' });
      prisma.order.findFirst.mockResolvedValue(fakeOrder);
      prisma.order.update.mockResolvedValue(fakeOrder);

      await service.softDelete('order-1', testTenantId, testUserId);

      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'order-1' },
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      );
      expect(cache.deletePattern).toHaveBeenCalled();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ORDER_DELETED' }),
      );
    });
  });

  describe('changeStatus', () => {
    it('should change status with valid transition', async () => {
      const fakeOrder = buildOrder({ id: 'order-1', status: 'DRAFT' });
      prisma.order.findFirst.mockResolvedValue(fakeOrder);
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
        const tx = {
          order: {
            update: jest.fn().mockResolvedValue({ ...fakeOrder, status: 'PENDING' }),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            findUnique: jest.fn().mockResolvedValue({ ...fakeOrder, status: 'PENDING' }),
          },
          orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
        };
        return cb(tx);
      });

      const result = await service.changeStatus(
        'order-1',
        { status: 'PENDING', reason: 'Test' },
        testTenantId,
        testUserId,
      );

      expect(result).toBeDefined();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ORDER_PENDING' }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith('order.pending', expect.any(Object));
    });
  });
});

describe('OrderStateMachine', () => {
  describe('validateTransition', () => {
    it('should allow DRAFT -> PENDING', () => {
      expect(() => validateTransition('DRAFT', 'PENDING')).not.toThrow();
    });

    it('should allow PENDING -> CONFIRMED', () => {
      expect(() => validateTransition('PENDING', 'CONFIRMED')).not.toThrow();
    });

    it('should allow SERVED -> COMPLETED', () => {
      expect(() => validateTransition('SERVED', 'COMPLETED')).not.toThrow();
    });

    it('should allow COMPLETED -> REFUNDED', () => {
      expect(() => validateTransition('COMPLETED', 'REFUNDED')).not.toThrow();
    });

    it('should reject invalid transition DRAFT -> COMPLETED', () => {
      expect(() => validateTransition('DRAFT', 'COMPLETED')).toThrow(BadRequestException);
    });

    it('should reject same status transition', () => {
      expect(() => validateTransition('DRAFT', 'DRAFT')).toThrow(BadRequestException);
    });

    it('should reject invalid source status', () => {
      expect(() => validateTransition('INVALID', 'PENDING')).toThrow(BadRequestException);
    });

    it('should reject invalid target status', () => {
      expect(() => validateTransition('DRAFT', 'INVALID')).toThrow(BadRequestException);
    });
  });

  describe('isTerminalStatus', () => {
    it('should return true for terminal statuses', () => {
      expect(isTerminalStatus('CANCELLED')).toBe(true);
      expect(isTerminalStatus('REFUNDED')).toBe(true);
      expect(isTerminalStatus('VOIDED')).toBe(true);
    });

    it('should return false for non-terminal statuses', () => {
      expect(isTerminalStatus('DRAFT')).toBe(false);
      expect(isTerminalStatus('COMPLETED')).toBe(false);
    });
  });

  describe('isPayableStatus', () => {
    it('should return true for payable statuses', () => {
      expect(isPayableStatus('CONFIRMED')).toBe(true);
      expect(isPayableStatus('SERVED')).toBe(true);
    });

    it('should return false for non-payable statuses', () => {
      expect(isPayableStatus('DRAFT')).toBe(false);
      expect(isPayableStatus('CANCELLED')).toBe(false);
    });
  });
});
