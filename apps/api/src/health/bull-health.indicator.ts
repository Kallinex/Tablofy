import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { Injectable } from '@nestjs/common';
import { QueueService } from '../modules/queues/queue.service';

@Injectable()
export class BullHealthIndicator extends HealthIndicator {
  constructor(private readonly queueService: QueueService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const queueNames = ['audit-log', 'email', 'notification', 'kitchen'];
      const details: Record<string, unknown> = {};

      for (const name of queueNames) {
        try {
          const stats = await this.queueService.getQueueStats(name);
          details[name] = {
            waiting: stats.waiting,
            active: stats.active,
            completed: stats.completed,
            failed: stats.failed,
            delayed: stats.delayed,
          };
        } catch {
          details[name] = { status: 'unreachable' };
        }
      }

      const allHealthy = Object.values(details).every(
        (d) => (d as Record<string, unknown>).status !== 'unreachable',
      );

      if (allHealthy) {
        return this.getStatus(key, true, details);
      }
      throw new HealthCheckError('BullMQ check failed', this.getStatus(key, false, details));
    } catch (error) {
      if (error instanceof HealthCheckError) throw error;
      throw new HealthCheckError(
        'BullMQ connection failed',
        this.getStatus(key, false, { message: (error as Error).message }),
      );
    }
  }
}
