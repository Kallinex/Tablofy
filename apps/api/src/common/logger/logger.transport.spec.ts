import { AppLoggerService } from './logger.service';

const printfCallbacks: Array<(info: Record<string, unknown>) => string> = [];
const combineCalls: unknown[][] = [];
const childLogger = { info: jest.fn(), child: jest.fn() };
const baseLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
  child: jest.fn(() => childLogger),
};

jest.mock('winston', () => {
  class DummyTransport {}
  return {
    createLogger: jest.fn(() => baseLogger),
    format: {
      combine: jest.fn((...formats: unknown[]) => {
        combineCalls.push(formats);
        return 'combine';
      }),
      timestamp: jest.fn(() => 'timestamp'),
      json: jest.fn(() => 'json'),
      errors: jest.fn(() => 'errors'),
      colorize: jest.fn(() => 'colorize'),
      printf: jest.fn((template: (info: Record<string, unknown>) => string) => {
        printfCallbacks.push(template);
        return 'printf';
      }),
    },
    transports: {
      Console: DummyTransport,
      DailyRotateFile: DummyTransport,
    },
  };
});
jest.mock('winston-daily-rotate-file', () => ({}));

describe('AppLoggerService transport configuration', () => {
  const correlationService = {
    requestId: undefined as string | undefined,
    correlationId: undefined as string | undefined,
    tenantId: undefined as string | undefined,
    userId: undefined as string | undefined,
  };

  function build(config: Record<string, unknown> = {}) {
    const configService = {
      get: jest.fn((key: string, defaultValue?: unknown) =>
        key in config ? config[key] : defaultValue,
      ),
    };
    return new AppLoggerService(configService as never, correlationService as never);
  }

  beforeEach(() => {
    printfCallbacks.length = 0;
    combineCalls.length = 0;
    jest.clearAllMocks();
    correlationService.requestId = undefined;
    correlationService.correlationId = undefined;
    correlationService.tenantId = undefined;
    correlationService.userId = undefined;
  });

  describe('pretty console format', () => {
    it('renders the timestamp, level, context, message and metadata', () => {
      build({ 'logging.json': false });
      const render = printfCallbacks[0];

      expect(typeof render).toBe('function');
      const line = render({
        timestamp: '2026-01-01 10:00:00',
        level: 'info',
        message: 'Order created',
        context: 'OrdersService',
        orderId: 'order-1',
      });

      expect(line).toContain('2026-01-01 10:00:00');
      expect(line).toContain('[info]');
      expect(line).toContain('[OrdersService]');
      expect(line).toContain('Order created');
      expect(line).toContain('{"orderId":"order-1"}');
    });

    it('omits the context and metadata segments when they are absent', () => {
      build({ 'logging.json': false });
      const render = printfCallbacks[0];

      const line = render({ timestamp: '2026-01-01 10:00:00', level: 'warn', message: 'Heads up' });

      expect(line).toBe('2026-01-01 10:00:00 [warn] Heads up ');
    });

    it('registers the pretty format only when json logging is off', () => {
      build({ 'logging.json': true });
      expect(printfCallbacks).toHaveLength(0);

      build({ 'logging.json': false });
      expect(printfCallbacks).toHaveLength(1);
    });
  });

  describe('setContext', () => {
    it('tags subsequent records with the context', () => {
      const service = build();

      service.setContext('PaymentsService');
      service.log('charged');

      expect(baseLogger.info).toHaveBeenCalledWith(
        'charged',
        expect.objectContaining({ context: 'PaymentsService' }),
      );
    });

    it('lets an explicit context override the service default', () => {
      const service = build();

      service.setContext('PaymentsService');
      service.log('charged', 'RefundsService');

      expect(baseLogger.info).toHaveBeenCalledWith(
        'charged',
        expect.objectContaining({ context: 'RefundsService' }),
      );
    });
  });

  describe('child', () => {
    it('returns the winston child logger with the supplied metadata', () => {
      const service = build();

      const child = service.child({ requestId: 'req-1' });

      expect(baseLogger.child).toHaveBeenCalledWith({ requestId: 'req-1' });
      expect(child).toBe(childLogger);
    });
  });

  describe('correlation metadata', () => {
    it('attaches the request, correlation, tenant and user identifiers', () => {
      correlationService.requestId = 'req-1';
      correlationService.correlationId = 'corr-1';
      correlationService.tenantId = 'tenant-1';
      correlationService.userId = 'user-1';
      const service = build();

      service.log('hello');

      expect(baseLogger.info).toHaveBeenCalledWith(
        'hello',
        expect.objectContaining({
          requestId: 'req-1',
          correlationId: 'corr-1',
          tenantId: 'tenant-1',
          userId: 'user-1',
        }),
      );
    });
  });
});
