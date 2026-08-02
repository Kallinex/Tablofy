import { Injectable } from '@nestjs/common';
import { HealthCheckError, HealthIndicatorResult } from '@nestjs/terminus';
import { statfs } from 'node:fs/promises';

@Injectable()
export class DiskHealthIndicator {
  private readonly path: string;
  private readonly thresholdBytes: number;

  constructor() {
    this.path = process.env.HEALTH_DISK_PATH || '/';
    const thresholdMb = parseInt(process.env.HEALTH_DISK_THRESHOLD_MB || '200', 10);
    this.thresholdBytes = thresholdMb * 1024 * 1024;
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const stats = await statfs(this.path);
    const availableBytes = stats.bavail * stats.bsize;
    const totalBytes = stats.blocks * stats.bsize;

    const result: HealthIndicatorResult = {
      [key]: {
        status: availableBytes >= this.thresholdBytes ? 'up' : 'down',
        path: this.path,
        availableBytes,
        totalBytes,
        thresholdBytes: this.thresholdBytes,
      },
    };

    if (availableBytes < this.thresholdBytes) {
      throw new HealthCheckError('Disk space below threshold', result);
    }
    return result;
  }
}
