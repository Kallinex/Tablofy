import { ConfigService } from '@nestjs/config';
import { appConfig } from '../app.config';
import { databaseConfig } from '../database.config';
import { jwtConfig } from '../jwt.config';
import { redisConfig, buildRedisConnectionOptions } from '../redis.config';
import { throttleConfig } from '../throttle.config';
import loggingConfig from '../logging.config';
import monitoringConfig from '../monitoring.config';
import metricsConfig from '../metrics.config';
import sentryConfig from '../sentry.config';
import webhookConfig from '../webhook.config';
import smtpConfig from '../smtp.config';
import apiKeysConfig from '../api-keys.config';
import paymentsConfig, {
  DEFAULT_PAYMOB_API_BASE,
  DEFAULT_STRIPE_API_BASE,
} from '../payments.config';
import ssoConfig from '../sso.config';
import * as configBarrel from '../index';
import * as prismaBarrel from '../../prisma/index';

const MANAGED_ENV = [
  'NODE_ENV',
  'PORT',
  'API_PREFIX',
  'FRONTEND_URL',
  'CORS_ORIGINS',
  'CORS_CREDENTIALS',
  'SHUTDOWN_TIMEOUT_MS',
  'TRUST_PROXY',
  'HEALTH_MEMORY_RSS_LIMIT_MB',
  'SWAGGER_ENABLED',
  'SWAGGER_AUTH_USER',
  'SWAGGER_AUTH_PASSWORD',
  'COMPRESSION_ENABLED',
  'COMPRESSION_THRESHOLD_BYTES',
  'DATABASE_URL',
  'JWT_SECRET',
  'JWT_EXPIRATION',
  'JWT_REFRESH_SECRET',
  'JWT_REFRESH_EXPIRATION',
  'REDIS_URL',
  'REDIS_HOST',
  'REDIS_PORT',
  'REDIS_PASSWORD',
  'REDIS_TLS',
  'THROTTLE_TTL',
  'THROTTLE_LIMIT',
  'THROTTLE_PLAN_WINDOW_SECONDS',
  'THROTTLE_UNAUTHENTICATED_LIMIT',
  'THROTTLE_PLAN_FREE',
  'THROTTLE_PLAN_BASIC',
  'THROTTLE_PLAN_STANDARD',
  'THROTTLE_PLAN_PREMIUM',
  'THROTTLE_PLAN_ENTERPRISE',
  'THROTTLE_API_KEY_ENABLED',
  'THROTTLE_API_KEY_LIMIT',
  'THROTTLE_API_KEY_WINDOW_SECONDS',
  'LOG_LEVEL',
  'LOG_JSON',
  'LOG_DIR',
  'LOG_MAX_FILES',
  'LOG_MAX_SIZE',
  'LOG_CONSOLE',
  'MONITOR_SLOW_QUERY_MS',
  'MONITOR_SLOW_REQUEST_MS',
  'MONITOR_QUEUE_DELAY_MS',
  'MONITOR_LARGE_PAYLOAD_BYTES',
  'MONITOR_HIGH_MEMORY_MB',
  'METRICS_ENABLED',
  'METRICS_ENDPOINT',
  'METRICS_COLLECT_DEFAULT',
  'METRICS_COLLECT_INTERVAL_MS',
  'METRICS_AUTH_TOKEN',
  'SENTRY_DSN',
  'SENTRY_ENABLED',
  'SENTRY_TRACES_SAMPLE_RATE',
  'SENTRY_PROFILES_SAMPLE_RATE',
  'WEBHOOK_ENCRYPTION_KEY',
  'WEBHOOK_MAX_RETRIES',
  'WEBHOOK_INITIAL_BACKOFF_MS',
  'WEBHOOK_BACKOFF_FACTOR',
  'WEBHOOK_MAX_BACKOFF_MS',
  'WEBHOOK_DELIVERY_TIMEOUT_MS',
  'WEBHOOK_MAX_REGISTRATIONS_PER_TENANT',
  'WEBHOOK_SECRET_ROTATION_DAYS',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_FROM',
  'API_KEY_PREFIX',
  'API_KEY_LENGTH',
  'API_KEY_MAX_KEYS_PER_TENANT',
  'API_KEY_RATE_LIMIT_PER_MIN',
  'PAYMENTS_MODE',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_API_BASE',
  'PAYMOB_API_KEY',
  'PAYMOB_INTEGRATION_ID',
  'PAYMOB_API_BASE',
  'PAYMOB_WEBHOOK_SECRET',
  'SSO_ENABLED',
  'SSO_ENCRYPTION_KEY',
  'SSO_CALLBACK_BASE_URL',
  'SSO_SUCCESS_REDIRECT_URL',
  'SSO_FAILURE_REDIRECT_URL',
  'SSO_STATE_TTL_SECONDS',
  'SSO_EXCHANGE_CODE_TTL_SECONDS',
];

