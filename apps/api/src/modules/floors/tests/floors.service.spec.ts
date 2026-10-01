import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { FloorsService } from '../floors.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockEventEmitter, MockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';
import { CreateFloorDto } from '../dto/create-floor.dto';
import { UpdateFloorDto } from '../dto/update-floor.dto';

const userId = 'user-1';
const restaurantId = 'r-1';
const branchId = 'br-1';
const asDto = <T>(value: Record<string, unknown>) => value as unknown as T;

describe('FloorsService', () => {
  let service: FloorsService;
  let prisma: MockPrisma;
  let audit: MockAuditLogs;
  let events: MockEventEmitter;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FloorsService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
      ],
    }).compile();

    service = module.get<FloorsService>(FloorsService);
    prisma = module.get(PrismaService) as MockPrisma;
    audit = module.get(AuditLogsService) as MockAuditLogs;
    events = module.get(EventEmitter2) as unknown as MockEventEmitter;
  });

  beforeEach(() => {
    prisma.reset();
    audit.reset();
    events.reset();
  });

  const floor = {
    id: 'f-1',
    tenantId: testTenantId,
    restaurantId,
    branchId,
    name: 'Ground',
    level: 1,
    isActive: true,
    deletedAt: null,
  };

  describe('create', () => {
    it('requires the restaurant to belong to the tenant', async () => {
      prisma.restaurant.findFirst.mockResolvedValue(null);

      await expect(
        service.create(
          asDto<CreateFloorDto>({ name: 'Ground' }),
          restaurantId,
          branchId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('requires the branch to belong to the restaurant and tenant', async () => {
      prisma.restaurant.findFirst.mockResolvedValue({ id: restaurantId });
      prisma.branch.findFirst.mockResolvedValue(null);

      await expect(
        service.create(
          asDto<CreateFloorDto>({ name: 'Ground' }),
          restaurantId,
          branchId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.branch.findFirst.mock.calls[0][0].where).toMatchObject({
        id: branchId,
        restaurantId,
        tenantId: testTenantId,
      });
    });

    it('rejects a duplicate name within the branch', async () => {
      prisma.restaurant.findFirst.mockResolvedValue({ id: restaurantId });
      prisma.branch.findFirst.mockResolvedValue({ id: branchId });
      prisma.floor.findFirst.mockResolvedValue(floor);

      await expect(
        service.create(
          asDto<CreateFloorDto>({ name: 'Ground' }),
          restaurantId,
          branchId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('applies defaults and emits on success', async () => {
      prisma.restaurant.findFirst.mockResolvedValue({ id: restaurantId });
      prisma.branch.findFirst.mockResolvedValue({ id: branchId });
      prisma.floor.findFirst.mockResolvedValue(null);
      prisma.floor.create.mockResolvedValue({ ...floor, id: 'f-9' });

      await service.create(
        asDto<CreateFloorDto>({ name: 'Ground' }),
        restaurantId,
        branchId,
        testTenantId,
        userId,
      );

      expect(prisma.floor.create.mock.calls[0][0].data.level).toBe(1);
      expect(events.emit).toHaveBeenCalledWith(
        'floor.created',
        expect.objectContaining({ floorId: 'f-9' }),
      );
    });
  });

  describe('findAll', () => {
    it('scopes by tenant and restaurant with filters', async () => {
      prisma.floor.findMany.mockResolvedValue([floor]);
      prisma.floor.count.mockResolvedValue(1);

      await service.findAll({
        tenantId: testTenantId,
        restaurantId,
        branchId,
        page: 1,
        limit: 10,
        isActive: true,
      });

      const where = prisma.floor.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({
        tenantId: testTenantId,
        restaurantId,
        branchId,
        isActive: true,
        deletedAt: null,
      });
      expect(prisma.floor.findMany.mock.calls[0][0].orderBy).toEqual([
        { level: 'asc' },
        { createdAt: 'desc' },
      ]);
    });
  });

  describe('findOne', () => {
    it('throws when not found', async () => {
      prisma.floor.findFirst.mockResolvedValue(null);
      await expect(service.findOne('f-1', testTenantId)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('rejects a duplicated name', async () => {
      prisma.floor.findFirst.mockResolvedValueOnce(floor).mockResolvedValueOnce({ id: 'f-2' });

      await expect(
        service.update('f-1', asDto<UpdateFloorDto>({ name: 'First' }), testTenantId, userId),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('only writes provided fields and emits updated', async () => {
      prisma.floor.findFirst.mockResolvedValue(floor);
      prisma.floor.update.mockResolvedValue(floor);

      await service.update('f-1', asDto<UpdateFloorDto>({ level: 2 }), testTenantId, userId);

      expect(prisma.floor.update.mock.calls[0][0].data).toEqual({ level: 2 });
      expect(events.emit).toHaveBeenCalledWith(
        'floor.updated',
        expect.objectContaining({ floorId: 'f-1' }),
      );
    });
  });

  describe('softDelete / restore', () => {
    it('refuses to delete a floor that still has dining areas', async () => {
      prisma.floor.findFirst.mockResolvedValue(floor);
      prisma.diningArea.count.mockResolvedValue(2);

      await expect(service.softDelete('f-1', testTenantId, userId)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.floor.update).not.toHaveBeenCalled();
    });

    it('soft-deletes when there are no dining areas', async () => {
      prisma.floor.findFirst.mockResolvedValue(floor);
      prisma.diningArea.count.mockResolvedValue(0);
      prisma.floor.update.mockResolvedValue({});

      await service.softDelete('f-1', testTenantId, userId);

      const data = prisma.floor.update.mock.calls[0][0].data;
      expect(data.deletedAt).toBeInstanceOf(Date);
      expect(data.isActive).toBe(false);
      expect(events.emit).toHaveBeenCalledWith(
        'floor.deleted',
        expect.objectContaining({ floorId: 'f-1' }),
      );
    });

    it('restores a deleted floor', async () => {
      prisma.floor.findFirst.mockResolvedValue({ ...floor, deletedAt: new Date() });
      prisma.floor.update.mockResolvedValue(floor);

      await service.restore('f-1', testTenantId, userId);

      expect(prisma.floor.update.mock.calls[0][0].data).toEqual({
        deletedAt: null,
        isActive: true,
      });
    });

    it('throws when restoring a floor that is not deleted', async () => {
      prisma.floor.findFirst.mockResolvedValue(null);
      await expect(service.restore('f-1', testTenantId, userId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
