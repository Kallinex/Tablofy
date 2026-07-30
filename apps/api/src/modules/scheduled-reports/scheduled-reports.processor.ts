import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QueueService, QueueJobData } from '../queues/queue.service';
import { ScheduledReportsService } from './scheduled-reports.service';

@Injectable()
export class ScheduledReportsProcessor {
  private readonly logger = new Logger(ScheduledReportsProcessor.name);

  constructor(
    private readonly queueService: QueueService,
    private readonly scheduledReportsService: ScheduledReportsService,
  ) {
    this.queueService.registerWorker('scheduled-reports', this.handleScheduledReport.bind(this));
  }

  private async handleScheduledReport(job: Job<QueueJobData>) {
    this.logger.log(`Processing scheduled report job ${job.id}`);
    return this.scheduledReportsService.processScheduledReport(job);
  }
}
