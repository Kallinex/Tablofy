import { resolveTelemetryEnv } from '../telemetry';

const env = (overrides: Record<string, string | undefined>): NodeJS.ProcessEnv =>
  overrides as NodeJS.ProcessEnv;

describe('resolveTelemetryEnv', () => {
  it('is disabled by default so local and test runs never export spans', () => {
    const decision = resolveTelemetryEnv(env({}));
    expect(decision.enabled).toBe(false);
    expect(decision.reason).toMatch(/OTEL_ENABLED not set/);
  });

  it('stays disabled when the endpoint is set but the flag is not', () => {
    const decision = resolveTelemetryEnv(
      env({ OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.example.com' }),
    );
    expect(decision.enabled).toBe(false);
  });

  it('stays disabled when OTEL_ENABLED is not exactly "true"', () => {
    for (const value of ['false', 'TRUE', '1', 'yes', 'enabled', '']) {
      const decision = resolveTelemetryEnv(
        env({ OTEL_ENABLED: value, OTEL_EXPORTER_OTLP_ENDPOINT: 'https://c.example.com' }),
      );
      expect(decision.enabled).toBe(false);
    }
  });

  it('tolerates surrounding whitespace in OTEL_ENABLED', () => {
    // Env files and shell exports routinely add stray spaces.
    const decision = resolveTelemetryEnv(
      env({ OTEL_ENABLED: ' true ', OTEL_EXPORTER_OTLP_ENDPOINT: 'https://c.example.com' }),
    );
    expect(decision.enabled).toBe(true);
  });

  it('refuses to enable without a collector endpoint', () => {
    // An SDK with no exporter target would start and silently drop every span.
    const decision = resolveTelemetryEnv(env({ OTEL_ENABLED: 'true' }));
    expect(decision.enabled).toBe(false);
    expect(decision.reason).toMatch(/OTEL_EXPORTER_OTLP_ENDPOINT/);
  });

  it('refuses to enable when the endpoint is only whitespace', () => {
    const decision = resolveTelemetryEnv(
      env({ OTEL_ENABLED: 'true', OTEL_EXPORTER_OTLP_ENDPOINT: '   ' }),
    );
    expect(decision.enabled).toBe(false);
  });

  it('enables with both the flag and an endpoint', () => {
    const decision = resolveTelemetryEnv(
      env({ OTEL_ENABLED: 'true', OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.example.com' }),
    );
    expect(decision.enabled).toBe(true);
    expect(decision.endpoint).toBe('https://collector.example.com');
  });

  it('trims surrounding whitespace from the endpoint', () => {
    const decision = resolveTelemetryEnv(
      env({ OTEL_ENABLED: 'true', OTEL_EXPORTER_OTLP_ENDPOINT: '  https://c.example.com  ' }),
    );
    expect(decision.endpoint).toBe('https://c.example.com');
  });
});
