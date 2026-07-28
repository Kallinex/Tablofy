import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client!: Redis;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    this.client = new Redis({
      host: this.configService.get<string>('redis.host', 'localhost'),
      port: this.configService.get<number>('redis.port', 6379),
      password: this.configService.get<string>('redis.password'),
      maxRetriesPerRequest: 3,
      retryStrategy(times: number): number | null {
        if (times > 3) {
          return null;
        }
        return Math.min(times * 200, 2000);
      },
    });

    this.client.on('connect', () => {
      this.logger.log('Redis connected successfully');
    });

    this.client.on('error', (error: Error) => {
      this.logger.error('Redis connection error', error.stack);
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.logger.log('Redis disconnected successfully');
    }
  }

  async getClient(): Promise<Redis> {
    return this.client;
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
  }

  async isTokenBlacklisted(jti: string): Promise<boolean> {
    const key = `blacklist:${jti}`;
    const result = await this.client.exists(key);
    return result === 1;
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
