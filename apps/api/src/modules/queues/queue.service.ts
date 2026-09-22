import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, Job, JobsOptions } from 'bullmq';
import { MetricsService } from '../../common/metrics/metrics.service';
import { buildRedisConnectionOptions, RedisConnectionOptions } from '../../config/redis.config';

export interface QueueJobData {
  tenantId?: string;
  userId?: string;
  payload: Record<string, unknown>;
}

export type NotificationJobPayload = {
  title: string;
  message: string;
  type: string;
  channel: 'push' | 'email' | 'in_app' | 'sms';
  recipientUserIds?: string[];
  meta?: Record<string, unknown>;
} & Record<string, unknown>;

interface QueueJobOptions {
  attempts?: number;
  backoff?: { type: 'exponential'; delay: number };
  timeout?: number;
  removeOnComplete?: { age: number; count: number };
  removeOnFail?: { age: number; count: number };
}

const BASE_JOB_OPTIONS: QueueJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: { age: 86400, count: 1000 },
  removeOnFail: { age: 604800, count: 500 },
};

const QUEUE_JOB_OPTIONS: Record<string, QueueJobOptions> = {
  email: { attempts: 5, backoff: { type: 'exponential', delay: 2000 }, timeout: 30000 },
  notification: { attempts: 5, backoff: { type: 'exponential', delay: 2000 }, timeout: 30000 },
  'webhook-delivery': {
    attempts: 5,
    backoff: { type: 'exponential', delay: 3000 },
    timeout: 30000,
  },
  'webhook-retry': { attempts: 3, timeout: 30000 },
  cleanup: { attempts: 2, timeout: 60000 },
  print: { attempts: 3, timeout: 30000 },
  kitchen: { attempts: 3, timeout: 60000 },
  'export-engine': { attempts: 2, timeout: 300000 },
  'forecast-generation': { attempts: 2, timeout: 600000 },
  'warehouse-analytics': { attempts: 2, timeout: 300000 },
  'supplier-performance-calculation': { attempts: 2, timeout: 300000 },
  'daily-valuation': { attempts: 2, timeout: 300000 },
  'crm-jobs': { attempts: 2, timeout: 300000 },
  'scheduled-notifications': { attempts: 3, timeout: 60000 },
  'campaign-execution': { attempts: 2, timeout: 300000 },
  'inventory-sync': { attempts: 3, timeout: 60000 },
  'low-stock-alerts': { attempts: 3, timeout: 60000 },
  'expiration-checks': { attempts: 3, timeout: 60000 },
  'waste-reports': { attempts: 3, timeout: 60000 },
  'dead-letter': { attempts: 1, removeOnComplete: { age: 604800, count: 1000 } },
};

const DLQ_MONITOR_INTERVAL_MS = 60000;

