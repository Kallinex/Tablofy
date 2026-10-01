import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TransferStatus } from '@prisma/client';
import { TransfersService } from '../transfers.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { QueueService } from '../../queues/queue.service';
import { TransfersGateway } from '../transfers.gateway';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockCache, MockCache } from '../../../test/mocks/cache.mock';
import { createMockQueue } from '../../../test/mocks/queue.mock';
import { createMockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId, testUserId } from '../../../test/fixtures/auth.fixture';

describe('TransfersService listing, deletion and movements', () => {
  let service: TransfersService;
  let prisma: MockPrisma;
  let auditLogs: MockAuditLogs;
  let cache: MockCache;

  const gateway = { broadcastTransferUpdate: jest.fn() };

  const transfer = {
    id: 'trf-1',
    tenantId: testTenantId,
    transferNumber: 'TRF-20260810-ABC12',
    status: TransferStatus.DRAFT,
    fromBranchId: 'branch-a',
    toBranchId: 'branch-b',
    notes: null,
    deletedAt: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransfersService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: CacheService, useValue: createMockCache() },
        { provide: QueueService, useValue: createMockQueue() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
        { provide: TransfersGateway, useValue: gateway },
      ],
    }).compile();

    service = module.get<TransfersService>(TransfersService);
    prisma = module.get(PrismaService) as MockPrisma;
    auditLogs = module.get(AuditLogsService) as MockAuditLogs;
    cache = module.get(CacheService) as MockCache;

    prisma.reset();
    auditLogs.reset();
    cache.reset();
    jest.clearAllMocks();
    cache.get.mockResolvedValue(null);
  });

  describe('listTransfers', () => {
    it('returns the cached page', async () => {
      cache.get.mockResolvedValue({ data: [], meta: { total: 0 } });

      await expect(service.listTransfers(testTenantId, {})).resolves.toEqual({
        data: [],
        meta: { total: 0 },
      });
      expect(prisma.branchTransfer.findMany).not.toHaveBeenCalled();
    });

    it('paginates newest first with branch relations and caches the envelope', async () => {
      prisma.branchTransfer.findMany.mockResolvedValue([transfer]);
      prisma.branchTransfer.count.mockResolvedValue(1);

      const result = await service.listTransfers(testTenantId, {});

      const [args] = prisma.branchTransfer.findMany.mock.calls[0];
      expect(args.where).toEqual({ tenantId: testTenantId, deletedAt: null });
      expect(args.skip).toBe(0);
      expect(args.take).toBe(20);
      expect(args.orderBy).toEqual({ createdAt: 'desc' });
      expect(args.include).toEqual({
        items: { include: { inventoryItem: true } },
        fromBranch: true,
        toBranch: true,
        _count: { select: { items: true } },
      });
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
        hasNext: false,
        hasPrevious: false,
      });
      expect(cache.set).toHaveBeenCalledWith(testTenantId, 'transfers:list:{}', result, 120);
    });

    it('filters by status and both branches', async () => {
      await service.listTransfers(testTenantId, {
        status: TransferStatus.APPROVED,
        fromBranchId: 'branch-a',
        toBranchId: 'branch-b',
        page: 3,
        limit: 10,
      });

      const [args] = prisma.branchTransfer.findMany.mock.calls[0];
      expect(args.where).toEqual({
        tenantId: testTenantId,
        deletedAt: null,
        status: TransferStatus.APPROVED,
        fromBranchId: 'branch-a',
        toBranchId: 'branch-b',
      });
      expect(args.skip).toBe(20);
    });

    it('searches the transfer number and notes', async () => {
      await service.listTransfers(testTenantId, { search: 'ABC' });

      const [args] = prisma.branchTransfer.findMany.mock.calls[0];
      expect(args.where.OR).toEqual([
        { transferNumber: { contains: 'ABC', mode: 'insensitive' } },
        { notes: { contains: 'ABC', mode: 'insensitive' } },
      ]);
    });

    it.each([
      ['transferNumber', { transferNumber: 'desc' }],
      ['status', { status: 'asc' }],
      ['createdAt', { createdAt: 'desc' }],
      ['updatedAt', { updatedAt: 'desc' }],
    ])('sorts by %s', async (sortBy, expected) => {
      await service.listTransfers(testTenantId, { sortBy: sortBy as never });

      const [args] = prisma.branchTransfer.findMany.mock.calls[0];
      expect(args.orderBy).toEqual(expected);
    });

    it('honours an explicit sort order', async () => {
      await service.listTransfers(testTenantId, {
        sortBy: 'status' as never,
        sortOrder: 'desc' as never,
      });

      const [args] = prisma.branchTransfer.findMany.mock.calls[0];
      expect(args.orderBy).toEqual({ status: 'desc' });
    });
  });

  describe('deleteTransfer', () => {
    it('soft deletes a draft transfer and invalidates the list cache', async () => {
      prisma.branchTransfer.findFirst.mockResolvedValue(transfer);

      await service.deleteTransfer('trf-1', testTenantId, testUserId);

      expect(prisma.branchTransfer.update).toHaveBeenCalledWith({
        where: { id: 'trf-1' },
        data: { deletedAt: expect.any(Date) },
      });
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'TRANSFER_DELETED',
          oldValues: {
            transferNumber: 'TRF-20260810-ABC12',
            status: TransferStatus.DRAFT,
          },
        }),
      );
      expect(cache.delete).toHaveBeenCalledWith(testTenantId, 'transfer:trf-1');
      expect(cache.deletePattern).toHaveBeenCalledWith(testTenantId, 'transfers:list:*');
      expect(gateway.broadcastTransferUpdate).toHaveBeenCalledWith(
        testTenantId,
        'transfer.deleted',
        { id: 'trf-1' },
      );
    });

    it('refuses to delete a transfer that is no longer a draft', async () => {
      prisma.branchTransfer.findFirst.mockResolvedValue({
        ...transfer,
        status: TransferStatus.APPROVED,
      });

      await expect(
        service.deleteTransfer('trf-1', testTenantId, testUserId),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.branchTransfer.update).not.toHaveBeenCalled();
    });

    it('rejects deleting a transfer from another tenant', async () => {
      prisma.branchTransfer.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteTransfer('trf-1', testTenantId, testUserId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getMovements', () => {
    it('returns the cached movements page', async () => {
      cache.get.mockResolvedValue({ data: [], meta: { total: 0 } });

      await expect(service.getMovements(testTenantId, {})).resolves.toEqual({
        data: [],
        meta: { total: 0 },
      });
      expect(prisma.stockMovement.findMany).not.toHaveBeenCalled();
    });

    it('lists newest first scoped to the tenant', async () => {
      prisma.stockMovement.findMany.mockResolvedValue([{ id: 'sm-1' }]);
      prisma.stockMovement.count.mockResolvedValue(1);

      const result = await service.getMovements(testTenantId, {});

      const [args] = prisma.stockMovement.findMany.mock.calls[0];
      expect(args.where).toEqual({ tenantId: testTenantId });
      expect(args.orderBy).toEqual({ createdAt: 'desc' });
      expect(args.include).toEqual({ inventoryItem: true });
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
        hasNext: false,
        hasPrevious: false,
      });
      expect(cache.set).toHaveBeenCalledWith(testTenantId, 'movements:list:{}', result, 120);
    });

    it('filters by type, item, branch and a date window', async () => {
      await service.getMovements(testTenantId, {
        type: 'TRANSFER_IN' as never,
        itemId: 'item-1',
        branchId: 'branch-a',
        fromDate: '2026-01-01',
        toDate: '2026-01-31',
        page: 2,
        limit: 5,
      });

      const [args] = prisma.stockMovement.findMany.mock.calls[0];
      expect(args.where).toEqual({
        tenantId: testTenantId,
        type: 'TRANSFER_IN',
        inventoryItemId: 'item-1',
        branchId: 'branch-a',
        createdAt: {
          gte: new Date('2026-01-01'),
          lte: new Date('2026-01-31'),
        },
      });
      expect(args.skip).toBe(5);
    });

    it('applies a lower bound only when a from date is given', async () => {
      await service.getMovements(testTenantId, { fromDate: '2026-01-01' });

      const [args] = prisma.stockMovement.findMany.mock.calls[0];
      expect(args.where.createdAt).toEqual({ gte: new Date('2026-01-01') });
    });

    it('defaults a createdAt sort to descending and a type sort to ascending', async () => {
      await service.getMovements(testTenantId, { sortBy: 'createdAt' });
      await service.getMovements(testTenantId, { sortBy: 'type' });

      const [createdArgs] = prisma.stockMovement.findMany.mock.calls[0];
      expect(createdArgs.orderBy).toEqual({ createdAt: 'desc' });
      const [typeArgs] = prisma.stockMovement.findMany.mock.calls[1];
      expect(typeArgs.orderBy).toEqual({ type: 'asc' });
    });

    it('honours an explicit sort order', async () => {
      await service.getMovements(testTenantId, { sortBy: 'createdAt', sortOrder: 'asc' });

      const [args] = prisma.stockMovement.findMany.mock.calls[0];
      expect(args.orderBy).toEqual({ createdAt: 'asc' });
    });
  });

  describe('getMovement', () => {
    it('returns the cached movement', async () => {
      cache.get.mockResolvedValue({ id: 'sm-1' });

      await expect(service.getMovement('sm-1', testTenantId)).resolves.toEqual({ id: 'sm-1' });
      expect(prisma.stockMovement.findFirst).not.toHaveBeenCalled();
    });

    it('reads, caches and returns a movement scoped to the tenant', async () => {
      prisma.stockMovement.findFirst.mockResolvedValue({ id: 'sm-1', quantity: 5 });

      const result = await service.getMovement('sm-1', testTenantId);

      expect(result).toEqual({ id: 'sm-1', quantity: 5 });
      expect(prisma.stockMovement.findFirst).toHaveBeenCalledWith({
        where: { id: 'sm-1', tenantId: testTenantId },
        include: { inventoryItem: true },
      });
      expect(cache.set).toHaveBeenCalledWith(testTenantId, 'movement:sm-1', result, 300);
    });

    it('rejects reading a movement from another tenant', async () => {
      prisma.stockMovement.findFirst.mockResolvedValue(null);

      await expect(service.getMovement('sm-1', testTenantId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('getMovementsByItem', () => {
    it('returns the cached per-item movements', async () => {
      cache.get.mockResolvedValue({ data: [], meta: { total: 0 } });

      await expect(service.getMovementsByItem('item-1', testTenantId, {})).resolves.toEqual({
        data: [],
        meta: { total: 0 },
      });
      expect(prisma.stockMovement.findMany).not.toHaveBeenCalled();
    });

    it('scopes the query to the item and tenant and paginates newest first', async () => {
      prisma.stockMovement.count.mockResolvedValue(2);

      const result = await service.getMovementsByItem('item-1', testTenantId, {
        page: 2,
        limit: 10,
      });

      const [args] = prisma.stockMovement.findMany.mock.calls[0];
      expect(args.where).toEqual({ inventoryItemId: 'item-1', tenantId: testTenantId });
      expect(args.orderBy).toEqual({ createdAt: 'desc' });
      expect(args.skip).toBe(10);
      expect(result.meta).toEqual({
        total: 2,
        page: 2,
        limit: 10,
        totalPages: 1,
        hasNext: false,
        hasPrevious: true,
      });
      expect(cache.set).toHaveBeenCalledWith(
        testTenantId,
        'movements:item:item-1:{"page":2,"limit":10}',
        result,
        120,
      );
    });

    it('filters by movement type and date window', async () => {
      await service.getMovementsByItem('item-1', testTenantId, {
        type: 'TRANSFER_OUT' as never,
        fromDate: '2026-02-01',
        toDate: '2026-02-28',
      });

      const [args] = prisma.stockMovement.findMany.mock.calls[0];
      expect(args.where).toEqual({
        inventoryItemId: 'item-1',
        tenantId: testTenantId,
        type: 'TRANSFER_OUT',
        createdAt: {
          gte: new Date('2026-02-01'),
          lte: new Date('2026-02-28'),
        },
      });
    });
  });
});
