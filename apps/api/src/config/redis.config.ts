import { registerAs, ConfigService } from '@nestjs/config';

export const redisConfig = registerAs('redis', () => ({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
}));

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
