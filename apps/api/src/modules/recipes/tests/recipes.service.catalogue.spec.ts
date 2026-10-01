import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RecipesService } from '../recipes.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { QueueService } from '../../queues/queue.service';
import { RecipesGateway } from '../recipes.gateway';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockCache, MockCache } from '../../../test/mocks/cache.mock';
import { createMockQueue } from '../../../test/mocks/queue.mock';
import { createMockEventEmitter, MockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId, testUserId } from '../../../test/fixtures/auth.fixture';

describe('RecipesService catalogue and cost reporting', () => {
  let service: RecipesService;
  let prisma: MockPrisma;
  let auditLogs: MockAuditLogs;
  let cache: MockCache;
  let eventEmitter: MockEventEmitter;

  const gateway = { broadcastRecipeUpdate: jest.fn() };

  const recipeRow = {
    id: 'recipe-1',
    tenantId: testTenantId,
    name: 'Tomato Soup',
    cost: 4,
    foodCostPercentage: 20,
    deletedAt: null,
    version: 1,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecipesService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: CacheService, useValue: createMockCache() },
        { provide: QueueService, useValue: createMockQueue() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
        { provide: RecipesGateway, useValue: gateway },
      ],
    }).compile();

    service = module.get<RecipesService>(RecipesService);
    prisma = module.get(PrismaService) as MockPrisma;
    auditLogs = module.get(AuditLogsService) as MockAuditLogs;
    cache = module.get(CacheService) as MockCache;
    eventEmitter = module.get(EventEmitter2) as MockEventEmitter;

    prisma.reset();
    auditLogs.reset();
    cache.reset();
    eventEmitter.reset();
    jest.clearAllMocks();
    prisma.recipeItem.findMany.mockResolvedValue([]);
    prisma.recipe.findUnique.mockResolvedValue({ ...recipeRow, product: { basePrice: null } });
  });

  describe('createRecipe', () => {
    it('creates a recipe with its lines and recalculates the cost', async () => {
      prisma.recipe.findFirst.mockResolvedValue(null);
      prisma.recipe.create.mockResolvedValue(recipeRow);
      prisma.recipeItem.createMany.mockResolvedValue({ count: 2 });
      prisma.recipe.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
        ...recipeRow,
        items: [],
      });

      const result = await service.createRecipe(
        {
          name: 'Tomato Soup',
          description: 'Warm soup',
          items: [
            { inventoryItemId: 'inv-1', quantity: 2, unit: 'kg' },
            { inventoryItemId: 'inv-2', quantity: 1, unit: 'kg', sortOrder: 5 },
          ],
        } as never,
        testTenantId,
        testUserId,
      );

      expect(result.id).toBe('recipe-1');
      const [createArgs] = prisma.recipeItem.createMany.mock.calls[0];
      expect(createArgs.data).toEqual([
        expect.objectContaining({ inventoryItemId: 'inv-1', sortOrder: 0 }),
        expect.objectContaining({ inventoryItemId: 'inv-2', sortOrder: 5 }),
      ]);
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'RECIPE_CREATED' }),
      );
      expect(cache.delete).toHaveBeenCalledWith(testTenantId, 'recipes:list');
      expect(gateway.broadcastRecipeUpdate).toHaveBeenCalledWith(
        testTenantId,
        'recipe.created',
        expect.anything(),
      );
    });

    it('defaults the recipe to active', async () => {
      prisma.recipe.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...recipeRow, items: [] });
      prisma.recipe.create.mockResolvedValue(recipeRow);

      await service.createRecipe({ name: 'Tomato Soup' } as never, testTenantId, testUserId);

      const [args] = prisma.recipe.create.mock.calls[0];
      expect(args.data.isActive).toBe(true);
      expect(prisma.recipeItem.createMany).not.toHaveBeenCalled();
    });

    it('rejects a duplicate recipe name in the tenant', async () => {
      prisma.recipe.findFirst.mockResolvedValue({ id: 'recipe-0' });

      await expect(
        service.createRecipe({ name: 'Tomato Soup' } as never, testTenantId, testUserId),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('getRecipe', () => {
    it('returns the cached recipe', async () => {
      cache.get.mockResolvedValue({ id: 'recipe-1', items: [] });

      await expect(service.getRecipe('recipe-1', testTenantId)).resolves.toEqual({
        id: 'recipe-1',
        items: [],
      });
      expect(prisma.recipe.findFirst).not.toHaveBeenCalled();
    });

    it('enriches the recipe with total cost, food cost percentage and item count', async () => {
      cache.get.mockResolvedValue(null);
      prisma.recipe.findFirst.mockResolvedValue({
        ...recipeRow,
        cost: 4.5,
        foodCostPercentage: 22.5,
        items: [{ id: 'ri-1' }, { id: 'ri-2' }],
      });

      const result = await service.getRecipe('recipe-1', testTenantId);

      expect(result).toEqual(
        expect.objectContaining({ totalCost: 4.5, foodCostPct: 22.5, itemCount: 2 }),
      );
      expect(cache.set).toHaveBeenCalledWith(testTenantId, 'recipe:recipe-1', result, 300);
    });

    it('rejects reading a recipe from another tenant', async () => {
      cache.get.mockResolvedValue(null);
      prisma.recipe.findFirst.mockResolvedValue(null);

      await expect(service.getRecipe('recipe-1', testTenantId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('listRecipes', () => {
    it('returns the cached recipe list', async () => {
      cache.get.mockResolvedValue({ data: [], meta: { total: 0 } });

      await expect(service.listRecipes(testTenantId, {})).resolves.toEqual({
        data: [],
        meta: { total: 0 },
      });
      expect(prisma.recipe.findMany).not.toHaveBeenCalled();
    });

    it('lists newest first by default and caches the envelope', async () => {
      cache.get.mockResolvedValue(null);
      prisma.recipe.count.mockResolvedValue(2);

      const result = await service.listRecipes(testTenantId, {});

      const [args] = prisma.recipe.findMany.mock.calls[0];
      expect(args.orderBy).toEqual({ createdAt: 'desc' });
      expect(args.include._count).toEqual({ select: { items: true } });
      expect(result.meta).toEqual({
        total: 2,
        page: 1,
        limit: 20,
        totalPages: 1,
        hasNext: false,
        hasPrevious: false,
      });
      expect(cache.set).toHaveBeenCalledWith(testTenantId, 'recipes:list:{}', result, 120);
    });

    it('filters by product and active flag', async () => {
      await service.listRecipes(testTenantId, {
        productId: 'prod-1',
        isActive: false,
        page: 2,
        limit: 5,
      });

      const [args] = prisma.recipe.findMany.mock.calls[0];
      expect(args.where.productId).toBe('prod-1');
      expect(args.where.isActive).toBe(false);
      expect(args.skip).toBe(5);
      expect(args.take).toBe(5);
    });

    it('searches name and description', async () => {
      await service.listRecipes(testTenantId, { search: 'soup' });

      const [args] = prisma.recipe.findMany.mock.calls[0];
      expect(args.where.OR).toEqual([
        { name: { contains: 'soup', mode: 'insensitive' } },
        { description: { contains: 'soup', mode: 'insensitive' } },
      ]);
    });

    it.each([
      ['name', { name: 'asc' }],
      ['cost', { cost: 'desc' }],
      ['createdAt', { createdAt: 'desc' }],
    ])('sorts by %s', async (sortBy, expected) => {
      await service.listRecipes(testTenantId, { sortBy: sortBy as never });

      const [args] = prisma.recipe.findMany.mock.calls[0];
      expect(args.orderBy).toEqual(expected);
    });

    it('honours an explicit sort order', async () => {
      await service.listRecipes(testTenantId, {
        sortBy: 'name' as never,
        sortOrder: 'desc' as never,
      });

      const [args] = prisma.recipe.findMany.mock.calls[0];
      expect(args.orderBy).toEqual({ name: 'desc' });
    });
  });

  describe('deleteRecipe', () => {
    it('deactivates and soft deletes the recipe', async () => {
      prisma.recipe.findFirst.mockResolvedValue(recipeRow);

      await service.deleteRecipe('recipe-1', testTenantId, testUserId);

      expect(prisma.recipe.update).toHaveBeenCalledWith({
        where: { id: 'recipe-1' },
        data: { deletedAt: expect.any(Date), isActive: false },
      });
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'RECIPE_DELETED' }),
      );
      expect(cache.delete).toHaveBeenCalledWith(testTenantId, 'recipe:recipe-1');
      expect(gateway.broadcastRecipeUpdate).toHaveBeenCalledWith(testTenantId, 'recipe.deleted', {
        id: 'recipe-1',
      });
    });

    it('rejects deleting a recipe from another tenant', async () => {
      prisma.recipe.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteRecipe('recipe-1', testTenantId, testUserId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getRecipeCost', () => {
    it('reports a zero cost for a recipe with no items', async () => {
      cache.get.mockResolvedValue({ ...recipeRow, items: [] });

      const result = await service.getRecipeCost('recipe-1', testTenantId);

      expect(result).toEqual({
        recipeId: 'recipe-1',
        recipeName: 'Tomato Soup',
        totalCost: 0,
        foodCostPercentage: 0,
        sellingPrice: null,
        items: [],
      });
    });

    it('applies waste percentage and prefers average cost', async () => {
      cache.get.mockResolvedValue({
        ...recipeRow,
        product: { basePrice: 20 },
        items: [
          {
            inventoryItemId: 'inv-1',
            quantity: 2,
            wastePercentage: 10,
            inventoryItem: { id: 'inv-1', name: 'Tomato', averageCost: 3, unitCost: 9 },
          },
        ],
      });

      const result = await service.getRecipeCost('recipe-1', testTenantId);

      expect(result.items[0]).toMatchObject({
        inventoryItemId: 'inv-1',
        inventoryItemName: 'Tomato',
        quantity: 2,
        wastePercentage: 10,
        effectiveQuantity: 2.2,
        unitCost: 3,
      });
      expect(result.items[0].itemCost).toBeCloseTo(6.6, 10);
      expect(result.totalCost).toBeCloseTo(6.6, 10);
      expect(result.foodCostPercentage).toBe(33);
      expect(result.sellingPrice).toBe(20);
    });

    it('falls back to unit cost and names unknown inventory items', async () => {
      cache.get.mockResolvedValue({
        ...recipeRow,
        items: [
          { inventoryItemId: 'inv-1', quantity: 1, wastePercentage: null, inventoryItem: null },
          {
            inventoryItemId: 'inv-2',
            quantity: 1,
            inventoryItem: { id: 'inv-2', name: 'Salt', unitCost: 2 },
          },
        ],
      });

      const result = await service.getRecipeCost('recipe-1', testTenantId);

      expect(result.items[0]).toEqual(
        expect.objectContaining({ inventoryItemName: 'Unknown', unitCost: 0, itemCost: 0 }),
      );
      expect(result.items[1].unitCost).toBe(2);
      expect(result.totalCost).toBe(2);
      expect(result.foodCostPercentage).toBe(0);
    });

    it('does not divide by a zero selling price', async () => {
      cache.get.mockResolvedValue({
        ...recipeRow,
        product: { basePrice: 0 },
        items: [
          {
            inventoryItemId: 'inv-1',
            quantity: 1,
            inventoryItem: { id: 'inv-1', name: 'Salt', unitCost: 2 },
          },
        ],
      });

      const result = await service.getRecipeCost('recipe-1', testTenantId);

      expect(result.sellingPrice).toBeNull();
      expect(result.foodCostPercentage).toBe(0);
    });
  });

  describe('addRecipeItem', () => {
    it('adds a line and recalculates the recipe cost', async () => {
      prisma.recipe.findFirst.mockResolvedValue(recipeRow);
      prisma.inventoryItem.findFirst.mockResolvedValue({ id: 'inv-1' });
      prisma.recipeItem.create.mockResolvedValue({ id: 'ri-9' });

      const result = await service.addRecipeItem(
        'recipe-1',
        { inventoryItemId: 'inv-1', quantity: 3, unit: 'kg' } as never,
        testTenantId,
        testUserId,
      );

      expect(result.id).toBe('ri-9');
      const [args] = prisma.recipeItem.create.mock.calls[0];
      expect(args.data.sortOrder).toBe(0);
      expect(prisma.recipe.update).toHaveBeenCalledWith({
        where: { id: 'recipe-1' },
        data: expect.objectContaining({ cost: 0, foodCostPercentage: 0 }),
      });
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'RECIPE_ITEM_ADDED' }),
      );
      expect(gateway.broadcastRecipeUpdate).toHaveBeenCalledWith(testTenantId, 'recipe.updated', {
        recipeId: 'recipe-1',
        action: 'item-added',
      });
    });

    it('honours an explicit sort order', async () => {
      prisma.recipe.findFirst.mockResolvedValue(recipeRow);
      prisma.inventoryItem.findFirst.mockResolvedValue({ id: 'inv-1' });
      prisma.recipeItem.create.mockResolvedValue({ id: 'ri-9' });

      await service.addRecipeItem(
        'recipe-1',
        { inventoryItemId: 'inv-1', quantity: 1, sortOrder: 4 } as never,
        testTenantId,
        testUserId,
      );

      const [args] = prisma.recipeItem.create.mock.calls[0];
      expect(args.data.sortOrder).toBe(4);
    });

    it('rejects adding a line to a recipe from another tenant', async () => {
      prisma.recipe.findFirst.mockResolvedValue(null);

      await expect(
        service.addRecipeItem(
          'recipe-1',
          { inventoryItemId: 'inv-1', quantity: 1 } as never,
          testTenantId,
          testUserId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects adding an inventory item from another tenant', async () => {
      prisma.recipe.findFirst.mockResolvedValue(recipeRow);
      prisma.inventoryItem.findFirst.mockResolvedValue(null);

      await expect(
        service.addRecipeItem(
          'recipe-1',
          { inventoryItemId: 'inv-1', quantity: 1 } as never,
          testTenantId,
          testUserId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateRecipeItem', () => {
    it('updates the line and recalculates the cost', async () => {
      prisma.recipeItem.findFirst.mockResolvedValue({
        id: 'ri-1',
        recipeId: 'recipe-1',
        quantity: 2,
      });
      prisma.recipeItem.update.mockResolvedValue({ id: 'ri-1', quantity: 5 });

      const result = await service.updateRecipeItem(
        'ri-1',
        { quantity: 5 } as never,
        testTenantId,
        testUserId,
      );

      expect(result.quantity).toBe(5);
      expect(prisma.recipe.update).toHaveBeenCalled();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'RECIPE_ITEM_UPDATED',
          oldValues: { quantity: 2 },
        }),
      );
      expect(gateway.broadcastRecipeUpdate).toHaveBeenCalledWith(testTenantId, 'recipe.updated', {
        recipeId: 'recipe-1',
        action: 'item-updated',
      });
    });

    it('rejects updating a recipe item from another tenant', async () => {
      prisma.recipeItem.findFirst.mockResolvedValue(null);

      await expect(
        service.updateRecipeItem('ri-1', { quantity: 1 } as never, testTenantId, testUserId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('removeRecipeItem', () => {
    it('deletes the line and recalculates the cost', async () => {
      prisma.recipeItem.findFirst.mockResolvedValue({
        id: 'ri-1',
        recipeId: 'recipe-1',
        inventoryItemId: 'inv-1',
        quantity: 2,
      });

      await service.removeRecipeItem('ri-1', testTenantId, testUserId);

      expect(prisma.recipeItem.delete).toHaveBeenCalledWith({ where: { id: 'ri-1' } });
      expect(prisma.recipe.update).toHaveBeenCalled();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'RECIPE_ITEM_REMOVED',
          oldValues: { inventoryItemId: 'inv-1', quantity: 2 },
        }),
      );
      expect(gateway.broadcastRecipeUpdate).toHaveBeenCalledWith(testTenantId, 'recipe.updated', {
        recipeId: 'recipe-1',
        action: 'item-removed',
      });
    });

    it('rejects removing a recipe item from another tenant', async () => {
      prisma.recipeItem.findFirst.mockResolvedValue(null);

      await expect(
        service.removeRecipeItem('ri-1', testTenantId, testUserId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getDeductionReport', () => {
    it('returns an empty report when the order has no consumption', async () => {
      prisma.stockMovement.findMany.mockResolvedValue([]);

      const report = await service.getDeductionReport('order-1', testTenantId);

      expect(report).toEqual({
        orderId: 'order-1',
        movements: [],
        totalMovements: 0,
        totalQuantity: 0,
        totalCost: 0,
      });
      const [args] = prisma.stockMovement.findMany.mock.calls[0];
      expect(args.where).toEqual({
        referenceType: 'ORDER',
        referenceId: 'order-1',
        tenantId: testTenantId,
        type: 'CONSUMPTION',
      });
    });

    it('enriches movements and totals their absolute quantity and cost', async () => {
      prisma.stockMovement.findMany.mockResolvedValue([
        {
          id: 'sm-1',
          inventoryItemId: 'inv-1',
          inventoryItem: { id: 'inv-1', name: 'Tomato' },
          quantity: -2,
          unitCost: 3,
          totalCost: 6,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        {
          id: 'sm-2',
          inventoryItemId: 'inv-2',
          inventoryItem: { id: 'inv-2', name: 'Salt' },
          quantity: -1,
          unitCost: null,
          totalCost: null,
          createdAt: new Date('2026-01-02T00:00:00.000Z'),
        },
      ]);

      const report = await service.getDeductionReport('order-1', testTenantId);

      expect(report.movements[0]).toEqual({
        id: 'sm-1',
        inventoryItemId: 'inv-1',
        inventoryItemName: 'Tomato',
        quantity: -2,
        unitCost: 3,
        totalCost: 6,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      expect(report.movements[1]).toEqual(
        expect.objectContaining({ unitCost: null, totalCost: null }),
      );
      expect(report.totalMovements).toBe(2);
      expect(report.totalQuantity).toBe(3);
      expect(report.totalCost).toBe(6);
    });
  });
});