const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of MANAGED_ENV) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  process.env.WEBHOOK_ENCRYPTION_KEY = 'k'.repeat(32);
});

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  saved.clear();
});

describe('appConfig', () => {
  it('exposes safe defaults', () => {
    expect(appConfig()).toEqual({
      port: 3000,
      apiPrefix: 'api',
      nodeEnv: 'development',
      frontendUrl: 'http://localhost:4200',
      corsOrigins: ['http://localhost:4200', 'http://localhost:3000'],
      corsCredentials: true,
      shutdownTimeoutMs: 15000,
      trustProxy: '',
      healthMemoryRssLimitMb: 300,
      swaggerEnabled: '',
      swaggerAuthUser: '',
      swaggerAuthPassword: '',
      compressionEnabled: true,
      compressionThreshold: 1024,
    });
  });

  it('parses swagger auth and compression overrides', () => {
    process.env.SWAGGER_AUTH_USER = 'admin';
    process.env.SWAGGER_AUTH_PASSWORD = 's3cret';
    process.env.COMPRESSION_ENABLED = 'false';
    process.env.COMPRESSION_THRESHOLD_BYTES = '2048';

    const config = appConfig();

    expect(config.swaggerAuthUser).toBe('admin');
    expect(config.swaggerAuthPassword).toBe('s3cret');
    expect(config.compressionEnabled).toBe(false);
    expect(config.compressionThreshold).toBe(2048);
  });

  it('reads overrides from the environment', () => {
    process.env.PORT = '8080';
    process.env.API_PREFIX = 'v2';
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGINS = 'https://a.com, https://b.com';
    process.env.CORS_CREDENTIALS = 'false';
    process.env.SHUTDOWN_TIMEOUT_MS = '5000';

    const config = appConfig();

    expect(config.port).toBe(8080);
    expect(config.apiPrefix).toBe('v2');
    expect(config.nodeEnv).toBe('production');
    expect(config.corsOrigins).toEqual(['https://a.com', 'https://b.com']);
    expect(config.corsCredentials).toBe(false);
    expect(config.shutdownTimeoutMs).toBe(5000);
  });

  it('keeps credentials enabled unless explicitly disabled', () => {
    process.env.CORS_CREDENTIALS = 'true';
    expect(appConfig().corsCredentials).toBe(true);
  });
});

describe('databaseConfig', () => {
  it('returns the database url', () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@db:5432/tablofy';
    expect(databaseConfig()).toEqual({ url: 'postgresql://user:pass@db:5432/tablofy' });
  });

  it('is undefined when unset', () => {
    expect(databaseConfig().url).toBeUndefined();
  });
});

describe('jwtConfig', () => {
  it('exposes the token lifetimes', () => {
    expect(jwtConfig()).toEqual({
      secret: undefined,
      expiration: '15m',
      refreshSecret: undefined,
      refreshExpiration: '7d',
    });
  });

  it('reads overrides', () => {
    process.env.JWT_SECRET = 'a'.repeat(32);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(32);
    process.env.JWT_EXPIRATION = '1h';
    process.env.JWT_REFRESH_EXPIRATION = '30d';

    expect(jwtConfig()).toEqual({
      secret: 'a'.repeat(32),
      expiration: '1h',
      refreshSecret: 'b'.repeat(32),
      refreshExpiration: '30d',
    });
  });
});

