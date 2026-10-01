import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ForecastingService } from '../forecasting.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { QueueService } from '../../queues/queue.service';
import { ForecastingGateway } from '../forecasting.gateway';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockCache, MockCache } from '../../../test/mocks/cache.mock';
import { createMockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';

describe('ForecastingService forecast algorithms', () => {
  let service: ForecastingService;
  let prisma: MockPrisma;
  let cache: MockCache;

  const ITEM = { id: 'item-1', tenantId: testTenantId };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ForecastingService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: CacheService, useValue: createMockCache() },
        { provide: QueueService, useValue: { add: jest.fn(), addBulk: jest.fn() } },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
        {
          provide: ForecastingGateway,
          useValue: { broadcastForecastUpdate: jest.fn(), broadcastReorderUpdate: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<ForecastingService>(ForecastingService);
    prisma = module.get(PrismaService) as MockPrisma;
    cache = module.get(CacheService) as MockCache;
  });

  beforeEach(() => {
    prisma.reset();
    cache.reset();
    jest.clearAllMocks();
    cache.get.mockResolvedValue(null);
    prisma.inventoryItem.findFirst.mockResolvedValue(ITEM);
    prisma.inventoryForecast.create.mockResolvedValue({ id: 'fc-1' });
  });

  const daily = (startDay: number, days: number, base: number) =>
    Array.from({ length: days }, (_v, i) => ({
      date: new Date(Date.UTC(2025, 0, startDay + i)),
      quantity: base + i,
    }));

  const flat = (days: number, value: number) =>
    Array.from({ length: days }, (_v, i) => ({
      date: new Date(Date.UTC(2025, 0, i + 1)),
      quantity: value,
    }));

  async function forecastWith(
    records: Array<{ date: Date; quantity: number }>,
    dto: Record<string, unknown>,
  ) {
    prisma.consumptionRecord.findMany.mockResolvedValue(records);
    await service.generateForecast(
      { inventoryItemId: 'item-1', ...dto } as never,
      testTenantId,
      'user-1',
    );
    return prisma.inventoryForecast.create.mock.calls[0][0].data;
  }

  describe('consumption aggregation', () => {
    it('aggregates daily records by calendar day and sorts the buckets', async () => {
      const data = await forecastWith(
        [
          { date: new Date(Date.UTC(2025, 1, 3)), quantity: 2 },
          { date: new Date(Date.UTC(2025, 0, 1)), quantity: 1 },
          { date: new Date(Date.UTC(2025, 0, 1)), quantity: 3 },
          { date: new Date(Date.UTC(2025, 1, 3)), quantity: 1 },
        ],
        { period: 'DAILY' },
      );

      const rawData = (data.factors as { rawData: Array<{ period: string; total: number }> })
        .rawData;
      expect(rawData).toEqual([
        { period: '2025-01-01', total: 4 },
        { period: '2025-02-03', total: 3 },
      ]);
    });

    it('buckets records into the week that starts on the preceding Sunday', async () => {
      const data = await forecastWith(
        [
          { date: new Date(Date.UTC(2025, 0, 1)), quantity: 1 },
          { date: new Date(Date.UTC(2025, 0, 4)), quantity: 2 },
          { date: new Date(Date.UTC(2025, 0, 5)), quantity: 4 },
        ],
        { period: 'WEEKLY' },
      );

      const rawData = (data.factors as { rawData: Array<{ period: string; total: number }> })
        .rawData;
      expect(rawData).toEqual([
        { period: '2024-12-29', total: 3 },
        { period: '2025-01-05', total: 4 },
      ]);
    });

    it('buckets records into months', async () => {
      const data = await forecastWith(
        [
          { date: new Date(Date.UTC(2025, 0, 10)), quantity: 1 },
          { date: new Date(Date.UTC(2025, 0, 20)), quantity: 2 },
          { date: new Date(Date.UTC(2025, 2, 1)), quantity: 4 },
        ],
        { period: 'MONTHLY' },
      );

      const rawData = (data.factors as { rawData: Array<{ period: string; total: number }> })
        .rawData;
      expect(rawData).toEqual([
        { period: '2025-01', total: 3 },
        { period: '2025-03', total: 4 },
      ]);
    });
  });

  describe('calculateMovingAverage', () => {
    it('averages the trailing seven daily buckets for a moving average', async () => {
      const data = await forecastWith(daily(1, 10, 10), {
        period: 'DAILY',
        method: 'MOVING_AVERAGE',
      });

      // Trailing window is the last 7 buckets: 13..19, average 16.
      expect(Number(data.quantity)).toBe(16);
      expect(data.period).toBe('DAILY');
      expect(data.method).toBe('MOVING_AVERAGE');
    });

    it('derives confidence from the standard deviation of the window', async () => {
      const data = await forecastWith(flat(7, 4), {
        period: 'DAILY',
        method: 'EXPONENTIAL_SMOOTHING',
      });

      // A perfectly flat window has zero deviation, so confidence is 1.
      expect(Number(data.quantity)).toBe(4);
      expect(Number(data.confidence)).toBe(1);
    });

    it('lowers the confidence as the window becomes more volatile', async () => {
      const data = await forecastWith(
        [
          { date: new Date(Date.UTC(2025, 0, 1)), quantity: 10 },
          { date: new Date(Date.UTC(2025, 0, 2)), quantity: 10 },
          { date: new Date(Date.UTC(2025, 0, 3)), quantity: 10 },
          { date: new Date(Date.UTC(2025, 0, 4)), quantity: 10 },
          { date: new Date(Date.UTC(2025, 0, 5)), quantity: 10 },
          { date: new Date(Date.UTC(2025, 0, 6)), quantity: 10 },
          { date: new Date(Date.UTC(2025, 0, 7)), quantity: 20 },
        ],
        { period: 'DAILY', method: 'MOVING_AVERAGE' },
      );

      expect(Number(data.quantity)).toBe(11.43);
      expect(Number(data.confidence)).toBeCloseTo(0.6938, 4);
    });

    it('falls back to a flat average with low confidence for a short history', async () => {
      const data = await forecastWith(daily(1, 3, 4), {
        period: 'DAILY',
        method: 'MOVING_AVERAGE',
      });

      expect(Number(data.quantity)).toBe(5);
      expect(Number(data.confidence)).toBe(0.3);
    });

    it('reports zero confidence when the forecast quantity is zero', async () => {
      const data = await forecastWith(flat(7, 0), {
        period: 'DAILY',
        method: 'MOVING_AVERAGE',
      });

      expect(Number(data.quantity)).toBe(0);
      expect(Number(data.confidence)).toBe(0);
    });

    it('extrapolates a linear trend and reports its r-squared as confidence', async () => {
      const data = await forecastWith(daily(1, 4, 2), {
        period: 'DAILY',
        method: 'LINEAR_REGRESSION',
      });

      // Perfectly linear 2,3,4,5 -> forecast 6 with confidence 1.
      expect(Number(data.quantity)).toBe(6);
      expect(Number(data.confidence)).toBe(1);
    });

    it('never forecasts a negative linear trend', async () => {
      const data = await forecastWith(
        [
          { date: new Date(Date.UTC(2025, 0, 1)), quantity: 10 },
          { date: new Date(Date.UTC(2025, 0, 2)), quantity: 1 },
          { date: new Date(Date.UTC(2025, 0, 3)), quantity: 1 },
        ],
        { period: 'DAILY', method: 'LINEAR_REGRESSION' },
      );

      expect(Number(data.quantity)).toBe(0);
    });

    it('falls back to the simple average for a linear regression with a single point', async () => {
      const data = await forecastWith(daily(1, 1, 5), {
        period: 'DAILY',
        method: 'LINEAR_REGRESSION',
      });

      expect(Number(data.quantity)).toBe(5);
      expect(Number(data.confidence)).toBe(0.2);
    });

    it('projects a seasonal series from its second half plus the trend', async () => {
      const records = Array.from({ length: 16 }, (_v, i) => ({
        date: new Date(Date.UTC(2025, 0, i + 1)),
        quantity: i < 8 ? 10 : 20,
      }));

      const data = await forecastWith(records, {
        period: 'DAILY',
        method: 'SEASONAL',
      });

      // half = 8, firstHalf mean 10, secondHalf mean 20, trend (20-10)/8 = 1.25
      // forecast = 20 + 1.25 * 8 = 30 with a fixed 0.5 confidence.
      expect(Number(data.quantity)).toBe(30);
      expect(Number(data.confidence)).toBe(0.5);
    });

    it('uses a simple average for an unknown method', async () => {
      const data = await forecastWith(daily(1, 4, 6), {
        period: 'DAILY',
        method: 'SOMETHING_ELSE',
      });

      expect(Number(data.quantity)).toBeCloseTo(7.5, 5);
      expect(Number(data.confidence)).toBe(0.2);
    });

    it('reports no confidence when there is no consumption data at all', async () => {
      const data = await forecastWith([], {
        period: 'DAILY',
        method: 'SOMETHING_ELSE',
      });

      expect(Number(data.quantity)).toBe(0);
      expect(data.confidence).toBeUndefined();
    });

    it('windows monthly forecasts on three buckets', async () => {
      const records = [
        { date: new Date(Date.UTC(2025, 0, 1)), quantity: 10 },
        { date: new Date(Date.UTC(2025, 1, 1)), quantity: 20 },
        { date: new Date(Date.UTC(2025, 2, 1)), quantity: 30 },
        { date: new Date(Date.UTC(2025, 3, 1)), quantity: 40 },
      ];

      const data = await forecastWith(records, {
        period: 'MONTHLY',
        method: 'MOVING_AVERAGE',
      });

      expect(Number(data.quantity)).toBe(30);
    });

    it('windows weekly forecasts on four buckets', async () => {
      const data = await forecastWith(daily(1, 40, 10), {
        period: 'WEEKLY',
        method: 'MOVING_AVERAGE',
      });

      expect(Number(data.quantity)).toBeGreaterThan(0);
      const factors = data.factors as { rawData: Array<{ period: string; total: number }> };
      expect(factors.rawData.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('forecast window', () => {
    it('scopes the consumption query to the requested number of days', async () => {
      await forecastWith([], { days: 7 });

      const [args] = prisma.consumptionRecord.findMany.mock.calls[0];
      const cutoff = (args.where.date as { gte: Date }).gte;
      expect(Math.round((Date.now() - cutoff.getTime()) / 86400000)).toBe(7);
      expect(args.orderBy).toEqual({ date: 'asc' });
    });

    it('defaults the lookback to thirty days', async () => {
      await forecastWith([], {});

      const [args] = prisma.consumptionRecord.findMany.mock.calls[0];
      const cutoff = (args.where.date as { gte: Date }).gte;
      expect(Math.round((Date.now() - cutoff.getTime()) / 86400000)).toBe(30);
    });

    it('pushes the daily forecast date one day ahead', async () => {
      const before = Date.now();
      await forecastWith(daily(1, 2, 1), { period: 'DAILY' });
      const forecastDate = (
        prisma.inventoryForecast.create.mock.calls[0][0].data.forecastDate as Date
      ).getTime();

      expect(forecastDate).toBeGreaterThanOrEqual(before + 20 * 3600000);
      expect(forecastDate).toBeLessThanOrEqual(Date.now() + 2 * 86400000);
    });

    it('pushes the weekly forecast date seven days ahead', async () => {
      const before = Date.now();
      await forecastWith(daily(1, 40, 1), { period: 'WEEKLY' });
      const forecastDate = (
        prisma.inventoryForecast.create.mock.calls[0][0].data.forecastDate as Date
      ).getTime();

      expect(forecastDate).toBeGreaterThan(before + 6 * 86400000);
      expect(forecastDate).toBeLessThanOrEqual(Date.now() + 8 * 86400000);
    });

    it('pushes the monthly forecast date one month ahead', async () => {
      const before = new Date();
      await forecastWith(
        [
          { date: new Date(Date.UTC(2025, 0, 1)), quantity: 1 },
          { date: new Date(Date.UTC(2025, 1, 1)), quantity: 1 },
          { date: new Date(Date.UTC(2025, 2, 1)), quantity: 1 },
        ],
        { period: 'MONTHLY' },
      );
      const forecastDate = prisma.inventoryForecast.create.mock.calls[0][0].data
        .forecastDate as Date;

      expect(forecastDate.getMonth()).toBe((before.getMonth() + 1) % 12);
    });
  });
});
