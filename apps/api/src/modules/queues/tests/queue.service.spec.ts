import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
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

  describe('queue creation listener', () => {
    it('notifies the listener exactly once per queue and not again on reuse', () => {
      const listener = jest.fn();
      service.setQueueListener(listener);

      service.getQueue('listened');
      service.getQueue('listened');
      service.getQueue('other');

      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener).toHaveBeenNthCalledWith(1, expect.objectContaining({ name: 'listened' }));
      expect(listener).toHaveBeenNthCalledWith(2, expect.objectContaining({ name: 'other' }));
    });

    it('does not require a listener to be registered', () => {
      service.setQueueListener(undefined as unknown as (queue: Queue) => void);

      expect(() => service.getQueue('no-listener')).not.toThrow();
      expect(service.getQueue('no-listener').name).toBe('no-listener');
    });
  });

  describe('registerWorker', () => {
    it('delegates job processing to the supplied processor', async () => {
      const processor = jest.fn().mockResolvedValue('done');
      service.registerWorker('exports', processor, 3);

      const worker = Worker.last;
      const job = { id: 'job-9', name: 'run', data: { tenantId: 't1', payload: {} } };

      await expect(worker!.processor!(job)).resolves.toBe('done');
      expect(processor).toHaveBeenCalledWith(job);
    });

    it('logs job completion through the completed handler', () => {
      service.registerWorker('completion-log', jest.fn());

      const worker = Worker.last;
      expect(worker!.handlers.completed).toBeDefined();

      expect(() => worker!.handlers.completed({ id: 'job-8' })).not.toThrow();
    });

    it('defaults the concurrency to five when none is supplied', () => {
      service.registerWorker('default-concurrency', jest.fn());

      expect(Worker.last!.concurrency).toBe(5);
    });

    it('ignores a duplicate worker registration for the same queue', () => {
      const first = jest.fn();
      const second = jest.fn();

      service.registerWorker('duplicated', first);
      const firstWorker = Worker.last;
      service.registerWorker('duplicated', second);

      expect(Worker.last).toBe(firstWorker);
    });

    it('materializes the queue so monitoring can observe it', () => {
      service.registerWorker('observed', jest.fn());

      expect(service.getQueueNames()).toContain('observed');
    });
  });

  describe('addJob', () => {
    it('enqueues the job with the supplied options', async () => {
      const job = await service.addJob(
        'email',
        'send',
        { tenantId: 't1', payload: { to: 'a@b.c' } },
        { delay: 500, priority: 3, jobId: 'custom-id' },
      );

      const queue = service.getQueue('email') as unknown as Queue;
      expect(queue.add).toHaveBeenCalledWith(
        'send',
        { tenantId: 't1', payload: { to: 'a@b.c' } },
        { jobId: 'custom-id', delay: 500, priority: 3 },
      );
      expect(job).toEqual(expect.objectContaining({ id: 'mock-job' }));
    });

    it('passes undefined options through when none are supplied', async () => {
      await service.addJob('cleanup', 'sweep', { tenantId: 't1', payload: {} });

      const queue = service.getQueue('cleanup') as unknown as Queue;
      expect(queue.add).toHaveBeenCalledWith(
        'sweep',
        { tenantId: 't1', payload: {} },
        { jobId: undefined, delay: undefined, priority: undefined },
      );
    });

    it('propagates a failure to enqueue', async () => {
      const queue = service.getQueue('orders') as unknown as Queue;
      queue.add.mockRejectedValueOnce(new Error('redis down'));

      await expect(service.addJob('orders', 'x', { tenantId: 't', payload: {} })).rejects.toThrow(
        'redis down',
      );
    });
  });

  describe('getQueueStats', () => {
    it('aggregates every counter for the queue', async () => {
      const queue = service.getQueue('reporting') as unknown as Queue;
      queue.getWaitingCount.mockResolvedValueOnce(4);
      queue.getActiveCount.mockResolvedValueOnce(2);
      queue.getCompletedCount.mockResolvedValueOnce(10);
      queue.getFailedCount.mockResolvedValueOnce(3);
      queue.getDelayedCount.mockResolvedValueOnce(1);

      await expect(service.getQueueStats('reporting')).resolves.toEqual({
        queue: 'reporting',
        waiting: 4,
        active: 2,
        completed: 10,
        failed: 3,
        delayed: 1,
      });
    });

    it('propagates a counter failure', async () => {
      const queue = service.getQueue('flaky') as unknown as Queue;
      queue.getWaitingCount.mockRejectedValueOnce(new Error('timeout'));

      await expect(service.getQueueStats('flaky')).rejects.toThrow('timeout');
    });
  });

  describe('lifecycle', () => {
    it('starts the dead-letter monitor on init and stops it on destroy', async () => {
      jest.useFakeTimers();
      const setIntervalSpy = jest.spyOn(global, 'setInterval');
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

      service.onModuleInit();
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60000);

      await service.onModuleDestroy();
      expect(clearIntervalSpy).toHaveBeenCalled();

      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
      jest.useRealTimers();
    });

    it('closes every queue and worker on destroy', async () => {
      const queue = service.getQueue('closed-queue') as unknown as Queue;
      service.registerWorker('closed-worker', jest.fn());
      const worker = Worker.last;

      await service.onModuleDestroy();

      expect(queue.close).toHaveBeenCalled();
      expect(worker!.close).toHaveBeenCalled();
    });

    it('reports dead-letter depth on every monitor tick', async () => {
      jest.useFakeTimers();
      service.onModuleInit();

      const queue = service.getQueue('dead-letter') as unknown as Queue;
      queue.getWaitingCount.mockResolvedValue(30);
      queue.getActiveCount.mockResolvedValue(20);
      queue.getDelayedCount.mockResolvedValue(5);

      await jest.advanceTimersByTimeAsync(60000);

      expect(metrics.setBullQueueDepth).toHaveBeenCalledWith('dead-letter', 'waiting', 55);

      await service.onModuleDestroy();
      jest.useRealTimers();
    });

    it('keeps the monitor quiet when the depth stays under the threshold', async () => {
      jest.useFakeTimers();
      service.onModuleInit();

      const queue = service.getQueue('dead-letter') as unknown as Queue;
      queue.getWaitingCount.mockResolvedValue(1);
      queue.getActiveCount.mockResolvedValue(0);
      queue.getDelayedCount.mockResolvedValue(0);

      await jest.advanceTimersByTimeAsync(60000);

      expect(metrics.setBullQueueDepth).toHaveBeenCalledWith('dead-letter', 'waiting', 1);
      const errorSpy = jest.spyOn(Logger.prototype, 'error');
      await jest.advanceTimersByTimeAsync(60000);
      const alertCalls = errorSpy.mock.calls.filter((args: unknown[]) =>
        String(args[0]).includes('exceeds alert threshold'),
      );
      expect(alertCalls).toHaveLength(0);
      errorSpy.mockRestore();

      await service.onModuleDestroy();
      jest.useRealTimers();
    });

    it('warns instead of throwing when the monitor cannot read the queue', async () => {
      jest.useFakeTimers();
      service.onModuleInit();

      const queue = service.getQueue('dead-letter') as unknown as Queue;
      queue.getWaitingCount.mockRejectedValue(new Error('connection reset'));

      await jest.advanceTimersByTimeAsync(60000);

      expect(metrics.setBullQueueDepth).not.toHaveBeenCalled();

      await service.onModuleDestroy();
      jest.useRealTimers();
    });
  });
});
