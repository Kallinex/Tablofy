import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthCheckError, HealthIndicatorResult } from '@nestjs/terminus';
import { probeDependency } from './dependency-probe';

/**
 * Probes an optional SMS gateway health endpoint.
 *
 * No SMS provider is wired into the application yet, so the indicator is
 * reported as `up` with `configured: false` until `SMS_PROVIDER_URL` is set.
 * This makes the gap visible in `/health/dependencies` without failing probes.
 */
@Injectable()
export class SmsHealthIndicator {
  private readonly logger = new Logger(SmsHealthIndicator.name);

  constructor(private readonly configService: ConfigService) {}

  async isHealthy(key = 'sms'): Promise<HealthIndicatorResult> {
    const providerUrl = this.configService.get<string>('sms.providerUrl') ?? '';
    if (!providerUrl) {
      return {
        [key]: { status: 'up', configured: false, message: 'SMS provider is not configured' },
      };
    }

    const apiKey = this.configService.get<string>('sms.apiKey') ?? '';
    const result = await probeDependency(
      providerUrl,
      apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    );

    if (!result.reachable) {
      this.logger.warn(`SMS gateway health probe failed (${result.error ?? result.status})`);
      throw new HealthCheckError('SMS provider unreachable', {
        [key]: {
          status: 'down',
          configured: true,
          providerUrl,
          statusCode: result.status,
          message: result.error,
        },
      });
    }

    return {
      [key]: { status: 'up', configured: true, providerUrl, latencyMs: result.latencyMs },
    };
  }
}
