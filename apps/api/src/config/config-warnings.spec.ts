import { ConfigService } from '@nestjs/config';
import { collectConfigWarnings } from './config-warnings';

function reader(values: Record<string, unknown>): ConfigService {
  return {
    get: (key: string, defaultValue?: unknown) => (key in values ? values[key] : defaultValue),
  } as unknown as ConfigService;
}

function production(overrides: Record<string, unknown> = {}): ConfigService {
  return reader({
    'app.nodeEnv': 'production',
    'sentry.enabled': true,
    'sentry.dsn': 'https://abc@o0.ingest.sentry.io/0',
    'metrics.enabled': true,
    'logging.json': true,
    'otel.enabled': true,
    'otel.endpoint': 'https://collector.example.com',
    ...overrides,
  });
}

describe('collectConfigWarnings', () => {
  it('returns no warnings outside production', () => {
    expect(collectConfigWarnings(reader({ 'app.nodeEnv': 'development' }))).toEqual([]);
  });

  it('returns no warnings for a fully configured production environment', () => {
    expect(collectConfigWarnings(production())).toEqual([]);
  });

  it('warns when Sentry is disabled in production', () => {
    const warnings = collectConfigWarnings(production({ 'sentry.enabled': false }));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Sentry/i);
  });

  it('warns when Sentry is enabled without a DSN', () => {
    const warnings = collectConfigWarnings(production({ 'sentry.dsn': '   ' }));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Sentry/i);
  });

  it('warns when metrics are disabled in production', () => {
    const warnings = collectConfigWarnings(production({ 'metrics.enabled': false }));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/metrics/i);
  });

  it('warns when structured JSON logging is disabled in production', () => {
    const warnings = collectConfigWarnings(production({ 'logging.json': false }));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/JSON/i);
  });

  it('warns when distributed tracing is disabled in production', () => {
    const warnings = collectConfigWarnings(production({ 'otel.enabled': false }));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/tracing is disabled/i);
  });

  it('warns when tracing is enabled without a collector endpoint', () => {
    // The SDK would start but drop every span, which looks like tracing works.
    const warnings = collectConfigWarnings(production({ 'otel.endpoint': '   ' }));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/OTEL_EXPORTER_OTLP_ENDPOINT/);
  });

  it('reports every degraded signal at once', () => {
    const warnings = collectConfigWarnings(
      production({
        'sentry.enabled': false,
        'metrics.enabled': false,
        'logging.json': false,
        'otel.enabled': false,
      }),
    );
    expect(warnings).toHaveLength(4);
  });
});
