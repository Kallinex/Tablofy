import {
  assertSafeOutboundUrl,
  DnsResolver,
  normalizeNumericIpv4,
  SsrfBlockedError,
} from './ssrf-guard';
import { isBlockedIpv4, isBlockedIpv6, isPublicAddress } from './ip-blocklist';

const publicResolver: DnsResolver = async (host) => {
  switch (host) {
    case 'example.com':
      return ['93.184.216.34', '2606:2800:220:1::248'];
    case 'ipv6-only.test':
      return ['2606:4700:4700::1111'];
    case 'resolve-private.example.com':
      return ['10.0.0.5'];
    case 'resolve-mixed.example.com':
      return ['93.184.216.34', '192.168.1.1'];
    case 'resolve-link-local.example.com':
      return ['169.254.169.254'];
    case 'resolve-loopback.example.com':
      return ['127.0.0.1'];
    case 'localhost':
      return ['127.0.0.1', '::1'];
    default:
      throw new Error('NXDOMAIN');
  }
};

describe('isPublicAddress', () => {
  it.each([
    ['127.0.0.1'],
    ['127.8.8.8'],
    ['10.0.0.1'],
    ['10.255.255.255'],
    ['172.16.0.1'],
    ['172.31.255.255'],
    ['192.168.0.1'],
    ['192.168.255.255'],
    ['0.0.0.0'],
    ['169.254.169.254'],
    ['100.64.0.1'],
    ['100.127.255.255'],
    ['192.0.0.1'],
    ['192.0.2.1'],
    ['198.18.0.1'],
    ['198.51.100.1'],
    ['203.0.113.1'],
    ['224.0.0.1'],
    ['240.0.0.1'],
    ['255.255.255.255'],
    ['::1'],
    ['::'],
    ['::ffff:127.0.0.1'],
    ['::ffff:192.168.1.1'],
    ['::127.0.0.1'],
    ['64:ff9b::1'],
    ['100::1'],
    ['2001:db8::1'],
    ['2002:7f00:1::1'],
    ['3fff::1'],
    ['fd00::1'],
    ['fcff::1'],
    ['fe80::1'],
    ['fec0::1'],
    ['ff02::1'],
  ])('blocks %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each([
    ['8.8.8.8'],
    ['1.1.1.1'],
    ['93.184.216.34'],
    ['172.32.0.1'],
    ['192.169.0.1'],
    ['169.253.0.1'],
    ['2606:4700:4700::1111'],
    ['2001:4860:4860::8888'],
  ])('allows public %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });

  it('returns false for non-IP strings', () => {
    expect(isPublicAddress('example.com')).toBe(false);
    expect(isPublicAddress('127.0.0')).toBe(false);
    expect(isPublicAddress('')).toBe(false);
  });

  it('isBlockedIpv4 handles dotted quads', () => {
    expect(isBlockedIpv4('192.168.1.1')).toBe(true);
    expect(isBlockedIpv4('1.1.1.1')).toBe(false);
  });

  it('isBlockedIpv6 handles mapped and compressed forms', () => {
    expect(isBlockedIpv6('::ffff:10.0.0.1')).toBe(true);
    expect(isBlockedIpv6('::ffff:1.2.3.4')).toBe(true);
    expect(isBlockedIpv6('2606:4700:4700::1111')).toBe(false);
  });
});

describe('normalizeNumericIpv4', () => {
  it.each([
    ['2130706433', '127.0.0.1'],
    ['0x7f000001', '127.0.0.1'],
    ['0x7f.0.0.1', '127.0.0.1'],
    ['0177.0.0.1', '127.0.0.1'],
    ['127.1', '127.0.0.1'],
    ['127.0.1', '127.0.0.1'],
    ['3232235777', '192.168.1.1'],
    ['0xC0000201', '192.0.2.1'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeNumericIpv4(input)).toBe(expected);
  });

  it.each([['example.com'], ['127.0.0.1.extra'], ['1.2.3.4.5'], ['::1'], ['']])(
    'returns null for %s',
    (input) => {
      expect(normalizeNumericIpv4(input)).toBeNull();
    },
  );
});

