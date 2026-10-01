import { Test, TestingModule } from '@nestjs/testing';
import { ForecastingDashboardService } from '../forecasting-dashboard.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockCache, MockCache } from '../../../test/mocks/cache.mock';
import { createMockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';

describe('ForecastingDashboardService', () => {
  let service: ForecastingDashboardService;
  let prisma: MockPrisma;
  let cache: MockCache;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ForecastingDashboardService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: CacheService, useValue: createMockCache() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
      ],
    }).compile();

    service = module.get<ForecastingDashboardService>(ForecastingDashboardService);
    prisma = module.get(PrismaService) as MockPrisma;
    cache = module.get(CacheService) as MockCache;
  });

  beforeEach(() => {
    prisma.reset();
    cache.reset();
    jest.clearAllMocks();
  });

  describe('getInventoryForecast', () => {
    it('divides consumption sums by original-only records, excluding reversal rows', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([
        {
          id: 'item-1',
          name: 'Flour',
          sku: 'SKU-1',
          currentQuantity: 100,
          unitCost: 5,
          averageCost: 6,
        },
      ]);
      prisma.inventoryForecast.findMany.mockResolvedValue([]);
      // records (net SUM inputs incl. one reversal) then observationRecords (originals only)
      prisma.consumptionRecord.findMany
        .mockResolvedValueOnce([
          { inventoryItemId: 'item-1', quantity: -5 },
          { inventoryItemId: 'item-1', quantity: -15 },
        ])
        .mockResolvedValueOnce([{ inventoryItemId: 'item-1' }]);

      const result = (await service.getInventoryForecast(testTenantId, {} as never)) as {
        projections: unknown;
      };

      const secondCall = prisma.consumptionRecord.findMany.mock.calls[1][0] as {
        where: Record<string, unknown>;
      };
      expect(secondCall.where.reversedFromId).toBeNull();
      const projections = result.projections as Array<{ avgDailyConsumption: number }>;
      expect(projections[0].avgDailyConsumption).toBe(-20);
    });
  });

  describe('periodsToDays', () => {
    it('maps named periods to their day span and defaults to a single day', () => {
      const days = (
        service as unknown as { periodsToDays: (period?: string) => number }
      ).periodsToDays.bind(service);

      expect(days('WEEKLY')).toBe(7);
      expect(days('MONTHLY')).toBe(30);
      expect(days('DAILY')).toBe(1);
      expect(days(undefined)).toBe(1);
    });
  });
});
