import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../redis.service';

jest.mock('ioredis', () => {
  const mockRedis = {
    on: jest.fn().mockReturnThis(),
    set: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null),
    del: jest.fn().mockResolvedValue(1),
    exists: jest.fn().mockResolvedValue(0),
    ping: jest.fn().mockResolvedValue('PONG'),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    sadd: jest.fn().mockResolvedValue(1),
    srem: jest.fn().mockResolvedValue(1),
    smembers: jest.fn().mockResolvedValue([]),
    hset: jest.fn().mockResolvedValue(1),
    hget: jest.fn().mockResolvedValue(null),
    hgetall: jest.fn().mockResolvedValue({}),
    pipeline: jest.fn().mockReturnValue({
      del: jest.fn(),
      set: jest.fn(),
      get: jest.fn(),
      exec: jest.fn().mockResolvedValue([]),
    }),
    quit: jest.fn().mockResolvedValue('OK'),
    status: 'ready',
  };
  return jest.fn(() => mockRedis);
});

describe('RedisService', () => {
  let service: RedisService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: unknown) => {
              const config: Record<string, unknown> = {
                'redis.host': 'localhost',
                'redis.port': 6379,
                'redis.password': undefined,
              };
              return config[key] ?? defaultValue;
            }),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            revokedToken: {
              upsert: jest.fn().mockResolvedValue({}),
              findUnique: jest.fn().mockResolvedValue(null),
            },
          },
        },
      ],
    }).compile();

    service = module.get<RedisService>(RedisService);
  });

  beforeEach(async () => {
    await service.onModuleInit();
  });

  it('should ping successfully', async () => {
    const result = await service.ping();
    expect(result).toBe('PONG');
  });

  describe('token blacklist', () => {
    it('should blacklist a token', async () => {
      await expect(service.blacklistToken('jti-1', 3600)).resolves.not.toThrow();
    });

    it('should check if token is blacklisted', async () => {
      const result = await service.isTokenBlacklisted('jti-1');
      expect(result).toBe(false);
    });
  });

  describe('session management', () => {
    it('should set and get session', async () => {
      await expect(
        service.setSession('session-1', { userId: 'user-1' }, 3600),
      ).resolves.not.toThrow();
      const result = await service.getSession('session-1');
      expect(result).toBeNull();
    });

    it('should delete session', async () => {
      await expect(service.deleteSession('session-1')).resolves.not.toThrow();
    });

    it('should manage user sessions', async () => {
      await expect(service.addUserSession('user-1', 'session-1')).resolves.not.toThrow();
      await expect(service.removeUserSession('user-1', 'session-1')).resolves.not.toThrow();
      const sessions = await service.getUserSessionIds('user-1');
      expect(sessions).toEqual([]);
    });

    it('should delete all user sessions', async () => {
      await expect(service.deleteUserSessions('user-1')).resolves.not.toThrow();
    });
  });

  describe('temporary tokens', () => {
    it('should set and get temporary token', async () => {
      await expect(
        service.setTemporaryToken('token-1', { email: 'test@test.com' }, 3600),
      ).resolves.not.toThrow();
      const result = await service.getTemporaryToken('token-1');
      expect(result).toBeNull();
    });

    it('should delete temporary token', async () => {
      await expect(service.deleteTemporaryToken('token-1')).resolves.not.toThrow();
    });
  });

  describe('counter', () => {
    it('should increment counter', async () => {
      const result = await service.incrementCounter('counter:test', 60);
      expect(result).toBe(1);
    });

    it('should get counter value', async () => {
      const result = await service.getCounter('counter:test');
      expect(result).toBe(0);
    });
  });

  describe('key-value', () => {
    it('should set and get value', async () => {
      await service.set('key-1', 'value-1');
      const result = await service.get('key-1');
      expect(result).toBeNull();
    });

    it('should delete keys', async () => {
      await expect(service.del('key-1')).resolves.not.toThrow();
    });

    it('should check key existence', async () => {
      const result = await service.exists('key-1');
      expect(result).toBe(false);
    });
  });

  describe('hash operations', () => {
    it('should set and get hash field', async () => {
      await expect(service.setHash('hash-1', 'field-1', 'value-1')).resolves.not.toThrow();
      const result = await service.getHash('hash-1', 'field-1');
      expect(result).toBeNull();
    });

    it('should get all hash fields', async () => {
      const result = await service.getAllHash('hash-1');
      expect(result).toEqual({});
    });
  });
});
