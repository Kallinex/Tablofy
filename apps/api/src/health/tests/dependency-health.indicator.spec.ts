import { ConfigService } from '@nestjs/config';
import { HealthCheckError } from '@nestjs/terminus';
import * as nodemailer from 'nodemailer';
import { SmtpHealthIndicator } from '../smtp-health.indicator';
import { SmsHealthIndicator } from '../sms-health.indicator';
import { PaymentHealthIndicator } from '../payment-health.indicator';
import { probeDependency } from '../dependency-probe';

jest.mock('nodemailer');

const originalFetch = global.fetch;

afterAll(() => {
  global.fetch = originalFetch;
});

const configOf = (values: Record<string, unknown>): ConfigService =>
  ({ get: jest.fn((key: string) => values[key]) }) as unknown as ConfigService;

const mockFetch = (impl: (url: string, init?: RequestInit) => Promise<unknown>): jest.Mock => {
  const fn = jest.fn(impl);
  (global as unknown as { fetch: jest.Mock }).fetch = fn;
  return fn;
};

const response = (status: number) => ({ status }) as Response;

describe('probeDependency', () => {
  it('treats any sub-500 response as reachable', async () => {
    mockFetch(async () => response(404));

    await expect(probeDependency('https://example.test/health')).resolves.toMatchObject({
      reachable: true,
      status: 404,
    });
  });

  it('treats a 5xx response as unreachable', async () => {
    mockFetch(async () => response(503));

    await expect(probeDependency('https://example.test/health')).resolves.toMatchObject({
      reachable: false,
      status: 503,
    });
  });

  it('treats a transport error as unreachable', async () => {
    mockFetch(async () => {
      throw new Error('ECONNREFUSED');
    });

    await expect(probeDependency('https://example.test/health')).resolves.toMatchObject({
      reachable: false,
      status: 0,
      error: 'ECONNREFUSED',
    });
  });
});

describe('SmtpHealthIndicator', () => {
  const createTransport = nodemailer.createTransport as jest.Mock;

  it('reports up with configured=false when SMTP is not configured', async () => {
    const indicator = new SmtpHealthIndicator(configOf({ 'smtp.host': '' }));

    await expect(indicator.isHealthy('email')).resolves.toEqual({
      email: { status: 'up', configured: false, message: 'SMTP is not configured' },
    });
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('reports up when the transport verifies', async () => {
    const verify = jest.fn().mockResolvedValue(true);
    createTransport.mockReturnValue({ verify });
    const indicator = new SmtpHealthIndicator(
      configOf({ 'smtp.host': 'smtp.test', 'smtp.port': 587 }),
    );

    const result = await indicator.isHealthy('email');

    expect(result.email).toMatchObject({ status: 'up', configured: true, host: 'smtp.test' });
    expect(verify).toHaveBeenCalled();
  });

  it('throws a HealthCheckError when the transport cannot be verified', async () => {
    createTransport.mockReturnValue({
      verify: jest.fn().mockRejectedValue(new Error('auth failed')),
    });
    const indicator = new SmtpHealthIndicator(configOf({ 'smtp.host': 'smtp.test' }));

    await expect(indicator.isHealthy('email')).rejects.toBeInstanceOf(HealthCheckError);
    await expect(indicator.isHealthy('email')).rejects.toMatchObject({
      causes: { email: { status: 'down', configured: true, message: 'auth failed' } },
    });
  });
});

describe('SmsHealthIndicator', () => {
  it('reports up with configured=false when no provider is configured', async () => {
    const indicator = new SmsHealthIndicator(configOf({ 'sms.providerUrl': '' }));

    await expect(indicator.isHealthy('sms')).resolves.toEqual({
      sms: { status: 'up', configured: false, message: 'SMS provider is not configured' },
    });
  });

  it('reports up when the provider responds and sends the bearer token', async () => {
    const fetchMock = mockFetch(async () => response(200));
    const indicator = new SmsHealthIndicator(
      configOf({ 'sms.providerUrl': 'https://sms.test/health', 'sms.apiKey': 'token-1' }),
    );

    await expect(indicator.isHealthy('sms')).resolves.toMatchObject({
      sms: { status: 'up', configured: true, providerUrl: 'https://sms.test/health' },
    });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      headers: { Authorization: 'Bearer token-1' },
    });
  });

  it('throws when the provider is unreachable', async () => {
    mockFetch(async () => response(503));
    const indicator = new SmsHealthIndicator(
      configOf({ 'sms.providerUrl': 'https://sms.test/health' }),
    );

    await expect(indicator.isHealthy('sms')).rejects.toBeInstanceOf(HealthCheckError);
    await expect(indicator.isHealthy('sms')).rejects.toMatchObject({
      causes: { sms: { status: 'down', configured: true } },
    });
  });
});

describe('PaymentHealthIndicator', () => {
  it('reports up with configured=false in mock mode', async () => {
    const indicator = new PaymentHealthIndicator(configOf({ 'payments.mode': 'mock' }));

    await expect(indicator.isHealthy('payment')).resolves.toEqual({
      payment: { status: 'up', configured: false, mode: 'mock' },
    });
  });

  it('probes Stripe and Paymob when credentials are present', async () => {
    const fetchMock = mockFetch(async () => response(200));
    const indicator = new PaymentHealthIndicator(
      configOf({
        'payments.mode': 'live',
        'payments.stripeSecretKey': 'sk_live_x',
        'payments.stripeApiBase': 'https://api.stripe.com/',
        'payments.paymobApiKey': 'paymob-key',
        'payments.paymobApiBase': 'https://accept.paymob.com/api',
      }),
    );

    const result = await indicator.isHealthy('payment');

    expect(result.payment).toMatchObject({ status: 'up', configured: true, mode: 'live' });
    const urls = fetchMock.mock.calls.map((call) => call[0]);
    expect(urls).toEqual([
      'https://api.stripe.com/v1/balance',
      'https://accept.paymob.com/api/auth/tokens',
    ]);
  });

  it('skips the probes when no gateway is configured', async () => {
    const fetchMock = mockFetch(async () => response(200));
    const indicator = new PaymentHealthIndicator(configOf({ 'payments.mode': 'test' }));

    await expect(indicator.isHealthy('payment')).resolves.toMatchObject({
      payment: { status: 'up', configured: false },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws when a configured gateway is unreachable', async () => {
    mockFetch(async () => {
      throw new Error('ETIMEDOUT');
    });
    const indicator = new PaymentHealthIndicator(
      configOf({
        'payments.mode': 'live',
        'payments.stripeSecretKey': 'sk_live_x',
        'payments.stripeApiBase': 'https://api.stripe.com',
      }),
    );

    await expect(indicator.isHealthy('payment')).rejects.toBeInstanceOf(HealthCheckError);
    await expect(indicator.isHealthy('payment')).rejects.toMatchObject({
      causes: { payment: { status: 'down', configured: true } },
    });
  });
});
