import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QueueService, QueueJobData } from '../queues/queue.service';

@Injectable()
export class PurchasingProcessor {
  private readonly logger = new Logger(PurchasingProcessor.name);

  constructor(private readonly queueService: QueueService) {
    this.queueService.registerWorker('purchase-notifications', this.handlePurchaseNotifications.bind(this));
    this.queueService.registerWorker('purchase-analytics', this.handlePurchaseAnalytics.bind(this));
  }

  private async handlePurchaseNotifications(job: Job<QueueJobData>) {
    this.logger.log(`Processing purchase notification ${job.id}`);
    const { tenantId, userId, payload } = job.data;
    this.logger.log(`Purchase notification for tenant ${tenantId} user ${userId}: ${JSON.stringify(payload)}`);
    return { processed: true };
  }

  private async handlePurchaseAnalytics(job: Job<QueueJobData>) {
    this.logger.log(`Processing purchase analytics ${job.id}`);
    const { tenantId, payload } = job.data;
    this.logger.log(`Purchase analytics for tenant ${tenantId}: ${JSON.stringify(payload)}`);
    return { processed: true };
  }
}
