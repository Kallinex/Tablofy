import { registerAs } from '@nestjs/config';

export interface MetricsConfig {
  enabled: boolean;
  endpoint: string;
  collectDefaultMetrics: boolean;
  collectIntervalMs: number;
  authToken: string;
}

export default registerAs(
  'metrics',
  (): MetricsConfig => ({
    enabled: process.env.METRICS_ENABLED !== 'false',
    endpoint: process.env.METRICS_ENDPOINT || 'metrics',
    collectDefaultMetrics: process.env.METRICS_COLLECT_DEFAULT !== 'false',
    collectIntervalMs: parseInt(process.env.METRICS_COLLECT_INTERVAL_MS || '10000', 10),
    authToken: process.env.METRICS_AUTH_TOKEN || '',
  }),
);
