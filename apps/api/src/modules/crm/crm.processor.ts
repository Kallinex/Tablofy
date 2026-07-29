import { Injectable, Logger } from '@nestjs/common';
import { QueueService, QueueJobData } from '../queues/queue.service';

@Injectable()
export class CrmProcessor {
  private readonly logger = new Logger(CrmProcessor.name);

  constructor(private readonly queueService: QueueService) {
    this.registerWorkers();
  }

  private registerWorkers() {
    this.queueService.registerWorker('crm-jobs', async (job) => {
      this.logger.log(`Processing CRM job ${job.id}: ${job.name}`);
      const { payload } = job.data;
      this.logger.log(`CRM job payload: ${JSON.stringify(payload).slice(0, 200)}`);
      return { processed: true };
    });

    this.queueService.registerWorker('scheduled-notifications', async (job) => {
      this.logger.log(`Processing scheduled notification job ${job.id}`);
      const { payload } = job.data;
      this.logger.log(`Scheduled notification payload: ${JSON.stringify(payload).slice(0, 200)}`);
      return { processed: true };
    });

    this.queueService.registerWorker('daily-reports', async (job) => {
      this.logger.log(`Processing daily report job ${job.id}`);
      const { payload } = job.data;
      this.logger.log(`Daily report payload: ${JSON.stringify(payload).slice(0, 200)}`);
      return { processed: true };
    });
  }
}
