import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { TablesService } from '../tables.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { PlanLimitsService } from '../../../common/services/plan-limits.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockEventEmitter, MockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';
import { CreateTableDto } from '../dto/create-table.dto';
import { UpdateTableDto } from '../dto/update-table.dto';

const userId = 'user-1';
const branchId = 'br-1';
const asDto = <T>(value: Record<string, unknown>) => value as unknown as T;

describe('TablesService', () => {
  let service: TablesService;
  let prisma: MockPrisma;
  let audit: MockAuditLogs;
  let events: MockEventEmitter;
  let planLimits: { checkLimit: jest.Mock };

  beforeAll(async () => {
    planLimits = { checkLimit: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TablesService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: PlanLimitsService, useValue: planLimits },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
      ],
    }).compile();

    service = module.get<TablesService>(TablesService);
    prisma = module.get(PrismaService) as MockPrisma;
    audit = module.get(AuditLogsService) as MockAuditLogs;
    events = module.get(EventEmitter2) as unknown as MockEventEmitter;
  });

  beforeEach(() => {
    prisma.reset();
    audit.reset();
    events.reset();
    planLimits.checkLimit.mockReset();
    planLimits.checkLimit.mockResolvedValue({
      allowed: true,
      current: 0,
      limit: 50,
      resource: 'tables',
    });
  });

  const table = {
    id: 't-1',
    tenantId: testTenantId,
    branchId,
    number: 'A1',
    seats: 4,
    status: 'AVAILABLE',
    isActive: true,
    qrCode: 'tbl-old',
    deletedAt: null,
  };

  describe('create', () => {
    it('requires the branch to belong to the tenant', async () => {
      prisma.branch.findFirst.mockResolvedValue(null);

      await expect(
        service.create(
          asDto<CreateTableDto>({ number: 'A1', diningAreaId: 'd-1' }),
          branchId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.table.create).not.toHaveBeenCalled();
    });

    it('requires the dining area to belong to the branch', async () => {
      prisma.branch.findFirst.mockResolvedValue({ id: branchId });
      prisma.diningArea.findFirst.mockResolvedValue(null);

      await expect(
        service.create(
          asDto<CreateTableDto>({ number: 'A1', diningAreaId: 'd-1' }),
          branchId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a duplicate table number within the branch', async () => {
      prisma.branch.findFirst.mockResolvedValue({ id: branchId });
      prisma.diningArea.findFirst.mockResolvedValue({ id: 'd-1' });
      prisma.table.findFirst.mockResolvedValue(table);

      await expect(
        service.create(
          asDto<CreateTableDto>({ number: 'A1', diningAreaId: 'd-1' }),
          branchId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('enforces the plan table limit', async () => {
      prisma.branch.findFirst.mockResolvedValue({ id: branchId });
      prisma.diningArea.findFirst.mockResolvedValue({ id: 'd-1' });
      prisma.table.findFirst.mockResolvedValue(null);
      planLimits.checkLimit.mockResolvedValue({
        allowed: false,
        current: 50,
        limit: 50,
        resource: 'tables',
      });

      await expect(
        service.create(
          asDto<CreateTableDto>({ number: 'A1', diningAreaId: 'd-1' }),
          branchId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('creates the table with defaults, a generated qr code, audit and event', async () => {
      prisma.branch.findFirst.mockResolvedValue({ id: branchId });
      prisma.diningArea.findFirst.mockResolvedValue({ id: 'd-1' });
      prisma.table.findFirst.mockResolvedValue(null);
      prisma.table.create.mockResolvedValue({ ...table, id: 't-9' });

      const result = await service.create(
        asDto<CreateTableDto>({ number: 'A9', diningAreaId: 'd-1' }),
        branchId,
        testTenantId,
        userId,
      );

      const data = prisma.table.create.mock.calls[0][0].data;
      expect(data.seats).toBe(4);
      expect(data.qrCode).toMatch(/^tbl-/);
      expect(result.id).toBe('t-9');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'TABLE_CREATED', resourceId: 't-9' }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        'table.created',
        expect.objectContaining({ tenantId: testTenantId, branchId, tableId: 't-9' }),
      );
    });

    it('keeps an explicitly provided qr code', async () => {
      prisma.branch.findFirst.mockResolvedValue({ id: branchId });
      prisma.diningArea.findFirst.mockResolvedValue({ id: 'd-1' });
      prisma.table.findFirst.mockResolvedValue(null);
      prisma.table.create.mockResolvedValue(table);

      await service.create(
        asDto<CreateTableDto>({ number: 'A9', diningAreaId: 'd-1', qrCode: 'custom-qr' }),
        branchId,
        testTenantId,
        userId,
      );

      expect(prisma.table.create.mock.calls[0][0].data.qrCode).toBe('custom-qr');
    });
  });

  describe('findAll', () => {
    it('applies tenant scope, filters, search and pagination', async () => {
      prisma.table.findMany.mockResolvedValue([table]);
      prisma.table.count.mockResolvedValue(21);

      const result = await service.findAll({
        tenantId: testTenantId,
        branchId,
        diningAreaId: 'd-1',
        page: 2,
        limit: 10,
        search: 'A',
        isActive: true,
        status: 'AVAILABLE',
      });

      const where = prisma.table.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({
        tenantId: testTenantId,
        deletedAt: null,
        branchId,
        diningAreaId: 'd-1',
        isActive: true,
        status: 'AVAILABLE',
      });
      expect(prisma.table.findMany.mock.calls[0][0].skip).toBe(10);
      expect(result.meta).toEqual({ total: 21, page: 2, limit: 10, totalPages: 3 });
    });

    it('omits undefined isActive filters so both active and inactive rows match', async () => {
      prisma.table.findMany.mockResolvedValue([]);
      prisma.table.count.mockResolvedValue(0);

      await service.findAll({ tenantId: testTenantId });

      expect(prisma.table.findMany.mock.calls[0][0].where.isActive).toBeUndefined();
    });
  });

  describe('findOne', () => {
    it('scopes by tenant and soft-delete state', async () => {
      prisma.table.findFirst.mockResolvedValue(null);

      await expect(service.findOne('t-1', testTenantId)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.table.findFirst).toHaveBeenCalledWith({
        where: { id: 't-1', tenantId: testTenantId, deletedAt: null },
      });
    });
  });

  describe('update', () => {
    it('rejects changing to a number used by another table', async () => {
      prisma.table.findFirst
        .mockResolvedValueOnce(table) // findOne
        .mockResolvedValueOnce({ id: 't-2' }); // number clash

      await expect(
        service.update('t-1', asDto<UpdateTableDto>({ number: 'A2' }), testTenantId, userId),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('only writes the fields that were provided', async () => {
      prisma.table.findFirst.mockResolvedValue(table);
      prisma.table.update.mockResolvedValue(table);

      await service.update('t-1', asDto<UpdateTableDto>({ seats: 6 }), testTenantId, userId);

      expect(prisma.table.update.mock.calls[0][0].data).toEqual({ seats: 6 });
      expect(events.emit).toHaveBeenCalledWith(
        'table.updated',
        expect.objectContaining({ tableId: 't-1' }),
      );
    });
  });

  describe('updateStatus', () => {
    it('short-circuits when the status is unchanged', async () => {
      prisma.table.findFirst.mockResolvedValue(table);

      const result = await service.updateStatus('t-1', 'AVAILABLE' as never, testTenantId, userId);

      expect(result).toBe(table);
      expect(prisma.table.update).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('persists and emits when the status changes', async () => {
      prisma.table.findFirst.mockResolvedValue(table);
      prisma.table.update.mockResolvedValue({ ...table, status: 'OCCUPIED' });

      await service.updateStatus('t-1', 'OCCUPIED' as never, testTenantId, userId);

      expect(prisma.table.update.mock.calls[0][0].data).toEqual({ status: 'OCCUPIED' });
      expect(events.emit).toHaveBeenCalledWith(
        'table.statusChanged',
        expect.objectContaining({ oldStatus: 'AVAILABLE', newStatus: 'OCCUPIED' }),
      );
    });
  });

  describe('regenerateQrCode', () => {
    it('produces a new qr token and audits the old one', async () => {
      prisma.table.findFirst.mockResolvedValue(table);
      prisma.table.update.mockResolvedValue({ ...table, qrCode: 'tbl-new' });

      await service.regenerateQrCode('t-1', testTenantId, userId);

      const newQr = prisma.table.update.mock.calls[0][0].data.qrCode;
      expect(newQr).toMatch(/^tbl-/);
      expect(newQr).not.toBe('tbl-old');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'TABLE_QR_REGENERATED',
          oldValues: { qrCode: 'tbl-old' },
        }),
      );
    });
  });

  describe('softDelete / restore', () => {
    it('marks the table deleted, inactive and out of service', async () => {
      prisma.table.findFirst.mockResolvedValue(table);
      prisma.table.update.mockResolvedValue({});

      await service.softDelete('t-1', testTenantId, userId);

      const data = prisma.table.update.mock.calls[0][0].data;
      expect(data.deletedAt).toBeInstanceOf(Date);
      expect(data.isActive).toBe(false);
      expect(data.status).toBe('OUT_OF_SERVICE');
      expect(events.emit).toHaveBeenCalledWith(
        'table.deleted',
        expect.objectContaining({ tableId: 't-1' }),
      );
    });

    it('restores a deleted table to AVAILABLE and active', async () => {
      prisma.table.findFirst.mockResolvedValue({ ...table, deletedAt: new Date() });
      prisma.table.update.mockResolvedValue(table);

      await service.restore('t-1', testTenantId, userId);

      expect(prisma.table.findFirst.mock.calls[0][0].where.deletedAt).toEqual({ not: null });
      expect(prisma.table.update.mock.calls[0][0].data).toEqual({
        deletedAt: null,
        isActive: true,
        status: 'AVAILABLE',
      });
    });

    it('throws when restoring a table that is not deleted', async () => {
      prisma.table.findFirst.mockResolvedValue(null);

      await expect(service.restore('t-1', testTenantId, userId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
