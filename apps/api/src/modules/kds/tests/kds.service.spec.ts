import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { KdsService } from '../kds.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { QueueService } from '../../queues/queue.service';
import { MetricsService } from '../../../common/metrics/metrics.service';
import { KdsGateway } from '../kds.gateway';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockCache, MockCache } from '../../../test/mocks/cache.mock';
import { createMockQueue } from '../../../test/mocks/queue.mock';
import { createMockEventEmitter, MockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { createMockMetrics } from '../../../test/mocks/metrics.mock';
import { testTenantId, testUserId } from '../../../test/fixtures/auth.fixture';

describe('KdsService', () => {
  let service: KdsService;
  let prisma: MockPrisma;
  let auditLogs: MockAuditLogs;
  let cache: MockCache;
  let eventEmitter: MockEventEmitter;

  const mockGateway = { broadcastStationUpdate: jest.fn() };

  const stationDto = {
    name: 'Grill',
    slug: 'grill',
    description: 'Grill station',
    color: '#ff0000',
    icon: 'fire',
    displayOrder: 1,
    isActive: true,
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KdsService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: CacheService, useValue: createMockCache() },
        { provide: QueueService, useValue: createMockQueue() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
        { provide: KdsGateway, useValue: mockGateway },
        { provide: MetricsService, useValue: createMockMetrics() },
      ],
    }).compile();

    service = module.get<KdsService>(KdsService);
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

  describe('createStation', () => {
    it('should create a station only after verifying the restaurant belongs to the tenant', async () => {
      prisma.restaurant.findFirst.mockResolvedValue({ id: 'restaurant-1' });
      prisma.kitchenStation.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      const station = { id: 'station-1', restaurantId: 'restaurant-1', tenantId: testTenantId };
      prisma.kitchenStation.create.mockResolvedValue(station);

      const result = await service.createStation(
        stationDto,
        'restaurant-1',
        testTenantId,
        testUserId,
      );

      expect(prisma.restaurant.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'restaurant-1', tenantId: testTenantId, deletedAt: null },
        }),
      );
      expect(prisma.kitchenStation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ restaurantId: 'restaurant-1', tenantId: testTenantId }),
        }),
      );
      expect(result).toEqual(station);
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'KITCHEN_STATION_CREATED' }),
      );
    });

    it('should reject station creation when the restaurant is not in the tenant', async () => {
      prisma.restaurant.findFirst.mockResolvedValue(null);

      await expect(
        service.createStation(stationDto, 'restaurant-foreign', testTenantId, testUserId),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.kitchenStation.create).not.toHaveBeenCalled();
    });

    it('should reject a duplicate slug for the restaurant', async () => {
      prisma.restaurant.findFirst.mockResolvedValue({ id: 'restaurant-1' });
      prisma.kitchenStation.findUnique.mockResolvedValueOnce({ id: 'station-existing' });

      await expect(
        service.createStation(stationDto, 'restaurant-1', testTenantId, testUserId),
      ).rejects.toThrow(ConflictException);
    });

    it('should reject a duplicate name for the restaurant', async () => {
      prisma.restaurant.findFirst.mockResolvedValue({ id: 'restaurant-1' });
      prisma.kitchenStation.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'station-existing' });

      await expect(
        service.createStation(stationDto, 'restaurant-1', testTenantId, testUserId),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('handleOrderConfirmed', () => {
    const order = (items: Array<{ id: string; product: { stationId: string | null } }>) => ({
      id: 'order-1',
      items,
    });

    function buildTx(
      overrides: {
        countResult?: number;
        createResult?: unknown;
        createError?: unknown;
      } = {},
    ) {
      let createdCount = overrides.countResult ?? 0;
      const tx = {
        kitchenTicket: {
          count: jest.fn().mockImplementation(() => Promise.resolve(createdCount)),
          create: jest.fn().mockImplementation(() => {
            if (overrides.createError) return Promise.reject(overrides.createError);
            createdCount += 1;
            return Promise.resolve(
              overrides.createResult ?? {
                id: `ticket-${createdCount}`,
                ticketNumber: createdCount,
              },
            );
          }),
          findUnique: jest.fn().mockResolvedValue({ id: 'ticket-1' }),
        },
        kitchenTicketItem: {
          create: jest.fn().mockResolvedValue({ id: 'ticket-item-1' }),
        },
      };
      prisma.$transaction.mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx));
      return tx;
    }

    it('should create one ticket per kitchen station with its items', async () => {
      prisma.order.findUnique.mockResolvedValue(
        order([
          { id: 'item-1', product: { stationId: 'st-1' } },
          { id: 'item-2', product: { stationId: 'st-1' } },
          { id: 'item-3', product: { stationId: 'st-2' } },
        ]),
      );
      const tx = buildTx();
      const mockGatewayWithTicket = mockGateway as unknown as {
        broadcastTicketUpdate: jest.Mock;
      };
      mockGatewayWithTicket.broadcastTicketUpdate = jest.fn();

      await service.handleOrderConfirmed({ tenantId: testTenantId, orderId: 'order-1' });

      expect(tx.kitchenTicket.create).toHaveBeenCalledTimes(2);
      const ticketData = tx.kitchenTicket.create.mock.calls.map((c) => c[0].data);
      expect(ticketData.map((d) => d.stationId)).toEqual(['st-1', 'st-2']);
      expect(ticketData[0].ticketNumber).toBe(1);
      expect(ticketData[1].ticketNumber).toBe(2);
      expect(tx.kitchenTicketItem.create).toHaveBeenCalledTimes(3);
      expect(mockGatewayWithTicket.broadcastTicketUpdate).toHaveBeenCalledTimes(2);
    });

    it('should not create tickets when the order has no items', async () => {
      prisma.order.findUnique.mockResolvedValue(order([]));
      const tx = buildTx();

      await service.handleOrderConfirmed({ tenantId: testTenantId, orderId: 'order-1' });

      expect(tx.kitchenTicket.create).not.toHaveBeenCalled();
      expect(tx.kitchenTicketItem.create).not.toHaveBeenCalled();
    });

    it('should retry when the ticket number collides (P2002) and then succeed', async () => {
      prisma.order.findUnique.mockResolvedValue(
        order([{ id: 'item-1', product: { stationId: 'st-1' } }]),
      );
      const conflict = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`orderId`,`ticketNumber`)',
        {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['orderId', 'ticketNumber'] },
        },
      );
      const tx = {
        kitchenTicket: {
          count: jest.fn().mockResolvedValue(0),
          create: jest
            .fn()
            .mockRejectedValueOnce(conflict)
            .mockResolvedValue({ id: 'ticket-1', ticketNumber: 1 }),
          findUnique: jest.fn().mockResolvedValue({ id: 'ticket-1' }),
        },
        kitchenTicketItem: {
          create: jest.fn().mockResolvedValue({ id: 'ticket-item-1' }),
        },
      };
      prisma.$transaction.mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx));

      await service.handleOrderConfirmed({ tenantId: testTenantId, orderId: 'order-1' });

      expect(tx.kitchenTicket.create).toHaveBeenCalledTimes(2);
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });

    it('should skip idempotently when tickets already exist for the order (P1-03)', async () => {
      prisma.order.findUnique.mockResolvedValue(
        order([{ id: 'item-1', product: { stationId: 'st-1' } }]),
      );
      prisma.kitchenTicket.findFirst.mockResolvedValue({ id: 'ticket-1' });

      await service.handleOrderConfirmed({ tenantId: testTenantId, orderId: 'order-1' });

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.kitchenTicket.create).not.toHaveBeenCalled();
    });

    it('should treat a concurrent duplicate orderItemId conflict as idempotent (P1-03)', async () => {
      prisma.order.findUnique.mockResolvedValue(
        order([{ id: 'item-1', product: { stationId: 'st-1' } }]),
      );
      const conflict = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`orderItemId`)',
        {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['orderItemId'] },
        },
      );
      const tx = {
        kitchenTicket: {
          count: jest.fn().mockResolvedValue(0),
          create: jest.fn().mockResolvedValue({ id: 'ticket-1', ticketNumber: 1 }),
          findUnique: jest.fn().mockResolvedValue({ id: 'ticket-1', items: [] }),
        },
        kitchenTicketItem: {
          create: jest.fn().mockRejectedValue(conflict),
        },
      };
      prisma.$transaction.mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx));

      await service.handleOrderConfirmed({ tenantId: testTenantId, orderId: 'order-1' });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.kitchenTicket.create).toHaveBeenCalledTimes(1);
    });

    it('should propagate errors instead of swallowing them', async () => {
      prisma.order.findUnique.mockResolvedValue(
        order([{ id: 'item-1', product: { stationId: 'st-1' } }]),
      );
      buildTx({ createError: new Error('db down') });

      await expect(
        service.handleOrderConfirmed({ tenantId: testTenantId, orderId: 'order-1' }),
      ).rejects.toThrow('db down');
    });

    it('should propagate a persistent ticket-number conflict after all retries', async () => {
      prisma.order.findUnique.mockResolvedValue(
        order([{ id: 'item-1', product: { stationId: 'st-1' } }]),
      );
      const conflict = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`orderId`,`ticketNumber`)',
        {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['orderId', 'ticketNumber'] },
        },
      );
      buildTx({ createError: conflict });

      await expect(
        service.handleOrderConfirmed({ tenantId: testTenantId, orderId: 'order-1' }),
      ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);

      expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    });
  });
});
