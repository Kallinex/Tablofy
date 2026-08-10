import * as dns from 'node:dns';
import { isIP } from 'node:net';
import { isPublicAddress } from './ip-blocklist';

/**
 * Resolves a hostname to its full address list. The default resolver asks the
 * OS resolver for both A and AAAA records (verbatim, no reordering) so every
 * candidate address is validated before any connection is attempted.
 */
export type DnsResolver = (hostname: string) => Promise<readonly string[]>;

export const DEFAULT_ALLOWED_PROTOCOLS: readonly string[] = ['https:'];

export interface SsrfUrlOptions {
  allowedProtocols?: readonly string[];
}

export interface SafeUrl {
  url: URL;
  hostname: string;
  port: number;
  addresses: readonly string[];
}

/** Thrown when a URL/address/hostname fails SSRF validation. */
export class SsrfBlockedError extends Error {
  readonly code = 'SSRF_BLOCKED';

  constructor(message: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

const MAX_URL_LENGTH = 2000;

const FORBIDDEN_HOSTNAME_SUFFIXES: readonly string[] = [
  '.localhost',
  '.local',
  '.internal',
  '.lan',
  '.corp',
  '.home',
  '.home.arpa',
  '.localdomain',
  '.intranet',
];

const FORBIDDEN_HOSTNAMES: ReadonlySet<string> = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'metadata.azure.internal',
  'metadata.aws.internal',
  'kubernetes.default.svc',
  'host.docker.internal',
  'gateway.docker.internal',
  'docker',
  'redis',
  'postgres',
  'db',
  'cache',
]);

const FORBIDDEN_TLDS: ReadonlySet<string> = new Set([
  'localhost',
  'local',
  'test',
  'invalid',
  'example',
  'onion',
]);

function isForbiddenHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (FORBIDDEN_HOSTNAMES.has(host)) return true;
  if (FORBIDDEN_HOSTNAME_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  const dotIndex = host.lastIndexOf('.');
  const tld = dotIndex === -1 ? host : host.slice(dotIndex + 1);
  return FORBIDDEN_TLDS.has(tld);
}

/**
 * Normalizes a dotted/hybrid numeric hostname (e.g. "127.1", "0x7f.1",
 * "2130706433", "0177.0.0.1") to a dotted-quad using inet_aton semantics.
 * Returns null when the value is not a numeric-IP representation.
 *
 * The WHATWG URL parser already normalizes most of these before we see them
 * (https://127.1 -> hostname 127.0.0.1); this is defense-in-depth for any
 * path where the hostname is not normalized.
 */
export function normalizeNumericIpv4(hostname: string): string | null {
  const host = hostname.toLowerCase();
  if (!host) return null;

  if (!host.includes('.')) {
    if (!/^(0x[0-9a-f]+|\d+)$/.test(host)) return null;
    let value: number;
    if (host.startsWith('0x')) value = parseInt(host, 16);
    else if (host.length > 1 && host.startsWith('0')) value = parseInt(host, 8);
    else value = parseInt(host, 10);
    if (Number.isNaN(value) || value < 0 || value > 0xffffffff) return null;
    return `${value >>> 24}.${(value >>> 16) & 0xff}.${(value >>> 8) & 0xff}.${value & 0xff}`;
  }

  if (host.startsWith('.') || host.endsWith('.') || host.includes('..')) return null;
  const parts = host.split('.');
  if (parts.length < 2 || parts.length > 4) return null;

  const octets: number[] = [];
  for (const part of parts) {
    if (part === '') return null;
    let value: number;
    if (/^0x[0-9a-f]+$/.test(part)) value = parseInt(part, 16);
    else if (/^0[0-7]+$/.test(part) && part.length > 1) value = parseInt(part, 8);
    else if (/^\d{1,10}$/.test(part)) value = parseInt(part, 10);
    else return null;
    if (Number.isNaN(value) || value < 0 || value > 0xffffffff) return null;
    octets.push(value);
  }

  // inet_aton: the trailing group absorbs the remaining bytes
  // (127.1 -> 127.0.0.1, 127.1.2 -> 127.1.0.2).
  const expanded: number[] = [];
  for (let i = 0; i < octets.length; i++) {
    if (i < octets.length - 1) {
      if (octets[i] > 255) return null;
      expanded.push(octets[i]);
    } else {
      const remaining = 4 - (octets.length - 1);
      const last = octets[i];
      if (last > 2 ** (8 * remaining) - 1) return null;
      for (let byte = remaining - 1; byte >= 0; byte--) {
        expanded.push((last >>> (8 * byte)) & 0xff);
      }
    }
  }
  return expanded.join('.');
}

function detectIpLiteral(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(host) === 4 || isIP(host) === 6) return host;
  return normalizeNumericIpv4(host);
}

const defaultResolver: DnsResolver = async (hostname) => {
  const result = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  return result.map((entry) => entry.address);
};

/**
 * Validates a URL destined for an outbound request:
 * - parses and normalizes the URL,
 * - rejects disallowed protocols, embedded credentials, and forbidden hosts,
 * - resolves the hostname and requires EVERY resolved address to be public,
 * - returns the pinned public addresses so the HTTP client can avoid
 *   DNS-rebinding (the client must only connect to these addresses).
 *
 * Throws SsrfBlockedError on any failure.
 */
export async function assertSafeOutboundUrl(
  rawUrl: string,
  options: SsrfUrlOptions = {},
  resolver: DnsResolver = defaultResolver,
): Promise<SafeUrl> {
  const allowedProtocols = options.allowedProtocols ?? DEFAULT_ALLOWED_PROTOCOLS;

  if (typeof rawUrl !== 'string' || rawUrl.length === 0 || rawUrl.length > MAX_URL_LENGTH) {
    throw new SsrfBlockedError('URL is empty or exceeds the maximum allowed length');
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError('URL is malformed');
  }

  if (!allowedProtocols.includes(url.protocol)) {
    throw new SsrfBlockedError(`Protocol "${url.protocol}" is not allowed for outbound requests`);
  }

  if (url.username || url.password) {
    throw new SsrfBlockedError('URL must not contain embedded credentials');
  }

  const hostname = (url.hostname || '').toLowerCase().replace(/\.$/, '');
  if (!hostname) {
    throw new SsrfBlockedError('URL must include a hostname');
  }

  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;

  const ipLiteral = detectIpLiteral(hostname);
  if (ipLiteral) {
    if (!isPublicAddress(ipLiteral)) {
      throw new SsrfBlockedError(`Address "${ipLiteral}" is not allowed for outbound requests`);
    }
    return { url, hostname, port, addresses: [ipLiteral] };
  }

  if (isForbiddenHostname(hostname)) {
    throw new SsrfBlockedError(`Hostname "${hostname}" is not allowed for outbound requests`);
  }

  let addresses: readonly string[];
  try {
    addresses = await resolver(hostname);
  } catch {
    throw new SsrfBlockedError(`Could not resolve hostname "${hostname}"`);
  }

  if (addresses.length === 0) {
    throw new SsrfBlockedError(`Hostname "${hostname}" resolved to no addresses`);
  }

  for (const address of addresses) {
    if (!isPublicAddress(address)) {
      throw new SsrfBlockedError(
        `Hostname "${hostname}" resolves to a blocked address (${address})`,
      );
    }
  }

  return { url, hostname, port, addresses };
}
