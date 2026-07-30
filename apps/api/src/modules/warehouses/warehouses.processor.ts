import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QueueService, QueueJobData } from '../queues/queue.service';

@Injectable()
export class WarehousesProcessor {
  private readonly logger = new Logger(WarehousesProcessor.name);

  constructor(private readonly queueService: QueueService) {
    this.queueService.registerWorker(
      'warehouse-analytics',
      this.handleWarehouseAnalytics.bind(this),
    );
  }

  private async handleWarehouseAnalytics(job: Job<QueueJobData>) {
    this.logger.log(`Processing warehouse analytics ${job.id}`);
    const { tenantId, payload } = job.data;
    this.logger.log(`Warehouse analytics for tenant ${tenantId}: ${JSON.stringify(payload)}`);
    return { processed: true };
  }
}
