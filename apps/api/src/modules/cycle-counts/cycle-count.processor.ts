import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QueueService, QueueJobData } from '../queues/queue.service';

@Injectable()
export class CycleCountProcessor {
  private readonly logger = new Logger(CycleCountProcessor.name);

  constructor(private readonly queueService: QueueService) {
    this.queueService.registerWorker('cycle-count-reminders', this.handleReminders.bind(this));
  }

  private async handleReminders(job: Job<QueueJobData>) {
    this.logger.log(`Processing cycle count reminder ${job.id}`);
    const { tenantId, payload } = job.data;
    this.logger.log(`Cycle count reminder for tenant ${tenantId}: ${JSON.stringify(payload)}`);
    return { processed: true };
  }
}
