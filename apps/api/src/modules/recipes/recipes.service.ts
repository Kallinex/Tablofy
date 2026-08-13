import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CacheService } from '../../common/services/cache.service';
import { QueueService } from '../queues/queue.service';
import { RecipesGateway } from './recipes.gateway';
import { Prisma, StockMovementType } from '@prisma/client';
import { CreateRecipeDto } from './dto/create-recipe.dto';
import { UpdateRecipeDto } from './dto/update-recipe.dto';
import { QueryRecipeDto } from './dto/query-recipe.dto';
import { CreateRecipeItemDto } from './dto/create-recipe-item.dto';
import { UpdateRecipeItemDto } from './dto/update-recipe-item.dto';

interface DeductionReport {
  orderId: string;
  tenantId: string;
  items: Array<{
    inventoryItemId: string;
    inventoryItemName: string;
    quantityDeducted: number;
    unitCost: number;
    totalCost: number;
    wasPartial: boolean;
    shortfall: number;
  }>;
  totalDeducted: number;
  totalCost: number;
  timestamp: Date;
}

@Injectable()
export class RecipesService {
  private readonly logger = new Logger(RecipesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly cacheService: CacheService,
    private readonly queueService: QueueService,
    private readonly eventEmitter: EventEmitter2,
    private readonly gateway: RecipesGateway,
  ) {}

