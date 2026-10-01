import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ValuationMethod } from '@prisma/client';
import { CostingService } from '../costing.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockCache, MockCache } from '../../../test/mocks/cache.mock';
import { createMockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';
import { CreateValuationDto } from '../dto/create-valuation.dto';
import { BatchValuationDto } from '../dto/query-valuation.dto';

const userId = 'user-1';
const itemId = 'inv-1';
const asDto = <T>(value: Record<string, unknown>) => value as unknown as T;

describe('CostingService', () => {
  let service: CostingService;
  let prisma: MockPrisma;
  let audit: MockAuditLogs;
  let cache: MockCache;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CostingService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: CacheService, useValue: createMockCache() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
      ],
    }).compile();

    service = module.get<CostingService>(CostingService);
    prisma = module.get(PrismaService) as MockPrisma;
    audit = module.get(AuditLogsService) as MockAuditLogs;
    cache = module.get(CacheService) as unknown as MockCache;
  });

  beforeEach(() => {
    prisma.reset();
    audit.reset();
    cache.reset();
  });

  const item = { id: itemId, currentQuantity: 10, averageCost: 5, unitCost: 4 };

  describe('createValuation', () => {
    it('throws when the item is missing', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(null);
      await expect(
        service.createValuation(
          asDto<CreateValuationDto>({ inventoryItemId: itemId, valuationDate: '2026-01-01' }),
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('uses weighted average by default and stores quantity * unitCost', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(item);
      prisma.inventoryValuation.create.mockResolvedValue({ id: 'v-1' });

      await service.createValuation(
        asDto<CreateValuationDto>({ inventoryItemId: itemId, valuationDate: '2026-01-01' }),
        testTenantId,
        userId,
      );

      const data = prisma.inventoryValuation.create.mock.calls[0][0].data;
      expect(data.method).toBe(ValuationMethod.WEIGHTED_AVERAGE);
      expect(data.unitCost).toBe(5);
      expect(data.totalValue).toBe(50);
      expect(data.quantity).toBe(10);
      expect(cache.deletePattern).toHaveBeenCalledWith(
        testTenantId,
        expect.stringContaining('valuation'),
      );
    });

    it('uses the oldest active batch for FIFO', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(item);
      prisma.inventoryBatch.findMany.mockResolvedValue([{ unitCost: '3.5' }]);
      prisma.inventoryValuation.create.mockResolvedValue({ id: 'v-2' });

      await service.createValuation(
        asDto<CreateValuationDto>({
          inventoryItemId: itemId,
          valuationDate: '2026-01-01',
          method: ValuationMethod.FIFO,
        }),
        testTenantId,
        userId,
      );

      expect(prisma.inventoryValuation.create.mock.calls[0][0].data.unitCost).toBe(3.5);
    });

    it('falls back to goods receipts, scoped by tenant', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(item);
      prisma.inventoryBatch.findMany.mockResolvedValue([]);
      prisma.goodsReceiptItem.findMany.mockResolvedValue([{ unitPrice: '4.25' }]);
      prisma.inventoryValuation.create.mockResolvedValue({ id: 'v-3' });

      await service.createValuation(
        asDto<CreateValuationDto>({
          inventoryItemId: itemId,
          valuationDate: '2026-01-01',
          method: ValuationMethod.FIFO,
        }),
        testTenantId,
        userId,
      );

      expect(prisma.goodsReceiptItem.findMany.mock.calls[0][0].where).toMatchObject({
        inventoryItemId: itemId,
        tenantId: testTenantId,
      });
      expect(prisma.inventoryValuation.create.mock.calls[0][0].data.unitCost).toBe(4.25);
    });
  });

  describe('getValuationsForItem', () => {
    it('throws when the item is missing', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(null);
      await expect(service.getValuationsForItem(itemId, testTenantId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns valuations scoped by tenant', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue({ id: itemId });
      prisma.inventoryValuation.findMany.mockResolvedValue([{ id: 'v-1' }]);

      const result = await service.getValuationsForItem(itemId, testTenantId);

      expect(prisma.inventoryValuation.findMany.mock.calls[0][0].where).toEqual({
        inventoryItemId: itemId,
        tenantId: testTenantId,
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('getValuation', () => {
    it('throws when not found', async () => {
      prisma.inventoryValuation.findFirst.mockResolvedValue(null);
      await expect(service.getValuation('v-1', testTenantId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('batchValuation', () => {
    it('rejects when no inventory items are found', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([]);
      await expect(
        service.batchValuation(asDto<BatchValuationDto>({}), testTenantId, userId),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('values every active item and reports the summary', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([{ id: 'inv-1' }, { id: 'inv-2' }]);
      prisma.inventoryItem.findFirst.mockResolvedValue(item);
      prisma.inventoryValuation.create.mockResolvedValue({ id: 'v-1' });

      const result = await service.batchValuation(
        asDto<BatchValuationDto>({}),
        testTenantId,
        userId,
      );

      expect(result.total).toBe(2);
      expect(result.method).toBe(ValuationMethod.WEIGHTED_AVERAGE);
    });

    it('filters to the requested item ids', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([]);
      await expect(
        service.batchValuation(
          asDto<BatchValuationDto>({ inventoryItemIds: ['inv-1', 'inv-2'] }),
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.inventoryItem.findMany.mock.calls[0][0].where).toMatchObject({
        tenantId: testTenantId,
        isActive: true,
        id: { in: ['inv-1', 'inv-2'] },
      });
    });
  });
});
