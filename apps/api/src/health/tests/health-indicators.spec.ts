import { HealthCheckError } from '@nestjs/terminus';
import { PrismaHealthIndicator } from '../prisma-health.indicator';
import { RedisHealthIndicator } from '../redis-health.indicator';
import { DiskHealthIndicator } from '../disk-health.indicator';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';

describe('PrismaHealthIndicator', () => {
  it('reports up when the probe query succeeds', async () => {
    const prisma = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ '1': 1 }]),
    } as unknown as PrismaService;
    const indicator = new PrismaHealthIndicator(prisma);

    await expect(indicator.isHealthy('database')).resolves.toEqual({
      database: { status: 'up' },
    });
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith('SELECT 1');
  });

  it('throws a HealthCheckError when the database is unreachable', async () => {
    const prisma = {
      $queryRawUnsafe: jest.fn().mockRejectedValue(new Error('connection refused')),
    } as unknown as PrismaService;
    const indicator = new PrismaHealthIndicator(prisma);

    await expect(indicator.isHealthy('database')).rejects.toBeInstanceOf(HealthCheckError);
    await expect(indicator.isHealthy('database')).rejects.toMatchObject({
      message: 'Prisma connection failed',
      causes: { database: { status: 'down', message: 'connection refused' } },
    });
  });
});

describe('RedisHealthIndicator', () => {
  it('reports up on PONG', async () => {
    const redisService = { ping: jest.fn().mockResolvedValue('PONG') } as unknown as RedisService;
    const indicator = new RedisHealthIndicator(redisService);

    await expect(indicator.isHealthy('redis')).resolves.toEqual({
      redis: { status: 'up' },
    });
  });

  it('fails on an unexpected response', async () => {
    const redisService = { ping: jest.fn().mockResolvedValue('NOPE') } as unknown as RedisService;
    const indicator = new RedisHealthIndicator(redisService);

    await expect(indicator.isHealthy('redis')).rejects.toMatchObject({
      message: 'Redis connection failed',
      causes: { redis: { status: 'down', message: 'Unexpected Redis response: NOPE' } },
    });
  });

  it('fails when the ping throws', async () => {
    const redisService = {
      ping: jest.fn().mockRejectedValue(new Error('redis down')),
    } as unknown as RedisService;
    const indicator = new RedisHealthIndicator(redisService);

    await expect(indicator.isHealthy('redis')).rejects.toBeInstanceOf(HealthCheckError);
    await expect(indicator.isHealthy('redis')).rejects.toMatchObject({
      causes: { redis: { status: 'down', message: 'redis down' } },
    });
  });
});

describe('DiskHealthIndicator', () => {
  const originalEnv = process.env.HEALTH_DISK_THRESHOLD_MB;
  const originalPath = process.env.HEALTH_DISK_PATH;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.HEALTH_DISK_THRESHOLD_MB;
    } else {
      process.env.HEALTH_DISK_THRESHOLD_MB = originalEnv;
    }
    if (originalPath === undefined) {
      delete process.env.HEALTH_DISK_PATH;
    } else {
      process.env.HEALTH_DISK_PATH = originalPath;
    }
    jest.resetModules();
  });

  it('reports up with usage details when free space exceeds the threshold', async () => {
    process.env.HEALTH_DISK_THRESHOLD_MB = '1';
    process.env.HEALTH_DISK_PATH = process.cwd();

    const stats = await import('node:fs/promises').then((fs) => fs.statfs(process.cwd()));
    const bsize = Number(stats.bsize);
    const availableBytes = Number(stats.bavail) * bsize;

    const indicator = new DiskHealthIndicator();
    const result = await indicator.isHealthy('disk');

    expect(result.disk.status).toBe('up');
    expect(result.disk).toMatchObject({
      path: process.cwd(),
      thresholdBytes: 1 * 1024 * 1024,
    });
    expect(Number(result.disk.availableBytes)).toBe(availableBytes);
  });

  it('throws when free space is below the threshold', async () => {
    const aboveAnyRealDisk = 10_000_000;
    process.env.HEALTH_DISK_THRESHOLD_MB = String(aboveAnyRealDisk);
    process.env.HEALTH_DISK_PATH = process.cwd();

    const indicator = new DiskHealthIndicator();

    await expect(indicator.isHealthy('disk')).rejects.toBeInstanceOf(HealthCheckError);
    await expect(indicator.isHealthy('disk')).rejects.toMatchObject({
      message: 'Disk space below threshold',
    });
  });
});
