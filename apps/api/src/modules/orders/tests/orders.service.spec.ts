import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { KitchenStatus, Prisma } from '@prisma/client';
import { OrdersService } from '../orders.service';
import { validateTransition, isTerminalStatus, isPayableStatus } from '../order-state-machine';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PaymentsService } from '../../payments/payments.service';
import { MetricsService } from '../../../common/metrics/metrics.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockCache, MockCache } from '../../../test/mocks/cache.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockEventEmitter, MockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { createMockMetrics, MockMetrics } from '../../../test/mocks/metrics.mock';
import { buildOrder, buildCreateOrderDto } from '../../../test/factories/order.factory';
import { testTenantId, testUserId } from '../../../test/fixtures/auth.fixture';

describe('OrdersService', () => {
  let service: OrdersService;
  let prisma: MockPrisma;
  let auditLogs: MockAuditLogs;
  let cache: MockCache;
  let eventEmitter: MockEventEmitter;
  let metrics: MockMetrics;
  let paymentsMock: {
    charge: jest.Mock;
    refund: jest.Mock;
    partialRefund: jest.Mock;
    voidPayment: jest.Mock;
    splitPayment: jest.Mock;
    findAll: jest.Mock;
    findOne: jest.Mock;
    reconcile: jest.Mock;
  };

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
        { provide: MetricsService, useValue: createMockMetrics() },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
    prisma = module.get(PrismaService) as MockPrisma;
    auditLogs = module.get(AuditLogsService) as MockAuditLogs;
    cache = module.get(CacheService) as MockCache;
    eventEmitter = module.get(EventEmitter2) as MockEventEmitter;
    metrics = module.get(MetricsService) as MockMetrics;
    paymentsMock = module.get(PaymentsService) as unknown as typeof paymentsMock;
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
      expect(metrics.incrementOrdersCreated).toHaveBeenCalled();
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

    it('should compute subtotal and item totals with exact decimal math', async () => {
      const fakeOrder = buildOrder({ id: 'order-1' });
      setupValidateBusinessRules();
      prisma.order.findFirst.mockResolvedValue(null);

      const decimalDto = buildCreateOrderDto({
        items: [
          { productId: 'product-1', quantity: 2, unitPrice: 10.99 },
          { productId: 'product-1', quantity: 3, unitPrice: 0.1 },
        ],
      });

      let capturedCreateData: Record<string, unknown> | undefined;
      const capturedItemTotals: Array<{ quantity: number; unitPrice: number; total: number }> = [];

      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
        const tx = {
          order: {
            create: jest.fn((args: { data: Record<string, unknown> }) => {
              capturedCreateData = args.data;
              return Promise.resolve(fakeOrder);
            }),
            findUnique: jest.fn().mockResolvedValue(fakeOrder),
          },
          orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
          orderItem: {
            create: jest.fn(
              (args: { data: { quantity: number; unitPrice: number; total: number } }) => {
                capturedItemTotals.push(args.data);
                return Promise.resolve({});
              },
            ),
          },
        };
        return cb(tx);
      });

      await service.create(decimalDto, testTenantId, testUserId);

      expect(capturedCreateData?.subtotal).toBe(22.28);
      expect(capturedCreateData?.total).toBe(22.28);
      expect(capturedItemTotals[0].total).toBe(21.98);
      expect(capturedItemTotals[1].total).toBe(0.3);
    });

    it('should retry order number allocation after a unique-constraint conflict', async () => {
      const fakeOrder = buildOrder({ id: 'order-1' });
      setupValidateBusinessRules();

      const conflict = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`restaurantId`,`orderNumber`)',
        {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['restaurantId', 'orderNumber'] },
        },
      );

      prisma.order.findFirst
        .mockResolvedValueOnce({ orderNumber: 5 })
        .mockResolvedValueOnce({ orderNumber: 6 });

      const createdNumbers: number[] = [];
      let attempt = 0;
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
        attempt += 1;
        if (attempt === 1) {
          throw conflict;
        }
        const tx = {
          order: {
            create: jest.fn((args: { data: { orderNumber: number } }) => {
              createdNumbers.push(args.data.orderNumber);
              return Promise.resolve(fakeOrder);
            }),
            findUnique: jest.fn().mockResolvedValue(fakeOrder),
          },
          orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
          orderItem: { create: jest.fn().mockResolvedValue({}) },
        };
        return cb(tx);
      });

      const result = await service.create(dto, testTenantId, testUserId);

      expect(result).toBeDefined();
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
      expect(createdNumbers).toEqual([7]);
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

    it('should recompute item.total on a quantity-only update', async () => {
      const fakeOrder = buildOrder({
        id: 'order-1',
        items: [item({ id: 'item-1', quantity: 2, unitPrice: 10, discount: 0, total: 20 })],
      });
      stubFindOne(fakeOrder);
      const tx = makeTx();
      mockTransaction(tx);
      mockRecalculate(tx, fakeOrder);
      tx.order.updateMany.mockResolvedValue({ count: 1 });
      tx.orderItemModifier.aggregate.mockResolvedValue({ _sum: { price: null } });
      tx.orderItem.updateMany.mockResolvedValue({ count: 1 });

      await service.update(
        'order-1',
        { items: [{ id: 'item-1', quantity: 3 }] },
        testTenantId,
        testUserId,
      );

      expect(tx.orderItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'item-1', orderId: 'order-1', tenantId: testTenantId },
          data: expect.objectContaining({ quantity: 3, total: 30 }),
        }),
      );
    });

    it('should recompute item.total on a unit-price-only update using stored quantity', async () => {
      const fakeOrder = buildOrder({
        id: 'order-1',
        items: [item({ id: 'item-1', quantity: 2, unitPrice: 10, discount: 0, total: 20 })],
      });
      stubFindOne(fakeOrder);
      const tx = makeTx();
      mockTransaction(tx);
      mockRecalculate(tx, fakeOrder);
      tx.order.updateMany.mockResolvedValue({ count: 1 });
      tx.orderItemModifier.aggregate.mockResolvedValue({ _sum: { price: null } });
      tx.orderItem.updateMany.mockResolvedValue({ count: 1 });

      await service.update(
        'order-1',
        { items: [{ id: 'item-1', unitPrice: 12.5 }] },
        testTenantId,
        testUserId,
      );

      expect(tx.orderItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ unitPrice: 12.5, total: 25 }),
        }),
      );
    });
  });

  describe('softDelete', () => {
    it('should soft delete order scoped to tenant', async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 1 });

      await service.softDelete('order-1', testTenantId, testUserId);

      expect(prisma.order.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'order-1', tenantId: testTenantId },
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      );
      expect(cache.deletePattern).toHaveBeenCalled();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ORDER_DELETED' }),
      );
    });

    it('should throw NotFound when order does not exist in tenant (cross-tenant blocked)', async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.softDelete('order-1', testTenantId, testUserId)).rejects.toThrow(
        NotFoundException,
      );

      expect(auditLogs.log).not.toHaveBeenCalled();
      expect(cache.deletePattern).not.toHaveBeenCalled();
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

    it('should increment completed metric when transitioning to COMPLETED', async () => {
      const fakeOrder = buildOrder({ id: 'order-1', status: 'SERVED' });
      prisma.order.findFirst.mockResolvedValue(fakeOrder);
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
        const tx = {
          order: {
            update: jest.fn().mockResolvedValue({ ...fakeOrder, status: 'COMPLETED' }),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            findUnique: jest.fn().mockResolvedValue({ ...fakeOrder, status: 'COMPLETED' }),
          },
          orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
        };
        return cb(tx);
      });

      await service.changeStatus(
        'order-1',
        { status: 'COMPLETED', reason: 'Paid' },
        testTenantId,
        testUserId,
      );

      expect(metrics.incrementOrdersCompleted).toHaveBeenCalled();
    });
  });

  function orderWithIncludes(overrides: Record<string, unknown> = {}) {
    return {
      ...buildOrder(),
      subtotal: 100,
      discount: 0,
      discountType: null,
      discountAmount: 0,
      version: 1,
      items: [],
      payments: [],
      statusHistory: [],
      orderNotes: [],
      table: null,
      user: null,
      restaurant: null,
      branch: null,
      ...overrides,
    };
  }

  function item(overrides: Record<string, unknown> = {}) {
    return {
      id: 'item-1',
      productId: 'product-1',
      productName: 'Burger',
      variantId: null,
      variantName: null,
      sku: 'SKU-1',
      quantity: 2,
      unitPrice: 10,
      discount: 0,
      total: 20,
      voidedAt: null,
      voidReason: null,
      kitchenStatus: 'PENDING',
      preparationNotes: null,
      priceSnapshot: null,
      modifiers: [],
      ...overrides,
    };
  }

  function makeTx(overrides: Record<string, unknown> = {}) {
    return {
      order: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findUnique: jest.fn() },
      orderItem: {
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        findMany: jest.fn(),
      },
      orderItemModifier: { aggregate: jest.fn(), updateMany: jest.fn(), create: jest.fn() },
      orderStatusHistory: { create: jest.fn() },
      kitchenTicket: { updateMany: jest.fn() },
      ...overrides,
    };
  }

  function mockTransaction(tx: ReturnType<typeof makeTx>) {
    prisma.$transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx));
  }

  function mockRecalculate(tx: ReturnType<typeof makeTx>, order: Record<string, unknown>) {
    tx.orderItem.findMany.mockResolvedValue(order.items || []);
    tx.order.findUnique.mockResolvedValue(order);
    tx.order.update.mockResolvedValue(order);
  }

  function stubFindOne(order: Record<string, unknown>) {
    cache.get.mockResolvedValue(null);
    prisma.order.findFirst.mockResolvedValue(order);
  }

  describe('applyDiscount', () => {
    it('should apply a percentage discount', async () => {
      const order = orderWithIncludes();
      stubFindOne(order);
      const tx = makeTx();
      tx.order.updateMany.mockResolvedValue({ count: 1 });
      tx.order.update.mockResolvedValue(order);
      mockTransaction(tx);
      mockRecalculate(tx, order);

      await service.applyDiscount(
        'order-1',
        { discountType: 'PERCENTAGE', value: 10, reason: 'Promo' },
        testTenantId,
        testUserId,
      );

      expect(tx.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ discount: 10, discountType: 'PERCENTAGE' }),
        }),
      );
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ORDER_DISCOUNT_APPLIED' }),
      );
    });

    it('should reject discount exceeding subtotal', async () => {
      stubFindOne(orderWithIncludes());
      await expect(
        service.applyDiscount(
          'order-1',
          { discountType: 'PERCENTAGE', value: 200 },
          testTenantId,
          testUserId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject modification in terminal status', async () => {
      stubFindOne(orderWithIncludes({ status: 'COMPLETED' }));
      await expect(
        service.applyDiscount(
          'order-1',
          { discountType: 'PERCENTAGE', value: 10 },
          testTenantId,
          testUserId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw conflict on stale version', async () => {
      stubFindOne(orderWithIncludes());
      const tx = makeTx();
      tx.order.updateMany.mockResolvedValue({ count: 0 });
      mockTransaction(tx);

      await expect(
        service.applyDiscount(
          'order-1',
          { discountType: 'PERCENTAGE', value: 10 },
          testTenantId,
          testUserId,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('removeDiscount', () => {
    it('should remove the discount and zero the field', async () => {
      const order = orderWithIncludes({ discount: 15, discountType: 'PERCENTAGE' });
      stubFindOne(order);
      const tx = makeTx();
      tx.order.updateMany.mockResolvedValue({ count: 1 });
      tx.order.update.mockResolvedValue(order);
      mockTransaction(tx);
      mockRecalculate(tx, order);

      await service.removeDiscount('order-1', testTenantId, testUserId);

      expect(tx.order.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ discount: 0 }) }),
      );
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ORDER_DISCOUNT_REMOVED' }),
      );
    });
  });

  describe('addNote', () => {
    it('should create a note, log and invalidate cache', async () => {
      stubFindOne(orderWithIncludes());
      const note = {
        id: 'note-1',
        orderId: 'order-1',
        tenantId: testTenantId,
        type: 'GENERAL',
        content: 'Customer prefers window seat',
        userId: testUserId,
        user: { id: testUserId, firstName: 'Test', lastName: 'User', role: 'ADMIN' },
      };
      prisma.orderNote.create.mockResolvedValue(note);

      const result = await service.addNote(
        'order-1',
        { content: 'Customer prefers window seat' },
        testTenantId,
        testUserId,
      );

      expect(result).toEqual(note);
      expect(prisma.orderNote.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ orderId: 'order-1', tenantId: testTenantId }),
        }),
      );
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ORDER_NOTE_ADDED' }),
      );
      expect(cache.delete).toHaveBeenCalled();
    });

    it('should reject adding a note to an order that does not belong to the tenant', async () => {
      cache.get.mockResolvedValue(null);
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(
        service.addNote('order-foreign', { content: 'sneak' }, testTenantId, testUserId),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.order.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'order-foreign', tenantId: testTenantId, deletedAt: null },
        }),
      );
      expect(prisma.orderNote.create).not.toHaveBeenCalled();
      expect(auditLogs.log).not.toHaveBeenCalled();
    });
  });

  describe('addPayment', () => {
    it('should delegate to payments service and invalidate cache', async () => {
      const payment = { id: 'payment-1' };
      paymentsMock.charge.mockResolvedValue(payment);

      const result = await service.addPayment(
        'order-1',
        { method: 'CASH', amount: 50 },
        testTenantId,
        testUserId,
      );

      expect(result).toEqual(payment);
      expect(paymentsMock.charge).toHaveBeenCalledWith(
        'order-1',
        expect.objectContaining({ method: 'CASH', amount: 50, orderId: 'order-1' }),
        testTenantId,
        testUserId,
      );
      expect(cache.deletePattern).toHaveBeenCalled();
    });
  });

  describe('refundPayment', () => {
    it('should delegate refund and invalidate cache', async () => {
      const refund = { id: 'refund-1' };
      paymentsMock.refund.mockResolvedValue(refund);

      const result = await service.refundPayment(
        'order-1',
        'payment-1',
        testTenantId,
        testUserId,
        'No stock',
      );

      expect(result).toEqual(refund);
      expect(paymentsMock.refund).toHaveBeenCalledWith(
        'payment-1',
        testTenantId,
        testUserId,
        'No stock',
      );
    });
  });

  describe('splitOrder', () => {
    const order = orderWithIncludes({
      id: 'order-1',
      status: 'CONFIRMED',
      restaurantId: 'restaurant-1',
      orderNumber: 'ORD-1',
      items: [item()],
    });

    it('should split items into a new draft order', async () => {
      cache.get.mockResolvedValue(null);
      prisma.order.findFirst.mockResolvedValueOnce(order);
      prisma.order.findFirst.mockResolvedValueOnce({ orderNumber: 5 });
      const tx = makeTx();
      tx.order.create.mockResolvedValue({ id: 'new-order-1' });
      tx.orderItem.create.mockResolvedValue({});
      tx.orderItem.update.mockResolvedValue({});
      tx.orderStatusHistory.create.mockResolvedValue({});
      mockTransaction(tx);
      mockRecalculate(tx, order);

      const result = await service.splitOrder(
        'order-1',
        { items: [{ id: 'item-1', quantity: 1 }] },
        testTenantId,
        testUserId,
      );

      expect(result).toEqual({ newOrderId: 'new-order-1' });
      expect(tx.orderItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ orderId: 'new-order-1', quantity: 1 }),
        }),
      );
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ORDER_SPLIT' }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith('order.split', expect.any(Object));
    });

    it('should reject split of draft or terminal order', async () => {
      stubFindOne(orderWithIncludes({ status: 'DRAFT' }));
      await expect(
        service.splitOrder(
          'order-1',
          { items: [{ id: 'item-1', quantity: 1 }] },
          testTenantId,
          testUserId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject unknown order item', async () => {
      cache.get.mockResolvedValue(null);
      prisma.order.findFirst.mockResolvedValueOnce(order);
      prisma.order.findFirst.mockResolvedValueOnce({ orderNumber: 5 });
      mockTransaction(makeTx());

      await expect(
        service.splitOrder(
          'order-1',
          { items: [{ id: 'missing-item', quantity: 1 }] },
          testTenantId,
          testUserId,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject moving more quantity than available', async () => {
      cache.get.mockResolvedValue(null);
      prisma.order.findFirst.mockResolvedValueOnce(order);
      prisma.order.findFirst.mockResolvedValueOnce({ orderNumber: 5 });
      mockTransaction(makeTx());

      await expect(
        service.splitOrder(
          'order-1',
          { items: [{ id: 'item-1', quantity: 99 }] },
          testTenantId,
          testUserId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should retry split when order number allocation conflicts (P2002)', async () => {
      cache.get.mockResolvedValue(null);
      prisma.order.findFirst
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce({ orderNumber: 5 })
        .mockResolvedValueOnce({ orderNumber: 6 });

      const conflict = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`restaurantId`,`orderNumber`)',
        {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['restaurantId', 'orderNumber'] },
        },
      );

      const createdNumbers: number[] = [];
      let attempt = 0;
      prisma.$transaction.mockImplementation(async (cb: (t: unknown) => unknown) => {
        attempt += 1;
        const tx = makeTx();
        tx.order.create.mockImplementation(({ data }: { data: { orderNumber: number } }) => {
          if (attempt === 1) {
            throw conflict;
          }
          createdNumbers.push(data.orderNumber);
          return Promise.resolve({ id: 'new-order-1' });
        });
        tx.orderItem.create.mockResolvedValue({});
        tx.orderItem.update.mockResolvedValue({});
        tx.orderStatusHistory.create.mockResolvedValue({});
        mockRecalculate(tx, order);
        return cb(tx);
      });

      const result = await service.splitOrder(
        'order-1',
        { items: [{ id: 'item-1', quantity: 1 }] },
        testTenantId,
        testUserId,
      );

      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ newOrderId: 'new-order-1' });
      expect(createdNumbers).toEqual([7]);
    });
  });

  describe('mergeOrders', () => {
    const target = orderWithIncludes({ id: 'order-1', status: 'PENDING', orderNumber: 'ORD-1' });
    const source = orderWithIncludes({
      id: 'order-2',
      status: 'PENDING',
      orderNumber: 'ORD-2',
      items: [item()],
    });

    it('should reject merging an order with itself', async () => {
      await expect(
        service.mergeOrders('order-1', { sourceOrderId: 'order-1' }, testTenantId, testUserId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should merge source items into target and soft delete source', async () => {
      cache.get.mockResolvedValue(null);
      prisma.order.findFirst.mockResolvedValueOnce(target).mockResolvedValueOnce(source);
      const tx = makeTx();
      tx.orderItem.create.mockResolvedValue({});
      tx.order.update.mockResolvedValue({});
      mockTransaction(tx);
      mockRecalculate(tx, target);

      const result = await service.mergeOrders(
        'order-1',
        { sourceOrderId: 'order-2' },
        testTenantId,
        testUserId,
      );

      expect(result).toEqual({ mergedOrderId: 'order-1' });
      expect(tx.orderItem.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ orderId: 'order-1' }) }),
      );
      expect(tx.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'order-2' },
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      );
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ORDERS_MERGED' }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith('orders.merged', expect.any(Object));
    });

    it('should reject merging terminal orders', async () => {
      cache.get.mockResolvedValue(null);
      prisma.order.findFirst
        .mockResolvedValueOnce(target)
        .mockResolvedValueOnce(orderWithIncludes({ id: 'order-2', status: 'COMPLETED' }));

      await expect(
        service.mergeOrders('order-1', { sourceOrderId: 'order-2' }, testTenantId, testUserId),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('moveTable', () => {
    it('should move order to a new table', async () => {
      const order = orderWithIncludes({ tableId: 'table-1' });
      stubFindOne(order);
      prisma.table.findFirst.mockResolvedValue({ id: 'table-2', tenantId: testTenantId });
      const moved = { ...order, tableId: 'table-2' };
      prisma.order.update.mockResolvedValue(moved);

      const result = await service.moveTable(
        'order-1',
        { newTableId: 'table-2' },
        testTenantId,
        testUserId,
      );

      expect(result).toEqual(moved);
      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'order-1' }, data: { tableId: 'table-2' } }),
      );
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ORDER_TABLE_MOVED' }),
      );
    });

    it('should throw NotFound when target table missing', async () => {
      stubFindOne(orderWithIncludes());
      prisma.table.findFirst.mockResolvedValue(null);

      await expect(
        service.moveTable('order-1', { newTableId: 'table-2' }, testTenantId, testUserId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('duplicateOrder', () => {
    it('should create a draft copy of the order', async () => {
      const order = orderWithIncludes({
        id: 'order-1',
        status: 'COMPLETED',
        orderNumber: 'ORD-1',
        notes: 'Extra ketchup',
        customerName: 'Jane',
        items: [item({ modifiers: [{ price: 1, quantity: 2 }] })],
      });
      cache.get.mockResolvedValue(null);
      prisma.order.findFirst.mockResolvedValueOnce(order);
      prisma.order.findFirst.mockResolvedValueOnce({ orderNumber: 5 });
      prisma.order.findFirst.mockResolvedValue(order);
      const tx = makeTx();
      tx.order.create.mockResolvedValue({ id: 'new-order-1' });
      tx.orderItem.create.mockResolvedValue({});
      tx.orderStatusHistory.create.mockResolvedValue({});
      tx.order.findUnique.mockResolvedValue({ id: 'new-order-1', orderNumber: 'ORD-6', items: [] });
      mockTransaction(tx);

      const result = await service.duplicateOrder('order-1', testTenantId, testUserId);
      expect(result).toEqual({ id: 'new-order-1', orderNumber: 'ORD-6', items: [] });
      expect(tx.order.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'DRAFT' }) }),
      );
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ORDER_DUPLICATED' }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith('order.duplicated', expect.any(Object));
    });

    it('should retry duplicate when order number allocation conflicts (P2002)', async () => {
      const order = orderWithIncludes({
        id: 'order-1',
        status: 'COMPLETED',
        orderNumber: 'ORD-1',
        items: [item({ modifiers: [{ price: 1, quantity: 2 }] })],
      });
      cache.get.mockResolvedValue(null);
      prisma.order.findFirst
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce({ orderNumber: 5 })
        .mockResolvedValueOnce({ orderNumber: 6 });

      const conflict = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`restaurantId`,`orderNumber`)',
        {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['restaurantId', 'orderNumber'] },
        },
      );

      const createdNumbers: number[] = [];
      let attempt = 0;
      prisma.$transaction.mockImplementation(async (cb: (t: unknown) => unknown) => {
        attempt += 1;
        const tx = makeTx();
        tx.order.create.mockImplementation(({ data }: { data: { orderNumber: number } }) => {
          if (attempt === 1) {
            throw conflict;
          }
          createdNumbers.push(data.orderNumber);
          return Promise.resolve({ id: 'new-order-1' });
        });
        tx.orderItem.create.mockResolvedValue({});
        tx.orderStatusHistory.create.mockResolvedValue({});
        tx.order.findUnique.mockResolvedValue({
          id: 'new-order-1',
          orderNumber: 'ORD-7',
          items: [],
        });
        return cb(tx);
      });

      const result = await service.duplicateOrder('order-1', testTenantId, testUserId);

      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ id: 'new-order-1', orderNumber: 'ORD-7', items: [] });
      expect(createdNumbers).toEqual([7]);
    });
  });

  describe('applyServiceCharge', () => {
    it('should apply a percentage service charge', async () => {
      const order = orderWithIncludes();
      stubFindOne(order);
      prisma.serviceCharge.findFirst.mockResolvedValue({
        id: 'sc-1',
        rate: 10,
        isPercentage: true,
      });
      const tx = makeTx();
      tx.order.update.mockResolvedValue(order);
      mockTransaction(tx);
      mockRecalculate(tx, order);

      await service.applyServiceCharge('order-1', 'sc-1', testTenantId, testUserId);

      expect(tx.order.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ serviceCharge: 10 }) }),
      );
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ORDER_SERVICE_CHARGE_APPLIED' }),
      );
    });

    it('should throw NotFound when service charge missing', async () => {
      stubFindOne(orderWithIncludes());
      prisma.serviceCharge.findFirst.mockResolvedValue(null);

      await expect(
        service.applyServiceCharge('order-1', 'sc-1', testTenantId, testUserId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('applyTaxRate', () => {
    it('should apply tax based on subtotal minus discount', async () => {
      const order = orderWithIncludes({ discount: 20 });
      stubFindOne(order);
      prisma.taxRate.findFirst.mockResolvedValue({ id: 'tax-1', rate: 0.07 });
      const tx = makeTx();
      tx.order.update.mockResolvedValue(order);
      mockTransaction(tx);
      mockRecalculate(tx, order);

      await service.applyTaxRate('order-1', 'tax-1', testTenantId, testUserId);

      expect(tx.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ taxRateId: 'tax-1', taxRate: 0.07 }),
        }),
      );
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ORDER_TAX_APPLIED' }),
      );
    });

    it('should round tax to the nearest cent using half-up decimal math', async () => {
      const order = orderWithIncludes({ subtotal: 19.99, discount: 0 });
      stubFindOne(order);
      prisma.taxRate.findFirst.mockResolvedValue({ id: 'tax-1', rate: 0.15 });
      const tx = makeTx();
      tx.order.update.mockResolvedValue(order);
      mockTransaction(tx);
      mockRecalculate(tx, order);

      await service.applyTaxRate('order-1', 'tax-1', testTenantId, testUserId);

      expect(tx.order.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ taxAmount: 3 }) }),
      );
    });

    it('should throw NotFound when tax rate missing', async () => {
      stubFindOne(orderWithIncludes());
      prisma.taxRate.findFirst.mockResolvedValue(null);

      await expect(
        service.applyTaxRate('order-1', 'tax-1', testTenantId, testUserId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('voidItem', () => {
    it('should void an order item', async () => {
      const order = orderWithIncludes({ items: [item()] });
      stubFindOne(order);
      const tx = makeTx();
      tx.order.updateMany.mockResolvedValue({ count: 1 });
      tx.orderItem.update.mockResolvedValue({});
      mockTransaction(tx);
      mockRecalculate(tx, order);

      const result = await service.voidItem(
        'order-1',
        'item-1',
        'Made incorrectly',
        testTenantId,
        testUserId,
      );

      expect(result).toEqual({ message: 'Item voided' });
      expect(tx.orderItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'item-1' },
          data: expect.objectContaining({
            voidedAt: expect.any(Date),
            voidReason: 'Made incorrectly',
          }),
        }),
      );
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ORDER_ITEM_VOIDED' }),
      );
    });

    it('should reject voiding an already-voided item', async () => {
      stubFindOne(orderWithIncludes({ items: [item({ voidedAt: new Date() })] }));
      await expect(
        service.voidItem('order-1', 'item-1', 'reason', testTenantId, testUserId),
      ).rejects.toThrow(ConflictException);
    });

    it('should reject void on terminal order', async () => {
      stubFindOne(orderWithIncludes({ status: 'COMPLETED', items: [item()] }));
      await expect(
        service.voidItem('order-1', 'item-1', 'reason', testTenantId, testUserId),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateItemKitchenStatus', () => {
    it('should update kitchen status scoped to tenant and log audit', async () => {
      stubFindOne(orderWithIncludes({ items: [item()] }));
      prisma.orderItem.updateMany.mockResolvedValue({ count: 1 });
      prisma.orderItem.findUnique.mockResolvedValue({ id: 'item-1', kitchenStatus: 'PREPARING' });

      const result = await service.updateItemKitchenStatus(
        'order-1',
        'item-1',
        KitchenStatus.PREPARING,
        testTenantId,
        testUserId,
      );

      expect(result.kitchenStatus).toBe('PREPARING');
      expect(prisma.orderItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'item-1', tenantId: testTenantId },
          data: { kitchenStatus: KitchenStatus.PREPARING },
        }),
      );
      expect(prisma.orderItem.update).not.toHaveBeenCalled();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ORDER_ITEM_KITCHEN_STATUS_UPDATED' }),
      );
    });

    it('should throw NotFound when the item belongs to another tenant', async () => {
      stubFindOne(orderWithIncludes({ items: [item()] }));
      prisma.orderItem.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.updateItemKitchenStatus(
          'order-1',
          'item-1',
          KitchenStatus.PREPARING,
          testTenantId,
          testUserId,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFound when item missing', async () => {
      stubFindOne(orderWithIncludes({ items: [] }));
      await expect(
        service.updateItemKitchenStatus(
          'order-1',
          'item-1',
          KitchenStatus.PREPARING,
          testTenantId,
          testUserId,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findKitchenTickets', () => {
    it('should return tickets scoped to tenant', async () => {
      prisma.kitchenTicket.findMany.mockResolvedValue([{ id: 'ticket-1' }]);
      const result = await service.findKitchenTickets('order-1', testTenantId);
      expect(result).toHaveLength(1);
      expect(prisma.kitchenTicket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { orderId: 'order-1', tenantId: testTenantId } }),
      );
    });
  });

  describe('updateKitchenTicketStatus', () => {
    it('should update status and set completedAt when READY', async () => {
      prisma.kitchenTicket.findFirst.mockResolvedValue({ id: 'ticket-1', status: 'PENDING' });
      prisma.kitchenTicket.update.mockResolvedValue({ id: 'ticket-1', status: 'READY' });

      await service.updateKitchenTicketStatus('ticket-1', KitchenStatus.READY, testTenantId);

      expect(prisma.kitchenTicket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: KitchenStatus.READY,
            completedAt: expect.any(Date),
          }),
        }),
      );
      expect(cache.deletePattern).toHaveBeenCalled();
    });

    it('should throw NotFound when ticket missing', async () => {
      prisma.kitchenTicket.findFirst.mockResolvedValue(null);
      await expect(
        service.updateKitchenTicketStatus('ticket-1', KitchenStatus.READY, testTenantId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('restore', () => {
    it('should restore a soft-deleted order', async () => {
      const deleted = orderWithIncludes({ deletedAt: new Date() });
      prisma.order.findFirst.mockResolvedValue(deleted);
      const restored = { ...deleted, deletedAt: null };
      prisma.order.update.mockResolvedValue(restored);

      const result = await service.restore('order-1', testTenantId, testUserId);

      expect(result).toEqual(restored);
      expect(prisma.order.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'order-1', tenantId: testTenantId, deletedAt: { not: null } },
        }),
      );
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ORDER_RESTORED' }),
      );
      expect(cache.deletePattern).toHaveBeenCalled();
    });

    it('should throw NotFound when no deleted order', async () => {
      prisma.order.findFirst.mockResolvedValue(null);
      await expect(service.restore('order-1', testTenantId, testUserId)).rejects.toThrow(
        NotFoundException,
      );
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
      expect(isTerminalStatus('COMPLETED')).toBe(true);
    });

    it('should return false for non-terminal statuses', () => {
      expect(isTerminalStatus('DRAFT')).toBe(false);
      expect(isTerminalStatus('PENDING')).toBe(false);
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
