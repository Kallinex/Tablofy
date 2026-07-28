import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QueueService, QueueJobData } from './queue.service';
import { Job } from 'bullmq';

@Injectable()
export class EmailProcessor implements OnModuleInit {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(private readonly queueService: QueueService) {}

  onModuleInit() {
    this.queueService.registerWorker('email', this.process.bind(this), 3);
    this.logger.log('Email processor registered');
  }

  async process(job: Job<QueueJobData>): Promise<{ sent: boolean; to: string }> {
    const { tenantId, payload } = job.data;
    const { to, subject } = payload as { to: string; subject: string; body: string };

    this.logger.log(`[Email] Sending to ${to} for tenant ${tenantId}: ${subject}`);

    // In production, integrate with email provider (SendGrid, SES, etc.)
    // For now, we log and mark as processed
    await job.updateProgress(100);

    return { sent: true, to };
  }
}
