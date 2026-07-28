import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, Job } from 'bullmq';

export interface QueueJobData {
  tenantId?: string;
  userId?: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private queues = new Map<string, Queue>();
  private workers = new Map<string, Worker>();

  private redisConfig: { host: string; port: number; maxRetriesPerRequest: number | null };

  constructor(private readonly configService: ConfigService) {
    this.redisConfig = {
      host: this.configService.get<string>('redis.host', 'localhost'),
      port: this.configService.get<number>('redis.port', 6379),
      maxRetriesPerRequest: null,
    };
  }

  onModuleInit() {
    this.logger.log('QueueService initialized');
  }

  async onModuleDestroy() {
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
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: { age: 86400, count: 1000 },
          removeOnFail: { age: 604800, count: 500 },
        },
      });
      this.queues.set(name, queue);
    }
    return this.queues.get(name)!;
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
      this.logger.error(`Job ${job?.id} failed in queue "${name}": ${err.message}`);
    });

    this.workers.set(name, worker);
    this.logger.log(`Worker registered for queue "${name}" with concurrency ${concurrency}`);
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
