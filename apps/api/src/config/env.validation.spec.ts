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
    WEBHOOK_ENCRYPTION_KEY: 'w'.repeat(64),
    ...overrides,
  };
}

describe('env.validation', () => {
  it('accepts a valid minimal development environment', () => {
    expect(() => validate(baseEnv())).not.toThrow();
  });

  it('accepts a container-minimal environment that omits every defaulted variable', () => {
    // Regression guard: this is the exact shape a production container was
    // started with, and validation rejected it because REDIS_URL, JWT_EXPIRATION,
    // JWT_REFRESH_EXPIRATION, THROTTLE_TTL and THROTTLE_LIMIT were declared
    // required even though every one of them has a default in its config
    // factory. The container crashed on boot before reaching any handler.
    //
    // The secrets that genuinely have no default are still supplied here, so
    // this asserts only that the *defaulted* variables stopped being mandatory.
    const containerMinimal = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://tablofy:secret@postgres:5432/tablofy?schema=public',
      JWT_SECRET: 'a-secret-that-is-at-least-32-characters-long',
      JWT_REFRESH_SECRET: 'another-secret-that-is-at-least-32-characters-long',
      REDIS_PASSWORD: 'a-redis-password-of-16-plus',
      WEBHOOK_ENCRYPTION_KEY: 'a'.repeat(64),
      METRICS_AUTH_TOKEN: 'a-metrics-token-of-16-plus',
    };

    expect(() => validate(containerMinimal)).not.toThrow();
  });

  it('still rejects a missing JWT secret, which has no safe default', () => {
    const withoutSecrets = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://tablofy:secret@postgres:5432/tablofy?schema=public',
    };

    expect(() => validate(withoutSecrets)).toThrow(/JWT_SECRET/);
    expect(() =>
      validate({
        ...withoutSecrets,
        JWT_SECRET: 'a-secret-that-is-at-least-32-characters-long',
      }),
    ).toThrow(/JWT_REFRESH_SECRET/);
  });

  it('still rejects a too-short JWT secret', () => {
    expect(() => validate(baseEnv({ JWT_SECRET: 'too-short' }))).toThrow(
      /property JWT_SECRET has failed/,
    );
  });

  it('still rejects a missing DATABASE_URL, which has no safe default', () => {
    expect(() => validate(baseEnv({ DATABASE_URL: undefined as unknown as string }))).toThrow(
      /DATABASE_URL/,
    );
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

  it('rejects any environment without WEBHOOK_ENCRYPTION_KEY', () => {
    // webhook.config.ts refuses to boot without this key in *every* environment,
    // so validation must reject it everywhere rather than only in production.
    expect(() =>
      validate(
        baseEnv({
          WEBHOOK_ENCRYPTION_KEY: undefined as unknown as string,
        }),
      ),
    ).toThrow(/WEBHOOK_ENCRYPTION_KEY/);

    expect(() =>
      validate(
        baseEnv({
          NODE_ENV: 'production',
          METRICS_ENABLED: 'false',
          REDIS_PASSWORD: 'redis-password-at-least-16-chars',
          WEBHOOK_ENCRYPTION_KEY: undefined as unknown as string,
        }),
      ),
    ).toThrow(/WEBHOOK_ENCRYPTION_KEY/);
  });

  it('rejects a too-short WEBHOOK_ENCRYPTION_KEY', () => {
    expect(() => validate(baseEnv({ WEBHOOK_ENCRYPTION_KEY: 'too-short' }))).toThrow(
      /property WEBHOOK_ENCRYPTION_KEY has failed/,
    );
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
