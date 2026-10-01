import { NotFoundException } from '@nestjs/common';
import { ScheduledReportsService } from '../scheduled-reports.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockCache, MockCache } from '../../../test/mocks/cache.mock';
import { createMockQueue } from '../../../test/mocks/queue.mock';
import { testTenantId, testUserId } from '../../../test/fixtures/auth.fixture';

describe('ScheduledReportsService CRUD', () => {
  let service: ScheduledReportsService;
  let prisma: MockPrisma;
  let auditLogs: MockAuditLogs;
  let cache: MockCache;

  const report = {
    id: 'sr-1',
    tenantId: testTenantId,
    name: 'Daily sales',
    type: 'SALES',
    format: 'CSV',
    schedule: '0 8 * * *',
    recipients: ['manager@example.com'],
    config: {},
    isActive: true,
    lastRunAt: null,
    deletedAt: null,
  };

  beforeEach(() => {
    prisma = createMockPrisma();
    auditLogs = createMockAuditLogs();
    cache = createMockCache();

    service = new ScheduledReportsService(
      prisma as never,
      auditLogs as never,
      cache as never,
      createMockQueue() as never,
    );

    prisma.reset();
    auditLogs.reset();
    cache.reset();
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('creates the report, audits it and invalidates the list cache', async () => {
      prisma.scheduledReport.create.mockResolvedValue(report);

      const result = await service.create(
        testTenantId,
        testUserId,
        {
          name: 'Daily sales',
          type: 'SALES',
          format: 'CSV',
          schedule: '0 8 * * *',
          recipients: ['manager@example.com'],
          config: { branchId: 'branch-1' },
        } as never,
        testTenantId,
        testUserId,
      );

      expect(result.id).toBe('sr-1');
      expect(prisma.scheduledReport.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: testTenantId,
          isActive: true,
          config: { branchId: 'branch-1' },
        }),
      });
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SCHEDULED_REPORT_CREATED', userId: testUserId }),
      );
      expect(cache.delete).toHaveBeenCalledWith(testTenantId, 'scheduled-reports:list:*');
    });

    it('defaults the config and honours an explicit inactive flag', async () => {
      prisma.scheduledReport.create.mockResolvedValue(report);

      await service.create(testTenantId, testUserId, {
        name: 'Paused report',
        type: 'INVENTORY',
        format: 'PDF',
        schedule: '0 9 * * *',
        recipients: [],
        isActive: false,
      } as never);

      const [args] = prisma.scheduledReport.create.mock.calls[0];
      expect(args.data.config).toEqual({});
      expect(args.data.isActive).toBe(false);
    });
  });

  describe('findAll', () => {
    it('paginates newest first by default', async () => {
      prisma.scheduledReport.findMany.mockResolvedValue([report]);
      prisma.scheduledReport.count.mockResolvedValue(1);

      const result = await service.findAll(testTenantId, {});

      const [args] = prisma.scheduledReport.findMany.mock.calls[0];
      expect(args.where).toEqual({ tenantId: testTenantId, deletedAt: null });
      expect(args.skip).toBe(0);
      expect(args.take).toBe(20);
      expect(args.orderBy).toEqual({ createdAt: 'desc' });
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
        hasNext: false,
        hasPrevious: false,
      });
    });

    it('filters by type and searches the name case insensitively', async () => {
      prisma.scheduledReport.count.mockResolvedValue(0);

      await service.findAll(testTenantId, {
        type: 'SALES' as never,
        name: 'sales',
        page: 2,
        limit: 5,
      });

      const [args] = prisma.scheduledReport.findMany.mock.calls[0];
      expect(args.where).toEqual({
        tenantId: testTenantId,
        deletedAt: null,
        type: 'SALES',
        name: { contains: 'sales', mode: 'insensitive' },
      });
      expect(args.skip).toBe(5);
    });

    it('reports the next and previous page flags', async () => {
      prisma.scheduledReport.count.mockResolvedValue(25);

      const result = await service.findAll(testTenantId, { page: 2, limit: 10 });

      expect(result.meta).toEqual({
        total: 25,
        page: 2,
        limit: 10,
        totalPages: 3,
        hasNext: true,
        hasPrevious: true,
      });
    });
  });

  describe('findOne', () => {
    it('returns the report scoped to the tenant', async () => {
      prisma.scheduledReport.findFirst.mockResolvedValue(report);

      await expect(service.findOne(testTenantId, 'sr-1')).resolves.toEqual(
        expect.objectContaining({ id: 'sr-1' }),
      );
      expect(prisma.scheduledReport.findFirst).toHaveBeenCalledWith({
        where: { id: 'sr-1', tenantId: testTenantId, deletedAt: null },
      });
    });

    it('rejects reading a report from another tenant', async () => {
      prisma.scheduledReport.findFirst.mockResolvedValue(null);

      await expect(service.findOne(testTenantId, 'sr-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('applies only the supplied fields and audits the acting user', async () => {
      prisma.scheduledReport.findFirst.mockResolvedValue(report);
      prisma.scheduledReport.update.mockResolvedValue({ ...report, schedule: '0 9 * * *' });

      const result = await service.update(
        testTenantId,
        'sr-1',
        { schedule: '0 9 * * *' } as never,
        testUserId,
      );

      expect(result.schedule).toBe('0 9 * * *');
      expect(prisma.scheduledReport.update).toHaveBeenCalledWith({
        where: { id: 'sr-1' },
        data: { schedule: '0 9 * * *' },
      });
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SCHEDULED_REPORT_UPDATED',
          userId: testUserId,
          oldValues: { name: 'Daily sales', type: 'SALES' },
        }),
      );
      expect(cache.deletePattern).toHaveBeenCalledWith(testTenantId, 'scheduled-reports:*');
    });

    it('updates every mutable field when they are all provided', async () => {
      prisma.scheduledReport.findFirst.mockResolvedValue(report);
      prisma.scheduledReport.update.mockResolvedValue(report);

      await service.update(
        testTenantId,
        'sr-1',
        {
          name: 'Renamed',
          type: 'INVENTORY',
          format: 'PDF',
          schedule: '0 10 * * *',
          recipients: ['ops@example.com'],
          config: { includeVoided: true },
          isActive: false,
        } as never,
        testUserId,
      );

      const [args] = prisma.scheduledReport.update.mock.calls[0];
      expect(args.data).toEqual({
        name: 'Renamed',
        type: 'INVENTORY',
        format: 'PDF',
        schedule: '0 10 * * *',
        recipients: ['ops@example.com'],
        config: { includeVoided: true },
        isActive: false,
      });
    });

    it('does not attribute the update to the tenant when the caller supplies no user', async () => {
      prisma.scheduledReport.findFirst.mockResolvedValue(report);
      prisma.scheduledReport.update.mockResolvedValue(report);

      await service.update(testTenantId, 'sr-1', { name: 'Renamed' } as never);

      const entry = auditLogs.log.mock.calls[0][0];
      expect(entry.action).toBe('SCHEDULED_REPORT_UPDATED');
      expect(entry.userId).toBeUndefined();
      expect(entry.userId).not.toBe(testTenantId);
    });

    it('rejects updating a report from another tenant', async () => {
      prisma.scheduledReport.findFirst.mockResolvedValue(null);

      await expect(
        service.update(testTenantId, 'sr-1', { name: 'X' } as never, testUserId),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.scheduledReport.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('soft deletes the report and audits the acting user', async () => {
      prisma.scheduledReport.findFirst.mockResolvedValue(report);

      await service.remove(testTenantId, 'sr-1', testUserId);

      expect(prisma.scheduledReport.update).toHaveBeenCalledWith({
        where: { id: 'sr-1' },
        data: { deletedAt: expect.any(Date) },
      });
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SCHEDULED_REPORT_DELETED',
          userId: testUserId,
          oldValues: { name: 'Daily sales' },
        }),
      );
      expect(cache.deletePattern).toHaveBeenCalledWith(testTenantId, 'scheduled-reports:*');
    });

    it('does not attribute the deletion to the tenant when the caller supplies no user', async () => {
      prisma.scheduledReport.findFirst.mockResolvedValue(report);

      await service.remove(testTenantId, 'sr-1');

      const entry = auditLogs.log.mock.calls[0][0];
      expect(entry.action).toBe('SCHEDULED_REPORT_DELETED');
      expect(entry.userId).toBeUndefined();
      expect(entry.userId).not.toBe(testTenantId);
    });

    it('rejects deleting a report from another tenant', async () => {
      prisma.scheduledReport.findFirst.mockResolvedValue(null);

      await expect(service.remove(testTenantId, 'sr-1', testUserId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.scheduledReport.update).not.toHaveBeenCalled();
    });
  });
});
