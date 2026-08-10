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
