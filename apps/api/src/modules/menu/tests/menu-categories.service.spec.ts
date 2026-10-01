import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { MenuCategoriesService } from '../menu-categories.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockCache, MockCache } from '../../../test/mocks/cache.mock';
import { createMockEventEmitter, MockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';
import { CreateMenuCategoryDto } from '../dto/create-menu-category.dto';
import { UpdateMenuCategoryDto } from '../dto/update-menu-category.dto';

const userId = 'user-1';
const restaurantId = 'rest-1';
const categoryId = 'cat-1';
const asDto = <T>(value: Record<string, unknown>) => value as unknown as T;

describe('MenuCategoriesService', () => {
  let service: MenuCategoriesService;
  let prisma: MockPrisma;
  let audit: MockAuditLogs;
  let cache: MockCache;
  let events: MockEventEmitter;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MenuCategoriesService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
        { provide: CacheService, useValue: createMockCache() },
      ],
    }).compile();

    service = module.get<MenuCategoriesService>(MenuCategoriesService);
    prisma = module.get(PrismaService) as MockPrisma;
    audit = module.get(AuditLogsService) as MockAuditLogs;
    cache = module.get(CacheService) as unknown as MockCache;
    events = module.get(EventEmitter2) as unknown as MockEventEmitter;
  });

  beforeEach(() => {
    prisma.reset();
    audit.reset();
    cache.reset();
    events.reset();
  });

  const category = {
    id: categoryId,
    restaurantId,
    tenantId: testTenantId,
    name: 'Starters',
    deletedAt: null,
  };

  describe('create', () => {
    it('throws when the restaurant is missing', async () => {
      prisma.restaurant.findFirst.mockResolvedValue(null);
      await expect(
        service.create(
          asDto<CreateMenuCategoryDto>({ name: 'Starters' }),
          restaurantId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws on duplicate name', async () => {
      prisma.restaurant.findFirst.mockResolvedValue({ id: restaurantId });
      prisma.menuCategory.findFirst.mockResolvedValue({ id: 'other' });
      await expect(
        service.create(
          asDto<CreateMenuCategoryDto>({ name: 'Starters' }),
          restaurantId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('creates, audits, emits and invalidates', async () => {
      prisma.restaurant.findFirst.mockResolvedValue({ id: restaurantId });
      prisma.menuCategory.create.mockResolvedValue(category);

      await service.create(
        asDto<CreateMenuCategoryDto>({ name: 'Starters' }),
        restaurantId,
        testTenantId,
        userId,
      );

      expect(prisma.menuCategory.create.mock.calls[0][0].data.sortOrder).toBe(0);
      expect(events.emit).toHaveBeenCalledWith('menuCategory.created', expect.anything());
      expect(cache.delete).toHaveBeenCalledWith(testTenantId, `menu:${restaurantId}:categories`);
    });
  });

  describe('findAll', () => {
    it('scopes and paginates', async () => {
      prisma.menuCategory.findMany.mockResolvedValue([category]);
      prisma.menuCategory.count.mockResolvedValue(1);

      const result = await service.findAll({
        tenantId: testTenantId,
        restaurantId,
        search: 'start',
        isActive: true,
      });

      const where = prisma.menuCategory.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({
        tenantId: testTenantId,
        restaurantId,
        deletedAt: null,
        isActive: true,
      });
      expect(where.OR).toHaveLength(2);
      expect(result.meta.total).toBe(1);
    });
  });

  describe('findOne', () => {
    it('throws when missing', async () => {
      prisma.menuCategory.findFirst.mockResolvedValue(null);
      await expect(service.findOne(categoryId, testTenantId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns the category', async () => {
      prisma.menuCategory.findFirst.mockResolvedValue(category);
      await expect(service.findOne(categoryId, testTenantId)).resolves.toBe(category);
    });
  });

  describe('update', () => {
    it('throws on a name collision', async () => {
      prisma.menuCategory.findFirst
        .mockResolvedValueOnce(category)
        .mockResolvedValueOnce({ id: 'other' });
      await expect(
        service.update(
          categoryId,
          asDto<UpdateMenuCategoryDto>({ name: 'Mains' }),
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('updates and invalidates', async () => {
      prisma.menuCategory.findFirst.mockResolvedValueOnce(category);
      prisma.menuCategory.update.mockResolvedValue({ ...category, name: 'Mains' });

      await service.update(
        categoryId,
        asDto<UpdateMenuCategoryDto>({ name: 'Mains' }),
        testTenantId,
        userId,
      );

      expect(prisma.menuCategory.update.mock.calls[0][0].data.name).toBe('Mains');
      expect(cache.delete).toHaveBeenCalled();
    });
  });

  describe('softDelete', () => {
    it('refuses to delete a category with products', async () => {
      prisma.menuCategory.findFirst.mockResolvedValue(category);
      prisma.product.count.mockResolvedValue(2);

      await expect(service.softDelete(categoryId, testTenantId, userId)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.menuCategory.update).not.toHaveBeenCalled();
    });

    it('soft-deletes an empty category', async () => {
      prisma.menuCategory.findFirst.mockResolvedValue(category);
      prisma.product.count.mockResolvedValue(0);

      await service.softDelete(categoryId, testTenantId, userId);

      expect(prisma.menuCategory.update.mock.calls[0][0].data).toMatchObject({ isActive: false });
    });
  });

  describe('restore', () => {
    it('throws when there is nothing to restore', async () => {
      prisma.menuCategory.findFirst.mockResolvedValue(null);
      await expect(service.restore(categoryId, testTenantId, userId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('restores and reactivates', async () => {
      prisma.menuCategory.findFirst.mockResolvedValue({ ...category, deletedAt: new Date() });
      prisma.menuCategory.update.mockResolvedValue(category);

      await service.restore(categoryId, testTenantId, userId);

      expect(prisma.menuCategory.update.mock.calls[0][0].data).toEqual({
        deletedAt: null,
        isActive: true,
      });
    });
  });
});