describe('redisConfig', () => {
  it('defaults to a local unsecured instance', () => {
    expect(redisConfig()).toEqual({
      host: 'localhost',
      port: 6379,
      password: undefined,
      url: 'redis://localhost:6379',
      tls: undefined,
    });
  });

  it('derives host, port, password and tls from REDIS_URL', () => {
    process.env.REDIS_URL = 'rediss://:p%40ssword@cache.internal:6380';

    expect(redisConfig()).toMatchObject({
      host: 'cache.internal',
      port: 6380,
      password: 'p@ssword',
      tls: {},
    });
  });

  it('defaults the url port to 6379', () => {
    process.env.REDIS_URL = 'redis://cache.internal';
    expect(redisConfig().port).toBe(6379);
  });

  it('lets explicit variables win over the url', () => {
    process.env.REDIS_URL = 'rediss://url-host:6390';
    process.env.REDIS_HOST = 'explicit-host';
    process.env.REDIS_PORT = '6399';
    process.env.REDIS_PASSWORD = 'explicit-pass';

    expect(redisConfig()).toMatchObject({
      host: 'explicit-host',
      port: 6399,
      password: 'explicit-pass',
    });
  });

  it('ignores an unparsable url instead of crashing at boot', () => {
    process.env.REDIS_URL = 'not-a-url';

    expect(redisConfig()).toMatchObject({ host: 'localhost', port: 6379 });
  });

  it('ignores a non-redis protocol', () => {
    process.env.REDIS_URL = 'https://cache.internal:6380';

    expect(redisConfig()).toMatchObject({ host: 'localhost', port: 6379, tls: undefined });
  });

  it('allows forcing TLS off for a rediss url', () => {
    process.env.REDIS_URL = 'rediss://cache.internal';
    process.env.REDIS_TLS = 'false';

    expect(redisConfig().tls).toBeUndefined();
  });

  it('allows forcing TLS on for a plain url', () => {
    process.env.REDIS_URL = 'redis://cache.internal';
    process.env.REDIS_TLS = 'true';

    expect(redisConfig().tls).toEqual({});
  });

  it('trims whitespace around explicit values', () => {
    process.env.REDIS_HOST = '  spaced-host  ';
    expect(redisConfig().host).toBe('spaced-host');
  });
});

describe('buildRedisConnectionOptions', () => {
  const build = (values: Record<string, unknown>) =>
    ({
      get: (key: string, fallback?: unknown) => (key in values ? values[key] : fallback),
    }) as ConfigService;

  it('maps config into ioredis options', () => {
    const options = buildRedisConnectionOptions(
      build({
        'redis.host': 'cache',
        'redis.port': 6380,
        'redis.password': 'secret',
        'redis.tls': {},
      }),
    );

    expect(options).toEqual({
      host: 'cache',
      port: 6380,
      password: 'secret',
      tls: {},
      maxRetriesPerRequest: undefined,
    });
  });

  it('omits an empty password so ioredis does not authenticate', () => {
    const options = buildRedisConnectionOptions(build({ 'redis.host': 'cache' }));
    expect('password' in options).toBe(false);
  });

  it('omits tls when not configured', () => {
    const options = buildRedisConnectionOptions(build({ 'redis.host': 'cache' }));
    expect('tls' in options).toBe(false);
  });

  it('applies defaults when config is empty', () => {
    const options = buildRedisConnectionOptions(build({}));
    expect(options).toMatchObject({ host: 'localhost', port: 6379 });
  });

  it('passes through maxRetriesPerRequest', () => {
    const options = buildRedisConnectionOptions(build({}), { maxRetriesPerRequest: null });
    expect(options.maxRetriesPerRequest).toBeNull();
  });
});

