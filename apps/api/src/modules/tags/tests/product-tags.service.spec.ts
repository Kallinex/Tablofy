import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { ProductTagsService } from '../product-tags.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockEventEmitter, MockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';
import { CreateProductTagDto } from '../dto/create-product-tag.dto';
import { UpdateProductTagDto } from '../dto/update-product-tag.dto';

const userId = 'user-1';
const restaurantId = 'rest-1';
const tagId = 'tag-1';
const productId = 'prod-1';
const asDto = <T>(value: Record<string, unknown>) => value as unknown as T;

describe('ProductTagsService', () => {
  let service: ProductTagsService;
  let prisma: MockPrisma;
  let audit: MockAuditLogs;
  let events: MockEventEmitter;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductTagsService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
      ],
    }).compile();

    service = module.get<ProductTagsService>(ProductTagsService);
    prisma = module.get(PrismaService) as MockPrisma;
    audit = module.get(AuditLogsService) as MockAuditLogs;
    events = module.get(EventEmitter2) as unknown as MockEventEmitter;
  });

  beforeEach(() => {
    prisma.reset();
    audit.reset();
    events.reset();
  });

  const tag = {
    id: tagId,
    restaurantId,
    tenantId: testTenantId,
    name: 'Vegan',
    slug: 'vegan',
    isActive: true,
    deletedAt: null,
  };

  describe('create', () => {
    it('throws when the restaurant is missing', async () => {
      prisma.restaurant.findFirst.mockResolvedValue(null);
      await expect(
        service.create(
          asDto<CreateProductTagDto>({ name: 'Vegan' }),
          restaurantId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws on duplicate slug', async () => {
      prisma.restaurant.findFirst.mockResolvedValue({ id: restaurantId });
      prisma.productTag.findFirst.mockResolvedValue({ id: 'other' });
      await expect(
        service.create(
          asDto<CreateProductTagDto>({ name: 'Vegan' }),
          restaurantId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('generates a slug, audits and emits', async () => {
      prisma.restaurant.findFirst.mockResolvedValue({ id: restaurantId });
      prisma.productTag.create.mockResolvedValue(tag);

      await service.create(
        asDto<CreateProductTagDto>({ name: 'Vegan Friendly' }),
        restaurantId,
        testTenantId,
        userId,
      );

      expect(prisma.productTag.create.mock.calls[0][0].data.slug).toBe('vegan-friendly');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PRODUCT_TAG_CREATED' }),
      );
      expect(events.emit).toHaveBeenCalledWith('productTag.created', expect.anything());
    });
  });

  describe('findAll', () => {
    it('scopes, filters and paginates', async () => {
      prisma.productTag.findMany.mockResolvedValue([tag]);
      prisma.productTag.count.mockResolvedValue(1);

      const result = await service.findAll({
        tenantId: testTenantId,
        restaurantId,
        search: 'veg',
        isActive: true,
      });

      const where = prisma.productTag.findMany.mock.calls[0][0].where;
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
    it('throws when missing', async () => {
      prisma.productTag.findFirst.mockResolvedValue(null);
      await expect(service.findOne(tagId, testTenantId)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the tag', async () => {
      prisma.productTag.findFirst.mockResolvedValue(tag);
      await expect(service.findOne(tagId, testTenantId)).resolves.toBe(tag);
    });
  });

  describe('update', () => {
    it('throws on a slug collision', async () => {
      prisma.productTag.findFirst.mockResolvedValueOnce(tag).mockResolvedValueOnce({ id: 'other' });
      await expect(
        service.update(tagId, asDto<UpdateProductTagDto>({ slug: 'new' }), testTenantId, userId),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('updates and audits', async () => {
      prisma.productTag.findFirst.mockResolvedValueOnce(tag);
      prisma.productTag.update.mockResolvedValue({ ...tag, name: 'Plant-based' });

      await service.update(
        tagId,
        asDto<UpdateProductTagDto>({ name: 'Plant-based' }),
        testTenantId,
        userId,
      );

      expect(prisma.productTag.update.mock.calls[0][0].data.name).toBe('Plant-based');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PRODUCT_TAG_UPDATED' }),
      );
    });
  });

  describe('softDelete', () => {
    it('marks the tag deleted and emits', async () => {
      prisma.productTag.findFirst.mockResolvedValue(tag);

      await service.softDelete(tagId, testTenantId, userId);

      expect(prisma.productTag.update.mock.calls[0][0].data).toMatchObject({ isActive: false });
      expect(events.emit).toHaveBeenCalledWith('productTag.deleted', expect.anything());
    });
  });

  describe('restore', () => {
    it('throws when there is nothing to restore', async () => {
      prisma.productTag.findFirst.mockResolvedValue(null);
      await expect(service.restore(tagId, testTenantId, userId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('restores and reactivates', async () => {
      prisma.productTag.findFirst.mockResolvedValue({ ...tag, deletedAt: new Date() });
      prisma.productTag.update.mockResolvedValue(tag);

      await service.restore(tagId, testTenantId, userId);

      expect(prisma.productTag.update.mock.calls[0][0].data).toEqual({
        deletedAt: null,
        isActive: true,
      });
    });
  });

  describe('assignToProduct', () => {
    it('throws when the product is missing', async () => {
      prisma.product.findFirst.mockResolvedValue(null);
      await expect(
        service.assignToProduct(productId, [tagId], restaurantId, testTenantId, userId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws when a tag is missing', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: productId });
      prisma.productTag.findFirst.mockResolvedValue(null);
      await expect(
        service.assignToProduct(productId, [tagId], restaurantId, testTenantId, userId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('creates assignments and returns the assigned tags', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: productId });
      prisma.productTag.findFirst.mockResolvedValue(tag);
      prisma.productTag.findMany.mockResolvedValue([tag]);

      const result = await service.assignToProduct(
        productId,
        [tagId],
        restaurantId,
        testTenantId,
        userId,
      );

      expect(prisma.productTagAssignment.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: [{ productId, tagId }], skipDuplicates: true }),
      );
      expect(result).toEqual([tag]);
    });
  });

  describe('removeFromProduct', () => {
    it('throws when the product is not in the tenant', async () => {
      prisma.product.findFirst.mockResolvedValue(null);
      await expect(
        service.removeFromProduct(productId, tagId, testTenantId, userId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws when the assignment does not exist', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: productId });
      prisma.productTagAssignment.findUnique.mockResolvedValue(null);
      await expect(
        service.removeFromProduct(productId, tagId, testTenantId, userId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('removes the assignment after verifying tenant ownership', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: productId });
      prisma.productTagAssignment.findUnique.mockResolvedValue({ id: 'a-1' });

      await service.removeFromProduct(productId, tagId, testTenantId, userId);

      expect(prisma.product.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: productId, tenantId: testTenantId, deletedAt: null },
        }),
      );
      expect(prisma.productTagAssignment.delete).toHaveBeenCalledWith({
        where: { productId_tagId: { productId, tagId } },
      });
    });
  });

  describe('listProductTags', () => {
    it('throws when the product is missing', async () => {
      prisma.product.findFirst.mockResolvedValue(null);
      await expect(service.listProductTags(productId, testTenantId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns the tags assigned to the product', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: productId });
      prisma.productTag.findMany.mockResolvedValue([tag]);

      const result = await service.listProductTags(productId, testTenantId);

      expect(prisma.productTag.findMany.mock.calls[0][0].where).toMatchObject({
        products: { some: { productId } },
        tenantId: testTenantId,
      });
      expect(result).toEqual([tag]);
    });
  });
});
