import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { QueueService } from '../queue.service';
import { MetricsService } from '../../../common/metrics/metrics.service';
import { createMockMetrics, MockMetrics } from '../../../test/mocks/metrics.mock';
import { Queue, Worker } from '../../../test/mocks/bullmq.mock';
describe('QueueService', () => {
  let service: QueueService;
  let metrics: MockMetrics;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'redis.host') return 'localhost';
              if (key === 'redis.port') return 6379;
              return undefined;
            }),
          },
        },
        { provide: MetricsService, useValue: createMockMetrics() },
      ],
    }).compile();

    service = module.get<QueueService>(QueueService);
    metrics = module.get(MetricsService) as MockMetrics;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('per-queue default job options', () => {
    it('applies queue-specific attempts/backoff/timeout for email', () => {
      service.getQueue('email');
      expect(Queue.last).not.toBeNull();
      expect(Queue.last!.name).toBe('email');
      const opts = Queue.last!.opts.defaultJobOptions as Record<string, unknown>;
      expect(opts.attempts).toBe(5);
      expect(opts.timeout).toBe(30000);
      expect((opts.backoff as { delay: number }).delay).toBe(2000);
    });

    it('applies a longer timeout for export-engine', () => {
      service.getQueue('export-engine');
      expect((Queue.last!.opts.defaultJobOptions as Record<string, unknown>).timeout).toBe(300000);
    });

    it('falls back to base defaults for unconfigured queues', () => {
      service.getQueue('some-queue');
      const opts = Queue.last!.opts.defaultJobOptions as Record<string, unknown>;
      expect(opts.attempts).toBe(3);
      expect(opts.timeout).toBeUndefined();
    });

    it('prevents retries on the dead-letter queue', () => {
      service.getQueue('dead-letter');
      expect((Queue.last!.opts.defaultJobOptions as Record<string, unknown>).attempts).toBe(1);
    });
  });

  describe('dead letter queue', () => {
    it('moves an exhausted failed job to the dead letter queue', async () => {
      service.registerWorker('email', jest.fn().mockResolvedValue(undefined));

      const worker = Worker.last;
      expect(worker).not.toBeNull();
      expect(worker!.handlers.failed).toBeDefined();

      const failedJob = {
        id: 'job-1',
        name: 'send',
        data: { tenantId: 't1', payload: {} },
        attemptsMade: 5,
        opts: { attempts: 5 },
        processedOn: 1000,
        finishedOn: 2000,
      };
      const err = new Error('boom');

      await worker!.handlers.failed(failedJob, err);

      const dlqQueue = Queue.last;
      expect(dlqQueue!.name).toBe('dead-letter');
      expect((dlqQueue as unknown as Queue).add).toHaveBeenCalledWith(
        'dead-letter',
        expect.objectContaining({
          originalQueue: 'email',
          originalJobId: 'job-1',
          error: { message: 'boom', stack: expect.any(String) },
        }),
      );
      expect(metrics.incrementBullQueueDeadLetter).toHaveBeenCalledWith('email');
    });

    it('does not move a failed job that still has retries left', async () => {
      service.registerWorker('notification', jest.fn().mockResolvedValue(undefined));

      const worker = Worker.last;
      const failedJob = {
        id: 'job-2',
        name: 'send',
        data: { tenantId: 't1', payload: {} },
        attemptsMade: 1,
        opts: { attempts: 5 },
        processedOn: 1000,
        finishedOn: 2000,
      };

      await worker!.handlers.failed(failedJob, new Error('transient'));

      expect((Queue.last as unknown as Queue).add).not.toHaveBeenCalled();
      expect(metrics.incrementBullQueueDeadLetter).not.toHaveBeenCalled();
    });

    it('reports the failed job duration metric', async () => {
      service.registerWorker('cleanup', jest.fn().mockResolvedValue(undefined));
      const worker = Worker.last;

      const failedJob = {
        id: 'job-3',
        name: 'run',
        data: { tenantId: 't1', payload: {} },
        attemptsMade: 2,
        opts: { attempts: 2 },
        processedOn: 1000,
        finishedOn: 3000,
      };

      await worker!.handlers.failed(failedJob, new Error('done'));

      expect(metrics.observeBullJob).toHaveBeenCalledWith('cleanup', 'failed', 2000);
    });
  });

  describe('getQueueNames', () => {
    it('returns the names of created queues', () => {
      service.getQueue('email');
      service.getQueue('cleanup');
      expect(service.getQueueNames()).toEqual(expect.arrayContaining(['email', 'cleanup']));
    });
  });
});
