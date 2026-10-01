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

  describe('remaining cleanup types', () => {
    function prismaOf(processor: CleanupProcessor) {
      return (processor as unknown as { prisma: ReturnType<typeof prismaMock> }).prisma;
    }

    it('removes expired sessions inside the retention window', async () => {
      const processor = makeProcessor();
      const prisma = prismaOf(processor);
      prisma.session.deleteMany.mockResolvedValue({ count: 4 });

      const result = await processor.process(makeJob('expired_sessions'));

      expect(prisma.session.deleteMany.mock.calls[0][0].where.expiresAt.lt).toBeInstanceOf(Date);
      expect(result.cleaned[0]).toBe('expired_sessions: 4');
    });

    it('removes expired verification tokens', async () => {
      const processor = makeProcessor();
      const prisma = prismaOf(processor);
      prisma.verificationToken.deleteMany.mockResolvedValue({ count: 2 });

      const result = await processor.process(makeJob('expired_tokens'));

      expect(result.cleaned[0]).toBe('expired_tokens: 2');
    });

    it('archives old audit logs rather than deleting them', async () => {
      const processor = makeProcessor();
      const prisma = prismaOf(processor);
      prisma.auditLog.updateMany.mockResolvedValue({ count: 5 });

      const result = await processor.process(makeJob('archive_old_audit_logs'));

      const call = prisma.auditLog.updateMany.mock.calls[0][0];
      expect(call.where).toMatchObject({ isArchived: false });
      expect(call.data.isArchived).toBe(true);
      expect(call.data.archivedAt).toBeInstanceOf(Date);
      expect(result.cleaned[0]).toBe('archived_audit_logs: 5');
    });

    it('deletes failed webhook deliveries', async () => {
      const processor = makeProcessor();
      const prisma = prismaOf(processor);
      prisma.webhookDelivery.deleteMany.mockResolvedValue({ count: 1 });

      const result = await processor.process(makeJob('failed_webhook_deliveries'));

      expect(prisma.webhookDelivery.deleteMany.mock.calls[0][0].where.status).toBe('FAILED');
      expect(result.cleaned[0]).toBe('failed_webhook_deliveries: 1');
    });

    it('delegates stale BullMQ job maintenance and reports it as skipped', async () => {
      const result = await makeProcessor().process(makeJob('stale_jobs'));

      expect(result.cleaned[0]).toContain('stale_jobs: skipped');
    });

    it('expires completed backup records', async () => {
      const processor = makeProcessor();
      const prisma = prismaOf(processor);
      prisma.backupRecord.findMany.mockResolvedValue([{ id: 'b-1' }, { id: 'b-2' }]);

      const result = await processor.process(makeJob('expired_backups'));

      expect(prisma.backupRecord.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'EXPIRED' } }),
      );
      expect(result.cleaned[0]).toBe('expired_backups: 2');
    });

    it('reports zero when no backups are expired', async () => {
      const processor = makeProcessor();
      const prisma = prismaOf(processor);
      prisma.backupRecord.findMany.mockResolvedValue([]);

      const result = await processor.process(makeJob('expired_backups'));

      expect(prisma.backupRecord.updateMany).not.toHaveBeenCalled();
      expect(result.cleaned[0]).toBe('expired_backups: 0');
    });

    it('expires stale gift cards', async () => {
      const processor = makeProcessor();
      const prisma = prismaOf(processor);
      prisma.giftCard.updateMany.mockResolvedValue({ count: 3 });

      const result = await processor.process(makeJob('stale_gift_cards'));

      expect(prisma.giftCard.updateMany.mock.calls[0][0].data).toEqual({ status: 'EXPIRED' });
      expect(result.cleaned[0]).toBe('stale_gift_cards: 3');
    });

    it('warns and cleans nothing for an unknown type', async () => {
      const result = await makeProcessor().process(makeJob('does_not_exist'));

      expect(result.cleaned).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown cleanup type'));
    });
  });

  describe('lifecycle', () => {
    it('registers the cleanup worker with concurrency 1', () => {
      makeProcessor().onModuleInit();

      expect(queueServiceMock.registerWorker).toHaveBeenCalledWith(
        'cleanup',
        expect.any(Function),
        1,
      );
    });

    it('reports 100% progress regardless of the cleanup type', async () => {
      const job = makeJob('stale_jobs');
      await makeProcessor().process(job);

      expect(job.updateProgress).toHaveBeenCalledWith(100);
    });
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
