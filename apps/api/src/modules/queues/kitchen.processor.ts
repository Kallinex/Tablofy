import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QueueService, QueueJobData } from './queue.service';
import { Job } from 'bullmq';

@Injectable()
export class KitchenProcessor implements OnModuleInit {
  private readonly logger = new Logger(KitchenProcessor.name);

  constructor(private readonly queueService: QueueService) {}

  onModuleInit() {
    this.queueService.registerWorker('kitchen', this.process.bind(this), 5);
    this.logger.log('Kitchen processor registered');
  }

  async process(job: Job<QueueJobData>): Promise<Record<string, unknown>> {
    const { tenantId, payload } = job.data;
    const eventType = job.name;

    this.logger.log(`[Kitchen] Processing ${eventType} for tenant ${tenantId}`);

    switch (eventType) {
      case 'order.confirmed.kds':
        this.logger.log(`[Kitchen] KDS processing for order ${payload.orderId}`);
        break;
      case 'ticket-item.status-changed':
        this.logger.log(`[Kitchen] Item ${payload.itemId} status changed to ${payload.status}`);
        break;
      default:
        this.logger.log(`[Kitchen] Unknown event type: ${eventType}`);
    }

    await job.updateProgress(100);
    return { processed: true, eventType, tenantId };
  }
}
