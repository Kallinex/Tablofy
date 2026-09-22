import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotFoundException, StreamableFile, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { QueueService } from '../../queues/queue.service';
import { ExportEngineService } from '../export-engine.service';
import { ExportStorageService } from '../export-storage.service';
import { Job } from 'bullmq';

describe('ExportEngineService', () => {
  let service: ExportEngineService;
  let storage: ExportStorageService;
  let tempRoot: string;
  let findFirst: jest.Mock;
  let update: jest.Mock;
  let eventEmitter: { emit: jest.Mock };

  function buildService(
    prismaMock: unknown,
    storageInstance?: ExportStorageService,
  ): ExportEngineService {
    return new ExportEngineService(
      prismaMock as unknown as PrismaService,
      {} as unknown as AuditLogsService,
      {} as unknown as CacheService,
      {} as unknown as QueueService,
      eventEmitter as unknown as EventEmitter2,
      storageInstance ?? storage,
    );
  }

  function job(
    tenantId: string,
    exportId: string,
  ): Job<{ tenantId: string; payload: Record<string, unknown> }> {
    return { data: { tenantId, payload: { exportId } } } as unknown as Job<{
      tenantId: string;
      payload: Record<string, unknown>;
    }>;
  }

  function scheduledJob(
    tenantId: string,
    exportId: string,
    scheduledReportId: string,
  ): Job<{ tenantId: string; payload: Record<string, unknown> }> {
    return { data: { tenantId, payload: { exportId, scheduledReportId } } } as unknown as Job<{
      tenantId: string;
      payload: Record<string, unknown>;
    }>;
  }

  function record(overrides: Record<string, unknown> = {}) {
    return {
      id: 'exp-123',
      tenantId: 'tenant-a',
      type: 'CSV',
      reportType: 'SALES',
      periodStart: null,
      periodEnd: null,
      config: {},
      filePath: null,
      fileSize: null,
      status: 'PENDING',
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: null,
      deletedAt: null,
      ...overrides,
    };
  }

  function prismaMock(initialFindFirst: unknown) {
    findFirst = jest.fn().mockResolvedValue(initialFindFirst);
    update = jest.fn().mockImplementation(async ({ where, data }) => ({ where, data }));
    return {
      reportExport: {
        findFirst,
        update,
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      order: { findMany: jest.fn().mockResolvedValue([]) },
    };
  }

  beforeEach(async () => {
    tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'export-engine-'));
    const config = {
      get: jest.fn((key: string, defaultValue?: unknown) =>
        key === 'EXPORT_DIR' ? tempRoot : defaultValue,
      ),
    } as unknown as ConfigService;
    storage = new ExportStorageService(config);
    eventEmitter = { emit: jest.fn() };
    service = buildService(prismaMock(record()), storage);
  });

  afterEach(async () => {
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  });

  describe('generatePdf', () => {
    it('should produce a valid non-empty PDF buffer', async () => {
      const pdf = await service.generatePdf(
        'Revenue Report',
        [
          { date: '2026-08-01', revenue: '120.50' },
          { date: '2026-08-02', revenue: '98.25' },
        ],
        [
          { key: 'date', header: 'Date' },
          { key: 'revenue', header: 'Revenue' },
        ],
      );

      expect(Buffer.isBuffer(pdf)).toBe(true);
      expect(pdf.length).toBeGreaterThan(0);
      expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    });

    it('should produce a valid PDF buffer even when data is empty', async () => {
      const pdf = await service.generatePdf('Empty Report', [], [{ key: 'id', header: 'ID' }]);

      expect(Buffer.isBuffer(pdf)).toBe(true);
      expect(pdf.length).toBeGreaterThan(0);
      expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    });
  });

  describe('generateExcel', () => {
    it('should produce a valid xlsx buffer', async () => {
      const xlsx = await service.generateExcel(
        [{ name: 'Pasta', qty: 2 }],
        [
          { key: 'name', header: 'Name' },
          { key: 'qty', header: 'Qty' },
        ],
        'Stock',
      );

      expect(Buffer.isBuffer(xlsx)).toBe(true);
      expect(xlsx.length).toBeGreaterThan(0);
      expect(xlsx.subarray(0, 2).toString('ascii')).toBe('PK');
    });
  });

  describe('processExport', () => {
    it('creates a real file and only then marks the export COMPLETED', async () => {
      service = buildService(prismaMock(record({ status: 'PROCESSING' })), storage);

      await service.processExport(job('tenant-a', 'exp-123'));

      const absolute = path.join(tempRoot, 'tenant-a', 'exp-123.csv');
      const stat = await fs.promises.stat(absolute);
      expect(stat.isFile()).toBe(true);
      expect(stat.size).toBeGreaterThan(0);

      const completedUpdate = update.mock.calls
        .map((call) => call[0].data)
        .find((d: { status?: string }) => d.status === 'COMPLETED');
      expect(completedUpdate).toBeDefined();
      expect(completedUpdate.filePath).toBe('tenant-a/exp-123.csv');
      expect(completedUpdate.fileSize).toBe(stat.size);
      expect(completedUpdate.completedAt).toBeDefined();

      const statuses = update.mock.calls.map((call) => call[0].data.status);
      expect(statuses.indexOf('PROCESSING')).toBeLessThan(statuses.indexOf('COMPLETED'));
    });

    it('marks the export FAILED (never COMPLETED) when the storage write fails', async () => {
      const failingStorage = {
        writeExport: jest.fn().mockRejectedValue(new Error('disk full')),
      } as unknown as ExportStorageService;
      service = buildService(prismaMock(record({ status: 'PROCESSING' })), failingStorage);

      await expect(service.processExport(job('tenant-a', 'exp-123'))).rejects.toThrow('disk full');

      const completedUpdate = update.mock.calls
        .map((call) => call[0].data)
        .find((d: { status?: string }) => d.status === 'COMPLETED');
      expect(completedUpdate).toBeUndefined();
      const failedUpdate = update.mock.calls
        .map((call) => call[0].data)
        .find((d: { status?: string }) => d.status === 'FAILED');
      expect(failedUpdate).toBeDefined();
      expect(failedUpdate.errorMessage).toBe('disk full');
    });

    it('retry reprocessing produces exactly one artifact with no temp litter', async () => {
      service = buildService(prismaMock(record({ status: 'PROCESSING' })), storage);

      await service.processExport(job('tenant-a', 'exp-123'));
      await service.processExport(job('tenant-a', 'exp-123'));

      const entries = await fs.promises.readdir(path.join(tempRoot, 'tenant-a'));
      expect(entries).toEqual(['exp-123.csv']);
      expect(entries.filter((e) => e.includes('.tmp-')).length).toBe(0);
    });

    it('emits report-export.completed with the real file path for scheduled reports', async () => {
      service = buildService(prismaMock(record({ status: 'PROCESSING' })), storage);

      await service.processExport(scheduledJob('tenant-a', 'exp-123', 'sr-9'));

      expect(eventEmitter.emit).toHaveBeenCalledWith('report-export.completed', {
        tenantId: 'tenant-a',
        exportId: 'exp-123',
        filePath: 'tenant-a/exp-123.csv',
        absolutePath: path.join(tempRoot, 'tenant-a', 'exp-123.csv'),
        fileSize: expect.any(Number),
        type: 'CSV',
        scheduledReportId: 'sr-9',
      });
    });

    it('does not emit report-export.completed for ad-hoc exports', async () => {
      service = buildService(prismaMock(record({ status: 'PROCESSING' })), storage);

      await service.processExport(job('tenant-a', 'exp-123'));

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('downloadExport / getExportFile', () => {
    it('returns the exact file bytes with a safe content type and filename', async () => {
      const payload = Buffer.from('id,status\r\n1,PAID\r\n');
      await storage.writeExport('tenant-a', 'exp-123', 'csv', payload);
      findFirst.mockResolvedValue(
        record({ status: 'COMPLETED', filePath: 'tenant-a/exp-123.csv', fileSize: payload.length }),
      );

      const result = await service.getExportFile('tenant-a', 'exp-123');
      expect(result.data.toString()).toBe('id,status\r\n1,PAID\r\n');
      expect(result.contentType).toBe('text/csv; charset=utf-8');
      expect(result.fileName).toBe('exp-123.csv');

      const stream = await service.downloadExport('tenant-a', 'exp-123');
      expect(stream).toBeInstanceOf(StreamableFile);
    });

    it('throws when the completed record has no file on disk', async () => {
      findFirst.mockResolvedValue(
        record({ status: 'COMPLETED', filePath: 'tenant-a/exp-123.csv', fileSize: 10 }),
      );

      await expect(service.getExportFile('tenant-a', 'exp-123')).rejects.toThrow(NotFoundException);
      await expect(service.downloadExport('tenant-a', 'exp-123')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('denies a cross-tenant download', async () => {
      findFirst.mockResolvedValue(null);
      await expect(service.getExportFile('tenant-b', 'exp-123')).rejects.toThrow(NotFoundException);
    });

    it('never trusts a malicious stored filePath (traversal in DB is rejected)', async () => {
      findFirst.mockResolvedValue(
        record({ status: 'COMPLETED', filePath: '../outside/secret.csv', fileSize: 10 }),
      );

      await expect(service.getExportFile('tenant-a', 'exp-123')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
