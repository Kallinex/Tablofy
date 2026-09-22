import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { CleanupProcessor } from '../cleanup.processor';
import { ExportStorageService } from '../../export-engine/export-storage.service';

const queueServiceMock = { registerWorker: jest.fn() };

const exportStorageMock = {
  deleteExport: jest.fn().mockResolvedValue(undefined),
};

const paymentsServiceMock = {
  reconcilePendingPayments: jest.fn().mockResolvedValue({
    scanned: 0,
    completed: 0,
    failed: 0,
    mismatched: 0,
    keptPending: 0,
    errored: 0,
  }),
};

function configService(retentionDays: number) {
  return {
    get: jest.fn((key: string, fallback?: unknown) =>
      key === 'REPORT_EXPORT_RETENTION_DAYS' ? retentionDays : fallback,
    ),
  };
}

function prismaMock() {
  return {
    reportExport: {
      findMany: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue({}),
    },
    session: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    verificationToken: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    auditLog: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    webhookDelivery: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    dataExportRequest: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    backupRecord: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    giftCard: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
}

function makeJob(type: string): Job {
  return {
    data: { payload: { type } },
    updateProgress: jest.fn().mockResolvedValue(undefined),
  } as unknown as Job;
}

function expiredRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'exp-old',
    tenantId: 'tenant-a',
    filePath: 'tenant-a/exp-old.csv',
    ...overrides,
  };
}

describe('CleanupProcessor', () => {
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  function makeProcessor() {
    return new CleanupProcessor(
      queueServiceMock as never,
      prismaMock() as never,
      configService(30) as never,
      exportStorageMock as unknown as ExportStorageService,
      paymentsServiceMock as never,
    );
  }

  describe('expired_report_exports', () => {
    it('deletes expired completed exports along with their files', async () => {
      const processor = makeProcessor();
      const prisma = (processor as unknown as { prisma: ReturnType<typeof prismaMock> }).prisma;
      prisma.reportExport.findMany.mockResolvedValue([
        expiredRecord({ id: 'a', filePath: 'tenant-a/a.csv' }),
        expiredRecord({ id: 'b', tenantId: 'tenant-b', filePath: 'tenant-b/b.csv' }),
      ]);

      const result = await processor.process(makeJob('expired_report_exports'));

      expect(exportStorageMock.deleteExport).toHaveBeenCalledWith('tenant-a', 'tenant-a/a.csv');
      expect(exportStorageMock.deleteExport).toHaveBeenCalledWith('tenant-b', 'tenant-b/b.csv');
      expect(prisma.reportExport.delete).toHaveBeenCalledWith({ where: { id: 'a' } });
      expect(prisma.reportExport.delete).toHaveBeenCalledWith({ where: { id: 'b' } });
      expect(result.cleaned[0]).toContain('expired_report_exports: 2 rows, 2 files');
    });

    it('only targets records older than the retention cutoff in the query', async () => {
      const processor = makeProcessor();
      const prisma = (processor as unknown as { prisma: ReturnType<typeof prismaMock> }).prisma;
      prisma.reportExport.findMany.mockResolvedValue([]);

      await processor.process(makeJob('expired_report_exports'));

      const where = prisma.reportExport.findMany.mock.calls[0][0].where;
      expect(where.status).toBe('COMPLETED');
      expect(where.deletedAt).toBeNull();
      expect(where.OR).toEqual([
        { completedAt: { lt: expect.any(Date) } },
        { completedAt: null, createdAt: { lt: expect.any(Date) } },
      ]);

      expect(exportStorageMock.deleteExport).not.toHaveBeenCalled();
      expect(prisma.reportExport.delete).not.toHaveBeenCalled();
    });

    it('deletes the row even when the file is already gone (idempotent)', async () => {
      const processor = makeProcessor();
      const prisma = (processor as unknown as { prisma: ReturnType<typeof prismaMock> }).prisma;
      prisma.reportExport.findMany.mockResolvedValue([expiredRecord({ id: 'a' })]);
      exportStorageMock.deleteExport.mockResolvedValueOnce(undefined);

      await processor.process(makeJob('expired_report_exports'));

      expect(prisma.reportExport.delete).toHaveBeenCalledWith({ where: { id: 'a' } });
    });

    it('does not delete the row when the file deletion fails', async () => {
      const processor = makeProcessor();
      const prisma = (processor as unknown as { prisma: ReturnType<typeof prismaMock> }).prisma;
      prisma.reportExport.findMany.mockResolvedValue([expiredRecord({ id: 'a' })]);
      exportStorageMock.deleteExport.mockRejectedValueOnce(new Error('EACCES'));

      await processor.process(makeJob('expired_report_exports'));

      expect(prisma.reportExport.delete).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to delete export file'));
    });

    it('applies a configurable retention window', async () => {
      const processor = new CleanupProcessor(
        queueServiceMock as never,
        prismaMock() as never,
        configService(7) as never,
        exportStorageMock as unknown as ExportStorageService,
        paymentsServiceMock as never,
      );
      const prisma = (processor as unknown as { prisma: ReturnType<typeof prismaMock> }).prisma;
      prisma.reportExport.findMany.mockResolvedValue([]);

      await processor.process(makeJob('expired_report_exports'));

      const where = prisma.reportExport.findMany.mock.calls[0][0].where;
      expect(where.status).toBe('COMPLETED');
      expect(where.deletedAt).toBeNull();
      expect(where.OR.length).toBe(2);
    });
  });

  it('leaves unrelated cleanup types working', async () => {
    const processor = makeProcessor();
    const prisma = (processor as unknown as { prisma: ReturnType<typeof prismaMock> }).prisma;
    prisma.dataExportRequest.deleteMany.mockResolvedValue({ count: 3 });

    const result = await processor.process(makeJob('expired_data_exports'));

    expect(result.cleaned[0]).toContain('expired_data_exports: 3');
  });

  describe('reconcile_pending_payments', () => {
    it('defers to PaymentsService with the configured window and reports scanned count', async () => {
      const processor = makeProcessor();
      paymentsServiceMock.reconcilePendingPayments.mockResolvedValue({
        scanned: 4,
        completed: 1,
        failed: 1,
        mismatched: 0,
        keptPending: 2,
        errored: 0,
      });

      const result = await processor.process(makeJob('reconcile_pending_payments'));

      expect(paymentsServiceMock.reconcilePendingPayments).toHaveBeenCalledWith({
        max: 50,
        staleAfterMs: 15 * 60 * 1000,
      });
      expect(result.cleaned[0]).toContain('reconcile_pending_payments: 4 scanned');
    });

    it('uses configured PAYMENT_RECONCILE_* bounds when present', async () => {
      const processor = new CleanupProcessor(
        queueServiceMock as never,
        prismaMock() as never,
        {
          get: jest.fn((key: string, fallback?: unknown) =>
            key === 'PAYMENT_RECONCILE_MAX'
              ? 10
              : key === 'PAYMENT_RECONCILE_STALE_AFTER_MS'
                ? 300000
                : fallback,
          ),
        } as never,
        exportStorageMock as unknown as ExportStorageService,
        paymentsServiceMock as never,
      );

      await processor.process(makeJob('reconcile_pending_payments'));

      expect(paymentsServiceMock.reconcilePendingPayments).toHaveBeenCalledWith({
        max: 10,
        staleAfterMs: 300000,
      });
    });
  });
});
