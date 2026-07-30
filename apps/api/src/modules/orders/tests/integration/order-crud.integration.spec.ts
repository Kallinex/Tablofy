import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrdersService } from '../../orders.service';
import { PrismaService } from '../../../../prisma/prisma.service';
import { AuditLogsService } from '../../../audit-logs/audit-logs.service';
import { CacheService } from '../../../../common/services/cache.service';
import { createMockPrisma, MockPrisma } from '../../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../../test/mocks/audit-log.mock';
import { createMockCache, MockCache } from '../../../../test/mocks/cache.mock';
import {
  createMockEventEmitter,
  MockEventEmitter,
} from '../../../../test/mocks/event-emitter.mock';

describe('Order CRUD — Integration', () => {
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
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
    prisma = module.get(PrismaService) as MockPrisma;
    auditLogs = module.get(AuditLogsService) as MockAuditLogs;
    cache = module.get(CacheService) as MockCache;
    eventEmitter = module.get(EventEmitter2) as MockEventEmitter;
  });

  const baseOrder = {
    id: 'order-1',
    orderNumber: 1001,
    tenantId: 'tenant-1',
    restaurantId: 'restaurant-1',
    branchId: 'branch-1',
    tableId: null,
    userId: 'user-1',
    orderType: 'DINE_IN',
    source: 'POS',
    status: 'DRAFT',
    subtotal: 21.98,
    total: 21.98,
    discount: 0,
    discountType: null,
    discountAmount: 0,
    discountReason: null,
    serviceCharge: 0,
    serviceChargeRate: null,
    serviceChargeId: null,
    taxAmount: 0,
    taxRate: null,
    taxRateId: null,
    paidAmount: 0,
    tip: 0,
    customerName: null,
    customerPhone: null,
    customerEmail: null,
    deliveryAddress: null,
    deliveryFee: 0,
    notes: null,
    version: 1,
    completedAt: null,
    voidedAt: null,
    voidReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const baseItem = {
    id: 'item-1',
    orderId: 'order-1',
    tenantId: 'tenant-1',
    productId: 'product-1',
    productName: 'Burger',
    variantId: null,
    variantName: null,
    sku: 'BRGR-001',
    quantity: 2,
    unitPrice: 10.99,
    discount: 0,
    total: 21.98,
    preparationNotes: null,
    voidedAt: null,
    voidReason: null,
    kitchenStatus: 'PENDING',
    priceSnapshot: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    modifiers: [],
  };

  beforeEach(() => {
    prisma.reset();
    auditLogs.reset();
    cache.reset();
    eventEmitter.reset();
    jest.clearAllMocks();
  });

  describe('Create order (DRAFT)', () => {
    it('should create order with items', async () => {
      prisma.restaurant.findFirst.mockResolvedValueOnce({ id: 'restaurant-1', isActive: true });
      prisma.branch.findFirst.mockResolvedValueOnce({ id: 'branch-1' });
      prisma.product.findMany.mockResolvedValueOnce([{ id: 'product-1' }]);
      prisma.order.findFirst.mockResolvedValueOnce(null);

      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
        const tx = {
          order: {
            create: jest.fn().mockResolvedValue(baseOrder),
            findUnique: jest.fn().mockResolvedValue({
              ...baseOrder,
              items: [baseItem],
              statusHistory: [{ toStatus: 'DRAFT', reason: 'Order created' }],
            }),
          },
          orderStatusHistory: {
            create: jest.fn().mockResolvedValue({}),
          },
          orderItem: {
            create: jest.fn().mockResolvedValue(baseItem),
          },
          orderItemModifier: {
            create: jest.fn(),
          },
        };
        return cb(tx);
      });

      const result = await service.create(
        {
          restaurantId: 'restaurant-1',
          branchId: 'branch-1',
          orderType: 'DINE_IN',
          items: [{ productId: 'product-1', quantity: 2, unitPrice: 10.99 }],
        },
        'tenant-1',
        'user-1',
      );

      expect(result).toBeDefined();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ORDER_CREATED' }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith('order.created', expect.any(Object));
    });

    it('should throw NotFoundException for invalid restaurant', async () => {
      prisma.restaurant.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.create(
          { restaurantId: 'invalid', branchId: 'branch-1', orderType: 'DINE_IN', items: [] },
          'tenant-1',
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('Order status transitions', () => {
    it('should transition DRAFT → PENDING', async () => {
      const draftOrder = { ...baseOrder, status: 'DRAFT', version: 1 };
      prisma.order.findFirst.mockResolvedValueOnce(draftOrder);
      cache.get.mockResolvedValueOnce(null);
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
        const tx = {
          order: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            findUnique: jest.fn().mockResolvedValue({
              ...draftOrder,
              status: 'PENDING',
              items: [],
              payments: [],
              statusHistory: [{ toStatus: 'PENDING' }],
            }),
          },
          orderStatusHistory: {
            create: jest.fn().mockResolvedValue({}),
          },
          orderItem: {
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
        };
        return cb(tx);
      });

      const result = await service.changeStatus(
        'order-1',
        { status: 'PENDING' },
        'tenant-1',
        'user-1',
      );

      expect(result).toBeDefined();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ORDER_PENDING' }),
      );
    });

    it('should throw BadRequestException for invalid transition', async () => {
      const draftOrder = { ...baseOrder, status: 'DRAFT', version: 1 };
      prisma.order.findFirst.mockResolvedValueOnce(draftOrder);
      cache.get.mockResolvedValueOnce(null);

      await expect(
        service.changeStatus('order-1', { status: 'COMPLETED' }, 'tenant-1', 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Find order', () => {
    it('should find order by id', async () => {
      cache.get.mockResolvedValueOnce(null);
      prisma.order.findFirst.mockResolvedValueOnce({
        ...baseOrder,
        items: [baseItem],
        payments: [],
        statusHistory: [],
        orderNotes: [],
        table: null,
        user: { id: 'user-1', firstName: 'Test', lastName: 'User', role: 'OWNER' },
        restaurant: { id: 'restaurant-1', name: 'Test Restaurant' },
        branch: { id: 'branch-1', name: 'Main Branch' },
      });
      cache.set.mockResolvedValueOnce(undefined);

      const result = await service.findOne('order-1', 'tenant-1');
      expect(result).toBeDefined();
    });

    it('should throw NotFoundException when order does not exist', async () => {
      cache.get.mockResolvedValueOnce(null);
      prisma.order.findFirst.mockResolvedValueOnce(null);

      await expect(service.findOne('nonexistent', 'tenant-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('Delete and restore order', () => {
    it('should soft delete an order', async () => {
      prisma.order.update.mockResolvedValueOnce(baseOrder);

      await service.softDelete('order-1', 'tenant-1', 'user-1');

      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ORDER_DELETED' }),
      );
    });

    it('should restore a soft-deleted order', async () => {
      prisma.order.findFirst.mockResolvedValueOnce({ ...baseOrder, deletedAt: new Date() });
      prisma.order.update.mockResolvedValueOnce(baseOrder);

      const result = await service.restore('order-1', 'tenant-1', 'user-1');
      expect(result).toBeDefined();
    });
  });
});
