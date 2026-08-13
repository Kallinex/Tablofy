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

describe('RecipesService.updateRecipe (P0-H atomic recipe edit)', () => {
  let service: RecipesService;
  let prisma: MockPrisma;
  let auditLogs: MockAuditLogs;
  let cache: MockCache;
  let eventEmitter: MockEventEmitter;

  const existingRecipe = {
    id: 'recipe-1',
    tenantId: testTenantId,
    name: 'Old Recipe',
    productId: 'prod-1',
    version: 3,
    cost: 0,
    foodCostPercentage: 0,
    deletedAt: null,
  };

  const fullRecipe = {
    ...existingRecipe,
    name: 'New Recipe',
    version: 4,
    items: [
      {
        id: 'ri-1',
        recipeId: 'recipe-1',
        inventoryItemId: 'inv-1',
        quantity: 2,
        unit: 'kg',
        wastePercentage: 10,
        notes: null,
        sortOrder: 0,
      },
    ],
  };

  type TxShape = ReturnType<typeof makeTx>;

  function makeTx(
    overrides: {
      recipeUpdate?: jest.Mock;
      deleteMany?: jest.Mock;
      createMany?: jest.Mock;
    } = {},
  ) {
    return {
      recipe: { update: overrides.recipeUpdate ?? jest.fn().mockResolvedValue(fullRecipe) },
      recipeItem: {
        deleteMany: overrides.deleteMany ?? jest.fn().mockResolvedValue({ count: 1 }),
        createMany: overrides.createMany ?? jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
  }

  function installTx(tx: TxShape) {
    prisma.$transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx));
  }

  const gatewayMock = { broadcastRecipeUpdate: jest.fn() };

  beforeEach(async () => {
    prisma = createMockPrisma();
    auditLogs = createMockAuditLogs();
    cache = createMockCache();
    eventEmitter = createMockEventEmitter();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecipesService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogsService, useValue: auditLogs },
        { provide: CacheService, useValue: cache },
        { provide: QueueService, useValue: createMockQueue() },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: RecipesGateway, useValue: gatewayMock },
      ],
    }).compile();

    service = module.get<RecipesService>(RecipesService);
    jest.clearAllMocks();

    prisma.recipe.findFirst.mockImplementation(
      (args: { where?: Record<string, unknown>; include?: unknown }) =>
        Promise.resolve(args?.where?.name ? null : args?.include ? fullRecipe : existingRecipe),
    );
    prisma.recipeItem.findMany.mockResolvedValue([
      { quantity: 2, wastePercentage: 10, inventoryItem: { averageCost: 5, unitCost: 4 } },
    ]);
    prisma.recipe.findUnique.mockResolvedValue({ product: { basePrice: 100 } });
    prisma.recipe.update.mockResolvedValue(fullRecipe);
    installTx(makeTx());
  });

  it('should commit the header update and the item replacement atomically inside one transaction', async () => {
    const dto = {
      name: 'New Recipe',
      items: [
        {
          inventoryItemId: 'inv-1',
          quantity: 2,
          unit: 'kg',
          wastePercentage: 10,
          sortOrder: 0,
        },
      ],
    };

    const tx = makeTx();
    installTx(tx);

    await service.updateRecipe('recipe-1', dto, testTenantId, testUserId);

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function));
    expect(tx.recipe.update).toHaveBeenCalledWith({
      where: { id: 'recipe-1' },
      data: expect.objectContaining({
        name: 'New Recipe',
        version: { increment: 1 },
      }),
    });
    expect(tx.recipeItem.deleteMany).toHaveBeenCalledWith({ where: { recipeId: 'recipe-1' } });
    expect(tx.recipeItem.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          recipeId: 'recipe-1',
          inventoryItemId: 'inv-1',
          tenantId: testTenantId,
          quantity: 2,
          sortOrder: 0,
        }),
      ]),
    });
    expect(prisma.recipeItem.deleteMany).not.toHaveBeenCalled();
    expect(prisma.recipeItem.createMany).not.toHaveBeenCalled();
  });

  it('should roll back and stop when the item write fails inside the transaction', async () => {
    const dto = {
      name: 'New Recipe',
      items: [
        { inventoryItemId: 'inv-1', quantity: 2, unit: 'kg', wastePercentage: 0, sortOrder: 0 },
      ],
    };

    const tx = makeTx({
      createMany: jest.fn().mockRejectedValue(new Error('item write boom')),
    });
    installTx(tx);

    await expect(service.updateRecipe('recipe-1', dto, testTenantId, testUserId)).rejects.toThrow(
      'item write boom',
    );

    expect(tx.recipe.update).toHaveBeenCalled();
    expect(prisma.recipeItem.findMany).not.toHaveBeenCalled();
    expect(prisma.recipe.findUnique).not.toHaveBeenCalled();
    expect(auditLogs.log).not.toHaveBeenCalled();
    expect(cache.delete).not.toHaveBeenCalled();
  });

  it('should skip item replacement when no items are provided', async () => {
    const dto = { name: 'Renamed Only' };

    const tx = makeTx();
    installTx(tx);

    await service.updateRecipe('recipe-1', dto, testTenantId, testUserId);

    expect(tx.recipe.update).toHaveBeenCalledWith({
      where: { id: 'recipe-1' },
      data: expect.objectContaining({ name: 'Renamed Only' }),
    });
    expect(tx.recipeItem.deleteMany).not.toHaveBeenCalled();
    expect(tx.recipeItem.createMany).not.toHaveBeenCalled();
  });

  it('should recalculate cost from the committed items after the transaction', async () => {
    const dto = {
      name: 'New Recipe',
      items: [{ inventoryItemId: 'inv-1', quantity: 2, unit: 'kg', wastePercentage: 10 }],
    };

    await service.updateRecipe('recipe-1', dto, testTenantId, testUserId);

    expect(prisma.recipeItem.findMany).toHaveBeenCalled();
    expect(prisma.recipe.findUnique).toHaveBeenCalled();
    expect(prisma.recipe.update).toHaveBeenCalledWith({
      where: { id: 'recipe-1' },
      data: expect.objectContaining({ cost: expect.any(Number) }),
    });
  });

  it('should reject an update for a recipe outside the tenant', async () => {
    prisma.recipe.findFirst.mockResolvedValue(null);

    await expect(
      service.updateRecipe('recipe-1', { name: 'X' }, 'other-tenant', testUserId),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('should reject a duplicate recipe name', async () => {
    prisma.recipe.findFirst.mockImplementation((args: { where?: Record<string, unknown> }) =>
      Promise.resolve(args?.where?.name ? { ...existingRecipe, id: 'recipe-2' } : existingRecipe),
    );

    await expect(
      service.updateRecipe('recipe-1', { name: 'Taken' }, testTenantId, testUserId),
    ).rejects.toThrow(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
