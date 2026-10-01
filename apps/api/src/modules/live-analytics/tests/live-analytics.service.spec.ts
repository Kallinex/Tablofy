import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LiveAnalyticsService } from '../live-analytics.service';
import { LiveAnalyticsGateway } from '../live-analytics.gateway';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockCache, MockCache } from '../../../test/mocks/cache.mock';
import { createMockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';

const MINUTE = 60 * 1000;

describe('LiveAnalyticsService', () => {
  let service: LiveAnalyticsService;
  let prisma: MockPrisma;
  let cache: MockCache;
  let gateway: { broadcast: jest.Mock };

  beforeAll(async () => {
    gateway = { broadcast: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LiveAnalyticsService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: CacheService, useValue: createMockCache() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
        { provide: LiveAnalyticsGateway, useValue: gateway },
      ],
    }).compile();

    service = module.get<LiveAnalyticsService>(LiveAnalyticsService);
    prisma = module.get(PrismaService) as MockPrisma;
    cache = module.get(CacheService) as MockCache;
  });

  beforeEach(() => {
    prisma.reset();
    cache.reset();
    jest.clearAllMocks();
    cache.get.mockResolvedValue(null);
    cache.set.mockResolvedValue(undefined);
  });

  describe('getLiveKpi', () => {
    it('aggregates today orders, revenue, prep time and active orders', async () => {
      prisma.order.count
        .mockResolvedValueOnce(12) // ordersToday
        .mockResolvedValueOnce(4); // activeOrders
      prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: '540.50' } });
      prisma.kitchenTicket.findMany.mockResolvedValue([
        { createdAt: new Date(Date.now() - 10 * MINUTE), completedAt: new Date(Date.now()) },
      ]);

      const result = await service.getLiveKpi(testTenantId);

      expect(result.ordersToday).toBe(12);
      expect(result.activeOrders).toBe(4);
      expect(result.revenueToday).toBe('540.50');
      expect(result.avgPrepTime).toBe(10);
      expect(result.updatedAt).toEqual(expect.any(String));
    });

    it('serves cached KPI without querying', async () => {
      const cached = { ordersToday: 1 };
      cache.get.mockResolvedValue(cached);

      expect(await service.getLiveKpi(testTenantId)).toBe(cached);
      expect(prisma.order.count).not.toHaveBeenCalled();
    });

    it('caches the KPI for 30 seconds', async () => {
      prisma.order.count.mockResolvedValue(0);
      prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: null } });
      prisma.kitchenTicket.findMany.mockResolvedValue([]);

      await service.getLiveKpi(testTenantId);

      expect(cache.set).toHaveBeenCalledWith(testTenantId, 'live:kpi', expect.any(Object), 30);
    });
  });

  describe('getSalesUpdate', () => {
    it('computes revenue and average order value for the last hour', async () => {
      prisma.order.findMany.mockResolvedValue([
        { id: 'o-1', total: '30', items: [], payments: [] },
        { id: 'o-2', total: '10', items: [], payments: [] },
      ]);

      const result = await service.getSalesUpdate(testTenantId);

      expect(result.totalRevenue).toBe(40);
      expect(result.orderCount).toBe(2);
      expect(result.averageOrderValue).toBe(20);
    });

    it('avoids dividing by zero when there are no recent orders', async () => {
      prisma.order.findMany.mockResolvedValue([]);

      const result = await service.getSalesUpdate(testTenantId);

      expect(result.averageOrderValue).toBe(0);
    });
  });

  describe('getInventoryAlerts', () => {
    it('lists low-stock items and counts out-of-stock items', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([
        { id: 'i-1', name: 'Milk', currentQuantity: '2' },
      ]);
      prisma.inventoryItem.count.mockResolvedValue(3);

      const result = await service.getInventoryAlerts(testTenantId);

      expect(result.lowStock).toEqual([{ id: 'i-1', name: 'Milk', currentQuantity: 2 }]);
      expect(result.outOfStock).toBe(3);
      expect(result.total).toBe(4);
    });

    it('uses the cached alerts when present', async () => {
      const cached = { total: 0 };
      cache.get.mockResolvedValue(cached);

      expect(await service.getInventoryAlerts(testTenantId)).toBe(cached);
      expect(prisma.inventoryItem.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getKitchenAlerts', () => {
    it('flags tickets pending for more than 15 minutes with computed wait time', async () => {
      const created = new Date(Date.now() - 20 * MINUTE);
      prisma.kitchenTicket.findMany.mockResolvedValue([
        { id: 't-1', orderId: 'o-1', status: 'PENDING', createdAt: created },
      ]);
      prisma.kitchenTicket.count.mockResolvedValue(2);

      const result = await service.getKitchenAlerts(testTenantId);

      expect(result.alertCount).toBe(1);
      expect(result.queueDepth).toBe(2);
      expect(result.delayedTickets[0].waitTime).toBeGreaterThanOrEqual(20);
      expect(result.delayedTickets[0].orderId).toBe('o-1');
    });

    it('queries pending/preparing tickets older than 15 minutes', async () => {
      prisma.kitchenTicket.findMany.mockResolvedValue([]);
      prisma.kitchenTicket.count.mockResolvedValue(0);

      await service.getKitchenAlerts(testTenantId);

      const where = prisma.kitchenTicket.findMany.mock.calls[0][0].where;
      expect(where.tenantId).toBe(testTenantId);
      expect(where.status).toEqual({ in: ['PENDING', 'PREPARING'] });
      expect(where.createdAt.lt).toBeInstanceOf(Date);
    });
  });

  describe('getCustomerActivity', () => {
    it('reports signups and returning orders in the last hour', async () => {
      prisma.customer.findMany.mockResolvedValue([
        { id: 'c-1', firstName: 'Ada', lastName: 'L', email: 'a@b.c', createdAt: new Date() },
      ]);
      prisma.order.count.mockResolvedValue(6);

      const result = await service.getCustomerActivity(testTenantId);

      expect(result.newSignups).toBe(1);
      expect(result.returningOrders).toBe(6);
      expect(result.recentSignups[0]).toMatchObject({ id: 'c-1', firstName: 'Ada' });
    });
  });

  describe('getDashboardRefresh', () => {
    it('composes every live feed into one payload', async () => {
      prisma.order.count.mockResolvedValue(0);
      prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: null } });
      prisma.kitchenTicket.findMany.mockResolvedValue([]);
      prisma.kitchenTicket.count.mockResolvedValue(0);
      prisma.inventoryItem.findMany.mockResolvedValue([]);
      prisma.inventoryItem.count.mockResolvedValue(0);
      prisma.customer.findMany.mockResolvedValue([]);
      prisma.order.findMany.mockResolvedValue([]);

      const result = await service.getDashboardRefresh(testTenantId);

      expect(result).toEqual(
        expect.objectContaining({
          kpi: expect.any(Object),
          sales: expect.any(Object),
          inventoryAlerts: expect.any(Object),
          kitchenAlerts: expect.any(Object),
          customerActivity: expect.any(Object),
          refreshedAt: expect.any(String),
        }),
      );
    });
  });

  describe('triggerKpiUpdate', () => {
    it('clears the KPI cache and broadcasts to the tenant room', async () => {
      await service.triggerKpiUpdate(testTenantId, { ordersToday: 5 });

      expect(cache.delete).toHaveBeenCalledWith(testTenantId, 'live:kpi');
      expect(gateway.broadcast).toHaveBeenCalledWith(testTenantId, 'kpi-update', {
        ordersToday: 5,
      });
    });
  });
});
