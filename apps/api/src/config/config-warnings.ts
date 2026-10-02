import { ConfigService } from '@nestjs/config';

/**
 * Non-fatal production configuration checks. Unlike env.validation (which throws
 * and stops the boot), these describe a running process whose observability is
 * degraded, so they are emitted as startup warnings.
 */
export function collectConfigWarnings(config: ConfigService): string[] {
  const warnings: string[] = [];

  const nodeEnv = config.get<string>('app.nodeEnv') ?? 'development';
  if (nodeEnv !== 'production') {
    return warnings;
  }

  const sentryEnabled = config.get<boolean>('sentry.enabled', false);
  const sentryDsn = (config.get<string>('sentry.dsn') ?? '').trim();
  if (!sentryEnabled || sentryDsn === '') {
    warnings.push(
      'Error tracking is disabled in production (SENTRY_ENABLED/SENTRY_DSN not set). ' +
        'Unhandled exceptions will not be reported to Sentry.',
    );
  }

  if (config.get<boolean>('metrics.enabled', true) === false) {
    warnings.push(
      'Prometheus metrics are disabled in production (METRICS_ENABLED=false). ' +
        'Monitoring and alerting have no request, queue or payment metrics.',
    );
  }

  if (config.get<boolean>('logging.json', true) === false) {
    warnings.push(
      'Structured JSON logging is disabled in production (LOG_JSON=false). ' +
        'Log aggregation and alerting may not parse the output.',
    );
  }

  return warnings;
}
