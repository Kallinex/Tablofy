import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QueueService, QueueJobData } from '../queues/queue.service';
import { ExportEngineService } from './export-engine.service';

@Injectable()
export class ExportEngineProcessor {
  private readonly logger = new Logger(ExportEngineProcessor.name);

  constructor(
    private readonly queueService: QueueService,
    private readonly exportEngineService: ExportEngineService,
  ) {
    this.queueService.registerWorker('export-engine', this.handleExport.bind(this));
  }

  private async handleExport(job: Job<QueueJobData>) {
    this.logger.log(`Processing export job ${job.id}`);
    return this.exportEngineService.processExport(job);
  }
}
