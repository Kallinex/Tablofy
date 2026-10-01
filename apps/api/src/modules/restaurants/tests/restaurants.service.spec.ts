import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { RestaurantsService } from '../restaurants.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { PlanLimitsService } from '../../../common/services/plan-limits.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockEventEmitter, MockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';
import { CreateRestaurantDto } from '../dto/create-restaurant.dto';
import { UpdateRestaurantDto } from '../dto/update-restaurant.dto';

const userId = 'user-1';
const asDto = <T>(value: Record<string, unknown>) => value as unknown as T;

describe('RestaurantsService', () => {
  let service: RestaurantsService;
  let prisma: MockPrisma;
  let audit: MockAuditLogs;
  let events: MockEventEmitter;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RestaurantsService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: PlanLimitsService, useValue: { checkLimit: jest.fn() } },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
      ],
    }).compile();

    service = module.get<RestaurantsService>(RestaurantsService);
    prisma = module.get(PrismaService) as MockPrisma;
    audit = module.get(AuditLogsService) as MockAuditLogs;
    events = module.get(EventEmitter2) as unknown as MockEventEmitter;
  });

  beforeEach(() => {
    prisma.reset();
    audit.reset();
    events.reset();
  });

  const restaurant = {
    id: 'r-1',
    tenantId: testTenantId,
    name: 'Pizza',
    slug: 'pizza',
    timezone: 'UTC',
    currency: 'USD',
    isActive: true,
    deletedAt: null,
  };

  describe('create', () => {
    it('rejects a duplicate slug inside the tenant', async () => {
      prisma.restaurant.findFirst.mockResolvedValue(restaurant);
      await expect(
        service.create(
          asDto<CreateRestaurantDto>({ name: 'Pizza', slug: 'pizza' }),
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.restaurant.findFirst.mock.calls[0][0].where).toMatchObject({
        tenantId: testTenantId,
        slug: 'pizza',
      });
    });

    it('applies defaults and emits', async () => {
      prisma.restaurant.findFirst.mockResolvedValue(null);
      prisma.restaurant.create.mockResolvedValue({ ...restaurant, id: 'r-9' });

      await service.create(
        asDto<CreateRestaurantDto>({ name: 'Pizza', slug: 'pizza' }),
        testTenantId,
        userId,
      );

      const data = prisma.restaurant.create.mock.calls[0][0].data;
      expect(data.timezone).toBe('UTC');
      expect(data.currency).toBe('USD');
      expect(events.emit).toHaveBeenCalledWith(
        'restaurant.created',
        expect.objectContaining({ restaurantId: 'r-9' }),
      );
    });
  });

  describe('findAll', () => {
    it('scopes by tenant with search and pagination', async () => {
      prisma.restaurant.findMany.mockResolvedValue([restaurant]);
      prisma.restaurant.count.mockResolvedValue(42);

      const result = await service.findAll({
        tenantId: testTenantId,
        page: 3,
        limit: 10,
        search: 'pi',
      });

      const where = prisma.restaurant.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({ tenantId: testTenantId, deletedAt: null });
      expect(where.OR).toHaveLength(3);
      expect(result.meta).toEqual({ total: 42, page: 3, limit: 10, totalPages: 5 });
    });
  });

  describe('findOne', () => {
    it('throws when not found', async () => {
      prisma.restaurant.findFirst.mockResolvedValue(null);
      await expect(service.findOne('r-1', testTenantId)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('rejects a slug taken by another restaurant', async () => {
      prisma.restaurant.findFirst
        .mockResolvedValueOnce(restaurant)
        .mockResolvedValueOnce({ id: 'r-2' });
      await expect(
        service.update('r-1', asDto<UpdateRestaurantDto>({ slug: 'other' }), testTenantId, userId),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('writes only provided fields and emits updated', async () => {
      prisma.restaurant.findFirst.mockResolvedValue(restaurant);
      prisma.restaurant.update.mockResolvedValue(restaurant);

      await service.update(
        'r-1',
        asDto<UpdateRestaurantDto>({ currency: 'EUR' }),
        testTenantId,
        userId,
      );

      expect(prisma.restaurant.update.mock.calls[0][0].data).toEqual({ currency: 'EUR' });
      expect(events.emit).toHaveBeenCalledWith(
        'restaurant.updated',
        expect.objectContaining({ restaurantId: 'r-1' }),
      );
    });
  });

  describe('softDelete / restore', () => {
    it('soft-deletes and emits', async () => {
      prisma.restaurant.findFirst.mockResolvedValue(restaurant);
      prisma.restaurant.update.mockResolvedValue({});

      await service.softDelete('r-1', testTenantId, userId);

      const data = prisma.restaurant.update.mock.calls[0][0].data;
      expect(data.deletedAt).toBeInstanceOf(Date);
      expect(data.isActive).toBe(false);
    });

    it('restores a deleted restaurant', async () => {
      prisma.restaurant.findFirst.mockResolvedValue({ ...restaurant, deletedAt: new Date() });
      prisma.restaurant.update.mockResolvedValue(restaurant);

      await service.restore('r-1', testTenantId, userId);

      expect(prisma.restaurant.update.mock.calls[0][0].data).toEqual({
        deletedAt: null,
        isActive: true,
      });
    });

    it('throws restoring a non-deleted restaurant', async () => {
      prisma.restaurant.findFirst.mockResolvedValue(null);
      await expect(service.restore('r-1', testTenantId, userId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