describe('throttleConfig', () => {
  const expectedDefaults = {
    ttl: 60000,
    limit: 120,
    planWindowSeconds: 60,
    unauthenticatedLimit: 100,
    planLimits: {
      FREE: 30,
      BASIC: 60,
      STANDARD: 120,
      PREMIUM: 300,
      ENTERPRISE: 1000,
    },
    apiKeyEnabled: true,
    apiKeyLimit: 600,
    apiKeyWindowSeconds: 60,
  };

  it('converts ttl seconds to milliseconds', () => {
    expect(throttleConfig()).toEqual(expectedDefaults);
  });

  it('reads overrides', () => {
    process.env.THROTTLE_TTL = '5';
    process.env.THROTTLE_LIMIT = '10';
    expect(throttleConfig()).toMatchObject({ ttl: 5000, limit: 10 });
  });

  it('reads per-plan, unauthenticated and per-api-key overrides', () => {
    process.env.THROTTLE_PLAN_WINDOW_SECONDS = '30';
    process.env.THROTTLE_UNAUTHENTICATED_LIMIT = '7';
    process.env.THROTTLE_PLAN_ENTERPRISE = '5000';
    process.env.THROTTLE_API_KEY_LIMIT = '250';
    process.env.THROTTLE_API_KEY_WINDOW_SECONDS = '15';

    expect(throttleConfig()).toMatchObject({
      planWindowSeconds: 30,
      unauthenticatedLimit: 7,
      apiKeyLimit: 250,
      apiKeyWindowSeconds: 15,
      planLimits: {
        FREE: 30,
        BASIC: 60,
        STANDARD: 120,
        PREMIUM: 300,
        ENTERPRISE: 5000,
      },
    });
  });

  it('disables per-api-key limiting when THROTTLE_API_KEY_ENABLED is false', () => {
    process.env.THROTTLE_API_KEY_ENABLED = 'false';
    expect(throttleConfig()).toMatchObject({ apiKeyEnabled: false });
  });

  it('ignores non-positive and non-numeric limits', () => {
    process.env.THROTTLE_LIMIT = '0';
    process.env.THROTTLE_PLAN_FREE = '-5';
    process.env.THROTTLE_API_KEY_LIMIT = 'not-a-number';

    expect(throttleConfig()).toMatchObject({
      limit: 120,
      apiKeyLimit: 600,
      planLimits: expect.objectContaining({ FREE: 30 }),
    });
  });
});

describe('loggingConfig', () => {
  it('defaults to json logging to console', () => {
    expect(loggingConfig()).toEqual({
      level: 'info',
      json: true,
      dir: 'logs',
      maxFiles: '14d',
      maxSize: '100m',
      console: true,
    });
  });

  it('disables json and console when explicitly false', () => {
    process.env.LOG_JSON = 'false';
    process.env.LOG_CONSOLE = 'false';
    const config = loggingConfig();
    expect(config.json).toBe(false);
    expect(config.console).toBe(false);
  });
});

describe('monitoringConfig', () => {
  it('exposes the documented thresholds', () => {
    expect(monitoringConfig()).toEqual({
      slowQueryMs: 100,
      slowRequestMs: 500,
      queueDelayMs: 1000,
      largePayloadBytes: 1048576,
      highMemoryMb: 500,
    });
  });

  it('reads overrides', () => {
    process.env.MONITOR_SLOW_QUERY_MS = '25';
    expect(monitoringConfig().slowQueryMs).toBe(25);
  });
});

describe('metricsConfig', () => {
  it('is enabled by default with an empty auth token', () => {
    expect(metricsConfig()).toEqual({
      enabled: true,
      endpoint: 'metrics',
      collectDefaultMetrics: true,
      collectIntervalMs: 10000,
      authToken: '',
    });
  });

  it('can be disabled', () => {
    process.env.METRICS_ENABLED = 'false';
    process.env.METRICS_COLLECT_DEFAULT = 'false';
    const config = metricsConfig();
    expect(config.enabled).toBe(false);
    expect(config.collectDefaultMetrics).toBe(false);
  });
});

describe('sentryConfig', () => {
  it('stays disabled without an explicit opt-in and a dsn', () => {
    expect(sentryConfig()).toMatchObject({ enabled: false, dsn: '', environment: 'development' });
  });

  it('stays disabled when enabled without a dsn', () => {
    process.env.SENTRY_ENABLED = 'true';
    expect(sentryConfig().enabled).toBe(false);
  });

  it('enables only with both the flag and a dsn', () => {
    process.env.SENTRY_ENABLED = 'true';
    process.env.SENTRY_DSN = 'https://key@sentry.io/1';
    process.env.NODE_ENV = 'production';

    expect(sentryConfig()).toMatchObject({
      enabled: true,
      dsn: 'https://key@sentry.io/1',
      environment: 'production',
    });
  });

  it('parses sample rates', () => {
    process.env.SENTRY_TRACES_SAMPLE_RATE = '0.5';
    process.env.SENTRY_PROFILES_SAMPLE_RATE = '0';
    const config = sentryConfig();
    expect(config.tracesSampleRate).toBe(0.5);
    expect(config.profilesSampleRate).toBe(0);
  });
});

