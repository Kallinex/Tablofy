import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { QueueService, QueueJobData } from './queue.service';
import { MetricsService } from '../../common/metrics/metrics.service';

interface DeadLetterJobData {
  originalQueue?: string;
  originalJobId?: string;
  originalJobName?: string;
  data?: unknown;
  error?: { message?: string; stack?: string };
  attemptsMade?: number;
  failedAt?: string;
}

@Injectable()
export class DeadLetterProcessor {
  private readonly logger = new Logger(DeadLetterProcessor.name);

  constructor(
    private readonly queueService: QueueService,
    private readonly metricsService: MetricsService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.queueService.registerWorker('dead-letter', this.handleDeadLetter.bind(this), 5);
  }

  private async handleDeadLetter(job: Job<QueueJobData>) {
    const data = job.data as unknown as DeadLetterJobData;
    const originalQueue = data.originalQueue ?? 'unknown';
    const originalJobId = data.originalJobId ?? job.id;
    this.logger.error(
      `Dead letter job ${job.id} (original queue "${originalQueue}", original job ${originalJobId})`,
      {
        originalQueue,
        originalJobId,
        originalJobName: data.originalJobName,
        attemptsMade: data.attemptsMade,
        failedAt: data.failedAt,
        error: data.error?.message,
      },
    );

    this.metricsService.incrementBullQueueDeadLetter(originalQueue);

    this.eventEmitter.emit('queue.dead-letter', {
      queue: originalQueue,
      jobId: originalJobId,
      jobName: data.originalJobName,
      attemptsMade: data.attemptsMade,
      failedAt: data.failedAt,
      error: data.error?.message,
    });

    return { consumed: true, originalQueue };
  }
}
