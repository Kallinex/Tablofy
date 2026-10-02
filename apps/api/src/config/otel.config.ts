import { registerAs } from '@nestjs/config';

export interface OtelConfig {
  enabled: boolean;
  serviceName: string;
  endpoint: string;
  protocol: 'http/protobuf' | 'http/json';
  tracesEnabled: boolean;
  metricsEnabled: boolean;
  sampleRatio: number;
  exportTimeoutMs: number;
}

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value === '') return fallback;
  return value === 'true';
};

const parseSampleRatio = (value: string | undefined): number => {
  const parsed = Number.parseFloat(value ?? '');
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return 0.1;
  return parsed;
};

export default registerAs('otel', (): OtelConfig => {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() || '';
  // Tracing/metrics are only meaningful with an endpoint to export to, so an
  // endpoint is required rather than merely warned about.
  const enabled = parseBoolean(process.env.OTEL_ENABLED, false) && endpoint !== '';

  return {
    enabled,
    serviceName: process.env.OTEL_SERVICE_NAME?.trim() || 'tablofy-api',
    endpoint,
    protocol:
      process.env.OTEL_EXPORTER_OTLP_PROTOCOL === 'http/json' ? 'http/json' : 'http/protobuf',
    tracesEnabled: parseBoolean(process.env.OTEL_TRACES_ENABLED, true),
    metricsEnabled: parseBoolean(process.env.OTEL_METRICS_ENABLED, true),
    sampleRatio: parseSampleRatio(process.env.OTEL_TRACES_SAMPLER_ARG),
    exportTimeoutMs: Number.parseInt(process.env.OTEL_EXPORTER_OTLP_TIMEOUT ?? '', 10) || 10000,
  };
});
