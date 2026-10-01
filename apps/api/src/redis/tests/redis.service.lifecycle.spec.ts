import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import Redis from 'ioredis';
import { RedisService } from '../redis.service';

const clientMock = {
  on: jest.fn().mockReturnThis(),
  set: jest.fn().mockResolvedValue('OK'),
  get: jest.fn().mockResolvedValue(null),
  quit: jest.fn().mockResolvedValue('OK'),
  ping: jest.fn().mockResolvedValue('PONG'),
  scan: jest.fn(),
};

function makeClient(): unknown {
  return clientMock;
}

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn(() => makeClient()),
}));

const redisConstructor = Redis as unknown as jest.Mock;

describe('RedisService lifecycle and key scanning', () => {
  let service: RedisService;

  beforeEach(async () => {
    jest.clearAllMocks();
    clientMock.on.mockReturnThis(clientMock);
    clientMock.quit.mockResolvedValue('OK');

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

  function handlerFor(event: string): (arg?: unknown) => void {
    const call = clientMock.on.mock.calls.find(([name]) => name === event);
    return call?.[1] as (arg?: unknown) => void;
  }

  describe('onModuleInit', () => {
    it('connects with the configured host and port and a bounded retry strategy', async () => {
      await service.onModuleInit();

      expect(redisConstructor).toHaveBeenCalledTimes(1);
      const [options] = redisConstructor.mock.calls[0] as unknown as [
        Record<string, unknown> & { retryStrategy: (times: number) => number | null },
      ];
      expect(options.host).toBe('localhost');
      expect(options.port).toBe(6379);
      expect(options.maxRetriesPerRequest).toBe(3);
      expect(options.retryStrategy(1)).toBe(200);
      expect(options.retryStrategy(2)).toBe(400);
      expect(options.retryStrategy(3)).toBe(600);
      expect(options.retryStrategy(4)).toBeNull();
    });

    it('registers connect and error handlers that do not throw', async () => {
      await service.onModuleInit();

      expect(handlerFor('connect')).toEqual(expect.any(Function));
      expect(() => handlerFor('connect')()).not.toThrow();

      const errorHandler = handlerFor('error');
      expect(() => errorHandler(new Error('connection refused'))).not.toThrow();
      expect(() => errorHandler()).not.toThrow();
    });

    it('stops retrying permanently once the fourth attempt is reached', async () => {
      await service.onModuleInit();

      const [options] = redisConstructor.mock.calls[0] as unknown as [
        { retryStrategy: (times: number) => number | null },
      ];
      expect(options.retryStrategy(4)).toBeNull();
      expect(options.retryStrategy(5)).toBeNull();
    });
  });

  describe('onModuleDestroy', () => {
    it('quits the client', async () => {
      await service.onModuleInit();
      await service.onModuleDestroy();

      expect(clientMock.quit).toHaveBeenCalledTimes(1);
    });

    it('does not fail when the module never connected', async () => {
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
      expect(clientMock.quit).not.toHaveBeenCalled();
    });
  });

  describe('getClient', () => {
    it('returns the connected client', async () => {
      await service.onModuleInit();

      await expect(service.getClient()).resolves.toBe(clientMock);
    });
  });

  describe('scanKeys', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('collects every key across multiple scan batches', async () => {
      clientMock.scan
        .mockResolvedValueOnce(['12', ['a:1', 'a:2']])
        .mockResolvedValueOnce(['0', ['a:3']]);

      await expect(service.scanKeys('a:*')).resolves.toEqual(['a:1', 'a:2', 'a:3']);
      expect(clientMock.scan).toHaveBeenCalledTimes(2);
      expect(clientMock.scan.mock.calls[0]).toEqual(['0', 'MATCH', 'a:*', 'COUNT', 100]);
      expect(clientMock.scan.mock.calls[1][0]).toBe('12');
    });

    it('honours a custom count and skips empty batches', async () => {
      clientMock.scan.mockResolvedValueOnce(['9', []]).mockResolvedValueOnce(['0', ['b:1']]);

      await expect(service.scanKeys('b:*', 5)).resolves.toEqual(['b:1']);
      expect(clientMock.scan.mock.calls[0]).toEqual(['0', 'MATCH', 'b:*', 'COUNT', 5]);
    });

    it('returns an empty list when the pattern matches nothing', async () => {
      clientMock.scan.mockResolvedValue(['0', []]);

      await expect(service.scanKeys('nothing:*')).resolves.toEqual([]);
    });
  });

  describe('ping', () => {
    it('delegates to the client', async () => {
      await service.onModuleInit();
      clientMock.ping.mockResolvedValue('PONG');

      await expect(service.ping()).resolves.toBe('PONG');
      expect(clientMock.ping).toHaveBeenCalled();
    });
  });
});
