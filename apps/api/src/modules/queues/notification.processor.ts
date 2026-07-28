import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QueueService, QueueJobData } from './queue.service';
import { Job } from 'bullmq';

@Injectable()
export class NotificationProcessor implements OnModuleInit {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(private readonly queueService: QueueService) {}

  onModuleInit() {
    this.queueService.registerWorker('notification', this.process.bind(this), 5);
    this.logger.log('Notification processor registered');
  }

  async process(job: Job<QueueJobData>): Promise<{ delivered: boolean }> {
    const { tenantId, userId, payload } = job.data;
    const { title, channel } = payload as {
      title: string;
      message: string;
      type: string;
      channel: string;
    };

    this.logger.log(
      `[Notification] Delivering "${title}" to user ${userId} (tenant ${tenantId}) via ${channel}`,
    );

    // In production, integrate with push notification service (FCM, APNs, WebSocket)
    // For now, we log and mark as processed
    await job.updateProgress(100);

    return { delivered: true };
  }
}
