import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthCheckError, HealthIndicatorResult } from '@nestjs/terminus';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

/**
 * Verifies the configured SMTP transport can be reached and authenticated.
 *
 * An unconfigured transport is reported as `up` with `configured: false`
 * rather than failing the dependency check: the provider config already fails
 * fast in production, so an empty host only happens in dev/test.
 */
@Injectable()
export class SmtpHealthIndicator {
  private readonly logger = new Logger(SmtpHealthIndicator.name);

  constructor(private readonly configService: ConfigService) {}

  async isHealthy(key = 'email'): Promise<HealthIndicatorResult> {
    const host = this.configService.get<string>('smtp.host') ?? '';
    if (!host) {
      return {
        [key]: {
          status: 'up',
          configured: false,
          message: 'SMTP is not configured',
        },
      };
    }

    const transporter: Transporter = nodemailer.createTransport({
      host,
      port: this.configService.get<number>('smtp.port') ?? 587,
      secure: this.configService.get<boolean>('smtp.secure') ?? false,
      auth: this.configService.get<string>('smtp.user')
        ? {
            user: this.configService.get<string>('smtp.user') as string,
            pass: this.configService.get<string>('smtp.pass') ?? '',
          }
        : undefined,
    });

    const startedAt = Date.now();
    try {
      await transporter.verify();
      return {
        [key]: {
          status: 'up',
          configured: true,
          host,
          latencyMs: Date.now() - startedAt,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`SMTP health check failed for ${host}: ${message}`);
      throw new HealthCheckError('SMTP transport unreachable', {
        [key]: { status: 'down', configured: true, host, message },
      });
    }
  }
}
