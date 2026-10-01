import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { ProductsService } from '../products.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { PlanLimitsService } from '../../../common/services/plan-limits.service';
import { CacheService } from '../../../common/services/cache.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockCache, MockCache } from '../../../test/mocks/cache.mock';
import { createMockEventEmitter, MockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';
import { CreateProductDto } from '../dto/create-product.dto';
import { UpdateProductDto } from '../dto/update-product.dto';

const userId = 'user-1';
const restaurantId = 'rest-1';
const productId = 'prod-1';
const asDto = <T>(value: Record<string, unknown>) => value as unknown as T;

describe('ProductsService', () => {
  let service: ProductsService;
  let prisma: MockPrisma;
  let audit: MockAuditLogs;
  let cache: MockCache;
  let events: MockEventEmitter;
  let planLimits: { checkLimit: jest.Mock };

  beforeAll(async () => {
    planLimits = { checkLimit: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: PlanLimitsService, useValue: planLimits },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
        { provide: CacheService, useValue: createMockCache() },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
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
    planLimits.checkLimit.mockReset().mockResolvedValue({
      allowed: true,
      current: 0,
      limit: 100,
      resource: 'products',
    });
  });

  const product = {
    id: productId,
    restaurantId,
    tenantId: testTenantId,
    name: 'Pizza',
    sku: 'SKU-1',
    basePrice: 10,
    deletedAt: null,
  };

  describe('create', () => {
    const dto = { name: 'Pizza', basePrice: 10 } as CreateProductDto;

    it('throws when the restaurant is missing', async () => {
      prisma.restaurant.findFirst.mockResolvedValue(null);
      await expect(service.create(dto, restaurantId, testTenantId, userId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws when the category is missing', async () => {
      prisma.restaurant.findFirst.mockResolvedValue({ id: restaurantId });
      prisma.menuCategory.findFirst.mockResolvedValue(null);
      await expect(
        service.create({ ...dto, menuCategoryId: 'cat-1' }, restaurantId, testTenantId, userId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws on duplicate sku', async () => {
      prisma.restaurant.findFirst.mockResolvedValue({ id: restaurantId });
      prisma.product.findFirst.mockResolvedValue({ id: 'other' });
      await expect(
        service.create({ ...dto, sku: 'SKU-1' }, restaurantId, testTenantId, userId),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws when the plan limit is reached', async () => {
      prisma.restaurant.findFirst.mockResolvedValue({ id: restaurantId });
      planLimits.checkLimit.mockResolvedValue({
        allowed: false,
        current: 100,
        limit: 100,
        resource: 'products',
      });
      await expect(service.create(dto, restaurantId, testTenantId, userId)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('creates, audits, emits and invalidates the cache', async () => {
      prisma.restaurant.findFirst.mockResolvedValue({ id: restaurantId });
      prisma.product.create.mockResolvedValue(product);

      const result = await service.create(dto, restaurantId, testTenantId, userId);

      expect(result).toBe(product);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PRODUCT_CREATED' }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        'product.created',
        expect.objectContaining({ productId: productId }),
      );
      expect(cache.deletePattern).toHaveBeenCalledWith(testTenantId, `menu:${restaurantId}:*`);
    });
  });

  describe('findAll', () => {
    it('applies filters and pagination scoped to the tenant', async () => {
      prisma.product.findMany.mockResolvedValue([product]);
      prisma.product.count.mockResolvedValue(1);

      const result = await service.findAll({
        tenantId: testTenantId,
        restaurantId,
        search: 'piz',
        isActive: true,
        menuCategoryId: 'cat-1',
      });

      const where = prisma.product.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({
        tenantId: testTenantId,
        restaurantId,
        deletedAt: null,
        isActive: true,
        menuCategoryId: 'cat-1',
      });
      expect(where.OR).toHaveLength(3);
      expect(result.meta.totalPages).toBe(1);
    });
  });

  describe('findOne', () => {
    it('throws when missing', async () => {
      prisma.product.findFirst.mockResolvedValue(null);
      await expect(service.findOne(productId, testTenantId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('throws on a sku collision', async () => {
      prisma.product.findFirst
        .mockResolvedValueOnce(product)
        .mockResolvedValueOnce({ id: 'other' });
      await expect(
        service.update(productId, asDto<UpdateProductDto>({ sku: 'SKU-2' }), testTenantId, userId),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws when the new category is missing', async () => {
      prisma.product.findFirst.mockResolvedValueOnce(product);
      prisma.menuCategory.findFirst.mockResolvedValue(null);
      await expect(
        service.update(
          productId,
          asDto<UpdateProductDto>({ menuCategoryId: 'cat-1' }),
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('updates, emits and invalidates', async () => {
      prisma.product.findFirst.mockResolvedValueOnce(product);
      prisma.product.update.mockResolvedValue({ ...product, name: 'Calzone' });

      await service.update(
        productId,
        asDto<UpdateProductDto>({ name: 'Calzone' }),
        testTenantId,
        userId,
      );

      expect(prisma.product.update.mock.calls[0][0].data.name).toBe('Calzone');
      expect(events.emit).toHaveBeenCalledWith('product.updated', expect.anything());
      expect(cache.deletePattern).toHaveBeenCalled();
    });
  });

  describe('softDelete', () => {
    it('throws when missing', async () => {
      prisma.product.findFirst.mockResolvedValue(null);
      await expect(service.softDelete(productId, testTenantId, userId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('marks the product deleted and inactive', async () => {
      prisma.product.findFirst.mockResolvedValue(product);
      await service.softDelete(productId, testTenantId, userId);

      expect(prisma.product.update.mock.calls[0][0].data).toMatchObject({ isActive: false });
      expect(prisma.product.update.mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date);
    });
  });

  describe('restore', () => {
    it('throws when there is nothing to restore', async () => {
      prisma.product.findFirst.mockResolvedValue(null);
      await expect(service.restore(productId, testTenantId, userId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('restores and reactivates', async () => {
      prisma.product.findFirst.mockResolvedValue({ ...product, deletedAt: new Date() });
      prisma.product.update.mockResolvedValue({ ...product, deletedAt: null });

      await service.restore(productId, testTenantId, userId);

      expect(prisma.product.update.mock.calls[0][0].data).toEqual({
        deletedAt: null,
        isActive: true,
      });
    });
  });
});
