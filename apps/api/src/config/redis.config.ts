import { registerAs, ConfigService } from '@nestjs/config';

interface RedisUrlParts {
  host?: string;
  port?: number;
  password?: string;
  secure: boolean;
}

function parseRedisUrl(url: string): RedisUrlParts {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
      return { secure: false };
    }
    return {
      host: parsed.hostname || undefined,
      port: parsed.port ? Number.parseInt(parsed.port, 10) : 6379,
      password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
      secure: parsed.protocol === 'rediss:',
    };
  } catch {
    return { secure: false };
  }
}

export type RedisMode = 'standalone' | 'sentinel' | 'cluster';

export interface SentinelNode {
  host: string;
  port: number;
}

export interface ClusterNode {
  host: string;
  port: number;
}

/** Parses a `host:port,host:port` list, defaulting the port when omitted. */
function parseNodeList(raw: string | undefined, defaultPort: number): SentinelNode[] {
  if (!raw) {
    return [];
  }
  const nodes: SentinelNode[] = [];
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (trimmed === '') {
      continue;
    }
    const separator = trimmed.lastIndexOf(':');
    if (separator === -1) {
      nodes.push({ host: trimmed, port: defaultPort });
      continue;
    }
    const host = trimmed.slice(0, separator).trim();
    const port = Number.parseInt(trimmed.slice(separator + 1), 10);
    if (host !== '' && Number.isFinite(port)) {
      nodes.push({ host, port });
    }
  }
  return nodes;
}

export function resolveRedisMode(env: NodeJS.ProcessEnv): RedisMode {
  const explicit = env.REDIS_MODE?.trim().toLowerCase();
  if (explicit === 'sentinel' || explicit === 'cluster' || explicit === 'standalone') {
    return explicit;
  }
  // Auto-detect so an operator only has to supply the topology variables.
  if (env.REDIS_CLUSTER_NODES?.trim() || env.REDIS_CLUSTER_NODES_RAW?.trim()) {
    return 'cluster';
  }
  if (env.REDIS_SENTINEL_HOSTS?.trim() || env.REDIS_SENTINEL_MASTER?.trim()) {
    return 'sentinel';
  }
  return 'standalone';
}

function parseInteger(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : undefined;
}

export const redisConfig = registerAs('redis', () => {
  const url = process.env.REDIS_URL?.trim() || 'redis://localhost:6379';
  const fromUrl = parseRedisUrl(url);
  const explicitHost = process.env.REDIS_HOST?.trim();
  const explicitPort = process.env.REDIS_PORT?.trim();
  const explicitPassword = process.env.REDIS_PASSWORD?.trim();

  // REDIS_URL is a supported connection input, not decoration: it used to be validated as
  // required and then ignored, so a URL-only deployment silently connected to localhost.
  // Explicit REDIS_HOST/REDIS_PORT/REDIS_PASSWORD always win (unchanged behaviour for every
  // existing deployment); the URL only fills in what was not provided explicitly.
  return {
    mode: resolveRedisMode(process.env),
    host: explicitHost || fromUrl.host || 'localhost',
    port: explicitPort ? Number.parseInt(explicitPort, 10) : (fromUrl.port ?? 6379),
    password: explicitPassword || fromUrl.password || undefined,
    url,
    db: parseInteger(process.env.REDIS_DB),
    username: process.env.REDIS_USERNAME?.trim() || undefined,
    // Sentinel topology: comma-separated "host:port" sentinels that elect the master.
    sentinelHosts: process.env.REDIS_SENTINEL_HOSTS?.trim(),
    sentinelMaster: process.env.REDIS_SENTINEL_MASTER?.trim(),
    sentinelPassword: process.env.REDIS_SENTINEL_PASSWORD?.trim() || undefined,
    sentinelRole: process.env.REDIS_SENTINEL_ROLE?.trim() || undefined,
    // Cluster topology: comma-separated startup nodes. The full topology is then
    // discovered from the cluster itself, so these do not have to be exhaustive.
    clusterNodes:
      process.env.REDIS_CLUSTER_NODES_RAW?.trim() || process.env.REDIS_CLUSTER_NODES?.trim(),
    clusterScaleReads: process.env.REDIS_CLUSTER_SCALE_READS?.trim() || undefined,
    connectTimeout: parseInteger(process.env.REDIS_CONNECT_TIMEOUT),
    tls:
      process.env.REDIS_TLS === 'true' || (fromUrl.secure && process.env.REDIS_TLS !== 'false')
        ? {}
        : undefined,
  };
});

