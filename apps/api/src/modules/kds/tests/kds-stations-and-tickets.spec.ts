import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { KdsService } from '../kds.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { QueueService } from '../../queues/queue.service';
import { KdsGateway } from '../kds.gateway';
import { MetricsService } from '../../../common/metrics/metrics.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockCache, MockCache } from '../../../test/mocks/cache.mock';
import { createMockQueue, MockQueue } from '../../../test/mocks/queue.mock';
import { createMockEventEmitter, MockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { createMockMetrics, MockMetrics } from '../../../test/mocks/metrics.mock';
import { testTenantId, testUserId } from '../../../test/fixtures/auth.fixture';

describe('KdsService stations, assignments, tickets and dashboard', () => {
  let service: KdsService;
  let prisma: MockPrisma;
  let auditLogs: MockAuditLogs;
  let cache: MockCache;
  let queue: MockQueue;
  let eventEmitter: MockEventEmitter;
  let metrics: MockMetrics;

  const gateway = {
    broadcastStationUpdate: jest.fn(),
    broadcastItemUpdate: jest.fn(),
    broadcastTicketUpdate: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KdsService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: CacheService, useValue: createMockCache() },
        { provide: QueueService, useValue: createMockQueue() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
        { provide: KdsGateway, useValue: gateway },
        { provide: MetricsService, useValue: createMockMetrics() },
      ],
    }).compile();

    service = module.get<KdsService>(KdsService);
    prisma = module.get(PrismaService) as MockPrisma;
    auditLogs = module.get(AuditLogsService) as MockAuditLogs;
    cache = module.get(CacheService) as MockCache;
    queue = module.get(QueueService) as MockQueue;
    eventEmitter = module.get(EventEmitter2) as MockEventEmitter;
    metrics = module.get(MetricsService) as MockMetrics;

    prisma.reset();
    auditLogs.reset();
    cache.reset();
    eventEmitter.reset();
    jest.clearAllMocks();
  });

  describe('findAllStations', () => {
    it('returns the cached station list', async () => {
      cache.get.mockResolvedValue({ data: [], meta: { total: 0 } });

      await expect(service.findAllStations('rest-1', testTenantId, {})).resolves.toEqual({
        data: [],
        meta: { total: 0 },
      });
      expect(prisma.kitchenStation.findMany).not.toHaveBeenCalled();
    });

    it('paginates stations by display order and caches the envelope', async () => {
      cache.get.mockResolvedValue(null);
      prisma.kitchenStation.count.mockResolvedValue(2);

      const result = await service.findAllStations('rest-1', testTenantId, {});

      const [args] = prisma.kitchenStation.findMany.mock.calls[0];
      expect(args.orderBy).toEqual({ displayOrder: 'asc' });
      expect(args.where).toEqual({
        restaurantId: 'rest-1',
        tenantId: testTenantId,
        deletedAt: null,
      });
      expect(result.meta).toEqual({ total: 2, page: 1, limit: 50, totalPages: 1 });
      expect(cache.set).toHaveBeenCalledWith(testTenantId, 'stations:rest-1:{}', result, 60);
    });

    it('honours page, limit and the active flag', async () => {
      await service.findAllStations('rest-1', testTenantId, {
        page: 3,
        limit: 10,
        isActive: false,
      });

      const [args] = prisma.kitchenStation.findMany.mock.calls[0];
      expect(args.where.isActive).toBe(false);
      expect(args.skip).toBe(20);
      expect(args.take).toBe(10);
    });

    it('searches name, slug and description', async () => {
      await service.findAllStations('rest-1', testTenantId, { search: 'grill' });

      const [args] = prisma.kitchenStation.findMany.mock.calls[0];
      expect(args.where.OR).toHaveLength(3);
      expect(args.where.OR[1]).toEqual({ slug: { contains: 'grill', mode: 'insensitive' } });
    });
  });

  describe('findOneStation', () => {
    it('returns the station owned by the tenant', async () => {
      prisma.kitchenStation.findFirst.mockResolvedValue({
        id: 'st-1',
        name: 'Grill',
        restaurantId: 'rest-1',
      });

      const result = await service.findOneStation('st-1', testTenantId);

      expect(result.name).toBe('Grill');
      expect(prisma.kitchenStation.findFirst).toHaveBeenCalledWith({
        where: { id: 'st-1', tenantId: testTenantId, deletedAt: null },
      });
    });

    it('rejects reading a station from another tenant', async () => {
      prisma.kitchenStation.findFirst.mockResolvedValue(null);

      await expect(service.findOneStation('st-1', testTenantId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('updateStation', () => {
    it('applies only the supplied fields', async () => {
      prisma.kitchenStation.findFirst.mockResolvedValue({
        id: 'st-1',
        name: 'Grill',
        slug: 'grill',
        restaurantId: 'rest-1',
      });
      prisma.kitchenStation.update.mockResolvedValue({ id: 'st-1', color: '#00ff00' });

      const result = await service.updateStation(
        'st-1',
        { color: '#00ff00' } as never,
        testTenantId,
        testUserId,
      );

      expect(result.color).toBe('#00ff00');
      const [args] = prisma.kitchenStation.update.mock.calls[0];
      expect(args.data).toEqual({ color: '#00ff00' });
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'KITCHEN_STATION_UPDATED',
          oldValues: { name: 'Grill', slug: 'grill' },
        }),
      );
      expect(gateway.broadcastStationUpdate).toHaveBeenCalledWith(
        testTenantId,
        'station.updated',
        expect.objectContaining({ id: 'st-1' }),
      );
    });

    it('rejects renaming a station onto an existing name', async () => {
      prisma.kitchenStation.findFirst.mockResolvedValue({
        id: 'st-1',
        name: 'Grill',
        slug: 'grill',
        restaurantId: 'rest-1',
      });
      prisma.kitchenStation.findUnique.mockResolvedValue({ id: 'st-2' });

      await expect(
        service.updateStation('st-1', { name: 'Fryer' } as never, testTenantId, testUserId),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects re-slugging a station onto an existing slug', async () => {
      prisma.kitchenStation.findFirst.mockResolvedValue({
        id: 'st-1',
        name: 'Grill',
        slug: 'grill',
        restaurantId: 'rest-1',
      });
      prisma.kitchenStation.findUnique.mockResolvedValue({ id: 'st-2' });

      await expect(
        service.updateStation('st-1', { slug: 'fryer' } as never, testTenantId, testUserId),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('allows renaming a station to the same name it already has', async () => {
      prisma.kitchenStation.findFirst.mockResolvedValue({
        id: 'st-1',
        name: 'Grill',
        slug: 'grill',
        restaurantId: 'rest-1',
      });
      prisma.kitchenStation.update.mockResolvedValue({ id: 'st-1', name: 'Grill' });

      await service.updateStation('st-1', { name: 'Grill' } as never, testTenantId, testUserId);

      expect(prisma.kitchenStation.findUnique).not.toHaveBeenCalled();
    });

    it('rejects updating a station from another tenant', async () => {
      prisma.kitchenStation.findFirst.mockResolvedValue(null);

      await expect(
        service.updateStation('st-1', { color: '#fff' } as never, testTenantId, testUserId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('deleteStation', () => {
    it('deactivates and soft deletes the station', async () => {
      prisma.kitchenStation.findFirst.mockResolvedValue({
        id: 'st-1',
        name: 'Grill',
        restaurantId: 'rest-1',
      });

      await service.deleteStation('st-1', testTenantId, testUserId);

      const [args] = prisma.kitchenStation.update.mock.calls[0];
      expect(args.data).toEqual({ deletedAt: expect.any(Date), isActive: false });
      expect(cache.delete).toHaveBeenCalledWith(testTenantId, 'stations:rest-1');
      expect(gateway.broadcastStationUpdate).toHaveBeenCalledWith(testTenantId, 'station.deleted', {
        id: 'st-1',
      });
    });

    it('rejects deleting a station from another tenant', async () => {
      prisma.kitchenStation.findFirst.mockResolvedValue(null);

      await expect(service.deleteStation('st-1', testTenantId, testUserId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('product station assignment', () => {
    it('assigns a product to a station', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'prod-1', stationId: null });
      prisma.kitchenStation.findFirst.mockResolvedValue({ id: 'st-1', name: 'Grill' });
      prisma.product.update.mockResolvedValue({ id: 'prod-1', stationId: 'st-1' });

      const result = await service.assignProductStation(
        { productId: 'prod-1', stationId: 'st-1' } as never,
        testTenantId,
        testUserId,
      );

      expect(result.stationId).toBe('st-1');
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PRODUCT_STATION_ASSIGNED',
          newValues: { stationId: 'st-1', stationName: 'Grill' },
        }),
      );
      expect(cache.deletePattern).toHaveBeenCalledWith(testTenantId, 'list:*');
    });

    it('rejects assigning a product from another tenant', async () => {
      prisma.product.findFirst.mockResolvedValue(null);
      prisma.kitchenStation.findFirst.mockResolvedValue({ id: 'st-1', name: 'Grill' });

      await expect(
        service.assignProductStation(
          { productId: 'prod-1', stationId: 'st-1' } as never,
          testTenantId,
          testUserId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects assigning to a station from another tenant', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'prod-1' });
      prisma.kitchenStation.findFirst.mockResolvedValue(null);

      await expect(
        service.assignProductStation(
          { productId: 'prod-1', stationId: 'st-1' } as never,
          testTenantId,
          testUserId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('unassigns a product from its station', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'prod-1', stationId: 'st-1' });
      prisma.product.update.mockResolvedValue({ id: 'prod-1', stationId: null });

      const result = await service.unassignProductStation('prod-1', testTenantId, testUserId);

      expect(result.stationId).toBeNull();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PRODUCT_STATION_UNASSIGNED',
          oldValues: { stationId: 'st-1' },
        }),
      );
    });

    it('rejects unassigning a product from another tenant', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(
        service.unassignProductStation('prod-1', testTenantId, testUserId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findAllTicketItems', () => {
    it('returns every ticket item for the tenant oldest first', async () => {
      prisma.kitchenTicketItem.findMany.mockResolvedValue([{ id: 'ti-1' }]);

      const result = await service.findAllTicketItems(testTenantId);

      expect(result).toEqual([{ id: 'ti-1' }]);
      const [args] = prisma.kitchenTicketItem.findMany.mock.calls[0];
      expect(args.where).toEqual({ tenantId: testTenantId });
      expect(args.orderBy).toEqual({ createdAt: 'asc' });
    });

    it('filters by station and status', async () => {
      await service.findAllTicketItems(testTenantId, 'st-1', 'PENDING' as never);

      const [args] = prisma.kitchenTicketItem.findMany.mock.calls[0];
      expect(args.where).toEqual({ tenantId: testTenantId, stationId: 'st-1', status: 'PENDING' });
    });
  });

  describe('updateTicketItemStatus', () => {
    const baseItem = {
      id: 'ti-1',
      status: 'PENDING',
      startedAt: null,
      ticket: { id: 'tk-1', ticketNumber: 'T-1', orderId: 'order-1' },
      station: { id: 'st-1', name: 'Grill' },
    };

    it('stamps startedAt when an item starts preparing', async () => {
      prisma.kitchenTicketItem.findFirst.mockResolvedValue(baseItem);
      prisma.kitchenTicketItem.update.mockResolvedValue({ id: 'ti-1', status: 'PREPARING' });

      const result = await service.updateTicketItemStatus(
        'ti-1',
        { status: 'PREPARING' } as never,
        testTenantId,
        testUserId,
      );

      expect(result.status).toBe('PREPARING');
      const [args] = prisma.kitchenTicketItem.update.mock.calls[0];
      expect(args.data.startedAt).toBeInstanceOf(Date);
      expect(args.data.completedAt).toBeUndefined();
    });

    it('keeps the original startedAt when an item resumes preparing', async () => {
      prisma.kitchenTicketItem.findFirst.mockResolvedValue({
        ...baseItem,
        status: 'READY',
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      prisma.kitchenTicketItem.update.mockResolvedValue({ id: 'ti-1', status: 'PREPARING' });

      await service.updateTicketItemStatus(
        'ti-1',
        { status: 'PREPARING' } as never,
        testTenantId,
        testUserId,
      );

      const [args] = prisma.kitchenTicketItem.update.mock.calls[0];
      expect(args.data.startedAt).toBeUndefined();
    });

    it('stamps completedAt when an item becomes ready', async () => {
      prisma.kitchenTicketItem.findFirst.mockResolvedValue({ ...baseItem, startedAt: new Date() });
      prisma.kitchenTicketItem.update.mockResolvedValue({ id: 'ti-1', status: 'READY' });

      await service.updateTicketItemStatus(
        'ti-1',
        { status: 'READY' } as never,
        testTenantId,
        testUserId,
      );

      const [args] = prisma.kitchenTicketItem.update.mock.calls[0];
      expect(args.data.completedAt).toBeInstanceOf(Date);
    });

    it('writes the notes when supplied and leaves them otherwise', async () => {
      prisma.kitchenTicketItem.findFirst.mockResolvedValue(baseItem);
      prisma.kitchenTicketItem.update.mockResolvedValue({ id: 'ti-1' });

      await service.updateTicketItemStatus(
        'ti-1',
        { status: 'CANCELLED', notes: 'Customer left' } as never,
        testTenantId,
        testUserId,
      );
      let [args] = prisma.kitchenTicketItem.update.mock.calls[0];
      expect(args.data.notes).toBe('Customer left');

      await service.updateTicketItemStatus(
        'ti-1',
        { status: 'CANCELLED' } as never,
        testTenantId,
        testUserId,
      );
      [args] = prisma.kitchenTicketItem.update.mock.calls[1];
      expect(args.data.notes).toBeUndefined();
    });

    it('broadcasts with the station name and queues the status change', async () => {
      prisma.kitchenTicketItem.findFirst.mockResolvedValue(baseItem);
      prisma.kitchenTicketItem.update.mockResolvedValue({ id: 'ti-1', status: 'SERVED' });

      await service.updateTicketItemStatus(
        'ti-1',
        { status: 'SERVED' } as never,
        testTenantId,
        testUserId,
      );

      expect(gateway.broadcastItemUpdate).toHaveBeenCalledWith(testTenantId, {
        id: 'ti-1',
        status: 'SERVED',
        stationName: 'Grill',
      });
      expect(queue.addJob).toHaveBeenCalledWith('kitchen', 'ticket-item.status-changed', {
        tenantId: testTenantId,
        userId: testUserId,
        payload: {
          itemId: 'ti-1',
          ticketId: 'tk-1',
          ticketNumber: 'T-1',
          status: 'SERVED',
        },
      });
    });

    it('broadcasts a null station name when the item has no station', async () => {
      prisma.kitchenTicketItem.findFirst.mockResolvedValue({ ...baseItem, station: null });
      prisma.kitchenTicketItem.update.mockResolvedValue({ id: 'ti-1', status: 'SERVED' });

      await service.updateTicketItemStatus(
        'ti-1',
        { status: 'SERVED' } as never,
        testTenantId,
        testUserId,
      );

      expect(gateway.broadcastItemUpdate).toHaveBeenCalledWith(
        testTenantId,
        expect.objectContaining({ stationName: null }),
      );
    });

    it('rejects updating a ticket item from another tenant', async () => {
      prisma.kitchenTicketItem.findFirst.mockResolvedValue(null);

      await expect(
        service.updateTicketItemStatus(
          'ti-1',
          { status: 'READY' } as never,
          testTenantId,
          testUserId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getStationQueue', () => {
    it('returns the station summary with only open items', async () => {
      prisma.kitchenStation.findFirst.mockResolvedValue({
        id: 'st-1',
        name: 'Grill',
        color: '#ff0000',
      });
      prisma.kitchenTicketItem.findMany.mockResolvedValue([{ id: 'ti-1' }]);

      const result = await service.getStationQueue('st-1', testTenantId);

      expect(result.station).toEqual({ id: 'st-1', name: 'Grill', color: '#ff0000' });
      expect(result.items).toEqual([{ id: 'ti-1' }]);
      const [args] = prisma.kitchenTicketItem.findMany.mock.calls[0];
      expect(args.where.status.in).toEqual(['PENDING', 'QUEUED', 'PREPARING']);
      expect(args.orderBy).toEqual([{ status: 'asc' }, { createdAt: 'asc' }]);
    });

    it('rejects reading a queue for a station in another tenant', async () => {
      prisma.kitchenStation.findFirst.mockResolvedValue(null);

      await expect(service.getStationQueue('st-1', testTenantId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('getKdsDashboard', () => {
    it('summarises every active station queue', async () => {
      prisma.kitchenStation.findMany.mockResolvedValue([
        { id: 'st-1', name: 'Grill', color: '#f00' },
        { id: 'st-2', name: 'Fryer', color: '#0f0' },
      ]);
      prisma.kitchenStation.findFirst
        .mockResolvedValueOnce({ id: 'st-1', name: 'Grill', color: '#f00' })
        .mockResolvedValueOnce({ id: 'st-2', name: 'Fryer', color: '#0f0' });
      prisma.kitchenTicketItem.findMany
        .mockResolvedValueOnce([{ id: 'ti-1' }, { id: 'ti-2' }])
        .mockResolvedValueOnce([{ id: 'ti-3' }]);

      const summary = await service.getKdsDashboard(testTenantId, 'rest-1');

      const [args] = prisma.kitchenStation.findMany.mock.calls[0];
      expect(args.where).toEqual({
        restaurantId: 'rest-1',
        tenantId: testTenantId,
        deletedAt: null,
        isActive: true,
      });
      expect(summary.totalActive).toBe(2);
      expect(summary.totalItems).toBe(3);
      expect(summary.stations).toHaveLength(2);
    });

    it('reports zero items when no stations are active', async () => {
      prisma.kitchenStation.findMany.mockResolvedValue([]);

      const summary = await service.getKdsDashboard(testTenantId, 'rest-1');

      expect(summary).toEqual({ totalActive: 0, totalItems: 0, stations: [] });
    });
  });

  describe('handleOrderConfirmed', () => {
    it('creates one ticket per station and its items, then queues the event', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order-1',
        items: [
          { id: 'oi-1', product: { id: 'p1', stationId: 'st-1' } },
          { id: 'oi-2', product: { id: 'p2', stationId: 'st-1' } },
          { id: 'oi-3', product: { id: 'p3', stationId: 'st-2' } },
          { id: 'oi-4', product: { id: 'p4', stationId: null } },
        ],
      });
      prisma.kitchenTicket.findFirst.mockResolvedValue(null);
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
        cb({
          kitchenTicket: {
            count: jest.fn().mockResolvedValue(0),
            create: jest.fn().mockResolvedValue({ id: 'tk-1' }),
            findUnique: jest.fn().mockResolvedValue({ id: 'tk-1', items: [] }),
          },
          kitchenTicketItem: { create: jest.fn().mockResolvedValue({ id: 'ti-1' }) },
        }),
      );

      await service.handleOrderConfirmed({ tenantId: testTenantId, orderId: 'order-1' });

      expect(gateway.broadcastTicketUpdate).toHaveBeenCalledTimes(3);
      expect(metrics.incrementKitchenTickets).toHaveBeenCalledTimes(3);
      expect(queue.addJob).toHaveBeenCalledWith('kitchen', 'order.confirmed.kds', {
        tenantId: testTenantId,
        payload: { orderId: 'order-1' },
      });
    });

    it('ignores an order that no longer exists', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await service.handleOrderConfirmed({ tenantId: testTenantId, orderId: 'order-1' });

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(queue.addJob).not.toHaveBeenCalled();
    });

    it('skips when the order already has kitchen tickets', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order-1',
        items: [{ id: 'oi-1', product: { id: 'p1', stationId: 'st-1' } }],
      });
      prisma.kitchenTicket.findFirst.mockResolvedValue({ id: 'tk-1' });

      await service.handleOrderConfirmed({ tenantId: testTenantId, orderId: 'order-1' });

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('skips when the order has no items to ticket', async () => {
      prisma.order.findUnique.mockResolvedValue({ id: 'order-1', items: [] });
      prisma.kitchenTicket.findFirst.mockResolvedValue(null);

      await service.handleOrderConfirmed({ tenantId: testTenantId, orderId: 'order-1' });

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('retries on a ticket number conflict and succeeds', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order-1',
        items: [{ id: 'oi-1', product: { id: 'p1', stationId: 'st-1' } }],
      });
      prisma.kitchenTicket.findFirst.mockResolvedValue(null);
      prisma.$transaction
        .mockRejectedValueOnce(
          new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: 'test',
            meta: { target: ['orderId', 'ticketNumber'] },
          }),
        )
        .mockImplementationOnce(async (cb: (tx: unknown) => unknown) =>
          cb({
            kitchenTicket: {
              count: jest.fn().mockResolvedValue(0),
              create: jest.fn().mockResolvedValue({ id: 'tk-1' }),
              findUnique: jest.fn().mockResolvedValue({ id: 'tk-1' }),
            },
            kitchenTicketItem: { create: jest.fn().mockResolvedValue({}) },
          }),
        );

      await service.handleOrderConfirmed({ tenantId: testTenantId, orderId: 'order-1' });

      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
      expect(queue.addJob).toHaveBeenCalled();
    });

    it('treats an order item conflict as an idempotent skip', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order-1',
        items: [{ id: 'oi-1', product: { id: 'p1', stationId: 'st-1' } }],
      });
      prisma.kitchenTicket.findFirst.mockResolvedValue(null);
      prisma.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['orderItemId'] },
        }),
      );

      await service.handleOrderConfirmed({ tenantId: testTenantId, orderId: 'order-1' });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('surfaces an unexpected transaction failure', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order-1',
        items: [{ id: 'oi-1', product: { id: 'p1', stationId: 'st-1' } }],
      });
      prisma.kitchenTicket.findFirst.mockResolvedValue(null);
      prisma.$transaction.mockRejectedValue(new Error('connection lost'));

      await expect(
        service.handleOrderConfirmed({ tenantId: testTenantId, orderId: 'order-1' }),
      ).rejects.toThrow('connection lost');
    });

    it('gives up after exhausting the ticket number retries', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order-1',
        items: [{ id: 'oi-1', product: { id: 'p1', stationId: 'st-1' } }],
      });
      prisma.kitchenTicket.findFirst.mockResolvedValue(null);
      prisma.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['orderId', 'ticketNumber'] },
        }),
      );

      await expect(
        service.handleOrderConfirmed({ tenantId: testTenantId, orderId: 'order-1' }),
      ).rejects.toBeDefined();
      expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    });
  });
});
