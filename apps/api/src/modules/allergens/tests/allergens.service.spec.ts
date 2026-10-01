import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { AllergensService } from '../allergens.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockEventEmitter, MockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';
import { CreateAllergenDto } from '../dto/create-allergen.dto';
import { UpdateAllergenDto } from '../dto/update-allergen.dto';

const userId = 'user-1';
const restaurantId = 'r-1';
const asDto = <T>(value: Record<string, unknown>) => value as unknown as T;

describe('AllergensService', () => {
  let service: AllergensService;
  let prisma: MockPrisma;
  let audit: MockAuditLogs;
  let events: MockEventEmitter;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AllergensService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
      ],
    }).compile();

    service = module.get<AllergensService>(AllergensService);
    prisma = module.get(PrismaService) as MockPrisma;
    audit = module.get(AuditLogsService) as MockAuditLogs;
    events = module.get(EventEmitter2) as unknown as MockEventEmitter;
  });

  beforeEach(() => {
    prisma.reset();
    audit.reset();
    events.reset();
  });

  const allergen = {
    id: 'a-1',
    tenantId: testTenantId,
    restaurantId,
    name: 'Peanuts',
    slug: 'peanuts',
    isActive: true,
    deletedAt: null,
  };

  describe('create', () => {
    it('requires the restaurant to belong to the tenant', async () => {
      prisma.restaurant.findFirst.mockResolvedValue(null);

      await expect(
        service.create(
          asDto<CreateAllergenDto>({ name: 'Peanuts' }),
          restaurantId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('derives a slug from the name and rejects duplicates', async () => {
      prisma.restaurant.findFirst.mockResolvedValue({ id: restaurantId });
      prisma.allergen.findFirst.mockResolvedValue(allergen);

      await expect(
        service.create(
          asDto<CreateAllergenDto>({ name: 'Peanuts' }),
          restaurantId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.allergen.findFirst.mock.calls[0][0].where.slug).toBe('peanuts');
    });

    it('normalizes the slug and audits + emits on success', async () => {
      prisma.restaurant.findFirst.mockResolvedValue({ id: restaurantId });
      prisma.allergen.findFirst.mockResolvedValue(null);
      prisma.allergen.create.mockResolvedValue({ ...allergen, id: 'a-9' });

      await service.create(
        asDto<CreateAllergenDto>({ name: 'Tree Nuts & Seeds' }),
        restaurantId,
        testTenantId,
        userId,
      );

      expect(prisma.allergen.create.mock.calls[0][0].data.slug).toBe('tree-nuts-seeds');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ALLERGEN_CREATED', resourceId: 'a-9' }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        'allergen.created',
        expect.objectContaining({ allergenId: 'a-9' }),
      );
    });

    it('respects an explicitly provided slug', async () => {
      prisma.restaurant.findFirst.mockResolvedValue({ id: restaurantId });
      prisma.allergen.findFirst.mockResolvedValue(null);
      prisma.allergen.create.mockResolvedValue(allergen);

      await service.create(
        asDto<CreateAllergenDto>({ name: 'Peanuts', slug: 'custom' }),
        restaurantId,
        testTenantId,
        userId,
      );

      expect(prisma.allergen.create.mock.calls[0][0].data.slug).toBe('custom');
    });
  });

  describe('findAll', () => {
    it('scopes by tenant and restaurant and paginates', async () => {
      prisma.allergen.findMany.mockResolvedValue([allergen]);
      prisma.allergen.count.mockResolvedValue(1);

      const result = await service.findAll({
        tenantId: testTenantId,
        restaurantId,
        page: 1,
        limit: 10,
        search: 'pea',
        isActive: true,
      });

      const where = prisma.allergen.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({
        tenantId: testTenantId,
        restaurantId,
        deletedAt: null,
        isActive: true,
      });
      expect(where.OR).toHaveLength(2);
      expect(result.meta.totalPages).toBe(1);
    });
  });

  describe('findOne', () => {
    it('throws when not found for the tenant', async () => {
      prisma.allergen.findFirst.mockResolvedValue(null);

      await expect(service.findOne('a-1', testTenantId)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the allergen when found', async () => {
      prisma.allergen.findFirst.mockResolvedValue(allergen);

      expect(await service.findOne('a-1', testTenantId)).toBe(allergen);
    });
  });

  describe('update', () => {
    it('rejects renaming to a slug used by another allergen', async () => {
      prisma.allergen.findFirst
        .mockResolvedValueOnce(allergen) // findOne
        .mockResolvedValueOnce({ id: 'a-2' }); // slug clash

      await expect(
        service.update('a-1', asDto<UpdateAllergenDto>({ slug: 'milk' }), testTenantId, userId),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('only writes provided fields', async () => {
      prisma.allergen.findFirst.mockResolvedValue(allergen);
      prisma.allergen.update.mockResolvedValue(allergen);

      await service.update(
        'a-1',
        asDto<UpdateAllergenDto>({ description: 'x' }),
        testTenantId,
        userId,
      );

      expect(prisma.allergen.update.mock.calls[0][0].data).toEqual({ description: 'x' });
    });
  });

  describe('softDelete / restore', () => {
    it('soft-deletes, deactivates and emits', async () => {
      prisma.allergen.findFirst.mockResolvedValue(allergen);
      prisma.allergen.update.mockResolvedValue({});

      await service.softDelete('a-1', testTenantId, userId);

      const data = prisma.allergen.update.mock.calls[0][0].data;
      expect(data.deletedAt).toBeInstanceOf(Date);
      expect(data.isActive).toBe(false);
      expect(events.emit).toHaveBeenCalledWith(
        'allergen.deleted',
        expect.objectContaining({ allergenId: 'a-1' }),
      );
    });

    it('restores a deleted allergen', async () => {
      prisma.allergen.findFirst.mockResolvedValue({ ...allergen, deletedAt: new Date() });
      prisma.allergen.update.mockResolvedValue(allergen);

      await service.restore('a-1', testTenantId, userId);

      expect(prisma.allergen.update.mock.calls[0][0].data).toEqual({
        deletedAt: null,
        isActive: true,
      });
    });
  });

  describe('assignToProduct', () => {
    it('requires the product to belong to the tenant', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(
        service.assignToProduct('p-1', ['a-1'], restaurantId, testTenantId, userId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('validates every allergen before assigning', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'p-1' });
      prisma.allergen.findFirst.mockResolvedValueOnce({ id: 'a-1' }).mockResolvedValueOnce(null);

      await expect(
        service.assignToProduct('p-1', ['a-1', 'a-2'], restaurantId, testTenantId, userId),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.productAllergenAssignment.createMany).not.toHaveBeenCalled();
    });

    it('creates assignments skipping duplicates and returns the assigned allergens', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'p-1' });
      prisma.allergen.findFirst.mockResolvedValue({ id: 'a-1' });
      prisma.productAllergenAssignment.createMany.mockResolvedValue({ count: 2 });
      prisma.allergen.findMany.mockResolvedValue([allergen]);

      const result = await service.assignToProduct(
        'p-1',
        ['a-1', 'a-2'],
        restaurantId,
        testTenantId,
        userId,
      );

      expect(prisma.productAllergenAssignment.createMany).toHaveBeenCalledWith({
        data: [
          { productId: 'p-1', allergenId: 'a-1' },
          { productId: 'p-1', allergenId: 'a-2' },
        ],
        skipDuplicates: true,
      });
      expect(result).toEqual([allergen]);
    });
  });

  describe('removeFromProduct', () => {
    it('verifies the product belongs to the tenant before deleting', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(
        service.removeFromProduct('p-1', 'a-1', testTenantId, userId),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.product.findFirst.mock.calls[0][0].where).toMatchObject({
        id: 'p-1',
        tenantId: testTenantId,
      });
      expect(prisma.productAllergenAssignment.delete).not.toHaveBeenCalled();
    });

    it('throws when the allergen is not assigned', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'p-1' });
      prisma.productAllergenAssignment.findUnique.mockResolvedValue(null);

      await expect(
        service.removeFromProduct('p-1', 'a-1', testTenantId, userId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('deletes the assignment and audits', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'p-1' });
      prisma.productAllergenAssignment.findUnique.mockResolvedValue({ id: 'pa-1' });
      prisma.productAllergenAssignment.delete.mockResolvedValue({});

      await service.removeFromProduct('p-1', 'a-1', testTenantId, userId);

      expect(prisma.productAllergenAssignment.delete).toHaveBeenCalledWith({
        where: { productId_allergenId: { productId: 'p-1', allergenId: 'a-1' } },
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PRODUCT_ALLERGEN_REMOVED' }),
      );
    });
  });

  describe('listProductAllergens', () => {
    it('requires the product to belong to the tenant', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(service.listProductAllergens('p-1', testTenantId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('lists only the non-deleted allergens of this product, scoped by tenant', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'p-1' });
      prisma.allergen.findMany.mockResolvedValue([allergen]);

      const result = await service.listProductAllergens('p-1', testTenantId);

      expect(result).toEqual([allergen]);
      expect(prisma.allergen.findMany.mock.calls[0][0].where).toMatchObject({
        tenantId: testTenantId,
        deletedAt: null,
        products: { some: { productId: 'p-1' } },
      });
    });
  });
});
