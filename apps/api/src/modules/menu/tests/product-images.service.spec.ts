import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotFoundException } from '@nestjs/common';
import { ProductImagesService } from '../product-images.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockEventEmitter, MockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';
import { CreateProductImageDto } from '../dto/create-product-image.dto';
import { UpdateProductImageDto } from '../dto/update-product-image.dto';

const userId = 'user-1';
const productId = 'prod-1';
const imageId = 'img-1';
const asDto = <T>(value: Record<string, unknown>) => value as unknown as T;

describe('ProductImagesService', () => {
  let service: ProductImagesService;
  let prisma: MockPrisma;
  let events: MockEventEmitter;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductImagesService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
      ],
    }).compile();

    service = module.get<ProductImagesService>(ProductImagesService);
    prisma = module.get(PrismaService) as MockPrisma;
    events = module.get(EventEmitter2) as unknown as MockEventEmitter;
  });

  beforeEach(() => {
    prisma.reset();
    events.reset();
  });

  const image = {
    id: imageId,
    productId,
    tenantId: testTenantId,
    url: 'https://cdn.example.com/a.png',
    isPrimary: false,
    sortOrder: 0,
  };

  describe('create', () => {
    it('throws when the product is missing', async () => {
      prisma.product.findFirst.mockResolvedValue(null);
      await expect(
        service.create(
          asDto<CreateProductImageDto>({ url: 'https://cdn.example.com/a.png' }),
          productId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('demotes the previous primary image when marking a new primary', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: productId });
      prisma.productImage.create.mockResolvedValue({ ...image, isPrimary: true });

      await service.create(
        asDto<CreateProductImageDto>({ url: 'https://cdn.example.com/a.png', isPrimary: true }),
        productId,
        testTenantId,
        userId,
      );

      expect(prisma.productImage.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { productId, tenantId: testTenantId, isPrimary: true },
          data: { isPrimary: false },
        }),
      );
      expect(events.emit).toHaveBeenCalledWith('productImage.created', expect.anything());
    });

    it('does not reset primaries for a non-primary image', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: productId });
      prisma.productImage.create.mockResolvedValue(image);

      await service.create(
        asDto<CreateProductImageDto>({ url: 'https://cdn.example.com/a.png' }),
        productId,
        testTenantId,
        userId,
      );

      expect(prisma.productImage.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('throws when the product is missing', async () => {
      prisma.product.findFirst.mockResolvedValue(null);
      await expect(service.findAll(productId, testTenantId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns scoped images', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: productId });
      prisma.productImage.findMany.mockResolvedValue([image]);

      const result = await service.findAll(productId, testTenantId);

      expect(prisma.productImage.findMany.mock.calls[0][0].where).toEqual({
        productId,
        tenantId: testTenantId,
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('findOne', () => {
    it('throws when missing', async () => {
      prisma.productImage.findFirst.mockResolvedValue(null);
      await expect(service.findOne(imageId, testTenantId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('promotes to primary and demotes siblings', async () => {
      prisma.productImage.findFirst.mockResolvedValue(image);
      prisma.productImage.update.mockResolvedValue({ ...image, isPrimary: true });

      await service.update(
        imageId,
        asDto<UpdateProductImageDto>({ isPrimary: true }),
        testTenantId,
        userId,
      );

      expect(prisma.productImage.updateMany).toHaveBeenCalled();
      expect(events.emit).toHaveBeenCalledWith('productImage.updated', expect.anything());
    });

    it('does not touch siblings when already primary', async () => {
      prisma.productImage.findFirst.mockResolvedValue({ ...image, isPrimary: true });
      prisma.productImage.update.mockResolvedValue(image);

      await service.update(
        imageId,
        asDto<UpdateProductImageDto>({ altText: 'hi' }),
        testTenantId,
        userId,
      );

      expect(prisma.productImage.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('throws when missing', async () => {
      prisma.productImage.findFirst.mockResolvedValue(null);
      await expect(service.remove(imageId, testTenantId, userId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('deletes and emits', async () => {
      prisma.productImage.findFirst.mockResolvedValue(image);

      await service.remove(imageId, testTenantId, userId);

      expect(prisma.productImage.delete).toHaveBeenCalledWith({ where: { id: imageId } });
      expect(events.emit).toHaveBeenCalledWith('productImage.deleted', expect.anything());
    });
  });
});
