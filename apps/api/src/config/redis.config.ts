import { registerAs, ConfigService } from '@nestjs/config';

interface RedisUrlParts {
  host?: string;
  port?: number;
  password?: string;
  secure: boolean;
}

function parseRedisUrl(url: string): RedisUrlParts {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
      return { secure: false };
    }
    return {
      host: parsed.hostname || undefined,
      port: parsed.port ? Number.parseInt(parsed.port, 10) : 6379,
      password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
      secure: parsed.protocol === 'rediss:',
    };
  } catch {
    return { secure: false };
  }
}

export const redisConfig = registerAs('redis', () => {
  const url = process.env.REDIS_URL?.trim() || 'redis://localhost:6379';
  const fromUrl = parseRedisUrl(url);
  const explicitHost = process.env.REDIS_HOST?.trim();
  const explicitPort = process.env.REDIS_PORT?.trim();
  const explicitPassword = process.env.REDIS_PASSWORD?.trim();

  // REDIS_URL is a supported connection input, not decoration: it used to be validated as
  // required and then ignored, so a URL-only deployment silently connected to localhost.
  // Explicit REDIS_HOST/REDIS_PORT/REDIS_PASSWORD always win (unchanged behaviour for every
  // existing deployment); the URL only fills in what was not provided explicitly.
  return {
    host: explicitHost || fromUrl.host || 'localhost',
    port: explicitPort ? Number.parseInt(explicitPort, 10) : (fromUrl.port ?? 6379),
    password: explicitPassword || fromUrl.password || undefined,
    url,
    tls:
      process.env.REDIS_TLS === 'true' || (fromUrl.secure && process.env.REDIS_TLS !== 'false')
        ? {}
        : undefined,
  };
});

export interface RedisConnectionOptions {
  host: string;
  port: number;
  password?: string;
  tls?: object;
  maxRetriesPerRequest?: number | null;
}

export function buildRedisConnectionOptions(
  configService: ConfigService,
  opts?: { maxRetriesPerRequest?: number | null },
): RedisConnectionOptions {
  const options: RedisConnectionOptions = {
    host: configService.get<string>('redis.host', 'localhost'),
    port: configService.get<number>('redis.port', 6379),
    password: configService.get<string>('redis.password') || undefined,
    tls: configService.get<object>('redis.tls') ? {} : undefined,
    maxRetriesPerRequest: opts?.maxRetriesPerRequest,
  };

  if (!options.password) {
    delete options.password;
  }
  if (!options.tls) {
    delete options.tls;
  }

  return options;
}
