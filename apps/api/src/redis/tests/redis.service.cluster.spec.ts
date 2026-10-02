import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../redis.service';

// jest.mock factories are hoisted above module-scope consts, so everything the
// factory touches is looked up lazily from the global jest object at call time.

jest.mock('ioredis', () => {
  const client = {
    on: jest.fn().mockReturnThis(),
    quit: jest.fn().mockResolvedValue('OK'),
    ping: jest.fn().mockResolvedValue('PONG'),
    nodes: (...args: unknown[]): unknown =>
      (globalThis as { __clusterNodesMock: jest.Mock }).__clusterNodesMock(...args),
  };
  const RedisCtor = jest.fn(() => client);
  const ClusterCtor = jest.fn(() => client);
  return Object.assign(RedisCtor, {
    __esModule: true,
    default: RedisCtor,
    Redis: RedisCtor,
    Cluster: ClusterCtor,
  });
});

let nodesMock: jest.Mock;
let redisCtorMock: jest.Mock;

beforeEach(() => {
  nodesMock = jest.fn();
  (globalThis as { __clusterNodesMock?: jest.Mock }).__clusterNodesMock = nodesMock;
  const ioredis = jest.requireMock('ioredis');
  redisCtorMock = ioredis.Redis as jest.Mock;
  redisCtorMock.mockClear();
});

afterEach(() => {
  delete (globalThis as { __clusterNodesMock?: jest.Mock }).__clusterNodesMock;
});

function nodes(): jest.Mock {
  return (globalThis as { __clusterNodesMock: jest.Mock }).__clusterNodesMock;
}

const prismaStub = {
  revokedToken: { upsert: jest.fn(), findUnique: jest.fn().mockResolvedValue(null) },
} as unknown as PrismaService;

function buildService(values: Record<string, unknown>): RedisService {
  const configService = {
    get: (key: string, defaultValue?: unknown) => (key in values ? values[key] : defaultValue),
  } as unknown as ConfigService;
  const service = new RedisService(configService, prismaStub);
  return service;
}

/** Builds a node wrapper shaped like ioredis's ClusterNode. */
function node(keysPerCursor: string[][]): { redis: unknown; keysPerCursor: string[][] } {
  let call = 0;
  const redis = {
    scan: jest.fn().mockImplementation(() => {
      const batch = keysPerCursor[call] ?? [];
      call += 1;
      return Promise.resolve([call === keysPerCursor.length ? '0' : String(call), batch]);
    }),
  };
  return { redis, keysPerCursor };
}

describe('RedisService cluster scanKeys', () => {
  it('scans every master and merges the results', async () => {
    // A Cluster-level SCAN only reaches one node, so the per-node merge is what
    // stops stale cache entries from surviving a deletePattern.
    const first = node([['cache:t1:list:1', 'cache:t1:list:2']]);
    const second = node([['cache:t1:list:3']]);
    const third = node([['cache:t1:list:4'], ['cache:t1:list:5']]);
    nodes().mockReturnValue([
      { redis: first.redis },
      { redis: second.redis },
      { redis: third.redis },
    ]);

    const service = buildService({
      'redis.mode': 'cluster',
      'redis.clusterNodes': 'a:6379,b:6379,c:6379',
    });
    await service.onModuleInit();

    const keys = await service.scanKeys('cache:t1:list:*');

    expect(keys.sort()).toEqual([
      'cache:t1:list:1',
      'cache:t1:list:2',
      'cache:t1:list:3',
      'cache:t1:list:4',
      'cache:t1:list:5',
    ]);
    // Every master must be scanned, not just the first.
    expect(first.redis.scan).toHaveBeenCalled();
    expect(second.redis.scan).toHaveBeenCalled();
    expect(third.redis.scan).toHaveBeenCalledTimes(2);
  });

  it('returns an empty list when the cluster reports no masters', async () => {
    nodes().mockReturnValue([]);

    const service = buildService({
      'redis.mode': 'cluster',
      'redis.clusterNodes': 'a:6379',
    });
    await service.onModuleInit();

    await expect(service.scanKeys('cache:*')).resolves.toEqual([]);
  });

  it('scans the node connection rather than the cluster proxy', async () => {
    const single = node([['k1']]);
    nodes().mockReturnValue([{ redis: single.redis }]);

    const service = buildService({
      'redis.mode': 'cluster',
      'redis.clusterNodes': 'a:6379',
    });
    await service.onModuleInit();
    await service.scanKeys('k*');

    // The wrapper's `.redis` must be used; scanning the Cluster itself would
    // route to one arbitrary node and return a partial key set.
    expect(single.redis.scan).toHaveBeenCalledWith('0', 'MATCH', 'k*', 'COUNT', 100);
  });
});

describe('RedisService standalone scanKeys', () => {
  it('uses a single cursor loop and does not ask for cluster nodes', async () => {
    const client = {
      on: jest.fn().mockReturnThis(),
      scan: jest
        .fn()
        .mockResolvedValueOnce(['2', ['a:1']])
        .mockResolvedValueOnce(['0', ['a:2']]),
      quit: jest.fn().mockResolvedValue('OK'),
    };
    redisCtorMock.mockImplementation(() => client);

    const service = buildService({ 'redis.mode': 'standalone', 'redis.host': 'localhost' });
    await service.onModuleInit();

    const keys = await service.scanKeys('a:*');

    expect(keys).toEqual(['a:1', 'a:2']);
    expect(client.scan).toHaveBeenCalledTimes(2);
    expect(nodes()).not.toHaveBeenCalled();
  });
});
