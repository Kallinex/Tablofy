import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
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
});
