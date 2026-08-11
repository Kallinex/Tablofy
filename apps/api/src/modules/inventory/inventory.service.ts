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
import { InventoryGateway } from './inventory.gateway';
import { MetricsService } from '../../common/metrics/metrics.service';
import {
  Prisma,
  StockMovementType,
  AdjustmentType,
  WasteType,
  StockAdjustmentStatus,
  InventoryCountStatus,
} from '@prisma/client';
import { buildPaginatedResponse } from '@tablofy/shared/utils';
import { PAGINATION_DEFAULTS, CACHE_TTL } from '@tablofy/shared/constants';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto';
import { UpdateInventoryItemDto } from './dto/update-inventory-item.dto';
import { QueryInventoryDto } from './dto/query-inventory.dto';
import { CreateInventoryCategoryDto } from './dto/create-inventory-category.dto';
import { UpdateInventoryCategoryDto } from './dto/update-inventory-category.dto';
import { CreateInventoryUnitDto } from './dto/create-inventory-unit.dto';
import { UpdateInventoryUnitDto } from './dto/update-inventory-unit.dto';
import { CreateInventoryLocationDto } from './dto/create-inventory-location.dto';
import { UpdateInventoryLocationDto } from './dto/update-inventory-location.dto';
import { CreateStockAdjustmentDto } from './dto/create-stock-adjustment.dto';
import { CreateWasteEntryDto } from './dto/create-waste-entry.dto';
import { CreateInventoryCountDto } from './dto/create-inventory-count.dto';
import { CreateInventoryBatchDto } from './dto/inventory-batch.dto';

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly cacheService: CacheService,
    private readonly queueService: QueueService,
    private readonly eventEmitter: EventEmitter2,
    private readonly gateway: InventoryGateway,
    private readonly metricsService: MetricsService,
  ) {}

  // ============================================
  // Categories
  // ============================================

  async createCategory(dto: CreateInventoryCategoryDto, tenantId: string, userId: string) {
    const existing = await this.prisma.inventoryCategory.findFirst({
      where: { tenantId, name: dto.name, deletedAt: null },
    });
    if (existing) throw new ConflictException('Category with this name already exists');

    const category = await this.prisma.$transaction(async (tx) => {
      const created = await tx.inventoryCategory.create({
        data: {
          tenantId,
          name: dto.name,
          description: dto.description,
          parentId: dto.parentId,
          sortOrder: dto.sortOrder ?? 0,
        },
      });

      await tx.auditLog.create({
        data: {
          action: 'INVENTORY_CATEGORY_CREATED',
          resource: 'InventoryCategory',
          resourceId: created.id,
          userId,
          tenantId,
          newValues: { name: dto.name, description: dto.description } as Prisma.InputJsonValue,
        },
      });

      return created;
    });

    await this.invalidateCategoryCache(tenantId);
    this.gateway.broadcastCategoryUpdate(tenantId, 'category.created', category);

    return category;
  }

  async updateCategory(
    id: string,
    dto: UpdateInventoryCategoryDto,
    tenantId: string,
    userId: string,
  ) {
    const category = await this.prisma.inventoryCategory.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!category) throw new NotFoundException('Category not found');

    if (dto.name && dto.name !== category.name) {
      const existing = await this.prisma.inventoryCategory.findFirst({
        where: { tenantId, name: dto.name, deletedAt: null },
      });
      if (existing) throw new ConflictException('Category with this name already exists');
    }

    const updated = await this.prisma.inventoryCategory.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        parentId: dto.parentId,
        sortOrder: dto.sortOrder,
      },
    });

    await this.auditLogsService.log({
      action: 'INVENTORY_CATEGORY_UPDATED',
      resource: 'InventoryCategory',
      resourceId: id,
      userId,
      tenantId,
      oldValues: category as unknown as Record<string, unknown>,
      newValues: dto as unknown as Record<string, unknown>,
    });

    await this.invalidateCategoryCache(tenantId);
    this.gateway.broadcastCategoryUpdate(tenantId, 'category.updated', updated);

    return updated;
  }

  async deleteCategory(id: string, tenantId: string, userId: string) {
    const category = await this.prisma.inventoryCategory.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!category) throw new NotFoundException('Category not found');

    await this.prisma.inventoryCategory.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.auditLogsService.log({
      action: 'INVENTORY_CATEGORY_DELETED',
      resource: 'InventoryCategory',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { name: category.name },
    });

    await this.invalidateCategoryCache(tenantId);
    this.gateway.broadcastCategoryUpdate(tenantId, 'category.deleted', { id });
  }

  async getCategories(tenantId: string) {
    const cacheKey = 'categories:list';
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const categories = await this.prisma.inventoryCategory.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
      include: { children: true, _count: { select: { items: true } } },
    });

    await this.cacheService.set(tenantId, cacheKey, categories, CACHE_TTL.MEDIUM);
    return categories;
  }

  // ============================================
  // Units
  // ============================================

  async createUnit(dto: CreateInventoryUnitDto, tenantId: string, userId: string) {
    const existing = await this.prisma.inventoryUnit.findFirst({
      where: { tenantId, name: dto.name, deletedAt: null },
    });
    if (existing) throw new ConflictException('Unit with this name already exists');

    const unit = await this.prisma.$transaction(async (tx) => {
      const created = await tx.inventoryUnit.create({
        data: {
          tenantId,
          name: dto.name,
          abbreviation: dto.abbreviation,
          type: dto.type,
        },
      });

      await tx.auditLog.create({
        data: {
          action: 'INVENTORY_UNIT_CREATED',
          resource: 'InventoryUnit',
          resourceId: created.id,
          userId,
          tenantId,
          newValues: { name: dto.name, abbreviation: dto.abbreviation } as Prisma.InputJsonValue,
        },
      });

      return created;
    });

    await this.invalidateUnitCache(tenantId);
    this.gateway.broadcastUnitUpdate(tenantId, 'unit.created', unit);

    return unit;
  }

  async updateUnit(id: string, dto: UpdateInventoryUnitDto, tenantId: string, userId: string) {
    const unit = await this.prisma.inventoryUnit.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!unit) throw new NotFoundException('Unit not found');

    if (dto.name && dto.name !== unit.name) {
      const existing = await this.prisma.inventoryUnit.findFirst({
        where: { tenantId, name: dto.name, deletedAt: null },
      });
      if (existing) throw new ConflictException('Unit with this name already exists');
    }

    const updated = await this.prisma.inventoryUnit.update({
      where: { id },
      data: {
        name: dto.name,
        abbreviation: dto.abbreviation,
        type: dto.type,
      },
    });

    await this.auditLogsService.log({
      action: 'INVENTORY_UNIT_UPDATED',
      resource: 'InventoryUnit',
      resourceId: id,
      userId,
      tenantId,
      oldValues: unit as unknown as Record<string, unknown>,
      newValues: dto as unknown as Record<string, unknown>,
    });

    await this.invalidateUnitCache(tenantId);
    this.gateway.broadcastUnitUpdate(tenantId, 'unit.updated', updated);

    return updated;
  }

  async deleteUnit(id: string, tenantId: string, userId: string) {
    const unit = await this.prisma.inventoryUnit.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!unit) throw new NotFoundException('Unit not found');

    await this.prisma.inventoryUnit.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.auditLogsService.log({
      action: 'INVENTORY_UNIT_DELETED',
      resource: 'InventoryUnit',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { name: unit.name },
    });

    await this.invalidateUnitCache(tenantId);
    this.gateway.broadcastUnitUpdate(tenantId, 'unit.deleted', { id });
  }

  async getUnits(tenantId: string) {
    const cacheKey = 'units:list';
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const units = await this.prisma.inventoryUnit.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { name: 'asc' },
    });

    await this.cacheService.set(tenantId, cacheKey, units, CACHE_TTL.MEDIUM);
    return units;
  }

  // ============================================
  // Locations
  // ============================================

  async createLocation(dto: CreateInventoryLocationDto, tenantId: string, userId: string) {
    const location = await this.prisma.inventoryLocation.create({
      data: {
        tenantId,
        name: dto.name,
        branchId: dto.branchId,
        type: dto.type,
        description: dto.description,
      },
    });

    await this.auditLogsService.log({
      action: 'INVENTORY_LOCATION_CREATED',
      resource: 'InventoryLocation',
      resourceId: location.id,
      userId,
      tenantId,
      newValues: { name: dto.name, type: dto.type },
    });

    await this.invalidateLocationCache(tenantId);
    this.gateway.broadcastLocationUpdate(tenantId, 'location.created', location);

    return location;
  }

  async updateLocation(
    id: string,
    dto: UpdateInventoryLocationDto,
    tenantId: string,
    userId: string,
  ) {
    const location = await this.prisma.inventoryLocation.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!location) throw new NotFoundException('Location not found');

    const updated = await this.prisma.inventoryLocation.update({
      where: { id },
      data: {
        name: dto.name,
        branchId: dto.branchId,
        type: dto.type,
        description: dto.description,
      },
    });

    await this.auditLogsService.log({
      action: 'INVENTORY_LOCATION_UPDATED',
      resource: 'InventoryLocation',
      resourceId: id,
      userId,
      tenantId,
      oldValues: location as unknown as Record<string, unknown>,
      newValues: dto as unknown as Record<string, unknown>,
    });

    await this.invalidateLocationCache(tenantId);
    this.gateway.broadcastLocationUpdate(tenantId, 'location.updated', updated);

    return updated;
  }

  async deleteLocation(id: string, tenantId: string, userId: string) {
    const location = await this.prisma.inventoryLocation.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!location) throw new NotFoundException('Location not found');

    await this.prisma.inventoryLocation.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.auditLogsService.log({
      action: 'INVENTORY_LOCATION_DELETED',
      resource: 'InventoryLocation',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { name: location.name },
    });

    await this.invalidateLocationCache(tenantId);
    this.gateway.broadcastLocationUpdate(tenantId, 'location.deleted', { id });
  }

  async getLocations(tenantId: string, branchId?: string) {
    const cacheKey = `locations:list:${branchId ?? 'all'}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const where: Prisma.InventoryLocationWhereInput = { tenantId, deletedAt: null };
    if (branchId) where.branchId = branchId;

    const locations = await this.prisma.inventoryLocation.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { branch: true },
    });

    await this.cacheService.set(tenantId, cacheKey, locations, CACHE_TTL.MEDIUM);
    return locations;
  }

  // ============================================
  // Inventory Items
  // ============================================

  async createItem(dto: CreateInventoryItemDto, tenantId: string, userId: string) {
    if (dto.sku) {
      const existing = await this.prisma.inventoryItem.findFirst({
        where: { tenantId, sku: dto.sku, deletedAt: null },
      });
      if (existing) throw new ConflictException('Item with this SKU already exists');
    }

    const currentQty = dto.currentQuantity ?? 0;
    const reservedQty = dto.reservedQuantity ?? 0;
    const availableQty = currentQty - reservedQty;

    const item = await this.prisma.inventoryItem.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description,
        sku: dto.sku,
        barcode: dto.barcode,
        internalCode: dto.internalCode,
        categoryId: dto.categoryId,
        unitId: dto.unitId,
        locationId: dto.locationId,
        currentQuantity: currentQty,
        reservedQuantity: reservedQty,
        availableQuantity: availableQty < 0 ? 0 : availableQty,
        minStock: dto.minStock,
        maxStock: dto.maxStock,
        reorderLevel: dto.reorderLevel,
        unitCost: dto.unitCost,
        averageCost: dto.averageCost,
        lastCost: dto.lastCost,
        isActive: dto.isActive ?? true,
        isPurchasable: dto.isPurchasable ?? true,
        isManufactured: dto.isManufactured ?? false,
        image: dto.image,
        metadata: (dto.metadata as Prisma.InputJsonValue) ?? Prisma.DbNull,
      },
    });

    await this.auditLogsService.log({
      action: 'INVENTORY_ITEM_CREATED',
      resource: 'InventoryItem',
      resourceId: item.id,
      userId,
      tenantId,
      newValues: { name: dto.name, sku: dto.sku, currentQuantity: currentQty },
    });

    await this.invalidateItemCache(tenantId);
    this.gateway.broadcastItemUpdate(tenantId, 'item.created', item);

    return this.getItem(item.id, tenantId);
  }

  async updateItem(id: string, dto: UpdateInventoryItemDto, tenantId: string, userId: string) {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!item) throw new NotFoundException('Inventory item not found');

    if (dto.sku && dto.sku !== item.sku) {
      const existing = await this.prisma.inventoryItem.findFirst({
        where: { tenantId, sku: dto.sku, deletedAt: null },
      });
      if (existing) throw new ConflictException('Item with this SKU already exists');
    }

    const currentQty = dto.currentQuantity ?? Number(item.currentQuantity);
    const reservedQty = dto.reservedQuantity ?? Number(item.reservedQuantity);
    const availableQty = currentQty - reservedQty;

    const updatedCount = await this.prisma.inventoryItem.updateMany({
      where: { id, tenantId, version: item.version, deletedAt: null },
      data: {
        name: dto.name,
        description: dto.description,
        sku: dto.sku,
        barcode: dto.barcode,
        internalCode: dto.internalCode,
        categoryId: dto.categoryId,
        unitId: dto.unitId,
        locationId: dto.locationId,
        currentQuantity: currentQty,
        reservedQuantity: reservedQty,
        availableQuantity: availableQty < 0 ? 0 : availableQty,
        minStock: dto.minStock,
        maxStock: dto.maxStock,
        reorderLevel: dto.reorderLevel,
        unitCost: dto.unitCost,
        averageCost: dto.averageCost,
        lastCost: dto.lastCost,
        isActive: dto.isActive,
        isPurchasable: dto.isPurchasable,
        isManufactured: dto.isManufactured,
        image: dto.image,
        metadata: dto.metadata !== undefined ? (dto.metadata as Prisma.InputJsonValue) : undefined,
        version: { increment: 1 },
      },
    });
    if (updatedCount.count !== 1) {
      throw new ConflictException(
        'Inventory item was modified by another request. Reload and retry.',
      );
    }

    const updated = await this.prisma.inventoryItem.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    await this.auditLogsService.log({
      action: 'INVENTORY_ITEM_UPDATED',
      resource: 'InventoryItem',
      resourceId: id,
      userId,
      tenantId,
      oldValues: item as unknown as Record<string, unknown>,
      newValues: dto as unknown as Record<string, unknown>,
    });

    await this.invalidateItemCache(tenantId);
    this.gateway.broadcastItemUpdate(tenantId, 'item.updated', updated);

    return this.getItem(id, tenantId);
  }

  async getItem(id: string, tenantId: string) {
    const cacheKey = `item:${id}`;
    const cached = await this.cacheService.get<Record<string, unknown>>(tenantId, cacheKey);
    if (cached) return cached;

    const item = await this.prisma.inventoryItem.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        category: true,
        unit: true,
        location: true,
        batches: { where: { isActive: true }, orderBy: { expiryDate: 'asc' } },
      },
    });

    if (!item) throw new NotFoundException('Inventory item not found');
    await this.cacheService.set(tenantId, cacheKey, item, CACHE_TTL.MEDIUM);
    return item;
  }

  async listItems(tenantId: string, query: QueryInventoryDto) {
    const cacheKey = `items:list:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.InventoryItemWhereInput = {
      tenantId,
      deletedAt: null,
    };

    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.locationId) where.locationId = query.locationId;
    if (query.unitId) where.unitId = query.unitId;
    if (query.isActive !== undefined) where.isActive = query.isActive;
    if (query.isOutOfStock) where.currentQuantity = { lte: 0 };

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { sku: { contains: query.search, mode: 'insensitive' } },
        { barcode: { contains: query.search, mode: 'insensitive' } },
        { internalCode: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const orderBy: Prisma.InventoryItemOrderByWithRelationInput = {};
    if (query.sortBy === 'name') orderBy.name = query.sortOrder ?? 'asc';
    else if (query.sortBy === 'currentQuantity')
      orderBy.currentQuantity = query.sortOrder ?? 'desc';
    else if (query.sortBy === 'unitCost') orderBy.unitCost = query.sortOrder ?? 'desc';
    else if (query.sortBy === 'availableQuantity')
      orderBy.availableQuantity = query.sortOrder ?? 'desc';
    else if (query.sortBy === 'createdAt') orderBy.createdAt = query.sortOrder ?? 'desc';
    else orderBy.createdAt = 'desc';

    const [data, total] = await Promise.all([
      this.prisma.inventoryItem.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          category: true,
          unit: true,
          location: true,
          _count: { select: { batches: true, movements: true } },
        },
      }),
      this.prisma.inventoryItem.count({ where }),
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

    await this.cacheService.set(tenantId, cacheKey, result, CACHE_TTL.LOW_STOCK);
    return result;
  }

  async deleteItem(id: string, tenantId: string, userId: string) {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!item) throw new NotFoundException('Inventory item not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.inventoryItem.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false },
      });

      await tx.auditLog.create({
        data: {
          action: 'INVENTORY_ITEM_DELETED',
          resource: 'InventoryItem',
          resourceId: id,
          userId,
          tenantId,
          oldValues: { name: item.name, sku: item.sku } as Prisma.InputJsonValue,
        },
      });
    });

    await this.cacheService.delete(tenantId, `item:${id}`);
    await this.invalidateItemCache(tenantId);
    this.gateway.broadcastItemUpdate(tenantId, 'item.deleted', { id });
  }

  async restoreItem(id: string, tenantId: string, userId: string) {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id, tenantId, deletedAt: { not: null } },
    });
    if (!item) throw new NotFoundException('Deleted inventory item not found');

    await this.prisma.inventoryItem.update({
      where: { id },
      data: { deletedAt: null, isActive: true },
    });

    await this.auditLogsService.log({
      action: 'INVENTORY_ITEM_RESTORED',
      resource: 'InventoryItem',
      resourceId: id,
      userId,
      tenantId,
    });

    await this.cacheService.delete(tenantId, `item:${id}`);
    await this.invalidateItemCache(tenantId);
    this.gateway.broadcastItemUpdate(tenantId, 'item.restored', { id });
  }

  // ============================================
  // Stock Adjustments
  // ============================================

  async createAdjustment(dto: CreateStockAdjustmentDto, tenantId: string, userId: string) {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: dto.inventoryItemId, tenantId, deletedAt: null },
    });
    if (!item) throw new NotFoundException('Inventory item not found');

    const unitCost = dto.unitCost ?? Number(item.unitCost ?? 0);
    const totalCost = dto.totalCost ?? dto.quantity * unitCost;

    const adjustment = await this.prisma.$transaction(async (tx) => {
      const adj = await tx.stockAdjustment.create({
        data: {
          inventoryItemId: dto.inventoryItemId,
          tenantId,
          branchId: dto.branchId,
          type: dto.type,
          reason: dto.reason,
          quantity: dto.quantity,
          unitCost,
          totalCost,
          referenceNumber: dto.referenceNumber,
          notes: dto.notes,
          status: dto.type === AdjustmentType.DECREASE ? 'PENDING' : 'APPROVED',
          createdById: userId,
        },
      });

      if (dto.type === AdjustmentType.INCREASE) {
        const qtyChange = dto.quantity;

        const updated = await tx.inventoryItem.updateMany({
          where: { id: dto.inventoryItemId, tenantId, deletedAt: null },
          data: {
            currentQuantity: { increment: qtyChange },
            availableQuantity: { increment: qtyChange },
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) {
          throw new NotFoundException('Inventory item not found');
        }

        await tx.stockMovement.create({
          data: {
            inventoryItemId: dto.inventoryItemId,
            tenantId,
            branchId: dto.branchId,
            type: StockMovementType.ADJUSTMENT,
            quantity: qtyChange,
            unitCost,
            totalCost,
            referenceType: 'StockAdjustment',
            referenceId: adj.id,
            notes: `Adjustment: ${dto.reason}`,
            recordedById: userId,
          },
        });
      }

      return adj;
    });

    await this.auditLogsService.log({
      action: 'STOCK_ADJUSTMENT_CREATED',
      resource: 'StockAdjustment',
      resourceId: adjustment.id,
      userId,
      tenantId,
      newValues: {
        inventoryItemId: dto.inventoryItemId,
        type: dto.type,
        quantity: dto.quantity,
        status: adjustment.status,
      },
    });

    await this.invalidateItemCache(tenantId);
    this.gateway.broadcastAdjustmentUpdate(tenantId, 'adjustment.created', adjustment);

    return adjustment;
  }

  async approveAdjustment(id: string, tenantId: string, userId: string) {
    const adjustment = await this.prisma.stockAdjustment.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!adjustment) throw new NotFoundException('Stock adjustment not found');

    const qtyChange =
      adjustment.type === AdjustmentType.INCREASE
        ? Number(adjustment.quantity)
        : -Number(adjustment.quantity);

    await this.prisma.$transaction(async (tx) => {
      const item = await tx.inventoryItem.findFirst({
        where: { id: adjustment.inventoryItemId, tenantId, deletedAt: null },
      });
      if (!item) throw new NotFoundException('Inventory item not found');

      const updated = await tx.stockAdjustment.updateMany({
        where: { id, tenantId, status: 'PENDING', deletedAt: null },
        data: { status: 'APPROVED', approvedById: userId, approvedAt: new Date() },
      });
      if (updated.count !== 1) throw new BadRequestException('Adjustment is not PENDING');

      if (adjustment.type === AdjustmentType.INCREASE) {
        const claimed = await tx.inventoryItem.updateMany({
          where: { id: adjustment.inventoryItemId, tenantId, deletedAt: null },
          data: {
            currentQuantity: { increment: adjustment.quantity },
            availableQuantity: { increment: adjustment.quantity },
            version: { increment: 1 },
          },
        });
        if (claimed.count !== 1) throw new NotFoundException('Inventory item not found');
      } else {
        const decrementQty = Number(adjustment.quantity);
        const claimed = await tx.inventoryItem.updateMany({
          where: {
            id: adjustment.inventoryItemId,
            tenantId,
            currentQuantity: { gte: decrementQty },
          },
          data: {
            currentQuantity: { decrement: decrementQty },
            version: { increment: 1 },
          },
        });
        if (claimed.count !== 1) {
          throw new BadRequestException('Insufficient stock to apply this adjustment');
        }

        const availableClaimed = await tx.inventoryItem.updateMany({
          where: {
            id: adjustment.inventoryItemId,
            tenantId,
            availableQuantity: { gte: decrementQty },
          },
          data: { availableQuantity: { decrement: decrementQty } },
        });
        if (availableClaimed.count !== 1) {
          await tx.inventoryItem.updateMany({
            where: { id: adjustment.inventoryItemId, tenantId },
            data: { availableQuantity: 0 },
          });
        }
      }

      await tx.stockMovement.create({
        data: {
          inventoryItemId: adjustment.inventoryItemId,
          tenantId,
          branchId: adjustment.branchId,
          type: StockMovementType.ADJUSTMENT,
          quantity: qtyChange,
          unitCost: Number(adjustment.unitCost ?? item.unitCost ?? 0),
          totalCost: Number(adjustment.totalCost ?? 0),
          referenceType: 'StockAdjustment',
          referenceId: adjustment.id,
          notes: `Adjustment approved: ${adjustment.reason}`,
          recordedById: userId,
        },
      });
    });

    // Need to get the updated adjustment
    const approved = await this.prisma.stockAdjustment.findUnique({
      where: { id },
    });

    await this.auditLogsService.log({
      action: 'STOCK_ADJUSTMENT_APPROVED',
      resource: 'StockAdjustment',
      resourceId: id,
      userId,
      tenantId,
      newValues: { status: 'APPROVED', quantity: qtyChange },
    });

    await this.invalidateItemCache(tenantId);
    this.gateway.broadcastAdjustmentUpdate(tenantId, 'adjustment.approved', approved);
    this.metricsService.incrementInventoryMovements();

    return approved;
  }

  async listAdjustments(tenantId: string, query: Record<string, unknown>) {
    const page = (query.page as number) ?? 1;
    const limit = (query.limit as number) ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.StockAdjustmentWhereInput = { tenantId, deletedAt: null };
    if (query.status) where.status = query.status as StockAdjustmentStatus;
    if (query.type) where.type = query.type as AdjustmentType;
    if (query.inventoryItemId) where.inventoryItemId = query.inventoryItemId as string;
    if (query.branchId) where.branchId = query.branchId as string;

    const orderBy: Prisma.StockAdjustmentOrderByWithRelationInput = {};
    const sortBy = query.sortBy as string | undefined;
    const sortOrder = (query.sortOrder as 'asc' | 'desc') ?? 'desc';
    if (sortBy === 'createdAt') orderBy.createdAt = sortOrder;
    else if (sortBy === 'quantity') orderBy.quantity = sortOrder;
    else orderBy.createdAt = 'desc';

    const [data, total] = await Promise.all([
      this.prisma.stockAdjustment.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: { inventoryItem: { select: { id: true, name: true, sku: true } } },
      }),
      this.prisma.stockAdjustment.count({ where }),
    ]);

    return {
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
  }

  // ============================================
  // Waste
  // ============================================

  async createWasteEntry(dto: CreateWasteEntryDto, tenantId: string, userId: string) {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: dto.inventoryItemId, tenantId, deletedAt: null },
    });
    if (!item) throw new NotFoundException('Inventory item not found');

    const currentQty = Number(item.currentQuantity);
    if (currentQty < dto.quantity) {
      throw new BadRequestException(
        `Insufficient stock. Available: ${currentQty}, requested waste: ${dto.quantity}`,
      );
    }

    const unitCost = dto.unitCost ?? Number(item.unitCost ?? 0);
    const totalCost = dto.totalCost ?? dto.quantity * unitCost;

    const waste = await this.prisma.$transaction(async (tx) => {
      const entry = await tx.wasteEntry.create({
        data: {
          inventoryItemId: dto.inventoryItemId,
          tenantId,
          branchId: dto.branchId,
          type: dto.type,
          quantity: dto.quantity,
          unitCost,
          totalCost,
          reason: dto.reason,
          referenceNumber: dto.referenceNumber,
          notes: dto.notes,
          recordedById: userId,
        },
      });

      const claimed = await tx.inventoryItem.updateMany({
        where: {
          id: dto.inventoryItemId,
          tenantId,
          currentQuantity: { gte: dto.quantity },
        },
        data: {
          currentQuantity: { decrement: dto.quantity },
          version: { increment: 1 },
        },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException('Insufficient stock to record waste');
      }

      const availableClaimed = await tx.inventoryItem.updateMany({
        where: {
          id: dto.inventoryItemId,
          tenantId,
          availableQuantity: { gte: dto.quantity },
        },
        data: { availableQuantity: { decrement: dto.quantity } },
      });
      if (availableClaimed.count !== 1) {
        await tx.inventoryItem.updateMany({
          where: { id: dto.inventoryItemId, tenantId },
          data: { availableQuantity: 0 },
        });
      }

      await tx.stockMovement.create({
        data: {
          inventoryItemId: dto.inventoryItemId,
          tenantId,
          branchId: dto.branchId,
          type: StockMovementType.WASTE,
          quantity: -dto.quantity,
          unitCost,
          totalCost,
          referenceType: 'WasteEntry',
          referenceId: entry.id,
          notes: dto.reason ?? 'Waste recorded',
          recordedById: userId,
        },
      });

      return entry;
    });

    await this.auditLogsService.log({
      action: 'WASTE_ENTRY_CREATED',
      resource: 'WasteEntry',
      resourceId: waste.id,
      userId,
      tenantId,
      newValues: {
        inventoryItemId: dto.inventoryItemId,
        type: dto.type,
        quantity: dto.quantity,
        reason: dto.reason,
      },
    });

    await this.invalidateItemCache(tenantId);
    this.gateway.broadcastWasteUpdate(tenantId, 'waste.created', waste);
    this.metricsService.incrementInventoryMovements();

    return waste;
  }

  async listWasteEntries(tenantId: string, query: Record<string, unknown>) {
    const page = (query.page as number) ?? 1;
    const limit = (query.limit as number) ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.WasteEntryWhereInput = { tenantId, deletedAt: null };
    if (query.type) where.type = query.type as WasteType;
    if (query.inventoryItemId) where.inventoryItemId = query.inventoryItemId as string;
    if (query.branchId) where.branchId = query.branchId as string;

    const orderBy: Prisma.WasteEntryOrderByWithRelationInput = {};
    const sortBy = query.sortBy as string | undefined;
    const sortOrder = (query.sortOrder as 'asc' | 'desc') ?? 'desc';
    if (sortBy === 'createdAt') orderBy.createdAt = sortOrder;
    else if (sortBy === 'quantity') orderBy.quantity = sortOrder;
    else orderBy.createdAt = 'desc';

    const [data, total] = await Promise.all([
      this.prisma.wasteEntry.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: { inventoryItem: { select: { id: true, name: true, sku: true } } },
      }),
      this.prisma.wasteEntry.count({ where }),
    ]);

    return {
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
  }

  // ============================================
  // Inventory Counts
  // ============================================

  async createCount(dto: CreateInventoryCountDto, tenantId: string, userId: string) {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: dto.inventoryItemId, tenantId, deletedAt: null },
    });
    if (!item) throw new NotFoundException('Inventory item not found');

    const variance = dto.actualQuantity - dto.expectedQuantity;
    const unitCost = dto.unitCost ?? Number(item.unitCost ?? 0);
    const varianceCost = variance * unitCost;

    const count = await this.prisma.$transaction(async (tx) => {
      const created = await tx.inventoryCount.create({
        data: {
          inventoryItemId: dto.inventoryItemId,
          tenantId,
          branchId: dto.branchId,
          countType: dto.countType,
          expectedQuantity: dto.expectedQuantity,
          actualQuantity: dto.actualQuantity,
          variance,
          unitCost,
          varianceCost,
          notes: dto.notes,
          countedById: userId,
        },
      });

      await tx.auditLog.create({
        data: {
          action: 'INVENTORY_COUNT_CREATED',
          resource: 'InventoryCount',
          resourceId: created.id,
          userId,
          tenantId,
          newValues: {
            inventoryItemId: dto.inventoryItemId,
            expectedQuantity: dto.expectedQuantity,
            actualQuantity: dto.actualQuantity,
            variance,
          } as Prisma.InputJsonValue,
        },
      });

      return created;
    });

    await this.invalidateItemCache(tenantId);
    this.gateway.broadcastCountUpdate(tenantId, 'count.created', count);

    return count;
  }

  async listCounts(tenantId: string, query: Record<string, unknown>) {
    const page = (query.page as number) ?? 1;
    const limit = (query.limit as number) ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.InventoryCountWhereInput = { tenantId };
    if (query.status) where.status = query.status as InventoryCountStatus;
    if (query.inventoryItemId) where.inventoryItemId = query.inventoryItemId as string;
    if (query.branchId) where.branchId = query.branchId as string;

    const orderBy: Prisma.InventoryCountOrderByWithRelationInput = {};
    const sortBy = query.sortBy as string | undefined;
    const sortOrder = (query.sortOrder as 'asc' | 'desc') ?? 'desc';
    if (sortBy === 'countedAt') orderBy.countedAt = sortOrder;
    else if (sortBy === 'variance') orderBy.variance = sortOrder;
    else orderBy.countedAt = 'desc';

    const [data, total] = await Promise.all([
      this.prisma.inventoryCount.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: { inventoryItem: { select: { id: true, name: true, sku: true } } },
      }),
      this.prisma.inventoryCount.count({ where }),
    ]);

    return {
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
  }

  // ============================================
  // Batches
  // ============================================

  async createBatch(dto: CreateInventoryBatchDto, tenantId: string, userId: string) {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: dto.inventoryItemId, tenantId, deletedAt: null },
    });
    if (!item) throw new NotFoundException('Inventory item not found');

    const batch = await this.prisma.inventoryBatch.create({
      data: {
        inventoryItemId: dto.inventoryItemId,
        tenantId,
        batchNumber: dto.batchNumber,
        lotNumber: dto.lotNumber,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : undefined,
        quantity: dto.quantity,
        unitCost: dto.unitCost,
      },
    });

    await this.auditLogsService.log({
      action: 'INVENTORY_BATCH_CREATED',
      resource: 'InventoryBatch',
      resourceId: batch.id,
      userId,
      tenantId,
      newValues: {
        inventoryItemId: dto.inventoryItemId,
        batchNumber: dto.batchNumber,
        quantity: dto.quantity,
        expiryDate: dto.expiryDate,
      },
    });

    await this.cacheService.delete(tenantId, `item:${dto.inventoryItemId}`);
    await this.invalidateItemCache(tenantId);
    this.gateway.broadcastBatchUpdate(tenantId, 'batch.created', batch);

    return batch;
  }

  async getBatchesForItem(itemId: string, tenantId: string) {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: itemId, tenantId, deletedAt: null },
    });
    if (!item) throw new NotFoundException('Inventory item not found');

    return this.prisma.inventoryBatch.findMany({
      where: { inventoryItemId: itemId, tenantId },
      orderBy: { expiryDate: 'asc' },
    });
  }

  async getExpiringBatches(tenantId: string, days: number) {
    const now = new Date();
    const expiryThreshold = new Date();
    expiryThreshold.setDate(expiryThreshold.getDate() + days);

    const batches = await this.prisma.inventoryBatch.findMany({
      where: {
        tenantId,
        isActive: true,
        expiryDate: {
          not: null,
          gte: now,
          lte: expiryThreshold,
        },
        quantity: { gt: 0 },
      },
      include: {
        inventoryItem: { select: { id: true, name: true, sku: true, unit: true } },
      },
      orderBy: { expiryDate: 'asc' },
    });

    return batches;
  }

  async resolveExpirationAlert(alertId: string, tenantId: string) {
    const alert = await this.prisma.expirationAlert.findFirst({
      where: { id: alertId, tenantId },
    });
    if (!alert) throw new NotFoundException('Expiration alert not found');

    return this.prisma.expirationAlert.update({
      where: { id: alertId },
      data: { resolvedAt: new Date() },
    });
  }

  // ============================================
  // Low Stock Queries
  // ============================================

  async getLowStockItems(
    tenantId: string,
    page: number = PAGINATION_DEFAULTS.PAGE,
    limit: number = PAGINATION_DEFAULTS.LIMIT,
  ) {
    const where: Prisma.InventoryItemWhereInput = {
      tenantId,
      deletedAt: null,
      isActive: true,
      minStock: { not: null },
      currentQuantity: { lte: this.prisma.inventoryItem.fields.minStock },
    };
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.inventoryItem.findMany({
        where,
        skip,
        take: limit,
        include: { category: true, unit: true, location: true },
        orderBy: { currentQuantity: 'asc' },
      }),
      this.prisma.inventoryItem.count({ where }),
    ]);

    return buildPaginatedResponse(items, total, page, limit);
  }

  async getCriticalStockItems(
    tenantId: string,
    page: number = PAGINATION_DEFAULTS.PAGE,
    limit: number = PAGINATION_DEFAULTS.LIMIT,
  ) {
    const where: Prisma.InventoryItemWhereInput = {
      tenantId,
      deletedAt: null,
      isActive: true,
      reorderLevel: { not: null },
      currentQuantity: { lte: this.prisma.inventoryItem.fields.reorderLevel },
    };
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.inventoryItem.findMany({
        where,
        skip,
        take: limit,
        include: { category: true, unit: true, location: true },
        orderBy: { currentQuantity: 'asc' },
      }),
      this.prisma.inventoryItem.count({ where }),
    ]);

    return buildPaginatedResponse(items, total, page, limit);
  }

  async getOutOfStockItems(
    tenantId: string,
    page: number = PAGINATION_DEFAULTS.PAGE,
    limit: number = PAGINATION_DEFAULTS.LIMIT,
  ) {
    const where: Prisma.InventoryItemWhereInput = {
      tenantId,
      deletedAt: null,
      isActive: true,
      currentQuantity: { lte: 0 },
    };
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.inventoryItem.findMany({
        where,
        skip,
        take: limit,
        include: { category: true, unit: true, location: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.inventoryItem.count({ where }),
    ]);

    return buildPaginatedResponse(items, total, page, limit);
  }

  // ============================================
  // Cache Helpers
  // ============================================

  private async invalidateItemCache(tenantId: string) {
    await this.cacheService.deletePattern(tenantId, 'items:*');
    await this.cacheService.deletePattern(tenantId, 'item:*');
    await this.cacheService.deletePattern(tenantId, 'low-stock:*');
    await this.cacheService.deletePattern(tenantId, 'critical-stock:*');
    await this.cacheService.deletePattern(tenantId, 'out-of-stock:*');
  }

  private async invalidateCategoryCache(tenantId: string) {
    await this.cacheService.deletePattern(tenantId, 'categories:*');
  }

  private async invalidateUnitCache(tenantId: string) {
    await this.cacheService.deletePattern(tenantId, 'units:*');
  }

  private async invalidateLocationCache(tenantId: string) {
    await this.cacheService.deletePattern(tenantId, 'locations:*');
  }
}