describe('webhookConfig', () => {
  it('refuses to boot without an encryption key', () => {
    delete process.env.WEBHOOK_ENCRYPTION_KEY;
    expect(() => webhookConfig()).toThrow(/WEBHOOK_ENCRYPTION_KEY is required/);
  });

  it('refuses a short encryption key', () => {
    process.env.WEBHOOK_ENCRYPTION_KEY = 'too-short';
    expect(() => webhookConfig()).toThrow(/at least 32 characters/);
  });

  it('exposes the delivery defaults', () => {
    expect(webhookConfig()).toEqual({
      maxRetries: 5,
      initialBackoffMs: 1000,
      backoffFactor: 2,
      maxBackoffMs: 3600000,
      deliveryTimeoutMs: 30000,
      maxRegistrationsPerTenant: 50,
      secretRotationDays: 90,
      encryptionKey: 'k'.repeat(32),
      encryptionAlgorithm: 'aes-256-gcm',
    });
  });

  it('accepts a key of exactly 32 characters', () => {
    process.env.WEBHOOK_ENCRYPTION_KEY = 'x'.repeat(32);
    expect(webhookConfig().encryptionKey).toHaveLength(32);
  });

  it('reads retry overrides', () => {
    process.env.WEBHOOK_MAX_RETRIES = '9';
    process.env.WEBHOOK_BACKOFF_FACTOR = '1.5';
    const config = webhookConfig();
    expect(config.maxRetries).toBe(9);
    expect(config.backoffFactor).toBe(1.5);
  });
});

describe('smtpConfig', () => {
  it('defaults to an empty, non-secure relay', () => {
    expect(smtpConfig()).toEqual({
      host: '',
      port: 587,
      secure: false,
      user: '',
      pass: '',
      from: '',
    });
  });

  it('reads overrides and enables implicit TLS', () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '465';
    process.env.SMTP_SECURE = 'true';

    expect(smtpConfig()).toMatchObject({ host: 'smtp.example.com', port: 465, secure: true });
  });

  it('refuses to boot in production without SMTP_HOST and SMTP_FROM', () => {
    process.env.NODE_ENV = 'production';

    expect(() => smtpConfig()).toThrow(/SMTP_HOST and SMTP_FROM/);
  });

  it('refuses to boot in production without SMTP_FROM', () => {
    process.env.NODE_ENV = 'production';
    process.env.SMTP_HOST = 'smtp.example.com';

    expect(() => smtpConfig()).toThrow(/SMTP_FROM/);
  });

  it('accepts a configured relay in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_FROM = 'no-reply@tablofy.com';

    expect(smtpConfig()).toMatchObject({
      host: 'smtp.example.com',
      from: 'no-reply@tablofy.com',
    });
  });

  it('does not require SMTP outside production', () => {
    process.env.NODE_ENV = 'test';
    expect(() => smtpConfig()).not.toThrow();
  });
});

describe('apiKeysConfig', () => {
  it('exposes the key policy defaults', () => {
    expect(apiKeysConfig()).toEqual({
      keyPrefix: 'tab_',
      keyLength: 48,
      maxKeysPerTenant: 20,
      rateLimitPerMin: 60,
    });
  });

  it('reads overrides', () => {
    process.env.API_KEY_PREFIX = 'live_';
    process.env.API_KEY_MAX_KEYS_PER_TENANT = '5';
    const config = apiKeysConfig();
    expect(config.keyPrefix).toBe('live_');
    expect(config.maxKeysPerTenant).toBe(5);
  });
});

