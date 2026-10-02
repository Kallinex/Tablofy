import { ConfigService } from '@nestjs/config';
import {
  buildRedisClientOptions,
  resolveRedisMode,
  buildRedisConnectionOptions,
} from '../redis.config';
import { validateRedisTopology } from '../../redis/redis.client';

function configWith(values: Record<string, unknown>): ConfigService {
  return {
    get: jest.fn((key: string, defaultValue?: unknown) =>
      key in values ? values[key] : defaultValue,
    ),
  } as unknown as ConfigService;
}

const clusterConfig = (extra: Record<string, unknown> = {}): ConfigService =>
  configWith({
    'redis.mode': 'cluster',
    'redis.clusterNodes': '10.0.0.1:6379,10.0.0.2:6379',
    ...extra,
  });

const sentinelConfig = (extra: Record<string, unknown> = {}): ConfigService =>
  configWith({
    'redis.mode': 'sentinel',
    'redis.sentinelHosts': '10.0.0.1:26379,10.0.0.2:26379',
    'redis.sentinelMaster': 'tablofy-master',
    ...extra,
  });

describe('resolveRedisMode', () => {
  it('defaults to standalone', () => {
    expect(resolveRedisMode({})).toBe('standalone');
  });

  it('detects cluster from cluster seeds', () => {
    expect(resolveRedisMode({ REDIS_CLUSTER_NODES: 'a:6379' })).toBe('cluster');
  });

  it('detects sentinel from the master set name alone', () => {
    expect(resolveRedisMode({ REDIS_SENTINEL_MASTER: 'mymaster' })).toBe('sentinel');
  });

  it('lets an explicit REDIS_MODE win over auto-detection', () => {
    // An operator forcing standalone must not be overridden by a leftover seed list.
    expect(resolveRedisMode({ REDIS_MODE: 'standalone', REDIS_CLUSTER_NODES: 'a:6379' })).toBe(
      'standalone',
    );
  });

  it('is case and whitespace insensitive', () => {
    expect(resolveRedisMode({ REDIS_MODE: '  CLUSTER ' })).toBe('cluster');
  });

  it('falls back to standalone for an unrecognised mode', () => {
    expect(resolveRedisMode({ REDIS_MODE: 'sharded' })).toBe('standalone');
  });
});

