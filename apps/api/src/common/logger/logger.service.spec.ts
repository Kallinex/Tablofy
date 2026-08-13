import { AppLoggerService } from './logger.service';

jest.mock('winston', () => {
  class DummyTransport {}
  return {
    createLogger: jest.fn(() => ({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
      child: jest.fn(),
    })),
    format: {
      combine: jest.fn(() => 'combine'),
      timestamp: jest.fn(() => 'timestamp'),
      json: jest.fn(() => 'json'),
      errors: jest.fn(() => 'errors'),
      colorize: jest.fn(() => 'colorize'),
      printf: jest.fn(() => 'printf'),
    },
    transports: {
      Console: DummyTransport,
      DailyRotateFile: DummyTransport,
    },
  };
});
jest.mock('winston-daily-rotate-file', () => ({}));

type MockLogger = Record<'info' | 'error' | 'warn' | 'debug' | 'verbose', jest.Mock>;

describe('AppLoggerService secret redaction', () => {
  let service: AppLoggerService;
  let logger: MockLogger;

  const configService = {
    get: jest.fn((_key: string, def: unknown) => def),
  };

  const correlationService = {
    requestId: undefined,
    correlationId: undefined,
    tenantId: undefined,
    userId: undefined,
  };

  const NEW_SENSITIVE_KEYS = [
    'clientSecret',
    'client_secret',
    'paymentKey',
    'payment_key',
    'hmac',
    'signature',
  ] as const;

  const EXISTING_SENSITIVE_KEYS = [
    'password',
    'token',
    'authorization',
    'secret',
    'apiKey',
    'api_key',
    'api-key',
    'twoFactorSecret',
    'two_factor_secret',
    'accessToken',
    'refreshToken',
    'jwt',
    'bearer',
  ] as const;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AppLoggerService(configService as never, correlationService as never);
    logger = (service as unknown as { logger: MockLogger }).logger;
  });

  describe('newly added sensitive keys', () => {
    it.each(NEW_SENSITIVE_KEYS)('redacts %s in direct metadata', (key) => {
      service.log('message', { [key]: 'super-secret-value' });

      const meta = logger.info.mock.calls[0][1];
      expect(meta[key]).toBe('[REDACTED]');
    });

    it.each(NEW_SENSITIVE_KEYS)('redacts %s in nested objects', (key) => {
      service.warn('message', { outer: { inner: { [key]: 'super-secret-value' } } });

      const meta = logger.warn.mock.calls[0][1];
      expect(meta.outer.inner[key]).toBe('[REDACTED]');
    });

    it.each(NEW_SENSITIVE_KEYS)('redacts %s in nested arrays', (key) => {
      service.log('message', {
        items: [{ name: 'keep-me' }, { [key]: 'super-secret-value' }],
      });

      const meta = logger.info.mock.calls[0][1];
      expect(meta.items[0]).toEqual({ name: 'keep-me' });
      expect(meta.items[1][key]).toBe('[REDACTED]');
    });

    it.each(NEW_SENSITIVE_KEYS)('redacts %s in error metadata', (key) => {
      service.error('operation failed', new Error('boom'), { [key]: 'super-secret-value' });

      const meta = logger.error.mock.calls[0][1];
      expect(meta[key]).toBe('[REDACTED]');
    });
  });

  describe('structured logger calls', () => {
    it('redacts across every log level', () => {
      service.log('a', { clientSecret: 's1' });
      service.warn('b', { paymentKey: 's2' });
      service.error('c', new Error('x'), { hmac: 's3' });
      service.debug('d', { signature: 's4' });
      service.verbose('e', { client_secret: 's5' });
      service.fatal('f', { payment_key: 's6' });

      expect(logger.info.mock.calls[0][1].clientSecret).toBe('[REDACTED]');
      expect(logger.warn.mock.calls[0][1].paymentKey).toBe('[REDACTED]');
      expect(logger.error.mock.calls[0][1].hmac).toBe('[REDACTED]');
      expect(logger.debug.mock.calls[0][1].signature).toBe('[REDACTED]');
      expect(logger.verbose.mock.calls[0][1].client_secret).toBe('[REDACTED]');
      expect(logger.error.mock.calls[1][1].payment_key).toBe('[REDACTED]');
    });
  });

  describe('existing sensitive keys remain redacted', () => {
    it.each(EXISTING_SENSITIVE_KEYS)('keeps %s redacted', (key) => {
      service.log('message', { [key]: 'super-secret-value' });

      const meta = logger.info.mock.calls[0][1];
      expect(meta[key]).toBe('[REDACTED]');
    });
  });

  describe('non-sensitive values', () => {
    it('does not redact unrelated metadata', () => {
      service.log('message', { orderId: 'o-1', amount: 100, nested: { status: 'paid' } });

      const meta = logger.info.mock.calls[0][1];
      expect(meta.orderId).toBe('o-1');
      expect(meta.amount).toBe(100);
      expect(meta.nested).toEqual({ status: 'paid' });
    });
  });
});
