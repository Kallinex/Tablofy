import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { WarehousesService } from '../warehouses.service';
import { WarehousesGateway } from '../warehouses.gateway';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { QueueService } from '../../queues/queue.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockCache, MockCache } from '../../../test/mocks/cache.mock';
import { createMockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';
import { CreateWarehouseDto } from '../dto/create-warehouse.dto';
import { UpdateWarehouseDto } from '../dto/update-warehouse.dto';
import { QueryWarehouseDto } from '../dto/query-warehouse.dto';
import { CreateZoneDto } from '../dto/create-zone.dto';
import { UpdateZoneDto } from '../dto/update-zone.dto';
import { CreateBinDto } from '../dto/create-bin.dto';
import { UpdateBinDto } from '../dto/update-bin.dto';
import { CreateWarehouseBranchDto } from '../dto/create-warehouse-branch.dto';

const userId = 'user-1';
const asDto = <T>(value: Record<string, unknown>) => value as unknown as T;

describe('WarehousesService', () => {
  let service: WarehousesService;
  let prisma: MockPrisma;
  let audit: MockAuditLogs;
  let cache: MockCache;
  let gateway: {
    broadcastWarehouseUpdate: jest.Mock;
    broadcastZoneUpdate: jest.Mock;
    broadcastBinUpdate: jest.Mock;
  };

  beforeAll(async () => {
    gateway = {
      broadcastWarehouseUpdate: jest.fn(),
      broadcastZoneUpdate: jest.fn(),
      broadcastBinUpdate: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WarehousesService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: CacheService, useValue: createMockCache() },
        { provide: QueueService, useValue: {} },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
        { provide: WarehousesGateway, useValue: gateway },
      ],
    }).compile();

    service = module.get<WarehousesService>(WarehousesService);
    prisma = module.get(PrismaService) as MockPrisma;
    audit = module.get(AuditLogsService) as MockAuditLogs;
    cache = module.get(CacheService) as MockCache;
  });

  beforeEach(() => {
    prisma.reset();
    audit.reset();
    cache.reset();
    jest.clearAllMocks();
    cache.get.mockResolvedValue(null);
    cache.set.mockResolvedValue(undefined);
    cache.delete.mockResolvedValue(undefined);
    cache.deletePattern.mockResolvedValue(undefined);
  });

  const warehouse = {
    id: 'w-1',
    tenantId: testTenantId,
    name: 'Main',
    code: 'W1',
    deletedAt: null,
  };

  describe('create', () => {
    it('rejects a duplicate code within the tenant', async () => {
      prisma.warehouse.findFirst.mockResolvedValue(warehouse);

      await expect(
        service.create(asDto<CreateWarehouseDto>({ name: 'x', code: 'W1' }), testTenantId, userId),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.warehouse.create).not.toHaveBeenCalled();
    });

    it('persists defaults, audits, invalidates caches and broadcasts', async () => {
      prisma.warehouse.findFirst.mockResolvedValue(null);
      prisma.warehouse.create.mockResolvedValue({ ...warehouse, id: 'w-9' });

      const result = await service.create(
        asDto<CreateWarehouseDto>({ name: 'Hub', code: 'H1', capacity: 500 }),
        testTenantId,
        userId,
      );

      const data = prisma.warehouse.create.mock.calls[0][0].data;
      expect(data.type).toBe('BRANCH');
      expect(data.status).toBe('ACTIVE');
      expect(data.metadata).toBe(Prisma.DbNull);
      expect(result.id).toBe('w-9');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'WAREHOUSE_CREATED', resourceId: 'w-9' }),
      );
      expect(cache.deletePattern).toHaveBeenCalledWith(testTenantId, 'warehouses:*');
      expect(gateway.broadcastWarehouseUpdate).toHaveBeenCalledWith(
        testTenantId,
        'warehouse.created',
        expect.objectContaining({ id: 'w-9' }),
      );
    });
  });

  describe('findAll', () => {
    it('returns the cached page', async () => {
      const cached = { data: [], meta: {} };
      cache.get.mockResolvedValue(cached);

      expect(await service.findAll(testTenantId, {} as QueryWarehouseDto)).toBe(cached);
      expect(prisma.warehouse.findMany).not.toHaveBeenCalled();
    });

    it('applies tenant scope, search and pagination', async () => {
      prisma.warehouse.findMany.mockResolvedValue([warehouse]);
      prisma.warehouse.count.mockResolvedValue(21);

      const result = await service.findAll(
        testTenantId,
        asDto<QueryWarehouseDto>({
          page: 2,
          limit: 10,
          type: 'BRANCH',
          status: 'ACTIVE',
          search: 'mai',
        }),
      );

      const where = prisma.warehouse.findMany.mock.calls[0][0].where;
      expect(where.tenantId).toBe(testTenantId);
      expect(where.deletedAt).toBeNull();
      expect(where.type).toBe('BRANCH');
      expect(where.status).toBe('ACTIVE');
      expect(where.OR).toHaveLength(4);
      expect(result.meta).toEqual({
        total: 21,
        page: 2,
        limit: 10,
        totalPages: 3,
        hasNext: true,
        hasPrevious: true,
      });
    });

    it('caches the list for 120 seconds', async () => {
      prisma.warehouse.findMany.mockResolvedValue([]);
      prisma.warehouse.count.mockResolvedValue(0);

      await service.findAll(testTenantId, {} as QueryWarehouseDto);

      expect(cache.set).toHaveBeenCalledWith(
        testTenantId,
        expect.stringContaining('warehouses:list'),
        expect.any(Object),
        120,
      );
    });
  });

  describe('findOne', () => {
    it('throws when the warehouse is missing or soft-deleted', async () => {
      prisma.warehouse.findFirst.mockResolvedValue(null);

      await expect(service.findOne('w-1', testTenantId)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.warehouse.findFirst.mock.calls[0][0].where).toEqual({
        id: 'w-1',
        tenantId: testTenantId,
        deletedAt: null,
      });
    });

    it('returns and caches the warehouse with its zones and branches', async () => {
      prisma.warehouse.findFirst.mockResolvedValue(warehouse);

      const result = await service.findOne('w-1', testTenantId);

      expect(result).toBe(warehouse);
      expect(cache.set).toHaveBeenCalledWith(testTenantId, 'warehouse:w-1', warehouse, 300);
    });
  });

  describe('update', () => {
    it('throws when not found', async () => {
      prisma.warehouse.findFirst.mockResolvedValue(null);

      await expect(
        service.update('w-1', {} as UpdateWarehouseDto, testTenantId, userId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects renaming to another warehouse code', async () => {
      prisma.warehouse.findFirst
        .mockResolvedValueOnce(warehouse) // lookup by id
        .mockResolvedValueOnce({ id: 'w-2' }); // clashing code

      await expect(
        service.update('w-1', asDto<UpdateWarehouseDto>({ code: 'W2' }), testTenantId, userId),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('increments the version and invalidates every dependent cache', async () => {
      prisma.warehouse.findFirst.mockResolvedValue(warehouse);
      prisma.warehouse.update.mockResolvedValue({ ...warehouse, name: 'Renamed' });

      await service.update(
        'w-1',
        asDto<UpdateWarehouseDto>({ name: 'Renamed' }),
        testTenantId,
        userId,
      );

      expect(prisma.warehouse.update.mock.calls[0][0].data.version).toEqual({ increment: 1 });
      expect(cache.delete).toHaveBeenCalledWith(testTenantId, 'warehouse:w-1');
      expect(cache.delete).toHaveBeenCalledWith(testTenantId, 'warehouse:w-1:zones');
      expect(gateway.broadcastWarehouseUpdate).toHaveBeenCalledWith(
        testTenantId,
        'warehouse.updated',
        expect.any(Object),
      );
    });
  });

  describe('remove / restore', () => {
    it('soft-deletes and broadcasts', async () => {
      prisma.warehouse.findFirst.mockResolvedValue(warehouse);
      prisma.warehouse.update.mockResolvedValue({ ...warehouse, deletedAt: new Date() });

      await service.remove('w-1', testTenantId, userId);

      expect(prisma.warehouse.update.mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date);
      expect(gateway.broadcastWarehouseUpdate).toHaveBeenCalledWith(
        testTenantId,
        'warehouse.deleted',
        {
          id: 'w-1',
        },
      );
    });

    it('restores a soft-deleted warehouse', async () => {
      prisma.warehouse.findFirst.mockResolvedValue({ ...warehouse, deletedAt: new Date() });
      prisma.warehouse.update.mockResolvedValue(warehouse);

      await service.restore('w-1', testTenantId, userId);

      expect(prisma.warehouse.findFirst.mock.calls[0][0].where.deletedAt).toEqual({ not: null });
      expect(prisma.warehouse.update.mock.calls[0][0].data.deletedAt).toBeNull();
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'WAREHOUSE_RESTORED' }),
      );
    });
  });

  describe('setDefault', () => {
    it('clears the previous default and flags the new one inside a transaction', async () => {
      prisma.warehouse.findFirst.mockResolvedValue(warehouse);
      prisma.$transaction.mockResolvedValue([{ count: 1 }, { ...warehouse, isDefault: true }]);

      const result = await service.setDefault('w-1', testTenantId, userId);

      expect(prisma.warehouse.updateMany).toHaveBeenCalledWith({
        where: { tenantId: testTenantId, isDefault: true, id: { not: 'w-1' } },
        data: { isDefault: false },
      });
      expect(result).toEqual({ ...warehouse, isDefault: true });
      expect(gateway.broadcastWarehouseUpdate).toHaveBeenCalledWith(
        testTenantId,
        'warehouse.updated',
        {
          id: 'w-1',
          isDefault: true,
        },
      );
    });
  });

  describe('zones', () => {
    it('createZone rejects duplicate codes within the warehouse', async () => {
      prisma.warehouse.findFirst.mockResolvedValue(warehouse);
      prisma.warehouseZone.findFirst.mockResolvedValue({ id: 'z-1' });

      await expect(
        service.createZone(
          'w-1',
          asDto<CreateZoneDto>({ name: 'A', code: 'Z1' }),
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('createZone applies the STORAGE default and broadcasts', async () => {
      prisma.warehouse.findFirst.mockResolvedValue(warehouse);
      prisma.warehouseZone.findFirst.mockResolvedValue(null);
      prisma.warehouseZone.create.mockResolvedValue({ id: 'z-9' });

      await service.createZone(
        'w-1',
        asDto<CreateZoneDto>({ name: 'Cold', code: 'Z1' }),
        testTenantId,
        userId,
      );

      expect(prisma.warehouseZone.create.mock.calls[0][0].data.type).toBe('STORAGE');
      expect(gateway.broadcastZoneUpdate).toHaveBeenCalledWith(
        testTenantId,
        'zone.created',
        expect.objectContaining({ id: 'z-9' }),
      );
    });

    it('findZones verifies ownership then caches', async () => {
      prisma.warehouse.findFirst.mockResolvedValue(warehouse);
      prisma.warehouseZone.findMany.mockResolvedValue([{ id: 'z-1' }]);

      const result = await service.findZones('w-1', testTenantId);

      expect(result).toEqual([{ id: 'z-1' }]);
      expect(cache.set).toHaveBeenCalledWith(testTenantId, 'warehouse:w-1:zones', result, 300);
    });

    it('findZones throws when the warehouse does not belong to the tenant', async () => {
      prisma.warehouse.findFirst.mockResolvedValue(null);

      await expect(service.findZones('w-1', testTenantId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.warehouseZone.findMany).not.toHaveBeenCalled();
    });

    it('updateZone rejects a clashing code but allows keeping the same one', async () => {
      prisma.warehouseZone.findFirst
        .mockResolvedValueOnce({ id: 'z-1', warehouseId: 'w-1', code: 'Z1' })
        .mockResolvedValueOnce({ id: 'z-2' });

      await expect(
        service.updateZone('z-1', asDto<UpdateZoneDto>({ code: 'Z2' }), testTenantId, userId),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('deleteZone soft-deletes and invalidates the warehouse', async () => {
      prisma.warehouseZone.findFirst.mockResolvedValue({
        id: 'z-1',
        warehouseId: 'w-1',
        name: 'A',
        code: 'Z1',
      });
      prisma.warehouseZone.update.mockResolvedValue({});

      await service.deleteZone('z-1', testTenantId, userId);

      expect(prisma.warehouseZone.update.mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date);
      expect(cache.delete).toHaveBeenCalledWith(testTenantId, 'warehouse:w-1');
    });
  });

  describe('bins', () => {
    it('createBin rejects a zone from another warehouse', async () => {
      prisma.warehouse.findFirst.mockResolvedValue(warehouse);
      prisma.warehouseZone.findFirst.mockResolvedValue(null);

      await expect(
        service.createBin(
          'w-1',
          asDto<CreateBinDto>({ name: 'B', code: 'B1', zoneId: 'z-x' }),
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('createBin defaults the type and broadcasts', async () => {
      prisma.warehouse.findFirst.mockResolvedValue(warehouse);
      prisma.storageBin.findFirst.mockResolvedValue(null);
      prisma.storageBin.create.mockResolvedValue({ id: 'b-9' });

      await service.createBin(
        'w-1',
        asDto<CreateBinDto>({ name: 'Bin', code: 'B1' }),
        testTenantId,
        userId,
      );

      expect(prisma.storageBin.create.mock.calls[0][0].data.type).toBe('BIN');
      expect(gateway.broadcastBinUpdate).toHaveBeenCalledWith(
        testTenantId,
        'bin.created',
        expect.objectContaining({ id: 'b-9' }),
      );
    });

    it('findBins uses a zone-specific cache key', async () => {
      prisma.warehouse.findFirst.mockResolvedValue(warehouse);
      prisma.storageBin.findMany.mockResolvedValue([]);

      await service.findBins('w-1', testTenantId, 'z-1');

      expect(cache.set).toHaveBeenCalledWith(testTenantId, 'warehouse:w-1:bins:z-1', [], 300);
      expect(prisma.storageBin.findMany.mock.calls[0][0].where.zoneId).toBe('z-1');
    });

    it('findBins defaults to the all key when no zone is given', async () => {
      prisma.warehouse.findFirst.mockResolvedValue(warehouse);
      prisma.storageBin.findMany.mockResolvedValue([]);

      await service.findBins('w-1', testTenantId);

      expect(cache.set).toHaveBeenCalledWith(testTenantId, 'warehouse:w-1:bins:all', [], 300);
    });

    it('updateBin increments the version and invalidates zone-cached bin lists', async () => {
      prisma.storageBin.findFirst.mockResolvedValue({ id: 'b-1', warehouseId: 'w-1', code: 'B1' });
      prisma.storageBin.update.mockResolvedValue({ id: 'b-1' });

      await service.updateBin('b-1', asDto<UpdateBinDto>({ name: 'x' }), testTenantId, userId);

      expect(prisma.storageBin.update.mock.calls[0][0].data.version).toEqual({ increment: 1 });
      // zone-filtered bin caches must be cleared too
      expect(cache.deletePattern).toHaveBeenCalledWith(testTenantId, 'warehouse:w-1:bins:*');
    });

    it('deleteBin soft-deletes and broadcasts', async () => {
      prisma.storageBin.findFirst.mockResolvedValue({
        id: 'b-1',
        warehouseId: 'w-1',
        name: 'B',
        code: 'B1',
      });
      prisma.storageBin.update.mockResolvedValue({});

      await service.deleteBin('b-1', testTenantId, userId);

      expect(prisma.storageBin.update.mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date);
      expect(gateway.broadcastBinUpdate).toHaveBeenCalledWith(testTenantId, 'bin.deleted', {
        id: 'b-1',
      });
    });
  });

  describe('branch mappings', () => {
    it('addBranch verifies both the warehouse and the branch', async () => {
      prisma.warehouse.findFirst.mockResolvedValue(warehouse);
      prisma.branch.findFirst.mockResolvedValue(null);

      await expect(
        service.addBranch(
          'w-1',
          asDto<CreateWarehouseBranchDto>({ branchId: 'br-1' }),
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('addBranch refuses a duplicate mapping', async () => {
      prisma.warehouse.findFirst.mockResolvedValue(warehouse);
      prisma.branch.findFirst.mockResolvedValue({ id: 'br-1' });
      prisma.warehouseBranch.findFirst.mockResolvedValue({ id: 'wb-1' });

      await expect(
        service.addBranch(
          'w-1',
          asDto<CreateWarehouseBranchDto>({ branchId: 'br-1' }),
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('addBranch clears the previous default inside the transaction', async () => {
      prisma.warehouse.findFirst.mockResolvedValue(warehouse);
      prisma.branch.findFirst.mockResolvedValue({ id: 'br-1' });
      prisma.warehouseBranch.findFirst.mockResolvedValue(null);
      prisma.$transaction.mockImplementation(async (fn: (tx: MockPrisma) => unknown) => fn(prisma));
      prisma.warehouseBranch.create.mockResolvedValue({ id: 'wb-9' });

      await service.addBranch(
        'w-1',
        asDto<CreateWarehouseBranchDto>({ branchId: 'br-1', isDefault: true }),
        testTenantId,
        userId,
      );

      expect(prisma.warehouseBranch.updateMany).toHaveBeenCalledWith({
        where: { warehouseId: 'w-1', isDefault: true },
        data: { isDefault: false },
      });
      expect(prisma.warehouseBranch.create).toHaveBeenCalledWith({
        data: { warehouseId: 'w-1', branchId: 'br-1', tenantId: testTenantId, isDefault: true },
      });
    });

    it('findBranches scopes by tenant after verifying ownership', async () => {
      prisma.warehouse.findFirst.mockResolvedValue(warehouse);
      prisma.warehouseBranch.findMany.mockResolvedValue([]);

      await service.findBranches('w-1', testTenantId);

      expect(prisma.warehouseBranch.findMany.mock.calls[0][0].where).toEqual({
        warehouseId: 'w-1',
        tenantId: testTenantId,
      });
    });

    it('removeBranch scopes the lookup by tenant so cross-tenant ids cannot delete', async () => {
      prisma.warehouseBranch.findFirst.mockResolvedValue(null);

      await expect(
        service.removeBranch('w-1', 'br-1', testTenantId, userId),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.warehouseBranch.findFirst.mock.calls[0][0].where).toEqual({
        warehouseId: 'w-1',
        branchId: 'br-1',
        tenantId: testTenantId,
      });
      expect(prisma.warehouseBranch.delete).not.toHaveBeenCalled();
    });

    it('removeBranch deletes the compound key when owned by the tenant', async () => {
      prisma.warehouseBranch.findFirst.mockResolvedValue({ id: 'wb-1' });
      prisma.warehouseBranch.delete.mockResolvedValue({});

      await service.removeBranch('w-1', 'br-1', testTenantId, userId);

      expect(prisma.warehouseBranch.delete).toHaveBeenCalledWith({
        where: { warehouseId_branchId: { warehouseId: 'w-1', branchId: 'br-1' } },
      });
    });
  });

  describe('getStats', () => {
    it('computes capacity usage and available bins', async () => {
      prisma.warehouse.findFirst.mockResolvedValue(warehouse);
      prisma.storageBin.count
        .mockResolvedValueOnce(10) // totalBins
        .mockResolvedValueOnce(4) // occupied
        .mockResolvedValueOnce(1); // maintenance
      prisma.warehouseZone.count.mockResolvedValue(3);
      prisma.warehouseBranch.count.mockResolvedValue(2);
      prisma.storageBin.aggregate.mockResolvedValue({
        _sum: { currentLoad: new Prisma.Decimal(25), capacity: new Prisma.Decimal(100) },
      });

      const result = await service.getStats('w-1', testTenantId);

      expect(result).toEqual({
        warehouseId: 'w-1',
        totalBins: 10,
        occupiedBins: 4,
        availableBins: 5,
        maintenanceBins: 1,
        totalZones: 3,
        branchCount: 2,
        totalCapacity: 100,
        totalCurrentLoad: 25,
        capacityUsagePercent: 25,
      });
      expect(cache.set).toHaveBeenCalledWith(testTenantId, 'warehouse:w-1:stats', result, 120);
    });

    it('reports zero usage when capacity is zero instead of dividing by zero', async () => {
      prisma.warehouse.findFirst.mockResolvedValue(warehouse);
      prisma.storageBin.count.mockResolvedValue(0);
      prisma.warehouseZone.count.mockResolvedValue(0);
      prisma.warehouseBranch.count.mockResolvedValue(0);
      prisma.storageBin.aggregate.mockResolvedValue({
        _sum: { currentLoad: null, capacity: null },
      });

      const result = await service.getStats('w-1', testTenantId);

      expect(result.capacityUsagePercent).toBe(0);
      expect(result.totalCapacity).toBe(0);
    });

    it('throws when the warehouse is missing', async () => {
      prisma.warehouse.findFirst.mockResolvedValue(null);

      await expect(service.getStats('w-1', testTenantId)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('serves cached stats without hitting the database', async () => {
      prisma.warehouse.findFirst.mockResolvedValue(warehouse);
      const cached = { warehouseId: 'w-1' };
      cache.get.mockResolvedValue(cached);

      expect(await service.getStats('w-1', testTenantId)).toBe(cached);
      expect(prisma.storageBin.count).not.toHaveBeenCalled();
    });
  });
});