describe('buildRedisClientOptions', () => {
  it('produces startup nodes for cluster mode', () => {
    const built = buildRedisClientOptions(clusterConfig());

    expect(built.mode).toBe('cluster');
    if (built.mode !== 'cluster') throw new Error('expected cluster');
    expect(built.options.startupNodes).toEqual([
      { host: '10.0.0.1', port: 6379 },
      { host: '10.0.0.2', port: 6379 },
    ]);
    // Cluster must never carry a host/port pair: it would address one node only.
    expect(built.options).not.toHaveProperty('host');
    expect(built.options).not.toHaveProperty('port');
  });

  it('defaults the cluster seed port to 6379', () => {
    const built = buildRedisClientOptions(clusterConfig({ 'redis.clusterNodes': 'cache-1' }));

    expect(built.mode).toBe('cluster');
    if (built.mode !== 'cluster') throw new Error('expected cluster');
    expect(built.options.startupNodes).toEqual([{ host: 'cache-1', port: 6379 }]);
  });

  it('tolerates whitespace and trailing commas in the node list', () => {
    const built = buildRedisClientOptions(
      clusterConfig({ 'redis.clusterNodes': ' a:6379 , b:6380 ,' }),
    );

    expect(built.mode).toBe('cluster');
    if (built.mode !== 'cluster') throw new Error('expected cluster');
    expect(built.options.startupNodes).toEqual([
      { host: 'a', port: 6379 },
      { host: 'b', port: 6380 },
    ]);
  });

  it('produces sentinels and a master name for sentinel mode', () => {
    const built = buildRedisClientOptions(sentinelConfig());

    expect(built.mode).toBe('sentinel');
    if (built.mode !== 'sentinel') throw new Error('expected sentinel');
    expect(built.options.sentinels).toEqual([
      { host: '10.0.0.1', port: 26379 },
      { host: '10.0.0.2', port: 26379 },
    ]);
    expect(built.options.name).toBe('tablofy-master');
  });

  it('defaults the sentinel port to 26379', () => {
    const built = buildRedisClientOptions(
      sentinelConfig({ 'redis.sentinelHosts': 'sentinel-a,sentinel-b' }),
    );

    expect(built.mode).toBe('sentinel');
    if (built.mode !== 'sentinel') throw new Error('expected sentinel');
    expect(built.options.sentinels).toEqual([
      { host: 'sentinel-a', port: 26379 },
      { host: 'sentinel-b', port: 26379 },
    ]);
  });

  it('keeps standalone host/port unchanged', () => {
    const built = buildRedisClientOptions(
      configWith({ 'redis.mode': 'standalone', 'redis.host': 'cache', 'redis.port': 6380 }),
    );

    expect(built.mode).toBe('standalone');
    if (built.mode !== 'standalone') throw new Error('expected standalone');
    expect(built.options.host).toBe('cache');
    expect(built.options.port).toBe(6380);
  });

  it('propagates the queue override of maxRetriesPerRequest', () => {
    const built = buildRedisClientOptions(clusterConfig(), { maxRetriesPerRequest: null });

    expect(built.mode).toBe('cluster');
    if (built.mode !== 'cluster') throw new Error('expected cluster');
    expect(built.options.maxRetriesPerRequest).toBeNull();
  });

  it('omits undefined auth fields so ioredis does not try to authenticate', () => {
    const built = buildRedisClientOptions(clusterConfig());

    expect(built.mode).toBe('cluster');
    if (built.mode !== 'cluster') throw new Error('expected cluster');
    expect('password' in built.options).toBe(false);
    expect('username' in built.options).toBe(false);
    expect('tls' in built.options).toBe(false);
  });

  it('carries credentials and TLS into cluster mode', () => {
    const built = buildRedisClientOptions(
      clusterConfig({ 'redis.password': 'pw', 'redis.tls': {} }),
    );

    expect(built.mode).toBe('cluster');
    if (built.mode !== 'cluster') throw new Error('expected cluster');
    expect(built.options.password).toBe('pw');
    expect(built.options.tls).toEqual({});
  });
});

describe('buildRedisConnectionOptions with HA topologies', () => {
  it('degrades cluster mode to the first seed for non-cluster callers', () => {
    // Bull Board has no cluster client, so it must still get an addressable node.
    const options = buildRedisConnectionOptions(clusterConfig());

    expect(options.host).toBe('10.0.0.1');
    expect(options.port).toBe(6379);
  });

  it('degrades sentinel mode to the first sentinel for non-cluster callers', () => {
    const options = buildRedisConnectionOptions(sentinelConfig());

    expect(options.host).toBe('10.0.0.1');
    expect(options.port).toBe(26379);
  });

  it('falls back to localhost when cluster mode has no seeds at all', () => {
    const options = buildRedisConnectionOptions(clusterConfig({ 'redis.clusterNodes': '' }));

    expect(options.host).toBe('localhost');
    expect(options.port).toBe(6379);
  });
});

describe('validateRedisTopology', () => {
  it('accepts a complete cluster configuration', () => {
    expect(validateRedisTopology(clusterConfig())).toEqual([]);
  });

  it('rejects cluster mode without seeds', () => {
    const problems = validateRedisTopology(clusterConfig({ 'redis.clusterNodes': undefined }));

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/REDIS_CLUSTER_NODES/);
  });

  it('rejects sentinel mode without sentinels', () => {
    const problems = validateRedisTopology(sentinelConfig({ 'redis.sentinelHosts': undefined }));

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/REDIS_SENTINEL_HOSTS/);
  });

  it('rejects sentinel mode without a master set name', () => {
    // Without a master name the client cannot ask which node is the master.
    const problems = validateRedisTopology(sentinelConfig({ 'redis.sentinelMaster': '  ' }));

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/REDIS_SENTINEL_MASTER/);
  });

  it('reports every sentinel problem at once', () => {
    const problems = validateRedisTopology(
      sentinelConfig({ 'redis.sentinelHosts': undefined, 'redis.sentinelMaster': undefined }),
    );

    expect(problems).toHaveLength(2);
  });

  it('has nothing to say about standalone', () => {
    expect(validateRedisTopology(configWith({ 'redis.mode': 'standalone' }))).toEqual([]);
  });
});
