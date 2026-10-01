import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { ProductVariantsService } from '../product-variants.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockEventEmitter, MockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';
import { CreateProductVariantDto } from '../dto/create-product-variant.dto';
import { UpdateProductVariantDto } from '../dto/update-product-variant.dto';

const userId = 'user-1';
const restaurantId = 'r-1';
const productId = 'p-1';
const asDto = <T>(value: Record<string, unknown>) => value as unknown as T;

describe('ProductVariantsService', () => {
  let service: ProductVariantsService;
  let prisma: MockPrisma;
  let audit: MockAuditLogs;
  let events: MockEventEmitter;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductVariantsService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
      ],
    }).compile();

    service = module.get<ProductVariantsService>(ProductVariantsService);
    prisma = module.get(PrismaService) as MockPrisma;
    audit = module.get(AuditLogsService) as MockAuditLogs;
    events = module.get(EventEmitter2) as unknown as MockEventEmitter;
  });

  beforeEach(() => {
    prisma.reset();
    audit.reset();
    events.reset();
  });

  const variant = {
    id: 'v-1',
    tenantId: testTenantId,
    productId,
    variantGroupId: 'vg-1',
    name: 'Large',
    sku: 'LG',
    price: 12,
    sortOrder: 0,
    isActive: true,
    deletedAt: null,
  };

  describe('create', () => {
    it('requires the product to belong to the tenant and restaurant', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(
        service.create(
          asDto<CreateProductVariantDto>({ name: 'Large' }),
          productId,
          restaurantId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('requires a provided variant group to belong to the tenant', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: productId });
      prisma.variantGroup.findFirst.mockResolvedValue(null);

      await expect(
        service.create(
          asDto<CreateProductVariantDto>({ name: 'Large', variantGroupId: 'vg-9' }),
          productId,
          restaurantId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a duplicate name inside the same group', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: productId });
      prisma.productVariant.findFirst.mockResolvedValue(variant);

      await expect(
        service.create(
          asDto<CreateProductVariantDto>({ name: 'Large' }),
          productId,
          restaurantId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.productVariant.findFirst.mock.calls[0][0].where).toMatchObject({
        productId,
        name: 'Large',
        variantGroupId: null,
      });
    });

    it('applies defaults and emits on success', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: productId });
      prisma.productVariant.findFirst.mockResolvedValue(null);
      prisma.productVariant.create.mockResolvedValue({ ...variant, id: 'v-9' });

      await service.create(
        asDto<CreateProductVariantDto>({ name: 'Small', price: 8 }),
        productId,
        restaurantId,
        testTenantId,
        userId,
      );

      expect(prisma.productVariant.create.mock.calls[0][0].data.sortOrder).toBe(0);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PRODUCT_VARIANT_CREATED', resourceId: 'v-9' }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        'productVariant.created',
        expect.objectContaining({ variantId: 'v-9' }),
      );
    });
  });

  describe('findAll', () => {
    it('scopes by tenant and product with filters and pagination', async () => {
      prisma.productVariant.findMany.mockResolvedValue([variant]);
      prisma.productVariant.count.mockResolvedValue(1);

      const result = await service.findAll({
        tenantId: testTenantId,
        productId,
        restaurantId,
        page: 2,
        limit: 5,
        search: 'la',
        isActive: true,
        variantGroupId: 'vg-1',
      });

      const where = prisma.productVariant.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({
        tenantId: testTenantId,
        productId,
        deletedAt: null,
        isActive: true,
        variantGroupId: 'vg-1',
      });
      expect(prisma.productVariant.findMany.mock.calls[0][0].skip).toBe(5);
      expect(result.meta).toEqual({ total: 1, page: 2, limit: 5, totalPages: 1 });
    });
  });

  describe('findOne', () => {
    it('throws when not found for the tenant', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(null);

      await expect(service.findOne('v-1', testTenantId)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('rejects a name already used in the same group', async () => {
      prisma.productVariant.findFirst
        .mockResolvedValueOnce(variant) // findOne
        .mockResolvedValueOnce({ id: 'v-2' }); // clash

      await expect(
        service.update(
          'v-1',
          asDto<UpdateProductVariantDto>({ name: 'Medium' }),
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('scopes the variant group lookup by tenant when re-parenting', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(variant);
      prisma.variantGroup.findFirst.mockResolvedValue(null);

      await expect(
        service.update(
          'v-1',
          asDto<UpdateProductVariantDto>({ variantGroupId: 'vg-2' }),
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.variantGroup.findFirst.mock.calls[0][0].where).toMatchObject({
        id: 'vg-2',
        tenantId: testTenantId,
      });
      expect(prisma.productVariant.update).not.toHaveBeenCalled();
    });

    it('only writes provided fields and emits updated', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(variant);
      prisma.productVariant.update.mockResolvedValue(variant);

      await service.update(
        'v-1',
        asDto<UpdateProductVariantDto>({ price: 15 }),
        testTenantId,
        userId,
      );

      expect(prisma.productVariant.update.mock.calls[0][0].data).toEqual({ price: 15 });
      expect(events.emit).toHaveBeenCalledWith(
        'productVariant.updated',
        expect.objectContaining({ variantId: 'v-1' }),
      );
    });
  });

  describe('softDelete / restore', () => {
    it('soft-deletes and emits', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(variant);
      prisma.productVariant.update.mockResolvedValue({});

      await service.softDelete('v-1', testTenantId, userId);

      const data = prisma.productVariant.update.mock.calls[0][0].data;
      expect(data.deletedAt).toBeInstanceOf(Date);
      expect(data.isActive).toBe(false);
      expect(events.emit).toHaveBeenCalledWith(
        'productVariant.deleted',
        expect.objectContaining({ variantId: 'v-1' }),
      );
    });

    it('restores a deleted variant', async () => {
      prisma.productVariant.findFirst.mockResolvedValue({ ...variant, deletedAt: new Date() });
      prisma.productVariant.update.mockResolvedValue(variant);

      await service.restore('v-1', testTenantId, userId);

      expect(prisma.productVariant.update.mock.calls[0][0].data).toEqual({
        deletedAt: null,
        isActive: true,
      });
    });

    it('throws when restoring a variant that is not deleted', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(null);

      await expect(service.restore('v-1', testTenantId, userId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
