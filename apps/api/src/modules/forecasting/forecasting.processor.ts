import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QueueService, QueueJobData } from '../queues/queue.service';
import { ForecastingService } from './forecasting.service';

@Injectable()
export class ForecastingProcessor {
  private readonly logger = new Logger(ForecastingProcessor.name);

  constructor(
    private readonly queueService: QueueService,
    private readonly forecastingService: ForecastingService,
  ) {
    this.queueService.registerWorker(
      'forecast-generation',
      this.handleForecastGeneration.bind(this),
    );
    this.queueService.registerWorker('auto-reorder', this.handleAutoReorder.bind(this));
  }

  private async handleForecastGeneration(job: Job<QueueJobData>) {
    this.logger.log(`Processing forecast generation ${job.id}`);
    const { tenantId, payload } = job.data;
    const itemId = payload?.inventoryItemId as string | undefined;
    if (tenantId && itemId) {
      await this.forecastingService.generateForecast(
        {
          inventoryItemId: itemId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          period: payload?.period as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          method: payload?.method as any,
          days: payload?.days as number | undefined,
        },
        tenantId,
        (payload?.userId as string) ?? 'system',
      );
    }
    this.logger.log(`Forecast generation complete for tenant ${tenantId}`);
    return { processed: true, tenantId, inventoryItemId: itemId };
  }

  private async handleAutoReorder(job: Job<QueueJobData>) {
    this.logger.log(`Processing auto-reorder ${job.id}`);
    const { tenantId } = job.data;
    if (tenantId) {
      await this.forecastingService.generateReorderSuggestions(
        tenantId,
        job.data.userId ?? 'system',
      );
    }
    this.logger.log(`Auto-reorder complete for tenant ${tenantId}`);
    return { processed: true, tenantId };
  }
}
