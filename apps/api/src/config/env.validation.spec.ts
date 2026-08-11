import 'reflect-metadata';
import { validate } from './env.validation';

function baseEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    NODE_ENV: 'development',
    PORT: '3000',
    API_PREFIX: 'api',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db?schema=public',
    REDIS_HOST: 'localhost',
    REDIS_PORT: '6379',
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: 'a-secret-that-is-at-least-32-characters-long',
    JWT_EXPIRATION: '15m',
    JWT_REFRESH_SECRET: 'another-secret-that-is-at-least-32-characters-long',
    JWT_REFRESH_EXPIRATION: '7d',
    THROTTLE_TTL: '60',
    THROTTLE_LIMIT: '120',
    ...overrides,
  };
}

describe('env.validation', () => {
  it('accepts a valid minimal development environment', () => {
    expect(() => validate(baseEnv())).not.toThrow();
  });

  it('accepts optional observability variables when present', () => {
    expect(() =>
      validate(
        baseEnv({
          SENTRY_DSN: 'https://abc123@o0.ingest.sentry.io/0',
          SENTRY_ENABLED: 'true',
          SENTRY_TRACES_SAMPLE_RATE: '0.25',
          SENTRY_PROFILES_SAMPLE_RATE: '0.1',
          METRICS_ENABLED: 'true',
          METRICS_ENDPOINT: 'metrics',
          METRICS_AUTH_TOKEN: 'an-observability-token',
          METRICS_COLLECT_DEFAULT: 'true',
          METRICS_COLLECT_INTERVAL_MS: '15000',
        }),
      ),
    ).not.toThrow();
  });

  it('rejects production without METRICS_AUTH_TOKEN when metrics are enabled', () => {
    expect(() => validate(baseEnv({ NODE_ENV: 'production' }))).toThrow(/METRICS_AUTH_TOKEN/);
  });

  it('rejects production with a short METRICS_AUTH_TOKEN when metrics are enabled', () => {
    expect(() =>
      validate(baseEnv({ NODE_ENV: 'production', METRICS_AUTH_TOKEN: 'short' })),
    ).toThrow(/METRICS_AUTH_TOKEN/);
  });

  it('accepts production with a valid METRICS_AUTH_TOKEN', () => {
    expect(() =>
      validate(
        baseEnv({
          NODE_ENV: 'production',
          METRICS_AUTH_TOKEN: 'a-valid-metrics-token-123456',
          WEBHOOK_ENCRYPTION_KEY: 'webhook-encryption-key-at-least-32-chars',
          REDIS_PASSWORD: 'redis-password-at-least-16-chars',
        }),
      ),
    ).not.toThrow();
  });

  it('accepts production without a token when metrics are disabled', () => {
    expect(() =>
      validate(
        baseEnv({
          NODE_ENV: 'production',
          METRICS_ENABLED: 'false',
          WEBHOOK_ENCRYPTION_KEY: 'webhook-encryption-key-at-least-32-chars',
          REDIS_PASSWORD: 'redis-password-at-least-16-chars',
        }),
      ),
    ).not.toThrow();
  });

  it('rejects production without REDIS_PASSWORD', () => {
    expect(() =>
      validate(
        baseEnv({
          NODE_ENV: 'production',
          METRICS_ENABLED: 'false',
          WEBHOOK_ENCRYPTION_KEY: 'webhook-encryption-key-at-least-32-chars',
        }),
      ),
    ).toThrow(/REDIS_PASSWORD/);
  });

  it('rejects production with a short REDIS_PASSWORD', () => {
    expect(() =>
      validate(
        baseEnv({
          NODE_ENV: 'production',
          METRICS_ENABLED: 'false',
          WEBHOOK_ENCRYPTION_KEY: 'webhook-encryption-key-at-least-32-chars',
          REDIS_PASSWORD: 'short',
        }),
      ),
    ).toThrow(/REDIS_PASSWORD/);
  });

  it('accepts development without REDIS_PASSWORD', () => {
    expect(() =>
      validate(baseEnv({ REDIS_PASSWORD: undefined as unknown as string })),
    ).not.toThrow();
  });

  it('rejects production without WEBHOOK_ENCRYPTION_KEY', () => {
    expect(() =>
      validate(
        baseEnv({
          NODE_ENV: 'production',
          METRICS_ENABLED: 'false',
          REDIS_PASSWORD: 'redis-password-at-least-16-chars',
        }),
      ),
    ).toThrow(/WEBHOOK_ENCRYPTION_KEY/);
  });

  it('accepts development without a token when metrics are enabled', () => {
    expect(() => validate(baseEnv({ METRICS_ENABLED: 'true' }))).not.toThrow();
  });

  it('still rejects placeholder JWT secrets in production', () => {
    expect(() =>
      validate(
        baseEnv({
          NODE_ENV: 'production',
          JWT_SECRET: 'change-this-placeholder-secret-padded-to-min-32-chars',
          METRICS_AUTH_TOKEN: 'a-valid-metrics-token-123456',
        }),
      ),
    ).toThrow(/change-this/);
  });

  it('accepts PAYMENTS_MODE=test', () => {
    expect(() => validate(baseEnv({ PAYMENTS_MODE: 'test' }))).not.toThrow();
  });

  it('accepts PAYMENTS_MODE=mock and PAYMENTS_MODE=live', () => {
    expect(() => validate(baseEnv({ PAYMENTS_MODE: 'mock' }))).not.toThrow();
    expect(() => validate(baseEnv({ PAYMENTS_MODE: 'live' }))).not.toThrow();
  });

  it('rejects an unknown PAYMENTS_MODE', () => {
    expect(() => validate(baseEnv({ PAYMENTS_MODE: 'staging' }))).toThrow(/PAYMENTS_MODE/);
  });
});
