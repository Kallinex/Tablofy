import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QueueService, QueueJobData } from '../queues/queue.service';

@Injectable()
export class SupplierPerformanceProcessor {
  private readonly logger = new Logger(SupplierPerformanceProcessor.name);

  constructor(private readonly queueService: QueueService) {
    this.queueService.registerWorker(
      'supplier-performance-calculation',
      this.handleCalculation.bind(this),
    );
  }

  private async handleCalculation(job: Job<QueueJobData>) {
    this.logger.log(`Processing supplier performance calculation ${job.id}`);
    const { tenantId, payload } = job.data;
    this.logger.log(`Performance calculation for tenant ${tenantId}: ${JSON.stringify(payload)}`);
    return { processed: true };
  }
}
