import { Global, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { QueueModule } from '../queue.module';
import { ExportEngineModule } from '../../export-engine/export-engine.module';
import { QueueService } from '../queue.service';
import { CleanupProcessor } from '../cleanup.processor';
import { ExportEngineService } from '../../export-engine/export-engine.service';
import { ExportStorageService } from '../../export-engine/export-storage.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { MetricsService } from '../../../common/metrics/metrics.service';
import { createMockMetrics } from '../../../test/mocks/metrics.mock';

/**
 * P1 regression guard for the CleanupProcessor -> ExportStorageService
 * dependency that was never exposed through ExportEngineModule's exports.
 *
 * This suite compiles the REAL QueueModule + ExportEngineModule graph that
 * AppModule uses (AppModule imports both modules; QueueModule is @Global and
 * imports ExportEngineModule). Only connection-dependent infrastructure
 * (Config/Prisma/Redis/Metrics/EventEmitter) is provided as inert stand-ins so
 * the graph can be constructed without a live Postgres/Redis. The dependency
 * under test (CleanupProcessor -> ExportStorageService) is completely real and
 * resolved by Nest through the module graph: if ExportStorageService leaves
 * ExportEngineModule's exports again, Nest throws "Nest can't resolve
 * dependencies ... ExportStorageService at index [3]" during compile() and this
 * suite fails.
 */
@Global()
@Module({
  providers: [
    {
      provide: ConfigService,
      useValue: {
        get: jest.fn((key: string, fallback?: unknown) => {
          if (key === 'redis.host') return 'localhost';
          if (key === 'redis.port') return 6379;
          return fallback;
        }),
      },
    },
    { provide: PrismaService, useValue: {} },
    { provide: RedisService, useValue: {} },
    { provide: MetricsService, useValue: createMockMetrics() },
    { provide: EventEmitter2, useValue: { emit: jest.fn(), on: jest.fn() } },
  ],
  exports: [ConfigService, PrismaService, RedisService, MetricsService, EventEmitter2],
})
class InfraTestModule {}

describe('QueueModule DI wiring (P1 regression: CleanupProcessor -> ExportStorageService)', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [InfraTestModule, ExportEngineModule, QueueModule],
    }).compile();
  });

  afterAll(async () => {
    if (moduleRef) {
      await moduleRef.close();
    }
  });

  it('resolves CleanupProcessor with the real ExportStorageService instance exported by ExportEngineModule', () => {
    const cleanupProcessor = moduleRef.get(CleanupProcessor);
    const exportStorage = moduleRef.get(ExportStorageService);

    expect(cleanupProcessor).toBeInstanceOf(CleanupProcessor);
    expect(exportStorage).toBeInstanceOf(ExportStorageService);

    const injected = (cleanupProcessor as unknown as { exportStorageService: ExportStorageService })
      .exportStorageService;
    expect(injected).toBe(exportStorage);
  });

  it('exposes ExportStorageService and QueueService through the real module graph', () => {
    expect(moduleRef.get(QueueService)).toBeInstanceOf(QueueService);
    expect(moduleRef.get(ExportEngineService)).toBeInstanceOf(ExportEngineService);
    expect(moduleRef.get(ExportStorageService)).toBeInstanceOf(ExportStorageService);
  });
});
