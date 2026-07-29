import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QueueService, QueueJobData } from '../queues/queue.service';

@Injectable()
export class TransfersProcessor {
  private readonly logger = new Logger(TransfersProcessor.name);

  constructor(private readonly queueService: QueueService) {
    this.queueService.registerWorker('transfer-notifications', this.handleTransferNotification.bind(this));
  }

  private async handleTransferNotification(job: Job<QueueJobData>) {
    this.logger.log(`Processing transfer notification ${job.id}`);
    const { tenantId, userId, payload } = job.data;
    this.logger.log(`Transfer notification for tenant ${tenantId} user ${userId}: ${JSON.stringify(payload)}`);
    return { processed: true };
  }
}
