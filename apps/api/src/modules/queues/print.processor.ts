import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QueueService, QueueJobData } from './queue.service';
import { Job } from 'bullmq';

@Injectable()
export class PrintProcessor implements OnModuleInit {
  private readonly logger = new Logger(PrintProcessor.name);

  constructor(private readonly queueService: QueueService) {}

  onModuleInit() {
    this.queueService.registerWorker('print', this.process.bind(this), 3);
    this.logger.log('Print processor registered');
  }

  async process(job: Job<QueueJobData>): Promise<Record<string, unknown>> {
    const { tenantId, payload } = job.data;
    const printJobType = job.name;

    this.logger.log(`[Print] Processing ${printJobType} for tenant ${tenantId}`);

    const { printerType, content } = payload as {
      printerType?: string;
      content?: Record<string, unknown>;
    };

    this.logger.log(`[Print] Job type: ${printJobType}, printer: ${printerType ?? 'default'}`);

    // In production, integrate with thermal printer/ESC-POS driver
    // For now, log the print payload and mark as processed
    await job.updateProgress(100);

    return {
      printed: true,
      printJobType,
      printerType: printerType ?? 'default',
      tenantId,
      contentLength: content ? JSON.stringify(content).length : 0,
    };
  }
}
