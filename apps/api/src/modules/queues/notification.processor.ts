import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QueueService, QueueJobData, NotificationJobPayload } from './queue.service';
import { Job } from 'bullmq';

@Injectable()
export class NotificationProcessor implements OnModuleInit {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(private readonly queueService: QueueService) {}

  onModuleInit() {
    this.queueService.registerWorker('notification', this.process.bind(this), 5);
    this.logger.log('Notification processor registered');
  }

  async process(job: Job<QueueJobData>): Promise<{ delivered: boolean; recipients: number }> {
    const { tenantId, userId } = job.data;
    const payload = (job.data.payload ?? {}) as Partial<NotificationJobPayload>;
    const { title, message, type, channel, recipientUserIds } = payload;

    if (!title || !message || !type || !channel) {
      this.logger.warn(
        `[Notification] Job ${job.id} is missing the canonical payload fields (title/message/type/channel); ` +
          `inspect the producer. job=${JSON.stringify({ jobName: job.name, tenantId, payload })}`,
      );
      return { delivered: false, recipients: 0 };
    }

    const recipients =
      recipientUserIds && recipientUserIds.length > 0 ? recipientUserIds : userId ? [userId] : [];

    for (const recipient of recipients) {
      this.logger.log(
        `[Notification] Delivering "${title}" to user ${recipient} (tenant ${tenantId}) via ${channel} (type=${type})`,
      );
    }

    // In production, integrate with push notification service (FCM, APNs, WebSocket)
    // For now, we log and mark as processed
    await job.updateProgress(100);

    return { delivered: true, recipients: recipients.length };
  }
}
