import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { DiningAreasService } from '../dining-areas.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockEventEmitter, MockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';
import { CreateDiningAreaDto } from '../dto/create-dining-area.dto';
import { UpdateDiningAreaDto } from '../dto/update-dining-area.dto';

const userId = 'user-1';
const branchId = 'br-1';
const floorId = 'f-1';
const asDto = <T>(value: Record<string, unknown>) => value as unknown as T;

describe('DiningAreasService', () => {
  let service: DiningAreasService;
  let prisma: MockPrisma;
  let audit: MockAuditLogs;
  let events: MockEventEmitter;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiningAreasService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
      ],
    }).compile();

    service = module.get<DiningAreasService>(DiningAreasService);
    prisma = module.get(PrismaService) as MockPrisma;
    audit = module.get(AuditLogsService) as MockAuditLogs;
    events = module.get(EventEmitter2) as unknown as MockEventEmitter;
  });

  beforeEach(() => {
    prisma.reset();
    audit.reset();
    events.reset();
  });

  const area = {
    id: 'a-1',
    tenantId: testTenantId,
    branchId,
    floorId,
    name: 'Main Hall',
    capacity: 20,
    isActive: true,
    deletedAt: null,
  };

  describe('create', () => {
    it('requires the branch to belong to the tenant', async () => {
      prisma.branch.findFirst.mockResolvedValue(null);

      await expect(
        service.create(
          asDto<CreateDiningAreaDto>({ name: 'Main Hall', floorId }),
          branchId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('requires the floor to belong to the branch and tenant', async () => {
      prisma.branch.findFirst.mockResolvedValue({ id: branchId });
      prisma.floor.findFirst.mockResolvedValue(null);

      await expect(
        service.create(
          asDto<CreateDiningAreaDto>({ name: 'Main Hall', floorId }),
          branchId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.floor.findFirst.mock.calls[0][0].where).toMatchObject({
        id: floorId,
        branchId,
        tenantId: testTenantId,
      });
    });

    it('rejects a duplicate name within the branch', async () => {
      prisma.branch.findFirst.mockResolvedValue({ id: branchId });
      prisma.floor.findFirst.mockResolvedValue({ id: floorId });
      prisma.diningArea.findFirst.mockResolvedValue(area);

      await expect(
        service.create(
          asDto<CreateDiningAreaDto>({ name: 'Main Hall', floorId }),
          branchId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('applies defaults and emits on success', async () => {
      prisma.branch.findFirst.mockResolvedValue({ id: branchId });
      prisma.floor.findFirst.mockResolvedValue({ id: floorId });
      prisma.diningArea.findFirst.mockResolvedValue(null);
      prisma.diningArea.create.mockResolvedValue({ ...area, id: 'a-9' });

      await service.create(
        asDto<CreateDiningAreaDto>({ name: 'Main Hall', floorId }),
        branchId,
        testTenantId,
        userId,
      );

      expect(prisma.diningArea.create.mock.calls[0][0].data.capacity).toBe(20);
      expect(events.emit).toHaveBeenCalledWith(
        'diningArea.created',
        expect.objectContaining({ areaId: 'a-9' }),
      );
    });
  });

  describe('findAll', () => {
    it('scopes by tenant with branch and floor filters', async () => {
      prisma.diningArea.findMany.mockResolvedValue([area]);
      prisma.diningArea.count.mockResolvedValue(1);

      await service.findAll({
        tenantId: testTenantId,
        branchId,
        floorId,
        page: 2,
        limit: 5,
        search: 'ha',
      });

      const where = prisma.diningArea.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({ tenantId: testTenantId, branchId, floorId, deletedAt: null });
      expect(where.OR).toHaveLength(2);
      expect(prisma.diningArea.findMany.mock.calls[0][0].skip).toBe(5);
    });
  });

  describe('findOne', () => {
    it('throws when not found', async () => {
      prisma.diningArea.findFirst.mockResolvedValue(null);
      await expect(service.findOne('a-1', testTenantId)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('rejects a duplicated name', async () => {
      prisma.diningArea.findFirst.mockResolvedValueOnce(area).mockResolvedValueOnce({ id: 'a-2' });

      await expect(
        service.update('a-1', asDto<UpdateDiningAreaDto>({ name: 'Patio' }), testTenantId, userId),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('only writes provided fields and emits updated', async () => {
      prisma.diningArea.findFirst.mockResolvedValue(area);
      prisma.diningArea.update.mockResolvedValue(area);

      await service.update(
        'a-1',
        asDto<UpdateDiningAreaDto>({ capacity: 30 }),
        testTenantId,
        userId,
      );

      expect(prisma.diningArea.update.mock.calls[0][0].data).toEqual({ capacity: 30 });
      expect(events.emit).toHaveBeenCalledWith(
        'diningArea.updated',
        expect.objectContaining({ areaId: 'a-1' }),
      );
    });
  });

  describe('softDelete / restore', () => {
    it('refuses to delete an area that still has tables', async () => {
      prisma.diningArea.findFirst.mockResolvedValue(area);
      prisma.table.count.mockResolvedValue(3);

      await expect(service.softDelete('a-1', testTenantId, userId)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.diningArea.update).not.toHaveBeenCalled();
    });

    it('soft-deletes when there are no tables', async () => {
      prisma.diningArea.findFirst.mockResolvedValue(area);
      prisma.table.count.mockResolvedValue(0);
      prisma.diningArea.update.mockResolvedValue({});

      await service.softDelete('a-1', testTenantId, userId);

      const data = prisma.diningArea.update.mock.calls[0][0].data;
      expect(data.deletedAt).toBeInstanceOf(Date);
      expect(data.isActive).toBe(false);
    });

    it('restores a deleted area', async () => {
      prisma.diningArea.findFirst.mockResolvedValue({ ...area, deletedAt: new Date() });
      prisma.diningArea.update.mockResolvedValue(area);

      await service.restore('a-1', testTenantId, userId);

      expect(prisma.diningArea.update.mock.calls[0][0].data).toEqual({
        deletedAt: null,
        isActive: true,
      });
    });

    it('throws when restoring an area that is not deleted', async () => {
      prisma.diningArea.findFirst.mockResolvedValue(null);
      await expect(service.restore('a-1', testTenantId, userId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
