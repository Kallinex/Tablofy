import { ConfigService } from '@nestjs/config';
import { validateRedisTopology } from '../redis/redis.client';

/**
 * Non-fatal production configuration checks. Unlike env.validation (which throws
 * and stops the boot), these describe a running process whose observability is
 * degraded, so they are emitted as startup warnings.
 *
 * Returns early outside production: a developer running a cluster locally should
 * not be warned about a half-configured replica set.
 */
export function collectConfigWarnings(config: ConfigService): string[] {
  const warnings: string[] = [];

  const nodeEnv = config.get<string>('app.nodeEnv') ?? 'development';
  if (nodeEnv !== 'production') {
    return warnings;
  }

  // A missing cluster seed or sentinel master name does not fail construction:
  // ioredis retries silently in the background, so without this the API would
  // boot reporting itself healthy while every cache read and enqueue failed.
  for (const problem of validateRedisTopology(config)) {
    warnings.push(`Redis topology is misconfigured: ${problem}`);
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

  // Distributed tracing is opt-in. Note the endpoint requirement: OTEL_ENABLED
  // alone is not enough, because an SDK with no collector would drop every span.
  const otelEnabled = config.get<boolean>('otel.enabled', false);
  const otelEndpoint = (config.get<string>('otel.endpoint') ?? '').trim();
  if (!otelEnabled || otelEndpoint === '') {
    warnings.push(
      'Distributed tracing is disabled in production (OTEL_ENABLED=true with ' +
        'OTEL_EXPORTER_OTLP_ENDPOINT required). Queue, database and HTTP spans ' +
        'will not be exported, so a slow request cannot be traced end to end.',
    );
  }

  return warnings;
}
