import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { CycleCountStatus, CycleCountItemStatus, CycleCountType } from '@prisma/client';
import { CycleCountService } from '../cycle-count.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { QueueService } from '../../queues/queue.service';
import { CycleCountGateway } from '../cycle-count.gateway';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockCache, MockCache } from '../../../test/mocks/cache.mock';
import { createMockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';
import { CreateCycleCountDto } from '../dto/create-cycle-count.dto';
import { UpdateCycleCountDto } from '../dto/update-cycle-count.dto';
import { QueryCycleCountDto } from '../dto/query-cycle-count.dto';
import { RecordCountDto } from '../dto/record-count.dto';

const userId = 'user-1';
const countId = 'cc-1';
const asDto = <T>(value: Record<string, unknown>) => value as unknown as T;

describe('CycleCountService', () => {
  let service: CycleCountService;
  let prisma: MockPrisma;
  let audit: MockAuditLogs;
  let cache: MockCache;
  let gateway: { broadcastCycleCountUpdate: jest.Mock; broadcastItemUpdate: jest.Mock };

  beforeAll(async () => {
    gateway = { broadcastCycleCountUpdate: jest.fn(), broadcastItemUpdate: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CycleCountService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: CacheService, useValue: createMockCache() },
        { provide: QueueService, useValue: {} },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
        { provide: CycleCountGateway, useValue: gateway },
      ],
    }).compile();

    service = module.get<CycleCountService>(CycleCountService);
    prisma = module.get(PrismaService) as MockPrisma;
    audit = module.get(AuditLogsService) as MockAuditLogs;
    cache = module.get(CacheService) as unknown as MockCache;
  });

  beforeEach(() => {
    prisma.reset();
    audit.reset();
    cache.reset();
    gateway.broadcastCycleCountUpdate.mockReset();
    gateway.broadcastItemUpdate.mockReset();
    // Reconcile runs inside $transaction; make tx resolve to the configured delegates.
    prisma.$transaction.mockImplementation((arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: MockPrisma) => unknown)(prisma);
      }
      return Promise.resolve(arg);
    });
  });

  const count = {
    id: countId,
    tenantId: testTenantId,
    status: CycleCountStatus.SCHEDULED,
    countType: CycleCountType.FULL,
    countDate: new Date('2026-01-01'),
    deletedAt: null,
  };

  describe('create', () => {
    it('applies defaults, generates items for FULL and broadcasts', async () => {
      prisma.cycleCount.create.mockResolvedValue(count);
      prisma.inventoryItem.findMany.mockResolvedValue([
        { id: 'i-1', currentQuantity: 5, name: 'A' },
      ]);
      prisma.cycleCount.findFirst.mockResolvedValue(count);

      await service.create(
        asDto<CreateCycleCountDto>({ countDate: '2026-01-01', countType: 'FULL' }),
        testTenantId,
        userId,
      );

      const data = prisma.cycleCount.create.mock.calls[0][0].data;
      expect(data.status).toBe(CycleCountStatus.SCHEDULED);
      expect(prisma.cycleCountItem.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ skipDuplicates: true }),
      );
      expect(gateway.broadcastCycleCountUpdate).toHaveBeenCalledWith(
        testTenantId,
        'cycle-count.created',
        count,
      );
    });

    it('does not generate items for a SPOT count', async () => {
      prisma.cycleCount.create.mockResolvedValue({ ...count, countType: CycleCountType.SPOT });
      prisma.cycleCount.findFirst.mockResolvedValue(count);

      await service.create(
        asDto<CreateCycleCountDto>({ countDate: '2026-01-01', countType: 'SPOT' }),
        testTenantId,
        userId,
      );

      expect(prisma.cycleCountItem.createMany).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('returns cached results when present', async () => {
      const cached = { data: [{ id: countId }], meta: {} };
      cache.get.mockResolvedValue(cached);

      const result = await service.findAll(testTenantId, asDto<QueryCycleCountDto>({}));

      expect(result).toBe(cached);
      expect(prisma.cycleCount.findMany).not.toHaveBeenCalled();
    });

    it('queries, scopes and caches the list', async () => {
      cache.get.mockResolvedValue(null);
      prisma.cycleCount.findMany.mockResolvedValue([count]);
      prisma.cycleCount.count.mockResolvedValue(1);

      const result = await service.findAll(
        testTenantId,
        asDto<QueryCycleCountDto>({ status: CycleCountStatus.SCHEDULED, warehouseId: 'w-1' }),
      );

      const where = prisma.cycleCount.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({
        tenantId: testTenantId,
        status: CycleCountStatus.SCHEDULED,
        warehouseId: 'w-1',
        deletedAt: null,
      });
      expect(result.meta).toMatchObject({ total: 1, hasNext: false, hasPrevious: false });
      expect(cache.set).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('throws when not found', async () => {
      cache.get.mockResolvedValue(null);
      prisma.cycleCount.findFirst.mockResolvedValue(null);
      await expect(service.findOne(countId, testTenantId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns cached result when present', async () => {
      cache.get.mockResolvedValue(count);
      await expect(service.findOne(countId, testTenantId)).resolves.toBe(count);
    });
  });

  describe('update', () => {
    it('throws when not found', async () => {
      prisma.cycleCount.findFirst.mockResolvedValue(null);
      await expect(
        service.update(countId, asDto<UpdateCycleCountDto>({}), testTenantId, userId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('updates and broadcasts', async () => {
      prisma.cycleCount.findFirst.mockResolvedValue(count);
      prisma.cycleCount.update.mockResolvedValue({
        ...count,
        status: CycleCountStatus.IN_PROGRESS,
      });

      await service.update(
        countId,
        asDto<UpdateCycleCountDto>({ status: CycleCountStatus.IN_PROGRESS }),
        testTenantId,
        userId,
      );

      expect(prisma.cycleCount.update.mock.calls[0][0].data.status).toBe(
        CycleCountStatus.IN_PROGRESS,
      );
      expect(gateway.broadcastCycleCountUpdate).toHaveBeenCalledWith(
        testTenantId,
        'cycle-count.updated',
        expect.anything(),
      );
    });
  });

  describe('remove', () => {
    it('soft-deletes and broadcasts', async () => {
      prisma.cycleCount.findFirst.mockResolvedValue(count);
      prisma.cycleCount.update.mockResolvedValue({});

      await service.remove(countId, testTenantId, userId);

      expect(prisma.cycleCount.update.mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date);
      expect(gateway.broadcastCycleCountUpdate).toHaveBeenCalledWith(
        testTenantId,
        'cycle-count.deleted',
        { id: countId },
      );
    });
  });

  describe('startCount', () => {
    it('rejects a non-scheduled count', async () => {
      prisma.cycleCount.findFirst.mockResolvedValue({
        ...count,
        status: CycleCountStatus.IN_PROGRESS,
      });
      await expect(service.startCount(countId, testTenantId, userId)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('transitions SCHEDULED -> IN_PROGRESS', async () => {
      prisma.cycleCount.findFirst.mockResolvedValue(count);
      prisma.cycleCount.update.mockResolvedValue({
        ...count,
        status: CycleCountStatus.IN_PROGRESS,
      });

      await service.startCount(countId, testTenantId, userId);

      expect(prisma.cycleCount.update.mock.calls[0][0].data.status).toBe(
        CycleCountStatus.IN_PROGRESS,
      );
    });
  });

  describe('completeCount', () => {
    it('rejects a non in-progress count', async () => {
      prisma.cycleCount.findFirst.mockResolvedValue(count);
      await expect(service.completeCount(countId, testTenantId, userId)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('finalizes with the user and timestamp', async () => {
      prisma.cycleCount.findFirst.mockResolvedValue({
        ...count,
        status: CycleCountStatus.IN_PROGRESS,
      });
      prisma.cycleCount.update.mockResolvedValue({ ...count, status: CycleCountStatus.COMPLETED });

      await service.completeCount(countId, testTenantId, userId);

      const data = prisma.cycleCount.update.mock.calls[0][0].data;
      expect(data.status).toBe(CycleCountStatus.COMPLETED);
      expect(data.finalizedById).toBe(userId);
      expect(data.finalizedAt).toBeInstanceOf(Date);
    });
  });

  describe('recordItemCount', () => {
    const item = { id: 'it-1', cycleCountId: countId, expectedQuantity: 10 };

    it('rejects when the count is not in progress', async () => {
      prisma.cycleCount.findFirst.mockResolvedValue(count);
      await expect(
        service.recordItemCount(
          countId,
          'it-1',
          asDto<RecordCountDto>({ actualQuantity: 8 }),
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws when the item is missing', async () => {
      prisma.cycleCount.findFirst.mockResolvedValue({
        ...count,
        status: CycleCountStatus.IN_PROGRESS,
      });
      prisma.cycleCountItem.findFirst.mockResolvedValue(null);
      await expect(
        service.recordItemCount(
          countId,
          'it-1',
          asDto<RecordCountDto>({ actualQuantity: 8 }),
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('computes variance and percent', async () => {
      prisma.cycleCount.findFirst.mockResolvedValue({
        ...count,
        status: CycleCountStatus.IN_PROGRESS,
      });
      prisma.cycleCountItem.findFirst.mockResolvedValue(item);
      prisma.cycleCountItem.update.mockResolvedValue({ id: 'it-1' });

      await service.recordItemCount(
        countId,
        'it-1',
        asDto<RecordCountDto>({ actualQuantity: 8 }),
        testTenantId,
        userId,
      );

      const data = prisma.cycleCountItem.update.mock.calls[0][0].data;
      expect(data.actualQuantity).toBe(8);
      expect(data.variance).toBe(-2);
      expect(data.variancePercent).toBeCloseTo(-20, 5);
      expect(data.status).toBe(CycleCountItemStatus.COUNTED);
      expect(gateway.broadcastItemUpdate).toHaveBeenCalled();
    });

    it('uses zero percent when expected quantity is zero', async () => {
      prisma.cycleCount.findFirst.mockResolvedValue({
        ...count,
        status: CycleCountStatus.IN_PROGRESS,
      });
      prisma.cycleCountItem.findFirst.mockResolvedValue({ ...item, expectedQuantity: 0 });
      prisma.cycleCountItem.update.mockResolvedValue({ id: 'it-1' });

      await service.recordItemCount(
        countId,
        'it-1',
        asDto<RecordCountDto>({ actualQuantity: 4 }),
        testTenantId,
        userId,
      );

      expect(prisma.cycleCountItem.update.mock.calls[0][0].data.variancePercent).toBe(0);
    });
  });

  describe('getItems', () => {
    it('throws when the count is missing', async () => {
      prisma.cycleCount.findFirst.mockResolvedValue(null);
      await expect(service.getItems(countId, testTenantId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns items scoped to the count', async () => {
      prisma.cycleCount.findFirst.mockResolvedValue(count);
      prisma.cycleCountItem.findMany.mockResolvedValue([{ id: 'it-1' }]);

      const result = await service.getItems(countId, testTenantId);

      expect(prisma.cycleCountItem.findMany.mock.calls[0][0].where).toEqual({
        cycleCountId: countId,
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('cancel', () => {
    it('rejects an already-completed count', async () => {
      prisma.cycleCount.findFirst.mockResolvedValue({
        ...count,
        status: CycleCountStatus.COMPLETED,
      });
      await expect(service.cancel(countId, testTenantId, userId)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('soft-deletes a scheduled count', async () => {
      prisma.cycleCount.findFirst.mockResolvedValue(count);
      prisma.cycleCount.update.mockResolvedValue({});

      await service.cancel(countId, testTenantId, userId);

      expect(prisma.cycleCount.update.mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date);
    });
  });

  describe('reconcile', () => {
    const items = [
      { id: 'it-1', inventoryItemId: 'i-1', expectedQuantity: 10, actualQuantity: 12 },
      { id: 'it-2', inventoryItemId: 'i-2', expectedQuantity: 10, actualQuantity: 7 },
      { id: 'it-3', inventoryItemId: 'i-3', expectedQuantity: 10, actualQuantity: null },
      { id: 'it-4', inventoryItemId: 'i-4', expectedQuantity: 10, actualQuantity: 10 },
    ];
    const completed = { ...count, status: CycleCountStatus.COMPLETED, items };

    it('rejects a count that is not completed or approved', async () => {
      prisma.cycleCount.findFirst.mockResolvedValue(count);
      await expect(service.reconcile(countId, testTenantId, userId)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('claims the count, applies positive and negative variances, and skips null/zero', async () => {
      prisma.cycleCount.findFirst
        .mockResolvedValueOnce(completed)
        .mockResolvedValueOnce({ ...completed, status: CycleCountStatus.RECONCILED });
      prisma.cycleCount.updateMany.mockResolvedValue({ count: 1 });
      prisma.inventoryItem.updateMany.mockResolvedValue({ count: 1 });

      await service.reconcile(countId, testTenantId, userId);

      expect(prisma.cycleCount.updateMany.mock.calls[0][0].data).toMatchObject({
        status: CycleCountStatus.RECONCILED,
        approvedById: userId,
      });
      expect(prisma.inventoryItem.updateMany).toHaveBeenCalledTimes(2);
      const inc = prisma.inventoryItem.updateMany.mock.calls[0][0];
      expect(inc.data.currentQuantity.increment.toString()).toBe('2');
      const dec = prisma.inventoryItem.updateMany.mock.calls[1][0];
      expect(dec.data.currentQuantity.decrement.toString()).toBe('3');
      expect(dec.where).toMatchObject({
        id: 'i-2',
        tenantId: testTenantId,
        currentQuantity: { gte: expect.anything() },
      });
      expect(prisma.inventoryItem.updateMany.mock.calls[1][0].data.version).toEqual({
        increment: 1,
      });
      expect(gateway.broadcastCycleCountUpdate).toHaveBeenCalledWith(
        testTenantId,
        'cycle-count.reconciled',
        expect.anything(),
      );
    });

    it('rejects when another reconcile already claimed the count', async () => {
      prisma.cycleCount.findFirst.mockResolvedValue(completed);
      prisma.cycleCount.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.reconcile(countId, testTenantId, userId)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.inventoryItem.updateMany).not.toHaveBeenCalled();
    });

    it('rejects when an item CAS fails', async () => {
      prisma.cycleCount.findFirst.mockResolvedValue({ ...completed, items: [items[0]] });
      prisma.cycleCount.updateMany.mockResolvedValue({ count: 1 });
      prisma.inventoryItem.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.reconcile(countId, testTenantId, userId)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('throws when the count disappears after reconciliation', async () => {
      prisma.cycleCount.findFirst
        .mockResolvedValueOnce({ ...completed, items: [] })
        .mockResolvedValueOnce(null);
      prisma.cycleCount.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.reconcile(countId, testTenantId, userId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
