import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { Injectable } from '@nestjs/common';
import * as os from 'os';

@Injectable()
export class DiskHealthIndicator extends HealthIndicator {
  async isHealthy(key: string, thresholdPercent = 0.9): Promise<HealthIndicatorResult> {
    try {
      const free = os.freemem();
      const total = os.totalmem();
      const usedPercent = 1 - free / total;

      if (usedPercent < thresholdPercent) {
        return this.getStatus(key, true, {
          freeBytes: free,
          totalBytes: total,
          usedPercent: parseFloat((usedPercent * 100).toFixed(2)),
        });
      }

      throw new HealthCheckError(
        'Disk health check failed',
        this.getStatus(key, false, {
          freeBytes: free,
          totalBytes: total,
          usedPercent: parseFloat((usedPercent * 100).toFixed(2)),
          threshold: thresholdPercent * 100,
        }),
      );
    } catch (error) {
      if (error instanceof HealthCheckError) throw error;
      throw new HealthCheckError(
        'Disk health check failed',
        this.getStatus(key, false, { message: (error as Error).message }),
      );
    }
  }
}