/** Options common to every topology. */
export interface RedisBaseOptions {
  username?: string;
  db?: number;
  password?: string;
  tls?: object;
  connectTimeout?: number;
  maxRetriesPerRequest?: number | null;
}

/** Standalone options, which are the only ones that address a node directly. */
export interface RedisConnectionOptions extends RedisBaseOptions {
  host: string;
  port: number;
}

export type RedisModeOptions =
  | { mode: 'standalone'; options: RedisConnectionOptions }
  | {
      mode: 'sentinel';
      options: RedisBaseOptions & {
        sentinels: SentinelNode[];
        name: string;
        sentinelPassword?: string;
        role?: 'master' | 'slave';
      };
    }
  | {
      mode: 'cluster';
      options: RedisBaseOptions & {
        startupNodes: ClusterNode[];
        scaleReads?: 'master' | 'slave' | 'all';
      };
    };

function strip<T extends Record<string, unknown>>(value: T): T {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) {
      delete value[key];
    }
  }
  return value;
}

/**
 * Builds the ioredis options for the configured topology.
 *
 * Sentinel and cluster are not just extra keys on a host/port pair: ioredis needs
 * `sentinels`+`name` for sentinel and `startupNodes` for cluster, so the shape
 * differs per mode and a client built for the wrong one silently talks to the
 * wrong thing.
 */
export function buildRedisClientOptions(
  configService: ConfigService,
  opts?: { maxRetriesPerRequest?: number | null },
): RedisModeOptions {
  const mode = configService.get<RedisMode>('redis.mode', 'standalone');
  const password = configService.get<string>('redis.password') || undefined;
  const username = configService.get<string>('redis.username') || undefined;
  const db = configService.get<number>('redis.db');
  const tls = configService.get<object>('redis.tls') ? {} : undefined;
  const connectTimeout = configService.get<number>('redis.connectTimeout');
  const maxRetriesPerRequest = opts?.maxRetriesPerRequest;

  if (mode === 'cluster') {
    const startupNodes = parseNodeList(configService.get<string>('redis.clusterNodes'), 6379);
    return {
      mode: 'cluster',
      options: strip({
        startupNodes,
        scaleReads: configService.get<'master' | 'slave' | 'all'>('redis.clusterScaleReads'),
        username,
        password,
        db,
        tls,
        connectTimeout,
        maxRetriesPerRequest,
      }),
    };
  }

  const base = strip({
    username,
    password,
    db,
    tls,
    connectTimeout,
    maxRetriesPerRequest,
  });

  if (mode === 'sentinel') {
    const sentinels = parseNodeList(configService.get<string>('redis.sentinelHosts'), 26379);
    const name = configService.get<string>('redis.sentinelMaster') ?? '';
    return {
      mode: 'sentinel',
      options: strip({
        ...base,
        sentinels,
        name,
        sentinelPassword: configService.get<string>('redis.sentinelPassword') || undefined,
        role: configService.get<string>('redis.sentinelRole') as 'master' | 'slave' | undefined,
      }),
    };
  }

  return {
    mode: 'standalone',
    options: strip({
      ...base,
      host: configService.get<string>('redis.host', 'localhost'),
      port: configService.get<number>('redis.port', 6379),
    }),
  };
}

/**
 * Standalone-shaped options, kept for callers that must not use sentinel or
 * cluster (the Bull Board adapter) and for existing tests.
 */
export function buildRedisConnectionOptions(
  configService: ConfigService,
  opts?: { maxRetriesPerRequest?: number | null },
): RedisConnectionOptions {
  const built = buildRedisClientOptions(configService, opts);
  if (built.mode === 'cluster') {
    // Bull Board has no cluster-aware client; fall back to the first startup node
    // so the board still works rather than failing to construct.
    const first = built.options.startupNodes[0];
    return strip({
      host: first?.host ?? 'localhost',
      port: first?.port ?? 6379,
      username: built.options.username,
      password: built.options.password,
      db: built.options.db,
      tls: built.options.tls,
      connectTimeout: built.options.connectTimeout,
      maxRetriesPerRequest: built.options.maxRetriesPerRequest,
    });
  }
  if (built.mode === 'sentinel') {
    const first = built.options.sentinels[0];
    return strip({
      host: first?.host ?? 'localhost',
      port: first?.port ?? 26379,
      username: built.options.username,
      password: built.options.password,
      db: built.options.db,
      tls: built.options.tls,
      connectTimeout: built.options.connectTimeout,
      maxRetriesPerRequest: built.options.maxRetriesPerRequest,
    });
  }
  return built.options;
}
