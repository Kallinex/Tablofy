import axios from 'axios';
import { SsrfClientService } from './ssrf-client.service';
import { SsrfBlockedError } from './ssrf-guard';
import { DnsResolver } from './ssrf-guard';

jest.mock('axios');

const mockedRequest = axios.request as jest.MockedFunction<typeof axios.request>;

const publicResolver: DnsResolver = async (host) => {
  switch (host) {
    case 'example.com':
      return ['93.184.216.34'];
    case 'other.example.com':
      return ['1.1.1.1'];
    case 'resolve-private.example.com':
      return ['10.0.0.5'];
    default:
      throw new Error('NXDOMAIN');
  }
};

const service = new SsrfClientService().setResolver(publicResolver);

function response(status: number, headers: Record<string, string> = {}, data: unknown = {}) {
  return { status, headers, data } as never;
}

beforeEach(() => {
  mockedRequest.mockReset();
});

describe('SsrfClientService.postJson', () => {
  it('never calls the HTTP client for a blocked private URL', async () => {
    mockedRequest.mockResolvedValue(response(200));
    await expect(service.postJson('https://127.0.0.1/hook', {})).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('never calls the HTTP client for a hostname resolving to private IP', async () => {
    mockedRequest.mockResolvedValue(response(200));
    await expect(
      service.postJson('https://resolve-private.example.com/hook', {}),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('never calls the HTTP client for a blocked literal in redirect target', async () => {
    mockedRequest.mockResolvedValueOnce(response(302, { location: 'https://169.254.169.254/' }));
    await expect(service.postJson('https://example.com/hook', {})).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
    expect(mockedRequest).toHaveBeenCalledTimes(1);
  });

  it('posts to a legitimate public HTTPS URL', async () => {
    mockedRequest.mockResolvedValue(response(200, {}, { ok: true }));
    const result = await service.postJson('https://example.com/hook', { a: 1 });
    expect(result.status).toBe(200);
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    const config = mockedRequest.mock.calls[0][0];
    expect(config.method).toBe('post');
    expect(config.url).toBe('https://example.com/hook');
    expect(config.data).toEqual({ a: 1 });
    expect(config.httpsAgent).toBeDefined();
  });

  it('passes through headers, timeout, and validateStatus', async () => {
    mockedRequest.mockResolvedValue(response(200));
    const validateStatus = jest.fn(() => true);
    await service.postJson(
      'https://example.com/hook',
      {},
      {
        headers: { 'X-Custom': 'yes' },
        timeoutMs: 1234,
        validateStatus,
      },
    );
    const config = mockedRequest.mock.calls[0][0];
    expect(config.headers).toMatchObject({ 'X-Custom': 'yes' });
    expect(config.timeout).toBe(1234);
    expect(config.validateStatus).toBe(validateStatus);
  });

  it('follows a redirect to a public target and re-validates it', async () => {
    mockedRequest
      .mockResolvedValueOnce(response(302, { location: 'https://other.example.com/final' }))
      .mockResolvedValueOnce(response(200, {}, { done: true }));
    const result = await service.postJson('https://example.com/hook', {});
    expect(result.status).toBe(200);
    expect(mockedRequest).toHaveBeenCalledTimes(2);
    expect(mockedRequest.mock.calls[1][0].url).toBe('https://other.example.com/final');
  });

  it('blocks a redirect chain that exceeds the cap', async () => {
    for (let i = 0; i < 7; i++) {
      mockedRequest.mockResolvedValueOnce(
        response(302, { location: `https://example.com/redir/${i}` }),
      );
    }
    await expect(
      service.postJson('https://example.com/hook', {}, { maxRedirects: 3 }),
    ).rejects.toThrow(/Redirect limit exceeded/);
  });

  it('returns 3xx responses without a Location as-is', async () => {
    mockedRequest.mockResolvedValue(response(302, {}, {}));
    const result = await service.postJson('https://example.com/hook', {});
    expect(result.status).toBe(302);
    expect(mockedRequest).toHaveBeenCalledTimes(1);
  });

  it('pins the socket lookup to the validated public addresses only', async () => {
    mockedRequest.mockImplementation(async (config) => {
      const agent = (
        config as {
          httpsAgent?: {
            options?: {
              lookup?: (
                h: string,
                o: unknown,
                cb: (e: Error | null, a: unknown, f?: number) => void,
              ) => void;
            };
          };
        }
      ).httpsAgent;
      expect(agent).toBeDefined();
      let resolved: unknown;
      agent?.options?.lookup?.('example.com', { all: true }, (err, address) => {
        resolved = address;
      });
      expect(resolved).toEqual([{ address: '93.184.216.34', family: 4 }]);
      return response(200);
    });
    await service.postJson('https://example.com/hook', {});
    expect(mockedRequest).toHaveBeenCalledTimes(1);
  });
});

const dualStackResolver: DnsResolver = async (host) =>
  host === 'dual.example.com'
    ? ['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946']
    : ['93.184.216.34'];

const dualStackService = new SsrfClientService().setResolver(dualStackResolver);

type LookupFn = (
  host: string,
  opts: unknown,
  cb: (err: Error | null, address?: unknown, family?: number) => void,
) => void;

function captureAgent(): LookupFn {
  const config = mockedRequest.mock.calls[0][0] as unknown as {
    httpsAgent: { options?: { lookup?: LookupFn } };
  };
  const lookup = config.httpsAgent.options?.lookup;
  if (!lookup) throw new Error('agent has no lookup');
  return lookup;
}

describe('SsrfClientService.assertUrlSafe', () => {
  it('delegates to the guard and returns the resolved, pinned addresses', async () => {
    const safe = await service.assertUrlSafe('https://example.com/hook');

    expect(safe.hostname).toBe('example.com');
    expect(safe.port).toBe(443);
    expect(safe.addresses).toEqual(['93.184.216.34']);
  });

  it('propagates a blocked host', async () => {
    await expect(service.assertUrlSafe('https://127.0.0.1/hook')).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
  });

  it('falls back to the OS resolver when none is configured', async () => {
    const osResolverService = new SsrfClientService();
    jest
      .spyOn(osResolverService, 'assertUrlSafe')
      .mockResolvedValue(
        {} as unknown as Awaited<ReturnType<typeof osResolverService.assertUrlSafe>>,
      );

    await expect(osResolverService.assertUrlSafe('https://example.com')).resolves.toEqual({});
    expect(jest.spyOn(osResolverService, 'assertUrlSafe')).toHaveBeenCalledWith(
      'https://example.com',
    );
  });
});

describe('SsrfClientService address pinning', () => {
  beforeEach(() => {
    mockedRequest.mockResolvedValue(response(200));
  });

  it('serves only IPv4 candidates when the socket asks for family 4', async () => {
    await dualStackService.postJson('https://dual.example.com/hook', {});
    const lookup = captureAgent();

    let resolved: unknown;
    lookup('dual.example.com', { all: true, family: 4 }, (_e, address) => {
      resolved = address;
    });

    expect(resolved).toEqual([{ address: '93.184.216.34', family: 4 }]);
  });

  it('serves only IPv6 candidates when the socket asks for family 6', async () => {
    await dualStackService.postJson('https://dual.example.com/hook', {});
    const lookup = captureAgent();

    let resolved: unknown;
    lookup('dual.example.com', { all: true, family: 6 }, (_e, address) => {
      resolved = address;
    });

    expect(resolved).toEqual([{ address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 }]);
  });

  it('returns every pinned address when no family preference is given', async () => {
    await dualStackService.postJson('https://dual.example.com/hook', {});
    const lookup = captureAgent();

    let resolved: unknown;
    lookup('dual.example.com', { all: true }, (_e, address) => {
      resolved = address;
    });

    expect(resolved).toEqual([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ]);
  });

  it('returns a single address and family for a non-`all` lookup', async () => {
    await dualStackService.postJson('https://dual.example.com/hook', {});
    const lookup = captureAgent();

    let resolved: unknown;
    let family: number | undefined;
    lookup('dual.example.com', {}, (_e, address, f) => {
      resolved = address;
      family = f;
    });

    expect(resolved).toBe('93.184.216.34');
    expect(family).toBe(4);
  });

  it('falls back to the full pinned set when the requested family has no match', async () => {
    await dualStackService.postJson('https://dual.example.com/hook', {});
    const lookup = captureAgent();

    let resolved: unknown;
    lookup('dual.example.com', { all: true, family: 0 }, (_e, address) => {
      resolved = address;
    });

    expect(resolved).toHaveLength(2);
  });
});
