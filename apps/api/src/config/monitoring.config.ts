import { registerAs } from '@nestjs/config';

export interface MonitoringConfig {
  slowQueryMs: number;
  slowRequestMs: number;
  queueDelayMs: number;
  largePayloadBytes: number;
  highMemoryMb: number;
}

export default registerAs(
  'monitoring',
  (): MonitoringConfig => ({
    slowQueryMs: parseInt(process.env.MONITOR_SLOW_QUERY_MS || '100', 10),
    slowRequestMs: parseInt(process.env.MONITOR_SLOW_REQUEST_MS || '500', 10),
    queueDelayMs: parseInt(process.env.MONITOR_QUEUE_DELAY_MS || '1000', 10),
    largePayloadBytes: parseInt(process.env.MONITOR_LARGE_PAYLOAD_BYTES || '1048576', 10),
    highMemoryMb: parseInt(process.env.MONITOR_HIGH_MEMORY_MB || '500', 10),
  }),
);
