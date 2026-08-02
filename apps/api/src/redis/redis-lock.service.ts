import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { RedisService } from './redis.service';

const LOCK_PREFIX = 'lock:';

@Injectable()
export class RedisLockService {
  private readonly logger = new Logger(RedisLockService.name);

  constructor(private readonly redisService: RedisService) {}

  async acquire(key: string, ttlMs: number): Promise<string | null> {
    const token = randomUUID();
    const client = await this.redisService.getClient();
    const result = await client.set(LOCK_PREFIX + key, token, 'PX', ttlMs, 'NX');
    if (result === 'OK') {
      return token;
    }
    return null;
  }

  async release(key: string, token: string): Promise<boolean> {
    const client = await this.redisService.getClient();
    const released = await client.eval(
      `if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0`,
      1,
      LOCK_PREFIX + key,
      token,
    );
    return released === 1;
  }

  async runIfLocked(key: string, ttlMs: number, task: () => Promise<void>): Promise<boolean> {
    const token = await this.acquire(key, ttlMs);
    if (!token) {
      this.logger.warn(`Skipping "${key}": lock not acquired (another instance holds it)`);
      return false;
    }
    try {
      await task();
    } finally {
      await this.release(key, token);
    }
    return true;
  }
}
