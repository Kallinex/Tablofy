import { isIP } from 'node:net';

/**
 * CIDR blocklists of addresses that must never be reachable by tenant/user
 * controlled outbound HTTP requests. Mirrors the ranges documented in
 * FORENSIC-AUDIT-2026-08-06.md P1-3 (SSRF).
 *
 * IPv4:
 * - 0.0.0.0/8        "this network"
 * - 10.0.0.0/8       private
 * - 100.64.0.0/10    CGNAT / carrier-grade NAT
 * - 127.0.0.0/8      loopback
 * - 169.254.0.0/16   link-local (AWS/GCP/Azure metadata lives here)
 * - 172.16.0.0/12    private
 * - 192.0.0.0/24     IETF protocol assignments
 * - 192.0.2.0/24     TEST-NET-1
 * - 192.168.0.0/16   private
 * - 198.18.0.0/15    benchmarking
 * - 198.51.100.0/24  TEST-NET-2
 * - 203.0.113.0/24   TEST-NET-3
 * - 224.0.0.0/4      multicast (incl. 255.255.255.255 broadcast)
 * - 240.0.0.0/4      reserved
 *
 * IPv6:
 * - ::/128           unspecified
 * - ::1/128          loopback
 * - ::/96            IPv4-compatible (deprecated)
 * - ::ffff:0:0/96    IPv4-mapped (covers ::ffff:127.0.0.1, ::ffff:192.168.x.x)
 * - 64:ff9b::/96     NAT64
 * - 100::/64         discard-only
 * - 2001:db8::/32    documentation
 * - 2002::/16        6to4 (embedded IPv4, deprecated)
 * - 3fff::/20        documentation (RFC 9637)
 * - fc00::/7         unique local
 * - fe80::/10        link-local
 * - fec0::/10        site-local (deprecated)
 * - ff00::/8         multicast
 */
const BLOCKED_IPV4_CIDRS: readonly string[] = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
];

const BLOCKED_IPV6_CIDRS: readonly string[] = [
  '::/128',
  '::1/128',
  '::/96',
  '::ffff:0:0/96',
  '64:ff9b::/96',
  '100::/64',
  '2001:db8::/32',
  '2002::/16',
  '3fff::/20',
  'fc00::/7',
  'fe80::/10',
  'fec0::/10',
  'ff00::/8',
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0 || value > 255) return null;
    out = (out << 8) | value;
  }
  return out >>> 0;
}

function parseIpv4Cidr(cidr: string): [number, number] {
  const [ip, prefixStr] = cidr.split('/');
  const prefix = Number(prefixStr);
  const base = ipv4ToInt(ip)!;
  const hostBits = 32 - prefix;
  const size = hostBits === 0 ? 1 : 2 ** hostBits;
  const mask = hostBits === 0 ? 0xffffffff : ~((1 << hostBits) - 1) >>> 0;
  const start = (base & mask) >>> 0;
  const end = (start + size - 1) >>> 0;
  return [start, end];
}

/**
 * Parses an IPv6 address (optionally bracketed, optionally with a zone id and
 * an IPv4 tail such as ::ffff:192.168.0.1) into 8 x 16-bit groups.
 * Returns null for anything malformed.
 */
function ipv6ToGroups(address: string): number[] | null {
  let addr = address.trim();
  if (addr.startsWith('[') && addr.endsWith(']')) addr = addr.slice(1, -1);
  const zoneIndex = addr.indexOf('%');
  if (zoneIndex !== -1) addr = addr.slice(0, zoneIndex);

  const parsePart = (part: string): number[] => {
    if (part.includes('.')) {
      const octets = part.split('.').map(Number);
      if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
        return [0, 0];
      }
      return [octets[0] * 256 + octets[1], octets[2] * 256 + octets[3]];
    }
    const value = parseInt(part, 16);
    if (Number.isNaN(value) || value < 0 || value > 0xffff) return [0];
    return [value];
  };

  const segments = addr.split('::');
  if (segments.length > 2) return null;

  const left = segments[0] === '' ? [] : segments[0].split(':');
  const right = segments.length === 2 ? (segments[1] === '' ? [] : segments[1].split(':')) : [];

  const leftGroups: number[] = [];
  for (const part of left) leftGroups.push(...parsePart(part));
  const rightGroups: number[] = [];
  for (const part of right) rightGroups.push(...parsePart(part));

  if (leftGroups.length + rightGroups.length > 8) return null;
  const missing = 8 - leftGroups.length - rightGroups.length;
  return [...leftGroups, ...new Array<number>(missing).fill(0), ...rightGroups];
}

function groupsToBigInt(groups: number[]): bigint {
  let out = 0n;
  for (let i = 0; i < groups.length; i++) {
    out = (out << 16n) | BigInt(groups[i]);
  }
  return out;
}

function parseIpv6Cidr(cidr: string): [bigint, number] {
  const [ip, prefixStr] = cidr.split('/');
  const groups = ipv6ToGroups(ip)!;
  return [groupsToBigInt(groups), Number(prefixStr)];
}

function isInIpv6Range(value: bigint, base: bigint, prefix: number): boolean {
  if (prefix === 0) return true;
  const shift = BigInt(128 - prefix);
  return value >> shift === base >> shift;
}

const IPV4_RANGES = BLOCKED_IPV4_CIDRS.map(parseIpv4Cidr);
const IPV6_RANGES = BLOCKED_IPV6_CIDRS.map(parseIpv6Cidr);

/** Returns true when the IPv4 dotted-quad falls in a blocked range. */
export function isBlockedIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === null) return false;
  return IPV4_RANGES.some(([start, end]) => value >= start && value <= end);
}

/** Returns true when the IPv6 address falls in a blocked range. */
export function isBlockedIpv6(ip: string): boolean {
  const groups = ipv6ToGroups(ip);
  if (!groups || groups.length !== 8) return false;
  const value = groupsToBigInt(groups);
  return IPV6_RANGES.some(([base, prefix]) => isInIpv6Range(value, base, prefix));
}

/**
 * A valid address (IPv4 or IPv6) is considered public only when it is not in
 * any blocked range. Anything that is not a well-formed IP literal returns
 * false (deny-by-default).
 */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return !isBlockedIpv4(ip);
  if (family === 6) return !isBlockedIpv6(ip);
  return false;
}
