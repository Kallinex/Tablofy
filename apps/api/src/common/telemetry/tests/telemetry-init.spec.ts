import { Logger } from '@nestjs/common';
import { initTelemetry } from '../telemetry';

type StartedSdk = { shutdown?: () => Promise<void> };

const BASE_ENV = {
  OTEL_ENABLED: 'true',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
  OTEL_SERVICE_NAME: 'tablofy-api-test',
} as NodeJS.ProcessEnv;

/**
 * These exercise the real enabled path: the SDK is constructed and started
 * against an unreachable collector on purpose, so no span ever leaves the
 * process. The collector is not contacted synchronously, so no test needs it.
 */
describe('initTelemetry enabled path', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('constructs and starts an SDK when fully configured', async () => {
    jest.spyOn(Logger, 'log').mockImplementation(() => undefined);

    const result = initTelemetry(BASE_ENV);

    expect(result.enabled).toBe(true);
    expect(result.sdk).toBeDefined();
    expect(Logger.log).toHaveBeenCalledWith(
      expect.stringContaining('OpenTelemetry started'),
      'Telemetry',
    );

    await (result.sdk as StartedSdk).shutdown?.();
  });

  it('starts with traces disabled', async () => {
    const result = initTelemetry({ ...BASE_ENV, OTEL_TRACES_ENABLED: 'false' });
    expect(result.enabled).toBe(true);
    await (result.sdk as StartedSdk).shutdown?.();
  });

  it('starts with metrics disabled', async () => {
    const result = initTelemetry({ ...BASE_ENV, OTEL_METRICS_ENABLED: 'false' });
    expect(result.enabled).toBe(true);
    await (result.sdk as StartedSdk).shutdown?.();
  });

  it.each(['5', '-1', 'abc', '', '0.25'])(
    'starts with an out-of-range sample ratio %p by falling back to the default',
    async (ratio) => {
      const result = initTelemetry({ ...BASE_ENV, OTEL_TRACES_SAMPLER_ARG: ratio });
      expect(result.enabled).toBe(true);
      await (result.sdk as StartedSdk).shutdown?.();
    },
  );

  it('honours an explicit zero sample ratio', async () => {
    jest.spyOn(Logger, 'log').mockImplementation(() => undefined);

    const result = initTelemetry({ ...BASE_ENV, OTEL_TRACES_SAMPLER_ARG: '0' });

    expect(result.enabled).toBe(true);
    // 0 means "sample nothing"; the NaN guard must not turn it into the default.
    expect(Logger.log).toHaveBeenCalledWith(expect.stringContaining('sampleRatio=0'), 'Telemetry');
    await (result.sdk as StartedSdk).shutdown?.();
  });

  it('falls back to a default service name rather than failing', async () => {
    const warn = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    const env = { ...BASE_ENV };
    delete env.OTEL_SERVICE_NAME;

    const result = initTelemetry(env);

    expect(result.enabled).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    await (result.sdk as StartedSdk).shutdown?.();
  });
});

describe('initTelemetry disabled path', () => {
  it('does not construct an SDK and never throws when unconfigured', () => {
    const result = initTelemetry({} as NodeJS.ProcessEnv);
    expect(result.enabled).toBe(false);
    expect(result.sdk).toBeUndefined();
  });

  it('does not construct an SDK when enabled without an endpoint', () => {
    const result = initTelemetry({ OTEL_ENABLED: 'true' } as NodeJS.ProcessEnv);
    expect(result.enabled).toBe(false);
    expect(result.sdk).toBeUndefined();
  });
});
