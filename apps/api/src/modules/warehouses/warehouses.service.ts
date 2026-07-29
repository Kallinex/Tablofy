import { Injectable, NotFoundException, ConflictException, BadRequestException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CacheService } from '../../common/services/cache.service';
import { QueueService } from '../queues/queue.service';
import { WarehousesGateway } from './warehouses.gateway';
import { Prisma } from '@prisma/client';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { QueryWarehouseDto } from './dto/query-warehouse.dto';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';
import { CreateBinDto } from './dto/create-bin.dto';
import { UpdateBinDto } from './dto/update-bin.dto';
import { CreateWarehouseBranchDto } from './dto/create-warehouse-branch.dto';

@Injectable()
export class WarehousesService {
  private readonly logger = new Logger(WarehousesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly cacheService: CacheService,
    private readonly queueService: QueueService,
    private readonly eventEmitter: EventEmitter2,
    private readonly gateway: WarehousesGateway,
  ) {}

  // ============================================
  // Warehouses — CRUD
  // ============================================

  async create(dto: CreateWarehouseDto, tenantId: string, userId: string) {
    const existing = await this.prisma.warehouse.findFirst({
      where: { tenantId, code: dto.code, deletedAt: null },
    });
    if (existing) throw new ConflictException('Warehouse with this code already exists');

    const warehouse = await this.prisma.warehouse.create({
      data: {
        tenantId,
        name: dto.name,
        code: dto.code,
        type: dto.type ?? 'BRANCH',
        status: dto.status ?? 'ACTIVE',
        address: dto.address,
        city: dto.city,
        country: dto.country,
        capacity: dto.capacity ? new Prisma.Decimal(dto.capacity) : undefined,
        capacityUnit: dto.capacityUnit,
        managerName: dto.managerName,
        branchId: dto.branchId,
        metadata: dto.metadata as Prisma.InputJsonValue ?? Prisma.DbNull,
      },
    });

    await this.auditLogsService.log({
      action: 'WAREHOUSE_CREATED',
      resource: 'Warehouse',
      resourceId: warehouse.id,
      userId,
      tenantId,
      newValues: { name: dto.name, code: dto.code, type: dto.type },
    });

    await this.invalidateListCache(tenantId);
    this.gateway.broadcastWarehouseUpdate(tenantId, 'warehouse.created', warehouse);

    return warehouse;
  }

