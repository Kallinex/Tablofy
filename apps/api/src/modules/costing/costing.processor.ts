import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QueueService, QueueJobData } from '../queues/queue.service';

@Injectable()
export class CostingProcessor {
  private readonly logger = new Logger(CostingProcessor.name);

  constructor(private readonly queueService: QueueService) {
    this.queueService.registerWorker('daily-valuation', this.handleDailyValuation.bind(this));
  }

  private async handleDailyValuation(job: Job<QueueJobData>) {
    this.logger.log(`Processing daily valuation ${job.id}`);
    const { tenantId, payload } = job.data;
    this.logger.log(`Daily valuation for tenant ${tenantId}: ${JSON.stringify(payload)}`);
    return { processed: true };
  }
}
