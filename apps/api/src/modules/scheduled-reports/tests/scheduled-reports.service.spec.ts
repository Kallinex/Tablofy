import { Logger } from '@nestjs/common';
import { ScheduledReportsService } from '../scheduled-reports.service';

function buildService(overrides: Record<string, unknown> = {}) {
  const prisma = {
    scheduledReport: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    reportExport: {
      create: jest.fn().mockImplementation(async ({ data }) => ({
        id: 'export-1',
        ...data,
      })),
    },
  };

  const auditLogsService = { log: jest.fn().mockResolvedValue(undefined) };
  const cacheService = {
    delete: jest.fn().mockResolvedValue(undefined),
    deletePattern: jest.fn().mockResolvedValue(undefined),
  };
  const queueService = { addJob: jest.fn().mockResolvedValue({ id: 'job-1' }) };

  return {
    service: new ScheduledReportsService(
      prisma as never,
      auditLogsService as never,
      cacheService as never,
      queueService as never,
    ),
    prisma,
    auditLogsService,
    cacheService,
    queueService,
    ...overrides,
  };
}

function dueReport(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sr-1',
    tenantId: 'tenant-a',
    name: 'Daily sales',
    type: 'SALES',
    format: 'CSV',
    schedule: '0 0 1 1 *',
    recipients: ['owner@example.com', 'manager@example.com'],
    config: {},
    isActive: true,
    lastRunAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

describe('ScheduledReportsService', () => {
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  describe('runDueReports', () => {
    it('triggers reports that have never run and enqueues a real export-engine job', async () => {
      const ctx = buildService();
      ctx.prisma.scheduledReport.findMany.mockResolvedValue([dueReport()]);
      ctx.prisma.scheduledReport.findFirst.mockResolvedValue(dueReport());

      const result = await ctx.service.runDueReports();

      expect(result.triggered).toEqual(['export-1']);
      expect(ctx.queueService.addJob).toHaveBeenCalledWith('export-engine', 'generate-export', {
        tenantId: 'tenant-a',
        userId: undefined,
        payload: { exportId: 'export-1', scheduledReportId: 'sr-1' },
      });
      expect(ctx.prisma.scheduledReport.update).toHaveBeenCalledWith({
        where: { id: 'sr-1' },
        data: { lastRunAt: expect.any(Date) },
      });
    });

    it('does not re-trigger a report whose next run is still in the future', async () => {
      const ctx = buildService();
      ctx.prisma.scheduledReport.findMany.mockResolvedValue([dueReport({ lastRunAt: new Date() })]);

      const result = await ctx.service.runDueReports();

      expect(result.triggered).toEqual([]);
      expect(result.skipped).toBe(1);
      expect(ctx.queueService.addJob).not.toHaveBeenCalled();
    });

    it('skips reports with an invalid cron schedule instead of crashing the scan', async () => {
      const ctx = buildService();
      ctx.prisma.scheduledReport.findMany.mockResolvedValue([
        dueReport({ schedule: 'not a cron', lastRunAt: null }),
      ]);

      const result = await ctx.service.runDueReports();

      expect(result.triggered).toEqual([]);
      expect(result.skipped).toBe(1);
      expect(ctx.queueService.addJob).not.toHaveBeenCalled();
    });

    it('continues scanning when one report fails to trigger', async () => {
      const ctx = buildService();
      ctx.prisma.scheduledReport.findMany.mockResolvedValue([
        dueReport(),
        dueReport({ id: 'sr-2' }),
      ]);
      ctx.prisma.scheduledReport.findFirst.mockImplementation(async ({ where }) =>
        where.id === 'sr-2' ? { ...dueReport(), id: 'sr-2' } : { ...dueReport(), id: 'sr-1' },
      );
      ctx.prisma.reportExport.create.mockRejectedValueOnce(new Error('db down'));

      const result = await ctx.service.runDueReports();

      expect(result.triggered).toEqual(['export-1']);
      expect(result.scanned).toBe(2);
    });

    it('ignores inactive and soft-deleted reports', async () => {
      const ctx = buildService();
      ctx.prisma.scheduledReport.findMany.mockResolvedValue([
        dueReport({ isActive: false }),
        dueReport({ deletedAt: new Date() }),
      ]);

      const result = await ctx.service.runDueReports();

      expect(result.triggered).toEqual([]);
      expect(ctx.queueService.addJob).not.toHaveBeenCalled();
    });
  });

  describe('trigger', () => {
    it('creates a PENDING export and never fabricates a COMPLETED artifact', async () => {
      const ctx = buildService();
      ctx.prisma.scheduledReport.findFirst.mockResolvedValue(dueReport());

      const result = await ctx.service.trigger('tenant-a', 'sr-1', 'user-1');

      expect(result).toEqual({ exportId: 'export-1' });
      const createCall = ctx.prisma.reportExport.create.mock.calls[0][0].data;
      expect(createCall.status).toBe('PENDING');
      expect(createCall.completedAt).toBeUndefined();
      expect(ctx.queueService.addJob).toHaveBeenCalledWith('export-engine', 'generate-export', {
        tenantId: 'tenant-a',
        userId: 'user-1',
        payload: { exportId: 'export-1', scheduledReportId: 'sr-1' },
      });
    });

    it('throws NotFoundException when the report does not exist', async () => {
      const ctx = buildService();
      ctx.prisma.scheduledReport.findFirst.mockResolvedValue(null);

      await expect(ctx.service.trigger('tenant-a', 'missing')).rejects.toThrow(
        'Scheduled report not found',
      );
    });
  });

  describe('handleReportExportCompleted', () => {
    const completedEvent = {
      tenantId: 'tenant-a',
      exportId: 'export-9',
      filePath: 'tenant-a/export-9.csv',
      absolutePath: 'C:\\exports\\tenant-a\\export-9.csv',
      fileSize: 42,
      type: 'CSV',
      scheduledReportId: 'sr-1',
    };

    it('queues an email with the real attachment when recipients exist', async () => {
      const ctx = buildService();
      ctx.prisma.scheduledReport.findFirst.mockResolvedValue(
        dueReport({ recipients: ['owner@example.com'] }),
      );

      await ctx.service.handleReportExportCompleted(completedEvent);

      expect(ctx.queueService.addJob).toHaveBeenCalledWith('email', 'send-email', {
        tenantId: 'tenant-a',
        payload: {
          to: 'owner@example.com',
          subject: 'Scheduled report: Daily sales',
          body: expect.stringContaining('Daily sales'),
          attachments: [
            {
              filename: 'export-9.csv',
              path: 'C:\\exports\\tenant-a\\export-9.csv',
              contentType: 'text/csv; charset=utf-8',
            },
          ],
        },
      });
    });

    it('does nothing when the event has no scheduledReportId', async () => {
      const ctx = buildService();
      await ctx.service.handleReportExportCompleted({
        ...completedEvent,
        scheduledReportId: undefined,
      });
      expect(ctx.queueService.addJob).not.toHaveBeenCalled();
    });

    it('does nothing when the scheduled report is gone or inactive', async () => {
      const ctx = buildService();
      ctx.prisma.scheduledReport.findFirst.mockResolvedValue(null);
      await ctx.service.handleReportExportCompleted(completedEvent);
      expect(ctx.queueService.addJob).not.toHaveBeenCalled();
    });

    it('does not queue email when there are no recipients', async () => {
      const ctx = buildService();
      ctx.prisma.scheduledReport.findFirst.mockResolvedValue(dueReport({ recipients: [] }));

      await ctx.service.handleReportExportCompleted(completedEvent);

      expect(ctx.queueService.addJob).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no recipients'));
    });
  });
});