  async createRecipe(dto: CreateRecipeDto, tenantId: string, userId: string) {
    const existing = await this.prisma.recipe.findFirst({
      where: { tenantId, name: dto.name, deletedAt: null },
    });
    if (existing) {
      throw new ConflictException('Recipe with this name already exists');
    }

    const recipe = await this.prisma.recipe.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description,
        productId: dto.productId,
        yield: dto.yield,
        servingUnit: dto.servingUnit,
        preparationTime: dto.preparationTime,
        cookingTime: dto.cookingTime,
        instructions: dto.instructions,
        isActive: dto.isActive ?? true,
      },
    });

    if (dto.items && dto.items.length > 0) {
      await this.prisma.recipeItem.createMany({
        data: dto.items.map((item, index) => ({
          recipeId: recipe.id,
          inventoryItemId: item.inventoryItemId,
          tenantId,
          quantity: item.quantity,
          unit: item.unit,
          wastePercentage: item.wastePercentage,
          notes: item.notes,
          sortOrder: item.sortOrder ?? index,
        })),
      });
    }

    await this.recalculateRecipeCost(recipe.id, tenantId);

    const result = await this.getRecipe(recipe.id, tenantId);

    await this.auditLogsService.log({
      action: 'RECIPE_CREATED',
      resource: 'Recipe',
      resourceId: recipe.id,
      userId,
      tenantId,
      newValues: { name: dto.name, productId: dto.productId },
    });

    await this.cacheService.delete(tenantId, 'recipes:list');
    this.gateway.broadcastRecipeUpdate(tenantId, 'recipe.created', result);

    return result;
  }

  async getRecipe(id: string, tenantId: string) {
    const cacheKey = `recipe:${id}`;
    const cached = await this.cacheService.get<Record<string, unknown>>(tenantId, cacheKey);
    if (cached) return cached;

    const recipe = await this.prisma.recipe.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        product: { select: { id: true, name: true, basePrice: true, sku: true } },
        items: {
          include: {
            inventoryItem: {
              select: {
                id: true,
                name: true,
                sku: true,
                unitCost: true,
                averageCost: true,
                currentQuantity: true,
                unitId: true,
              },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!recipe) throw new NotFoundException('Recipe not found');

    const enriched = {
      ...recipe,
      totalCost: Number(recipe.cost ?? 0),
      foodCostPct: Number(recipe.foodCostPercentage ?? 0),
      itemCount: recipe.items.length,
    };

    await this.cacheService.set(tenantId, cacheKey, enriched, 300);
    return enriched;
  }

  async listRecipes(tenantId: string, query: QueryRecipeDto) {
    const cacheKey = `recipes:list:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.RecipeWhereInput = {
      tenantId,
      deletedAt: null,
    };

    if (query.productId) where.productId = query.productId;
    if (query.isActive !== undefined) where.isActive = query.isActive;

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const orderBy: Prisma.RecipeOrderByWithRelationInput = {};
    if (query.sortBy === 'name') orderBy.name = query.sortOrder ?? 'asc';
    else if (query.sortBy === 'cost') orderBy.cost = query.sortOrder ?? 'desc';
    else if (query.sortBy === 'createdAt') orderBy.createdAt = query.sortOrder ?? 'desc';
    else orderBy.createdAt = 'desc';

    const [data, total] = await Promise.all([
      this.prisma.recipe.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          product: { select: { id: true, name: true, basePrice: true } },
          _count: { select: { items: true } },
        },
      }),
      this.prisma.recipe.count({ where }),
    ]);

    const result = {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrevious: page > 1,
      },
    };

    await this.cacheService.set(tenantId, cacheKey, result, 120);
    return result;
  }

  async updateRecipe(id: string, dto: UpdateRecipeDto, tenantId: string, userId: string) {
    const recipe = await this.prisma.recipe.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!recipe) throw new NotFoundException('Recipe not found');

    if (dto.name && dto.name !== recipe.name) {
      const existing = await this.prisma.recipe.findFirst({
        where: { tenantId, name: dto.name, deletedAt: null, id: { not: id } },
      });
      if (existing) throw new ConflictException('Recipe with this name already exists');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.recipe.update({
        where: { id },
        data: {
          name: dto.name,
          description: dto.description,
          productId: dto.productId,
          yield: dto.yield,
          servingUnit: dto.servingUnit,
          preparationTime: dto.preparationTime,
          cookingTime: dto.cookingTime,
          instructions: dto.instructions,
          isActive: dto.isActive,
          version: { increment: 1 },
        },
      });

      if (dto.items && dto.items.length > 0) {
        await tx.recipeItem.deleteMany({ where: { recipeId: id } });
        await tx.recipeItem.createMany({
          data: dto.items.map((item, index) => ({
            recipeId: id,
            inventoryItemId: item.inventoryItemId,
            tenantId,
            quantity: item.quantity,
            unit: item.unit,
            wastePercentage: item.wastePercentage,
            notes: item.notes,
            sortOrder: item.sortOrder ?? index,
          })),
        });
      }
    });

    await this.recalculateRecipeCost(id, tenantId);

    const result = await this.getRecipe(id, tenantId);

    await this.auditLogsService.log({
      action: 'RECIPE_UPDATED',
      resource: 'Recipe',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { name: recipe.name, version: recipe.version },
      newValues: { name: dto.name ?? recipe.name, version: recipe.version + 1 },
    });

    await this.cacheService.delete(tenantId, `recipe:${id}`);
    await this.cacheService.delete(tenantId, 'recipes:list');
    this.gateway.broadcastRecipeUpdate(tenantId, 'recipe.updated', result);

    return result;
  }

  async deleteRecipe(id: string, tenantId: string, userId: string) {
    const recipe = await this.prisma.recipe.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!recipe) throw new NotFoundException('Recipe not found');

    await this.prisma.recipe.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.auditLogsService.log({
      action: 'RECIPE_DELETED',
      resource: 'Recipe',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { name: recipe.name, isActive: true },
    });

    await this.cacheService.delete(tenantId, `recipe:${id}`);
    await this.cacheService.delete(tenantId, 'recipes:list');
    this.gateway.broadcastRecipeUpdate(tenantId, 'recipe.deleted', { id });
  }

  async getRecipeCost(id: string, tenantId: string) {
    const recipe = await this.getRecipe(id, tenantId);

    const items = (recipe as Record<string, unknown>).items as
      | Array<Record<string, unknown>>
      | undefined;
    if (!items || items.length === 0) {
      return {
        recipeId: id,
        recipeName: (recipe as Record<string, unknown>).name as string,
        totalCost: 0,
        foodCostPercentage: 0,
        sellingPrice: null,
        items: [],
      };
    }

    let totalCost = 0;
    const costItems = [];
    for (const item of items) {
      const invItem = item.inventoryItem as Record<string, unknown> | null;
      const quantity = Number(item.quantity);
      const wastePct = Number(item.wastePercentage ?? 0);
      const effectiveQuantity = quantity * (1 + wastePct / 100);
      const unitCost = Number(
        (invItem as Record<string, unknown> | null)?.averageCost ??
          (invItem as Record<string, unknown> | null)?.unitCost ??
          0,
      );
      const itemCost = effectiveQuantity * unitCost;
      totalCost += itemCost;

      costItems.push({
        inventoryItemId: item.inventoryItemId as string,
        inventoryItemName:
          ((invItem as Record<string, unknown> | null)?.name as string) ?? 'Unknown',
        quantity: quantity,
        wastePercentage: wastePct,
        effectiveQuantity,
        unitCost,
        itemCost,
      });
    }

    const product = (recipe as Record<string, unknown>).product as Record<string, unknown> | null;
    const sellingPrice = product?.basePrice ? Number(product.basePrice) : null;
    const foodCostPercentage =
      sellingPrice && sellingPrice > 0 ? (totalCost / sellingPrice) * 100 : 0;

    return {
      recipeId: id,
      recipeName: (recipe as Record<string, unknown>).name as string,
      totalCost: Math.round(totalCost * 10000) / 10000,
      foodCostPercentage: Math.round(foodCostPercentage * 100) / 100,
      sellingPrice,
      items: costItems,
    };
  }

  async addRecipeItem(
    recipeId: string,
    dto: CreateRecipeItemDto,
    tenantId: string,
    userId: string,
  ) {
    const recipe = await this.prisma.recipe.findFirst({
      where: { id: recipeId, tenantId, deletedAt: null },
    });
    if (!recipe) throw new NotFoundException('Recipe not found');

    const inventoryItem = await this.prisma.inventoryItem.findFirst({
      where: { id: dto.inventoryItemId, tenantId, deletedAt: null },
    });
    if (!inventoryItem) throw new NotFoundException('Inventory item not found');

    const item = await this.prisma.recipeItem.create({
      data: {
        recipeId,
        inventoryItemId: dto.inventoryItemId,
        tenantId,
        quantity: dto.quantity,
        unit: dto.unit,
        wastePercentage: dto.wastePercentage,
        notes: dto.notes,
        sortOrder: dto.sortOrder ?? 0,
      },
      include: {
        inventoryItem: {
          select: { id: true, name: true, sku: true, unitCost: true, averageCost: true },
        },
      },
    });

    await this.recalculateRecipeCost(recipeId, tenantId);

    await this.auditLogsService.log({
      action: 'RECIPE_ITEM_ADDED',
      resource: 'RecipeItem',
      resourceId: item.id,
      userId,
      tenantId,
      newValues: { recipeId, inventoryItemId: dto.inventoryItemId, quantity: dto.quantity },
    });

    await this.cacheService.delete(tenantId, `recipe:${recipeId}`);
    await this.cacheService.delete(tenantId, 'recipes:list');
    this.gateway.broadcastRecipeUpdate(tenantId, 'recipe.updated', {
      recipeId,
      action: 'item-added',
    });

    return item;
  }

  async updateRecipeItem(id: string, dto: UpdateRecipeItemDto, tenantId: string, userId: string) {
    const item = await this.prisma.recipeItem.findFirst({
      where: { id, tenantId },
      include: { recipe: { select: { id: true, tenantId: true } } },
    });
    if (!item) throw new NotFoundException('Recipe item not found');

    const updated = await this.prisma.recipeItem.update({
      where: { id },
      data: {
        inventoryItemId: dto.inventoryItemId,
        quantity: dto.quantity,
        unit: dto.unit,
        wastePercentage: dto.wastePercentage,
        notes: dto.notes,
        sortOrder: dto.sortOrder,
      },
      include: {
        inventoryItem: {
          select: { id: true, name: true, sku: true, unitCost: true, averageCost: true },
        },
      },
    });

    await this.recalculateRecipeCost(item.recipeId, tenantId);

    await this.auditLogsService.log({
      action: 'RECIPE_ITEM_UPDATED',
      resource: 'RecipeItem',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { quantity: Number(item.quantity) },
      newValues: dto as unknown as Record<string, unknown>,
    });

    await this.cacheService.delete(tenantId, `recipe:${item.recipeId}`);
    await this.cacheService.delete(tenantId, 'recipes:list');
    this.gateway.broadcastRecipeUpdate(tenantId, 'recipe.updated', {
      recipeId: item.recipeId,
      action: 'item-updated',
    });

    return updated;
  }

  async removeRecipeItem(id: string, tenantId: string, userId: string) {
    const item = await this.prisma.recipeItem.findFirst({
      where: { id, tenantId },
      include: { recipe: { select: { id: true, tenantId: true } } },
    });
    if (!item) throw new NotFoundException('Recipe item not found');

    await this.prisma.recipeItem.delete({ where: { id } });

    await this.recalculateRecipeCost(item.recipeId, tenantId);

    await this.auditLogsService.log({
      action: 'RECIPE_ITEM_REMOVED',
      resource: 'RecipeItem',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { inventoryItemId: item.inventoryItemId, quantity: Number(item.quantity) },
    });

    await this.cacheService.delete(tenantId, `recipe:${item.recipeId}`);
    await this.cacheService.delete(tenantId, 'recipes:list');
    this.gateway.broadcastRecipeUpdate(tenantId, 'recipe.updated', {
      recipeId: item.recipeId,
      action: 'item-removed',
    });
  }

  async isOrderCompletedForDeduction(orderId: string, tenantId: string): Promise<boolean> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId, deletedAt: null },
      select: { status: true },
    });
    return order?.status === 'COMPLETED';
  }

  private buildIdempotentReport(
    movements: Array<{
      inventoryItemId: string;
      quantity: Prisma.Decimal | number | string;
      unitCost: Prisma.Decimal | number | string | null;
      totalCost: Prisma.Decimal | number | string | null;
      inventoryItem?: { id: string; name: string } | null;
    }>,
    orderId: string,
    tenantId: string,
  ): DeductionReport {
    const items = movements.map((m) => ({
      inventoryItemId: m.inventoryItemId,
      inventoryItemName: m.inventoryItem?.name ?? '',
      quantityDeducted: Math.abs(Number(m.quantity)),
      unitCost: Number(m.unitCost ?? 0),
      totalCost: Math.abs(Number(m.totalCost ?? 0)),
      wasPartial: false,
      shortfall: 0,
    }));
    return {
      orderId,
      tenantId,
      items,
      totalDeducted: items.reduce((s, i) => s + i.quantityDeducted, 0),
      totalCost: items.reduce((s, i) => s + i.totalCost, 0),
      timestamp: new Date(),
    };
  }

  async deductInventoryForOrder(orderId: string, tenantId: string): Promise<DeductionReport> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId, deletedAt: null },
    });
    if (!order) throw new NotFoundException('Order not found');

    const blockedStatuses = ['DRAFT', 'CANCELLED', 'REFUNDED', 'VOIDED'];
    if (blockedStatuses.includes(order.status)) {
      throw new BadRequestException(`Cannot deduct inventory for order in ${order.status} status`);
    }

    const orderItems = await this.prisma.orderItem.findMany({
      where: { orderId, tenantId, voidedAt: null, deletedAt: null },
    });

    if (orderItems.length === 0) {
      throw new BadRequestException('Order has no items to deduct');
    }

    const existingMovements = await this.prisma.stockMovement.findMany({
      where: {
        referenceType: 'ORDER',
        referenceId: orderId,
        tenantId,
        type: StockMovementType.CONSUMPTION,
      },
      include: { inventoryItem: { select: { id: true, name: true } } },
    });
    if (existingMovements.length > 0) {
      return this.buildIdempotentReport(existingMovements, orderId, tenantId);
    }

    const quantityByProduct = new Map<string, number>();
    for (const oi of orderItems) {
      quantityByProduct.set(oi.productId, (quantityByProduct.get(oi.productId) ?? 0) + oi.quantity);
    }

    const productIds = [...quantityByProduct.keys()];
    const recipes = await this.prisma.recipe.findMany({
      where: { productId: { in: productIds }, tenantId, deletedAt: null, isActive: true },
      include: {
        items: {
          include: {
            inventoryItem: {
              select: {
                id: true,
                name: true,
                currentQuantity: true,
                unitCost: true,
                averageCost: true,
              },
            },
          },
        },
      },
    });

    if (recipes.length === 0) {
      throw new BadRequestException('No active recipes found for ordered products');
    }

    const deductionMap = new Map<
      string,
      {
        inventoryItemId: string;
        inventoryItemName: string;
        totalQuantityNeeded: number;
        unitCost: number;
      }
    >();

    for (const recipe of recipes) {
      const orderedQty = recipe.productId ? (quantityByProduct.get(recipe.productId) ?? 0) : 0;
      if (orderedQty <= 0) continue;
      for (const item of recipe.items) {
        if (!item.inventoryItem) continue;
        const invId = item.inventoryItemId!;
        const existing = deductionMap.get(invId);
        const quantityNeeded = Number(item.quantity) * orderedQty;
        if (existing) {
          existing.totalQuantityNeeded += quantityNeeded;
        } else {
          deductionMap.set(invId, {
            inventoryItemId: invId,
            inventoryItemName: item.inventoryItem.name,
            totalQuantityNeeded: quantityNeeded,
            unitCost: Number(item.inventoryItem.averageCost ?? item.inventoryItem.unitCost ?? 0),
          });
        }
      }
    }

    if (deductionMap.size === 0) {
      throw new BadRequestException('No inventory consumption required for ordered products');
    }

    const reportItems: DeductionReport['items'] = [];
    let totalDeducted = 0;
    let totalCost = 0;

    let alreadyDeducted: DeductionReport | null = null;

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id"
        FROM "orders"
        WHERE "id" = ${orderId} AND "tenantId" = ${tenantId}
        FOR UPDATE
      `;

      const inTxExisting = await tx.stockMovement.findFirst({
        where: {
          referenceType: 'ORDER',
          referenceId: orderId,
          tenantId,
          type: StockMovementType.CONSUMPTION,
        },
        include: { inventoryItem: { select: { id: true, name: true } } },
      });
      if (inTxExisting) {
        alreadyDeducted = this.buildIdempotentReport([inTxExisting], orderId, tenantId);
        return;
      }

      for (const [, entry] of deductionMap) {
        // Serialize concurrent deductions for the same ingredient (e.g. two different
        // orders sharing a stock item): the read→compute→write below is protected by a
        // row lock so the deducted amount is never computed from a stale quantity.
        await tx.$queryRaw`
          SELECT "id"
          FROM "inventory_items"
          WHERE "id" = ${entry.inventoryItemId}
          FOR UPDATE
        `;

        const inventoryItem = await tx.inventoryItem.findUnique({
          where: { id: entry.inventoryItemId },
        });
        if (!inventoryItem) continue;

        const currentQty = Number(inventoryItem.currentQuantity);
        const needed = entry.totalQuantityNeeded;
        const unitCost = Number(inventoryItem.averageCost ?? inventoryItem.unitCost ?? 0);
        const wasPartial = currentQty < needed;
        const actualDeduction = wasPartial ? currentQty : needed;
        const shortfall = wasPartial ? needed - currentQty : 0;

        await tx.inventoryItem.update({
          where: { id: entry.inventoryItemId },
          data: {
            currentQuantity: { decrement: actualDeduction },
            availableQuantity: { decrement: actualDeduction },
          },
        });

        const totalCostEntry = actualDeduction * unitCost;

        await tx.stockMovement.create({
          data: {
            inventoryItemId: entry.inventoryItemId,
            tenantId,
            branchId: order.branchId,
            type: StockMovementType.CONSUMPTION,
            quantity: -actualDeduction,
            unitCost,
            totalCost: -totalCostEntry,
            referenceType: 'ORDER',
            referenceId: orderId,
            notes: wasPartial
              ? `Partial deduction for order ${order.orderNumber}. Shortfall: ${shortfall} ${inventoryItem.name}`
              : `Inventory deduction for order ${order.orderNumber}`,
            recordedById: 'system',
          },
        });

        reportItems.push({
          inventoryItemId: entry.inventoryItemId,
          inventoryItemName: entry.inventoryItemName,
          quantityDeducted: actualDeduction,
          unitCost,
          totalCost: totalCostEntry,
          wasPartial,
          shortfall,
        });

        totalDeducted += actualDeduction;
        totalCost += totalCostEntry;
      }
    });

    if (alreadyDeducted) {
      return alreadyDeducted;
    }

    const report: DeductionReport = {
      orderId,
      tenantId,
      items: reportItems,
      totalDeducted: Math.round(totalDeducted * 10000) / 10000,
      totalCost: Math.round(totalCost * 10000) / 10000,
      timestamp: new Date(),
    };

    await this.auditLogsService.log({
      action: 'INVENTORY_DEDUCTED',
      resource: 'Order',
      resourceId: orderId,
      tenantId,
      userId: 'system',
      newValues: report as unknown as Record<string, unknown>,
    });

    await this.cacheService.delete(tenantId, 'inventory:list');
    this.gateway.broadcastInventoryUpdate(tenantId, 'inventory.deducted', report);

    return report;
  }

  async rollbackDeduction(
    orderId: string,
    tenantId: string,
  ): Promise<{ rolledBack: boolean; movementsReversed: number }> {
    const movements = await this.prisma.stockMovement.findMany({
      where: {
        referenceType: 'ORDER',
        referenceId: orderId,
        tenantId,
        type: StockMovementType.CONSUMPTION,
        notes: { not: { contains: 'ROLLED_BACK' } },
      },
      include: { inventoryItem: { select: { id: true, name: true, currentQuantity: true } } },
    });

    if (movements.length === 0) {
      throw new NotFoundException('No deduction movements found for this order');
    }

    let reversedCount = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const movement of movements) {
        const absQuantity = Math.abs(Number(movement.quantity));

        await tx.inventoryItem.update({
          where: { id: movement.inventoryItemId },
          data: {
            currentQuantity: { increment: absQuantity },
            availableQuantity: { increment: absQuantity },
          },
        });

        await tx.stockMovement.create({
          data: {
            inventoryItemId: movement.inventoryItemId,
            tenantId,
            branchId: movement.branchId,
            type: StockMovementType.ADJUSTMENT,
            quantity: absQuantity,
            unitCost: movement.unitCost,
            totalCost: movement.totalCost ? Math.abs(Number(movement.totalCost)) : undefined,
            referenceType: 'ROLLBACK',
            referenceId: orderId,
            notes: `Rolled back deduction for order ${orderId}. Original movement: ${movement.id}`,
            recordedById: 'system',
          },
        });

        reversedCount++;
      }
    });

    await this.auditLogsService.log({
      action: 'DEDUCTION_ROLLED_BACK',
      resource: 'Order',
      resourceId: orderId,
      tenantId,
      userId: 'system',
      newValues: { movementsReversed: reversedCount },
    });

    await this.cacheService.delete(tenantId, 'inventory:list');
    this.gateway.broadcastInventoryUpdate(tenantId, 'deduction.rolled_back', {
      orderId,
      movementsReversed: reversedCount,
    });

    return { rolledBack: true, movementsReversed: reversedCount };
  }

  async getDeductionReport(
    orderId: string,
    tenantId: string,
  ): Promise<{
    orderId: string;
    movements: Array<{
      id: string;
      inventoryItemId: string;
      inventoryItemName: string;
      quantity: number;
      unitCost: number | null;
      totalCost: number | null;
      createdAt: Date;
    }>;
    totalMovements: number;
    totalQuantity: number;
    totalCost: number;
  }> {
    const movements = await this.prisma.stockMovement.findMany({
      where: {
        referenceType: 'ORDER',
        referenceId: orderId,
        tenantId,
        type: StockMovementType.CONSUMPTION,
      },
      include: {
        inventoryItem: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const enrichedMovements = movements.map((m) => ({
      id: m.id,
      inventoryItemId: m.inventoryItemId,
      inventoryItemName: m.inventoryItem.name,
      quantity: Number(m.quantity),
      unitCost: m.unitCost ? Number(m.unitCost) : null,
      totalCost: m.totalCost ? Number(m.totalCost) : null,
      createdAt: m.createdAt,
    }));

    const totalQuantity = enrichedMovements.reduce((sum, m) => sum + Math.abs(m.quantity), 0);
    const totalCost = enrichedMovements.reduce((sum, m) => sum + Math.abs(m.totalCost ?? 0), 0);

    return {
      orderId,
      movements: enrichedMovements,
      totalMovements: enrichedMovements.length,
      totalQuantity: Math.round(totalQuantity * 10000) / 10000,
      totalCost: Math.round(totalCost * 10000) / 10000,
    };
  }

  private async recalculateRecipeCost(recipeId: string, tenantId: string) {
    const items = await this.prisma.recipeItem.findMany({
      where: { recipeId, tenantId },
      include: {
        inventoryItem: {
          select: { id: true, unitCost: true, averageCost: true },
        },
      },
    });

    let totalCost = 0;
    for (const item of items) {
      const quantity = Number(item.quantity);
      const wastePct = Number(item.wastePercentage ?? 0);
      const effectiveQuantity = quantity * (1 + wastePct / 100);
      const unitCost = Number(item.inventoryItem?.averageCost ?? item.inventoryItem?.unitCost ?? 0);
      totalCost += effectiveQuantity * unitCost;
    }

    const recipe = await this.prisma.recipe.findUnique({
      where: { id: recipeId },
      include: { product: { select: { basePrice: true } } },
    });

    let foodCostPercentage = 0;
    if (recipe?.product?.basePrice && Number(recipe.product.basePrice) > 0) {
      foodCostPercentage = (totalCost / Number(recipe.product.basePrice)) * 100;
    }

    await this.prisma.recipe.update({
      where: { id: recipeId },
      data: {
        cost: totalCost,
        foodCostPercentage: Math.round(foodCostPercentage * 100) / 100,
      },
    });
  }
}