  async findAll(tenantId: string, query: QueryWarehouseDto) {
    const cacheKey = `warehouses:list:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.WarehouseWhereInput = { tenantId, deletedAt: null };
    if (query.type) where.type = query.type;
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { code: { contains: query.search, mode: 'insensitive' } },
        { city: { contains: query.search, mode: 'insensitive' } },
        { country: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.warehouse.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { zones: true, bins: true, branches: true } },
        },
      }),
      this.prisma.warehouse.count({ where }),
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

  async findOne(id: string, tenantId: string) {
    const cacheKey = `warehouse:${id}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        zones: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } },
        bins: { where: { deletedAt: null } },
        branches: { include: { branch: true } },
      },
    });

    if (!warehouse) throw new NotFoundException('Warehouse not found');
    await this.cacheService.set(tenantId, cacheKey, warehouse, 300);
    return warehouse;
  }

  async update(id: string, dto: UpdateWarehouseDto, tenantId: string, userId: string) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!warehouse) throw new NotFoundException('Warehouse not found');

    if (dto.code && dto.code !== warehouse.code) {
      const existing = await this.prisma.warehouse.findFirst({
        where: { tenantId, code: dto.code, deletedAt: null },
      });
      if (existing) throw new ConflictException('Warehouse with this code already exists');
    }

    const updated = await this.prisma.warehouse.update({
      where: { id },
      data: {
        name: dto.name,
        code: dto.code,
        type: dto.type,
        status: dto.status,
        address: dto.address,
        city: dto.city,
        country: dto.country,
        capacity: dto.capacity !== undefined ? new Prisma.Decimal(dto.capacity) : undefined,
        capacityUnit: dto.capacityUnit,
        managerName: dto.managerName,
        managerId: dto.managerId,
        isDefault: dto.isDefault,
        branchId: dto.branchId,
        metadata: dto.metadata !== undefined ? dto.metadata as Prisma.InputJsonValue : undefined,
        version: { increment: 1 },
      },
    });

    await this.auditLogsService.log({
      action: 'WAREHOUSE_UPDATED',
      resource: 'Warehouse',
      resourceId: id,
      userId,
      tenantId,
      oldValues: warehouse as unknown as Record<string, unknown>,
      newValues: dto as unknown as Record<string, unknown>,
    });

    await this.invalidateCache(id, tenantId);
    this.gateway.broadcastWarehouseUpdate(tenantId, 'warehouse.updated', updated);

    return updated;
  }

  async remove(id: string, tenantId: string, userId: string) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!warehouse) throw new NotFoundException('Warehouse not found');

    await this.prisma.warehouse.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.auditLogsService.log({
      action: 'WAREHOUSE_DELETED',
      resource: 'Warehouse',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { name: warehouse.name, code: warehouse.code },
    });

    await this.invalidateCache(id, tenantId);
    this.gateway.broadcastWarehouseUpdate(tenantId, 'warehouse.deleted', { id });
  }

  async restore(id: string, tenantId: string, userId: string) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id, tenantId, deletedAt: { not: null } },
    });
    if (!warehouse) throw new NotFoundException('Deleted warehouse not found');

    await this.prisma.warehouse.update({
      where: { id },
      data: { deletedAt: null },
    });

    await this.auditLogsService.log({
      action: 'WAREHOUSE_RESTORED',
      resource: 'Warehouse',
      resourceId: id,
      userId,
      tenantId,
    });

    await this.invalidateCache(id, tenantId);
    this.gateway.broadcastWarehouseUpdate(tenantId, 'warehouse.restored', { id });
  }

  // ============================================
  // Set Default
  // ============================================

  async setDefault(id: string, tenantId: string, userId: string) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!warehouse) throw new NotFoundException('Warehouse not found');

    const [updated] = await this.prisma.$transaction([
      this.prisma.warehouse.updateMany({
        where: { tenantId, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      }),
      this.prisma.warehouse.update({
        where: { id },
        data: { isDefault: true, version: { increment: 1 } },
      }),
    ]);

    await this.auditLogsService.log({
      action: 'WAREHOUSE_SET_DEFAULT',
      resource: 'Warehouse',
      resourceId: id,
      userId,
      tenantId,
      newValues: { isDefault: true },
    });

    await this.invalidateCache(id, tenantId);
    this.gateway.broadcastWarehouseUpdate(tenantId, 'warehouse.updated', { id, isDefault: true });

    return updated;
  }

  // ============================================
  // Zones — CRUD
  // ============================================

  async createZone(warehouseId: string, dto: CreateZoneDto, tenantId: string, userId: string) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: warehouseId, tenantId, deletedAt: null },
    });
    if (!warehouse) throw new NotFoundException('Warehouse not found');

    const existing = await this.prisma.warehouseZone.findFirst({
      where: { warehouseId, code: dto.code, deletedAt: null },
    });
    if (existing) throw new ConflictException('Zone with this code already exists in this warehouse');

    const zone = await this.prisma.warehouseZone.create({
      data: {
        warehouseId,
        tenantId,
        name: dto.name,
        code: dto.code,
        type: dto.type ?? 'STORAGE',
        capacity: dto.capacity ? new Prisma.Decimal(dto.capacity) : undefined,
        capacityUnit: dto.capacityUnit,
        sortOrder: dto.sortOrder ?? 0,
      },
    });

    await this.auditLogsService.log({
      action: 'WAREHOUSE_ZONE_CREATED',
      resource: 'WarehouseZone',
      resourceId: zone.id,
      userId,
      tenantId,
      newValues: { name: dto.name, code: dto.code, warehouseId },
    });

    await this.invalidateCache(warehouseId, tenantId);
    this.gateway.broadcastZoneUpdate(tenantId, 'zone.created', zone);

    return zone;
  }

  async findZones(warehouseId: string, tenantId: string) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: warehouseId, tenantId, deletedAt: null },
    });
    if (!warehouse) throw new NotFoundException('Warehouse not found');

    const cacheKey = `warehouse:${warehouseId}:zones`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const zones = await this.prisma.warehouseZone.findMany({
      where: { warehouseId, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
      include: { _count: { select: { bins: true } } },
    });

    await this.cacheService.set(tenantId, cacheKey, zones, 300);
    return zones;
  }

  async updateZone(id: string, dto: UpdateZoneDto, tenantId: string, userId: string) {
    const zone = await this.prisma.warehouseZone.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!zone) throw new NotFoundException('Zone not found');

    if (dto.code && dto.code !== zone.code) {
      const existing = await this.prisma.warehouseZone.findFirst({
        where: { warehouseId: zone.warehouseId, code: dto.code, deletedAt: null },
      });
      if (existing) throw new ConflictException('Zone with this code already exists');
    }

    const updated = await this.prisma.warehouseZone.update({
      where: { id },
      data: {
        name: dto.name,
        code: dto.code,
        type: dto.type,
        capacity: dto.capacity !== undefined ? new Prisma.Decimal(dto.capacity) : undefined,
        capacityUnit: dto.capacityUnit,
        isActive: dto.isActive,
        sortOrder: dto.sortOrder,
        metadata: dto.metadata !== undefined ? dto.metadata as Prisma.InputJsonValue : undefined,
        version: { increment: 1 },
      },
    });

    await this.auditLogsService.log({
      action: 'WAREHOUSE_ZONE_UPDATED',
      resource: 'WarehouseZone',
      resourceId: id,
      userId,
      tenantId,
      oldValues: zone as unknown as Record<string, unknown>,
      newValues: dto as unknown as Record<string, unknown>,
    });

    await this.invalidateCache(zone.warehouseId, tenantId);
    this.gateway.broadcastZoneUpdate(tenantId, 'zone.updated', updated);

    return updated;
  }

  async deleteZone(id: string, tenantId: string, userId: string) {
    const zone = await this.prisma.warehouseZone.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!zone) throw new NotFoundException('Zone not found');

    await this.prisma.warehouseZone.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.auditLogsService.log({
      action: 'WAREHOUSE_ZONE_DELETED',
      resource: 'WarehouseZone',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { name: zone.name, code: zone.code },
    });

    await this.invalidateCache(zone.warehouseId, tenantId);
    this.gateway.broadcastZoneUpdate(tenantId, 'zone.deleted', { id });
  }

  // ============================================
  // Bins — CRUD
  // ============================================

  async createBin(warehouseId: string, dto: CreateBinDto, tenantId: string, userId: string) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: warehouseId, tenantId, deletedAt: null },
    });
    if (!warehouse) throw new NotFoundException('Warehouse not found');

    if (dto.zoneId) {
      const zone = await this.prisma.warehouseZone.findFirst({
        where: { id: dto.zoneId, warehouseId, deletedAt: null },
      });
      if (!zone) throw new NotFoundException('Zone not found in this warehouse');
    }

    const existing = await this.prisma.storageBin.findFirst({
      where: { warehouseId, code: dto.code, deletedAt: null },
    });
    if (existing) throw new ConflictException('Bin with this code already exists in this warehouse');

    const bin = await this.prisma.storageBin.create({
      data: {
        zoneId: dto.zoneId,
        warehouseId,
        tenantId,
        name: dto.name,
        code: dto.code,
        type: dto.type ?? 'BIN',
        capacity: dto.capacity ? new Prisma.Decimal(dto.capacity) : undefined,
        capacityUnit: dto.capacityUnit,
        maxWeight: dto.maxWeight ? new Prisma.Decimal(dto.maxWeight) : undefined,
        length: dto.length ? new Prisma.Decimal(dto.length) : undefined,
        width: dto.width ? new Prisma.Decimal(dto.width) : undefined,
        height: dto.height ? new Prisma.Decimal(dto.height) : undefined,
      },
    });

    await this.auditLogsService.log({
      action: 'STORAGE_BIN_CREATED',
      resource: 'StorageBin',
      resourceId: bin.id,
      userId,
      tenantId,
      newValues: { name: dto.name, code: dto.code, zoneId: dto.zoneId },
    });

    await this.invalidateCache(warehouseId, tenantId);
    this.gateway.broadcastBinUpdate(tenantId, 'bin.created', bin);

    return bin;
  }

  async findBins(warehouseId: string, tenantId: string, zoneId?: string) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: warehouseId, tenantId, deletedAt: null },
    });
    if (!warehouse) throw new NotFoundException('Warehouse not found');

    const cacheKey = `warehouse:${warehouseId}:bins:${zoneId ?? 'all'}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const where: Prisma.StorageBinWhereInput = { warehouseId, tenantId, deletedAt: null };
    if (zoneId) where.zoneId = zoneId;

    const bins = await this.prisma.storageBin.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { zone: true },
    });

    await this.cacheService.set(tenantId, cacheKey, bins, 300);
    return bins;
  }

  async updateBin(id: string, dto: UpdateBinDto, tenantId: string, userId: string) {
    const bin = await this.prisma.storageBin.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!bin) throw new NotFoundException('Bin not found');

    if (dto.code && dto.code !== bin.code) {
      const existing = await this.prisma.storageBin.findFirst({
        where: { warehouseId: bin.warehouseId, code: dto.code, deletedAt: null },
      });
      if (existing) throw new ConflictException('Bin with this code already exists');
    }

    const updated = await this.prisma.storageBin.update({
      where: { id },
      data: {
        zoneId: dto.zoneId,
        name: dto.name,
        code: dto.code,
        type: dto.type,
        status: dto.status,
        capacity: dto.capacity !== undefined ? new Prisma.Decimal(dto.capacity) : undefined,
        capacityUnit: dto.capacityUnit,
        currentLoad: dto.currentLoad !== undefined ? new Prisma.Decimal(dto.currentLoad) : undefined,
        maxWeight: dto.maxWeight !== undefined ? new Prisma.Decimal(dto.maxWeight) : undefined,
        length: dto.length !== undefined ? new Prisma.Decimal(dto.length) : undefined,
        width: dto.width !== undefined ? new Prisma.Decimal(dto.width) : undefined,
        height: dto.height !== undefined ? new Prisma.Decimal(dto.height) : undefined,
        isActive: dto.isActive,
        metadata: dto.metadata !== undefined ? dto.metadata as Prisma.InputJsonValue : undefined,
        version: { increment: 1 },
      },
    });

    await this.auditLogsService.log({
      action: 'STORAGE_BIN_UPDATED',
      resource: 'StorageBin',
      resourceId: id,
      userId,
      tenantId,
      oldValues: bin as unknown as Record<string, unknown>,
      newValues: dto as unknown as Record<string, unknown>,
    });

    await this.invalidateCache(bin.warehouseId, tenantId);
    this.gateway.broadcastBinUpdate(tenantId, 'bin.updated', updated);

    return updated;
  }

  async deleteBin(id: string, tenantId: string, userId: string) {
    const bin = await this.prisma.storageBin.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!bin) throw new NotFoundException('Bin not found');

    await this.prisma.storageBin.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.auditLogsService.log({
      action: 'STORAGE_BIN_DELETED',
      resource: 'StorageBin',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { name: bin.name, code: bin.code },
    });

    await this.invalidateCache(bin.warehouseId, tenantId);
    this.gateway.broadcastBinUpdate(tenantId, 'bin.deleted', { id });
  }

  // ============================================
  // Warehouse-Branch Mapping
  // ============================================

  async addBranch(warehouseId: string, dto: CreateWarehouseBranchDto, tenantId: string, userId: string) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: warehouseId, tenantId, deletedAt: null },
    });
    if (!warehouse) throw new NotFoundException('Warehouse not found');

    const branch = await this.prisma.branch.findFirst({
      where: { id: dto.branchId, tenantId, deletedAt: null },
    });
    if (!branch) throw new NotFoundException('Branch not found');

    const existing = await this.prisma.warehouseBranch.findFirst({
      where: { warehouseId, branchId: dto.branchId },
    });
    if (existing) throw new ConflictException('Branch already mapped to this warehouse');

    const mapping = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.warehouseBranch.updateMany({
          where: { warehouseId, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.warehouseBranch.create({
        data: {
          warehouseId,
          branchId: dto.branchId,
          tenantId,
          isDefault: dto.isDefault ?? false,
        },
      });
    });

    await this.auditLogsService.log({
      action: 'WAREHOUSE_BRANCH_ADDED',
      resource: 'WarehouseBranch',
      resourceId: mapping.id,
      userId,
      tenantId,
      newValues: { warehouseId, branchId: dto.branchId },
    });

    await this.invalidateCache(warehouseId, tenantId);
    this.gateway.broadcastWarehouseUpdate(tenantId, 'warehouse.updated', { id: warehouseId });

    return mapping;
  }

  async findBranches(warehouseId: string, tenantId: string) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: warehouseId, tenantId, deletedAt: null },
    });
    if (!warehouse) throw new NotFoundException('Warehouse not found');

    const cacheKey = `warehouse:${warehouseId}:branches`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const branches = await this.prisma.warehouseBranch.findMany({
      where: { warehouseId },
      include: { branch: true },
    });

    await this.cacheService.set(tenantId, cacheKey, branches, 300);
    return branches;
  }

  async removeBranch(warehouseId: string, branchId: string, tenantId: string, userId: string) {
    const mapping = await this.prisma.warehouseBranch.findFirst({
      where: { warehouseId, branchId },
    });
    if (!mapping) throw new NotFoundException('Branch mapping not found');

    await this.prisma.warehouseBranch.delete({
      where: { warehouseId_branchId: { warehouseId, branchId } },
    });

    await this.auditLogsService.log({
      action: 'WAREHOUSE_BRANCH_REMOVED',
      resource: 'WarehouseBranch',
      resourceId: mapping.id,
      userId,
      tenantId,
      oldValues: { warehouseId, branchId },
    });

    await this.invalidateCache(warehouseId, tenantId);
    this.gateway.broadcastWarehouseUpdate(tenantId, 'warehouse.updated', { id: warehouseId });
  }

  // ============================================
  // Stats
  // ============================================

  async getStats(id: string, tenantId: string) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!warehouse) throw new NotFoundException('Warehouse not found');

    const cacheKey = `warehouse:${id}:stats`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const [totalBins, occupiedBins, maintenanceBins, totalZones, branchCount, capacityData] =
      await Promise.all([
        this.prisma.storageBin.count({
          where: { warehouseId: id, tenantId, deletedAt: null },
        }),
        this.prisma.storageBin.count({
          where: { warehouseId: id, tenantId, deletedAt: null, status: 'OCCUPIED' },
        }),
        this.prisma.storageBin.count({
          where: { warehouseId: id, tenantId, deletedAt: null, status: 'MAINTENANCE' },
        }),
        this.prisma.warehouseZone.count({
          where: { warehouseId: id, tenantId, deletedAt: null },
        }),
        this.prisma.warehouseBranch.count({
          where: { warehouseId: id },
        }),
        this.prisma.storageBin.aggregate({
          where: { warehouseId: id, tenantId, deletedAt: null },
          _sum: { currentLoad: true, capacity: true },
        }),
      ]);

    const totalCapacity = capacityData._sum.capacity ?? new Prisma.Decimal(0);
    const totalLoad = capacityData._sum.currentLoad ?? new Prisma.Decimal(0);
    const capacityUsage = totalCapacity.gt(0)
      ? Number(totalLoad.div(totalCapacity).mul(100).toFixed(2))
      : 0;

    const stats = {
      warehouseId: id,
      totalBins,
      occupiedBins,
      availableBins: totalBins - occupiedBins - maintenanceBins,
      maintenanceBins,
      totalZones,
      branchCount,
      totalCapacity: Number(totalCapacity),
      totalCurrentLoad: Number(totalLoad),
      capacityUsagePercent: capacityUsage,
    };

    await this.cacheService.set(tenantId, cacheKey, stats, 120);
    return stats;
  }

  // ============================================
  // Cache Helpers
  // ============================================

  private async invalidateCache(id: string, tenantId: string) {
    await this.cacheService.delete(tenantId, `warehouse:${id}`);
    await this.cacheService.delete(tenantId, `warehouse:${id}:zones`);
    await this.cacheService.delete(tenantId, `warehouse:${id}:bins:all`);
    await this.cacheService.delete(tenantId, `warehouse:${id}:branches`);
    await this.cacheService.delete(tenantId, `warehouse:${id}:stats`);
    await this.invalidateListCache(tenantId);
  }

  private async invalidateListCache(tenantId: string) {
    await this.cacheService.deletePattern(tenantId, 'warehouses:*');
  }
}
