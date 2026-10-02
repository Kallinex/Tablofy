import { ConfigService } from '@nestjs/config';
import { redisConfig, buildRedisConnectionOptions } from './redis.config';

function configWith(values: Record<string, unknown>): ConfigService {
  return {
    get: jest.fn((key: string, defaultValue?: unknown) => {
      if (key in values) return values[key];
      return defaultValue;
    }),
  } as unknown as ConfigService;
}

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

describe('buildRedisConnectionOptions', () => {
  it('passes host, port and password through when configured (P1-08)', () => {
    const configService = configWith({
      'redis.host': 'cache.internal',
      'redis.port': 6380,
      'redis.password': 's3cret',
      'redis.tls': undefined,
    });

    const options = buildRedisConnectionOptions(configService);

    expect(options).toEqual({
      host: 'cache.internal',
      port: 6380,
      password: 's3cret',
      maxRetriesPerRequest: undefined,
    });
  });

  it('omits password and tls when absent (P1-08)', () => {
    const configService = configWith({
      'redis.host': 'localhost',
      'redis.port': 6379,
      'redis.password': undefined,
      'redis.tls': undefined,
    });

    const options = buildRedisConnectionOptions(configService);

    expect(options.password).toBeUndefined();
    expect('password' in options).toBe(false);
    expect('tls' in options).toBe(false);
  });

  it('adds a tls option when REDIS_TLS is enabled (P1-08)', () => {
    const configService = configWith({
      'redis.host': 'localhost',
      'redis.port': 6379,
      'redis.tls': {},
    });

    const options = buildRedisConnectionOptions(configService);

    expect(options.tls).toEqual({});
  });

  it('honors an explicit maxRetriesPerRequest override (P1-08)', () => {
    const configService = configWith({});

    const queueOptions = buildRedisConnectionOptions(configService, {
      maxRetriesPerRequest: null,
    });

    expect(queueOptions.maxRetriesPerRequest).toBeNull();
  });

  it('defaults to localhost:6379 without any configuration (P1-08)', () => {
    const configService = configWith({});

    const options = buildRedisConnectionOptions(configService);

    expect(options).toEqual({
      host: 'localhost',
      port: 6379,
      maxRetriesPerRequest: undefined,
    });
  });
});

describe('redisConfig', () => {
  it('reads host, port, password, url and tls from the environment (P1-08)', () => {
    withEnv(
      {
        REDIS_HOST: 'redis.east.internal',
        REDIS_PORT: '6380',
        REDIS_PASSWORD: 'pw-123',
        REDIS_URL: 'redis://redis.east.internal:6380',
        REDIS_TLS: 'true',
      },
      () => {
        expect(redisConfig()).toEqual({
          mode: 'standalone',
          host: 'redis.east.internal',
          port: 6380,
          password: 'pw-123',
          url: 'redis://redis.east.internal:6380',
          db: undefined,
          username: undefined,
          sentinelHosts: undefined,
          sentinelMaster: undefined,
          sentinelPassword: undefined,
          sentinelRole: undefined,
          clusterNodes: undefined,
          clusterScaleReads: undefined,
          connectTimeout: undefined,
          tls: {},
        });
      },
    );
  });

  it('omits password and tls when unset (P1-08)', () => {
    withEnv(
      {
        REDIS_HOST: undefined,
        REDIS_PORT: undefined,
        REDIS_PASSWORD: undefined,
        REDIS_URL: undefined,
        REDIS_TLS: undefined,
      },
      () => {
        const config = redisConfig();
        expect(config.host).toBe('localhost');
        expect(config.port).toBe(6379);
        expect(config.password).toBeUndefined();
        expect(config.tls).toBeUndefined();
      },
    );
  });

  it('derives the connection from REDIS_URL when the discrete vars are absent', () => {
    withEnv(
      {
        REDIS_HOST: undefined,
        REDIS_PORT: undefined,
        REDIS_PASSWORD: undefined,
        REDIS_URL: 'redis://:url-secret@cache.internal:6380/0',
        REDIS_TLS: undefined,
      },
      () => {
        const config = redisConfig();
        expect(config.host).toBe('cache.internal');
        expect(config.port).toBe(6380);
        expect(config.password).toBe('url-secret');
      },
    );
  });

  it('keeps explicit REDIS_HOST/REDIS_PORT authoritative over REDIS_URL', () => {
    withEnv(
      {
        REDIS_HOST: 'localhost',
        REDIS_PORT: '6381',
        REDIS_PASSWORD: 'explicit-pw',
        REDIS_URL: 'redis://localhost:6379',
        REDIS_TLS: undefined,
      },
      () => {
        const config = redisConfig();
        expect(config.host).toBe('localhost');
        expect(config.port).toBe(6381);
        expect(config.password).toBe('explicit-pw');
      },
    );
  });

  it('enables TLS for rediss URLs', () => {
    withEnv(
      {
        REDIS_HOST: undefined,
        REDIS_PORT: undefined,
        REDIS_PASSWORD: undefined,
        REDIS_URL: 'rediss://secure.internal:6390',
        REDIS_TLS: undefined,
      },
      () => {
        const config = redisConfig();
        expect(config.host).toBe('secure.internal');
        expect(config.port).toBe(6390);
        expect(config.tls).toEqual({});
      },
    );
  });
});
