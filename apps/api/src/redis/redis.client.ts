import { Cluster, Redis, RedisOptions } from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { buildRedisClientOptions, RedisModeOptions } from '../config/redis.config';

export type RedisClient = Redis | Cluster;

/**
 * Creates an ioredis client for the configured topology.
 *
 * Sentinel and cluster are separate classes, not option sets: a plain `Redis`
 * handed a `sentinels` array would ignore it and connect straight to the sentinel
 * host as if it were a data node. Choosing the class here keeps every caller -
 * the app's RedisService, BullMQ queues and workers - consistent.
 */
export function createRedisClient(
  configService: ConfigService,
  overrides?: { maxRetriesPerRequest?: number | null },
): RedisClient {
  const built: RedisModeOptions = buildRedisClientOptions(configService, overrides);

  if (built.mode === 'cluster') {
    return new Cluster(built.options.startupNodes, {
      scaleReads: built.options.scaleReads,
      redisOptions: {
        ...(built.options.username ? { username: built.options.username } : {}),
        ...(built.options.password ? { password: built.options.password } : {}),
        ...(built.options.tls ? { tls: built.options.tls } : {}),
        ...(built.options.connectTimeout ? { connectTimeout: built.options.connectTimeout } : {}),
        ...(built.options.maxRetriesPerRequest !== undefined
          ? { maxRetriesPerRequest: built.options.maxRetriesPerRequest }
          : {}),
      },
      // BullMQ requires an unbounded retry count on the clients it owns; the
      // application client keeps a bounded one so requests fail fast.
      clusterRetryStrategy: (times: number): number | null =>
        times > 3 ? null : Math.min(times * 200, 2000),
    });
  }

  const options = { ...built.options } as RedisOptions;
  return new Redis({
    ...options,
    // Bounded reconnection with backoff: a permanently dead Redis must not be
    // retried forever, and a blip must not fail instantly.
    retryStrategy(times: number): number | null {
      if (times > 3) {
        return null;
      }
      return Math.min(times * 200, 2000);
    },
  });
}

/**
 * Verifies the topology configuration before the app serves traffic.
 *
 * Fail-fast matters here: with a missing cluster seed or sentinel master name,
 * ioredis does not error at construction - it just retries in the background, so
 * the API would boot "healthy" while every cache read and enqueue failed.
 */
export function validateRedisTopology(configService: ConfigService): string[] {
  const problems: string[] = [];
  const built = buildRedisClientOptions(configService);

  if (built.mode === 'cluster') {
    if (built.options.startupNodes.length === 0) {
      problems.push(
        'REDIS_MODE=cluster requires REDIS_CLUSTER_NODES (comma-separated host:port seeds).',
      );
    }
  }

  if (built.mode === 'sentinel') {
    if (built.options.sentinels.length === 0) {
      problems.push(
        'REDIS_MODE=sentinel requires REDIS_SENTINEL_HOSTS (comma-separated host:port).',
      );
    }
    if (built.options.name.trim() === '') {
      problems.push('REDIS_MODE=sentinel requires REDIS_SENTINEL_MASTER (the master set name).');
    }
  }

  return problems;
}