describe('paymentsConfig', () => {
  it('defaults to mock mode outside production', () => {
    expect(paymentsConfig()).toMatchObject({ mode: 'mock' });
  });

  it('defaults to live mode in production when credentials exist', () => {
    process.env.NODE_ENV = 'production';
    process.env.STRIPE_SECRET_KEY = 'sk_live_abc';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_live';

    expect(paymentsConfig().mode).toBe('live');
  });

  it('rejects an unknown mode', () => {
    process.env.PAYMENTS_MODE = 'sandbox';
    expect(() => paymentsConfig()).toThrow(/Invalid PAYMENTS_MODE "sandbox"/);
  });

  it('accepts the documented modes', () => {
    process.env.PAYMENTS_MODE = 'test';
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc';
    expect(paymentsConfig().mode).toBe('test');
  });

  it('is case insensitive on the mode value', () => {
    process.env.PAYMENTS_MODE = 'MOCK';
    expect(paymentsConfig().mode).toBe('mock');
  });

  it('forbids mock mode in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.PAYMENTS_MODE = 'mock';

    expect(() => paymentsConfig()).toThrow(/forbidden in production/);
  });

  it('forbids test mode in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.PAYMENTS_MODE = 'test';
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc';

    expect(() => paymentsConfig()).toThrow(/Stripe test keys must never be used/);
  });

  it('requires a gateway credential in live mode', () => {
    process.env.PAYMENTS_MODE = 'live';

    expect(() => paymentsConfig()).toThrow(/requires at least one gateway credential/);
  });

  it('accepts paymob as the only live credential', () => {
    process.env.PAYMENTS_MODE = 'live';
    process.env.PAYMOB_API_KEY = 'paymob-key';
    process.env.PAYMOB_INTEGRATION_ID = '55';
    process.env.PAYMOB_WEBHOOK_SECRET = 'paymob-webhook-secret';

    expect(paymentsConfig().mode).toBe('live');
  });

  it('rejects a stripe test key in live mode', () => {
    process.env.PAYMENTS_MODE = 'live';
    process.env.STRIPE_SECRET_KEY = 'sk_test_leaked';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec';

    expect(() => paymentsConfig()).toThrow(/forbids Stripe test keys/);
  });

  it('rejects a non-live stripe key in live mode', () => {
    process.env.PAYMENTS_MODE = 'live';
    process.env.STRIPE_SECRET_KEY = 'pk_something';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec';

    expect(() => paymentsConfig()).toThrow(/must start with "sk_live"/);
  });

  it('requires a stripe webhook secret in live mode', () => {
    process.env.PAYMENTS_MODE = 'live';
    process.env.STRIPE_SECRET_KEY = 'sk_live_abc';

    expect(() => paymentsConfig()).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });

  it('requires a paymob integration id in live mode', () => {
    process.env.PAYMENTS_MODE = 'live';
    process.env.PAYMOB_API_KEY = 'paymob-key';
    process.env.PAYMOB_WEBHOOK_SECRET = 'paymob-webhook-secret';

    expect(() => paymentsConfig()).toThrow(/PAYMOB_INTEGRATION_ID/);
  });

  it('requires a paymob webhook secret in live mode', () => {
    process.env.PAYMENTS_MODE = 'live';
    process.env.PAYMOB_API_KEY = 'paymob-key';
    process.env.PAYMOB_INTEGRATION_ID = '55';

    expect(() => paymentsConfig()).toThrow(/PAYMOB_WEBHOOK_SECRET/);
  });

  it('requires a stripe test key in test mode', () => {
    process.env.PAYMENTS_MODE = 'test';

    expect(() => paymentsConfig()).toThrow(/requires a Stripe TEST key/);
  });

  it('exposes the default gateway bases', () => {
    expect(paymentsConfig()).toMatchObject({
      stripeApiBase: DEFAULT_STRIPE_API_BASE,
      paymobApiBase: DEFAULT_PAYMOB_API_BASE,
      paymobIntegrationId: 0,
    });
  });

  it('allows gateway base overrides', () => {
    process.env.STRIPE_API_BASE = 'https://stripe.internal';
    process.env.PAYMOB_API_BASE = 'https://paymob.internal';
    process.env.PAYMOB_INTEGRATION_ID = '77';

    expect(paymentsConfig()).toMatchObject({
      stripeApiBase: 'https://stripe.internal',
      paymobApiBase: 'https://paymob.internal',
      paymobIntegrationId: 77,
    });
  });
});

