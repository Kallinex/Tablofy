import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppLoggerService } from '../logger/logger.service';

@Injectable()
export class MonitoringService {
  private readonly slowQueryMs: number;
  private readonly slowRequestMs: number;
  private readonly queueDelayMs: number;
  private readonly largePayloadBytes: number;
  private readonly highMemoryMb: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
  ) {
    this.slowQueryMs = this.configService.get('monitoring.slowQueryMs', 100);
    this.slowRequestMs = this.configService.get('monitoring.slowRequestMs', 500);
    this.queueDelayMs = this.configService.get('monitoring.queueDelayMs', 1000);
    this.largePayloadBytes = this.configService.get('monitoring.largePayloadBytes', 1048576);
    this.highMemoryMb = this.configService.get('monitoring.highMemoryMb', 500);
    this.logger.setContext('Monitoring');
  }

  checkSlowQuery(duration: number, query: string, _params?: unknown) {
    if (duration > this.slowQueryMs) {
      this.logger.warn('Slow query detected', {
        type: 'slow_query',
        duration,
        threshold: this.slowQueryMs,
        query: query.substring(0, 200),
      });
    }
  }

  checkSlowRequest(method: string, url: string, duration: number) {
    if (duration > this.slowRequestMs) {
      this.logger.warn('Slow request detected', {
        type: 'slow_request',
        method,
        url,
        duration,
        threshold: this.slowRequestMs,
      });
    }
  }

  checkQueueDelay(queue: string, jobId: string, delay: number) {
    if (delay > this.queueDelayMs) {
      this.logger.warn('Queue delay detected', {
        type: 'queue_delay',
        queue,
        jobId,
        delayMs: delay,
        threshold: this.queueDelayMs,
      });
    }
  }

  checkLargePayload(method: string, url: string, size: number) {
    if (size > this.largePayloadBytes) {
      this.logger.warn('Large payload detected', {
        type: 'large_payload',
        method,
        url,
        sizeBytes: size,
        threshold: this.largePayloadBytes,
      });
    }
  }

  checkHighMemory(currentMb: number) {
    if (currentMb > this.highMemoryMb) {
      this.logger.warn('High memory usage', {
        type: 'high_memory',
        memoryMb: currentMb,
        threshold: this.highMemoryMb,
      });
    }
  }
}