export const QUEUE_NAMES: ReadonlyArray<string> = Object.freeze(Object.keys(QUEUE_JOB_OPTIONS));

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private queues = new Map<string, Queue>();
  private workers = new Map<string, Worker>();
  private dlqMonitor?: NodeJS.Timeout;
  private readonly dlqAlertThreshold: number;
  private onQueueCreated?: (queue: Queue) => void;

  private redisConfig: RedisConnectionOptions;

  constructor(
    private readonly configService: ConfigService,
    private readonly metricsService: MetricsService,
  ) {
    this.redisConfig = buildRedisConnectionOptions(this.configService, {
      maxRetriesPerRequest: null,
    });
    this.dlqAlertThreshold = parseInt(process.env.QUEUE_DLQ_ALERT_THRESHOLD || '50', 10);
  }

  onModuleInit() {
    this.logger.log('QueueService initialized');
    this.startDlqMonitor();
  }

  async onModuleDestroy() {
    if (this.dlqMonitor) {
      clearInterval(this.dlqMonitor);
    }
    for (const [name, queue] of this.queues) {
      await queue.close();
      this.logger.log(`Queue "${name}" closed`);
    }
    for (const [name, worker] of this.workers) {
      await worker.close();
      this.logger.log(`Worker "${name}" closed`);
    }
  }

  getQueue(name: string): Queue {
    if (!this.queues.has(name)) {
      const queue = new Queue(name, {
        connection: this.redisConfig,
        defaultJobOptions: {
          ...BASE_JOB_OPTIONS,
          ...(QUEUE_JOB_OPTIONS[name] || {}),
        } as JobsOptions,
      });
      this.queues.set(name, queue);
      this.onQueueCreated?.(queue);
    }
    return this.queues.get(name)!;
  }

  setQueueListener(listener: (queue: Queue) => void): void {
    this.onQueueCreated = listener;
  }

  getQueueNames(): string[] {
    return Array.from(this.queues.keys());
  }

  registerWorker(
    name: string,
    processor: (job: Job<QueueJobData>) => Promise<unknown>,
    concurrency = 5,
  ): void {
    if (this.workers.has(name)) {
      this.logger.warn(`Worker "${name}" already registered, skipping`);
      return;
    }

    // Materialize the queue instance so monitoring (Bull Board, health checks,
    // stats) sees every queue that has a worker.
    this.getQueue(name);

    const worker = new Worker<QueueJobData>(
      name,
      async (job) => {
        this.logger.log(`Processing job ${job.id} in queue "${name}"`);
        return processor(job);
      },
      {
        connection: this.redisConfig,
        concurrency,
      },
    );

    worker.on('completed', (job) => {
      this.logger.log(`Job ${job.id} completed in queue "${name}"`);
    });

    worker.on('failed', (job, err) => {
      if (!job) {
        return;
      }
      const durationMs = job.processedOn && job.finishedOn ? job.finishedOn - job.processedOn : 0;
      this.metricsService.observeBullJob(name, 'failed', durationMs);
      this.logger.error(`Job ${job.id} failed in queue "${name}": ${err.message}`);
      const attempts = job.opts.attempts ?? 1;
      const exhausted = (job.attemptsMade ?? 0) >= attempts;
      if (exhausted) {
        void this.sendToDeadLetter(name, job, err);
      }
    });

    this.workers.set(name, worker);
    this.logger.log(`Worker registered for queue "${name}" with concurrency ${concurrency}`);
  }

  private async sendToDeadLetter(
    queueName: string,
    job: Job<QueueJobData>,
    err: Error,
  ): Promise<void> {
    try {
      const dlq = this.getQueue('dead-letter');
      await dlq.add('dead-letter', {
        originalQueue: queueName,
        originalJobId: job.id,
        originalJobName: job.name,
        data: job.data,
        error: { message: err.message, stack: err.stack },
        attemptsMade: job.attemptsMade,
        failedAt: new Date().toISOString(),
      });
      this.metricsService.incrementBullQueueDeadLetter(queueName);
      this.logger.error(
        `Job ${job.id} exhausted retries in queue "${queueName}" and was moved to the dead letter queue`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to enqueue job ${job.id} to dead letter queue: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private startDlqMonitor() {
    this.dlqMonitor = setInterval(async () => {
      try {
        const stats = await this.getQueueStats('dead-letter');
        const depth = stats.waiting + stats.active + stats.delayed;
        this.metricsService.setBullQueueDepth('dead-letter', 'waiting', depth);
        if (depth > this.dlqAlertThreshold) {
          this.logger.error(
            `Dead letter queue depth ${depth} exceeds alert threshold ${this.dlqAlertThreshold}`,
          );
        }
      } catch (error) {
        this.logger.warn(
          `Dead letter queue monitor unavailable: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }, DLQ_MONITOR_INTERVAL_MS);
    this.dlqMonitor.unref();
  }

  async addJob(
    queueName: string,
    jobName: string,
    data: QueueJobData,
    opts?: { delay?: number; priority?: number; jobId?: string },
  ): Promise<Job<QueueJobData>> {
    const queue = this.getQueue(queueName);
    const job = await queue.add(jobName, data, {
      jobId: opts?.jobId,
      delay: opts?.delay,
      priority: opts?.priority,
    });
    this.logger.log(`Job "${jobName}" added to queue "${queueName}" (id: ${job.id})`);
    return job;
  }

  async getQueueStats(queueName: string) {
    const queue = this.getQueue(queueName);
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);
    return { queue: queueName, waiting, active, completed, failed, delayed };
  }
}
