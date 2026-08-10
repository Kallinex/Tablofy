import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { QueueService } from '../../queues/queue.service';
import { ExportEngineService } from '../export-engine.service';

describe('ExportEngineService', () => {
  let service: ExportEngineService;

  beforeEach(() => {
    service = new ExportEngineService(
      {} as unknown as PrismaService,
      {} as unknown as AuditLogsService,
      {} as unknown as CacheService,
      {} as unknown as QueueService,
      {} as unknown as EventEmitter2,
    );
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
});
