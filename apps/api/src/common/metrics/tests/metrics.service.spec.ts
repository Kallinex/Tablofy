import { ConfigService } from '@nestjs/config';
import { register } from 'prom-client';
import { MetricsService } from '../metrics.service';

jest.mock('perf_hooks', () => {
  const actual = jest.requireActual('perf_hooks');
  return {
    ...actual,
    PerformanceObserver: class {
      constructor(callback: unknown) {
        (globalThis as Record<string, unknown>).__gcObserver = callback;
      }
      observe(): void {
        return undefined;
      }
      disconnect(): void {
        return undefined;
      }
    },
  };
});

const getGcObserver = (): ((list: unknown) => void) | undefined =>
  (globalThis as unknown as { __gcObserver?: (list: unknown) => void }).__gcObserver;

describe('MetricsService', () => {
  const configService = {
    get: jest.fn((key: string, fallback?: unknown) => {
      if (key === 'metrics.collectDefaultMetrics') return false;
      if (key === 'metrics.collectIntervalMs') return 0;
      return fallback;
    }),
  } as unknown as ConfigService;

  beforeEach(() => {
    register.clear();
    delete (globalThis as Record<string, unknown>).__gcObserver;
    jest.clearAllMocks();
  });

  it('records GC pause durations, splitting major and minor collections', () => {
    const service = new MetricsService(configService);
    const set = jest.spyOn(service.gcDuration, 'set');

    service.onModuleInit();

    const observer = getGcObserver();
    expect(observer).toBeDefined();
    observer!({
      getEntries: () => [
        { duration: 12, detail: { kind: 2 } },
        { duration: 4, detail: { kind: 1 } },
      ],
    });

    expect(set).toHaveBeenCalledWith({ type: 'major' }, 12);
    expect(set).toHaveBeenCalledWith({ type: 'minor' }, 4);

    service.onModuleDestroy();
  });

  it('treats a missing GC kind as a minor collection', () => {
    const service = new MetricsService(configService);
    const set = jest.spyOn(service.gcDuration, 'set');

    service.onModuleInit();
    getGcObserver()!({ getEntries: () => [{ duration: 2.5 }] });

    expect(set).toHaveBeenCalledWith({ type: 'minor' }, 2.5);

    service.onModuleDestroy();
  });
});