describe('ssoConfig', () => {
  it('exposes safe defaults and falls back to the webhook key', () => {
    expect(ssoConfig()).toEqual({
      enabled: false,
      encryptionKey: 'k'.repeat(32),
      stateTtlSeconds: 600,
      exchangeCodeTtlSeconds: 60,
      callbackBaseUrl: '',
      successRedirectUrl: '',
      failureRedirectUrl: '',
    });
  });

  it('reads explicit configuration', () => {
    process.env.SSO_ENABLED = 'true';
    process.env.SSO_ENCRYPTION_KEY = 's'.repeat(32);
    process.env.SSO_CALLBACK_BASE_URL = 'https://api.example.com/api/v1';
    process.env.SSO_SUCCESS_REDIRECT_URL = 'https://app.example.com/sso';
    process.env.SSO_FAILURE_REDIRECT_URL = 'https://app.example.com/login';
    process.env.SSO_STATE_TTL_SECONDS = '300';
    process.env.SSO_EXCHANGE_CODE_TTL_SECONDS = '30';

    expect(ssoConfig()).toEqual({
      enabled: true,
      encryptionKey: 's'.repeat(32),
      stateTtlSeconds: 300,
      exchangeCodeTtlSeconds: 30,
      callbackBaseUrl: 'https://api.example.com/api/v1',
      successRedirectUrl: 'https://app.example.com/sso',
      failureRedirectUrl: 'https://app.example.com/login',
    });
  });

  it('falls back to FRONTEND_URL for the success redirect', () => {
    process.env.SSO_ENABLED = 'true';
    process.env.SSO_CALLBACK_BASE_URL = 'https://api.example.com/api/v1';
    process.env.FRONTEND_URL = 'https://app.example.com';

    expect(ssoConfig()).toMatchObject({
      successRedirectUrl: 'https://app.example.com',
      failureRedirectUrl: 'https://app.example.com',
    });
  });

  it('refuses to enable SSO without a strong encryption key', () => {
    process.env.SSO_ENABLED = 'true';
    delete process.env.WEBHOOK_ENCRYPTION_KEY;
    process.env.SSO_CALLBACK_BASE_URL = 'https://api.example.com/api/v1';

    expect(() => ssoConfig()).toThrow(/SSO_ENCRYPTION_KEY/);
  });

  it('refuses to enable SSO without a redirect target', () => {
    process.env.SSO_ENABLED = 'true';

    expect(() => ssoConfig()).toThrow(/SSO_CALLBACK_BASE_URL/);
  });
});

describe('public module barrels', () => {
  it('re-exports every configuration factory', () => {
    expect(typeof configBarrel.appConfig).toBe('function');
    expect(typeof configBarrel.databaseConfig).toBe('function');
    expect(typeof configBarrel.redisConfig).toBe('function');
    expect(typeof configBarrel.jwtConfig).toBe('function');
    expect(typeof configBarrel.throttleConfig).toBe('function');
    expect(typeof configBarrel.loggingConfig).toBe('function');
    expect(typeof configBarrel.monitoringConfig).toBe('function');
    expect(typeof configBarrel.metricsConfig).toBe('function');
    expect(typeof configBarrel.sentryConfig).toBe('function');
    expect(typeof configBarrel.webhookConfig).toBe('function');
    expect(typeof configBarrel.smtpConfig).toBe('function');
    expect(typeof configBarrel.apiKeysConfig).toBe('function');
    expect(typeof configBarrel.paymentsConfig).toBe('function');
    expect(typeof configBarrel.ssoConfig).toBe('function');
  });

  it('re-exports env validation', () => {
    expect(typeof configBarrel.validate).toBe('function');
  });

  it('re-exports the prisma module and service', () => {
    expect(typeof prismaBarrel.PrismaModule).toBe('function');
    expect(typeof prismaBarrel.PrismaService).toBe('function');
  });

  it('points each barrel export at the same object as its source module', () => {
    expect(configBarrel.appConfig).toBe(appConfig);
    expect(configBarrel.databaseConfig).toBe(databaseConfig);
    expect(configBarrel.redisConfig).toBe(redisConfig);
    expect(configBarrel.jwtConfig).toBe(jwtConfig);
    expect(configBarrel.throttleConfig).toBe(throttleConfig);
    expect(configBarrel.paymentsConfig).toBe(paymentsConfig);
    expect(configBarrel.ssoConfig).toBe(ssoConfig);
  });
});
