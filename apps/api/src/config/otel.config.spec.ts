import 'reflect-metadata';
import otelConfig from './otel.config';

const OTEL_ENV_KEYS = [
  'OTEL_ENABLED',
  'OTEL_SERVICE_NAME',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_PROTOCOL',
  'OTEL_TRACES_ENABLED',
  'OTEL_METRICS_ENABLED',
  'OTEL_TRACES_SAMPLER_ARG',
  'OTEL_EXPORTER_OTLP_TIMEOUT',
] as const;

function withEnv(env: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = env[key] as string;
    }
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(env)) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key] as string;
      }
    }
  }
}

const read = (extra: Record<string, string | undefined> = {}) => {
  let result!: ReturnType<typeof otelConfig>;
  withEnv({ ...Object.fromEntries(OTEL_ENV_KEYS.map((k) => [k, undefined])), ...extra }, () => {
    result = otelConfig();
  });
  return result;
};

describe('otel.config', () => {
  it('is disabled by default when no environment is set', () => {
    expect(read().enabled).toBe(false);
  });

  it('stays disabled when OTEL_ENABLED=true but no endpoint is provided', () => {
    // An endpoint is required: exporting nowhere is not an observability win and
    // would otherwise start a client with no destination.
    expect(read({ OTEL_ENABLED: 'true' }).enabled).toBe(false);
  });

  it('stays disabled when an endpoint is provided but OTEL_ENABLED is not true', () => {
    expect(read({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318' }).enabled).toBe(false);
  });

  it('enables telemetry when OTEL_ENABLED=true and an endpoint is present', () => {
    const config = read({
      OTEL_ENABLED: 'true',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
    });
    expect(config.enabled).toBe(true);
    expect(config.endpoint).toBe('http://collector:4318');
  });

  it('requires the exact trimmed string "true" and is case sensitive', () => {
    const enabled = (value: string) =>
      read({ OTEL_ENABLED: value, OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318' }).enabled;

    expect(enabled('true')).toBe(true);
    expect(enabled(' true ')).toBe(false);
    expect(enabled('TRUE')).toBe(false);
    expect(enabled('True')).toBe(false);
    expect(enabled('1')).toBe(false);
    expect(enabled('yes')).toBe(false);
    expect(enabled('false')).toBe(false);
  });

  it('treats an unset or empty OTEL_ENABLED as the false fallback', () => {
    expect(read({ OTEL_ENABLED: '' }).enabled).toBe(false);
    expect(read({ OTEL_ENABLED: undefined }).enabled).toBe(false);
  });

  describe('serviceName', () => {
    it('defaults to tablofy-api when unset or blank', () => {
      expect(read().serviceName).toBe('tablofy-api');
      expect(read({ OTEL_SERVICE_NAME: '' }).serviceName).toBe('tablofy-api');
      expect(read({ OTEL_SERVICE_NAME: '   ' }).serviceName).toBe('tablofy-api');
    });

    it('uses a provided name and trims surrounding whitespace', () => {
      expect(read({ OTEL_SERVICE_NAME: '  tablofy-prod  ' }).serviceName).toBe('tablofy-prod');
    });
  });

  describe('endpoint', () => {
    it('trims the endpoint and treats a blank value as absent', () => {
      expect(read({ OTEL_EXPORTER_OTLP_ENDPOINT: '  http://c:4318  ' }).endpoint).toBe(
        'http://c:4318',
      );
      expect(read({ OTEL_EXPORTER_OTLP_ENDPOINT: '   ' }).endpoint).toBe('');
    });
  });

  describe('protocol', () => {
    it('defaults to http/protobuf', () => {
      expect(read().protocol).toBe('http/protobuf');
    });

    it('honours http/json when requested', () => {
      expect(read({ OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json' }).protocol).toBe('http/json');
    });

    it('falls back to http/protobuf for anything else', () => {
      expect(read({ OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc' }).protocol).toBe('http/protobuf');
      expect(read({ OTEL_EXPORTER_OTLP_PROTOCOL: 'HTTP/JSON' }).protocol).toBe('http/protobuf');
      expect(read({ OTEL_EXPORTER_OTLP_PROTOCOL: '' }).protocol).toBe('http/protobuf');
    });
  });

  describe('tracesEnabled / metricsEnabled', () => {
    it('both default to true when unset', () => {
      const config = read();
      expect(config.tracesEnabled).toBe(true);
      expect(config.metricsEnabled).toBe(true);
    });

    it('can be disabled independently', () => {
      const config = read({ OTEL_TRACES_ENABLED: 'false', OTEL_METRICS_ENABLED: 'true' });
      expect(config.tracesEnabled).toBe(false);
      expect(config.metricsEnabled).toBe(true);
    });

    it('parses these as exact lowercase strings too', () => {
      expect(read({ OTEL_TRACES_ENABLED: 'TRUE' }).tracesEnabled).toBe(false);
      expect(read({ OTEL_METRICS_ENABLED: '1' }).metricsEnabled).toBe(false);
      expect(read({ OTEL_TRACES_ENABLED: '' }).tracesEnabled).toBe(true);
    });
  });

  describe('sampleRatio', () => {
    it('defaults to 0.1 when unset', () => {
      expect(read().sampleRatio).toBe(0.1);
    });

    it('accepts values inside the inclusive 0..1 range, including the edges', () => {
      expect(read({ OTEL_TRACES_SAMPLER_ARG: '0' }).sampleRatio).toBe(0);
      expect(read({ OTEL_TRACES_SAMPLER_ARG: '0.25' }).sampleRatio).toBe(0.25);
      expect(read({ OTEL_TRACES_SAMPLER_ARG: '1' }).sampleRatio).toBe(1);
    });

    it('falls back to 0.1 for out-of-range values', () => {
      expect(read({ OTEL_TRACES_SAMPLER_ARG: '-0.1' }).sampleRatio).toBe(0.1);
      expect(read({ OTEL_TRACES_SAMPLER_ARG: '1.1' }).sampleRatio).toBe(0.1);
      expect(read({ OTEL_TRACES_SAMPLER_ARG: '99' }).sampleRatio).toBe(0.1);
    });

    it('falls back to 0.1 for unparseable values', () => {
      expect(read({ OTEL_TRACES_SAMPLER_ARG: 'abc' }).sampleRatio).toBe(0.1);
      expect(read({ OTEL_TRACES_SAMPLER_ARG: '' }).sampleRatio).toBe(0.1);
      expect(read({ OTEL_TRACES_SAMPLER_ARG: 'NaN' }).sampleRatio).toBe(0.1);
      expect(read({ OTEL_TRACES_SAMPLER_ARG: 'Infinity' }).sampleRatio).toBe(0.1);
    });
  });

  describe('exportTimeoutMs', () => {
    it('defaults to 10000 when unset or unparseable', () => {
      expect(read().exportTimeoutMs).toBe(10000);
      expect(read({ OTEL_EXPORTER_OTLP_TIMEOUT: '' }).exportTimeoutMs).toBe(10000);
      expect(read({ OTEL_EXPORTER_OTLP_TIMEOUT: 'abc' }).exportTimeoutMs).toBe(10000);
    });

    it('parses an integer override', () => {
      expect(read({ OTEL_EXPORTER_OTLP_TIMEOUT: '5000' }).exportTimeoutMs).toBe(5000);
      expect(read({ OTEL_EXPORTER_OTLP_TIMEOUT: '30000' }).exportTimeoutMs).toBe(30000);
    });

    it('falls back to the default for zero, which would mean no export time at all', () => {
      expect(read({ OTEL_EXPORTER_OTLP_TIMEOUT: '0' }).exportTimeoutMs).toBe(10000);
    });
  });
});
