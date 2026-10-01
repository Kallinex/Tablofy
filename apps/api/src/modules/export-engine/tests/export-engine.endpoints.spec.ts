import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotFoundException } from '@nestjs/common';
import { ExportEngineService } from '../export-engine.service';
import { ExportStorageService } from '../export-storage.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { QueueService } from '../../queues/queue.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockQueue } from '../../../test/mocks/queue.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';

describe('ExportEngineService request-side endpoints', () => {
  let service: ExportEngineService;
  let prisma: MockPrisma;
  let auditLogs: MockAuditLogs;
  let queue: ReturnType<typeof createMockQueue>;
  let storage: { readExport: jest.Mock };

  beforeEach(async () => {
    storage = { readExport: jest.fn().mockResolvedValue(Buffer.from('id,name\n')) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExportEngineService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: CacheService, useValue: { get: jest.fn(), set: jest.fn() } },
        { provide: QueueService, useValue: createMockQueue() },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: ExportStorageService, useValue: storage },
      ],
    }).compile();

    service = module.get<ExportEngineService>(ExportEngineService);
    prisma = module.get(PrismaService) as MockPrisma;
    auditLogs = module.get(AuditLogsService) as MockAuditLogs;
    queue = module.get(QueueService) as ReturnType<typeof createMockQueue>;

    prisma.reset();
    jest.clearAllMocks();
    storage.readExport.mockResolvedValue(Buffer.from('id,name\n'));
  });

  describe('generateExport', () => {
    it('creates a pending export, queues the job and audits it', async () => {
      prisma.reportExport.create.mockResolvedValue({ id: 'exp-1' });

      const result = await service.generateExport(testTenantId, 'user-1', {
        type: 'CSV',
        reportType: 'SALES',
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
        config: { branchId: 'branch-1' },
      } as never);

      expect(result.id).toBe('exp-1');
      expect(prisma.reportExport.create).toHaveBeenCalledWith({
        data: {
          tenantId: testTenantId,
          type: 'CSV',
          reportType: 'SALES',
          periodStart: new Date('2026-01-01'),
          periodEnd: new Date('2026-01-31'),
          config: { branchId: 'branch-1' },
          status: 'PENDING',
        },
      });
      expect(queue.addJob).toHaveBeenCalledWith(
        'export-engine',
        'generate-export',
        expect.objectContaining({ tenantId: testTenantId }),
      );
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'EXPORT_GENERATED', resourceId: 'exp-1' }),
      );
    });

    it('defaults the config and omits an absent period', async () => {
      prisma.reportExport.create.mockResolvedValue({ id: 'exp-2' });

      await service.generateExport(testTenantId, 'user-1', {
        type: 'PDF',
        reportType: 'INVENTORY',
      } as never);

      const [args] = prisma.reportExport.create.mock.calls[0];
      expect(args.data.config).toEqual({});
      expect(args.data.periodStart).toBeUndefined();
      expect(args.data.periodEnd).toBeUndefined();
    });
  });

  describe('getExport', () => {
    it('returns the export scoped to the tenant', async () => {
      prisma.reportExport.findFirst.mockResolvedValue({ id: 'exp-1', tenantId: testTenantId });

      await expect(service.getExport(testTenantId, 'exp-1')).resolves.toEqual(
        expect.objectContaining({ id: 'exp-1' }),
      );
      expect(prisma.reportExport.findFirst).toHaveBeenCalledWith({
        where: { id: 'exp-1', tenantId: testTenantId, deletedAt: null },
      });
    });

    it('rejects reading an export from another tenant', async () => {
      prisma.reportExport.findFirst.mockResolvedValue(null);

      await expect(service.getExport(testTenantId, 'exp-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('listExports', () => {
    it('paginates newest first by default', async () => {
      prisma.reportExport.findMany.mockResolvedValue([{ id: 'exp-1' }]);
      prisma.reportExport.count.mockResolvedValue(1);

      const result = await service.listExports(testTenantId, {});

      const [args] = prisma.reportExport.findMany.mock.calls[0];
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

    it('filters by type, report type and status', async () => {
      prisma.reportExport.count.mockResolvedValue(0);

      await service.listExports(testTenantId, {
        type: 'CSV',
        reportType: 'SALES',
        status: 'COMPLETED',
        page: 3,
        limit: 10,
      });

      const [args] = prisma.reportExport.findMany.mock.calls[0];
      expect(args.where).toEqual({
        tenantId: testTenantId,
        deletedAt: null,
        type: 'CSV',
        reportType: 'SALES',
        status: 'COMPLETED',
      });
      expect(args.skip).toBe(20);
      expect(args.take).toBe(10);
    });

    it('reports the next and previous page flags', async () => {
      prisma.reportExport.count.mockResolvedValue(45);

      const result = await service.listExports(testTenantId, { page: 2, limit: 20 });

      expect(result.meta).toEqual({
        total: 45,
        page: 2,
        limit: 20,
        totalPages: 3,
        hasNext: true,
        hasPrevious: true,
      });
    });
  });

  describe('generateCsv', () => {
    it('writes a header row followed by the data rows', () => {
      const csv = service.generateCsv(
        [{ id: 1, name: 'Soup' }],
        [
          { key: 'id', header: 'ID' },
          { key: 'name', header: 'Name' },
        ],
      );

      expect(csv).toBe('ID,Name\r\n1,Soup');
    });

    it('escapes separators, quotes and newlines', () => {
      const csv = service.generateCsv(
        [{ note: 'a,b', quoted: 'say "hi"' }],
        [
          { key: 'note', header: 'Note' },
          { key: 'quoted', header: 'Quoted' },
        ],
      );

      expect(csv).toBe('Note,Quoted\r\n"a,b","say ""hi"""');
    });

    it('writes an empty cell for a missing or null value', () => {
      const csv = service.generateCsv(
        [{ a: null }],
        [
          { key: 'a', header: 'A' },
          { key: 'missing', header: 'Missing' },
        ],
      );

      expect(csv).toBe('A,Missing\r\n,');
    });

    it('returns only the header for an empty dataset', () => {
      expect(service.generateCsv([], [{ key: 'a', header: 'A' }])).toBe('A');
    });
  });

  describe('getDashboardSnapshot', () => {
    it('aggregates today orders, revenue, active orders, customers and tickets', async () => {
      prisma.order.count.mockResolvedValueOnce(3).mockResolvedValueOnce(2);
      prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 500 } });
      prisma.customer.count.mockResolvedValue(1);
      prisma.inventoryItem.findMany.mockResolvedValue([{ id: 'inv-1' }, { id: 'inv-2' }]);
      prisma.kitchenTicket.count.mockResolvedValue(4);

      const snapshot = await service.getDashboardSnapshot(
        testTenantId,
        { id: 'user-1' },
        { branchId: 'branch-1' },
      );

      expect(snapshot.kpi).toEqual({
        ordersToday: 3,
        revenueToday: 500,
        activeOrders: 2,
        newCustomers: 1,
        lowStockItems: 2,
        delayedTickets: 4,
      });
      expect(snapshot.config).toEqual({ branchId: 'branch-1' });
      expect(new Date(snapshot.timestamp).getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('defaults the revenue to zero when nothing was processed today', async () => {
      prisma.order.count.mockResolvedValue(0);
      prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: null } });
      prisma.customer.count.mockResolvedValue(0);
      prisma.inventoryItem.findMany.mockResolvedValue([]);
      prisma.kitchenTicket.count.mockResolvedValue(0);

      const snapshot = await service.getDashboardSnapshot(testTenantId, { id: 'user-1' }, {});

      expect(snapshot.kpi.revenueToday).toBe(0);
      expect(snapshot.kpi.lowStockItems).toBe(0);
    });

    it('counts only active orders and recent delayed tickets', async () => {
      prisma.order.count.mockResolvedValue(0);
      prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
      prisma.customer.count.mockResolvedValue(0);
      prisma.inventoryItem.findMany.mockResolvedValue([]);
      prisma.kitchenTicket.count.mockResolvedValue(0);

      await service.getDashboardSnapshot(testTenantId, { id: 'user-1' }, {});

      const [activeArgs] = prisma.order.count.mock.calls[1];
      expect(activeArgs.where.status).toEqual({ in: ['PENDING', 'IN_PREPARATION'] });
      const [ticketArgs] = prisma.kitchenTicket.count.mock.calls[0];
      expect(ticketArgs.where.status).toEqual({ in: ['PENDING', 'PREPARING'] });
    });
  });
});