describe('assertSafeOutboundUrl - blocked targets', () => {
  it.each([
    'https://127.0.0.1/',
    'https://127.8.8.8/',
    'https://10.0.0.5/',
    'https://192.168.1.1/',
    'https://172.16.0.1/',
    'https://0.0.0.0/',
    'https://169.254.169.254/',
    'https://100.64.0.1/',
    'https://2130706433/',
    'https://0x7f000001/',
    'https://0177.0.0.1/',
    'https://127.1/',
    'https://0x7f.0.0.1/',
    'https://[::1]/',
    'https://[::]/',
    'https://[::ffff:127.0.0.1]/',
    'https://[::ffff:192.168.1.1]/',
    'https://[2001:db8::1]/',
    'https://[fd00::1]/',
    'https://[fe80::1]/',
    'https://[ff02::1]/',
    'https://localhost/',
  ])('blocks %s', async (url) => {
    await expect(assertSafeOutboundUrl(url, {}, publicResolver)).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
  });

  it('blocks hostnames that resolve to private/link-local/mixed addresses', async () => {
    await expect(
      assertSafeOutboundUrl('https://resolve-private.example.com/', {}, publicResolver),
    ).rejects.toThrow(/blocked address/);
    await expect(
      assertSafeOutboundUrl('https://resolve-link-local.example.com/', {}, publicResolver),
    ).rejects.toThrow(/blocked address/);
    await expect(
      assertSafeOutboundUrl('https://resolve-mixed.example.com/', {}, publicResolver),
    ).rejects.toThrow(/blocked address \(192.168.1.1\)/);
    await expect(
      assertSafeOutboundUrl('https://resolve-loopback.example.com/', {}, publicResolver),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(
      assertSafeOutboundUrl('https://localhost/', {}, publicResolver),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('blocks unresolvable hostnames', async () => {
    await expect(
      assertSafeOutboundUrl('https://unresolvable.example.com/', {}, publicResolver),
    ).rejects.toThrow(/Could not resolve/);
  });

  it('blocks disallowed protocols', async () => {
    await expect(assertSafeOutboundUrl('http://example.com/', {}, publicResolver)).rejects.toThrow(
      /Protocol "http:"/,
    );
    await expect(assertSafeOutboundUrl('ftp://example.com/', {}, publicResolver)).rejects.toThrow(
      /Protocol "ftp:"/,
    );
    await expect(assertSafeOutboundUrl('file:///etc/passwd', {}, publicResolver)).rejects.toThrow(
      /Protocol "file:"/,
    );
    await expect(
      assertSafeOutboundUrl('javascript:alert(1)', {}, publicResolver),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(
      assertSafeOutboundUrl('data:text/plain,hi', {}, publicResolver),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('blocks URLs with embedded credentials', async () => {
    await expect(
      assertSafeOutboundUrl('https://user:pass@example.com/', {}, publicResolver),
    ).rejects.toThrow(/credentials/);
  });

  it('blocks malformed and oversized URLs', async () => {
    await expect(assertSafeOutboundUrl('', {}, publicResolver)).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
    await expect(assertSafeOutboundUrl('not-a-url', {}, publicResolver)).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
    await expect(
      assertSafeOutboundUrl(`https://example.com/${'a'.repeat(2100)}`, {}, publicResolver),
    ).rejects.toThrow(/maximum allowed length/);
  });

  it('blocks reserved/special hostnames', async () => {
    await expect(
      assertSafeOutboundUrl('https://metadata.google.internal/', {}, publicResolver),
    ).rejects.toThrow(/not allowed/);
    await expect(
      assertSafeOutboundUrl('https://host.docker.internal/', {}, publicResolver),
    ).rejects.toThrow(/not allowed/);
    await expect(
      assertSafeOutboundUrl('https://foo.internal/', {}, publicResolver),
    ).rejects.toThrow(/not allowed/);
    await expect(assertSafeOutboundUrl('https://foo.local/', {}, publicResolver)).rejects.toThrow(
      /not allowed/,
    );
  });
});

describe('assertSafeOutboundUrl - allowed targets', () => {
  it('allows a public hostname and returns pinned addresses', async () => {
    const safe = await assertSafeOutboundUrl('https://example.com/hook', {}, publicResolver);
    expect(safe.hostname).toBe('example.com');
    expect(safe.port).toBe(443);
    expect(safe.addresses).toEqual(['93.184.216.34', '2606:2800:220:1::248']);
  });

  it('allows a public IPv4 literal', async () => {
    const safe = await assertSafeOutboundUrl('https://1.1.1.1/', {}, publicResolver);
    expect(safe.addresses).toEqual(['1.1.1.1']);
  });

  it('allows a public IPv6 literal', async () => {
    const safe = await assertSafeOutboundUrl('https://[2606:4700:4700::1111]/', {}, publicResolver);
    expect(safe.addresses).toEqual(['2606:4700:4700::1111']);
  });

  it('allows an explicit port and returns it', async () => {
    const safe = await assertSafeOutboundUrl('https://example.com:8443/hook', {}, publicResolver);
    expect(safe.port).toBe(8443);
  });

  it('allows http when permitted explicitly', async () => {
    const safe = await assertSafeOutboundUrl(
      'http://example.com/',
      { allowedProtocols: ['http:', 'https:'] },
      publicResolver,
    );
    expect(safe.url.protocol).toBe('http:');
    expect(safe.port).toBe(80);
  });

  it('normalizes a trailing-dot hostname', async () => {
    const safe = await assertSafeOutboundUrl('https://example.com./hook', {}, publicResolver);
    expect(safe.hostname).toBe('example.com');
  });
});
