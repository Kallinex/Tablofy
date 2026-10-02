import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { createRedisClient, RedisClient } from './redis.client';
import { buildRedisClientOptions, RedisMode } from '../config/redis.config';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client!: RedisClient;
  private mode: RedisMode = 'standalone';

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Branching on the configured mode rather than `instanceof Redis.Cluster`
    // keeps the behaviour explicit and independent of ioredis class identity.
    this.mode = buildRedisClientOptions(this.configService).mode;

    this.client = createRedisClient(this.configService, {
      // Bound the application client's retries so a request fails fast instead of
      // hanging for the full ioredis default when Redis is unreachable.
      maxRetriesPerRequest: 3,
    }) as Redis;

    this.client.on('connect', () => {
      this.logger.log('Redis connected successfully');
    });

    this.client.on('error', (error: unknown) => {
      const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
      this.logger.error('Redis connection error', detail);
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.logger.log('Redis disconnected successfully');
    }
  }

  async getClient(): Promise<Redis> {
    return this.client as Redis;
  }

  /**
   * Collects keys matching a pattern.
   *
   * In cluster mode a Cluster-level SCAN is routed to a single arbitrary node, so
   * it would return a partial key set. Since this feeds `deletePattern`, a partial
   * result leaves stale cache entries behind - a silent correctness bug that shows
   * up much later as data that should have been invalidated still being served.
   * Every master is therefore scanned and the results merged.
   */
  async scanKeys(pattern: string, count = 100): Promise<string[]> {
    const keys = new Set<string>();

    if (this.mode === 'cluster') {
      const cluster = this.client as unknown as InstanceType<typeof Redis.Cluster>;
      const masters = clusterMasters(cluster);
      if (masters.length === 0) {
        return [];
      }
      await Promise.all(
        masters.map(async (node) => {
          const found = await scanNode(node, pattern, count);
          for (const key of found) {
            keys.add(key);
          }
        }),
      );
      return [...keys];
    }

    const client = this.client as Redis;
    let cursor = '0';
    do {
      const [nextCursor, batch] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', count);
      for (const key of batch) {
        keys.add(key);
      }
      cursor = nextCursor;
    } while (cursor !== '0');

    return [...keys];
  }

  async ping(): Promise<string> {
    return this.client.ping();
  }

  // ============================================
  // Token Blacklist
  // ============================================

  async blacklistToken(jti: string, ttlSeconds: number): Promise<void> {
    const key = `blacklist:${jti}`;
    await this.client.set(key, '1', 'EX', ttlSeconds);
    try {
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
      await this.prisma.revokedToken.upsert({
        where: { jti },
        update: { expiresAt },
        create: { jti, expiresAt },
      });
    } catch {
      this.logger.warn(`Failed to persist revoked token ${jti} to database`);
    }
  }

  async isTokenBlacklisted(jti: string): Promise<boolean> {
    const key = `blacklist:${jti}`;
    const result = await this.client.exists(key);
    if (result === 1) return true;
    try {
      const revoked = await this.prisma.revokedToken.findUnique({ where: { jti } });
      if (revoked) {
        const ttl = Math.max(1, Math.floor((revoked.expiresAt.getTime() - Date.now()) / 1000));
        await this.client.set(key, '1', 'EX', ttl);
        return true;
      }
    } catch {
      this.logger.warn(`Failed to check revoked token ${jti} in database`);
    }
    return false;
  }

  // ============================================
  // Session Management
  // ============================================

  async setSession(
    sessionId: string,
    data: Record<string, unknown>,
    ttlSeconds: number,
  ): Promise<void> {
    const key = `session:${sessionId}`;
    await this.client.set(key, JSON.stringify(data), 'EX', ttlSeconds);
  }

  async getSession(sessionId: string): Promise<Record<string, unknown> | null> {
    const key = `session:${sessionId}`;
    const data = await this.client.get(key);
    return data ? JSON.parse(data) : null;
  }

  async deleteSession(sessionId: string): Promise<void> {
    const key = `session:${sessionId}`;
    await this.client.del(key);
  }

  async getUserSessionIds(userId: string): Promise<string[]> {
    const key = `user_sessions:${userId}`;
    return this.client.smembers(key);
  }

  async addUserSession(userId: string, sessionId: string): Promise<void> {
    const key = `user_sessions:${userId}`;
    await this.client.sadd(key, sessionId);
  }

  async removeUserSession(userId: string, sessionId: string): Promise<void> {
    const key = `user_sessions:${userId}`;
    await this.client.srem(key, sessionId);
  }

  async deleteUserSessions(userId: string): Promise<void> {
    const sessionIds = await this.getUserSessionIds(userId);
    if (sessionIds.length > 0) {
      const pipeline = this.client.pipeline();
      for (const id of sessionIds) {
        pipeline.del(`session:${id}`);
      }
      pipeline.del(`user_sessions:${userId}`);
      await pipeline.exec();
    }
  }

  // ============================================
  // Temporary Tokens (verification, password reset)
  // ============================================

  async setTemporaryToken(
    token: string,
    data: Record<string, unknown>,
    ttlSeconds: number,
  ): Promise<void> {
    const key = `temp:${token}`;
    await this.client.set(key, JSON.stringify(data), 'EX', ttlSeconds);
  }

  async getTemporaryToken(token: string): Promise<Record<string, unknown> | null> {
    const key = `temp:${token}`;
    const data = await this.client.get(key);
    return data ? JSON.parse(data) : null;
  }

  async deleteTemporaryToken(token: string): Promise<void> {
    const key = `temp:${token}`;
    await this.client.del(key);
  }

  // ============================================
  // Rate Limiting Helpers
  // ============================================

  async incrementCounter(key: string, ttlSeconds: number): Promise<number> {
    const result = await this.client.incr(key);
    if (result === 1) {
      await this.client.expire(key, ttlSeconds);
    }
    return result;
  }

  async getCounter(key: string): Promise<number> {
    const result = await this.client.get(key);
    return result ? parseInt(result, 10) : 0;
  }

  // ============================================
  // Generic Key-Value
  // ============================================

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length > 0) {
      await this.client.del(...keys);
    }
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result === 1;
  }

  async setHash(key: string, field: string, value: string): Promise<void> {
    await this.client.hset(key, field, value);
  }

  async getHash(key: string, field: string): Promise<string | null> {
    return this.client.hget(key, field);
  }

  async getAllHash(key: string): Promise<Record<string, string>> {
    return this.client.hgetall(key);
  }
}

/**
 * Returns the per-node clients for every master in the cluster.
 *
 * ioredis types `Cluster#nodes()` as `Redis[]`, but it actually returns
 * `ClusterNode` wrappers that carry the node's own `Redis` connection under
 * `.redis`. Scanning the wrapper directly would issue the command on the cluster
 * proxy, which routes it to a single arbitrary node - the exact partial-result
 * bug this avoids - so the cast is deliberate and load-bearing.
 */
function clusterMasters(cluster: InstanceType<typeof Redis.Cluster>): Redis[] {
  const nodes = cluster.nodes('master') as unknown as { redis: Redis }[];
  return nodes.map((node) => node.redis);
}

/** Runs a full cursor scan against one node, mirroring the standalone loop. */
async function scanNode(node: Redis, pattern: string, count: number): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [nextCursor, batch] = await node.scan(cursor, 'MATCH', pattern, 'COUNT', count);
    keys.push(...batch);
    cursor = nextCursor;
  } while (cursor !== '0');
  return keys;
}
