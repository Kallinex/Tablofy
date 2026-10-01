import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { ProductIngredientsService } from '../product-ingredients.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';
import {
  CreateProductIngredientDto,
  UpdateProductIngredientDto,
} from '../dto/product-ingredient.dto';

const userId = 'user-1';
const restaurantId = 'r-1';
const productId = 'p-1';
const ingredientId = 'i-1';
const asDto = <T>(value: Record<string, unknown>) => value as unknown as T;

describe('ProductIngredientsService', () => {
  let service: ProductIngredientsService;
  let prisma: MockPrisma;
  let audit: MockAuditLogs;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductIngredientsService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
      ],
    }).compile();

    service = module.get<ProductIngredientsService>(ProductIngredientsService);
    prisma = module.get(PrismaService) as MockPrisma;
    audit = module.get(AuditLogsService) as MockAuditLogs;
  });

  beforeEach(() => {
    prisma.reset();
    audit.reset();
  });

  const link = {
    id: 'pi-1',
    tenantId: testTenantId,
    productId,
    ingredientId,
    supplierId: null,
    quantity: 2,
  };

  describe('create', () => {
    it('requires the product in the tenant and restaurant', async () => {
      prisma.product.findFirst.mockResolvedValue(null);
      await expect(
        service.create(
          asDto<CreateProductIngredientDto>({ productId, ingredientId, quantity: 2 }),
          restaurantId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.product.findFirst.mock.calls[0][0].where).toMatchObject({
        id: productId,
        restaurantId,
        tenantId: testTenantId,
      });
    });

    it('requires the ingredient in the tenant', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: productId });
      prisma.ingredient.findFirst.mockResolvedValue(null);
      await expect(
        service.create(
          asDto<CreateProductIngredientDto>({ productId, ingredientId, quantity: 2 }),
          restaurantId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('validates the supplier when provided', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: productId });
      prisma.ingredient.findFirst.mockResolvedValue({ id: ingredientId });
      prisma.supplier.findFirst.mockResolvedValue(null);
      await expect(
        service.create(
          asDto<CreateProductIngredientDto>({
            productId,
            ingredientId,
            quantity: 2,
            supplierId: 's-1',
          }),
          restaurantId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a duplicate link', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: productId });
      prisma.ingredient.findFirst.mockResolvedValue({ id: ingredientId });
      prisma.productIngredient.findUnique.mockResolvedValue(link);

      await expect(
        service.create(
          asDto<CreateProductIngredientDto>({ productId, ingredientId, quantity: 2 }),
          restaurantId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.productIngredient.findUnique.mock.calls[0][0].where).toEqual({
        productId_ingredientId: { productId, ingredientId },
      });
    });

    it('creates and logs', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: productId });
      prisma.ingredient.findFirst.mockResolvedValue({ id: ingredientId });
      prisma.productIngredient.findUnique.mockResolvedValue(null);
      prisma.productIngredient.create.mockResolvedValue(link);

      await service.create(
        asDto<CreateProductIngredientDto>({ productId, ingredientId, quantity: 2 }),
        restaurantId,
        testTenantId,
        userId,
      );

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PRODUCT_INGREDIENT_CREATED' }),
      );
    });
  });

  describe('findByProduct', () => {
    it('scopes by tenant and product', async () => {
      prisma.productIngredient.findMany.mockResolvedValue([link]);

      const result = await service.findByProduct(productId, testTenantId);

      expect(prisma.productIngredient.findMany.mock.calls[0][0].where).toEqual({
        productId,
        tenantId: testTenantId,
      });
      expect(result).toEqual([link]);
    });
  });

  describe('findOne', () => {
    it('throws when not found', async () => {
      prisma.productIngredient.findFirst.mockResolvedValue(null);
      await expect(service.findOne('pi-1', testTenantId)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('validates a newly assigned supplier', async () => {
      prisma.productIngredient.findFirst.mockResolvedValue(link);
      prisma.supplier.findFirst.mockResolvedValue(null);

      await expect(
        service.update(
          'pi-1',
          asDto<UpdateProductIngredientDto>({ supplierId: 's-9' }),
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.productIngredient.update).not.toHaveBeenCalled();
    });

    it('updates quantity and logs old/new values', async () => {
      prisma.productIngredient.findFirst.mockResolvedValue(link);
      prisma.productIngredient.update.mockResolvedValue({ ...link, quantity: 5 });

      await service.update(
        'pi-1',
        asDto<UpdateProductIngredientDto>({ quantity: 5 }),
        testTenantId,
        userId,
      );

      expect(prisma.productIngredient.update.mock.calls[0][0].data).toEqual({ quantity: 5 });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PRODUCT_INGREDIENT_UPDATED',
          oldValues: { quantity: 2 },
          newValues: { quantity: 5 },
        }),
      );
    });
  });

  describe('remove', () => {
    it('deletes and logs the link', async () => {
      prisma.productIngredient.findFirst.mockResolvedValue(link);
      prisma.productIngredient.delete.mockResolvedValue(link);

      await service.remove('pi-1', testTenantId, userId);

      expect(prisma.productIngredient.delete).toHaveBeenCalledWith({ where: { id: 'pi-1' } });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PRODUCT_INGREDIENT_DELETED' }),
      );
    });
  });

  describe('getProductCost', () => {
    it('sums cost per unit across ingredients', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: productId });
      prisma.productIngredient.findMany.mockResolvedValue([
        { ...link, ingredient: { name: 'Flour', costPerUnit: '2.5' } },
        { ...link, id: 'pi-2', ingredient: { name: 'Sugar', costPerUnit: 1 } },
      ]);

      const result = await service.getProductCost(productId, testTenantId);

      expect(result.totalCostPerUnit).toBeCloseTo(7, 5);
      expect(result.ingredients).toHaveLength(2);
      expect(result.ingredients[0]).toEqual({
        name: 'Flour',
        quantity: 2,
        costPerUnit: 2.5,
        totalCost: 5,
      });
    });

    it('treats a missing ingredient cost as zero', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: productId });
      prisma.productIngredient.findMany.mockResolvedValue([
        { ...link, ingredient: { name: 'Salt', costPerUnit: null } },
      ]);

      const result = await service.getProductCost(productId, testTenantId);

      expect(result.totalCostPerUnit).toBe(0);
    });

    it('throws when the product is missing', async () => {
      prisma.product.findFirst.mockResolvedValue(null);
      await expect(service.getProductCost(productId, testTenantId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
